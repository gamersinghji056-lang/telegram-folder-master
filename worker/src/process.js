import { api } from "./api.js";
import { Api, getClient, withFloodWait } from "./tg.js";

const SLUG_RE = /(?:t\.me|telegram\.me)\/(?:addlist|list)\/([A-Za-z0-9_-]+)/i;

const TEST_MESSAGE = "hey";
const TEST_DELAY_MS = 2000;

export function parseFolderLink(raw) {
  const line = raw.trim();
  if (!line) return null;

  const m = line.match(SLUG_RE);

  return m ? { url: line, slug: m[1] } : { url: line, slug: null };
}

/**
 * Convert Telegram entity into an InputPeer.
 */
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

/**
 * Telegram chat type.
 */
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

/**
 * Initial status based only on Telegram's actual entity.
 */
function initialStatus(chat) {
  if (chat instanceof Api.ChannelForbidden || chat instanceof Api.ChatForbidden) {
    return "NO_PERMISSION";
  }

  if (chat.deactivated) {
    return "DEACTIVATED";
  }

  if (chat.left === false) {
    return "ACCESSIBLE";
  }

  return "UNKNOWN";
}

/**
 * Convert Telegram errors into our internal access statuses.
 */
function classifyError(msg) {
  if (!msg) return "UNKNOWN";

  const upper = String(msg).toUpperCase();

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
    upper.includes("PEER_ID_INVALID")
  ) {
    return "INACCESSIBLE";
  }

  if (upper.includes("CHAT_ID_INVALID") || upper.includes("MESSAGE_ID_INVALID")) {
    return "INACCESSIBLE";
  }

  if (upper.includes("INVITE_REQUEST_SENT") || upper.includes("JOIN_REQUEST")) {
    return "JOIN_REQUIRED";
  }

  if (upper.includes("INVITE_HASH_EXPIRED") || upper.includes("INVITE_SLUG_EXPIRED")) {
    return "EXPIRED";
  }

  if (upper.includes("CHANNEL_DEACTIVATED") || upper.includes("CHAT_DEACTIVATED")) {
    return "DEACTIVATED";
  }

  if (upper.includes("USER_DEACTIVATED") || upper.includes("AUTH_KEY_UNREGISTERED")) {
    return "DEACTIVATED";
  }

  return "UNKNOWN";
}

/**
 * Human-readable folder errors.
 */
function folderErrorMessage(msg) {
  if (!msg) return "Telegram API error.";

  const upper = String(msg).toUpperCase();

  if (upper.includes("INVITE_SLUG_EXPIRED")) {
    return "Folder link expired or was revoked.";
  }

  if (upper.includes("INVITE_SLUG_EMPTY") || upper.includes("SLUG_INVALID")) {
    return "Invalid folder link.";
  }

  if (upper.includes("CHATLISTS_TOO_MUCH")) {
    return "Telegram folder/share-list limit reached on this account.";
  }

  if (upper.includes("AUTH_KEY") || upper.includes("SESSION")) {
    return "Telegram authorization required.";
  }

  if (upper.includes("FLOOD_WAIT")) {
    return "Telegram rate limit.";
  }

  return msg;
}

/**
 * Sleep helper.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to send the test message.
 *
 * Returns:
 * {
 *   ok: true,
 *   messageId
 * }
 *
 * or:
 * {
 *   ok: false,
 *   status,
 *   error
 * }
 */
async function testWriteAccess(client, peer, report) {
  try {
    const sent = await withFloodWait(
      () =>
        client.invoke(
          new Api.messages.SendMessage({
            peer,
            message: TEST_MESSAGE,
            randomId: BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)),
          }),
        ),
      (seconds) =>
        report?.(`Telegram rate limit detected.\nWaiting ${seconds}s before continuing.`),
    );

    /**
     * Try to find the sent message ID.
     *
     * Telegram can return:
     * - UpdateShortSentMessage
     * - Updates
     * - UpdatesCombined
     *
     * We handle the common cases.
     */
    let messageId = null;

    if (sent?.id) {
      messageId = Number(sent.id);
    }

    if (!messageId && Array.isArray(sent?.updates)) {
      for (const update of sent.updates) {
        if (update?.message?.id) {
          messageId = Number(update.message.id);
          break;
        }

        if (update?.id) {
          messageId = Number(update.id);
          break;
        }
      }
    }

    return {
      ok: true,
      messageId,
      raw: sent,
    };
  } catch (e) {
    const error = e?.errorMessage || e?.message || String(e);

    return {
      ok: false,
      status: classifyError(error),
      error,
    };
  }
}

/**
 * Delete our temporary "hey" message.
 *
 * Failure to delete does NOT make the chat inaccessible because
 * the message was already successfully sent.
 */
async function deleteTestMessage(client, peer, messageId, report) {
  if (!messageId) {
    return false;
  }

  try {
    if (peer instanceof Api.InputPeerChannel) {
      await withFloodWait(
        () =>
          client.invoke(
            new Api.channels.DeleteMessages({
              channel: new Api.InputChannel({
                channelId: peer.channelId,
                accessHash: peer.accessHash,
              }),
              id: [messageId],
            }),
          ),
        (seconds) =>
          report?.(
            `Telegram rate limit detected.\nWaiting ${seconds}s before deleting test message.`,
          ),
      );
    } else {
      await withFloodWait(
        () =>
          client.invoke(
            new Api.messages.DeleteMessages({
              id: [messageId],
              revoke: true,
            }),
          ),
        (seconds) =>
          report?.(
            `Telegram rate limit detected.\nWaiting ${seconds}s before deleting test message.`,
          ),
      );
    }

    return true;
  } catch (e) {
    console.error("Could not delete test message:", e?.errorMessage || e?.message || e);

    return false;
  }
}

/**
 * Verify every collected chat by actually attempting to send "hey".
 *
 * This is intentionally sequential and waits 2 seconds between chats.
 */
async function verifyChats({ client, jobId, seen, report }) {
  const eligiblePeers = [];

  const entries = Array.from(seen.entries());

  await report(
    `Testing write access for ${entries.length} unique chats...\nTest message: "${TEST_MESSAGE}"\nDelay: 2 seconds after each write test.`,
  );

  let index = 0;

  for (const [tgId, { chat, peer }] of entries) {
    index += 1;

    const title = chat?.title || chat?.username || `Chat ${tgId}`;

    await report(`Testing ${index}/${entries.length}: ${title}`);

    if (!peer) {
      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: tgId,
        access_status: "INACCESSIBLE",
      });

      await report(`❌ ${title}\nNo valid Telegram peer.`);

      continue;
    }

    /**
     * Existing forbidden entities should not receive a message.
     */
    const initial = initialStatus(chat);

    if (initial === "NO_PERMISSION" || initial === "DEACTIVATED") {
      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: tgId,
        access_status: initial,
      });

      await report(`❌ ${title}\nTelegram reports ${initial}.`);

      continue;
    }

    /**
     * Actually send "hey".
     */
    const result = await testWriteAccess(client, peer, report);

    if (!result.ok) {
      const status = result.status === "UNKNOWN" ? "NO_PERMISSION" : result.status;

      await api("setChatStatus", {
        job_id: jobId,
        telegram_chat_id: tgId,
        access_status: status,
      });

      await report(`❌ ${title}\nWrite test failed: ${result.error}`);

      await sleep(TEST_DELAY_MS);
      continue;
    }

    /**
     * Successfully sent "hey".
     * This proves the account can send messages there.
     */
    await api("setChatStatus", {
      job_id: jobId,
      telegram_chat_id: tgId,
      access_status: "ACCESSIBLE",
    });

    /**
     * Delete temporary test message.
     */
    let deleted = false;

    if (result.messageId) {
      deleted = await deleteTestMessage(client, peer, result.messageId, report);
    }

    eligiblePeers.push({
      tgId,
      peer,
      chat,
    });

    await report(
      deleted
        ? `✅ ${title}\nWrite access confirmed.\nTest message deleted.`
        : `✅ ${title}\nWrite access confirmed.\nTest message could not be deleted automatically.`,
    );

    /**
     * Required 2-second delay between chats.
     */
    await sleep(TEST_DELAY_MS);
  }

  return eligiblePeers;
}

/**
 * Runs one complete merge job.
 */
export async function runJob({ botUserId, urls, botChatId, folderName, report }) {
  const client = await getClient(botUserId);

  const parsed = urls.map(parseFolderLink).filter(Boolean);

  const { job_id: jobId, folders } = await api("createJob", {
    bot_user_id: botUserId,
    urls: parsed.map((p) => p.url),
    bot_chat_id: botChatId,
  });

  await report(`Processing ${parsed.length} folder${parsed.length === 1 ? "" : "s"}…`);

  /**
   * telegram_chat_id -> {
   *   chat,
   *   peer
   * }
   */
  const seen = new Map();

  let ok = 0;
  let failed = 0;

  /**
   * STEP 1
   * Read source folder links.
   */
  for (let i = 0; i < parsed.length; i += 1) {
    const item = parsed[i];

    const folderRow = folders.find((f) => f.position === i + 1) ?? folders[i];

    const label = `Folder ${i + 1}/${parsed.length}`;

    if (!item.slug) {
      failed += 1;

      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "FAILED",
          error: "Invalid folder link — not a t.me/addlist/... link.",
        },
      });

      await report(`${label}\n❌ Invalid folder link.`);

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
        (seconds) =>
          report(
            `Telegram rate limit detected.\nProcessing will continue automatically in ${seconds}s.`,
          ),
      );

      const chats = invite.chats ?? [];

      const rows = [];

      for (const chat of chats) {
        const peer = peerOf(chat);
        const tgId = Number(chat.id);

        /**
         * Deduplicate globally across all source folders.
         */
        if (!seen.has(tgId)) {
          seen.set(tgId, {
            chat,
            peer,
          });
        }

        rows.push({
          telegram_chat_id: tgId,
          access_hash: chat.accessHash ? String(chat.accessHash) : null,
          title: chat.title ?? null,
          username: chat.username ?? null,
          chat_type: typeOf(chat),
          access_status: peer ? initialStatus(chat) : "INACCESSIBLE",
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

      await report(`${label}\nChats found: ${rows.length}`);
    } catch (e) {
      failed += 1;

      const msg = e?.errorMessage || e?.message || "";

      await api("updateFolder", {
        folder_id: folderRow.id,
        patch: {
          status: "FAILED",
          slug: item.slug,
          error: folderErrorMessage(msg),
        },
      });

      await report(`${label}\n❌ ${folderErrorMessage(msg)}`);
    }

    await api("updateJob", {
      job_id: jobId,
      patch: {
        folders_ok: ok,
        folders_failed: failed,
        stage: `Processed ${i + 1}/${parsed.length}`,
      },
    });
  }

  /**
   * No source folder worked.
   */
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

  /**
   * STEP 2
   *
   * Actually test every unique chat.
   *
   * This replaces the old "join everything and assume access"
   * behaviour.
   */
  const eligiblePeers = await verifyChats({
    client,
    jobId,
    seen,
    report,
  });

  /**
   * Get final database totals after real verification.
   */
  const { totals } = await api("jobTotals", {
    job_id: jobId,
  });

  /**
   * Nothing survived the write-access test.
   */
  if (eligiblePeers.length === 0) {
    await api("updateJob", {
      job_id: jobId,
      patch: {
        ...totals,
        status: "FAILED",
        stage: "No eligible chats",
        error: 'No chats passed the "hey" write-access test.',
      },
    });

    return {
      jobId,
      totals,
      noEligible: true,
    };
  }

  /**
   * STEP 3
   *
   * Create ONE master folder containing only chats
   * that passed the write test.
   */
  const name = folderName || `Clean Master Folder - ${new Date().toISOString().slice(0, 10)}`;

  await report(`Creating master folder "${name}" with ${eligiblePeers.length} verified chats…`);

  /**
   * Get current Telegram dialog filters.
   */
  const existing = await client.invoke(new Api.messages.GetDialogFilters());

  const filters = existing.filters ?? existing;

  const usedIds = new Set(
    (Array.isArray(filters) ? filters : []).map((f) => f.id).filter((n) => typeof n === "number"),
  );

  let filterId = 2;

  while (usedIds.has(filterId)) {
    filterId += 1;
  }

  if (filterId > 255) {
    throw new Error(
      "Telegram folder limit reached on this account. Delete an unused Telegram folder and try again.",
    );
  }

  const includePeers = eligiblePeers.map((c) => c.peer);

  let title;

  try {
    title = new Api.TextWithEntities({
      text: name,
      entities: [],
    });
  } catch {
    title = name;
  }

  /**
   * Create the Telegram folder.
   */
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
    (seconds) => report(`Telegram rate limit detected.\nRetrying automatically in ${seconds}s.`),
  );

  /**
   * STEP 4
   *
   * Try to generate Telegram's shareable folder link.
   *
   * NOTE:
   * Telegram itself may refuse this with CHATLISTS_TOO_MUCH,
   * which is an account-side Telegram limitation.
   */
  let shareLink = null;
  let shareNote = null;

  const shareablePeers = eligiblePeers
    .filter((c) => c.peer instanceof Api.InputPeerChannel)
    .map((c) => c.peer);

  try {
    if (shareablePeers.length === 0) {
      throw new Error("NO_SHAREABLE_PEERS");
    }

    const res = await withFloodWait(
      () =>
        client.invoke(
          new Api.chatlists.ExportChatlistInvite({
            chatlist: new Api.InputChatlistDialogFilter({
              filterId,
            }),

            title: name,

            peers: shareablePeers,
          }),
        ),
      (seconds) => report(`Telegram rate limit detected.\nRetrying automatically in ${seconds}s.`),
    );

    shareLink = res?.invite?.url ?? null;

    if (!shareLink) {
      shareNote = "Telegram did not return a shareable link for this folder.";
    }
  } catch (e) {
    const msg = e?.errorMessage || e?.message || "";

    const upper = String(msg).toUpperCase();

    if (upper.includes("PREMIUM")) {
      shareNote =
        "Telegram only issues shareable folder links to eligible Telegram Premium accounts.";
    } else if (msg === "NO_SHAREABLE_PEERS") {
      shareNote = "None of the verified chats can be used for a Telegram shareable folder link.";
    } else if (upper.includes("CHATLISTS_TOO_MUCH")) {
      shareNote =
        "Telegram refused to create the shareable folder link because the account has reached Telegram's chat-list/folder sharing limit.";
    } else {
      shareNote = `Telegram refused to create a shareable link: ${msg}`;
    }
  }

  /**
   * Save final job state.
   */
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

  return {
    jobId,
    totals,
    name,
    shareLink,
    shareNote,
    folderCount: parsed.length,
    ok,
    failed,
    joined: 0,
  };
}
