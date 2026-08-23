import { api, botApi } from "./api.js";
import { handleRepresentativeMessage } from "./agents/agent-service.js";
import { trainingService as defaultTrainingService } from "./agents/training-service.js";
import { DEFAULT_AGENT_ID } from "./agents/profile-service.js";
import { requireLinkedSession } from "./auth/linked-session.js";
import { state, loadConfig, getMe, cancelLogin } from "./tg.js";

let call = null;
let offset = 0;
let stopped = false;
let polling = false;
export let botUsername = null;
export let botId = null;
export let botError = null;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

export function isLocalDevMode(env = process.env) {
  return truthy(env.LOCAL_DEV_MODE);
}

export function resolveBotRuntimeConfig({ env = process.env, telegramState = state } = {}) {
  const localDevMode = isLocalDevMode(env);
  const devBotToken = String(env.DEV_TELEGRAM_BOT_TOKEN || "").trim();
  const botToken = localDevMode && devBotToken ? devBotToken : telegramState.botToken;

  return {
    botToken,
    localDevMode: Boolean(localDevMode && devBotToken),
    shouldSaveBotUsername: !(localDevMode && devBotToken),
  };
}

function cleanBaseUrl(value) {
  const raw = String(value || "")
    .trim()
    .replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

function defaultMiniAppUrl(env = process.env) {
  const workerBase = cleanBaseUrl(
    env.MINI_APP_BASE_URL ||
      env.PUBLIC_URL ||
      env.RAILWAY_PUBLIC_DOMAIN ||
      env.RAILWAY_STATIC_URL ||
      "telegram-folder-master-production.up.railway.app",
  );
  const appBase = cleanBaseUrl(env.APP_URL);
  const base = workerBase || appBase;
  return base ? `${base}/mini-app` : "";
}

export function resolveMiniAppUrl({ env = process.env } = {}) {
  const explicit = cleanBaseUrl(env.MINI_APP_URL);
  if (explicit) return explicit;
  if (isLocalDevMode(env)) return "";
  return defaultMiniAppUrl(env);
}

export function miniAppUrlMissingMessage({ env = process.env } = {}) {
  if (isLocalDevMode(env)) {
    return "Local dev Mini App URL is not configured. Set MINI_APP_URL to your HTTPS tunnel URL, for example https://your-tunnel.example/mini-app.";
  }
  return "Mini App URL is not configured. Set APP_URL or MINI_APP_URL on the worker.";
}

const MINI_APP_URL = resolveMiniAppUrl();

const BASE_HELP = [
  "Telegram Folder Merger",
  "",
  "Open the Mini App to connect your Telegram account, analyze folder links, and create a clean folder.",
  "",
  "/start - open Mini App",
  "/status - show connection status",
  "/cancel - cancel a pending Telegram login",
  "/help - this message",
].join("\n");

const TRAINING_HELP = [
  "/train - train your Personal AI Representative",
  "/train_status - show training progress",
  "/train_cancel - cancel active training",
  "/remember <instruction> - save an owner instruction",
  "/instructions - list active owner instructions",
].join("\n");

const HELP = [BASE_HELP, isLocalDevMode() ? TRAINING_HELP : ""].filter(Boolean).join("\n");

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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

async function sendMiniApp(chatId, text = "Open the Mini App to continue.", extra = {}) {
  if (!MINI_APP_URL) {
    await send(chatId, miniAppUrlMissingMessage(), extra);
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
    ...extra,
  });
}

export function createTelegramMessageRouter({
  sendMessage,
  sendMiniAppMessage,
  getTelegramMe,
  cancelTelegramLogin,
  handleAiMessage,
  trainingService = defaultTrainingService,
  requireTrainingSession = requireLinkedSession,
  trainingAgentId = DEFAULT_AGENT_ID,
  enableTrainingCommands = isLocalDevMode(),
  getBotMeta = () => ({ botUsername, botId }),
  getState = () => state,
  miniAppUrl = MINI_APP_URL,
  helpText = HELP,
}) {
  function currentBotUsername() {
    return getBotMeta().botUsername;
  }

  function currentBotId() {
    return getBotMeta().botId;
  }

  function localCommandTextForBot(text) {
    const value = String(text || "").trim();
    const username = currentBotUsername();
    if (!username) return value;

    return value.replace(new RegExp(`^/(\\w+)@${escapeRegExp(username)}\\b`, "i"), "/$1");
  }

  function localIsReplyToBot(msg) {
    const from = msg?.reply_to_message?.from;
    const id = currentBotId();
    const username = currentBotUsername();
    if (!from?.is_bot) return false;
    if (id && Number(from.id) === Number(id)) return true;
    return Boolean(
      username && String(from.username || "").toLowerCase() === username.toLowerCase(),
    );
  }

  function localMentionsBot(msg) {
    const text = String(msg?.text || "");
    const usernameValue = currentBotUsername();
    if (!usernameValue) return false;

    const username = `@${usernameValue}`.toLowerCase();
    const mentionPattern = new RegExp(`(^|\\s)@${escapeRegExp(usernameValue)}\\b`, "i");
    const commandPattern = new RegExp(`^/\\w+@${escapeRegExp(usernameValue)}\\b`, "i");
    if (commandPattern.test(text)) return true;
    if (mentionPattern.test(text)) return true;

    return (msg.entities || []).some((entity) => {
      if (entity.type !== "mention") return false;
      const mention = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
      return mention === username;
    });
  }

  function localShouldHandleGroupMessage(msg) {
    return localMentionsBot(msg) || localIsReplyToBot(msg);
  }

  function localRepresentativeText(msg) {
    const text = String(msg?.text || "").trim();
    const username = currentBotUsername();
    if (!username) return text;
    return text.replace(new RegExp(`@${escapeRegExp(username)}\\b`, "gi"), "").trim();
  }

  async function localHandleStatus(chatId, botUserId) {
    let account = "not connected";

    try {
      const me = await getTelegramMe(botUserId);
      account = me.username ? `@${me.username}` : me.firstName || "connected";
    } catch {
      account = "not connected";
    }

    const currentState = getState();
    const meta = getBotMeta();
    const parts = [
      `Telegram API: ${currentState.apiId && currentState.apiHash ? "configured" : "missing"}`,
      `Telegram account: ${account}`,
      `Bot: ${meta.botUsername ? "@" + meta.botUsername : "not running"}`,
      `Mini App: ${miniAppUrl || "not configured"}`,
    ];
    await sendMessage(chatId, parts.join("\n"));
  }

  async function localHandleCancel(chatId, botUserId) {
    await cancelTelegramLogin(botUserId).catch(() => {});
    await sendMessage(
      chatId,
      "Cancelled any pending Telegram login. Open the Mini App to continue.",
    );
  }

  function trainingCommandPayload(text, command) {
    return String(text || "")
      .replace(new RegExp(`^/${command}\\b`, "i"), "")
      .trim();
  }

  function isTrainingCommand(text) {
    return /^\/(train|train_status|train_cancel|remember|instructions)\b/i.test(
      String(text || "").trim(),
    );
  }

  async function localRequireTrainingSession(botUserId) {
    await requireTrainingSession(botUserId);
  }

  async function localHandleTrainingCommand({ msg, chatId, botUserId, text }) {
    if (!enableTrainingCommands) return false;
    if (!isTrainingCommand(text)) return false;

    if (!isPrivateChat(msg)) {
      await sendMessage(chatId, "Training commands are only available in private chat.", {
        reply_to_message_id: msg.message_id,
      });
      return true;
    }

    await localRequireTrainingSession(botUserId);

    if (/^\/train_status\b/i.test(text)) {
      const result = await trainingService.status({
        ownerId: botUserId,
        agentId: trainingAgentId,
      });
      await sendMessage(chatId, result.text);
      return true;
    }

    if (/^\/train_cancel\b/i.test(text)) {
      const result = await trainingService.cancel({
        ownerId: botUserId,
        agentId: trainingAgentId,
      });
      await sendMessage(chatId, result.text);
      return true;
    }

    if (/^\/remember\b/i.test(text)) {
      const result = await trainingService.remember({
        ownerId: botUserId,
        agentId: trainingAgentId,
        text: trainingCommandPayload(text, "remember"),
      });
      await sendMessage(chatId, result.text);
      return true;
    }

    if (/^\/instructions\b/i.test(text)) {
      const result = await trainingService.listInstructions({
        ownerId: botUserId,
        agentId: trainingAgentId,
      });
      await sendMessage(chatId, result.text);
      return true;
    }

    if (/^\/train\b/i.test(text)) {
      const result = await trainingService.start({
        ownerId: botUserId,
        agentId: trainingAgentId,
      });
      await sendMessage(chatId, result.text);
      return true;
    }

    return false;
  }

  async function localHandleCommand({ msg, chatId, botUserId, text }) {
    try {
      if (await localHandleTrainingCommand({ msg, chatId, botUserId, text })) return;
    } catch (e) {
      await sendMiniAppMessage(
        chatId,
        e.message || "Open the Mini App to connect your Telegram account.",
      );
      return;
    }

    if (text.startsWith("/start")) return void sendMiniAppMessage(chatId);
    if (text.startsWith("/connect")) {
      return void sendMiniAppMessage(chatId, "Connect your Telegram account inside the Mini App.");
    }
    if (text.startsWith("/addfolder")) {
      return void sendMiniAppMessage(chatId, "Add and analyze folder links inside the Mini App.");
    }
    if (text.startsWith("/help")) return void sendMessage(chatId, helpText);
    if (text.startsWith("/cancel")) return void localHandleCancel(chatId, botUserId);
    if (text.startsWith("/status")) return void localHandleStatus(chatId, botUserId);

    if (isPrivateChat(msg) && text.startsWith("/")) {
      await sendMiniAppMessage(chatId, helpText);
    }
  }

  async function localHandleTrainingAnswer({ msg, chatId, botUserId, text }) {
    if (!enableTrainingCommands) return false;
    if (!isPrivateChat(msg)) return false;
    if (
      !(await trainingService.isOnboardingActive({
        ownerId: botUserId,
        agentId: trainingAgentId,
      }))
    ) {
      return false;
    }

    try {
      await localRequireTrainingSession(botUserId);
      const result = await trainingService.submitAnswer({
        ownerId: botUserId,
        agentId: trainingAgentId,
        answer: text,
      });
      await sendMessage(chatId, result.text);
      return true;
    } catch (e) {
      await sendMiniAppMessage(
        chatId,
        e.message || "Open the Mini App to connect your Telegram account.",
      );
      return true;
    }
  }

  async function localHandleRepresentativeRoute(msg, botUserId, chatId) {
    try {
      const response = await handleAiMessage({
        botUserId,
        chat: {
          id: chatId,
          type: chatType(msg),
          title: msg.chat.title || null,
        },
        text: localRepresentativeText(msg),
      });

      if (response?.text) {
        const extra = isPrivateChat(msg) ? {} : { reply_to_message_id: msg.message_id };
        await sendMessage(chatId, response.text, extra);
      }
    } catch (e) {
      const extra = isPrivateChat(msg) ? {} : { reply_to_message_id: msg.message_id };
      await sendMiniAppMessage(
        chatId,
        e.message || "Open the Mini App to connect your Telegram account.",
        extra,
      );
    }
  }

  async function localHandlePrivateMessage(msg) {
    const chatId = msg.chat.id;
    const botUserId = botUserIdFrom(msg);
    const text = localCommandTextForBot(msg.text);

    if (!botUserId) {
      await sendMessage(chatId, "I could not identify your Telegram user ID.");
      return;
    }

    if (text.startsWith("/")) {
      await localHandleCommand({ msg, chatId, botUserId, text });
      return;
    }

    if (await localHandleTrainingAnswer({ msg, chatId, botUserId, text })) return;

    await localHandleRepresentativeRoute(msg, botUserId, chatId);
  }

  async function localHandleGroupMessage(msg) {
    if (!localShouldHandleGroupMessage(msg)) return;

    const chatId = msg.chat.id;
    const botUserId = botUserIdFrom(msg);
    const text = localCommandTextForBot(msg.text);

    if (!botUserId) {
      await sendMessage(chatId, "I could not identify your Telegram user ID.");
      return;
    }

    if (text.startsWith("/")) {
      await localHandleCommand({ msg, chatId, botUserId, text });
      return;
    }

    await localHandleRepresentativeRoute(msg, botUserId, chatId);
  }

  return async function routeTelegramUpdate(update) {
    const msg = update.message;
    if (!msg?.text || !msg.chat) return;

    if (isPrivateChat(msg)) {
      await localHandlePrivateMessage(msg);
      return;
    }

    await localHandleGroupMessage(msg);
  };
}

const routeUpdate = createTelegramMessageRouter({
  sendMessage: send,
  sendMiniAppMessage: sendMiniApp,
  getTelegramMe: getMe,
  cancelTelegramLogin: cancelLogin,
  handleAiMessage: handleRepresentativeMessage,
});

async function handleUpdate(update) {
  await routeUpdate(update);
}

export async function startBot() {
  if (call && polling && !stopped) {
    return;
  }

  stopped = false;
  if (isLocalDevMode()) {
    console.log(`[DEV] Mini App URL: ${MINI_APP_URL || "not configured"}`);
  }
  const runtime = resolveBotRuntimeConfig();

  if (!runtime.botToken) {
    botError = "Bot token not configured.";
    return;
  }

  call = botApi(runtime.botToken);
  try {
    const me = await call("getMe");
    botUsername = me.username;
    botId = Number(me.id) || null;
    botError = null;
    await call("deleteWebhook", { drop_pending_updates: false }).catch(() => {});
    if (runtime.shouldSaveBotUsername) {
      await api("saveConfig", { bot_username: botUsername }).catch(() => {});
    }
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
