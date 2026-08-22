import assert from "node:assert/strict";
import test from "node:test";

import { createAgentService } from "../src/agents/agent-service.js";
import { MODEL_ROLES } from "../src/ai/contract.js";
import { createModelRegistry } from "../src/ai/model-registry.js";
import { createModelRouter } from "../src/ai/model-router.js";
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
    text: "hello",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "handled:general:hello");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input.text, "hello");
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
    text: "hello",
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "ai_provider_failed");
  assert.match(result.text, /could not complete/);
  assert.doesNotMatch(result.text, /provider secret failure/);
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
  assert.match(result.text, /not connected to an AI provider yet/);
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
        text: "Personal AI Representative is not connected to an AI provider yet.",
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
