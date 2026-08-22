import { createAgentService } from "../src/agents/agent-service.js";
import { createModelRegistry } from "../src/ai/model-registry.js";
import { createModelRouter } from "../src/ai/model-router.js";
import { createAiOrchestrator } from "../src/ai/orchestrator.js";
import { createOpenAiCompatibleProvider } from "../src/ai/providers/openai-compatible-provider.js";

const DEFAULT_AI_BASE_URL = "http://localhost:11434/v1";
const DEFAULT_AI_MODEL = "qwen2.5-coder:3b";

function localConfig() {
  return {
    baseUrl: process.env.AI_BASE_URL || DEFAULT_AI_BASE_URL,
    apiKey: process.env.AI_API_KEY || null,
    model: process.env.AI_MODEL || DEFAULT_AI_MODEL,
  };
}

async function main() {
  const config = localConfig();
  const registry = createModelRegistry();
  const provider = createOpenAiCompatibleProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
  });

  registry.registerModelProvider(provider);

  const router = createModelRouter({
    registry,
    roleProviders: {
      general: provider.id,
    },
  });
  const orchestrator = createAiOrchestrator({ router });
  const agentService = createAgentService({
    requireSession: async () => ({
      ok: true,
      smokeTest: true,
    }),
    runTurn: (request) => orchestrator.runAiTurn(request),
  });

  const prompt =
    process.argv.slice(2).join(" ").trim() ||
    "Reply with one short sentence confirming the local AI smoke test is working.";

  console.log("[ai-live-smoke] base URL:", config.baseUrl);
  console.log("[ai-live-smoke] model:", config.model);
  console.log("[ai-live-smoke] API key:", config.apiKey ? "provided" : "not provided");
  console.log("[ai-live-smoke] prompt:", prompt);
  console.log("");

  const result = await agentService.handleRepresentativeMessage({
    botUserId: "local-smoke-user",
    chat: {
      id: "local-smoke-chat",
      type: "local",
      title: "Local AI Smoke Test",
    },
    text: prompt,
    modelRole: "general",
    agentId: "local-smoke-agent",
  });

  if (!result.ok) {
    console.error("[ai-live-smoke] failed:", result.code, result.text);
    process.exitCode = 1;
    return;
  }

  console.log("[ai-live-smoke] response:");
  console.log(result.text);
}

main().catch((error) => {
  console.error("[ai-live-smoke] error:", error?.message || error);
  process.exitCode = 1;
});
