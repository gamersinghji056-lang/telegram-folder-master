import { DEFAULT_AGENT_ID } from "./profile-service.js";
import { agentProfileService } from "./profile-service.js";
import { ownerInstructionService } from "./instruction-service.js";
import { createOnboardingService, onboardingRepository } from "./onboarding-service.js";

function formatQuestion(question) {
  return question?.prompt || "";
}

function progressLine(progress) {
  return `Training progress: ${progress.answered}/${progress.total} (${progress.percent}%)`;
}

function normalizeInstructionText(text) {
  return String(text || "").trim();
}

export function createTrainingService({
  onboardingService,
  instructionService,
  defaultAgentId = DEFAULT_AGENT_ID,
} = {}) {
  if (!onboardingService) throw new Error("onboardingService is required.");
  if (!instructionService) throw new Error("instructionService is required.");

  async function activeProgress({ ownerId, agentId = defaultAgentId }) {
    const progress = await onboardingService.getProgress({ ownerId, agentId });
    return progress.status === "in_progress" ? progress : null;
  }

  return {
    async start({ ownerId, agentId = defaultAgentId }) {
      const session = await onboardingService.resumeOrStartOnboarding({ ownerId, agentId });
      if (session.status === "completed") {
        const progress = await onboardingService.getProgress({ ownerId, agentId });
        return {
          status: "completed",
          text: `Your Personal AI Representative training is complete.\n${progressLine(progress)}`,
        };
      }

      const question = await onboardingService.getNextQuestion({ ownerId, agentId });
      return {
        status: "in_progress",
        text: ["Let's set up your Personal AI Representative.", formatQuestion(question)].join(
          "\n",
        ),
      };
    },

    async isOnboardingActive({ ownerId, agentId = defaultAgentId }) {
      return Boolean(await activeProgress({ ownerId, agentId }));
    },

    async submitAnswer({ ownerId, agentId = defaultAgentId, answer }) {
      const question = await onboardingService.getNextQuestion({ ownerId, agentId });
      if (!question) {
        const progress = await onboardingService.getProgress({ ownerId, agentId });
        return {
          status: progress.status,
          text:
            progress.status === "completed"
              ? "Training is already complete."
              : "Training is not active. Send /train to start.",
        };
      }

      await onboardingService.submitAnswer({
        ownerId,
        agentId,
        questionId: question.id,
        answer,
      });

      const nextQuestion = await onboardingService.getNextQuestion({ ownerId, agentId });
      if (nextQuestion) {
        const progress = await onboardingService.getProgress({ ownerId, agentId });
        return {
          status: "in_progress",
          text: [progressLine(progress), formatQuestion(nextQuestion)].join("\n"),
        };
      }

      const completed = await onboardingService.completeOnboarding({ ownerId, agentId });
      const progress = await onboardingService.getProgress({ ownerId, agentId });
      return {
        status: "completed",
        profile: completed.profile,
        text: [
          "Training is complete. Your Personal AI Representative will use this profile in future replies.",
          progressLine(progress),
        ].join("\n"),
      };
    },

    async status({ ownerId, agentId = defaultAgentId }) {
      const progress = await onboardingService.getProgress({ ownerId, agentId });
      const question = await onboardingService.getNextQuestion({ ownerId, agentId });
      const lines = [progressLine(progress), `Status: ${progress.status}`];
      if (question) lines.push(formatQuestion(question));
      return {
        status: progress.status,
        text: lines.join("\n"),
      };
    },

    async cancel({ ownerId, agentId = defaultAgentId }) {
      const progress = await onboardingService.cancelOnboarding({ ownerId, agentId });
      return {
        status: progress.status,
        text:
          progress.status === "not_started"
            ? "Training is not active."
            : "Training cancelled. Send /train to start again.",
      };
    },

    async remember({ ownerId, agentId = defaultAgentId, text }) {
      const instructionText = normalizeInstructionText(text);
      if (!instructionText) {
        return {
          ok: false,
          text: "Usage: /remember <instruction>",
        };
      }

      const instruction = await instructionService.add({
        ownerId,
        agentId,
        category: "custom",
        text: instructionText,
      });

      return {
        ok: true,
        instruction,
        text: "Saved as an owner instruction for local training.",
      };
    },

    async listInstructions({ ownerId, agentId = defaultAgentId }) {
      const instructions = await instructionService.list({ ownerId, agentId });
      if (!instructions.length) {
        return {
          instructions,
          text: "No active owner instructions yet.",
        };
      }

      return {
        instructions,
        text: instructions
          .map(
            (instruction, index) => `${index + 1}. [${instruction.category}] ${instruction.text}`,
          )
          .join("\n"),
      };
    },
  };
}

const defaultOnboardingService = createOnboardingService({
  repository: onboardingRepository,
  profileService: agentProfileService,
});

export const trainingService = createTrainingService({
  onboardingService: defaultOnboardingService,
  instructionService: ownerInstructionService,
});
