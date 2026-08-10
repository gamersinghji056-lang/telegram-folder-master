import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";

import { api } from "./api.js";
import { encrypt, decrypt } from "./crypto.js";

/**
 * Holds the authorized Telegram USER session (MTProto).
 * The bot token is a separate thing and is never used here.
 */
export const state = {
  apiId: null,
  apiHash: null,
  botToken: null,
  phone: null,
  session: null,
  client: null,
  login: null, // { client, phone, phoneCodeHash }
  me: null,
};

function opts() {
  return { connectionRetries: 5, useWSS: false, autoReconnect: true, requestRetries: 2 };
}

export async function loadConfig() {
  const { config } = await api("pull");
  if (!config) return;
  state.apiId = config.api_id_enc ? Number(decrypt(config.api_id_enc)) : null;
  state.apiHash = config.api_hash_enc ? decrypt(config.api_hash_enc) : null;
  state.botToken = config.bot_token_enc ? decrypt(config.bot_token_enc) : null;
  state.session = config.session_enc ? decrypt(config.session_enc) : null;
  state.phone = config.phone || null;
}

export async function saveCredentials({ apiId, apiHash, botToken }) {
  const patch = {};
  if (apiId) {
    state.apiId = Number(apiId);
    patch.api_id_enc = encrypt(String(apiId));
  }
  if (apiHash) {
    state.apiHash = apiHash;
    patch.api_hash_enc = encrypt(apiHash);
  }
  if (botToken) {
    state.botToken = botToken;
    patch.bot_token_enc = encrypt(botToken);
  }
  if (Object.keys(patch).length) await api("saveConfig", patch);
}

/** Returns a connected, authorized user client — or throws a clear reason. */
export async function getClient() {
  if (!state.apiId || !state.apiHash) {
    throw new Error("Telegram API ID / API hash are not configured.");
  }
  if (!state.session) {
    throw new Error("Telegram user account is not connected. Finish setup on the website.");
  }
  if (state.client && state.client.connected) return state.client;

  const client = new TelegramClient(
    new StringSession(state.session),
    state.apiId,
    state.apiHash,
    opts(),
  );
  client.setLogLevel?.("error");
  await client.connect();
  if (!(await client.isUserAuthorized())) {
    state.client = null;
    throw new Error("Telegram session expired. Reconnect your account on the website.");
  }
  state.client = client;
  state.me = await client.getMe();
  return client;
}

export async function sendCode(phone) {
  if (!state.apiId || !state.apiHash) {
    throw new Error("Save your Telegram API ID and API hash first.");
  }
  if (state.login?.client) {
    await state.login.client.disconnect().catch(() => {});
  }
  const client = new TelegramClient(new StringSession(""), state.apiId, state.apiHash, opts());
  client.setLogLevel?.("error");
  await client.connect();
  const result = await client.sendCode({ apiId: state.apiId, apiHash: state.apiHash }, phone);
  state.login = { client, phone, phoneCodeHash: result.phoneCodeHash };
  return { ok: true, needsCode: true };
}

export async function signInWithCode(code) {
  if (!state.login) throw new Error("Request a login code first.");
  const { client, phone, phoneCodeHash } = state.login;
  try {
    await client.invoke(
      new Api.auth.SignIn({ phoneNumber: phone, phoneCodeHash, phoneCode: code }),
    );
  } catch (e) {
    const msg = e?.errorMessage || e?.message || "";
    if (msg.includes("SESSION_PASSWORD_NEEDED")) return { ok: true, needsPassword: true };
    throw new Error(friendlyAuthError(msg));
  }
  return finishLogin();
}

export async function signInWithPassword(password) {
  if (!state.login) throw new Error("Request a login code first.");
  const { client } = state.login;
  try {
    const pwd = await client.invoke(new Api.account.GetPassword());
    await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(pwd, password) }));
  } catch (e) {
    throw new Error(friendlyAuthError(e?.errorMessage || e?.message || ""));
  }
  return finishLogin();
}

async function finishLogin() {
  const { client, phone } = state.login;
  const session = client.session.save();
  const me = await client.getMe();
  state.session = session;
  state.client = client;
  state.me = me;
  state.phone = phone;
  state.login = null;
  await api("saveConfig", {
    session_enc: encrypt(session),
    phone,
    telegram_user_id: Number(me.id),
    telegram_username: me.username || null,
    is_premium: Boolean(me.premium),
  });
  return {
    ok: true,
    message: `Connected as ${me.username ? "@" + me.username : me.firstName || "your account"}.`,
  };
}

export async function logout() {
  try {
    const c = await getClient();
    await c.invoke(new Api.auth.LogOut());
  } catch {
    /* session may already be dead — clearing it is still correct */
  }
  state.session = null;
  state.client = null;
  state.me = null;
  await api("saveConfig", { session_enc: null, telegram_user_id: null, is_premium: false });
  return { ok: true, message: "Telegram account disconnected." };
}

function friendlyAuthError(msg) {
  if (msg.includes("PHONE_CODE_INVALID")) return "That login code is not correct.";
  if (msg.includes("PHONE_CODE_EXPIRED")) return "The login code expired. Request a new one.";
  if (msg.includes("PASSWORD_HASH_INVALID")) return "That 2FA password is not correct.";
  if (msg.includes("PHONE_NUMBER_INVALID")) return "That phone number is not valid.";
  if (msg.includes("FLOOD_WAIT")) return "Telegram rate limit reached. Try again later.";
  return msg || "Telegram authorization failed.";
}

/** Sleeps through a Telegram FLOOD_WAIT and reports it. */
export async function withFloodWait(fn, onWait) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      const seconds = e?.seconds ?? e?.errorMessage?.match?.(/FLOOD_WAIT_(\d+)/)?.[1];
      if (seconds && Number(seconds) <= 3600) {
        await onWait?.(Number(seconds));
        await new Promise((r) => setTimeout(r, (Number(seconds) + 2) * 1000));
        continue;
      }
      throw e;
    }
  }
  throw new Error("Telegram rate limit did not clear.");
}

export { Api };