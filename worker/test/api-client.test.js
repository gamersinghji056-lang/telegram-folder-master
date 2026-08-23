import assert from "node:assert/strict";
import test from "node:test";

const API_URL = new URL("../src/api.js", import.meta.url).href;

async function importApiWithEnv(env) {
  const previousEnv = { ...process.env };

  for (const key of ["APP_URL", "WORKER_TOKEN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
    delete process.env[key];
  }

  Object.assign(process.env, env);

  const mod = await import(`${API_URL}?t=${Date.now()}-${Math.random()}`);

  for (const key of Object.keys(process.env)) {
    delete process.env[key];
  }
  Object.assign(process.env, previousEnv);

  return mod;
}

function mockFetch({ status = 200, body = { ok: true } } = {}) {
  const calls = [];

  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };

  return { calls, fetchImpl };
}

async function withFetch(fetchImpl, fn) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;

  try {
    return await fn();
  } finally {
    globalThis.fetch = previousFetch;
  }
}

test("pullUserSession uses APP_URL worker API", async () => {
  const { api } = await importApiWithEnv({
    APP_URL: "https://app.example.test/",
    WORKER_TOKEN: "worker-token",
  });
  const { calls, fetchImpl } = mockFetch({ body: { ok: true, session: null } });

  await withFetch(fetchImpl, () => api("pullUserSession", { bot_user_id: 123 }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.example.test/api/public/worker");
  assert.equal(calls[0].init.headers.authorization, "Bearer worker-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "pullUserSession",
    payload: { bot_user_id: 123 },
  });
});

test("saveUserSession uses APP_URL worker API", async () => {
  const { api } = await importApiWithEnv({
    APP_URL: "https://app.example.test",
    WORKER_TOKEN: "worker-token",
  });
  const { calls, fetchImpl } = mockFetch();

  await withFetch(fetchImpl, () =>
    api("saveUserSession", {
      bot_user_id: 123,
      session_enc: "encrypted-session",
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.example.test/api/public/worker");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "saveUserSession",
    payload: {
      bot_user_id: 123,
      session_enc: "encrypted-session",
    },
  });
});

test("deleteUserSession uses APP_URL worker API", async () => {
  const { api } = await importApiWithEnv({
    APP_URL: "https://app.example.test",
    WORKER_TOKEN: "worker-token",
  });
  const { calls, fetchImpl } = mockFetch();

  await withFetch(fetchImpl, () => api("deleteUserSession", { bot_user_id: 123 }));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://app.example.test/api/public/worker");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    action: "deleteUserSession",
    payload: { bot_user_id: 123 },
  });
});

test("worker session API no longer requires Supabase service role variables", async () => {
  const { api } = await importApiWithEnv({
    APP_URL: "https://app.example.test",
    WORKER_TOKEN: "worker-token",
  });
  const { calls, fetchImpl } = mockFetch({ body: { ok: true, session: null } });

  await withFetch(fetchImpl, () => api("pullUserSession", { bot_user_id: 123 }));

  assert.equal(calls.length, 1);
  assert.doesNotThrow(() => JSON.parse(calls[0].init.body));
});
