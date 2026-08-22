export function createModelRegistry() {
  const providers = new Map();

  return {
    registerModelProvider(provider) {
      if (!provider?.id || typeof provider.complete !== "function") {
        throw new Error("AI model provider must include an id and complete() method.");
      }

      providers.set(provider.id, provider);
      return provider;
    },

    getModelProvider(providerId) {
      return providers.get(providerId) ?? null;
    },

    listModelProviders() {
      return Array.from(providers.values()).map((provider) => ({
        id: provider.id,
        name: provider.name,
        roles: provider.roles || [],
      }));
    },

    clearModelProviders() {
      providers.clear();
    },
  };
}

export const modelRegistry = createModelRegistry();

export const registerModelProvider = modelRegistry.registerModelProvider;
export const getModelProvider = modelRegistry.getModelProvider;
export const listModelProviders = modelRegistry.listModelProviders;
export const clearModelProviders = modelRegistry.clearModelProviders;
