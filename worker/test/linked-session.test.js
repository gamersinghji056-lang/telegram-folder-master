import assert from "node:assert/strict";
import test from "node:test";

import {
  __testLocalDevSessionBypassConfig,
  __testNormalizeBotUserId,
  __testResetLocalDevSessionBypassWarning,
  createLinkedSessionGuard,
} from "../src/auth/linked-session.js";

test("requireLinkedSession allows a valid authorized linked Telegram session", async () => {
  const client = {
    isUserAuthorized: async () => true,
  };
  const requireLinkedSession = createLinkedSessionGuard({
    getClient: async (botUserId) => {
      assert.equal(botUserId, 123);
      return client;
    },
  });

  const result = await requireLinkedSession("123");

  assert.equal(result.botUserId, 123);
  assert.equal(result.client, client);
});

test("requireLinkedSession rejects a disconnected linked Telegram session", async () => {
  const requireLinkedSession = createLinkedSessionGuard({
    getClient: async () => ({
      isUserAuthorized: async () => false,
    }),
  });

  await assert.rejects(() => requireLinkedSession(123), /Telegram account is not connected yet/);
});

test("requireLinkedSession rejects a missing linked Telegram session", async () => {
  const requireLinkedSession = createLinkedSessionGuard({
    getClient: async () => {
      throw new Error("Your Telegram account is not connected yet. Open the Mini App first.");
    },
  });

  await assert.rejects(() => requireLinkedSession(123), /Telegram account is not connected yet/);
});

test("requireLinkedSession rejects invalid botUserId values", async () => {
  assert.throws(() => __testNormalizeBotUserId(0), /Invalid Telegram bot user ID/);
  assert.throws(() => __testNormalizeBotUserId(-1), /Invalid Telegram bot user ID/);
  assert.throws(() => __testNormalizeBotUserId("not-a-number"), /Invalid Telegram bot user ID/);

  const requireLinkedSession = createLinkedSessionGuard({
    getClient: async () => {
      throw new Error("should not load a client for invalid IDs");
    },
  });

  await assert.rejects(() => requireLinkedSession("bad"), /Invalid Telegram bot user ID/);
});

test("production cannot use local dev linked-session bypass", async () => {
  let loaded = false;
  const requireLinkedSession = createLinkedSessionGuard({
    env: {
      LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    },
    getClient: async () => {
      loaded = true;
      return {
        isUserAuthorized: async () => true,
      };
    },
  });

  const result = await requireLinkedSession(123);

  assert.equal(loaded, true);
  assert.equal(result.botUserId, 123);
  assert.equal(result.localDevSessionBypass, undefined);
  assert.deepEqual(
    __testLocalDevSessionBypassConfig({
      LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    }),
    {
      enabled: false,
      localDevMode: false,
      bypassAllowed: true,
      restrictedUserId: null,
    },
  );
});

test("LOCAL_DEV_MODE alone cannot use linked-session bypass", async () => {
  let loaded = false;
  const requireLinkedSession = createLinkedSessionGuard({
    env: {
      LOCAL_DEV_MODE: "true",
    },
    getClient: async () => {
      loaded = true;
      return {
        isUserAuthorized: async () => true,
      };
    },
  });

  const result = await requireLinkedSession(123);

  assert.equal(loaded, true);
  assert.equal(result.botUserId, 123);
  assert.equal(result.localDevSessionBypass, undefined);
});

test("linked-session bypass works only when both local dev flags are enabled", async () => {
  __testResetLocalDevSessionBypassWarning();

  let loaded = false;
  const warnings = [];
  const requireLinkedSession = createLinkedSessionGuard({
    env: {
      LOCAL_DEV_MODE: "true",
      LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    },
    logger: {
      warn: (message) => warnings.push(message),
    },
    getClient: async () => {
      loaded = true;
      throw new Error("real client lookup should not run");
    },
  });

  const result = await requireLinkedSession("123");

  assert.equal(loaded, false);
  assert.equal(result.botUserId, 123);
  assert.equal(result.localDevSessionBypass, true);
  assert.equal(result.testOnly, true);
  assert.equal(result.client.__localDevSessionBypass, true);
  assert.equal(await result.client.isUserAuthorized(), true);
  await assert.rejects(
    () => result.client.invoke({}),
    /cannot perform Telegram MTProto operations/,
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /TEST ONLY/);
});

test("linked-session bypass can be restricted to DEV_TELEGRAM_USER_ID", async () => {
  __testResetLocalDevSessionBypassWarning();

  const requireLinkedSession = createLinkedSessionGuard({
    env: {
      LOCAL_DEV_MODE: "true",
      LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
      DEV_TELEGRAM_USER_ID: "123",
    },
    logger: {
      warn: () => {},
    },
    getClient: async () => {
      throw new Error("real client lookup should not run");
    },
  });

  const result = await requireLinkedSession(123);
  assert.equal(result.localDevSessionBypass, true);

  await assert.rejects(() => requireLinkedSession(456), /restricted to DEV_TELEGRAM_USER_ID/);
});
