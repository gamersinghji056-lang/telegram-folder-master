import { getClient } from "../tg.js";

function normalizeBotUserId(botUserId) {
  const id = Number(botUserId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid Telegram bot user ID.");
  }

  return id;
}

export function createLinkedSessionGuard({ getClient: loadClient }) {
  return async function requireLinkedSessionForUser(botUserId) {
    const id = normalizeBotUserId(botUserId);
    const client = await loadClient(id);
    const authorized = await client.isUserAuthorized();

    if (!authorized) {
      throw new Error("Your Telegram account is not connected yet. Open the Mini App first.");
    }

    return {
      botUserId: id,
      client,
    };
  };
}

export const requireLinkedSession = createLinkedSessionGuard({ getClient });

export function __testNormalizeBotUserId(botUserId) {
  return normalizeBotUserId(botUserId);
}
