import { api, botApi } from "./api.js";
import {
  state,
  loadConfig,
  getMe,
  isUserConnected,
  sendCode,
  signInWithCode,
  signInWithPassword,
  cancelLogin,
} from "./tg.js";
import { runJob, parseFolderLink } from "./process.js";

/** botUserId -> { mode, chatId, links? } */
const sessions = new Map();
/** botUserId -> true */
const running = new Map();

let call = null;
let offset = 0;
let stopped = false;
export let botUsername = null;
export let botError = null;

const HELP = [
  "Telegram Folder Merger",
  "",
  "/connect - connect your Telegram account",
  "/addfolder - merge folder links into one clean folder",
  "/status - show your connection and job state",
  "/cancel - cancel the current prompt",
  "/help - this message",
].join("\n");

function botUserIdFrom(msg) {
  const id = Number(msg?.from?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

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

function hasGlobalConfig() {
  return Boolean(state.apiId && state.apiHash);
}

async function handleConnect(chatId, botUserId) {
  if (!hasGlobalConfig()) {
    await send(chatId, "Telegram API ID / API hash are not configured on the worker yet.");
    return;
  }

  sessions.set(String(botUserId), { mode: "connect_phone", chatId });
  await send(chatId, "Send your phone number with country code. Example: +919876543210");
}

async function handlePhone(chatId, botUserId, text) {
  try {
    await sendCode(botUserId, text, chatId);
    sessions.set(String(botUserId), { mode: "connect_code", chatId });
    await send(chatId, "Telegram sent you a login code. Send that code here.");
  } catch (e) {
    sessions.delete(String(botUserId));
    await send(chatId, `Could not start Telegram login: ${e.message}`);
  }
}

async function handleCode(chatId, botUserId, text) {
  try {
    const result = await signInWithCode(botUserId, text);
    if (result.needsPassword) {
      sessions.set(String(botUserId), { mode: "connect_password", chatId });
      await send(chatId, "This account has Telegram 2FA enabled. Send your 2FA password.");
      return;
    }

    sessions.delete(String(botUserId));
    await send(chatId, result.message ?? "Telegram account connected.");
  } catch (e) {
    await send(chatId, `Telegram login failed: ${e.message}`);
  }
}

async function handlePassword(chatId, botUserId, text) {
  try {
    const result = await signInWithPassword(botUserId, text);
    sessions.delete(String(botUserId));
    await send(chatId, result.message ?? "Telegram account connected.");
  } catch (e) {
    await send(chatId, `Telegram 2FA failed: ${e.message}`);
  }
}

async function handleAddFolder(chatId, botUserId) {
  if (!hasGlobalConfig()) {
    await send(chatId, "Telegram API ID / API hash are not configured on the worker yet.");
    return;
  }

  if (running.get(String(botUserId))) {
    await send(chatId, "A job is already running. Wait for it to finish, or send /cancel.");
    return;
  }

  if (!(await isUserConnected(botUserId))) {
    await send(chatId, "Your Telegram account is not connected yet. Send /connect first.");
    return;
  }

  sessions.set(String(botUserId), { mode: "await_links", chatId });
  await send(chatId, "Send your Telegram folder links, one per line.");
}

async function handleLinks(chatId, botUserId, text) {
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

  sessions.set(String(botUserId), { mode: "await_name", chatId, links: parsed.map((p) => p.url) });
  await send(
    chatId,
    `${valid.length} folder link${valid.length === 1 ? "" : "s"} received` +
      (lines.length > valid.length ? ` (${lines.length - valid.length} ignored as invalid)` : "") +
      ".\n\nSend a name for the new folder, or send - to use an automatic name.",
  );
}

async function startJob(chatId, botUserId, links, folderName) {
  const key = String(botUserId);
  running.set(key, true);
  sessions.delete(key);

  try {
    const result = await runJob({
      botUserId,
      urls: links,
      botChatId: chatId,
      folderName,
      report: (msg) => send(chatId, msg),
    });

    if (result.failedAll) {
      await send(chatId, "None of the folder links could be read. Nothing was created.");
      return;
    }

    if (result.noEligible) {
      const t = result.totals;
      await send(
        chatId,
        [
          "No clean folder created.",
          "",
          `Total chats found: ${t.total_chats}`,
          `Unique chats: ${t.unique_chats}`,
          `Duplicates removed: ${t.duplicate_chats}`,
          `Inaccessible/excluded: ${t.inaccessible_chats}`,
          "",
          "No unique chat passed the write-access test.",
        ].join("\n"),
      );
      return;
    }

    const t = result.totals;
    const lines = [
      "CLEAN FOLDER CREATED",
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
      lines.push(`Shareable Link:\n${result.shareLink}`);
    } else {
      lines.push(`No shareable link: ${result.shareNote}`);
      lines.push("The folder itself was created on your account.");
    }

    await send(chatId, lines.join("\n"));
  } catch (e) {
    console.error("job failed:", e?.message || e);
    await send(chatId, `Job failed: ${e.errorMessage || e.message}`);
  } finally {
    running.delete(key);
  }
}

async function handleStatus(chatId, botUserId) {
  let account = "not connected";

  try {
    const me = await getMe(botUserId);
    account = me.username ? `@${me.username}` : me.firstName || "connected";
  } catch {
    account = "not connected";
  }

  const parts = [
    `Telegram API: ${state.apiId && state.apiHash ? "configured" : "missing"}`,
    `Telegram account: ${account}`,
    `Bot: ${botUsername ? "@" + botUsername : "not running"}`,
    `Job running: ${running.get(String(botUserId)) ? "yes" : "no"}`,
  ];
  await send(chatId, parts.join("\n"));
}

async function handleCancel(chatId, botUserId) {
  const key = String(botUserId);
  sessions.delete(key);
  await cancelLogin(botUserId).catch(() => {});
  await send(chatId, "Cancelled.");
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;

  const chatId = msg.chat.id;
  const botUserId = botUserIdFrom(msg);
  const text = msg.text.trim();

  if (!botUserId) {
    await send(chatId, "I could not identify your Telegram user ID.");
    return;
  }

  if (text.startsWith("/start")) {
    await send(chatId, `Send /connect to connect your Telegram account.\n\n${HELP}`);
    return;
  }
  if (text.startsWith("/help")) return void send(chatId, HELP);
  if (text.startsWith("/cancel")) return void handleCancel(chatId, botUserId);
  if (text.startsWith("/status")) return void handleStatus(chatId, botUserId);
  if (text.startsWith("/connect")) return void handleConnect(chatId, botUserId);
  if (text.startsWith("/addfolder")) return void handleAddFolder(chatId, botUserId);

  const session = sessions.get(String(botUserId));
  if (session?.mode === "connect_phone") return void handlePhone(chatId, botUserId, text);
  if (session?.mode === "connect_code") return void handleCode(chatId, botUserId, text);
  if (session?.mode === "connect_password") return void handlePassword(chatId, botUserId, text);
  if (session?.mode === "await_links") return void handleLinks(chatId, botUserId, text);
  if (session?.mode === "await_name") {
    const name = text === "-" ? null : text.slice(0, 60);
    void startJob(chatId, botUserId, session.links, name);
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
