import { getModelProvider } from "./model-registry.js";

export function createModelRouter({ defaultProviderId = null } = {}) {
  return {
    selectProvider(request = {}) {
      const providerId = request.providerId || defaultProviderId;

      if (!providerId) {
        return null;
      }

      return getModelProvider(providerId);
    },
  };
}

export const modelRouter = createModelRouter();
