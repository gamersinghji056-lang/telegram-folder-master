import { normalizeModelRole } from "./contract.js";
import { modelRegistry } from "./model-registry.js";

export function configuredRoleProviders(env = process.env) {
  const hasBaseUrl = Boolean(String(env.AI_BASE_URL || "").trim());
  const fallbackModel = String(env.AI_MODEL || "").trim();
  const roleModels = {
    fast: String(env.AI_MODEL_FAST || fallbackModel).trim(),
    general: String(env.AI_MODEL_GENERAL || fallbackModel).trim(),
    reasoning: String(env.AI_MODEL_REASONING || fallbackModel).trim(),
    coding: String(env.AI_MODEL_CODING || fallbackModel).trim(),
    embedding: String(env.AI_MODEL_EMBEDDING || fallbackModel).trim(),
  };

  if (!hasBaseUrl || !Object.values(roleModels).some(Boolean)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(roleModels)
      .filter(([, model]) => Boolean(model))
      .map(([role]) => [role, "openai-compatible"]),
  );
}

function normalizedText(request = {}) {
  return String(request.input?.text || "")
    .trim()
    .toLowerCase();
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

export function routeModelRoleFromText(text) {
  const value = String(text || "").trim();
  const lower = value.toLowerCase();

  if (!lower) return "general";

  if (
    /(^|\s)(hi|hello|hey|namaste|namaskar|thanks|thank you|ok|okay|yes|no)([!.? ]|$)/i.test(
      value,
    ) &&
    wordCount(value) <= 6
  ) {
    return "fast";
  }

  if (
    /\b(code|coding|debug|debugging|program|programming|function|script|typescript|javascript|python|node\.?js|react|sql|api|stack trace|exception|compiler|runtime error|refactor|bug)\b/.test(
      lower,
    )
  ) {
    return "coding";
  }

  if (
    /\b(reason|reasoning|analyze|analysis|prove|proof|logic|step by step|trade[- ]?off|compare deeply|complex|multi-step|multi step|derive|deduce|why exactly)\b/.test(
      lower,
    )
  ) {
    return "reasoning";
  }

  return "general";
}

export function createModelRouter({
  registry = modelRegistry,
  defaultProviderId = null,
  roleProviders = {},
} = {}) {
  return {
    selectModelRole(request = {}) {
      const requestedRole = normalizeModelRole(request.model?.role || request.modelRole);

      if (requestedRole !== "general") {
        return requestedRole;
      }

      return normalizeModelRole(routeModelRoleFromText(normalizedText(request)));
    },

    selectProvider(request = {}) {
      const role = this.selectModelRole(request);
      const providerId = request.providerId || roleProviders[role] || defaultProviderId;

      if (!providerId) {
        return null;
      }

      const provider = registry.getModelProvider(providerId);

      if (!provider) {
        return null;
      }

      const roles = provider.roles || [];
      if (roles.length && !roles.includes(role)) {
        return null;
      }

      return provider;
    },
  };
}

export const modelRouter = createModelRouter({
  roleProviders: configuredRoleProviders(),
});
