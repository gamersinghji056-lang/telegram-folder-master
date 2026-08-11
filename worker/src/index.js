import http from "node:http";

import { api } from "./api.js";
import { state, loadConfig, saveCredentials, sendCode, signInWithCode, signInWithPassword, logout, getClient } from "./tg.js";
import { startBot, restartBot, botUsername, botError } from "./bot.js";

const PORT = Number(process.env.PORT || 8080);
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

function statusPayload() {
  return {
    running: true,
    api_configured: Boolean(state.apiId && state.apiHash),
    bot_configured: Boolean(state.botToken && botUsername),
    session_configured: Boolean(state.session && state.me),
    bot_username: botUsername ?? null,
    telegram_username: state.me?.username ?? null,
    is_premium: Boolean(state.me?.premium),
  };
}

async function pushStatus(lastError = null) {
  try {
    const s = statusPayload();
    await api("setStatus", {
      api_configured: s.api_configured,
      bot_configured: s.bot_configured,
      session_configured: s.session_configured,
      bot_username: s.bot_username,
      telegram_username: s.telegram_username,
      is_premium: s.is_premium,
      last_error: lastError,
    });
  } catch (e) {
    console.error("status push failed:", e.message);
  }
}

/** Real end-to-end test. Nothing is reported green unless it actually passed. */
async function selfTest() {
  const checks = [];
  checks.push({ name: "Backend", ok: true, detail: "Worker process is running." });

  try {
    await api("heartbeat");
    checks.push({ name: "Database", ok: true, detail: "Connected to the app database." });
  } catch (e) {
    checks.push({ name: "Database", ok: false, detail: e.message });
  }

  if (state.apiId && state.apiHash) {
    checks.push({ name: "Telegram API", ok: true, detail: "API ID and hash are stored." });
  } else {
    checks.push({ name: "Telegram API", ok: false, detail: "API ID / API hash missing." });
  }

  let me = null;
  try {
    const client = await getClient();
    me = await client.getMe();
    checks.push({
      name: "Telegram account",
      ok: true,
      detail: me.username ? `Authorized as @${me.username}.` : "Authorized.",
    });
    checks.push({ name: "Telegram session", ok: true, detail: "Session is valid and connected." });
  } catch (e) {
    checks.push({ name: "Telegram account", ok: false, detail: e.message });
    checks.push({ name: "Telegram session", ok: false, detail: "No valid session." });
  }

  if (botUsername) {
    checks.push({ name: "Telegram bot", ok: true, detail: `Listening as @${botUsername}.` });
  } else {
    checks.push({ name: "Telegram bot", ok: false, detail: botError || "Bot is not running." });
  }

  await pushStatus(checks.find((c) => !c.ok)?.detail ?? null);
  return { ok: checks.every((c) => c.ok), checks, status: statusPayload() };
}

const handlers = {
  status: async () => ({ ok: true, status: statusPayload() }),
  saveCredentials: async (p) => {
    await saveCredentials(p);
    if (p.botToken) await restartBot();
    await pushStatus();
    return { ok: true, status: statusPayload() };
  },
  sendCode: async (p) => sendCode(p.phone),
  signIn: async (p) => {
    const r = await signInWithCode(p.code);
    if (!r.needsPassword) await pushStatus();
    return { ...r, status: statusPayload() };
  },
  checkPassword: async (p) => {
    const r = await signInWithPassword(p.password);
    await pushStatus();
    return { ...r, status: statusPayload() };
  },
  logout: async () => {
    const r = await logout();
    await pushStatus();
    return { ...r, status: statusPayload() };
  },
  selfTest: async () => selfTest(),
};

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(payload);
}

const server = http.createServer((req, res) => {
  // Unauthenticated liveness probe. No database, Telegram or external calls.
  const path = (req.url || "/").split("?")[0];
  if (req.method === "GET" && (path === "/health" || path === "/")) {
    return json(res, 200, { ok: true });
  }
  if (req.method !== "POST" || !req.url?.startsWith("/rpc")) return json(res, 404, { error: "not_found" });

  const auth = req.headers["authorization"] || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!WORKER_TOKEN || token !== WORKER_TOKEN) return json(res, 401, { error: "unauthorized" });

  let body = "";
  req.on("data", (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on("end", async () => {
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      return json(res, 400, { error: "bad_json" });
    }
    const handler = handlers[parsed.action];
    if (!handler) return json(res, 400, { error: "unknown_action" });
    try {
      json(res, 200, await handler(parsed.payload || {}));
    } catch (e) {
      console.error(`rpc ${parsed.action} failed:`, e.message);
      json(res, 400, { error: e.message || "worker_error" });
    }
  });
});

// Never let a background failure kill the process: the health check must stay up.
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e?.message || e));
process.on("uncaughtException", (e) => console.error("uncaughtException:", e?.message || e));

async function init() {
  const missing = ["APP_URL", "WORKER_TOKEN", "ENCRYPTION_KEY"].filter((v) => !process.env[v]);
  if (missing.length) {
    console.error(
      `Missing environment variables: ${missing.join(", ")}. ` +
        "The worker stays up and healthy, but Telegram features are disabled until they are set.",
    );
    return;
  }
  try {
    await loadConfig();
  } catch (e) {
    console.error("could not load config:", e.message);
  }
  try {
    if (state.session) await getClient();
  } catch (e) {
    console.error("session not usable:", e.message);
  }
  await startBot();
  await pushStatus();

  setInterval(() => {
    api("heartbeat").catch(() => {});
  }, 60_000);
}

// Bind to 0.0.0.0 on the platform-provided PORT *before* any slow init work,
// so Railway's health check succeeds immediately.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`worker listening on 0.0.0.0:${PORT}`);
  init().catch((e) => console.error("init failed:", e?.message || e));
});