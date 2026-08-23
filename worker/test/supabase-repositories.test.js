import assert from "node:assert/strict";
import test from "node:test";

import { createCustomerAiContextBuilder } from "../src/agents/context-builder.js";
import { createOwnerInstructionService } from "../src/agents/instruction-service.js";
import { createOnboardingService } from "../src/agents/onboarding-service.js";
import { createAgentProfileService } from "../src/agents/profile-service.js";
import {
  __testMappings,
  SupabaseAgentProfileRepository,
  SupabaseInstructionRepository,
  SupabaseOnboardingRepository,
} from "../src/agents/supabase-repositories.js";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const AGENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createFakeSupabase(seed = {}) {
  const tables = {
    agent_profiles: [],
    owner_instructions: [],
    onboarding_sessions: [],
    ...seed,
  };
  const queries = [];
  let idCounter = 1;

  function nextId() {
    const id = `${String(idCounter).padStart(8, "0")}-0000-4000-8000-000000000000`;
    idCounter += 1;
    return id;
  }

  function timestamp() {
    return "2026-08-24T00:00:00.000Z";
  }

  function match(row, filters) {
    return filters.every(({ column, value }) => row[column] === value);
  }

  class Builder {
    constructor(table) {
      this.table = table;
      this.operation = "select";
      this.filters = [];
      this.payload = null;
      this.singleMode = "list";
      this.orderBy = null;
      queries.push(this);
    }

    select() {
      return this;
    }

    eq(column, value) {
      this.filters.push({ column, value });
      return this;
    }

    order(column, options) {
      this.orderBy = { column, options };
      return this;
    }

    insert(payload) {
      this.operation = "insert";
      this.payload = payload;
      return this;
    }

    upsert(payload) {
      this.operation = "upsert";
      this.payload = payload;
      return this;
    }

    update(payload) {
      this.operation = "update";
      this.payload = payload;
      return this;
    }

    maybeSingle() {
      this.singleMode = "maybeSingle";
      return this.execute();
    }

    single() {
      this.singleMode = "single";
      return this.execute();
    }

    then(resolve, reject) {
      return this.execute().then(resolve, reject);
    }

    execute() {
      const rows = tables[this.table];
      let data;

      if (this.operation === "insert") {
        const row = {
          id: nextId(),
          created_at: timestamp(),
          updated_at: timestamp(),
          ...this.payload,
        };
        rows.push(row);
        data = row;
      } else if (this.operation === "upsert") {
        const existing = rows.find(
          (row) => row.owner_id === this.payload.owner_id && row.agent_id === this.payload.agent_id,
        );
        if (existing) {
          Object.assign(existing, this.payload, { updated_at: timestamp() });
          data = existing;
        } else {
          const row = {
            id: this.payload.id || nextId(),
            created_at: timestamp(),
            updated_at: timestamp(),
            ...this.payload,
          };
          rows.push(row);
          data = row;
        }
      } else if (this.operation === "update") {
        const row = rows.find((item) => match(item, this.filters));
        if (row) {
          Object.assign(row, this.payload, { updated_at: timestamp() });
        }
        data = row ?? null;
      } else {
        data = rows.filter((row) => match(row, this.filters));
        if (this.orderBy) {
          data = [...data].sort((a, b) =>
            String(a[this.orderBy.column] || "").localeCompare(
              String(b[this.orderBy.column] || ""),
            ),
          );
        }
      }

      if (this.singleMode === "maybeSingle") {
        data = Array.isArray(data) ? (data[0] ?? null) : data;
      } else if (this.singleMode === "single") {
        data = Array.isArray(data) ? data[0] : data;
      }

      return Promise.resolve({ data, error: null });
    }
  }

  return {
    tables,
    queries,
    from(table) {
      if (!tables[table]) throw new Error(`Unknown fake table ${table}`);
      return new Builder(table);
    },
  };
}

test("Supabase row mappings preserve Phase 2A profile instruction and onboarding shapes", () => {
  const profile = __testMappings.profileFromRow({
    owner_id: OWNER_A,
    agent_id: AGENT_A,
    display_name: "Asha",
    owner_name: "Owner A",
    business_profession: "Consultant",
    business_description: "Advisory firm",
    purpose: "Answer leads",
    preferred_languages: ["English", "Hindi"],
    tone_style: "warm",
    products_services: ["Consulting"],
    allowed_information: ["Pricing ranges"],
    restricted_information: ["Client details"],
    always_follow_rules: ["Be concise"],
    never_do_rules: ["No guarantees"],
    onboarding_status: "completed",
    created_at: "created",
    updated_at: "updated",
  });
  const instruction = __testMappings.instructionFromRow({
    id: "inst-1",
    owner_id: OWNER_A,
    agent_id: AGENT_A,
    category: "privacy",
    instruction: "Do not share secrets.",
    enabled: false,
    created_at: "created",
    updated_at: "updated",
  });
  const session = __testMappings.sessionFromRow({
    id: "session-1",
    owner_id: OWNER_A,
    agent_id: AGENT_A,
    status: "in_progress",
    current_step: "languages",
    answers: { languages: ["Hindi"] },
    progress: { answered: 1 },
    draft_profile: { ownerId: OWNER_A },
    question_order: ["languages"],
    created_at: "created",
    updated_at: "updated",
  });

  assert.equal(profile.ownerId, OWNER_A);
  assert.equal(profile.aiDisplayName, "Asha");
  assert.deepEqual(profile.preferredLanguages, ["English", "Hindi"]);
  assert.equal(instruction.text, "Do not share secrets.");
  assert.equal(instruction.enabled, false);
  assert.deepEqual(session.answers, { languages: ["Hindi"] });
  assert.deepEqual(session.questionOrder, ["languages"]);
});

test("Supabase profile repository uses owner-scoped queries and blocks cross-tenant reads", async () => {
  const fake = createFakeSupabase({
    agent_profiles: [
      {
        id: "profile-a",
        owner_id: OWNER_A,
        agent_id: AGENT_A,
        display_name: "Asha",
        preferred_languages: [],
        products_services: [],
        allowed_information: [],
        restricted_information: [],
        always_follow_rules: [],
        never_do_rules: [],
        created_at: "created",
        updated_at: "updated",
      },
    ],
  });
  const repository = new SupabaseAgentProfileRepository({ supabase: fake });

  const ownProfile = await repository.getProfile({ ownerId: OWNER_A, agentId: AGENT_A });
  const otherProfile = await repository.getProfile({ ownerId: OWNER_B, agentId: AGENT_A });

  assert.equal(ownProfile.aiDisplayName, "Asha");
  assert.equal(otherProfile, null);
  assert.deepEqual(fake.queries[0].filters, [
    { column: "owner_id", value: OWNER_A },
    { column: "agent_id", value: AGENT_A },
  ]);
  assert.deepEqual(fake.queries[1].filters, [
    { column: "owner_id", value: OWNER_B },
    { column: "agent_id", value: AGENT_A },
  ]);
});

test("Supabase profile repository inserts and updates through the existing service interface", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseAgentProfileRepository({ supabase: fake });
  const service = createAgentProfileService({ repository });

  await service.updateProfile({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    patch: {
      aiDisplayName: "Asha",
      businessOrProfession: "Designer",
    },
  });
  await service.updateProfile({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    patch: {
      businessDescription: "Studio",
    },
  });

  const row = fake.tables.agent_profiles[0];
  const profile = await service.getProfile({ ownerId: OWNER_A, agentId: AGENT_A });

  assert.equal(fake.tables.agent_profiles.length, 1);
  assert.equal(row.owner_id, OWNER_A);
  assert.equal(row.agent_id, AGENT_A);
  assert.equal(row.display_name, "Asha");
  assert.equal(row.business_profession, "Designer");
  assert.equal(profile.businessDescription, "Studio");
});

test("Supabase instruction repository insert update list and disabled filtering remain service-owned", async () => {
  const fake = createFakeSupabase();
  const repository = new SupabaseInstructionRepository({ supabase: fake });
  const service = createOwnerInstructionService({ repository });

  const active = await service.add({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    category: "support",
    text: "Be helpful.",
  });
  const disabled = await service.add({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    category: "privacy",
    text: "Disabled privacy rule.",
  });
  await service.update({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    instructionId: active.id,
    patch: { text: "Be practical." },
  });
  await service.disable({ ownerId: OWNER_A, agentId: AGENT_A, instructionId: disabled.id });

  const activeRows = await service.list({ ownerId: OWNER_A, agentId: AGENT_A });
  const allRows = await service.list({ ownerId: OWNER_A, agentId: AGENT_A, includeDisabled: true });
  const otherTenantRows = await service.list({ ownerId: OWNER_B, agentId: AGENT_A });

  assert.deepEqual(
    activeRows.map((row) => row.text),
    ["Be practical."],
  );
  assert.equal(allRows.length, 2);
  assert.equal(otherTenantRows.length, 0);
  assert(fake.queries.some((query) => query.table === "owner_instructions"));
  assert(
    fake.queries
      .filter((query) => query.table === "owner_instructions" && query.operation !== "insert")
      .every((query) => query.filters.some((filter) => filter.column === "owner_id")),
  );
});

test("Supabase onboarding repository persists mapped sessions through onboarding service", async () => {
  const fake = createFakeSupabase();
  const profileService = createAgentProfileService({
    repository: new SupabaseAgentProfileRepository({ supabase: fake }),
  });
  const onboardingService = createOnboardingService({
    repository: new SupabaseOnboardingRepository({ supabase: fake }),
    profileService,
  });

  await onboardingService.startOnboarding({ ownerId: OWNER_A, agentId: AGENT_A });
  await onboardingService.submitAnswer({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    questionId: "languages",
    answer: "English, Hindi",
  });
  const progress = await onboardingService.getProgress({ ownerId: OWNER_A, agentId: AGENT_A });
  const otherProgress = await onboardingService.getProgress({ ownerId: OWNER_B, agentId: AGENT_A });
  const completed = await onboardingService.completeOnboarding({
    ownerId: OWNER_A,
    agentId: AGENT_A,
  });

  assert.equal(fake.tables.onboarding_sessions.length, 1);
  assert.deepEqual(fake.tables.onboarding_sessions[0].answers.languages, ["English", "Hindi"]);
  assert.equal(progress.answered, 1);
  assert.equal(otherProgress.status, "not_started");
  assert.equal(completed.profile.onboardingStatus, "completed");
});

test("Supabase repositories plug into context builder without rewriting Agent Service", async () => {
  const fake = createFakeSupabase();
  const profileService = createAgentProfileService({
    repository: new SupabaseAgentProfileRepository({ supabase: fake }),
  });
  const instructionService = createOwnerInstructionService({
    repository: new SupabaseInstructionRepository({ supabase: fake }),
  });
  const contextBuilder = createCustomerAiContextBuilder({ profileService, instructionService });

  await profileService.updateProfile({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    patch: { aiDisplayName: "Asha", businessOrProfession: "Coach" },
  });
  await instructionService.add({
    ownerId: OWNER_A,
    agentId: AGENT_A,
    category: "communication",
    text: "Use simple language.",
  });

  const contextA = await contextBuilder.buildContext({ ownerId: OWNER_A, agentId: AGENT_A });
  const contextB = await contextBuilder.buildContext({ ownerId: OWNER_B, agentId: AGENT_A });

  assert.match(contextA.instructions, /AI display name: Asha/);
  assert.match(contextA.instructions, /Use simple language/);
  assert.doesNotMatch(contextB.instructions, /AI display name: Asha/);
  assert.doesNotMatch(contextB.instructions, /Use simple language/);
});
