import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import {
  localDevMiniAppBypassConfig,
  miniAppValidationBotToken,
  requireMiniUser,
  requireMiniUserOrLocalDevBypass,
} from "../src/mini-auth.js";

function signedInitData({ token, authDate = 1_800_000_000, user = { id: 1001 } }) {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: JSON.stringify(user),
  });

  const dataCheckString = Array.from(params.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  params.set("hash", hash);

  return params.toString();
}

test("production Mini App validation uses the production bot token", () => {
  const env = {};
  const telegramState = { botToken: "prod-token" };
  const initData = signedInitData({ token: "prod-token" });

  assert.equal(miniAppValidationBotToken({ env, telegramState }), "prod-token");
  assert.deepEqual(requireMiniUser(initData, { env, telegramState, now: 1_800_000_000_000 }), {
    botUserId: 1001,
    user: {
      id: 1001,
      username: null,
      firstName: null,
      lastName: null,
    },
  });
});

test("production Mini App validation rejects data signed by the dev bot token", () => {
  const env = {
    DEV_TELEGRAM_BOT_TOKEN: "dev-token",
  };
  const telegramState = { botToken: "prod-token" };
  const initData = signedInitData({ token: "dev-token" });

  assert.equal(miniAppValidationBotToken({ env, telegramState }), "prod-token");
  assert.throws(
    () => requireMiniUser(initData, { env, telegramState, now: 1_800_000_000_000 }),
    /Telegram Mini App initData validation failed/,
  );
});

test("local dev Mini App validation uses DEV_TELEGRAM_BOT_TOKEN", () => {
  const env = {
    LOCAL_DEV_MODE: "true",
    DEV_TELEGRAM_BOT_TOKEN: "dev-token",
  };
  const telegramState = { botToken: "prod-token" };
  const initData = signedInitData({
    token: "dev-token",
    user: {
      id: 1001,
      username: "dev_user",
      first_name: "Dev",
      last_name: "Tester",
    },
  });

  assert.equal(miniAppValidationBotToken({ env, telegramState }), "dev-token");
  assert.deepEqual(requireMiniUser(initData, { env, telegramState, now: 1_800_000_000_000 }), {
    botUserId: 1001,
    user: {
      id: 1001,
      username: "dev_user",
      firstName: "Dev",
      lastName: "Tester",
    },
  });
});

test("local dev Mini App validation rejects data signed by the production bot token", () => {
  const env = {
    LOCAL_DEV_MODE: "1",
    DEV_TELEGRAM_BOT_TOKEN: "dev-token",
  };
  const telegramState = { botToken: "prod-token" };
  const initData = signedInitData({ token: "prod-token" });

  assert.equal(miniAppValidationBotToken({ env, telegramState }), "dev-token");
  assert.throws(
    () => requireMiniUser(initData, { env, telegramState, now: 1_800_000_000_000 }),
    /Telegram Mini App initData validation failed/,
  );
});

test("production Mini App auth cannot enter local dev bypass", () => {
  const env = {
    LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    DEV_TELEGRAM_USER_ID: "1001",
  };

  assert.equal(localDevMiniAppBypassConfig(env).enabled, false);
  assert.throws(
    () => requireMiniUserOrLocalDevBypass("", { env, telegramState: { botToken: "prod-token" } }),
    /Telegram Mini App initData is missing/,
  );
});

test("LOCAL_DEV_MODE alone does not bypass Mini App initData validation", () => {
  const env = {
    LOCAL_DEV_MODE: "true",
    DEV_TELEGRAM_USER_ID: "1001",
  };

  assert.equal(localDevMiniAppBypassConfig(env).enabled, false);
  assert.throws(
    () => requireMiniUserOrLocalDevBypass("invalid", { env, telegramState: { botToken: "dev" } }),
    /Telegram Mini App initData hash is missing/,
  );
});

test("LOCAL_DEV_ALLOW_SESSION_BYPASS alone does not bypass Mini App initData validation", () => {
  const env = {
    LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    DEV_TELEGRAM_USER_ID: "1001",
  };

  assert.equal(localDevMiniAppBypassConfig(env).enabled, false);
  assert.throws(
    () => requireMiniUserOrLocalDevBypass("invalid", { env, telegramState: { botToken: "prod" } }),
    /Telegram Mini App initData hash is missing/,
  );
});

test("explicit local dev Mini App bypass uses DEV_TELEGRAM_USER_ID without browser trust", () => {
  const env = {
    LOCAL_DEV_MODE: "true",
    LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    DEV_TELEGRAM_USER_ID: "4242",
  };

  assert.equal(localDevMiniAppBypassConfig(env).enabled, true);
  assert.deepEqual(
    requireMiniUserOrLocalDevBypass("", { env, telegramState: { botToken: "prod-token" } }),
    {
      botUserId: 4242,
      localDevMiniAppBypass: true,
      testOnly: true,
      user: {
        id: 4242,
        username: "local_dev_bypass",
        firstName: "Local Dev",
        lastName: null,
      },
    },
  );
});
