import { isLocalDevMode } from "./bot.js";
import { loadConfig } from "./tg.js";

const TRANSIENT_FETCH_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "TypeError",
]);

function safeDetail(error) {
  return String(
    error?.detail || error?.cause?.cause?.message || error?.cause?.message || error?.message || "",
  )
    .replace(/Bearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/bot\d+:[\w-]+/gi, "bot[redacted]")
    .slice(0, 180);
}

function errorCode(error) {
  return error?.code || error?.cause?.cause?.code || error?.cause?.code || error?.name || "UNKNOWN";
}

function isTransientConfigFetchError(error) {
  if (error?.name !== "AppApiFetchError" || error?.action !== "pull") return false;
  return TRANSIENT_FETCH_CODES.has(errorCode(error));
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadStartupConfig({
  load = loadConfig,
  env = process.env,
  logger = console,
  sleep = defaultSleep,
  maxAttempts = 3,
  baseDelayMs = 150,
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await load();
      return { ok: true, attempts: attempt };
    } catch (error) {
      lastError = error;
      const retryable = isTransientConfigFetchError(error) && attempt < maxAttempts;

      if (isLocalDevMode(env)) {
        logger.error?.(
          `[DEV_CONFIG_ERROR] stage=load_config_pull code=${errorCode(error)} detail=${safeDetail(error)}`,
        );
      }

      if (!retryable) break;
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

export const __testStartupConfig = {
  errorCode,
  isTransientConfigFetchError,
  safeDetail,
};
