import { randomUUID } from "node:crypto";

export const MODEL_ROLES = Object.freeze(["fast", "general", "reasoning", "coding", "embedding"]);

export const DEFAULT_MODEL_ROLE = "general";

export function normalizeModelRole(role) {
  const value = String(role || DEFAULT_MODEL_ROLE).trim();

  if (!MODEL_ROLES.includes(value)) {
    throw new Error(`Unsupported AI model role: ${value}`);
  }

  return value;
}

export function createAgentContext({
  ownerId,
  customerId,
  agentId = "personal-representative",
  instructions = null,
  memory = null,
  knowledge = null,
  conversationContext = null,
  profile = null,
  ownerInstructions = [],
} = {}) {
  return {
    ownerId: ownerId == null ? null : String(ownerId),
    customerId: customerId == null ? null : String(customerId),
    agentId,
    instructions,
    memory,
    knowledge,
    conversationContext,
    profile,
    ownerInstructions,
  };
}

export function createAiRequest({
  id = randomUUID(),
  source = "telegram",
  modelRole = DEFAULT_MODEL_ROLE,
  input,
  context,
  config = {},
  metadata = {},
} = {}) {
  return {
    id,
    source,
    model: {
      role: normalizeModelRole(modelRole),
    },
    input: {
      text: String(input?.text || ""),
      chat: input?.chat || null,
    },
    context: context || createAgentContext(),
    config,
    metadata,
  };
}

export function createAiResponse({
  requestId = null,
  ok = true,
  code = "ok",
  message = "",
  modelRole = DEFAULT_MODEL_ROLE,
  providerId = null,
  output = {},
} = {}) {
  return {
    ok,
    code,
    message,
    requestId,
    model: {
      role: normalizeModelRole(modelRole),
      providerId,
    },
    output,
  };
}

export function createAiErrorResponse({
  requestId = null,
  code,
  message,
  modelRole = DEFAULT_MODEL_ROLE,
  providerId = null,
} = {}) {
  return createAiResponse({
    requestId,
    ok: false,
    code,
    message,
    modelRole,
    providerId,
  });
}
