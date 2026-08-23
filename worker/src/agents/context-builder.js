import { createAgentContext } from "../ai/contract.js";
import { DEFAULT_AGENT_ID } from "./profile-service.js";

const BASE_INSTRUCTIONS = [
  "You are a Personal AI Representative.",
  "If no owner profile is configured yet, operate as a helpful, concise general AI assistant.",
  "Use only tenant-scoped profile, instructions, memory, knowledge, and conversation context.",
  "Do not invent private business facts. Ask concise clarifying questions when needed.",
].join("\n");

function section(title, lines) {
  const clean = Array.isArray(lines)
    ? lines.map((line) => String(line || "").trim()).filter(Boolean)
    : [String(lines || "").trim()].filter(Boolean);
  return clean.length ? [`## ${title}`, ...clean].join("\n") : null;
}

function listLines(items) {
  return (items || []).map((item) => `- ${item}`);
}

function profileSections(profile) {
  return [
    section("Agent Profile", [
      `AI display name: ${profile.aiDisplayName}`,
      profile.ownerName ? `Owner name: ${profile.ownerName}` : null,
      profile.businessOrProfession ? `Business/profession: ${profile.businessOrProfession}` : null,
      profile.businessDescription ? `Business description: ${profile.businessDescription}` : null,
      profile.aiPurpose ? `AI purpose/role: ${profile.aiPurpose}` : null,
      profile.communicationTone ? `Communication tone/style: ${profile.communicationTone}` : null,
      profile.preferredLanguages?.length
        ? `Preferred languages: ${profile.preferredLanguages.join(", ")}`
        : null,
    ]),
    section("Products And Services", listLines(profile.productsServices)),
    section("Allowed To Share", listLines(profile.allowedToShare)),
    section("Restricted Private Information", listLines(profile.restrictedPrivateInfo)),
    section("Always Follow", listLines(profile.alwaysFollow)),
    section("Never Do", listLines(profile.neverDo)),
  ].filter(Boolean);
}

function instructionSections(instructions) {
  if (!instructions.length) return [];
  return [
    section(
      "Owner Instructions",
      instructions.map((instruction) => `- [${instruction.category}] ${instruction.text}`),
    ),
  ];
}

export function createCustomerAiContextBuilder({
  profileService,
  instructionService,
  baseInstructions = BASE_INSTRUCTIONS,
} = {}) {
  if (!profileService) throw new Error("profileService is required.");
  if (!instructionService) throw new Error("instructionService is required.");

  return {
    async buildContext({ ownerId, customerId = ownerId, agentId = DEFAULT_AGENT_ID }) {
      const profile = await profileService.getProfile({ ownerId, customerId, agentId });
      const instructions = await instructionService.list({ ownerId, agentId });
      const instructionText = [
        baseInstructions,
        ...profileSections(profile),
        ...instructionSections(instructions),
        section("Memory Placeholder", "No persistent memory is attached yet."),
        section("Knowledge Placeholder", "No external knowledge base is attached yet."),
        section("Conversation Context Placeholder", "Use the current Telegram message only."),
      ]
        .filter(Boolean)
        .join("\n\n");

      return createAgentContext({
        ownerId,
        customerId,
        agentId,
        instructions: instructionText,
        memory: {
          enabled: false,
          items: [],
        },
        knowledge: {
          enabled: false,
          sources: [],
        },
        conversationContext: {
          enabled: false,
          summary: null,
        },
        profile,
        ownerInstructions: instructions,
      });
    },
  };
}

export { BASE_INSTRUCTIONS };
