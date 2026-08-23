const DEFAULT_AGENT_ID = "personal-representative";

function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

function tenantKey(ownerId, agentId) {
  const owner = normalizeOwnerId(ownerId);
  const agent = normalizeAgentId(agentId);
  return `${owner}::${agent}`;
}

function normalizeOwnerId(ownerId) {
  const value = String(ownerId ?? "").trim();
  if (!value) throw new Error("ownerId is required.");
  return value;
}

function normalizeAgentId(agentId = DEFAULT_AGENT_ID) {
  const value = String(agentId ?? DEFAULT_AGENT_ID).trim();
  if (!value) throw new Error("agentId is required.");
  return value;
}

export function createDefaultAgentProfile({
  ownerId,
  customerId = ownerId,
  agentId = DEFAULT_AGENT_ID,
  clock,
} = {}) {
  const createdAt = nowIso(clock);
  return {
    ownerId: normalizeOwnerId(ownerId),
    customerId: customerId == null ? normalizeOwnerId(ownerId) : String(customerId),
    agentId: normalizeAgentId(agentId),
    aiDisplayName: "Personal AI Representative",
    ownerName: "",
    businessOrProfession: "",
    businessDescription: "",
    aiPurpose: "Act as a helpful general AI assistant until the owner configures a profile.",
    preferredLanguages: [],
    communicationTone: "",
    productsServices: [],
    allowedToShare: [],
    restrictedPrivateInfo: [],
    alwaysFollow: [],
    neverDo: [],
    onboardingStatus: "not_started",
    createdAt,
    updatedAt: createdAt,
  };
}

export function createInMemoryAgentProfileRepository({ clock = () => new Date() } = {}) {
  const profiles = new Map();

  return {
    async getProfile({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      return profiles.get(tenantKey(ownerId, agentId)) ?? null;
    },

    async saveProfile(profile) {
      const key = tenantKey(profile.ownerId, profile.agentId);
      const current = profiles.get(key);
      const timestamp = nowIso(clock);
      const next = {
        ...profile,
        ownerId: normalizeOwnerId(profile.ownerId),
        agentId: normalizeAgentId(profile.agentId),
        customerId:
          profile.customerId == null
            ? normalizeOwnerId(profile.ownerId)
            : String(profile.customerId),
        createdAt: profile.createdAt || current?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      profiles.set(key, next);
      return next;
    },

    async clear() {
      profiles.clear();
    },
  };
}

function normalizeArray(value) {
  if (value == null) return undefined;
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [String(value).trim()].filter(Boolean);
}

function cleanPatch(patch = {}) {
  const next = {};
  const scalarFields = [
    "customerId",
    "aiDisplayName",
    "ownerName",
    "businessOrProfession",
    "businessDescription",
    "aiPurpose",
    "communicationTone",
    "onboardingStatus",
  ];
  const arrayFields = [
    "preferredLanguages",
    "productsServices",
    "allowedToShare",
    "restrictedPrivateInfo",
    "alwaysFollow",
    "neverDo",
  ];

  for (const field of scalarFields) {
    if (field in patch) next[field] = patch[field] == null ? "" : String(patch[field]);
  }

  for (const field of arrayFields) {
    if (field in patch) next[field] = normalizeArray(patch[field]) ?? [];
  }

  return next;
}

export function createAgentProfileService({
  repository = createInMemoryAgentProfileRepository(),
  clock = () => new Date(),
} = {}) {
  return {
    async getProfile({ ownerId, customerId = ownerId, agentId = DEFAULT_AGENT_ID }) {
      const existing = await repository.getProfile({ ownerId, agentId });
      return (
        existing ??
        createDefaultAgentProfile({
          ownerId,
          customerId,
          agentId,
          clock,
        })
      );
    },

    async updateProfile({ ownerId, agentId = DEFAULT_AGENT_ID, patch = {} }) {
      const current = await this.getProfile({ ownerId, agentId });
      return repository.saveProfile({
        ...current,
        ...cleanPatch(patch),
        ownerId: current.ownerId,
        agentId: current.agentId,
      });
    },
  };
}

export const agentProfileRepository = createInMemoryAgentProfileRepository();
export const agentProfileService = createAgentProfileService({
  repository: agentProfileRepository,
});

export { DEFAULT_AGENT_ID, normalizeAgentId, normalizeOwnerId, tenantKey };
