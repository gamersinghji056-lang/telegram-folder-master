import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createLinkedSessionGuard } from "../src/auth/linked-session.js";
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
import { createMiniTrainingHandlers } from "../src/mini-training-api.js";
import { requireMiniUserOrLocalDevBypass } from "../src/mini-auth.js";

const AGENT_ID = "personal-representative";

function createStack({ linkedUsers = new Set([1001, 2002]) } = {}) {
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
  const trainingService = createTrainingService({
    onboardingService,
    instructionService,
    defaultAgentId: AGENT_ID,
  });
  const contextBuilder = createCustomerAiContextBuilder({
    profileService,
    instructionService,
  });

  const handlers = createMiniTrainingHandlers({
    profileService,
    instructionService,
    trainingService,
    defaultAgentId: AGENT_ID,
    verifyMiniUser: (initData) => {
      if (initData === "invalid") throw new Error("Telegram Mini App initData validation failed.");
      const botUserId = Number(initData || 1001);
      return {
        botUserId,
        user: {
          id: botUserId,
          username: null,
          firstName: null,
          lastName: null,
        },
      };
    },
    requireSession: async (botUserId) => {
      if (!linkedUsers.has(Number(botUserId))) {
        throw new Error("Your Telegram account is not connected yet. Open the Mini App first.");
      }
      return { ok: true };
    },
  });

  return {
    handlers,
    contextBuilder,
  };
}

test("Mini App onboarding can start resume and submit answers", async () => {
  const { handlers } = createStack();

  const started = await handlers.miniAiTrainingStart({ initData: "1001" });
  const resumed = await handlers.miniAiTrainingStart({ initData: "1001" });
  const answered = await handlers.miniAiTrainingAnswer({
    initData: "1001",
    answer: "Raj",
  });

  assert.match(started.result.text, /What should I call you/);
  assert.match(resumed.result.text, /What should I call you/);
  assert.equal(answered.training.status, "in_progress");
  assert.equal(answered.profile.ownerName, "Raj");
  assert.match(answered.result.text, /business or profession/);
});

test("Mini App profile read and update stay owner scoped", async () => {
  const { handlers } = createStack();

  await handlers.miniAiProfileUpdate({
    initData: "1001",
    profile: {
      aiDisplayName: "Asha",
      businessOrProfession: "ABC Payments",
      preferredLanguages: "English, Hindi",
    },
  });

  const own = await handlers.miniAiProfileGet({ initData: "1001" });
  const other = await handlers.miniAiProfileGet({ initData: "2002" });

  assert.equal(own.profile.aiDisplayName, "Asha");
  assert.equal(own.profile.businessOrProfession, "ABC Payments");
  assert.deepEqual(own.profile.preferredLanguages, ["English, Hindi"]);
  assert.equal(other.profile.aiDisplayName, "Personal AI Representative");
  assert.equal(other.profile.businessOrProfession, "");
});

test("Mini App instructions add list update disable and remove through existing service", async () => {
  const { handlers } = createStack();

  const added = await handlers.miniAiInstructionAdd({
    initData: "1001",
    category: "communication",
    text: "Use a professional tone.",
  });
  await handlers.miniAiInstructionUpdate({
    initData: "1001",
    instructionId: added.instruction.id,
    patch: {
      category: "support",
      text: "Use a calm support tone.",
    },
  });

  const active = await handlers.miniAiInstructionsList({ initData: "1001" });
  assert.equal(active.instructions.length, 1);
  assert.equal(active.instructions[0].category, "support");
  assert.equal(active.instructions[0].text, "Use a calm support tone.");

  await handlers.miniAiInstructionDisable({
    initData: "1001",
    instructionId: added.instruction.id,
  });
  const afterDisable = await handlers.miniAiInstructionsList({ initData: "1001" });
  const all = await handlers.miniAiInstructionsList({
    initData: "1001",
    includeDisabled: true,
  });
  assert.equal(afterDisable.instructions.length, 0);
  assert.equal(all.instructions[0].enabled, false);

  await handlers.miniAiInstructionEnable({
    initData: "1001",
    instructionId: added.instruction.id,
  });
  const afterEnable = await handlers.miniAiInstructionsList({ initData: "1001" });
  assert.equal(afterEnable.instructions.length, 1);

  await handlers.miniAiInstructionRemove({
    initData: "1001",
    instructionId: added.instruction.id,
  });
  const afterRemove = await handlers.miniAiInstructionsList({ initData: "1001" });
  assert.equal(afterRemove.instructions.length, 0);
});

test("Mini App training APIs require linked session", async () => {
  const { handlers } = createStack({ linkedUsers: new Set() });

  await assert.rejects(
    () => handlers.miniAiTrainingStart({ initData: "1001" }),
    /Telegram account is not connected yet/,
  );
});

test("Mini App training APIs reject invalid initData before session lookup", async () => {
  const { handlers } = createStack();

  await assert.rejects(
    () => handlers.miniAiProfileGet({ initData: "invalid" }),
    /Telegram Mini App initData validation failed/,
  );
});

test("Mini App training data never crosses Telegram users", async () => {
  const { handlers, contextBuilder } = createStack();

  await handlers.miniAiProfileUpdate({
    initData: "1001",
    profile: { businessOrProfession: "ABC Payments" },
  });
  await handlers.miniAiInstructionAdd({
    initData: "1001",
    category: "custom",
    text: "Always answer me in Hindi.",
  });

  const contextA = await contextBuilder.buildContext({ ownerId: 1001, agentId: AGENT_ID });
  const contextB = await contextBuilder.buildContext({ ownerId: 2002, agentId: AGENT_ID });

  assert.match(contextA.instructions, /ABC Payments/);
  assert.match(contextA.instructions, /Always answer me in Hindi/);
  assert.doesNotMatch(contextB.instructions, /ABC Payments/);
  assert.doesNotMatch(contextB.instructions, /Always answer me in Hindi/);
});

test("explicit local dev bypass allows Mini App AI dashboard testing", async () => {
  const { profileService, instructionService, trainingService } = (() => {
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
    return {
      profileService,
      instructionService,
      trainingService: createTrainingService({
        onboardingService,
        instructionService,
        defaultAgentId: AGENT_ID,
      }),
    };
  })();
  const env = {
    LOCAL_DEV_MODE: "true",
    LOCAL_DEV_ALLOW_SESSION_BYPASS: "true",
    DEV_TELEGRAM_USER_ID: "4242",
  };
  const requireSession = createLinkedSessionGuard({
    env,
    logger: { warn: () => {} },
    getClient: async () => {
      throw new Error("real session lookup should not run");
    },
  });
  const handlers = createMiniTrainingHandlers({
    profileService,
    instructionService,
    trainingService,
    defaultAgentId: AGENT_ID,
    verifyMiniUser: (initData) =>
      requireMiniUserOrLocalDevBypass(initData, {
        env,
        telegramState: { botToken: "prod-token" },
      }),
    requireSession,
  });

  const status = await handlers.miniAiTrainingStatus({ initData: "" });
  const started = await handlers.miniAiTrainingStart({ initData: "" });

  assert.equal(status.botUser.id, 4242);
  assert.equal(status.profile.ownerId, "4242");
  assert.match(started.result.text, /Personal AI Representative/);
});

test("Connected Session section and dev bypass badge remain in Mini App UI", async () => {
  const source = await readFile(new URL("../../src/routes/mini-app.tsx", import.meta.url), "utf8");

  assert.match(source, /Connected Session/);
  assert.match(source, /Development session bypass active/);
  assert.match(source, /Real Telegram session linking is still available/);
});
