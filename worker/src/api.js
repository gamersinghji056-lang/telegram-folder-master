/** Worker API client.
 *
 * Session actions are stored directly in Supabase.
 * Existing folder/job/config actions continue through APP_URL.
 */

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const SESSION_ACTIONS = new Set([
  "pullUserSession",
  "saveUserSession",
  "deleteUserSession",
]);

let cachedOwnerUserId = null;

function requireSupabase() {
  if (!SUPABASE_URL) {
    throw new Error("SUPABASE_URL is not set.");
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  }
}

async function parseResponse(res, label) {
  const text = await res.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `${label} returned non-JSON response (HTTP ${res.status}).`,
      );
    }
  }

  if (!res.ok) {
    throw new Error(
      data?.message ||
        data?.error ||
        data?.hint ||
        `${label} failed (HTTP ${res.status}).`,
    );
  }

  return data;
}

function supabaseHeaders(extra = {}) {
  requireSupabase();

  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...extra,
  };
}

/**
 * Resolve the existing app owner ID.
 *
 * We intentionally ask the existing APP_URL heartbeat endpoint because
 * WORKER_TOKEN already maps to the correct owner there.
 *
 * This avoids hardcoding any user ID.
 */
async function getOwnerUserId() {
  if (cachedOwnerUserId) return cachedOwnerUserId;

  if (!APP_URL) {
    throw new Error("APP_URL is not set.");
  }

  if (!WORKER_TOKEN) {
    throw new Error("WORKER_TOKEN is not set.");
  }

  const res = await fetch(`${APP_URL}/api/public/worker`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WORKER_TOKEN}`,
    },
    body: JSON.stringify({
      action: "heartbeat",
      payload: {},
    }),
  });

  const data = await parseResponse(res, "App heartbeat");

  const userId = String(data?.user_id || "").trim();

  if (!userId) {
    throw new Error(
      "Could not resolve worker owner user_id from APP_URL heartbeat.",
    );
  }

  cachedOwnerUserId = userId;
  return userId;
}

async function pullUserSession(payload) {
  requireSupabase();

  const ownerUserId = await getOwnerUserId();
  const botUserId = Number(payload?.bot_user_id);

  if (!Number.isSafeInteger(botUserId) || botUserId <= 0) {
    throw new Error("Invalid bot_user_id.");
  }

  const params = new URLSearchParams({
    select:
      "bot_user_id,bot_chat_id,phone,session_enc,telegram_account_id,telegram_username,first_name,last_name,is_premium,last_connected_at",
    user_id: `eq.${ownerUserId}`,
    bot_user_id: `eq.${botUserId}`,
    limit: "1",
  });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_user_sessions?${params}`,
    {
      method: "GET",
      headers: supabaseHeaders({
        Accept: "application/json",
      }),
    },
  );

  const rows = await parseResponse(res, "Supabase pullUserSession");

  return {
    ok: true,
    session: Array.isArray(rows) && rows.length ? rows[0] : null,
  };
}

async function saveUserSession(payload) {
  requireSupabase();

  const ownerUserId = await getOwnerUserId();
  const botUserId = Number(payload?.bot_user_id);

  if (!Number.isSafeInteger(botUserId) || botUserId <= 0) {
    throw new Error("Invalid bot_user_id.");
  }

  if (!payload?.session_enc) {
    throw new Error("session_enc is required.");
  }

  const body = {
    user_id: ownerUserId,
    bot_user_id: botUserId,
    bot_chat_id:
      payload.bot_chat_id === undefined ? null : payload.bot_chat_id,
    phone: payload.phone ?? null,
    session_enc: payload.session_enc,
    telegram_account_id: payload.telegram_account_id ?? null,
    telegram_username: payload.telegram_username ?? null,
    first_name: payload.first_name ?? null,
    last_name: payload.last_name ?? null,
    is_premium: Boolean(payload.is_premium),
    last_connected_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const params = new URLSearchParams({
    on_conflict: "user_id,bot_user_id",
  });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_user_sessions?${params}`,
    {
      method: "POST",
      headers: supabaseHeaders({
        Prefer: "resolution=merge-duplicates,return=minimal",
      }),
      body: JSON.stringify(body),
    },
  );

  await parseResponse(res, "Supabase saveUserSession");

  return {
    ok: true,
    bot_user_id: botUserId,
  };
}

async function deleteUserSession(payload) {
  requireSupabase();

  const ownerUserId = await getOwnerUserId();
  const botUserId = Number(payload?.bot_user_id);

  if (!Number.isSafeInteger(botUserId) || botUserId <= 0) {
    throw new Error("Invalid bot_user_id.");
  }

  const params = new URLSearchParams({
    user_id: `eq.${ownerUserId}`,
    bot_user_id: `eq.${botUserId}`,
  });

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/telegram_user_sessions?${params}`,
    {
      method: "DELETE",
      headers: supabaseHeaders({
        Prefer: "return=minimal",
      }),
    },
  );

  await parseResponse(res, "Supabase deleteUserSession");

  return { ok: true };
}

async function directSessionApi(action, payload) {
  if (action === "pullUserSession") {
    return pullUserSession(payload);
  }

  if (action === "saveUserSession") {
    return saveUserSession(payload);
  }

  if (action === "deleteUserSession") {
    return deleteUserSession(payload);
  }

  throw new Error(`Unsupported direct session action: ${action}`);
}

/**
 * Main worker API.
 *
 * Session persistence -> new Supabase directly.
 * Everything else -> existing app backend.
 */
export async function api(action, payload = {}) {
  if (SESSION_ACTIONS.has(action)) {
    return directSessionApi(action, payload);
  }

  if (!APP_URL) {
    throw new Error("APP_URL is not set.");
  }

  if (!WORKER_TOKEN) {
    throw new Error("WORKER_TOKEN is not set.");
  }

  const res = await fetch(`${APP_URL}/api/public/worker`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WORKER_TOKEN}`,
    },
    body: JSON.stringify({
      action,
      payload,
    }),
  });

  const data = await parseResponse(res, `App API "${action}"`);

  return data;
}

/** Minimal Telegram Bot API client. */
export function botApi(token) {
  const base = `https://api.telegram.org/bot${token}`;

  return async function call(method, params = {}, timeoutMs = 30000) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const data = await res.json().catch(() => null);

    if (!data || data.ok !== true) {
      throw new Error(
        data?.description ||
          `Bot API error on ${method} (HTTP ${res.status}).`,
      );
    }

    return data.result;
  };
}
