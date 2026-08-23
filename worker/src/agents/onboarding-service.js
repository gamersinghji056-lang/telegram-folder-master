import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  normalizeOwnerId,
  tenantKey,
} from "./profile-service.js";

export const STARTER_ONBOARDING_QUESTIONS = Object.freeze([
  {
    id: "owner_work",
    prompt: "What do you do?",
    profileField: "ownerName",
  },
  {
    id: "business_profession",
    prompt: "What is your business or profession?",
    profileField: "businessOrProfession",
  },
  {
    id: "ai_help",
    prompt: "What should your AI representative help with?",
    profileField: "aiPurpose",
  },
  {
    id: "languages",
    prompt: "Which languages should it prefer?",
    profileField: "preferredLanguages",
    type: "list",
  },
  {
    id: "style",
    prompt: "What communication style should it use?",
    profileField: "communicationTone",
  },
  {
    id: "products_services",
    prompt: "What products or services should it know about?",
    profileField: "productsServices",
    type: "list",
  },
  {
    id: "allowed_info",
    prompt: "What information is it allowed to share?",
    profileField: "allowedToShare",
    type: "list",
  },
  {
    id: "private_info",
    prompt: "What information must stay private?",
    profileField: "restrictedPrivateInfo",
    type: "list",
  },
  {
    id: "important_rules",
    prompt: "What important rules should it always follow?",
    profileField: "alwaysFollow",
    type: "list",
  },
]);

function nowIso(clock = () => new Date()) {
  return clock().toISOString();
}

function normalizeAnswer(question, answer) {
  if (question.type === "list") {
    return String(answer || "")
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return String(answer || "").trim();
}

export function createInMemoryOnboardingRepository({ clock = () => new Date() } = {}) {
  const sessions = new Map();

  return {
    async getSession({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      return sessions.get(tenantKey(ownerId, agentId)) ?? null;
    },

    async saveSession(session) {
      const timestamp = nowIso(clock);
      const key = tenantKey(session.ownerId, session.agentId);
      const current = sessions.get(key);
      const next = {
        ...session,
        ownerId: normalizeOwnerId(session.ownerId),
        agentId: normalizeAgentId(session.agentId),
        createdAt: session.createdAt || current?.createdAt || timestamp,
        updatedAt: timestamp,
      };
      sessions.set(key, next);
      return next;
    },

    async clear() {
      sessions.clear();
    },
  };
}

export function createOnboardingService({
  repository = createInMemoryOnboardingRepository(),
  profileService,
  questions = STARTER_ONBOARDING_QUESTIONS,
  clock = () => new Date(),
} = {}) {
  if (!profileService) throw new Error("profileService is required.");

  function questionById(questionId) {
    return questions.find((question) => question.id === questionId) ?? null;
  }

  function progress(session) {
    const answered = Object.keys(session.answers || {}).length;
    return {
      ownerId: session.ownerId,
      agentId: session.agentId,
      status: session.status,
      answered,
      total: questions.length,
      percent: questions.length ? Math.round((answered / questions.length) * 100) : 100,
    };
  }

  return {
    async startOnboarding({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      const profile = await profileService.updateProfile({
        ownerId,
        agentId,
        patch: { onboardingStatus: "in_progress" },
      });
      return repository.saveSession({
        ownerId: normalizeOwnerId(ownerId),
        agentId: normalizeAgentId(agentId),
        status: "in_progress",
        answers: {},
        draftProfile: profile,
        questionOrder: questions.map((question) => question.id),
        createdAt: nowIso(clock),
      });
    },

    async getNextQuestion({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      const session = await repository.getSession({ ownerId, agentId });
      if (!session || session.status === "completed") return null;
      const answered = new Set(Object.keys(session.answers || {}));
      const nextId = session.questionOrder.find((questionId) => !answered.has(questionId));
      return nextId ? questionById(nextId) : null;
    },

    async submitAnswer({ ownerId, agentId = DEFAULT_AGENT_ID, questionId, answer }) {
      const session = await repository.getSession({ ownerId, agentId });
      if (!session) throw new Error("Onboarding has not been started.");
      if (session.status === "completed") throw new Error("Onboarding is already completed.");

      const question = questionById(questionId);
      if (!question || !session.questionOrder.includes(question.id)) {
        throw new Error("Unknown onboarding question.");
      }

      const normalized = normalizeAnswer(question, answer);
      const draftProfile = {
        ...session.draftProfile,
        [question.profileField]: normalized,
        onboardingStatus: "in_progress",
      };
      const next = await repository.saveSession({
        ...session,
        answers: {
          ...session.answers,
          [question.id]: normalized,
        },
        draftProfile,
      });

      await profileService.updateProfile({
        ownerId,
        agentId,
        patch: {
          [question.profileField]: normalized,
          onboardingStatus: "in_progress",
        },
      });

      return next;
    },

    async getProgress({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      const session = await repository.getSession({ ownerId, agentId });
      if (!session) {
        return {
          ownerId: normalizeOwnerId(ownerId),
          agentId: normalizeAgentId(agentId),
          status: "not_started",
          answered: 0,
          total: questions.length,
          percent: 0,
        };
      }
      return progress(session);
    },

    async completeOnboarding({ ownerId, agentId = DEFAULT_AGENT_ID }) {
      const session = await repository.getSession({ ownerId, agentId });
      if (!session) throw new Error("Onboarding has not been started.");
      const profile = await profileService.updateProfile({
        ownerId,
        agentId,
        patch: {
          ...session.draftProfile,
          onboardingStatus: "completed",
        },
      });
      const completed = await repository.saveSession({
        ...session,
        status: "completed",
        draftProfile: profile,
      });
      return {
        session: completed,
        profile,
      };
    },
  };
}

export const onboardingRepository = createInMemoryOnboardingRepository();
