import { api, botApi } from "./api.js";
import { handleRepresentativeMessage } from "./agents/agent-service.js";
import { state, loadConfig, getMe, cancelLogin } from "./tg.js";

let call = null;
let offset = 0;
let stopped = false;
let polling = false;
export let botUsername = null;
export let botId = null;
export let botError = null;

function cleanBaseUrl(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function defaultMiniAppUrl() {
  const workerBase = cleanBaseUrl(
    process.env.MINI_APP_BASE_URL ||
      process.env.PUBLIC_URL ||
      process.env.RAILWAY_PUBLIC_DOMAIN ||
      process.env.RAILWAY_STATIC_URL ||
      "telegram-folder-master-production.up.railway.app",
  );
  const appBase = cleanBaseUrl(process.env.APP_URL);
  const base = workerBase || appBase;
  return base ? `${base}/mini-app` : "";
}

const MINI_APP_URL = cleanBaseUrl(process.env.MINI_APP_URL) || defaultMiniAppUrl();

const HELP = [
  "Telegram Folder Merger",
  "",
  "Open the Mini App to connect your Telegram account, analyze folder links, and create a clean folder.",
  "",
  "/start - open Mini App",
  "/status - show connection status",
  "/cancel - cancel a pending Telegram login",
  "/help - this message",
].join("\n");

function botUserIdFrom(msg) {
  const id = Number(msg?.from?.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function chatType(msg) {
  return msg?.chat?.type || "private";
}

function isPrivateChat(msg) {
  return chatType(msg) === "private";
}

function commandTextForBot(text) {
  const value = String(text || "").trim();
  if (!botUsername) return value;

  return value.replace(new RegExp(`^/(\\w+)@${botUsername}\\b`, "i"), "/$1");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isReplyToBot(msg) {
  const from = msg?.reply_to_message?.from;
  if (!from?.is_bot) return false;
  if (botId && Number(from.id) === Number(botId)) return true;
  return Boolean(
    botUsername && String(from.username || "").toLowerCase() === botUsername.toLowerCase(),
  );
}

function mentionsBot(msg) {
  const text = String(msg?.text || "");
  if (!botUsername) return false;

  const username = `@${botUsername}`.toLowerCase();
  const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(botUsername)}\\b`, "i");
  if (mentionPattern.test(text)) return true;

  return (msg.entities || []).some((entity) => {
    if (entity.type !== "mention") return false;
    const mention = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
    return mention === username;
  });
}

function shouldHandleGroupMessage(msg) {
  return mentionsBot(msg) || isReplyToBot(msg);
}

function representativeText(msg) {
  const text = String(msg?.text || "").trim();
  if (!botUsername) return text;
  return text.replace(new RegExp(`@${botUsername}\\b`, "gi"), "").trim();
}

async function send(chatId, text, extra = {}) {
  if (!call) return;
  try {
    await call("sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...extra,
    });
  } catch (e) {
    console.error("sendMessage failed:", e.message);
  }
}

async function sendMiniApp(chatId, text = "Open the Mini App to continue.") {
  if (!MINI_APP_URL) {
    await send(
      chatId,
      "Mini App URL is not configured. Set APP_URL or MINI_APP_URL on the worker.",
    );
    return;
  }

  await send(chatId, text, {
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "Open Mini App",
            web_app: { url: MINI_APP_URL },
          },
        ],
      ],
    },
  });
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
    `Mini App: ${MINI_APP_URL || "not configured"}`,
  ];
  await send(chatId, parts.join("\n"));
}

async function handleCancel(chatId, botUserId) {
  await cancelLogin(botUserId).catch(() => {});
  await send(chatId, "Cancelled any pending Telegram login. Open the Mini App to continue.");
}

async function handleCommand({ msg, chatId, botUserId, text }) {
  if (text.startsWith("/start")) return void sendMiniApp(chatId);
  if (text.startsWith("/connect")) {
    return void sendMiniApp(chatId, "Connect your Telegram account inside the Mini App.");
  }
  if (text.startsWith("/addfolder")) {
    return void sendMiniApp(chatId, "Add and analyze folder links inside the Mini App.");
  }
  if (text.startsWith("/help")) return void send(chatId, HELP);
  if (text.startsWith("/cancel")) return void handleCancel(chatId, botUserId);
  if (text.startsWith("/status")) return void handleStatus(chatId, botUserId);

  if (isPrivateChat(msg)) {
    await sendMiniApp(chatId, HELP);
  }
}

async function handlePrivateMessage(msg) {
  const chatId = msg.chat.id;
  const botUserId = botUserIdFrom(msg);
  const text = commandTextForBot(msg.text);

  if (!botUserId) {
    await send(chatId, "I could not identify your Telegram user ID.");
    return;
  }

  await handleCommand({ msg, chatId, botUserId, text });
}

async function handleGroupMessage(msg) {
  if (!shouldHandleGroupMessage(msg)) return;

  const chatId = msg.chat.id;
  const botUserId = botUserIdFrom(msg);
  const text = commandTextForBot(msg.text);

  if (!botUserId) {
    await send(chatId, "I could not identify your Telegram user ID.");
    return;
  }

  if (text.startsWith("/")) {
    await handleCommand({ msg, chatId, botUserId, text });
    return;
  }

  try {
    const response = await handleRepresentativeMessage({
      botUserId,
      chat: {
        id: chatId,
        type: chatType(msg),
        title: msg.chat.title || null,
      },
      text: representativeText(msg),
    });

    if (response?.text) {
      await send(chatId, response.text, { reply_to_message_id: msg.message_id });
    }
  } catch (e) {
    await send(chatId, e.message || "Open the Mini App to connect your Telegram account.", {
      reply_to_message_id: msg.message_id,
    });
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text || !msg.chat) return;

  if (isPrivateChat(msg)) {
    await handlePrivateMessage(msg);
    return;
  }

  await handleGroupMessage(msg);
}

export async function startBot() {
  if (call && polling && !stopped) {
    return;
  }

  stopped = false;
  if (!state.botToken) {
    botError = "Bot token not configured.";
    return;
  }

  call = botApi(state.botToken);
  try {
    const me = await call("getMe");
    botUsername = me.username;
    botId = Number(me.id) || null;
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
  botId = null;
}

async function pollLoop() {
  if (polling) return;
  polling = true;

  try {
    while (!stopped && call) {
      try {
        const currentCall = call;
        const updates = await currentCall(
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
  } finally {
    polling = false;
  }
}

export async function restartBot() {
  stopBot();
  await loadConfig();
  await startBot();
}
