import assert from "node:assert/strict";
import test from "node:test";

import { createAgentContext, createAiRequest } from "../src/ai/contract.js";
import { createModelRegistry, registerConfiguredModelProviders } from "../src/ai/model-registry.js";
import { configuredRoleProviders } from "../src/ai/model-router.js";
import { OpenAiCompatibleProvider } from "../src/ai/providers/openai-compatible-provider.js";

function response({ status = 200, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function request({ text = "hello", role = "general", config = {} } = {}) {
  return createAiRequest({
    id: "req-1",
    modelRole: role,
    input: {
      text,
      chat: { id: 1, type: "private" },
    },
    context: createAgentContext({
      ownerId: "owner-1",
      customerId: "customer-1",
      agentId: "agent-1",
      instructions: "Use the tenant-safe instruction placeholder.",
    }),
    metadata: {},
    source: "telegram",
    config,
  });
}

test("OpenAI-compatible provider maps a successful chat completion response", async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        body: JSON.stringify({
          model: "llama3.1",
          choices: [{ message: { content: "hello from model" } }],
        }),
      });
    },
  });

  const result = await provider.complete(request());

  assert.equal(result.ok, true);
  assert.equal(result.message, "hello from model");
  assert.equal(result.model.providerId, "openai-compatible");
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "llama3.1");
  assert.equal(body.messages[0].role, "system");
  assert.equal(body.messages[1].content, "hello");
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("OpenAI-compatible provider uses optional API key when configured", async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://models.example.test/v1",
    apiKey: "test-key",
    model: "qwen",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      });
    },
  });

  await provider.complete(request());

  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");
});

test("OpenAI-compatible provider allows request config to override base URL and model", async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "https://default.example.test/v1",
    model: "default-model",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      });
    },
  });

  await provider.complete(
    request({
      config: {
        provider: {
          AI_BASE_URL: "https://override.example.test/v1",
          model: "override-model",
        },
      },
    }),
  );

  assert.equal(calls[0].url, "https://override.example.test/v1/chat/completions");
  assert.equal(JSON.parse(calls[0].init.body).model, "override-model");
});

test("OpenAI-compatible provider uses role-specific model configuration", async () => {
  const calls = [];
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "fallback-model",
    roleModels: {
      general: "general-model",
      coding: "qwen2.5-coder:3b",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return response({
        body: JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
      });
    },
  });

  await provider.complete(request({ role: "coding" }));

  assert.equal(provider.modelNameForRequest(request({ role: "coding" })), "qwen2.5-coder:3b");
  assert.equal(JSON.parse(calls[0].init.body).model, "qwen2.5-coder:3b");
});

test("configured provider supports role-specific models with AI_MODEL fallback", () => {
  const registry = createModelRegistry();
  const registered = registerConfiguredModelProviders({
    env: {
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "fallback-model",
      AI_MODEL_GENERAL: "general-model",
      AI_MODEL_CODING: "qwen2.5-coder:3b",
    },
    registry,
    fetchImpl: async () => response({ body: "{}" }),
  });

  const provider = registered[0];

  assert.equal(provider.modelNameForRequest(request({ role: "fast" })), "fallback-model");
  assert.equal(provider.modelNameForRequest(request({ role: "general" })), "general-model");
  assert.equal(provider.modelNameForRequest(request({ role: "coding" })), "qwen2.5-coder:3b");
});

test("OpenAI-compatible provider surfaces provider HTTP errors to orchestrator", async () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    fetchImpl: async () =>
      response({
        status: 500,
        body: JSON.stringify({ error: { message: "model failed" } }),
      }),
  });

  await assert.rejects(
    () => provider.complete(request()),
    (error) => {
      assert.match(error.message, /model failed/);
      assert.equal(error.providerCode, "http_error");
      assert.equal(error.httpStatus, 500);
      assert.equal(error.providerDetail, "model failed");
      return true;
    },
  );
});

test("OpenAI-compatible provider handles timeout", async () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    timeoutMs: 1,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
  });

  await assert.rejects(
    () => provider.complete(request()),
    (error) => {
      assert.match(error.message, /timed out/);
      assert.equal(error.providerCode, "timeout");
      assert.equal(error.httpStatus, null);
      assert.match(error.providerDetail, /exceeded 1ms timeout/);
      return true;
    },
  );
});

test("OpenAI-compatible provider rejects invalid non-JSON response", async () => {
  const provider = new OpenAiCompatibleProvider({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
    fetchImpl: async () => response({ body: "not-json" }),
  });

  await assert.rejects(
    () => provider.complete(request()),
    (error) => {
      assert.match(error.message, /non-JSON/);
      assert.equal(error.providerCode, "non_json_response");
      assert.equal(error.httpStatus, 200);
      assert.equal(error.providerDetail, "Provider returned a non-JSON response body.");
      return true;
    },
  );
});

test("OpenAI-compatible provider rejects missing base URL", async () => {
  const provider = new OpenAiCompatibleProvider({
    model: "llama3.1",
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });

  await assert.rejects(() => provider.complete(request()), /AI_BASE_URL is required/);
});

test("configured provider registration is inactive without AI_BASE_URL", () => {
  const registry = createModelRegistry();
  const registered = registerConfiguredModelProviders({
    env: {},
    registry,
    fetchImpl: async () => response({ body: "{}" }),
  });

  assert.deepEqual(registered, []);
  assert.deepEqual(registry.listModelProviders(), []);
});

test("configured provider registration is inactive without AI_MODEL", () => {
  const registry = createModelRegistry();
  const registered = registerConfiguredModelProviders({
    env: {
      AI_BASE_URL: "http://localhost:11434/v1",
    },
    registry,
    fetchImpl: async () => response({ body: "{}" }),
  });

  assert.deepEqual(registered, []);
  assert.deepEqual(registry.listModelProviders(), []);
});

test("configured provider registration registers OpenAI-compatible provider when AI_BASE_URL exists", () => {
  const registry = createModelRegistry();
  const registered = registerConfiguredModelProviders({
    env: {
      AI_BASE_URL: "http://localhost:11434/v1",
      AI_MODEL: "llama3.1",
    },
    registry,
    fetchImpl: async () => response({ body: "{}" }),
  });

  assert.equal(registered.length, 1);
  assert.equal(registry.getModelProvider("openai-compatible"), registered[0]);
});

test("configured role providers are only active when base URL and model are configured", () => {
  assert.deepEqual(configuredRoleProviders({}), {});
  assert.deepEqual(configuredRoleProviders({ AI_BASE_URL: "http://localhost:11434/v1" }), {});
  assert.deepEqual(configuredRoleProviders({ AI_MODEL: "qwen2.5-coder:3b" }), {});
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
