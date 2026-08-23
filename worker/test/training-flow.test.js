import assert from "node:assert/strict";
import test from "node:test";

import { createAgentService } from "../src/agents/agent-service.js";
import { createCustomerAiContextBuilder } from "../src/agents/context-builder.js";
import {
  createAgentProfileService,
  createInMemoryAgentProfileRepository,
} from "../src/agents/profile-service.js";
import {
  createInMemoryOwnerInstructionRepository,
  createOwnerInstructionService,
} from "../src/agents/instruction-service.js";
import {
  createInMemoryOnboardingRepository,
  createOnboardingService,
} from "../src/agents/onboarding-service.js";
import { createTrainingService } from "../src/agents/training-service.js";
import { createTelegramMessageRouter } from "../src/bot.js";

const LINK_MESSAGE = "Your Telegram account is not connected yet. Open the Mini App first.";
const AGENT_ID = "personal-representative";

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

function createTrainingStack({ linkedUsers = new Set([1001, 2002]) } = {}) {
  const sent = [];
  const mini = [];
  const aiRequests = [];
  const authCalls = [];

  const profileService = createAgentProfileService({
    repository: createInMemoryAgentProfileRepository(),
  });
  const instructionService = createOwnerInstructionService({
    repository: createInMemoryOwnerInstructionRepository(),
  });
  const onboardingService = createOnboardingService({
    repository: createInMemoryOnboardingRepository(),
    profileService,
  });
  const contextBuilder = createCustomerAiContextBuilder({
    profileService,
    instructionService,
  });
  const trainingService = createTrainingService({
    onboardingService,
    instructionService,
    defaultAgentId: AGENT_ID,
  });

  async function requireSession(botUserId) {
    authCalls.push(botUserId);
    if (!linkedUsers.has(Number(botUserId))) throw new Error(LINK_MESSAGE);
    return { ok: true };
  }

  const agentService = createAgentService({
    contextBuilder,
    defaultAgentId: AGENT_ID,
    requireSession,
    runTurn: async (request) => {
      aiRequests.push(request);
      return {
        ok: true,
        code: "ok",
        message: `AI reply: ${request.input.text}`,
      };
    },
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
    trainingService,
    requireTrainingSession: requireSession,
    trainingAgentId: AGENT_ID,
    enableTrainingCommands: true,
    getBotMeta: () => ({ botUsername: "phasebot", botId: 777 }),
    getState: () => ({ apiId: 1234, apiHash: "hash", botToken: "token" }),
    miniAppUrl: "https://example.test/mini-app",
    helpText: "HELP TEXT",
  });

  return {
    route,
    sent,
    mini,
    aiRequests,
    authCalls,
    profileService,
    instructionService,
    onboardingService,
  };
}

async function completeOnboarding(route, ownerId = 1001) {
  await route(privateUpdate("/train", { id: ownerId }));
  const answers = [
    "Raj",
    "My business is ABC Payments.",
    "Help customers understand payment products.",
    "English, Hindi",
    "Professional and concise",
    "UPI payment links, settlement support",
    "Public product details",
    "Private customer data",
    "Always verify sensitive requests",
  ];

  for (const answer of answers) {
    await route(privateUpdate(answer, { id: ownerId }));
  }
}

test("/train starts onboarding for an authorized private customer", async () => {
  const { route, sent, authCalls } = createTrainingStack();

  await route(privateUpdate("/train"));

  assert.deepEqual(authCalls, [1001]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Let's set up your Personal AI Representative/);
  assert.match(sent[0].text, /What should I call you/);
});

test("onboarding answers advance one question at a time", async () => {
  const { route, sent, profileService } = createTrainingStack();

  await route(privateUpdate("/train"));
  await route(privateUpdate("Raj"));

  const profile = await profileService.getProfile({ ownerId: 1001, agentId: AGENT_ID });
  assert.equal(profile.ownerName, "Raj");
  assert.match(sent.at(-1).text, /Training progress: 1\/9/);
  assert.match(sent.at(-1).text, /business or profession/);
});

test("/train_status reports active progress", async () => {
  const { route, sent } = createTrainingStack();

  await route(privateUpdate("/train"));
  await route(privateUpdate("Raj"));
  await route(privateUpdate("/train_status"));

  assert.match(sent.at(-1).text, /Training progress: 1\/9/);
  assert.match(sent.at(-1).text, /Status: in_progress/);
});

test("/train_cancel stops training mode and returns later messages to AI", async () => {
  const { route, sent, aiRequests } = createTrainingStack();

  await route(privateUpdate("/train"));
  await route(privateUpdate("/train_cancel"));
  await route(privateUpdate("This should be a normal AI message."));

  assert.match(sent[1].text, /Training cancelled/);
  assert.equal(aiRequests.length, 1);
  assert.equal(aiRequests[0].input.text, "This should be a normal AI message.");
});

test("onboarding completion returns private chat to standard AI mode", async () => {
  const { route, sent, aiRequests, profileService } = createTrainingStack();

  await completeOnboarding(route);
  await route(privateUpdate("What is photosynthesis?"));

  const profile = await profileService.getProfile({ ownerId: 1001, agentId: AGENT_ID });
  assert.equal(profile.onboardingStatus, "completed");
  assert.match(sent.at(-2).text, /Training is complete/);
  assert.equal(aiRequests.length, 1);
  assert.equal(aiRequests[0].input.text, "What is photosynthesis?");
  assert.match(aiRequests[0].context.instructions, /ABC Payments/);
});

test("/remember saves active owner instructions and /instructions lists only that owner", async () => {
  const { route, sent } = createTrainingStack();

  await route(privateUpdate("/remember Always answer me in Hindi.", { id: 1001 }));
  await route(privateUpdate("/instructions", { id: 1001 }));
  await route(privateUpdate("/instructions", { id: 2002 }));

  assert.match(sent[0].text, /Saved as an owner instruction/);
  assert.match(sent[1].text, /Always answer me in Hindi/);
  assert.doesNotMatch(sent[2].text, /Always answer me in Hindi/);
  assert.match(sent[2].text, /No active owner instructions/);
});

test("profile and owner instructions enter real AI request context", async () => {
  const { route, aiRequests } = createTrainingStack();

  await completeOnboarding(route);
  await route(privateUpdate("/remember Always answer me in Hindi."));
  await route(privateUpdate("What business am I in?"));

  assert.equal(aiRequests.length, 1);
  assert.match(aiRequests[0].context.instructions, /ABC Payments/);
  assert.match(aiRequests[0].context.instructions, /Always answer me in Hindi/);
});

test("customer A training never affects customer B AI context", async () => {
  const { route, aiRequests } = createTrainingStack();

  await completeOnboarding(route, 1001);
  await route(privateUpdate("/remember Always answer me in Hindi.", { id: 1001 }));
  await route(privateUpdate("What business am I in?", { id: 2002 }));

  assert.equal(aiRequests.length, 1);
  assert.doesNotMatch(aiRequests[0].context.instructions, /ABC Payments/);
  assert.doesNotMatch(aiRequests[0].context.instructions, /Always answer me in Hindi/);
});

test("group users cannot train or add owner instructions", async () => {
  const { route, sent, instructionService, onboardingService } = createTrainingStack();

  await route(groupUpdate("/train@phasebot"));
  await route(groupUpdate("/remember@phasebot Save this group rule"));

  const progress = await onboardingService.getProgress({ ownerId: 1001, agentId: AGENT_ID });
  const instructions = await instructionService.list({ ownerId: 1001, agentId: AGENT_ID });
  assert.equal(sent.length, 2);
  assert.match(sent[0].text, /only available in private chat/);
  assert.match(sent[1].text, /only available in private chat/);
  assert.equal(progress.status, "not_started");
  assert.deepEqual(instructions, []);
});

test("training commands stay disabled when local-dev training is not enabled", async () => {
  const sent = [];
  const mini = [];
  const route = createTelegramMessageRouter({
    sendMessage: async (chatId, text, extra = {}) => sent.push({ chatId, text, extra }),
    sendMiniAppMessage: async (chatId, text = "Open the Mini App to continue.", extra = {}) =>
      mini.push({ chatId, text, extra }),
    getTelegramMe: async () => ({ username: "linked_user" }),
    cancelTelegramLogin: async () => {},
    handleAiMessage: async () => ({ ok: true, text: "AI reply" }),
    enableTrainingCommands: false,
    getBotMeta: () => ({ botUsername: "phasebot", botId: 777 }),
    getState: () => ({ apiId: 1234, apiHash: "hash", botToken: "token" }),
    helpText: "HELP TEXT",
  });

  await route(privateUpdate("/train"));

  assert.equal(sent.length, 0);
  assert.equal(mini.length, 1);
  assert.equal(mini[0].text, "HELP TEXT");
});
