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

function createPhase2AStack() {
  const profileRepository = createInMemoryAgentProfileRepository();
  const profileService = createAgentProfileService({ repository: profileRepository });
  const instructionRepository = createInMemoryOwnerInstructionRepository();
  const instructionService = createOwnerInstructionService({ repository: instructionRepository });
  const onboardingRepository = createInMemoryOnboardingRepository();
  const onboardingService = createOnboardingService({
    repository: onboardingRepository,
    profileService,
  });
  const contextBuilder = createCustomerAiContextBuilder({
    profileService,
    instructionService,
  });

  return {
    profileRepository,
    profileService,
    instructionRepository,
    instructionService,
    onboardingRepository,
    onboardingService,
    contextBuilder,
  };
}

test("default agent profile is tenant scoped and usable before onboarding", async () => {
  const { profileService } = createPhase2AStack();

  const profile = await profileService.getProfile({
    ownerId: "customer-a",
    agentId: "agent-1",
  });

  assert.equal(profile.ownerId, "customer-a");
  assert.equal(profile.customerId, "customer-a");
  assert.equal(profile.agentId, "agent-1");
  assert.equal(profile.aiDisplayName, "Personal AI Representative");
  assert.equal(profile.onboardingStatus, "not_started");
  assert.deepEqual(profile.preferredLanguages, []);
});

test("agent profile updates stay scoped to owner and agent", async () => {
  const { profileService } = createPhase2AStack();

  await profileService.updateProfile({
    ownerId: "customer-a",
    agentId: "agent-1",
    patch: {
      aiDisplayName: "Asha",
      ownerName: "A Owner",
      businessOrProfession: "Interior designer",
      preferredLanguages: ["English", "Hindi"],
      productsServices: ["Consultation", "Design package"],
    },
  });

  const ownProfile = await profileService.getProfile({ ownerId: "customer-a", agentId: "agent-1" });
  const otherOwnerProfile = await profileService.getProfile({
    ownerId: "customer-b",
    agentId: "agent-1",
  });
  const otherAgentProfile = await profileService.getProfile({
    ownerId: "customer-a",
    agentId: "agent-2",
  });

  assert.equal(ownProfile.aiDisplayName, "Asha");
  assert.deepEqual(ownProfile.preferredLanguages, ["English", "Hindi"]);
  assert.equal(otherOwnerProfile.aiDisplayName, "Personal AI Representative");
  assert.equal(otherAgentProfile.aiDisplayName, "Personal AI Representative");
});

test("owner instructions support add list update and disable", async () => {
  const { instructionService } = createPhase2AStack();

  const first = await instructionService.add({
    ownerId: "customer-a",
    agentId: "agent-1",
    category: "communication",
    text: "Use a warm tone.",
  });
  const second = await instructionService.add({
    ownerId: "customer-a",
    agentId: "agent-1",
    category: "privacy",
    text: "Never share private phone numbers.",
  });

  await instructionService.update({
    ownerId: "customer-a",
    agentId: "agent-1",
    instructionId: first.id,
    patch: {
      category: "support",
      text: "Use a calm support tone.",
    },
  });
  await instructionService.disable({
    ownerId: "customer-a",
    agentId: "agent-1",
    instructionId: second.id,
  });

  const active = await instructionService.list({ ownerId: "customer-a", agentId: "agent-1" });
  const all = await instructionService.list({
    ownerId: "customer-a",
    agentId: "agent-1",
    includeDisabled: true,
  });

  assert.equal(active.length, 1);
  assert.equal(active[0].category, "support");
  assert.equal(active[0].text, "Use a calm support tone.");
  assert.equal(all.length, 2);
  assert.equal(all.find((row) => row.id === second.id).enabled, false);
});

test("disabled owner instructions are excluded from AI context", async () => {
  const { instructionService, contextBuilder } = createPhase2AStack();

  const active = await instructionService.add({
    ownerId: "customer-a",
    agentId: "agent-1",
    category: "sales",
    text: "Offer the starter plan first.",
  });
  const disabled = await instructionService.add({
    ownerId: "customer-a",
    agentId: "agent-1",
    category: "privacy",
    text: "This disabled rule must not appear.",
  });
  await instructionService.disable({
    ownerId: "customer-a",
    agentId: "agent-1",
    instructionId: disabled.id,
  });

  const context = await contextBuilder.buildContext({ ownerId: "customer-a", agentId: "agent-1" });

  assert.match(context.instructions, /Offer the starter plan first/);
  assert.doesNotMatch(context.instructions, /disabled rule/);
  assert.deepEqual(
    context.ownerInstructions.map((row) => row.id),
    [active.id],
  );
});

test("onboarding start progress answers and completion update only the owner draft/profile", async () => {
  const { profileService, onboardingService } = createPhase2AStack();

  await onboardingService.startOnboarding({ ownerId: "customer-a", agentId: "agent-1" });
  const firstQuestion = await onboardingService.getNextQuestion({
    ownerId: "customer-a",
    agentId: "agent-1",
  });
  assert.equal(firstQuestion.id, "owner_work");

  await onboardingService.submitAnswer({
    ownerId: "customer-a",
    agentId: "agent-1",
    questionId: "business_profession",
    answer: "Architect",
  });
  await onboardingService.submitAnswer({
    ownerId: "customer-a",
    agentId: "agent-1",
    questionId: "languages",
    answer: "English, Hindi",
  });

  const progress = await onboardingService.getProgress({
    ownerId: "customer-a",
    agentId: "agent-1",
  });
  const otherProgress = await onboardingService.getProgress({
    ownerId: "customer-b",
    agentId: "agent-1",
  });

  assert.equal(progress.status, "in_progress");
  assert.equal(progress.answered, 2);
  assert.equal(otherProgress.status, "not_started");
  assert.equal(otherProgress.answered, 0);

  const { profile } = await onboardingService.completeOnboarding({
    ownerId: "customer-a",
    agentId: "agent-1",
  });
  const otherProfile = await profileService.getProfile({
    ownerId: "customer-b",
    agentId: "agent-1",
  });

  assert.equal(profile.businessOrProfession, "Architect");
  assert.deepEqual(profile.preferredLanguages, ["English", "Hindi"]);
  assert.equal(profile.onboardingStatus, "completed");
  assert.equal(otherProfile.businessOrProfession, "");
});

test("context builder combines base instructions profile active owner instructions and placeholders", async () => {
  const { profileService, instructionService, contextBuilder } = createPhase2AStack();

  await profileService.updateProfile({
    ownerId: "customer-a",
    agentId: "agent-1",
    patch: {
      aiDisplayName: "Asha",
      businessOrProfession: "Legal consultant",
      aiPurpose: "Help prospects understand services and book consultations.",
      preferredLanguages: ["English", "Hindi"],
      allowedToShare: ["General service descriptions"],
      restrictedPrivateInfo: ["Client case details"],
      alwaysFollow: ["Ask before collecting personal information"],
      neverDo: ["Do not give legal guarantees"],
    },
  });
  await instructionService.add({
    ownerId: "customer-a",
    agentId: "agent-1",
    category: "support",
    text: "Suggest booking a consultation for specific legal issues.",
  });

  const context = await contextBuilder.buildContext({ ownerId: "customer-a", agentId: "agent-1" });

  assert.equal(context.ownerId, "customer-a");
  assert.equal(context.customerId, "customer-a");
  assert.equal(context.agentId, "agent-1");
  assert.match(context.instructions, /You are a Personal AI Representative/);
  assert.match(context.instructions, /AI display name: Asha/);
  assert.match(context.instructions, /Preferred languages: English, Hindi/);
  assert.match(context.instructions, /Suggest booking a consultation/);
  assert.match(context.instructions, /Memory Placeholder/);
  assert.match(context.instructions, /Knowledge Placeholder/);
  assert.equal(context.memory.enabled, false);
  assert.equal(context.knowledge.enabled, false);
  assert.equal(context.conversationContext.enabled, false);
});

test("untrained profile still gives a general assistant context", async () => {
  const { contextBuilder } = createPhase2AStack();

  const context = await contextBuilder.buildContext({
    ownerId: "new-customer",
    agentId: "agent-1",
  });

  assert.match(context.instructions, /helpful, concise general AI assistant/);
  assert.equal(context.profile.onboardingStatus, "not_started");
  assert.deepEqual(context.ownerInstructions, []);
});

test("two-customer tenant isolation protects profiles instructions and onboarding answers", async () => {
  const { profileService, instructionService, onboardingService, contextBuilder } =
    createPhase2AStack();

  await profileService.updateProfile({
    ownerId: "customer-a",
    agentId: "shared-agent-id",
    patch: { businessOrProfession: "Dentist" },
  });
  await profileService.updateProfile({
    ownerId: "customer-b",
    agentId: "shared-agent-id",
    patch: { businessOrProfession: "Restaurant owner" },
  });
  await instructionService.add({
    ownerId: "customer-a",
    agentId: "shared-agent-id",
    category: "sales",
    text: "Mention dental cleaning packages.",
  });
  await onboardingService.startOnboarding({
    ownerId: "customer-a",
    agentId: "shared-agent-id",
  });
  await onboardingService.submitAnswer({
    ownerId: "customer-a",
    agentId: "shared-agent-id",
    questionId: "languages",
    answer: "Hindi",
  });

  const contextA = await contextBuilder.buildContext({
    ownerId: "customer-a",
    agentId: "shared-agent-id",
  });
  const contextB = await contextBuilder.buildContext({
    ownerId: "customer-b",
    agentId: "shared-agent-id",
  });
  const progressB = await onboardingService.getProgress({
    ownerId: "customer-b",
    agentId: "shared-agent-id",
  });

  assert.match(contextA.instructions, /Dentist/);
  assert.match(contextA.instructions, /dental cleaning packages/);
  assert.match(contextA.instructions, /Preferred languages: Hindi/);
  assert.match(contextB.instructions, /Restaurant owner/);
  assert.doesNotMatch(contextB.instructions, /dental cleaning packages/);
  assert.doesNotMatch(contextB.instructions, /Preferred languages: Hindi/);
  assert.equal(progressB.status, "not_started");
});

test("agent ID cannot bypass owner isolation", async () => {
  const { profileService, instructionService, contextBuilder } = createPhase2AStack();

  await profileService.updateProfile({
    ownerId: "customer-a",
    agentId: "public-looking-agent",
    patch: { businessOrProfession: "Private wealth advisor" },
  });
  await instructionService.add({
    ownerId: "customer-a",
    agentId: "public-looking-agent",
    category: "privacy",
    text: "Never disclose client portfolio details.",
  });

  const attackerContext = await contextBuilder.buildContext({
    ownerId: "customer-b",
    agentId: "public-looking-agent",
  });

  assert.equal(attackerContext.profile.ownerId, "customer-b");
  assert.equal(attackerContext.profile.businessOrProfession, "");
  assert.doesNotMatch(attackerContext.instructions, /Private wealth advisor/);
  assert.doesNotMatch(attackerContext.instructions, /portfolio details/);
});

test("Agent Service uses centralized context builder for representative requests", async () => {
  const { profileService, instructionService, contextBuilder } = createPhase2AStack();
  const turns = [];

  await profileService.updateProfile({
    ownerId: "123",
    agentId: "agent-1",
    patch: { aiDisplayName: "Asha" },
  });
  await instructionService.add({
    ownerId: "123",
    agentId: "agent-1",
    category: "communication",
    text: "Keep replies crisp.",
  });

  const service = createAgentService({
    contextBuilder,
    requireSession: async () => ({ ok: true }),
    runTurn: async (request) => {
      turns.push(request);
      return {
        ok: true,
        code: "ok",
        message: "reply",
      };
    },
  });

  const result = await service.handleRepresentativeMessage({
    botUserId: 123,
    chat: { id: 123, type: "private" },
    text: "hello",
    agentId: "agent-1",
  });

  assert.equal(result.ok, true);
  assert.match(turns[0].context.instructions, /AI display name: Asha/);
  assert.match(turns[0].context.instructions, /Keep replies crisp/);
});
