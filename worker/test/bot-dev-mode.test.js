import assert from "node:assert/strict";
import test from "node:test";

import {
  isLocalDevMode,
  miniAppUrlMissingMessage,
  resolveBotRuntimeConfig,
  resolveMiniAppUrl,
} from "../src/bot.js";
import { configuredRoleProviders } from "../src/ai/model-router.js";

test("production bot token behavior remains unchanged", () => {
  const runtime = resolveBotRuntimeConfig({
    env: {},
    telegramState: {
      botToken: "prod-token",
    },
  });

  assert.equal(runtime.botToken, "prod-token");
  assert.equal(runtime.localDevMode, false);
  assert.equal(runtime.shouldSaveBotUsername, true);
});

test("dev bot token is ignored unless local dev mode is enabled", () => {
  const runtime = resolveBotRuntimeConfig({
    env: {
      DEV_TELEGRAM_BOT_TOKEN: "dev-token",
    },
    telegramState: {
      botToken: "prod-token",
    },
  });

  assert.equal(runtime.botToken, "prod-token");
  assert.equal(runtime.localDevMode, false);
  assert.equal(runtime.shouldSaveBotUsername, true);
});

test("dev bot token is used only in local dev mode", () => {
  const runtime = resolveBotRuntimeConfig({
    env: {
      LOCAL_DEV_MODE: "true",
      DEV_TELEGRAM_BOT_TOKEN: "dev-token",
    },
    telegramState: {
      botToken: "prod-token",
    },
  });

  assert.equal(isLocalDevMode({ LOCAL_DEV_MODE: "true" }), true);
  assert.equal(runtime.botToken, "dev-token");
  assert.equal(runtime.localDevMode, true);
});

test("local dev mode does not overwrite production bot config", () => {
  const runtime = resolveBotRuntimeConfig({
    env: {
      LOCAL_DEV_MODE: "1",
      DEV_TELEGRAM_BOT_TOKEN: "dev-token",
    },
    telegramState: {
      botToken: "prod-token",
    },
  });

  assert.equal(runtime.shouldSaveBotUsername, false);
});

test("local dev mode without dev bot token falls back to production behavior", () => {
  const runtime = resolveBotRuntimeConfig({
    env: {
      LOCAL_DEV_MODE: "true",
    },
    telegramState: {
      botToken: "prod-token",
    },
  });

  assert.equal(runtime.botToken, "prod-token");
  assert.equal(runtime.localDevMode, false);
  assert.equal(runtime.shouldSaveBotUsername, true);
});

test("AI provider config still activates role routing", () => {
  assert.deepEqual(
    configuredRoleProviders({
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "qwen2.5-coder:3b",
    }),
    {
      fast: "openai-compatible",
      general: "openai-compatible",
      reasoning: "openai-compatible",
      coding: "openai-compatible",
      embedding: "openai-compatible",
    },
  );
});

test("production Mini App URL may use existing production fallback", () => {
  assert.equal(
    resolveMiniAppUrl({ env: {} }),
    "https://telegram-folder-master-production.up.railway.app/mini-app",
  );
});

test("production Mini App URL still honors explicit Mini App URL and base URL", () => {
  assert.equal(
    resolveMiniAppUrl({
      env: {
        MINI_APP_URL: "https://mini.example.test/mini-app",
      },
    }),
    "https://mini.example.test/mini-app",
  );
  assert.equal(
    resolveMiniAppUrl({
      env: {
        MINI_APP_BASE_URL: "https://worker.example.test/",
      },
    }),
    "https://worker.example.test/mini-app",
  );
});

test("local dev Mini App URL never silently uses Railway production fallback", () => {
  assert.equal(
    resolveMiniAppUrl({
      env: {
        LOCAL_DEV_MODE: "true",
        MINI_APP_BASE_URL: "https://worker.example.test",
        PUBLIC_URL: "https://public.example.test",
        RAILWAY_PUBLIC_DOMAIN: "railway.example.test",
        APP_URL: "https://app.example.test",
      },
    }),
    "",
  );
  assert.match(
    miniAppUrlMissingMessage({
      env: {
        LOCAL_DEV_MODE: "true",
      },
    }),
    /Set MINI_APP_URL/,
  );
});

test("local dev Mini App URL uses explicit MINI_APP_URL only", () => {
  assert.equal(
    resolveMiniAppUrl({
      env: {
        LOCAL_DEV_MODE: "true",
        APP_URL: "https://production.example.test",
        MINI_APP_URL: "https://local-tunnel.example.test/mini-app",
      },
    }),
    "https://local-tunnel.example.test/mini-app",
  );
});
