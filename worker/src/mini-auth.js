import { createHmac, timingSafeEqual } from "node:crypto";

import { resolveBotRuntimeConfig } from "./bot.js";
import { state } from "./tg.js";

const DEFAULT_INITDATA_MAX_AGE_SECONDS = 86400;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function normalizeDevTelegramUserId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function miniAppValidationBotToken({ env = process.env, telegramState = state } = {}) {
  return resolveBotRuntimeConfig({ env, telegramState }).botToken;
}

export function localDevMiniAppBypassConfig(env = process.env) {
  const localDevMode = truthy(env.LOCAL_DEV_MODE);
  const bypassAllowed = truthy(env.LOCAL_DEV_ALLOW_SESSION_BYPASS);
  const devTelegramUserId = normalizeDevTelegramUserId(env.DEV_TELEGRAM_USER_ID);

  return {
    enabled: Boolean(localDevMode && bypassAllowed && devTelegramUserId),
    localDevMode,
    bypassAllowed,
    devTelegramUserId,
  };
}

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function checkInitDataHash(params, hash, botToken, excludeSignature) {
  const pairs = Array.from(params.entries())
    .filter(([key]) => key !== "hash" && (!excludeSignature || key !== "signature"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs).digest("hex");

  return timingSafeHexEqual(expected, hash);
}

export function requireMiniUser(
  initData,
  {
    env = process.env,
    telegramState = state,
    now = Date.now(),
    maxAgeSeconds = Number(
      env.MINI_APP_INITDATA_MAX_AGE_SECONDS || DEFAULT_INITDATA_MAX_AGE_SECONDS,
    ),
  } = {},
) {
  const botToken = miniAppValidationBotToken({ env, telegramState });
  if (!botToken) throw new Error("Telegram bot token is not configured.");

  const raw = String(initData || "");
  if (!raw) throw new Error("Telegram Mini App initData is missing.");

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) throw new Error("Telegram Mini App initData hash is missing.");

  const valid =
    checkInitDataHash(params, hash, botToken, false) ||
    checkInitDataHash(params, hash, botToken, true);
  if (!valid) throw new Error("Telegram Mini App initData validation failed.");

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.floor(now / 1000) - authDate > maxAgeSeconds) {
    throw new Error("Telegram Mini App session expired. Reopen the bot app.");
  }

  let user;
  try {
    user = JSON.parse(params.get("user") || "{}");
  } catch {
    throw new Error("Telegram Mini App user data is invalid.");
  }

  const botUserId = Number(user?.id);
  if (!Number.isSafeInteger(botUserId) || botUserId <= 0) {
    throw new Error("Telegram Mini App user ID is invalid.");
  }

  return {
    botUserId,
    user: {
      id: botUserId,
      username: user.username || null,
      firstName: user.first_name || null,
      lastName: user.last_name || null,
    },
  };
}

export function requireMiniUserOrLocalDevBypass(initData, options = {}) {
  try {
    return requireMiniUser(initData, options);
  } catch (error) {
    const config = localDevMiniAppBypassConfig(options.env ?? process.env);
    if (!config.enabled) throw error;

    return {
      botUserId: config.devTelegramUserId,
      localDevMiniAppBypass: true,
      testOnly: true,
      user: {
        id: config.devTelegramUserId,
        username: "local_dev_bypass",
        firstName: "Local Dev",
        lastName: null,
      },
    };
  }
}
