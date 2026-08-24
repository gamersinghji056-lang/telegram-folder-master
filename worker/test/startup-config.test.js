import assert from "node:assert/strict";
import test from "node:test";

import { loadStartupConfig } from "../src/startup-config.js";

function appApiFetchError({ code = "UND_ERR_CONNECT_TIMEOUT", detail = "connect timeout" } = {}) {
  const error = new Error('App API "pull" fetch failed.');
  error.name = "AppApiFetchError";
  error.action = "pull";
  error.code = code;
  error.detail = detail;
  return error;
}

test("startup config load succeeds with one pull attempt", async () => {
  let calls = 0;

  const result = await loadStartupConfig({
    load: async () => {
      calls += 1;
    },
    sleep: async () => {},
  });

  assert.deepEqual(result, { ok: true, attempts: 1 });
  assert.equal(calls, 1);
});

test("startup config load retries transient pull fetch failure then succeeds", async () => {
  let calls = 0;
  const delays = [];

  const result = await loadStartupConfig({
    env: { LOCAL_DEV_MODE: "true" },
    logger: { error: () => {} },
    sleep: async (ms) => delays.push(ms),
    load: async () => {
      calls += 1;
      if (calls === 1) throw appApiFetchError();
    },
  });

  assert.deepEqual(result, { ok: true, attempts: 2 });
  assert.equal(calls, 2);
  assert.deepEqual(delays, [150]);
});

test("local dev startup config logs safe diagnostic details", async () => {
  const lines = [];

  await assert.rejects(
    () =>
      loadStartupConfig({
        env: { LOCAL_DEV_MODE: "true" },
        logger: { error: (line) => lines.push(line) },
        sleep: async () => {},
        maxAttempts: 1,
        load: async () => {
          throw appApiFetchError({
            detail: "connect timeout using Bearer secret-token and bot123:secret",
          });
        },
      }),
    /App API "pull" fetch failed/,
  );

  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[DEV_CONFIG_ERROR\] stage=load_config_pull/);
  assert.match(lines[0], /code=UND_ERR_CONNECT_TIMEOUT/);
  assert.doesNotMatch(lines[0], /secret-token/);
  assert.doesNotMatch(lines[0], /bot123:secret/);
});

test("production startup config remains secret-safe and does not emit dev diagnostics", async () => {
  const lines = [];

  await assert.rejects(
    () =>
      loadStartupConfig({
        env: {},
        logger: { error: (line) => lines.push(line) },
        sleep: async () => {},
        maxAttempts: 1,
        load: async () => {
          throw appApiFetchError({ detail: "connect timeout with Bearer secret-token" });
        },
      }),
    /App API "pull" fetch failed/,
  );

  assert.deepEqual(lines, []);
});

test("startup config does not duplicate load when the first pull succeeds", async () => {
  const calls = [];

  await loadStartupConfig({
    load: async () => calls.push("pull"),
    sleep: async () => {},
    maxAttempts: 3,
  });

  assert.deepEqual(calls, ["pull"]);
});
