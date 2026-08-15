import { api, botApi } from "./api.js";
import { state, loadConfig, getMe, cancelLogin } from "./tg.js";

let call = null;
let offset = 0;
let stopped = false;
export let botUsername = null;
export let botError = null;

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const MINI_APP_URL = (process.env.MINI_APP_URL || (APP_URL ? `${APP_URL}/mini-app` : "")).replace(
  /\/+$/,
  "",
);

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

  await sendMiniApp(chatId, HELP);
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
