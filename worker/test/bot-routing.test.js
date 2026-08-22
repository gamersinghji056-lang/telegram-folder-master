import assert from "node:assert/strict";
import test from "node:test";

import { createAgentService } from "../src/agents/agent-service.js";
import { createModelRegistry } from "../src/ai/model-registry.js";
import { createModelRouter } from "../src/ai/model-router.js";
import { createAiOrchestrator } from "../src/ai/orchestrator.js";
import { createTelegramMessageRouter } from "../src/bot.js";

const LINK_MESSAGE = "Your Telegram account is not connected yet. Open the Mini App first.";

function privateUpdate(text, from = { id: 1001 }) {
  return {
    message: {
      message_id: 10,
      text,
      from,
      chat: {
        id: from.id,
        type: "private",
      },
    },
  };
}

function groupUpdate(text, extra = {}) {
  return {
    message: {
      message_id: 20,
      text,
      from: {
        id: 1001,
      },
      chat: {
        id: -2001,
        type: "group",
        title: "Test Group",
      },
      ...extra,
    },
  };
}

function makeRouter({
  linkedUsers = new Set([1001]),
  botUsername = "phasebot",
  botId = 777,
  getTelegramMe = async () => ({ username: "linked_user" }),
  cancelTelegramLogin = async () => {},
} = {}) {
  const sent = [];
  const mini = [];
  const aiCalls = [];

  const route = createTelegramMessageRouter({
    sendMessage: async (chatId, text, extra = {}) => {
      sent.push({ chatId, text, extra });
    },
    sendMiniAppMessage: async (chatId, text = "Open the Mini App to continue.", extra = {}) => {
      mini.push({ chatId, text, extra });
    },
    getTelegramMe,
    cancelTelegramLogin,
    handleAiMessage: async (request) => {
      aiCalls.push(request);

      if (!linkedUsers.has(request.botUserId)) {
        throw new Error(LINK_MESSAGE);
      }

      return {
        ok: false,
        text: "AI provider is not configured yet.",
      };
    },
    getBotMeta: () => ({ botUsername, botId }),
    getState: () => ({ apiId: 1234, apiHash: "hash", botToken: "token" }),
    miniAppUrl: "https://example.test/mini-app",
    helpText: "HELP TEXT",
  });

  return { route, sent, mini, aiCalls };
}

test("private chat routing sends linked users through AI orchestration", async () => {
  const { route, sent, mini, aiCalls } = makeRouter();

  await route(privateUpdate("hello representative"));

  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].botUserId, 1001);
  assert.equal(aiCalls[0].chat.type, "private");
  assert.equal(aiCalls[0].text, "hello representative");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "AI provider is not configured yet.");
  assert.equal(mini.length, 0);
});

test("private chat routing blocks unlinked users with Mini App session-link instruction", async () => {
  const { route, sent, mini, aiCalls } = makeRouter({ linkedUsers: new Set() });

  await route(privateUpdate("hello representative"));

  assert.equal(aiCalls.length, 1);
  assert.equal(sent.length, 0);
  assert.equal(mini.length, 1);
  assert.match(mini[0].text, /Open the Mini App first/);
});

test("group routing ignores normal group messages", async () => {
  const { route, sent, mini, aiCalls } = makeRouter();

  await route(groupUpdate("normal group chatter"));

  assert.equal(aiCalls.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(mini.length, 0);
});

test("group routing responds when @botusername is mentioned", async () => {
  const { route, sent, mini, aiCalls } = makeRouter();

  await route(groupUpdate("@phasebot summarize this"));

  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].chat.type, "group");
  assert.equal(aiCalls[0].text, "summarize this");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].extra.reply_to_message_id, 20);
  assert.equal(mini.length, 0);
});

test("group routing responds when a message replies to the bot", async () => {
  const { route, sent, aiCalls } = makeRouter();

  await route(
    groupUpdate("what do you think?", {
      reply_to_message: {
        from: {
          id: 777,
          is_bot: true,
          username: "phasebot",
        },
      },
    }),
  );

  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].text, "what do you think?");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].extra.reply_to_message_id, 20);
});

test("group routing still applies linked-session authorization", async () => {
  const { route, sent, mini, aiCalls } = makeRouter({ linkedUsers: new Set() });

  await route(groupUpdate("@phasebot help me"));

  assert.equal(aiCalls.length, 1);
  assert.equal(sent.length, 0);
  assert.equal(mini.length, 1);
  assert.match(mini[0].text, /Open the Mini App first/);
  assert.equal(mini[0].extra.reply_to_message_id, 20);
});

test("folder-merger commands still route to Mini App/status/help/cancel handlers", async () => {
  const cancelled = [];
  const { route, sent, mini } = makeRouter({
    cancelTelegramLogin: async (botUserId) => {
      cancelled.push(botUserId);
    },
  });

  await route(privateUpdate("/start"));
  await route(privateUpdate("/connect"));
  await route(privateUpdate("/addfolder"));
  await route(privateUpdate("/status"));
  await route(privateUpdate("/help"));
  await route(privateUpdate("/cancel"));

  assert.equal(mini.length, 3);
  assert.match(mini[0].text, /Open the Mini App/);
  assert.match(mini[1].text, /Connect your Telegram account/);
  assert.match(mini[2].text, /Add and analyze folder links/);
  assert.equal(sent.length, 3);
  assert.match(sent[0].text, /Telegram API: configured/);
  assert.equal(sent[1].text, "HELP TEXT");
  assert.match(sent[2].text, /Cancelled any pending Telegram login/);
  assert.deepEqual(cancelled, [1001]);
});

test("group folder-merger commands with bot suffix still work", async () => {
  const { route, sent, mini } = makeRouter();

  await route(groupUpdate("/help@phasebot"));
  await route(groupUpdate("/status@phasebot"));
  await route(groupUpdate("/start@phasebot"));

  assert.equal(sent.length, 2);
  assert.equal(sent[0].text, "HELP TEXT");
  assert.match(sent[1].text, /Telegram account: @linked_user/);
  assert.equal(mini.length, 1);
  assert.match(mini[0].text, /Open the Mini App/);
});

function makeAiBackedRouter({ providerComplete, linked = true } = {}) {
  const sent = [];
  const mini = [];
  const providerCalls = [];
  const registry = createModelRegistry();

  registry.registerModelProvider({
    id: "test-provider",
    name: "Test Provider",
    roles: ["general"],
    complete: async (request) => {
      providerCalls.push(request);
      if (providerComplete) return providerComplete(request);
      return {
        ok: true,
        message: `AI reply: ${request.input.text}`,
      };
    },
  });

  const router = createModelRouter({
    registry,
    roleProviders: {
      general: "test-provider",
    },
  });
  const orchestrator = createAiOrchestrator({ router });
  const agentService = createAgentService({
    requireSession: async () => {
      if (!linked) throw new Error(LINK_MESSAGE);
      return { ok: true };
    },
    runTurn: (request) => orchestrator.runAiTurn(request),
  });

  const route = createTelegramMessageRouter({
    sendMessage: async (chatId, text, extra = {}) => {
      sent.push({ chatId, text, extra });
    },
    sendMiniAppMessage: async (chatId, text = "Open the Mini App to continue.", extra = {}) => {
      mini.push({ chatId, text, extra });
    },
    getTelegramMe: async () => ({ username: "linked_user" }),
    cancelTelegramLogin: async () => {},
    handleAiMessage: (request) => agentService.handleRepresentativeMessage(request),
    getBotMeta: () => ({ botUsername: "phasebot", botId: 777 }),
    getState: () => ({ apiId: 1234, apiHash: "hash", botToken: "token" }),
    miniAppUrl: "https://example.test/mini-app",
    helpText: "HELP TEXT",
  });

  return { route, sent, mini, providerCalls };
}

test("private linked user gets AI reply through Agent Service and provider", async () => {
  const { route, sent, mini, providerCalls } = makeAiBackedRouter();

  await route(privateUpdate("write a short reply"));

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].input.text, "write a short reply");
  assert.equal(providerCalls[0].model.role, "general");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "AI reply: write a short reply");
  assert.equal(mini.length, 0);
});

test("private provider error is handled safely and does not crash routing", async () => {
  const { route, sent, mini, providerCalls } = makeAiBackedRouter({
    providerComplete: async () => {
      throw new Error("raw provider failure");
    },
  });

  await route(privateUpdate("trigger failure"));

  assert.equal(providerCalls.length, 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /could not complete/);
  assert.doesNotMatch(sent[0].text, /raw provider failure/);
  assert.equal(mini.length, 0);
});

test("private missing provider returns clean not-configured message", async () => {
  const sent = [];
  const mini = [];
  const registry = createModelRegistry();
  const router = createModelRouter({
    registry,
    roleProviders: {
      general: "missing-provider",
    },
  });
  const orchestrator = createAiOrchestrator({ router });
  const agentService = createAgentService({
    requireSession: async () => ({ ok: true }),
    runTurn: (request) => orchestrator.runAiTurn(request),
  });
  const route = createTelegramMessageRouter({
    sendMessage: async (chatId, text, extra = {}) => sent.push({ chatId, text, extra }),
    sendMiniAppMessage: async (chatId, text = "Open the Mini App to continue.", extra = {}) =>
      mini.push({ chatId, text, extra }),
    getTelegramMe: async () => ({ username: "linked_user" }),
    cancelTelegramLogin: async () => {},
    handleAiMessage: (request) => agentService.handleRepresentativeMessage(request),
    getBotMeta: () => ({ botUsername: "phasebot", botId: 777 }),
    getState: () => ({ apiId: 1234, apiHash: "hash", botToken: "token" }),
  });

  await route(privateUpdate("hello"));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "AI provider is not configured yet.");
  assert.equal(mini.length, 0);
});

test("group mention gets AI reply through provider", async () => {
  const { route, sent, mini, providerCalls } = makeAiBackedRouter();

  await route(groupUpdate("@phasebot summarize this thread"));

  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].input.text, "summarize this thread");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "AI reply: summarize this thread");
  assert.equal(sent[0].extra.reply_to_message_id, 20);
  assert.equal(mini.length, 0);
});

test("AI-backed router ignores normal group message", async () => {
  const { route, sent, mini, providerCalls } = makeAiBackedRouter();

  await route(groupUpdate("do not route this"));

  assert.equal(providerCalls.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(mini.length, 0);
});

test("AI-backed router blocks unlinked user before provider call", async () => {
  const { route, sent, mini, providerCalls } = makeAiBackedRouter({ linked: false });

  await route(privateUpdate("hello"));

  assert.equal(providerCalls.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(mini.length, 1);
  assert.match(mini[0].text, /Open the Mini App first/);
});
