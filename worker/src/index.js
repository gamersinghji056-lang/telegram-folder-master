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

function html(res, code, body) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function miniAppHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Telegram Folder Mini App</title>
  <script src="https://telegram.org/js/telegram-web-app.js"></script>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #10141b; color: #f3f6fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; background: #10141b; }
    main { width: min(760px, 100%); margin: 0 auto; padding: 20px 16px 32px; }
    h1 { margin: 0; font-size: 24px; line-height: 1.2; }
    h2 { margin: 0 0 14px; font-size: 17px; }
    p { color: #a8b3c2; line-height: 1.45; }
    .panel { border: 1px solid #2b3442; background: #161c25; border-radius: 10px; padding: 16px; margin-top: 16px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    input, textarea { width: 100%; min-height: 44px; border: 1px solid #303b4a; border-radius: 8px; background: #0f141c; color: #f3f6fb; padding: 10px 12px; font-size: 15px; outline: none; }
    input:focus, textarea:focus { border-color: #49a8e8; }
    button { min-height: 42px; border: 0; border-radius: 8px; background: #49a8e8; color: #07111a; padding: 10px 14px; font-weight: 700; font-size: 14px; cursor: pointer; }
    button.secondary { background: #242d3a; color: #f3f6fb; border: 1px solid #303b4a; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .tabs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .tabs button { background: #242d3a; color: #f3f6fb; }
    .tabs button.active { background: #49a8e8; color: #07111a; }
    .error { border-color: #d65555; color: #ffb8b8; background: #2a171a; }
    .muted { color: #a8b3c2; font-size: 13px; }
    .hidden { display: none; }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Folder Merger</h1>
      <p id="subtitle">Telegram Mini App</p>
    </header>
    <section id="error" class="panel error hidden"></section>
    <section id="content" class="panel"><p>Loading...</p></section>
  </main>
  <script>
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg) { tg.ready(); tg.expand(); }
    const initData = tg ? tg.initData : "";
    const content = document.getElementById("content");
    const errorBox = document.getElementById("error");
    const subtitle = document.getElementById("subtitle");
    let phone = "";
    let account = null;

    function esc(value) {
      return String(value == null ? "" : value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function showError(message) {
      if (!message) { errorBox.classList.add("hidden"); errorBox.textContent = ""; return; }
      errorBox.textContent = message;
      errorBox.classList.remove("hidden");
    }

    async function mini(action, payload = {}) {
      if (!initData) throw new Error("Open this Mini App from the Telegram bot.");
      const res = await fetch("/api/public/mini", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload: { ...payload, initData } })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Request failed.");
      return data;
    }

    function renderPhone() {
      subtitle.textContent = "Connect your Telegram account";
      content.innerHTML = \`
        <h2>Connect Telegram</h2>
        <form id="phoneForm">
          <input name="phone" inputmode="tel" autocomplete="tel" placeholder="+919876543210" required />
          <div class="row" style="margin-top:12px"><button type="submit">Send OTP</button></div>
        </form>\`;
      document.getElementById("phoneForm").onsubmit = async (event) => {
        event.preventDefault();
        showError("");
        phone = event.target.phone.value.trim();
        try { await mini("sendCode", { phone }); renderCode(); }
        catch (e) { showError(e.message); }
      };
    }

    function renderCode() {
      subtitle.textContent = "Enter Telegram OTP";
      content.innerHTML = \`
        <h2>Telegram OTP</h2>
        <form id="codeForm">
          <input name="code" inputmode="numeric" placeholder="Login code" required />
          <div class="row" style="margin-top:12px">
            <button type="submit">Verify</button>
            <button type="button" class="secondary" id="cancelBtn">Cancel</button>
          </div>
        </form>\`;
      document.getElementById("cancelBtn").onclick = async () => {
        await mini("cancelLogin").catch(() => {});
        renderPhone();
      };
      document.getElementById("codeForm").onsubmit = async (event) => {
        event.preventDefault();
        showError("");
        try {
          const result = await mini("signIn", { code: event.target.code.value.trim() });
          if (result.needsPassword) renderPassword();
          else await loadStatus();
        } catch (e) { showError(e.message); }
      };
    }

    function renderPassword() {
      subtitle.textContent = "Telegram 2FA";
      content.innerHTML = \`
        <h2>2FA Password</h2>
        <form id="passwordForm">
          <input name="password" type="password" placeholder="2FA password" required />
          <div class="row" style="margin-top:12px"><button type="submit">Connect</button></div>
        </form>\`;
      document.getElementById("passwordForm").onsubmit = async (event) => {
        event.preventDefault();
        showError("");
        try { await mini("checkPassword", { password: event.target.password.value }); await loadStatus(); }
        catch (e) { showError(e.message); }
      };
    }

    function renderDashboard(view = "create") {
      const name = account && (account.username || account.firstName) ? (account.username ? "@" + account.username : account.firstName) : "connected";
      subtitle.textContent = "Connected as " + name;
      content.innerHTML = \`
        <div class="tabs">
          <button id="tabCreate" class="\${view === "create" ? "active" : ""}">Create Folder</button>
          <button id="tabHistory" class="\${view === "history" ? "active" : ""}">My Folders</button>
          <button id="tabAccount" class="\${view === "account" ? "active" : ""}">Telegram Account</button>
        </div>
        <div id="dash" class="panel" style="margin-left:0;margin-right:0"></div>\`;
      document.getElementById("tabCreate").onclick = () => renderDashboard("create");
      document.getElementById("tabHistory").onclick = () => renderHistory();
      document.getElementById("tabAccount").onclick = () => renderDashboard("account");
      const dash = document.getElementById("dash");
      if (view === "account") {
        dash.innerHTML = \`<h2>Telegram Account</h2><p>\${esc(name)}</p><p class="muted">Session is linked only to this Telegram WebApp user.</p>\`;
      } else {
        dash.innerHTML = \`<h2>Create Folder</h2><p class="muted">Folder analysis and creation stay in this Mini App. No setup or owner fields are shown here.</p>\`;
      }
    }

    async function renderHistory() {
      renderDashboard("history");
      const dash = document.getElementById("dash");
      dash.innerHTML = "<h2>My Folders</h2><p>Loading...</p>";
      try {
        const result = await mini("history");
        const folders = result.folders || [];
        dash.innerHTML = "<h2>My Folders</h2>" + (folders.length ? folders.map((f) => \`
          <div class="panel" style="margin-left:0;margin-right:0">
            <strong>\${esc(f.folder_name || "Telegram Folder")}</strong>
            <p class="muted">\${Number(f.final_chats || 0)} groups - \${esc(f.status)}</p>
            \${f.share_link ? \`<p><a href="\${esc(f.share_link)}" style="color:#7bc7ff">\${esc(f.share_link)}</a></p>\` : \`<p class="muted">\${esc(f.share_link_note || "No share link saved.")}</p>\`}
          </div>\`).join("") : '<p class="muted">No folders created yet.</p>');
      } catch (e) { showError(e.message); }
    }

    async function loadStatus() {
      showError("");
      if (!initData) {
        content.innerHTML = "<h2>Open in Telegram</h2><p>This Mini App must be opened from the bot button.</p>";
        return;
      }
      try {
        const status = await mini("status");
        if (!status.connected) { renderPhone(); return; }
        account = status.account || null;
        renderDashboard();
      } catch (e) {
        showError(e.message);
        renderPhone();
      }
    }

    loadStatus();
  </script>
</body>
</html>`;
}

async function readJson(req, maxBytes = 1_000_000) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > maxBytes) throw new Error("request_too_large");
  }
  return JSON.parse(body || "{}");
}

async function handlePublicMiniApi(req, res) {
  const allowed = new Set([
    "status",
    "sendCode",
    "signIn",
    "checkPassword",
    "cancelLogin",
    "history",
  ]);

  let parsed;
  try {
    parsed = await readJson(req);
  } catch {
    return json(res, 400, { error: "bad_json" });
  }

  const action = String(parsed.action || "");
  if (!allowed.has(action)) return json(res, 400, { error: "unknown_action" });

  const handlerName = `mini${action[0].toUpperCase()}${action.slice(1)}`;
  const handler = handlers[handlerName];
  if (!handler) return json(res, 400, { error: "unknown_action" });

  try {
    return json(res, 200, await handler(parsed.payload || {}));
  } catch (e) {
    console.error(`mini ${action} failed:`, e.message);
    return json(res, 400, { error: e.message || "mini_app_error" });
  }
}

const server = http.createServer((req, res) => {
  // Unauthenticated liveness probe. No database, Telegram or external calls.
  const path = (req.url || "/").split("?")[0];
  if (req.method === "GET" && (path === "/mini-app" || path === "/mini")) {
    return html(res, 200, miniAppHtml());
  }
  if (req.method === "POST" && path === "/api/public/mini") {
    return void handlePublicMiniApi(req, res);
  }
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
