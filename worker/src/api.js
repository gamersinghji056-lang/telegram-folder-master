/** Worker API client.
 *
 * The worker authenticates to the app with WORKER_TOKEN.
 * The app server owns Supabase admin access for config, sessions, jobs and history.
 */

const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

async function parseResponse(res, label) {
  const text = await res.text();

  let data = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${label} returned non-JSON response (HTTP ${res.status}).`);
    }
  }

  if (!res.ok) {
    throw new Error(
      data?.message || data?.error || data?.hint || `${label} failed (HTTP ${res.status}).`,
    );
  }

  return data;
}

export async function api(action, payload = {}) {
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

  return parseResponse(res, `App API "${action}"`);
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
      throw new Error(data?.description || `Bot API error on ${method} (HTTP ${res.status}).`);
    }

    return data.result;
  };
}
