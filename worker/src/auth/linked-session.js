import { getClient } from "../tg.js";

const LOCAL_DEV_BYPASS_WARNING =
  "TEST ONLY: LOCAL_DEV_ALLOW_SESSION_BYPASS is active. Linked Telegram session lookup is bypassed for local AI testing only.";

let warnedLocalDevBypass = false;

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function normalizeBotUserId(botUserId) {
  const id = Number(botUserId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid Telegram bot user ID.");
  }

  return id;
}

function localDevSessionBypassConfig(env = process.env) {
  const localDevMode = truthy(env.LOCAL_DEV_MODE);
  const bypassAllowed = truthy(env.LOCAL_DEV_ALLOW_SESSION_BYPASS);
  const restrictedUserId = String(env.DEV_TELEGRAM_USER_ID || "").trim();

  return {
    enabled: localDevMode && bypassAllowed,
    localDevMode,
    bypassAllowed,
    restrictedUserId: restrictedUserId ? normalizeBotUserId(restrictedUserId) : null,
  };
}

function syntheticLocalDevClient(botUserId) {
  return {
    __localDevSessionBypass: true,
    __testOnly: true,
    botUserId,
    isUserAuthorized: async () => true,
    getMe: async () => ({
      id: botUserId,
      username: "local_dev_bypass",
      firstName: "Local Dev",
      lastName: null,
      premium: false,
    }),
    invoke: async () => {
      throw new Error("TEST ONLY local session bypass cannot perform Telegram MTProto operations.");
    },
  };
}

function maybeLocalDevSessionBypass(id, { env = process.env, logger = console } = {}) {
  const config = localDevSessionBypassConfig(env);

  if (!config.enabled) return null;

  if (config.restrictedUserId !== null && config.restrictedUserId !== id) {
    throw new Error("Local dev session bypass is restricted to DEV_TELEGRAM_USER_ID.");
  }

  if (!warnedLocalDevBypass) {
    logger.warn?.(LOCAL_DEV_BYPASS_WARNING);
    warnedLocalDevBypass = true;
  }

  return {
    botUserId: id,
    localDevSessionBypass: true,
    testOnly: true,
    client: syntheticLocalDevClient(id),
  };
}

export function createLinkedSessionGuard({
  getClient: loadClient,
  env = process.env,
  logger = console,
} = {}) {
  return async function requireLinkedSessionForUser(botUserId) {
    const id = normalizeBotUserId(botUserId);
    const bypass = maybeLocalDevSessionBypass(id, { env, logger });
    if (bypass) return bypass;

    const client = await loadClient(id);
    const authorized = await client.isUserAuthorized();

    if (!authorized) {
      throw new Error("Your Telegram account is not connected yet. Open the Mini App first.");
    }

    return {
      botUserId: id,
      client,
    };
  };
}

export const requireLinkedSession = createLinkedSessionGuard({ getClient });

export function __testNormalizeBotUserId(botUserId) {
  return normalizeBotUserId(botUserId);
}

export function __testLocalDevSessionBypassConfig(env) {
  return localDevSessionBypassConfig(env);
}

export function __testResetLocalDevSessionBypassWarning() {
  warnedLocalDevBypass = false;
}
