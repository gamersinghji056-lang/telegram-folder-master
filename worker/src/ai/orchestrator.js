import { modelRouter } from "./model-router.js";
import { createAiErrorResponse, createAiResponse, DEFAULT_MODEL_ROLE } from "./contract.js";

export function createAiOrchestrator({ router = modelRouter } = {}) {
  return {
    async runAiTurn(request) {
      const modelRole =
        router.selectModelRole?.(request) || request.model?.role || DEFAULT_MODEL_ROLE;
      const provider = router.selectProvider(request);

      if (!provider) {
        return createAiErrorResponse({
          requestId: request.id,
          code: "ai_provider_not_configured",
          message: "Personal AI Representative is not connected to an AI provider yet.",
          modelRole,
        });
      }

      try {
        const result = await provider.complete(request);

        return createAiResponse({
          requestId: request.id,
          ok: result?.ok !== false,
          code: result?.code || "ok",
          message: result?.message || result?.text || "",
          modelRole,
          providerId: provider.id,
          output: result?.output || {},
        });
      } catch (e) {
        return createAiErrorResponse({
          requestId: request.id,
          code: "ai_provider_failed",
          message: "Personal AI Representative could not complete that request safely.",
          modelRole,
          providerId: provider.id,
        });
      }
    },
  };
}

export const aiOrchestrator = createAiOrchestrator();

export async function runAiTurn(request) {
  return aiOrchestrator.runAiTurn(request);
}
