const providers = new Map();

export function registerModelProvider(provider) {
  if (!provider?.id || typeof provider.complete !== "function") {
    throw new Error("AI model provider must include an id and complete() method.");
  }

  providers.set(provider.id, provider);
  return provider;
}

export function getModelProvider(providerId) {
  return providers.get(providerId) ?? null;
}

export function listModelProviders() {
  return Array.from(providers.values()).map((provider) => ({
    id: provider.id,
    name: provider.name,
  }));
}
