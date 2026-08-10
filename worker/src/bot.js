import { api, botApi } from "./api.js";
import { state, loadConfig, getClient } from "./tg.js";
import { runJob, parseFolderLink } from "./process.js";

/** chatId -> { mode: "await_links" | "await_name", links?: string[] } */
const sessions = new Map();
/** chatId -> AbortController-ish flag */
const running = new Map();

let call = null;
let offset = 0;
let stopped = false;
export let botUsername = null;
export let botError = null;

const HELP = [
  "Telegram Folder Merger",
  "",
  "/addfolder — merge folder links into one clean folder",
  "/status — show the last job and connection state",
  "/cancel — cancel what you are doing",
  "/help — this message",
].join("\n");

async function send(chatId, text) {
  if (!call) return;
  try {
    await call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
    });
  } catch (e) {
    console.error("sendMessage failed:", e.message);
  }
}

function ownerOk(from) {
  // Only the authorized Telegram account may drive this worker.
  const me = state.me?.id ? Number(state.me.id) : null;
  return me !== null && Number(from?.id) === me;
}

async function handleAddFolder(chatId) {
  if (running.get(chatId)) {
    await send(chatId, "A job is already running. Wait for it to finish, or send /cancel.");
    return;
  }
  sessions.set(chatId, { mode: "await_links" });
  await send(chatId, "Send your Telegram folder links, one per line.");
}

async function handleLinks(chatId, text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parsed = lines.map(parseFolderLink);
  const valid = parsed.filter((p) => p?.slug);
  if (valid.length === 0) {
    await send(
      chatId,
      "No valid folder links found.\nThey must look like:\nhttps://t.me/addlist/XXXXX",
    );
    return;
  }
  sessions.set(chatId, { mode: "await_name", links: parsed.map((p) => p.url) });
  await send(
    chatId,
    `${valid.length} folder link${valid.length === 1 ? "" : "s"} received` +
      (lines.length > valid.length ? ` (${lines.length - valid.length} ignored as invalid)` : "") +
      ".\n\nSend a name for the new folder, or send - to use an automatic name.",
  );
}

async function startJob(chatId, links, folderName) {
  running.set(chatId, true);
  sessions.delete(chatId);
  try {
    await getClient();
  } catch (e) {
    running.delete(chatId);
    await send(chatId, `❌ ${e.message}`);
    return;
  }

  try {
    const result = await runJob({
      urls: links,
      botChatId: chatId,
      folderName,
      report: (msg) => send(chatId, msg),
    });

    if (result.failedAll) {
      await send(chatId, "❌ None of the folder links could be read. Nothing was created.");
      return;
    }
    if (result.noEligible) {
      const t = result.totals;
      await send(
        chatId,
        [
          "❌ No clean folder created.",
          "",
          `Total chats found: ${t.total_chats}`,
          `Unique chats: ${t.unique_chats}`,
          `Duplicates removed: ${t.duplicate_chats}`,
          `Inaccessible/excluded: ${t.inaccessible_chats}`,
          "",
          "None of the chats were accessible from your account.",
        ].join("\n"),
      );
      return;
    }

    const t = result.totals;
    const lines = [
      "✅ CLEAN FOLDER CREATED",
      "",
      `Source folders: ${result.folderCount} (${result.ok} read, ${result.failed} failed)`,
      `Total chats found: ${t.total_chats}`,
      `Unique chats: ${t.unique_chats}`,
      `Duplicates removed: ${t.duplicate_chats}`,
      `Inaccessible/excluded: ${t.inaccessible_chats}`,
      `Final chats: ${t.final_chats}`,
      "",
      `Master Folder:\n${result.name}`,
      "",
    ];
    if (result.shareLink) {
      lines.push(`🔗 Shareable Link:\n${result.shareLink}`);
    } else {
      lines.push(`ℹ️ No shareable link: ${result.shareNote}`);
      lines.push("The folder itself was created on your account.");
    }
    await send(chatId, lines.join("\n"));
  } catch (e) {
    console.error("job failed:", e);
    await send(chatId, `❌ Job failed: ${e.errorMessage || e.message}`);
  } finally {
    running.delete(chatId);
  }
}

async function handleStatus(chatId) {
  const parts = [
    `Telegram API: ${state.apiId && state.apiHash ? "✓ configured" : "✗ missing"}`,
    `Telegram account: ${state.me ? `✓ ${state.me.username ? "@" + state.me.username : "connected"}` : "✗ not connected"}`,
    `Bot: ${botUsername ? "✓ @" + botUsername : "✗"}`,
    `Job running: ${running.get(chatId) ? "yes" : "no"}`,
  ];
  await send(chatId, parts.join("\n"));
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (!state.me) {
    try {
      await getClient();
    } catch {
      /* handled below */
    }
  }
  if (!state.me) {
    await send(chatId, "Telegram is not connected. Finish the setup on the website first.");
    return;
  }
  if (!ownerOk(msg.from)) {
    await send(chatId, "This bot only responds to the Telegram account it was set up with.");
    return;
  }

  if (text.startsWith("/start")) {
    await send(chatId, `Ready.\n\n${HELP}`);
    return;
  }
  if (text.startsWith("/help")) return void send(chatId, HELP);
  if (text.startsWith("/cancel")) {
    sessions.delete(chatId);
    await send(chatId, "Cancelled.");
    return;
  }
  if (text.startsWith("/status")) return void handleStatus(chatId);
  if (text.startsWith("/addfolder")) return void handleAddFolder(chatId);

  const session = sessions.get(chatId);
  if (session?.mode === "await_links") return void handleLinks(chatId, text);
  if (session?.mode === "await_name") {
    const name = text === "-" ? null : text.slice(0, 60);
    void startJob(chatId, session.links, name);
    return;
  }

  await send(chatId, HELP);
}

export async function startBot() {
  stopped = false;
  if (!state.botToken) {
    botError = "Bot token not configured.";
    return;
  }
  call = botApi(state.botToken);
  try {
    const me = await call("getMe");
    botUsername = me.username;
    botError = null;
    await call("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    await api("saveConfig", { bot_username: botUsername }).catch(() => {});
  } catch (e) {
    botError = e.message;
    call = null;
    return;
  }
  void pollLoop();
}

export function stopBot() {
  stopped = true;
  call = null;
  botUsername = null;
}

async function pollLoop() {
  while (!stopped && call) {
    try {
      const updates = await call(
        "getUpdates",
        { offset, timeout: 30, allowed_updates: ["message"] },
        40000,
      );
      for (const u of updates) {
        offset = u.update_id + 1;
        handleUpdate(u).catch((e) => console.error("update error:", e.message));
      }
    } catch (e) {
      if (!stopped) {
        console.error("polling error:", e.message);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }
}

export async function restartBot() {
  stopBot();
  await loadConfig();
  await startBot();
}