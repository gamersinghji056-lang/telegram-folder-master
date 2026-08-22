import assert from "node:assert/strict";
import test from "node:test";

import { __testNormalizeBotUserId, createLinkedSessionGuard } from "../src/auth/linked-session.js";

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
