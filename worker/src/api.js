/** Thin client for the Lovable app's worker API. */
const APP_URL = (process.env.APP_URL || "").replace(/\/+$/, "");
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

export async function api(action, payload = {}) {
  if (!APP_URL) throw new Error("APP_URL is not set.");
  if (!WORKER_TOKEN) throw new Error("WORKER_TOKEN is not set.");
  const res = await fetch(`${APP_URL}/api/public/worker`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${WORKER_TOKEN}`,
    },
    body: JSON.stringify({ action, payload }),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`App API returned non-JSON (HTTP ${res.status}) for "${action}".`);
  }
  if (!res.ok) throw new Error(data.error || `App API error (HTTP ${res.status}) for "${action}".`);
  return data;
}

/** Minimal Telegram Bot API client (no dependencies). */
export function botApi(token) {
  const base = `https://api.telegram.org/bot${token}`;
  return async function call(method, params = {}, timeoutMs = 30000) {
    const res = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
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