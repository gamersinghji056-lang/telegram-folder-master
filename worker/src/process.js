import { api } from "./api.js";
import { Api, getClient, withFloodWait } from "./tg.js";

const SLUG_RE = /(?:t\.me|telegram\.me)\/(?:addlist|list)\/([A-Za-z0-9_-]+)/i;

export function parseFolderLink(raw) {
  const line = String(raw ?? "").trim();
  if (!line) return null;

  const m = line.match(SLUG_RE);

  return m ? { url: line, slug: m[1] } : { url: line, slug: null };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function telegramError(error) {
  return error?.errorMessage || error?.message || String(error || "");
}

function titleText(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.text === "string") return value.text;
  return null;
}

function peerId(peer) {
  if (peer instanceof Api.PeerChannel) return Number(peer.channelId);
  if (peer instanceof Api.PeerChat) return Number(peer.chatId);
  return null;
}

function chatId(chat) {
  return Number(chat.id);
}

function peerOf(chat) {
  if (chat instanceof Api.Channel || chat instanceof Api.ChannelForbidden) {
    if (!chat.accessHash) return null;

    return new Api.InputPeerChannel({
      channelId: chat.id,
      accessHash: chat.accessHash,
    });
  }

  if (chat instanceof Api.Chat || chat instanceof Api.ChatForbidden) {
    return new Api.InputPeerChat({
      chatId: chat.id,
    });
  }

  return null;
}

function peerFromRow(row) {
  const chat = Array.isArray(row.chats) ? row.chats[0] : row.chats;
  const id = Number(row.telegram_chat_id);
  const type = String(chat?.chat_type || row.chat_type || "UNKNOWN");
  const accessHash = chat?.access_hash ? BigInt(chat.access_hash) : null;

  if ((type === "SUPERGROUP" || type === "CHANNEL") && accessHash) {
    return new Api.InputPeerChannel({
      channelId: id,
      accessHash,
    });
  }

  if (type === "GROUP") {
    return new Api.InputPeerChat({ chatId: id });
  }

  return null;
}

function inputChannelFromPeer(peer) {
  if (!(peer instanceof Api.InputPeerChannel)) return null;
  return new Api.InputChannel({
    channelId: peer.channelId,
    accessHash: peer.accessHash,
  });
}

function typeOf(chat) {
  if (chat instanceof Api.Channel) {
    return chat.broadcast ? "CHANNEL" : "SUPERGROUP";
  }

  if (chat instanceof Api.ChannelForbidden) {
    return chat.broadcast ? "CHANNEL" : "SUPERGROUP";
  }

  if (chat instanceof Api.Chat || chat instanceof Api.ChatForbidden) {
    return "GROUP";
  }

  return "UNKNOWN";
}

function excludedStatus(chat, peer) {
  if (!peer) return "INACCESSIBLE";
  if (chat instanceof Api.ChannelForbidden || chat instanceof Api.ChatForbidden)
    return "NO_PERMISSION";
  if (chat.deactivated) return "DEACTIVATED";
  return null;
}

function classifyError(msg) {
  const upper = String(msg || "").toUpperCase();

  if (
    upper.includes("USER_BANNED_IN_CHANNEL") ||
    upper.includes("USER_KICKED") ||
    upper.includes("CHAT_WRITE_FORBIDDEN") ||
    upper.includes("CHAT_ADMIN_REQUIRED") ||
    upper.includes("CHANNELS_TOO_MUCH")
  ) {
    return "NO_PERMISSION";
  }

  if (
    upper.includes("CHANNEL_PRIVATE") ||
    upper.includes("CHANNEL_INVALID") ||
    upper.includes("PEER_ID_INVALID") ||
    upper.includes("CHAT_ID_INVALID")
  ) {
    return "INACCESSIBLE";
  }

  if (upper.includes("INVITE_HASH_EXPIRED") || upper.includes("INVITE_SLUG_EXPIRED")) {
    return "EXPIRED";
  }

  if (upper.includes("CHANNEL_DEACTIVATED") || upper.includes("CHAT_DEACTIVATED")) {
    return "DEACTIVATED";
  }

  if (upper.includes("FLOOD_WAIT")) return "UNKNOWN";

  return "UNKNOWN";
}

function folderErrorMessage(msg) {
  const upper = String(msg || "").toUpperCase();

  if (upper.includes("INVITE_SLUG_EXPIRED")) return "Folder link expired or was revoked.";
  if (upper.includes("INVITE_SLUG_EMPTY") || upper.includes("SLUG_INVALID")) {
    return "Invalid folder link.";
  }
  if (upper.includes("CHATLISTS_TOO_MUCH")) {
    return "Telegram folder/share-list limit reached on this account.";
  }
  if (upper.includes("AUTH_KEY") || upper.includes("SESSION"))
    return "Telegram authorization required.";
  if (upper.includes("FLOOD_WAIT")) return msg;

  return msg || "Telegram API error.";
}

function chatRowsFromInvite(invite) {
  const byId = new Map((invite.chats ?? []).map((chat) => [chatId(chat), chat]));
  const alreadyIds = new Set();
  const candidates = [];

  if (invite instanceof Api.chatlists.ChatlistInviteAlready) {
    for (const p of invite.alreadyPeers ?? []) {
      const id = peerId(p);
      if (id !== null) alreadyIds.add(id);
      candidates.push(p);
    }

    for (const p of invite.missingPeers ?? []) {
      candidates.push(p);
    }
  } else {
    for (const p of invite.peers ?? []) {
      candidates.push(p);
    }
  }

  const rows = [];

  for (const p of candidates) {
    const id = peerId(p);
    if (id === null) continue;

    const chat = byId.get(id);
    if (!chat) {
      rows.push({
        telegram_chat_id: id,
        access_hash: null,
        title: null,
        username: null,
        chat_type: "UNKNOWN",
        access_status: "INACCESSIBLE",
      });
      continue;
    }

    const peer = peerOf(chat);
    const blocked = excludedStatus(chat, peer);
    const alreadyJoined = alreadyIds.has(id) || chat.left === false;
    const status = blocked ?? (alreadyJoined ? "ACCESSIBLE" : "JOIN_REQUIRED");

    rows.push({
      telegram_chat_id: id,
      access_hash: chat.accessHash ? String(chat.accessHash) : null,
      title: chat.title ?? null,
      username: chat.username ?? null,
      chat_type: typeOf(chat),
      access_status: status,
    });
  }

  return rows;
}

function summarizeRows({ folders, groups, totals }) {
  return {
    sourceFolders: folders.length,
    sourceFoldersOk: folders.filter((f) => f.status === "OK").length,
    sourceFoldersFailed: folders.filter((f) => f.status === "FAILED").length,
    totalGroups: totals.total_chats,
    duplicates: totals.duplicate_chats,
    alreadyJoined: groups.filter((g) => g.accessStatus === "ACCESSIBLE").length,
    availableToJoin: groups.filter((g) => g.accessStatus === "JOIN_REQUIRED").length,
    inaccessibleExcluded: totals.inaccessible_chats,
    finalEligibleGroups: totals.final_chats,
  };
}

function formatGroup(row) {
  const chat = Array.isArray(row.chats) ? row.chats[0] : row.chats;

  return {
    telegramChatId: Number(row.telegram_chat_id),
    title: chat?.title || chat?.username || `Chat ${row.telegram_chat_id}`,
    username: chat?.username ?? null,
    chatType: chat?.chat_type ?? "UNKNOWN",
    accessStatus: row.access_status,
    alreadyJoined: row.access_status === "ACCESSIBLE",
  };
}

async function refreshTotals(jobId) {
  const { totals } = await api("jobTotals", { job_id: jobId });
  return totals;
}

export async function analyzeFolders({ botUserId, urls, botChatId = null, report }) {
  const client = await getClient(botUserId);
  const parsed = urls.map(parseFolderLink).filter(Boolean);

  if (parsed.length === 0) {
    throw new Error("Add at least one t.me/addlist/... folder link.");
  }

  const { job_id: jobId, folders } = await api("createJob", {
    bot_user_id: botUserId,
    urls: parsed.map((p) => p.url),
    bot_chat_id: botChatId,
  });

  await report?.(`Analyzing ${parsed.length} folder link${parsed.length === 1 ? "" : "s"}...`);

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];
    const folderRow = folders.find((f) => f.position === i + 1) ?? folders[i];

    if (!item.slug) {
      failed += 1;
      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "FAILED",
          error: "Invalid folder link. Use a t.me/addlist/... URL.",
        },
      });
      continue;
    }

    try {
      const invite = await withFloodWait(
        () => client.invoke(new Api.chatlists.CheckChatlistInvite({ slug: item.slug })),
        (seconds) => report?.(`Telegram rate limit detected. Waiting ${seconds}s.`),
      );
      const rows = chatRowsFromInvite(invite);

      await api("recordFolderChats", {
        job_id: jobId,
        folder_id: folderRow.id,
        chats: rows,
      });

      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "OK",
          slug: item.slug,
          title: titleText(invite.title),
          chats_found: rows.length,
        },
      });

      ok += 1;
    } catch (e) {
      failed += 1;
      const msg = telegramError(e);
      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "FAILED",
          slug: item.slug,
          error: folderErrorMessage(msg),
        },
      });
    }

    await api("updateJob", {
      job_id: jobId,
      patch: {
        folders_ok: ok,
        folders_failed: failed,
        stage: `Analyzed ${i + 1}/${parsed.length}`,
      },
    });
  }

  const totals = await refreshTotals(jobId);
  const { folders: savedFolders, groups } = await api("jobAnalysisDetails", { job_id: jobId });
  const cleanGroups = groups.map(formatGroup);

  await api("updateJob", {
    job_id: jobId,
    patch: {
      ...totals,
      status: ok === 0 ? "FAILED" : "ANALYZED",
      stage: ok === 0 ? "No readable folders" : "Analysis complete",
      error: ok === 0 ? "No folder link could be read." : null,
    },
  });

  return {
    ok: ok > 0,
    jobId,
    folders: savedFolders,
    summary: summarizeRows({ folders: savedFolders, groups: cleanGroups, totals }),
    groups: cleanGroups,
  };
}

async function joinMissingPeer({ client, slug, peer, report, title }) {
  try {
    await withFloodWait(
      () =>
        client.invoke(
          new Api.chatlists.JoinChatlistInvite({
            slug,
            peers: [peer],
          }),
        ),
      (seconds) => report?.(`Telegram rate limit detected. Waiting ${seconds}s before joining.`),
    );

    await sleep(1200);
    return { ok: true };
  } catch (e) {
    const msg = telegramError(e);
    return {
      ok: false,
      status: classifyError(msg),
      error: `${title}: ${msg}`,
    };
  }
}

async function createTelegramFolder({ client, folderName, peers, report }) {
  const existing = await client.invoke(new Api.messages.GetDialogFilters());
  const filters = existing.filters ?? existing;
  const usedIds = new Set(
    (Array.isArray(filters) ? filters : []).map((f) => f.id).filter((n) => typeof n === "number"),
  );

  let filterId = 2;
  while (usedIds.has(filterId)) filterId += 1;

  if (filterId > 255) {
    throw new Error(
      "Telegram folder limit reached on this account. Delete an unused Telegram folder and try again.",
    );
  }

  let title;
  try {
    title = new Api.TextWithEntities({
      text: folderName,
      entities: [],
    });
  } catch {
    title = folderName;
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
            includePeers: peers,
            excludePeers: [],
          }),
        }),
      ),
    (seconds) => report?.(`Telegram rate limit detected. Waiting ${seconds}s before creating.`),
  );

  return filterId;
}

async function exportShareLink({ client, filterId, folderName, peers, report }) {
  const res = await withFloodWait(
    () =>
      client.invoke(
        new Api.chatlists.ExportChatlistInvite({
          chatlist: new Api.InputChatlistDialogFilter({ filterId }),
          title: folderName,
          peers,
        }),
      ),
    (seconds) => report?.(`Telegram rate limit detected. Waiting ${seconds}s before exporting.`),
  );

  return res?.invite?.url ?? null;
}

export async function joinAndCreateFolder({ botUserId, jobId, folderName, report }) {
  const client = await getClient(botUserId);
  const details = await api("jobAnalysisDetails", { job_id: jobId, bot_user_id: botUserId });
  const rows = details.groups ?? [];
  const foldersById = new Map((details.folders ?? []).map((f) => [f.id, f]));
  const name =
    String(folderName || "")
      .trim()
      .slice(0, 60) || `Clean Folder ${new Date().toISOString().slice(0, 10)}`;

  if (rows.length === 0) {
    throw new Error("There are no eligible groups from the analysis to join.");
  }

  await api("updateJob", {
    job_id: jobId,
    patch: { status: "RUNNING", stage: "Joining eligible groups", folder_name: name },
  });

  const final = [];
  const excluded = [];
  let joined = 0;

  for (const row of rows) {
    const group = formatGroup(row);
    const peer = peerFromRow(row);
    const folder = foldersById.get(row.folder_id);

    if (!peer) {
      excluded.push({ ...group, reason: "No usable Telegram peer was returned." });
      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: group.telegramChatId,
        access_status: "INACCESSIBLE",
      });
      continue;
    }

    if (row.access_status === "ACCESSIBLE") {
      final.push({ ...group, peer });
      continue;
    }

    if (!folder?.slug) {
      excluded.push({ ...group, reason: "Missing source folder slug." });
      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: group.telegramChatId,
        access_status: "INACCESSIBLE",
      });
      continue;
    }

    const result = await joinMissingPeer({
      client,
      slug: folder.slug,
      peer,
      title: group.title,
      report,
    });

    if (result.ok) {
      joined += 1;
      final.push({ ...group, peer, accessStatus: "ACCESSIBLE", alreadyJoined: false });
      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: group.telegramChatId,
        access_status: "ACCESSIBLE",
      });
    } else {
      excluded.push({ ...group, reason: result.error });
      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: group.telegramChatId,
        access_status: result.status,
      });
    }
  }

  if (final.length === 0) {
    const totals = await refreshTotals(jobId);
    await api("updateJob", {
      job_id: jobId,
      patch: {
        ...totals,
        status: "FAILED",
        stage: "No groups joined",
        error: "No eligible group could be joined or accessed.",
      },
    });
    return { ok: false, jobId, noEligible: true, excluded };
  }

  const includePeers = final.map((g) => g.peer);
  const filterId = await createTelegramFolder({
    client,
    folderName: name,
    peers: includePeers,
    report,
  });

  let shareLink = null;
  let shareError = null;

  try {
    shareLink = await exportShareLink({
      client,
      filterId,
      folderName: name,
      peers: includePeers,
      report,
    });

    if (!shareLink) {
      shareError = "Telegram created the folder but did not return a shareable link.";
    }
  } catch (e) {
    shareError = telegramError(e) || "Telegram refused shareable link generation.";
  }

  const totals = await refreshTotals(jobId);

  await api("updateJob", {
    job_id: jobId,
    patch: {
      ...totals,
      status: "DONE",
      stage: "Completed",
      folder_name: name,
      share_link: shareLink,
      share_link_note: shareError,
    },
  });

  return {
    ok: true,
    jobId,
    folderName: name,
    filterId,
    groupsJoined: joined,
    groupsInFolder: final.length,
    groupsExcluded: excluded.length,
    excluded,
    shareLink,
    shareError,
  };
}

export async function runJob({ botUserId, urls, botChatId, folderName, report }) {
  const analysis = await analyzeFolders({ botUserId, urls, botChatId, report });
  if (!analysis.ok || analysis.groups.length === 0) return analysis;
  return joinAndCreateFolder({ botUserId, jobId: analysis.jobId, folderName, report });
}
