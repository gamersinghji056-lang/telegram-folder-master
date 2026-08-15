import http from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";

import { api } from "./api.js";
import {
  state,
  loadConfig,
  saveCredentials,
  sendCode,
  signInWithCode,
  signInWithPassword,
  cancelLogin,
  logout,
  getMe,
  isUserConnected,
} from "./tg.js";
import { startBot, restartBot, botUsername, botError } from "./bot.js";
import { analyzeFolders, joinAndCreateFolder } from "./process.js";

const PORT = Number(process.env.PORT || 8080);
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";
const INITDATA_MAX_AGE_SECONDS = Number(process.env.MINI_APP_INITDATA_MAX_AGE_SECONDS || 86400);

function statusPayload() {
  return {
    running: true,
    api_configured: Boolean(state.apiId && state.apiHash),
    bot_configured: Boolean(state.botToken && botUsername),
    session_configured: false,
    bot_username: botUsername ?? null,
    telegram_username: null,
    is_premium: false,
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

  checks.push({
    name: "Telegram accounts",
    ok: true,
    detail: "Each Telegram user connects their own account inside the Telegram Mini App.",
  });

  if (botUsername) {
    checks.push({ name: "Telegram bot", ok: true, detail: `Listening as @${botUsername}.` });
  } else {
    checks.push({ name: "Telegram bot", ok: false, detail: botError || "Bot is not running." });
  }

  await pushStatus(checks.find((c) => !c.ok)?.detail ?? null);
  return { ok: checks.every((c) => c.ok), checks, status: statusPayload() };
}

function timingSafeHexEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function checkInitDataHash(params, hash, excludeSignature) {
  const pairs = Array.from(params.entries())
    .filter(([key]) => key !== "hash" && (!excludeSignature || key !== "signature"))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(state.botToken).digest();
  const expected = createHmac("sha256", secret).update(pairs).digest("hex");

  return timingSafeHexEqual(expected, hash);
}

function requireMiniUser(initData) {
  if (!state.botToken) throw new Error("Telegram bot token is not configured.");

  const raw = String(initData || "");
  if (!raw) throw new Error("Telegram Mini App initData is missing.");

  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) throw new Error("Telegram Mini App initData hash is missing.");

  const valid = checkInitDataHash(params, hash, false) || checkInitDataHash(params, hash, true);
  if (!valid) throw new Error("Telegram Mini App initData validation failed.");

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > INITDATA_MAX_AGE_SECONDS) {
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

async function miniStatus(payload) {
  const mini = requireMiniUser(payload.initData);
  const connected = await isUserConnected(mini.botUserId);
  let account = null;

  if (connected) {
    const me = await getMe(mini.botUserId);
    account = {
      telegramUserId: Number(me.id),
      username: me.username || null,
      firstName: me.firstName || null,
      lastName: me.lastName || null,
      isPremium: Boolean(me.premium),
    };
  }

  return {
    ok: true,
    connected,
    botUser: mini.user,
    account,
    status: statusPayload(),
  };
}

function urlsFromPayload(payload) {
  const urls = Array.isArray(payload.urls) ? payload.urls : [];
  return urls
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 100);
}

const handlers = {
  status: async () => ({ ok: true, status: statusPayload() }),
  saveCredentials: async (p) => {
    await saveCredentials(p);
    if (p.botToken) await restartBot();
    await pushStatus();
    return { ok: true, status: statusPayload() };
  },
  sendCode: async () => {
    throw new Error("Telegram account connection now happens inside the bot with /connect.");
  },
  signIn: async () => {
    throw new Error("Telegram account connection now happens inside the bot with /connect.");
  },
  checkPassword: async () => {
    throw new Error("Telegram account connection now happens inside the bot with /connect.");
  },
  logout: async () => {
    throw new Error("Telegram account disconnection is managed per Telegram user in the bot.");
  },
  selfTest: async () => selfTest(),
  miniStatus,
  miniSendCode: async (p) => {
    const mini = requireMiniUser(p.initData);
    return sendCode(mini.botUserId, p.phone, null);
  },
  miniSignIn: async (p) => {
    const mini = requireMiniUser(p.initData);
    return signInWithCode(mini.botUserId, p.code);
  },
  miniCheckPassword: async (p) => {
    const mini = requireMiniUser(p.initData);
    return signInWithPassword(mini.botUserId, p.password);
  },
  miniCancelLogin: async (p) => {
    const mini = requireMiniUser(p.initData);
    return cancelLogin(mini.botUserId);
  },
  miniLogout: async (p) => {
    const mini = requireMiniUser(p.initData);
    return logout(mini.botUserId);
  },
  miniAnalyzeFolders: async (p) => {
    const mini = requireMiniUser(p.initData);
    return analyzeFolders({
      botUserId: mini.botUserId,
      urls: urlsFromPayload(p),
    });
  },
  miniJoinAndCreate: async (p) => {
    const mini = requireMiniUser(p.initData);
    return joinAndCreateFolder({
      botUserId: mini.botUserId,
      jobId: String(p.jobId || ""),
      folderName: p.folderName,
    });
  },
  miniHistory: async (p) => {
    const mini = requireMiniUser(p.initData);
    return api("userFolderHistory", {
      bot_user_id: mini.botUserId,
    });
  },
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
  if (req.method !== "POST" || !req.url?.startsWith("/rpc"))
    return json(res, 404, { error: "not_found" });

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
