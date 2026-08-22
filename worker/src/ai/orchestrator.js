import { modelRouter } from "./model-router.js";

export async function runAiTurn(request) {
  const provider = modelRouter.selectProvider(request);

  if (!provider) {
    return {
      ok: false,
      code: "ai_provider_not_configured",
      message: "Personal AI Representative is not connected to an AI provider yet.",
    };
  }

  return provider.complete(request);
}
