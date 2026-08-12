import { api } from "./api.js";
import { Api, getClient, withFloodWait } from "./tg.js";

const SLUG_RE =
  /(?:t\.me|telegram\.me)\/(?:addlist|list)\/([A-Za-z0-9_-]+)/i;

export function parseFolderLink(raw) {
  const line = raw.trim();
  if (!line) return null;

  const m = line.match(SLUG_RE);

  return m
    ? { url: line, slug: m[1] }
    : { url: line, slug: null };
}

function peerOf(chat) {
  if (
    chat instanceof Api.Channel ||
    chat instanceof Api.ChannelForbidden
  ) {
    if (!chat.accessHash) return null;

    return new Api.InputPeerChannel({
      channelId: chat.id,
      accessHash: chat.accessHash,
    });
  }

  if (
    chat instanceof Api.Chat ||
    chat instanceof Api.ChatForbidden
  ) {
    return new Api.InputPeerChat({
      chatId: chat.id,
    });
  }

  return null;
}

function typeOf(chat) {
  if (
    chat instanceof Api.Channel ||
    chat instanceof Api.ChannelForbidden
  ) {
    return chat.broadcast ? "CHANNEL" : "SUPERGROUP";
  }

  if (
    chat instanceof Api.Chat ||
    chat instanceof Api.ChatForbidden
  ) {
    return "GROUP";
  }

  return "UNKNOWN";
}

/**
 * Initial status based only on information Telegram
 * explicitly provides on the chat object.
 */
function initialStatus(chat) {
  if (
    chat instanceof Api.ChannelForbidden ||
    chat instanceof Api.ChatForbidden
  ) {
    return "NO_PERMISSION";
  }

  if (chat.deactivated === true) {
    return "DEACTIVATED";
  }

  if (
    chat instanceof Api.Channel &&
    !chat.accessHash
  ) {
    return "INACCESSIBLE";
  }

  if (
    chat instanceof Api.Chat &&
    chat.left === true
  ) {
    return "NO_PERMISSION";
  }

  if (
    chat instanceof Api.Channel &&
    chat.left === true
  ) {
    return "NO_PERMISSION";
  }

  if (chat.left === false) {
    return "ACCESSIBLE";
  }

  return "UNKNOWN";
}

/**
 * Checks whether the Telegram entity itself gives us
 * enough information to safely consider it usable.
 *
 * This does NOT send a test message.
 */
function checkChatUsability(chat, isInDialogs) {
  // Telegram explicitly reports a forbidden entity.
  if (
    chat instanceof Api.ChannelForbidden ||
    chat instanceof Api.ChatForbidden
  ) {
    return {
      ok: false,
      status: "NO_PERMISSION",
      reason: "Telegram reports that this chat is forbidden or inaccessible.",
    };
  }

  // Telegram explicitly reports deactivation.
  if (chat.deactivated === true) {
    return {
      ok: false,
      status: "DEACTIVATED",
      reason: "Telegram reports that this chat is deactivated.",
    };
  }

  // Account explicitly left the chat.
  if (chat.left === true) {
    return {
      ok: false,
      status: "NO_PERMISSION",
      reason: "The Telegram account has left this chat.",
    };
  }

  // Channel without access hash cannot safely be used.
  if (
    chat instanceof Api.Channel &&
    !chat.accessHash
  ) {
    return {
      ok: false,
      status: "INACCESSIBLE",
      reason: "Channel access information is unavailable.",
    };
  }

  // If Telegram already has the chat in the account dialogs,
  // it is normally accessible.
  if (isInDialogs) {
    return {
      ok: true,
      status: "ACCESSIBLE",
      reason: "Chat is present in the account dialogs.",
    };
  }

  // Explicitly accessible.
  if (chat.left === false) {
    return {
      ok: true,
      status: "ACCESSIBLE",
      reason: "Telegram reports the chat as accessible.",
    };
  }

  return {
    ok: false,
    status: "UNKNOWN",
    reason: "Telegram did not provide enough information to verify access.",
  };
}

function classifyError(msg) {
  if (!msg) return "UNKNOWN";

  const upper = msg.toUpperCase();

  if (
    upper.includes("CHANNEL_PRIVATE") ||
    upper.includes("CHANNEL_INVALID") ||
    upper.includes("PEER_ID_INVALID")
  ) {
    return "INACCESSIBLE";
  }

  if (
    upper.includes("USER_BANNED_IN_CHANNEL") ||
    upper.includes("CHAT_ADMIN_REQUIRED") ||
    upper.includes("CHANNELS_TOO_MUCH") ||
    upper.includes("USER_NOT_PARTICIPANT") ||
    upper.includes("CHAT_WRITE_FORBIDDEN")
  ) {
    return "NO_PERMISSION";
  }

  if (
    upper.includes("INVITE_REQUEST_SENT") ||
    upper.includes("JOIN_REQUEST")
  ) {
    return "JOIN_REQUIRED";
  }

  if (
    upper.includes("INVITE_HASH_EXPIRED") ||
    upper.includes("INVITE_SLUG_EXPIRED")
  ) {
    return "EXPIRED";
  }

  if (
    upper.includes("INVITE_HASH_REVOKED") ||
    upper.includes("INVITE_SLUG_REVOKED")
  ) {
    return "REVOKED";
  }

  if (
    upper.includes("CHANNEL_DEACTIVATED") ||
    upper.includes("CHAT_DEACTIVATED")
  ) {
    return "DEACTIVATED";
  }

  return "UNKNOWN";
}

function folderErrorMessage(msg) {
  if (!msg) return "Telegram API error.";

  const upper = msg.toUpperCase();

  if (
    upper.includes("INVITE_SLUG_EXPIRED") ||
    upper.includes("INVITE_HASH_EXPIRED")
  ) {
    return "Folder link expired or was revoked.";
  }

  if (
    upper.includes("INVITE_SLUG_EMPTY") ||
    upper.includes("SLUG_INVALID")
  ) {
    return "Invalid folder link.";
  }

  if (upper.includes("CHATLISTS_TOO_MUCH")) {
    return "Telegram folder limit reached on this account.";
  }

  if (
    upper.includes("AUTH_KEY") ||
    upper.includes("SESSION")
  ) {
    return "Telegram authorization required.";
  }

  if (upper.includes("FLOOD_WAIT")) {
    return "Telegram rate limit.";
  }

  return msg;
}

/**
 * Runs one complete folder merge job.
 */
export async function runJob({
  urls,
  botChatId,
  folderName,
  report,
}) {
  const client = await getClient();

  const parsed = urls
    .map(parseFolderLink)
    .filter(Boolean);

  const {
    job_id: jobId,
    folders,
  } = await api("createJob", {
    urls: parsed.map((p) => p.url),
    bot_chat_id: botChatId,
  });

  await report(
    `Processing ${parsed.length} folder${
      parsed.length === 1 ? "" : "s"
    }…`,
  );

  /**
   * telegram_chat_id ->
   * {
   *   chat,
   *   peer
   * }
   */
  const seen = new Map();

  let ok = 0;
  let failed = 0;

  // ------------------------------------------------------------
  // STEP 1: READ ALL SOURCE FOLDERS
  // ------------------------------------------------------------

  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];

    const folderRow =
      folders.find(
        (f) => f.position === i + 1,
      ) ?? folders[i];

    const label =
      `Folder ${i + 1}/${parsed.length}`;

    if (!item.slug) {
      failed += 1;

      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "FAILED",
          error:
            "Invalid folder link — expected t.me/addlist/... link.",
        },
      });

      await report(
        `${label}\n❌ Invalid folder link.`,
      );

      continue;
    }

    try {
      const invite = await withFloodWait(
        () =>
          client.invoke(
            new Api.chatlists.CheckChatlistInvite({
              slug: item.slug,
            }),
          ),
        (s) =>
          report(
            `Telegram rate limit detected.\nProcessing will continue automatically in ${s}s.`,
          ),
      );

      const chats = invite.chats ?? [];

      const rows = [];

      for (const chat of chats) {
        const peer = peerOf(chat);
        const tgId = Number(chat.id);

        // Keep only one copy in our local map.
        if (!seen.has(tgId)) {
          seen.set(tgId, {
            chat,
            peer,
          });
        }

        rows.push({
          telegram_chat_id: tgId,
          access_hash: chat.accessHash
            ? String(chat.accessHash)
            : null,
          title: chat.title ?? null,
          username: chat.username ?? null,
          chat_type: typeOf(chat),
          access_status: peer
            ? initialStatus(chat)
            : "INACCESSIBLE",
        });
      }

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
          title: invite.title ?? null,
          chats_found: rows.length,
        },
      });

      ok += 1;

      await report(
        `${label}\nChats found: ${rows.length}`,
      );
    } catch (e) {
      failed += 1;

      const msg =
        e?.errorMessage ||
        e?.message ||
        "";

      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "FAILED",
          slug: item.slug,
          error: folderErrorMessage(msg),
        },
      });

      await report(
        `${label}\n❌ ${folderErrorMessage(msg)}`,
      );
    }

    await api("updateJob", {
      job_id: jobId,
      patch: {
        folders_ok: ok,
        folders_failed: failed,
        stage:
          `Processed ${i + 1}/${parsed.length}`,
      },
    });
  }

  if (ok === 0) {
    await api("updateJob", {
      job_id: jobId,
      patch: {
        status: "FAILED",
        stage: "No folder could be read",
        error: "All folder links failed.",
      },
    });

    return {
      jobId,
      failedAll: true,
    };
  }

  // ------------------------------------------------------------
  // STEP 2: LOAD CURRENT TELEGRAM DIALOGS
  // ------------------------------------------------------------

  await report(
    "Checking chat access and permissions…",
  );

  const dialogPeers = new Set();

  try {
    const dialogs = await client.getDialogs({
      limit: 500,
    });

    for (const d of dialogs) {
      if (d.entity?.id) {
        dialogPeers.add(
          Number(d.entity.id),
        );
      }
    }
  } catch (e) {
    console.error(
      "Could not read Telegram dialogs:",
      e?.message || e,
    );
  }

  // ------------------------------------------------------------
  // STEP 3: VERIFY EVERY CHAT
  // ------------------------------------------------------------

  const eligiblePeers = [];

  let joined = 0;
  let excluded = 0;

  const exclusionStats = {
    NO_PERMISSION: 0,
    INACCESSIBLE: 0,
    DEACTIVATED: 0,
    JOIN_REQUIRED: 0,
    EXPIRED: 0,
    REVOKED: 0,
    UNKNOWN: 0,
  };

  for (const [
    tgId,
    { chat, peer },
  ] of seen) {
    let status = "UNKNOWN";
    let reason = "";

    // ----------------------------------------------------------
    // NO PEER
    // ----------------------------------------------------------

    if (!peer) {
      status = "INACCESSIBLE";
      reason =
        "Telegram did not provide a usable peer.";
    } else {
      // --------------------------------------------------------
      // INITIAL CHECK
      // --------------------------------------------------------

      const check =
        checkChatUsability(
          chat,
          dialogPeers.has(tgId),
        );

      status = check.status;
      reason = check.reason;

      // --------------------------------------------------------
      // CHANNEL NOT CURRENTLY IN DIALOGS
      // --------------------------------------------------------

      if (
        peer instanceof Api.InputPeerChannel &&
        status === "UNKNOWN" &&
        !dialogPeers.has(tgId)
      ) {
        try {
          await withFloodWait(
            () =>
              client.invoke(
                new Api.channels.JoinChannel({
                  channel: peer,
                }),
              ),
            (s) =>
              report(
                `Telegram rate limit detected.\nProcessing will continue automatically in ${s}s.`,
              ),
          );

          status = "ACCESSIBLE";
          reason =
            "Successfully joined/accessed channel.";

          joined += 1;

          await new Promise(
            (resolve) =>
              setTimeout(resolve, 900),
          );
        } catch (e) {
          const msg =
            e?.errorMessage ||
            e?.message ||
            "";

          status = classifyError(msg);
          reason =
            msg ||
            "Telegram rejected access.";
        }
      }

      // --------------------------------------------------------
      // LEGACY GROUP
      // --------------------------------------------------------

      if (
        peer instanceof Api.InputPeerChat &&
        status === "UNKNOWN"
      ) {
        if (dialogPeers.has(tgId)) {
          status = "ACCESSIBLE";
          reason =
            "Legacy group is present in account dialogs.";
        } else {
          status = "INACCESSIBLE";
          reason =
            "Legacy group is not accessible from this account.";
        }
      }
    }

    // ----------------------------------------------------------
    // SAVE FINAL STATUS
    // ----------------------------------------------------------

    await api("setChatStatus", {
      job_id: jobId,
      telegram_chat_id: tgId,
      access_status: status,
    });

    // ----------------------------------------------------------
    // ELIGIBLE
    // ----------------------------------------------------------

    if (status === "ACCESSIBLE") {
      eligiblePeers.push({
        tgId,
        peer,
        chat,
      });
    } else {
      excluded += 1;

      if (
        Object.prototype.hasOwnProperty.call(
          exclusionStats,
          status,
        )
      ) {
        exclusionStats[status] += 1;
      } else {
        exclusionStats.UNKNOWN += 1;
      }

      console.log(
        `[EXCLUDED] ${tgId} | ${
          chat?.title || "Unknown chat"
        } | ${status} | ${reason}`,
      );
    }
  }

  // ------------------------------------------------------------
  // STEP 4: SHOW VERIFICATION RESULT
  // ------------------------------------------------------------

  await report(
    [
      "Access verification completed.",
      "",
      `Eligible chats: ${eligiblePeers.length}`,
      `Excluded chats: ${excluded}`,
      `Joined/accessed: ${joined}`,
      "",
      `No permission: ${exclusionStats.NO_PERMISSION}`,
      `Inaccessible: ${exclusionStats.INACCESSIBLE}`,
      `Deactivated: ${exclusionStats.DEACTIVATED}`,
      `Join required: ${exclusionStats.JOIN_REQUIRED}`,
      `Expired: ${exclusionStats.EXPIRED}`,
      `Revoked: ${exclusionStats.REVOKED}`,
      `Unknown: ${exclusionStats.UNKNOWN}`,
    ].join("\n"),
  );

  // ------------------------------------------------------------
  // STEP 5: GET FINAL TOTALS
  // ------------------------------------------------------------

  const {
    totals,
  } = await api("jobTotals", {
    job_id: jobId,
  });

  if (eligiblePeers.length === 0) {
    await api("updateJob", {
      job_id: jobId,
      patch: {
        ...totals,
        status: "FAILED",
        stage: "No eligible chats",
        error:
          "None of the chats in these folders are accessible from your account.",
      },
    });

    return {
      jobId,
      totals,
      noEligible: true,
    };
  }

  // ------------------------------------------------------------
  // STEP 6: CREATE ONE CLEAN MASTER FOLDER
  // ------------------------------------------------------------

  const name =
    folderName ||
    `Clean Master Folder - ${
      new Date().toISOString().slice(0, 10)
    }`;

  await report(
    `Creating master folder "${name}" with ${eligiblePeers.length} chats…`,
  );

  const existing =
    await client.invoke(
      new Api.messages.GetDialogFilters(),
    );

  const filters =
    existing.filters ?? existing;

  const usedIds = new Set(
    (Array.isArray(filters)
      ? filters
      : []
    )
      .map((f) => f.id)
      .filter(
        (n) => typeof n === "number",
      ),
  );

  let filterId = 2;

  while (usedIds.has(filterId)) {
    filterId += 1;
  }

  if (filterId > 255) {
    throw new Error(
      "Telegram folder limit reached on this account.",
    );
  }

  const includePeers =
    eligiblePeers.map(
      (c) => c.peer,
    );

  let title;

  try {
    title = new Api.TextWithEntities({
      text: name,
      entities: [],
    });
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
    (s) =>
      report(
        `Telegram rate limit detected.\nRetrying automatically in ${s}s.`,
      ),
  );

  // ------------------------------------------------------------
  // STEP 7: TRY TO CREATE SHAREABLE FOLDER LINK
  // ------------------------------------------------------------

  let shareLink = null;
  let shareNote = null;

  const shareablePeers =
    eligiblePeers
      .filter(
        (c) =>
          c.peer instanceof
          Api.InputPeerChannel,
      )
      .map((c) => c.peer);

  try {
    if (shareablePeers.length === 0) {
      throw new Error(
        "NO_SHAREABLE_PEERS",
      );
    }

    const res =
      await withFloodWait(
        () =>
          client.invoke(
            new Api.chatlists.ExportChatlistInvite(
              {
                chatlist:
                  new Api.InputChatlistDialogFilter(
                    {
                      filterId,
                    },
                  ),
                title: name,
                peers: shareablePeers,
              },
            ),
          ),
        (s) =>
          report(
            `Telegram rate limit detected.\nRetrying automatically in ${s}s.`,
          ),
      );

    shareLink =
      res?.invite?.url ??
      null;

    if (!shareLink) {
      shareNote =
        "Telegram did not return a shareable link for this folder.";
    }
  } catch (e) {
    const msg =
      e?.errorMessage ||
      e?.message ||
      "";

    const upper = msg.toUpperCase();

    if (
      upper.includes("PREMIUM")
    ) {
      shareNote =
        "Telegram only issues shareable folder links to eligible Telegram Premium accounts.";
    } else if (
      msg === "NO_SHAREABLE_PEERS"
    ) {
      shareNote =
        "None of the verified chats can be included in a Telegram shareable folder link.";
    } else if (
      upper.includes(
        "INVITE_PEERS_TOO_MUCH",
      )
    ) {
      shareNote =
        "Telegram refused the shareable link because too many chats were included. The clean folder itself was created successfully.";
    } else {
      shareNote =
        `Telegram refused to create a shareable link: ${msg}`;
    }
  }

  // ------------------------------------------------------------
  // STEP 8: SAVE FINAL JOB
  // ------------------------------------------------------------

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

  // ------------------------------------------------------------
  // STEP 9: RETURN RESULT TO BOT
  // ------------------------------------------------------------

  return {
    jobId,
    totals,
    name,
    shareLink,
    shareNote,
    joined,
    folderCount: parsed.length,
    ok,
    failed,
  };
}
