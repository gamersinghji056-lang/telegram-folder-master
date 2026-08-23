import { createAiResponse } from "../contract.js";
import { BaseAiProvider } from "./base-provider.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function cleanBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function chatCompletionsUrl(baseUrl) {
  const clean = cleanBaseUrl(baseUrl);
  if (!clean) return "";
  return clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`;
}

function firstMessage(data) {
  const choice = Array.isArray(data?.choices) ? data.choices[0] : null;
  return String(choice?.message?.content || choice?.text || "");
}

function providerConfigFromRequest(request, defaults) {
  const config = request?.config?.provider || request?.config || {};
  const role = request?.model?.role || "general";
  const roleModels = config.roleModels || defaults.roleModels || {};
  const roleModel = roleModels[role] || null;

  return {
    baseUrl: config.AI_BASE_URL || config.baseUrl || defaults.baseUrl,
    apiKey: config.AI_API_KEY || config.apiKey || defaults.apiKey,
    model: request?.model?.name || config.model || roleModel || defaults.model,
    timeoutMs: Number(config.timeoutMs || defaults.timeoutMs || DEFAULT_TIMEOUT_MS),
  };
}

export class OpenAiCompatibleProvider extends BaseAiProvider {
  constructor({
    id = "openai-compatible",
    name = "OpenAI-Compatible HTTP Provider",
    roles = ["fast", "general", "reasoning", "coding", "embedding"],
    baseUrl = null,
    apiKey = null,
    model = null,
    roleModels = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = fetch,
  } = {}) {
    super({ id, name, roles });
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
    this.roleModels = roleModels;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  modelNameForRequest(request) {
    return providerConfigFromRequest(request, this).model || null;
  }

  async complete(request) {
    const config = providerConfigFromRequest(request, this);
    const url = chatCompletionsUrl(config.baseUrl);

    if (!url) {
      throw new Error("AI_BASE_URL is required for the OpenAI-compatible provider.");
    }

    if (!config.model) {
      throw new Error("AI model name is required for the OpenAI-compatible provider.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const headers = {
        "content-type": "application/json",
      };

      if (config.apiKey) {
        headers.authorization = `Bearer ${config.apiKey}`;
      }

      const res = await this.fetchImpl(url, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: "system",
              content:
                request.context?.instructions ||
                "You are a personal AI representative. Respond helpfully and concisely.",
            },
            {
              role: "user",
              content: request.input?.text || "",
            },
          ],
          stream: false,
        }),
      });

      const text = await res.text();
      let data;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`OpenAI-compatible provider returned non-JSON (HTTP ${res.status}).`);
      }

      if (!res.ok) {
        throw new Error(
          data?.error?.message ||
            data?.message ||
            `OpenAI-compatible provider failed (HTTP ${res.status}).`,
        );
      }

      const message = firstMessage(data);

      if (!message) {
        throw new Error("OpenAI-compatible provider returned an empty message.");
      }

      return createAiResponse({
        requestId: request.id,
        ok: true,
        code: "ok",
        message,
        modelRole: request.model?.role,
        providerId: this.id,
        output: {
          raw: data,
          model: data?.model || config.model,
        },
      });
    } catch (e) {
      if (e?.name === "AbortError") {
        throw new Error("OpenAI-compatible provider timed out.");
      }

      throw e;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createOpenAiCompatibleProvider(config = {}) {
  return new OpenAiCompatibleProvider(config);
}
