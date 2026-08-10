import { api } from "./api.js";
import { Api, getClient, withFloodWait } from "./tg.js";

const SLUG_RE = /(?:t\.me|telegram\.me)\/(?:addlist|list)\/([A-Za-z0-9_-]+)/i;

export function parseFolderLink(raw) {
  const line = raw.trim();
  if (!line) return null;
  const m = line.match(SLUG_RE);
  return m ? { url: line, slug: m[1] } : { url: line, slug: null };
}

function peerOf(chat) {
  if (chat instanceof Api.Channel || chat instanceof Api.ChannelForbidden) {
    if (!chat.accessHash) return null;
    return new Api.InputPeerChannel({ channelId: chat.id, accessHash: chat.accessHash });
  }
  if (chat instanceof Api.Chat || chat instanceof Api.ChatForbidden) {
    return new Api.InputPeerChat({ chatId: chat.id });
  }
  return null;
}

function typeOf(chat) {
  if (chat instanceof Api.Channel) return chat.broadcast ? "CHANNEL" : "SUPERGROUP";
  if (chat instanceof Api.ChannelForbidden) return chat.broadcast ? "CHANNEL" : "SUPERGROUP";
  if (chat instanceof Api.Chat || chat instanceof Api.ChatForbidden) return "GROUP";
  return "UNKNOWN";
}

/** Only reports what Telegram actually tells us. Never guesses "banned"/"frozen". */
function initialStatus(chat) {
  if (chat instanceof Api.ChannelForbidden || chat instanceof Api.ChatForbidden) {
    return "NO_PERMISSION";
  }
  if (chat.deactivated) return "DEACTIVATED";
  if (chat.left === false) return "ACCESSIBLE";
  return "UNKNOWN";
}

function classifyError(msg) {
  if (!msg) return "UNKNOWN";
  if (msg.includes("CHANNEL_PRIVATE")) return "INACCESSIBLE";
  if (msg.includes("CHANNEL_INVALID")) return "INACCESSIBLE";
  if (msg.includes("INVITE_REQUEST_SENT")) return "JOIN_REQUIRED";
  if (msg.includes("INVITE_HASH_EXPIRED") || msg.includes("INVITE_SLUG_EXPIRED")) return "EXPIRED";
  if (msg.includes("USER_BANNED_IN_CHANNEL")) return "NO_PERMISSION";
  if (msg.includes("CHAT_ADMIN_REQUIRED")) return "NO_PERMISSION";
  if (msg.includes("CHANNELS_TOO_MUCH")) return "NO_PERMISSION";
  if (msg.includes("PEER_ID_INVALID")) return "INACCESSIBLE";
  return "UNKNOWN";
}

function folderErrorMessage(msg) {
  if (!msg) return "Telegram API error.";
  if (msg.includes("INVITE_SLUG_EXPIRED")) return "Folder link expired or was revoked.";
  if (msg.includes("INVITE_SLUG_EMPTY") || msg.includes("SLUG_INVALID")) return "Invalid folder link.";
  if (msg.includes("CHATLISTS_TOO_MUCH")) return "Telegram folder limit reached on this account.";
  if (msg.includes("AUTH_KEY") || msg.includes("SESSION")) return "Telegram authorization required.";
  if (msg.includes("FLOOD_WAIT")) return "Telegram rate limit.";
  return msg;
}

/**
 * Runs one full merge job. `report` streams real progress back to the bot.
 */
export async function runJob({ urls, botChatId, folderName, report }) {
  const client = await getClient();

  const parsed = urls.map(parseFolderLink).filter(Boolean);
  const { job_id: jobId, folders } = await api("createJob", {
    urls: parsed.map((p) => p.url),
    bot_chat_id: botChatId,
  });

  await report(`Processing ${parsed.length} folder${parsed.length === 1 ? "" : "s"}…`);

  /** telegram_chat_id -> { chat, peer } for everything we saw */
  const seen = new Map();
  let ok = 0;
  let failed = 0;

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    const folderRow = folders.find((f) => f.position === i + 1) ?? folders[i];
    const label = `Folder ${i + 1}/${parsed.length}`;

    if (!item.slug) {
      failed += 1;
      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: { status: "FAILED", error: "Invalid folder link — not a t.me/addlist/... link." },
      });
      await report(`${label}\n❌ Invalid folder link.`);
      continue;
    }

    try {
      const invite = await withFloodWait(
        () => client.invoke(new Api.chatlists.CheckChatlistInvite({ slug: item.slug })),
        (s) => report(`Telegram rate limit detected.\nProcessing will continue automatically in ${s}s.`),
      );

      const chats = invite.chats ?? [];
      const rows = [];
      for (const chat of chats) {
        const peer = peerOf(chat);
        const tgId = Number(chat.id);
        if (!seen.has(tgId)) seen.set(tgId, { chat, peer });
        rows.push({
          telegram_chat_id: tgId,
          access_hash: chat.accessHash ? String(chat.accessHash) : null,
          title: chat.title ?? null,
          username: chat.username ?? null,
          chat_type: typeOf(chat),
          access_status: peer ? initialStatus(chat) : "INACCESSIBLE",
        });
      }

      await api("recordFolderChats", { job_id: jobId, folder_id: folderRow.id, chats: rows });
      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "OK",
          slug: item.slug,
          title: invite.title ?? null,
          chats_found: rows.length,
        },
      });
      ok += 1;
      await report(`${label}\nChats found: ${rows.length}`);
    } catch (e) {
      failed += 1;
      const msg = e?.errorMessage || e?.message || "";
      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: { status: "FAILED", slug: item.slug, error: folderErrorMessage(msg) },
      });
      await report(`${label}\n❌ ${folderErrorMessage(msg)}`);
    }

    await api("updateJob", {
      job_id: jobId,
      patch: { folders_ok: ok, folders_failed: failed, stage: `Processed ${i + 1}/${parsed.length}` },
    });
  }

  if (ok === 0) {
    await api("updateJob", {
      job_id: jobId,
      patch: { status: "FAILED", stage: "No folder could be read", error: "All folder links failed." },
    });
    return { jobId, failedAll: true };
  }

  // --- verify access / join what is needed so chats can go into a folder ---
  await report("Checking chat access…");
  const dialogPeers = new Set();
  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    for (const d of dialogs) if (d.entity?.id) dialogPeers.add(Number(d.entity.id));
  } catch {
    /* non-fatal: we fall back to join attempts */
  }

  const eligiblePeers = [];
  let joined = 0;
  for (const [tgId, { chat, peer }] of seen) {
    if (!peer) {
      await api("setChatStatus", { job_id: jobId, telegram_chat_id: tgId, access_status: "INACCESSIBLE" });
      continue;
    }
    let status = initialStatus(chat);
    if (status === "ACCESSIBLE" || dialogPeers.has(tgId)) {
      status = "ACCESSIBLE";
    } else if (status === "UNKNOWN") {
      if (peer instanceof Api.InputPeerChat) {
        status = "INACCESSIBLE"; // legacy group, not joinable from a folder link
      } else {
        try {
          await withFloodWait(
            () => client.invoke(new Api.channels.JoinChannel({ channel: peer })),
            (s) =>
              report(
                `Telegram rate limit detected.\nProcessing will continue automatically in ${s}s.`,
              ),
          );
          status = "ACCESSIBLE";
          joined += 1;
          await new Promise((r) => setTimeout(r, 900)); // stay well inside Telegram limits
        } catch (e) {
          status = classifyError(e?.errorMessage || e?.message || "");
        }
      }
    }
    await api("setChatStatus", { job_id: jobId, telegram_chat_id: tgId, access_status: status });
    if (status === "ACCESSIBLE") eligiblePeers.push({ tgId, peer, chat });
  }

  const { totals } = await api("jobTotals", { job_id: jobId });

  if (eligiblePeers.length === 0) {
    await api("updateJob", {
      job_id: jobId,
      patch: {
        ...totals,
        status: "FAILED",
        stage: "No eligible chats",
        error: "None of the chats in these folders are accessible from your account.",
      },
    });
    return { jobId, totals, noEligible: true };
  }

  // --- create ONE new master folder (never touches the source folders) ---
  const name = folderName || `Clean Master Folder - ${new Date().toISOString().slice(0, 10)}`;
  await report(`Creating master folder “${name}” with ${eligiblePeers.length} chats…`);

  const existing = await client.invoke(new Api.messages.GetDialogFilters());
  const filters = existing.filters ?? existing;
  const usedIds = new Set(
    (Array.isArray(filters) ? filters : []).map((f) => f.id).filter((n) => typeof n === "number"),
  );
  let filterId = 2;
  while (usedIds.has(filterId)) filterId += 1;
  if (filterId > 255) throw new Error("Telegram folder limit reached on this account.");

  const includePeers = eligiblePeers.map((c) => c.peer);
  let title;
  try {
    title = new Api.TextWithEntities({ text: name, entities: [] });
  } catch {
    title = name;
  }

  await withFloodWait(
    () =>
      client.invoke(
        new Api.messages.UpdateDialogFilter({
          id: filterId,
          filter: new Api.DialogFilter({
            id: filterId,
            title,
            pinnedPeers: [],
            includePeers,
            excludePeers: [],
          }),
        }),
      ),
    (s) => report(`Telegram rate limit detected.\nRetrying automatically in ${s}s.`),
  );

  // --- shareable link (Telegram Premium only) ---
  let shareLink = null;
  let shareNote = null;
  const shareablePeers = eligiblePeers
    .filter((c) => c.peer instanceof Api.InputPeerChannel)
    .map((c) => c.peer);
  try {
    if (shareablePeers.length === 0) throw new Error("NO_SHAREABLE_PEERS");
    const res = await withFloodWait(
      () =>
        client.invoke(
          new Api.chatlists.ExportChatlistInvite({
            chatlist: new Api.InputChatlistDialogFilter({ filterId }),
            title: name,
            peers: shareablePeers,
          }),
        ),
      (s) => report(`Telegram rate limit detected.\nRetrying automatically in ${s}s.`),
    );
    shareLink = res?.invite?.url ?? null;
    if (!shareLink) shareNote = "Telegram did not return a shareable link for this folder.";
  } catch (e) {
    const msg = e?.errorMessage || e?.message || "";
    if (msg.includes("PREMIUM")) {
      shareNote = "Telegram only issues shareable folder links to Telegram Premium accounts.";
    } else if (msg === "NO_SHAREABLE_PEERS") {
      shareNote = "None of these chats can be included in a Telegram shareable folder link.";
    } else {
      shareNote = `Telegram refused to create a shareable link: ${msg}`;
    }
  }

  await api("updateJob", {
    job_id: jobId,
    patch: {
      ...totals,
      status: "DONE",
      stage: "Completed",
      folder_name: name,
      share_link: shareLink,
      share_link_note: shareNote,
    },
  });

  return { jobId, totals, name, shareLink, shareNote, joined, folderCount: parsed.length, ok, failed };
}