import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  normalizeOwnerId,
  tenantKey,
} from "./profile-service.js";

export const INSTRUCTION_CATEGORIES = Object.freeze([
  "communication",
  "business_rule",
  "privacy",
  "sales",
  "support",
  "custom",
]);

function normalizeCategory(category = "custom") {
  const value = String(category || "custom").trim();
  if (!INSTRUCTION_CATEGORIES.includes(value)) {
    throw new Error(`Unsupported instruction category: ${value}`);
  }
  return value;
}

function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

function instructionId({ ownerId, agentId, clock }) {
  const raw = `${tenantKey(ownerId, agentId)}::${nowIso(clock)}::${Math.random()
    .toString(36)
    .slice(2)}`;
  return Buffer.from(raw).toString("base64url");
}

export function createInMemoryOwnerInstructionRepository({ clock = () => new Date() } = {}) {
  const rows = new Map();

  return {
    async addInstruction({ ownerId, agentId = DEFAULT_AGENT_ID, category = "custom", text }) {
      const cleanText = String(text || "").trim();
      if (!cleanText) throw new Error("Instruction text is required.");

      const timestamp = nowIso(clock);
      const row = {
        id: instructionId({ ownerId, agentId, clock }),
        ownerId: normalizeOwnerId(ownerId),
        agentId: normalizeAgentId(agentId),
        category: normalizeCategory(category),
        text: cleanText,
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      rows.set(row.id, row);
      return row;
    },

    async listInstructions({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      const owner = normalizeOwnerId(ownerId);
      const agent = normalizeAgentId(agentId);
      return Array.from(rows.values())
        .filter((row) => row.ownerId === owner && row.agentId === agent)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    },

    async getInstruction({ ownerId, agentId = DEFAULT_AGENT_ID, instructionId: id }) {
      const row = rows.get(String(id || ""));
      if (!row) return null;
      if (row.ownerId !== normalizeOwnerId(ownerId) || row.agentId !== normalizeAgentId(agentId)) {
        return null;
      }
      return row;
    },

    async saveInstruction(row) {
      rows.set(row.id, {
        ...row,
        updatedAt: nowIso(clock),
      });
      return rows.get(row.id);
    },

    async clear() {
      rows.clear();
    },
  };
}

export function createOwnerInstructionService({
  repository = createInMemoryOwnerInstructionRepository(),
} = {}) {
  return {
    async add({ ownerId, agentId = DEFAULT_AGENT_ID, category = "custom", text }) {
      return repository.addInstruction({ ownerId, agentId, category, text });
    },

    async list({ ownerId, agentId = DEFAULT_AGENT_ID, includeDisabled = false }) {
      const rows = await repository.listInstructions({ ownerId, agentId });
      return includeDisabled ? rows : rows.filter((row) => row.enabled);
    },

    async update({ ownerId, agentId = DEFAULT_AGENT_ID, instructionId: id, patch = {} }) {
      const row = await repository.getInstruction({ ownerId, agentId, instructionId: id });
      if (!row) throw new Error("Instruction not found.");
      const next = {
        ...row,
      };
      if ("category" in patch) next.category = normalizeCategory(patch.category);
      if ("text" in patch) {
        const text = String(patch.text || "").trim();
        if (!text) throw new Error("Instruction text is required.");
        next.text = text;
      }
      if ("enabled" in patch) next.enabled = Boolean(patch.enabled);
      return repository.saveInstruction(next);
    },

    async disable({ ownerId, agentId = DEFAULT_AGENT_ID, instructionId: id }) {
      return this.update({ ownerId, agentId, instructionId: id, patch: { enabled: false } });
    },

    async remove({ ownerId, agentId = DEFAULT_AGENT_ID, instructionId: id }) {
      return this.disable({ ownerId, agentId, instructionId: id });
    },
  };
}

export const ownerInstructionRepository = createInMemoryOwnerInstructionRepository();
export const ownerInstructionService = createOwnerInstructionService({
  repository: ownerInstructionRepository,
});
