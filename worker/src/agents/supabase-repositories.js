import { normalizeAgentId, normalizeOwnerId } from "./profile-service.js";

function assertNoError(result, label) {
  if (result?.error) {
    throw new Error(`${label}: ${result.error.message || result.error}`);
  }
  return result?.data ?? null;
}

function listValue(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function profileFromRow(row) {
  if (!row) return null;
  return {
    ownerId: String(row.owner_id),
    customerId: String(row.owner_id),
    agentId: String(row.agent_id),
    aiDisplayName: row.display_name || "Personal AI Representative",
    ownerName: row.owner_name || "",
    businessOrProfession: row.business_profession || "",
    businessDescription: row.business_description || "",
    aiPurpose:
      row.purpose || "Act as a helpful general AI assistant until the owner configures a profile.",
    preferredLanguages: listValue(row.preferred_languages),
    communicationTone: row.tone_style || "",
    productsServices: listValue(row.products_services),
    allowedToShare: listValue(row.allowed_information),
    restrictedPrivateInfo: listValue(row.restricted_information),
    alwaysFollow: listValue(row.always_follow_rules),
    neverDo: listValue(row.never_do_rules),
    onboardingStatus: row.onboarding_status || "not_started",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function profileToRow(profile) {
  return {
    owner_id: normalizeOwnerId(profile.ownerId),
    agent_id: normalizeAgentId(profile.agentId),
    display_name: profile.aiDisplayName,
    owner_name: profile.ownerName,
    business_profession: profile.businessOrProfession,
    business_description: profile.businessDescription,
    purpose: profile.aiPurpose,
    preferred_languages: profile.preferredLanguages || [],
    tone_style: profile.communicationTone,
    products_services: profile.productsServices || [],
    allowed_information: profile.allowedToShare || [],
    restricted_information: profile.restrictedPrivateInfo || [],
    always_follow_rules: profile.alwaysFollow || [],
    never_do_rules: profile.neverDo || [],
    onboarding_status: profile.onboardingStatus || "not_started",
  };
}

function instructionFromRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    agentId: String(row.agent_id),
    category: row.category,
    text: row.instruction,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function instructionToRow(instruction) {
  return {
    id: instruction.id,
    owner_id: normalizeOwnerId(instruction.ownerId),
    agent_id: normalizeAgentId(instruction.agentId),
    category: instruction.category || "custom",
    instruction: instruction.text,
    enabled: instruction.enabled !== false,
  };
}

function sessionFromRow(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    agentId: String(row.agent_id),
    status: row.status,
    currentStep: row.current_step || null,
    answers: row.answers || {},
    progress: row.progress || {},
    draftProfile: row.draft_profile || {},
    questionOrder: row.question_order || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sessionToRow(session) {
  return {
    id: session.id,
    owner_id: normalizeOwnerId(session.ownerId),
    agent_id: normalizeAgentId(session.agentId),
    status: session.status || "in_progress",
    current_step: session.currentStep || null,
    answers: session.answers || {},
    progress: session.progress || {},
    draft_profile: session.draftProfile || {},
    question_order: session.questionOrder || [],
  };
}

export class SupabaseAgentProfileRepository {
  constructor({ supabase }) {
    if (!supabase) throw new Error("supabase client is required.");
    this.supabase = supabase;
  }

  async getProfile({ ownerId, agentId }) {
    const result = await this.supabase
      .from("agent_profiles")
      .select("*")
      .eq("owner_id", normalizeOwnerId(ownerId))
      .eq("agent_id", normalizeAgentId(agentId))
      .maybeSingle();
    return profileFromRow(assertNoError(result, "Could not load agent profile"));
  }

  async saveProfile(profile) {
    const result = await this.supabase
      .from("agent_profiles")
      .upsert(profileToRow(profile), { onConflict: "owner_id,agent_id" })
      .select("*")
      .single();
    return profileFromRow(assertNoError(result, "Could not save agent profile"));
  }
}

export class SupabaseInstructionRepository {
  constructor({ supabase }) {
    if (!supabase) throw new Error("supabase client is required.");
    this.supabase = supabase;
  }

  async addInstruction({ ownerId, agentId, category = "custom", text }) {
    const result = await this.supabase
      .from("owner_instructions")
      .insert({
        owner_id: normalizeOwnerId(ownerId),
        agent_id: normalizeAgentId(agentId),
        category,
        instruction: String(text || "").trim(),
        enabled: true,
      })
      .select("*")
      .single();
    return instructionFromRow(assertNoError(result, "Could not add owner instruction"));
  }

  async listInstructions({ ownerId, agentId }) {
    const result = await this.supabase
      .from("owner_instructions")
      .select("*")
      .eq("owner_id", normalizeOwnerId(ownerId))
      .eq("agent_id", normalizeAgentId(agentId))
      .order("created_at", { ascending: true });
    const rows = assertNoError(result, "Could not list owner instructions") || [];
    return rows.map(instructionFromRow);
  }

  async getInstruction({ ownerId, agentId, instructionId }) {
    const result = await this.supabase
      .from("owner_instructions")
      .select("*")
      .eq("owner_id", normalizeOwnerId(ownerId))
      .eq("agent_id", normalizeAgentId(agentId))
      .eq("id", String(instructionId || ""))
      .maybeSingle();
    return instructionFromRow(assertNoError(result, "Could not load owner instruction"));
  }

  async saveInstruction(instruction) {
    const result = await this.supabase
      .from("owner_instructions")
      .update(instructionToRow(instruction))
      .eq("owner_id", normalizeOwnerId(instruction.ownerId))
      .eq("agent_id", normalizeAgentId(instruction.agentId))
      .eq("id", String(instruction.id || ""))
      .select("*")
      .single();
    return instructionFromRow(assertNoError(result, "Could not save owner instruction"));
  }
}

export class SupabaseOnboardingRepository {
  constructor({ supabase }) {
    if (!supabase) throw new Error("supabase client is required.");
    this.supabase = supabase;
  }

  async getSession({ ownerId, agentId }) {
    const result = await this.supabase
      .from("onboarding_sessions")
      .select("*")
      .eq("owner_id", normalizeOwnerId(ownerId))
      .eq("agent_id", normalizeAgentId(agentId))
      .maybeSingle();
    return sessionFromRow(assertNoError(result, "Could not load onboarding session"));
  }

  async saveSession(session) {
    const result = await this.supabase
      .from("onboarding_sessions")
      .upsert(sessionToRow(session), { onConflict: "owner_id,agent_id" })
      .select("*")
      .single();
    return sessionFromRow(assertNoError(result, "Could not save onboarding session"));
  }
}

export const __testMappings = {
  profileFromRow,
  profileToRow,
  instructionFromRow,
  instructionToRow,
  sessionFromRow,
  sessionToRow,
};
