import { normalizeModelRole } from "./contract.js";
import { modelRegistry } from "./model-registry.js";

export function configuredRoleProviders(env = process.env) {
  if (!String(env.AI_BASE_URL || "").trim() || !String(env.AI_MODEL || "").trim()) {
    return {};
  }

  return {
    fast: "openai-compatible",
    general: "openai-compatible",
    reasoning: "openai-compatible",
    coding: "openai-compatible",
  };
}

export function createModelRouter({
  registry = modelRegistry,
  defaultProviderId = null,
  roleProviders = {},
} = {}) {
  return {
    selectModelRole(request = {}) {
      return normalizeModelRole(request.model?.role || request.modelRole);
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
