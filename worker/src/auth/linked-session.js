import { getClient } from "../tg.js";

function normalizeBotUserId(botUserId) {
  const id = Number(botUserId);

  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("Invalid Telegram bot user ID.");
  }

  return id;
}

export async function requireLinkedSession(botUserId) {
  const id = normalizeBotUserId(botUserId);
  const client = await getClient(id);
  const authorized = await client.isUserAuthorized();

  if (!authorized) {
    throw new Error("Your Telegram account is not connected yet. Open the Mini App first.");
  }

  return {
    botUserId: id,
    client,
  };
}
