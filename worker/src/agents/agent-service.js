import { runAiTurn } from "../ai/orchestrator.js";
import { requireLinkedSession } from "../auth/linked-session.js";

export async function handleRepresentativeMessage({ botUserId, chat, text }) {
  await requireLinkedSession(botUserId);

  const result = await runAiTurn({
    botUserId,
    chat,
    text,
  });

  return {
    ok: result.ok,
    text: result.message,
    code: result.code,
  };
}
