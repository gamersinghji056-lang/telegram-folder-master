import { modelRouter } from "./model-router.js";
import { createAiErrorResponse, createAiResponse, DEFAULT_MODEL_ROLE } from "./contract.js";

function nowMs() {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

function isLocalDevMode(env = process.env) {
  return truthy(env.LOCAL_DEV_MODE);
}

function logLocalDevAiTiming({ env, logger, role, model, providerMs, totalMs }) {
  if (!isLocalDevMode(env)) return;

  logger.log?.(
    `[AI] role=${role} model=${model || "unknown"} provider_ms=${providerMs} total_ms=${totalMs}`,
  );
}

function safeDiagnosticText(value) {
  return String(value || "unknown")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function logLocalDevAiProviderError({ env, logger, role, model, error }) {
  if (!isLocalDevMode(env)) return;

  const code = safeDiagnosticText(error?.providerCode || error?.code || error?.name || "error");
  const status = error?.httpStatus == null ? "none" : safeDiagnosticText(error.httpStatus);
  const detail = safeDiagnosticText(error?.providerDetail || error?.message);

  logger.error?.(
    `[AI_ERROR] role=${role} model=${model || "unknown"} code=${code} status=${status} detail=${detail}`,
  );
}

export function createAiOrchestrator({
  router = modelRouter,
  env = process.env,
  logger = console,
  clock = nowMs,
} = {}) {
  return {
    async runAiTurn(request) {
      const totalStart = clock();
      const modelRole =
        router.selectModelRole?.(request) || request.model?.role || DEFAULT_MODEL_ROLE;
      const routedRequest = {
        ...request,
        model: {
          ...(request.model || {}),
          role: modelRole,
        },
      };
      const provider = router.selectProvider(request);

      if (!provider) {
        return createAiErrorResponse({
          requestId: request.id,
          code: "ai_provider_not_configured",
          message: "AI provider is not configured yet.",
          modelRole,
        });
      }

      try {
        const selectedModel = provider.modelNameForRequest?.(routedRequest) ?? null;
        const providerStart = clock();
        const result = await provider.complete(routedRequest);
        const providerMs = Math.max(0, Math.round(clock() - providerStart));
        const totalMs = Math.max(0, Math.round(clock() - totalStart));
        const modelName = result?.output?.model || selectedModel;

        logLocalDevAiTiming({
          env,
          logger,
          role: modelRole,
          model: modelName,
          providerMs,
          totalMs,
        });

        return createAiResponse({
          requestId: request.id,
          ok: result?.ok !== false,
          code: result?.code || "ok",
          message: result?.message || result?.text || "",
          modelRole,
          providerId: provider.id,
          output: {
            ...(result?.output || {}),
            telemetry: {
              providerMs,
              totalMs,
              modelRole,
              model: modelName ?? null,
            },
          },
        });
      } catch (e) {
        const totalMs = Math.max(0, Math.round(clock() - totalStart));
        const modelName = provider.modelNameForRequest?.(routedRequest) ?? null;
        logLocalDevAiTiming({
          env,
          logger,
          role: modelRole,
          model: modelName,
          providerMs: totalMs,
          totalMs,
        });
        logLocalDevAiProviderError({
          env,
          logger,
          role: modelRole,
          model: modelName,
          error: e,
        });

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
