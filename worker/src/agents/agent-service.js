import { createAiRequest } from "../ai/contract.js";
import { runAiTurn } from "../ai/orchestrator.js";
import { requireLinkedSession } from "../auth/linked-session.js";
import { createCustomerAiContextBuilder } from "./context-builder.js";
import { agentProfileService, DEFAULT_AGENT_ID } from "./profile-service.js";
import { ownerInstructionService } from "./instruction-service.js";

export const defaultCustomerAiContextBuilder = createCustomerAiContextBuilder({
  profileService: agentProfileService,
  instructionService: ownerInstructionService,
});

export function createAgentService({
  requireSession = requireLinkedSession,
  runTurn = runAiTurn,
  defaultAgentId = DEFAULT_AGENT_ID,
  contextBuilder = defaultCustomerAiContextBuilder,
} = {}) {
  return {
    async buildAgentContext({ botUserId, agentId = defaultAgentId } = {}) {
      return contextBuilder.buildContext({
        ownerId: botUserId,
        customerId: botUserId,
        agentId,
      });
    },

    async handleRepresentativeMessage({
      botUserId,
      chat,
      text,
      modelRole = "general",
      agentId = defaultAgentId,
    }) {
      await requireSession(botUserId);

      const context = await this.buildAgentContext({ botUserId, agentId });
      const request = createAiRequest({
        source: "telegram",
        modelRole,
        input: {
          text,
          chat,
        },
        context,
        metadata: {
          botUserId,
        },
      });

      const result = await runTurn(request);

      return {
        ok: result.ok,
        text: result.message,
        code: result.code,
        request,
        context,
      };
    },
  };
}

export const agentService = createAgentService();

export async function handleRepresentativeMessage(payload) {
  return agentService.handleRepresentativeMessage(payload);
}
