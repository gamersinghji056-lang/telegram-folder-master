import assert from "node:assert/strict";
import test from "node:test";

import { isLocalDevMode, resolveBotRuntimeConfig } from "../src/bot.js";
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
    },
  );
});
