import { requireLinkedSession } from "./auth/linked-session.js";
import { requireMiniUser } from "./mini-auth.js";
import { DEFAULT_AGENT_ID, agentProfileService } from "./agents/profile-service.js";
import { ownerInstructionService } from "./agents/instruction-service.js";
import { trainingService as defaultTrainingService } from "./agents/training-service.js";
import { onboardingRepository, createOnboardingService } from "./agents/onboarding-service.js";

const editableProfileFields = new Set([
  "aiDisplayName",
  "ownerName",
  "businessOrProfession",
  "businessDescription",
  "aiPurpose",
  "preferredLanguages",
  "communicationTone",
  "productsServices",
  "allowedToShare",
  "restrictedPrivateInfo",
  "alwaysFollow",
  "neverDo",
]);

function profilePatchFromPayload(payload = {}) {
  const source = payload.profile && typeof payload.profile === "object" ? payload.profile : payload;
  const patch = {};

  for (const field of editableProfileFields) {
    if (field in source) patch[field] = source[field];
  }

  return patch;
}

function instructionIdFromPayload(payload = {}) {
  const id = String(payload.instructionId || payload.id || "").trim();
  if (!id) throw new Error("Instruction ID is required.");
  return id;
}

export function createMiniTrainingHandlers({
  verifyMiniUser = requireMiniUser,
  requireSession = requireLinkedSession,
  profileService = agentProfileService,
  instructionService = ownerInstructionService,
  trainingService = defaultTrainingService,
  defaultAgentId = DEFAULT_AGENT_ID,
} = {}) {
  async function authorize(payload = {}) {
    const mini = verifyMiniUser(payload.initData);
    await requireSession(mini.botUserId);
    return {
      ownerId: mini.botUserId,
      agentId: defaultAgentId,
      botUser: mini.user,
    };
  }

  async function statusFor(ownerId, agentId) {
    const [training, profile, instructions] = await Promise.all([
      trainingService.status({ ownerId, agentId }),
      profileService.getProfile({ ownerId, agentId }),
      instructionService.list({ ownerId, agentId, includeDisabled: true }),
    ]);

    return {
      training,
      profile,
      instructions,
    };
  }

  return {
    miniAiTrainingStatus: async (payload = {}) => {
      const { ownerId, agentId, botUser } = await authorize(payload);
      return {
        ok: true,
        botUser,
        ...(await statusFor(ownerId, agentId)),
      };
    },

    miniAiTrainingStart: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const result = await trainingService.start({ ownerId, agentId });
      return {
        ok: true,
        result,
        ...(await statusFor(ownerId, agentId)),
      };
    },

    miniAiTrainingAnswer: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const result = await trainingService.submitAnswer({
        ownerId,
        agentId,
        answer: payload.answer,
      });
      return {
        ok: true,
        result,
        ...(await statusFor(ownerId, agentId)),
      };
    },

    miniAiTrainingCancel: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const result = await trainingService.cancel({ ownerId, agentId });
      return {
        ok: true,
        result,
        ...(await statusFor(ownerId, agentId)),
      };
    },

    miniAiProfileGet: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      return {
        ok: true,
        profile: await profileService.getProfile({ ownerId, agentId }),
      };
    },

    miniAiProfileUpdate: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const profile = await profileService.updateProfile({
        ownerId,
        agentId,
        patch: profilePatchFromPayload(payload),
      });
      return {
        ok: true,
        profile,
      };
    },

    miniAiInstructionsList: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      return {
        ok: true,
        instructions: await instructionService.list({
          ownerId,
          agentId,
          includeDisabled: Boolean(payload.includeDisabled),
        }),
      };
    },

    miniAiInstructionAdd: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const instruction = await instructionService.add({
        ownerId,
        agentId,
        category: payload.category || "custom",
        text: payload.text,
      });
      return {
        ok: true,
        instruction,
      };
    },

    miniAiInstructionUpdate: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const instruction = await instructionService.update({
        ownerId,
        agentId,
        instructionId: instructionIdFromPayload(payload),
        patch: payload.patch || payload,
      });
      return {
        ok: true,
        instruction,
      };
    },

    miniAiInstructionDisable: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const instruction = await instructionService.disable({
        ownerId,
        agentId,
        instructionId: instructionIdFromPayload(payload),
      });
      return {
        ok: true,
        instruction,
      };
    },

    miniAiInstructionEnable: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const instruction = await instructionService.update({
        ownerId,
        agentId,
        instructionId: instructionIdFromPayload(payload),
        patch: { enabled: true },
      });
      return {
        ok: true,
        instruction,
      };
    },

    miniAiInstructionRemove: async (payload = {}) => {
      const { ownerId, agentId } = await authorize(payload);
      const instruction = await instructionService.remove({
        ownerId,
        agentId,
        instructionId: instructionIdFromPayload(payload),
      });
      return {
        ok: true,
        instruction,
      };
    },
  };
}

const defaultOnboardingService = createOnboardingService({
  repository: onboardingRepository,
  profileService: agentProfileService,
});

export const miniTrainingHandlers = createMiniTrainingHandlers({
  trainingService: defaultTrainingService,
  profileService: agentProfileService,
  instructionService: ownerInstructionService,
  defaultAgentId: DEFAULT_AGENT_ID,
  // Keep the default onboarding service alive through the shared training service import.
  onboardingService: defaultOnboardingService,
});
