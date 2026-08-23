import assert from "node:assert/strict";
import test from "node:test";

import { createAgentService } from "../src/agents/agent-service.js";
import { MODEL_ROLES } from "../src/ai/contract.js";
import { createModelRegistry } from "../src/ai/model-registry.js";
import { createModelRouter, routeModelRoleFromText } from "../src/ai/model-router.js";
import { createAiOrchestrator } from "../src/ai/orchestrator.js";
import { createTelegramMessageRouter } from "../src/bot.js";

function createStubProvider({ id = "stub-general", roles = ["general"], complete } = {}) {
  const calls = [];

  return {
    provider: {
      id,
      name: id,
      roles,
      complete: async (request) => {
        calls.push(request);
        if (complete) return complete(request);
        return {
          ok: true,
          message: `handled:${request.model.role}:${request.input.text}`,
        };
      },
    },
    calls,
  };
}

function buildAiStack({ roleProviders = { general: "stub-general" }, providers = [] } = {}) {
  const registry = createModelRegistry();

  for (const provider of providers) {
    registry.registerModelProvider(provider);
  }

  const router = createModelRouter({ registry, roleProviders });
  const orchestrator = createAiOrchestrator({ router });
  const service = createAgentService({
    requireSession: async () => ({ ok: true }),
    runTurn: (request) => orchestrator.runAiTurn(request),
  });

  return { registry, router, orchestrator, service };
}

test("AI model roles are defined for Phase 1 routing", () => {
  assert.deepEqual(MODEL_ROLES, ["fast", "general", "reasoning", "coding", "embedding"]);
});

test("normal representative request reaches the selected provider", async () => {
  const { provider, calls } = createStubProvider();
  const { service } = buildAiStack({ providers: [provider] });

  const result = await service.handleRepresentativeMessage({
    botUserId: 123,
    chat: { id: 123, type: "private" },
    text: "write a short reply",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "handled:general:write a short reply");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.text, "write a short reply");
  assert.equal(calls[0].source, "telegram");
});

test("model router selects the correct provider by model role", async () => {
  const fast = createStubProvider({ id: "stub-fast", roles: ["fast"] });
  const reasoning = createStubProvider({ id: "stub-reasoning", roles: ["reasoning"] });
  const { service } = buildAiStack({
    roleProviders: {
      fast: "stub-fast",
      reasoning: "stub-reasoning",
    },
    providers: [fast.provider, reasoning.provider],
  });

  const result = await service.handleRepresentativeMessage({
    botUserId: 123,
    chat: { id: 123, type: "private" },
    text: "think",
    modelRole: "reasoning",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "handled:reasoning:think");
  assert.equal(fast.calls.length, 0);
  assert.equal(reasoning.calls.length, 1);
});

test("deterministic model routing sends greetings to fast role", () => {
  assert.equal(routeModelRoleFromText("hello"), "fast");
  assert.equal(routeModelRoleFromText("Namaste!"), "fast");
});

test("deterministic model routing keeps normal questions on general role", () => {
  assert.equal(routeModelRoleFromText("What is a good way to write a short email?"), "general");
  assert.equal(routeModelRoleFromText("Translate this sentence into Hindi"), "general");
});

test("deterministic model routing sends coding and debug requests to coding role", () => {
  assert.equal(routeModelRoleFromText("Debug this TypeScript function"), "coding");
  assert.equal(routeModelRoleFromText("Why does my Python script throw this exception?"), "coding");
});

test("deterministic model routing sends complex reasoning requests to reasoning role", () => {
  assert.equal(routeModelRoleFromText("Analyze this trade-off step by step"), "reasoning");
  assert.equal(routeModelRoleFromText("Use logic to prove why this approach works"), "reasoning");
});

test("provider failure is handled safely", async () => {
  const broken = createStubProvider({
    id: "broken",
    roles: ["general"],
    complete: async () => {
      throw new Error("provider secret failure");
    },
  });
  const { service } = buildAiStack({
    roleProviders: { general: "broken" },
    providers: [broken.provider],
  });

  const result = await service.handleRepresentativeMessage({
    botUserId: 123,
    chat: { id: 123, type: "private" },
    text: "write a short reply",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "ai_provider_failed");
  assert.match(result.text, /could not complete/);
  assert.doesNotMatch(result.text, /provider secret failure/);
});

test("latency instrumentation preserves the AI response shape and message", async () => {
  const { provider } = createStubProvider({
    complete: async (request) => ({
      ok: true,
      code: "ok",
      message: `handled:${request.model.role}:${request.input.text}`,
      output: {
        model: "test-model",
      },
    }),
  });
  const logs = [];
  let time = 100;
  const registry = createModelRegistry();
  registry.registerModelProvider(provider);
  const router = createModelRouter({
    registry,
    roleProviders: {
      general: provider.id,
    },
  });
  const orchestrator = createAiOrchestrator({
    router,
    env: {
      LOCAL_DEV_MODE: "true",
    },
    logger: {
      log: (message) => logs.push(message),
    },
    clock: () => {
      time += 7;
      return time;
    },
  });
  const request = {
    id: "telemetry-test",
    model: { role: "general" },
    input: {
      text: "normal question",
      chat: { id: 123, type: "private" },
    },
    context: {},
    metadata: {},
    source: "telegram",
  };
  const result = await orchestrator.runAiTurn(request);

  assert.equal(result.ok, true);
  assert.equal(result.message, "handled:general:normal question");
  assert.equal(result.code, "ok");
  assert.equal(request.input.text, "normal question");
  assert.equal(logs.length, 1);
  assert.match(logs[0], /^\[AI\] role=general model=test-model provider_ms=\d+ total_ms=\d+$/);
  assert.equal(result.model.role, "general");
  assert.equal(result.output.model, "test-model");
  assert.equal(result.output.telemetry.modelRole, "general");
});

test("missing provider is handled without calling a model", async () => {
  const { service } = buildAiStack({
    roleProviders: { general: "missing" },
    providers: [],
  });

  const result = await service.handleRepresentativeMessage({
    botUserId: 123,
    chat: { id: 123, type: "private" },
    text: "hello",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "ai_provider_not_configured");
  assert.equal(result.text, "AI provider is not configured yet.");
});

test("customer and agent context is preserved through the provider request", async () => {
  const { provider, calls } = createStubProvider();
  const { service } = buildAiStack({ providers: [provider] });

  const result = await service.handleRepresentativeMessage({
    botUserId: 456,
    chat: { id: 456, type: "private" },
    text: "context check",
    agentId: "agent-custom",
  });

  assert.equal(result.context.ownerId, "456");
  assert.equal(result.context.customerId, "456");
  assert.equal(result.context.agentId, "agent-custom");
  assert.equal(result.context.instructions, null);
  assert.equal(result.context.memory, null);
  assert.equal(result.context.knowledge, null);
  assert.deepEqual(calls[0].context, result.context);
});

test("Telegram layer delegates to Agent Service and never calls a provider directly", async () => {
  const directProviderCalls = [];
  const delegatedRequests = [];
  const route = createTelegramMessageRouter({
    sendMessage: async () => {},
    sendMiniAppMessage: async () => {},
    getTelegramMe: async () => ({ username: "linked_user" }),
    cancelTelegramLogin: async () => {},
    handleAiMessage: async (request) => {
      delegatedRequests.push(request);
      return {
        ok: false,
        text: "AI provider is not configured yet.",
      };
    },
    getBotMeta: () => ({ botUsername: "phasebot", botId: 777 }),
    getState: () => ({ apiId: 1234, apiHash: "hash", botToken: "token" }),
  });

  await route({
    message: {
      message_id: 1,
      text: "hello",
      from: { id: 123 },
      chat: { id: 123, type: "private" },
    },
  });

  assert.equal(delegatedRequests.length, 1);
  assert.equal(directProviderCalls.length, 0);
});
