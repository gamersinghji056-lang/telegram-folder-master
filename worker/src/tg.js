import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";

import { api } from "./api.js";
import { encrypt, decrypt } from "./crypto.js";

/**
 * Multi-user Telegram session manager.
 *
 * IMPORTANT:
 * - Telegram Bot user ID is NOT the same as the Telegram account ID
 *   being connected through MTProto.
 * - Every bot user gets an independent MTProto TelegramClient.
 * - Sessions are stored encrypted through the App API.
 *
 * Expected backend actions:
 *
 *   pullUserSession
 *   saveUserSession
 *   deleteUserSession
 *
 * The next bot.js will call these functions using the Telegram Bot user's ID.
 */

const clients = new Map();
const logins = new Map();

/**
 * Global Telegram API application configuration.
 *
 * These are NOT individual user sessions.
 * They are the API ID / API hash of the Telegram application used
 * for MTProto authentication.
 */
export const state = {
  apiId: null,
  apiHash: null,
  botToken: null,
};

/**
 * Login object:
 *
 * botUserId -> {
 *   client,
 *   phone,
 *   phoneCodeHash,
 *   createdAt
 * }
 */

function opts() {
  return {
    connectionRetries: 5,
    useWSS: false,
    autoReconnect: true,
    requestRetries: 2,
  };
}

/**
 * Load global Telegram API credentials and bot token.
 *
 * This does NOT load a single Telegram user's session anymore.
 */
export async function loadConfig() {
  const { config } = await api("pull");

  if (!config) return;

  state.apiId = config.api_id_enc ? Number(decrypt(config.api_id_enc)) : null;

  state.apiHash = config.api_hash_enc ? decrypt(config.api_hash_enc) : null;

  state.botToken = config.bot_token_enc ? decrypt(config.bot_token_enc) : null;
}

/**
 * Save Telegram application credentials.
 *
 * These are global worker credentials.
 */
export async function saveCredentials({ apiId, apiHash, botToken }) {
  const patch = {};

  if (apiId !== undefined && apiId !== null && String(apiId).trim()) {
    state.apiId = Number(apiId);
    patch.api_id_enc = encrypt(String(apiId));
  }

  if (apiHash !== undefined && apiHash !== null && String(apiHash).trim()) {
    state.apiHash = String(apiHash);
    patch.api_hash_enc = encrypt(String(apiHash));
  }

  if (botToken !== undefined && botToken !== null && String(botToken).trim()) {
    state.botToken = String(botToken);
    patch.bot_token_enc = encrypt(String(botToken));
  }

  if (Object.keys(patch).length) {
    await api("saveConfig", patch);
  }

  return { ok: true };
}

/**
 * Validate that the Telegram API application is configured.
 */
function assertApiConfig() {
  if (!state.apiId || !state.apiHash) {
    throw new Error("Telegram API ID / API hash are not configured on the worker.");
  }
}

/**
 * Convert a bot-user ID into a stable Map key.
 */
function userKey(botUserId) {
  const id = Number(botUserId);

  if (!Number.isSafeInteger(id)) {
    throw new Error("Invalid Telegram bot user ID.");
  }

  return String(id);
}

/**
 * Load a user's encrypted MTProto session from the App API.
 */
async function loadUserSession(botUserId) {
  const key = userKey(botUserId);

  const result = await api("pullUserSession", {
    bot_user_id: Number(key),
  });

  return result?.session ?? null;
}

/**
 * Save a user's encrypted MTProto session.
 */
async function saveUserSession(botUserId, data) {
  const key = userKey(botUserId);

  const payload = {
    bot_user_id: Number(key),
    ...data,
  };

  return api("saveUserSession", payload);
}

/**
 * Delete a user's stored session.
 */
async function deleteUserSession(botUserId) {
  const key = userKey(botUserId);

  return api("deleteUserSession", {
    bot_user_id: Number(key),
  });
}

/**
 * Get the connected Telegram MTProto client for one bot user.
 *
 * If the client is already in memory, reuse it.
 *
 * If not, load the encrypted session from the backend,
 * decrypt it and reconnect.
 */
export async function getClient(botUserId) {
  assertApiConfig();

  const key = userKey(botUserId);

  const existing = clients.get(key);

  if (existing && existing.connected) {
    return existing;
  }

  const stored = await loadUserSession(Number(key));

  if (!stored?.session_enc) {
    throw new Error("Your Telegram account is not connected yet. Use /connect first.");
  }

  let session;

  try {
    session = decrypt(stored.session_enc);
  } catch {
    throw new Error(
      "Your saved Telegram session could not be decrypted. Please reconnect with /connect.",
    );
  }

  if (!session) {
    throw new Error("Your Telegram session is empty. Please reconnect with /connect.");
  }

  const client = new TelegramClient(new StringSession(session), state.apiId, state.apiHash, opts());

  client.setLogLevel?.("error");

  await client.connect();

  const authorized = await client.isUserAuthorized();

  if (!authorized) {
    clients.delete(key);

    throw new Error("Your Telegram session has expired. Please use /connect again.");
  }

  clients.set(key, client);

  return client;
}

/**
 * Return information about the connected Telegram account.
 */
export async function getMe(botUserId) {
  const client = await getClient(botUserId);

  return client.getMe();
}

/**
 * Check whether a bot user already has a connected Telegram session.
 */
export async function isUserConnected(botUserId) {
  try {
    const client = await getClient(botUserId);

    return Boolean(client && client.connected && (await client.isUserAuthorized()));
  } catch {
    return false;
  }
}

/**
 * Start Telegram login for one bot user.
 *
 * Flow:
 *
 * /connect
 *    ↓
 * phone number
 *    ↓
 * Telegram sends login code
 *    ↓
 * signInWithCode()
 */
export async function sendCode(botUserId, phone, botChatId = null) {
  assertApiConfig();

  const key = userKey(botUserId);

  const cleanPhone = String(phone ?? "").trim();

  if (!cleanPhone) {
    throw new Error("Please send your phone number with country code. Example: +919876543210");
  }

  /**
   * Disconnect an unfinished login for this bot user.
   */
  const oldLogin = logins.get(key);

  if (oldLogin?.client) {
    await oldLogin.client.disconnect().catch(() => {});
  }

  logins.delete(key);

  /**
   * Create a completely new MTProto client.
   */
  const client = new TelegramClient(new StringSession(""), state.apiId, state.apiHash, opts());

  client.setLogLevel?.("error");

  await client.connect();

  let result;

  try {
    result = await client.sendCode(
      {
        apiId: state.apiId,
        apiHash: state.apiHash,
      },
      cleanPhone,
    );
  } catch (e) {
    await client.disconnect().catch(() => {});

    const msg = e?.errorMessage || e?.message || "";

    throw new Error(friendlyAuthError(msg));
  }

  logins.set(key, {
    client,
    phone: cleanPhone,
    botChatId,
    phoneCodeHash: result.phoneCodeHash,
    createdAt: Date.now(),
  });

  return {
    ok: true,
    needsCode: true,
    phone: cleanPhone,
  };
}

/**
 * Sign in using the Telegram login code.
 */
export async function signInWithCode(botUserId, code) {
  const key = userKey(botUserId);

  const login = logins.get(key);

  if (!login) {
    throw new Error("No active Telegram login request. Please use /connect again.");
  }

  const cleanCode = String(code ?? "").trim();

  if (!cleanCode) {
    throw new Error("Please send the Telegram login code.");
  }

  const { client, phone, phoneCodeHash } = login;

  try {
    await client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash,
        phoneCode: cleanCode,
      }),
    );
  } catch (e) {
    const msg = e?.errorMessage || e?.message || "";

    /**
     * Telegram 2FA password is required.
     */
    if (msg.includes("SESSION_PASSWORD_NEEDED")) {
      return {
        ok: true,
        needsPassword: true,
      };
    }

    throw new Error(friendlyAuthError(msg));
  }

  return finishLogin(botUserId);
}

/**
 * Complete Telegram login with 2FA password.
 */
export async function signInWithPassword(botUserId, password) {
  const key = userKey(botUserId);

  const login = logins.get(key);

  if (!login) {
    throw new Error("No active Telegram login request. Please use /connect again.");
  }

  const cleanPassword = String(password ?? "");

  if (!cleanPassword) {
    throw new Error("Please send your Telegram 2FA password.");
  }

  const { client } = login;

  try {
    const pwd = await client.invoke(new Api.account.GetPassword());

    const passwordCheck = await computeCheck(pwd, cleanPassword);

    await client.invoke(
      new Api.auth.CheckPassword({
        password: passwordCheck,
      }),
    );
  } catch (e) {
    throw new Error(friendlyAuthError(e?.errorMessage || e?.message || ""));
  }

  return finishLogin(botUserId);
}

/**
 * Finish authentication and persist the user's StringSession.
 */
async function finishLogin(botUserId) {
  const key = userKey(botUserId);

  const login = logins.get(key);

  if (!login) {
    throw new Error("Login session disappeared. Please use /connect again.");
  }

  const { client, phone, botChatId } = login;

  if (!(await client.isUserAuthorized())) {
    throw new Error("Telegram authorization was not completed.");
  }

  const session = client.session.save();

  const me = await client.getMe();

  /**
   * Store the encrypted session.
   *
   * The raw StringSession never leaves this worker.
   */
  await saveUserSession(botUserId, {
    bot_chat_id: botChatId,
    phone,
    session_enc: encrypt(session),
    telegram_account_id: Number(me.id),
    telegram_username: me.username || null,
    first_name: me.firstName || null,
    last_name: me.lastName || null,
    is_premium: Boolean(me.premium),
  });

  clients.set(key, client);

  logins.delete(key);

  return {
    ok: true,
    connected: true,
    telegramUserId: Number(me.id),
    username: me.username || null,
    firstName: me.firstName || null,
    message: `Connected as ${
      me.username ? "@" + me.username : me.firstName || "your Telegram account"
    }.`,
  };
}

/**
 * Disconnect a user's Telegram account.
 *
 * This logs the Telegram account out from the MTProto session.
 */
export async function logout(botUserId) {
  const key = userKey(botUserId);

  const client = clients.get(key);

  if (client) {
    try {
      if (client.connected) {
        await client.invoke(new Api.auth.LogOut());
      }
    } catch {
      /**
       * Even if Telegram rejects logout because
       * the session is already dead, we still remove
       * our stored session.
       */
    }

    await client.disconnect().catch(() => {});

    clients.delete(key);
  }

  const login = logins.get(key);

  if (login?.client) {
    await login.client.disconnect().catch(() => {});
  }

  logins.delete(key);

  await deleteUserSession(botUserId);

  return {
    ok: true,
    message: "Telegram account disconnected.",
  };
}

/**
 * Cancel an unfinished login without deleting
 * an already-connected account.
 */
export async function cancelLogin(botUserId) {
  const key = userKey(botUserId);

  const login = logins.get(key);

  if (login?.client) {
    await login.client.disconnect().catch(() => {});
  }

  logins.delete(key);

  return {
    ok: true,
  };
}

/**
 * Returns the currently active login state.
 */
export function getLoginState(botUserId) {
  const key = userKey(botUserId);

  const login = logins.get(key);

  if (!login) {
    return {
      active: false,
    };
  }

  /**
   * Login requests should not live forever.
   * 10 minutes is enough for OTP + 2FA.
   */
  const age = Date.now() - login.createdAt;

  if (age > 10 * 60 * 1000) {
    return {
      active: false,
      expired: true,
    };
  }

  return {
    active: true,
    phone: login.phone,
    ageMs: age,
  };
}

/**
 * Telegram FLOOD_WAIT helper.
 */
export async function withFloodWait(fn, onWait) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      const seconds = e?.seconds ?? e?.errorMessage?.match?.(/FLOOD_WAIT_(\d+)/)?.[1];

      if (seconds && Number(seconds) <= 3600) {
        const waitSeconds = Number(seconds);

        await onWait?.(waitSeconds);

        await new Promise((resolve) => setTimeout(resolve, (waitSeconds + 2) * 1000));

        continue;
      }

      throw e;
    }
  }

  throw new Error("Telegram rate limit did not clear.");
}

/**
 * Convert Telegram API errors into user-friendly messages.
 */
function friendlyAuthError(msg) {
  const text = String(msg || "");

  if (text.includes("PHONE_CODE_INVALID")) {
    return "That Telegram login code is not correct.";
  }

  if (text.includes("PHONE_CODE_EXPIRED")) {
    return "That Telegram login code expired. Please use /connect and request a new code.";
  }

  if (text.includes("PHONE_NUMBER_INVALID")) {
    return "That phone number is not valid. Include the country code, for example +919876543210.";
  }

  if (text.includes("PHONE_NUMBER_BANNED")) {
    return "This Telegram phone number is banned.";
  }

  if (text.includes("PHONE_NUMBER_FLOOD")) {
    return "Telegram temporarily blocked login attempts for this number. Please try again later.";
  }

  if (text.includes("PASSWORD_HASH_INVALID")) {
    return "That Telegram 2FA password is not correct.";
  }

  if (text.includes("SESSION_PASSWORD_NEEDED")) {
    return "This Telegram account requires its 2FA password.";
  }

  if (text.includes("FLOOD_WAIT")) {
    const seconds = text.match(/FLOOD_WAIT_(\d+)/)?.[1];

    if (seconds) {
      return `Telegram rate limit reached. Try again in ${seconds} seconds.`;
    }

    return "Telegram rate limit reached. Please try again later.";
  }

  if (text.includes("AUTH_KEY_UNREGISTERED")) {
    return "Telegram authorization expired. Please use /connect again.";
  }

  if (text.includes("USER_DEACTIVATED")) {
    return "This Telegram account has been deactivated.";
  }

  if (text.includes("NETWORK_MIGRATE")) {
    return "Telegram requested a connection migration. Please try again.";
  }

  return text || "Telegram authorization failed.";
}

export { Api };
