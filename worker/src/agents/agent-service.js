import { createAgentContext, createAiRequest } from "../ai/contract.js";
import { runAiTurn } from "../ai/orchestrator.js";
import { requireLinkedSession } from "../auth/linked-session.js";

export function createAgentService({
  requireSession = requireLinkedSession,
  runTurn = runAiTurn,
  defaultAgentId = "personal-representative",
} = {}) {
  return {
    buildAgentContext({ botUserId, agentId = defaultAgentId } = {}) {
      return createAgentContext({
        ownerId: botUserId,
        customerId: botUserId,
        agentId,
        instructions: null,
        memory: null,
        knowledge: null,
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

      const context = this.buildAgentContext({ botUserId, agentId });
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
