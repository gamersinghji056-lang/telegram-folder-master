import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

/**
 * Worker <-> App API.
 *
 * The MTProto worker (deployed by the user on Railway/Fly/VPS) is the only
 * caller. It authenticates with the per-user worker token that the website
 * generated. All Telegram secrets arrive here ALREADY ENCRYPTED by the worker;
 * this app stores opaque blobs and never decrypts them.
 */

const ACCESS_STATUSES = [
  "ACCESSIBLE",
  "INACCESSIBLE",
  "DELETED",
  "DEACTIVATED",
  "EXPIRED",
  "REVOKED",
  "NO_PERMISSION",
  "JOIN_REQUIRED",
  "UNKNOWN",
] as const;

const chatSchema = z.object({
  telegram_chat_id: z.number(),
  access_hash: z.string().nullable().optional(),
  title: z.string().max(512).nullable().optional(),
  username: z.string().max(128).nullable().optional(),
  chat_type: z.enum(["GROUP", "SUPERGROUP", "CHANNEL", "UNKNOWN"]).default("UNKNOWN"),
  access_status: z.enum(ACCESS_STATUSES).default("UNKNOWN"),
});

const botUserIdSchema = z.number().int().positive().safe();

const userSessionSchema = z.object({
  bot_user_id: botUserIdSchema,
  bot_chat_id: z.number().int().safe().optional().nullable(),
  phone: z.string().max(32).optional().nullable(),
  session_enc: z.string().min(1).max(20_000),
  telegram_account_id: z.number().int().safe().optional().nullable(),
  telegram_username: z.string().max(128).optional().nullable(),
  first_name: z.string().max(128).optional().nullable(),
  last_name: z.string().max(128).optional().nullable(),
  is_premium: z.boolean().optional(),
});

const bodySchema = z.object({
  action: z.string().min(1).max(64),
  payload: z.record(z.string(), z.unknown()).default({}),
});

type CanonicalChatRow = { id: string; telegram_chat_id: number };
type JobChatTotalRow = { is_duplicate: boolean; eligible: boolean; access_status: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (token.length < 20) return json({ error: "unauthorized" }, 401);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "bad_request" }, 400);
        const { action } = parsed.data;
        const payload = parsed.data.payload as Record<string, never>;

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: link } = await supabaseAdmin
          .from("worker_link")
          .select("user_id")
          .eq("worker_token", token)
          .maybeSingle();
        if (!link) return json({ error: "unauthorized" }, 401);
        const userId = link.user_id;

        await supabaseAdmin
          .from("worker_link")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("user_id", userId);

        const p = payload as Record<string, unknown>;
        const db = supabaseAdmin as never as {
          // New multi-user worker tables may not exist in generated Supabase types yet.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          from: (table: string) => any;
        };

        switch (action) {
          case "heartbeat":
            return json({ ok: true, user_id: userId });

          case "pull": {
            const { data } = await supabaseAdmin
              .from("telegram_config")
              .select("api_id_enc, api_hash_enc, bot_token_enc, session_enc, phone, bot_username")
              .eq("user_id", userId)
              .maybeSingle();
            return json({ ok: true, config: data ?? null });
          }

          case "saveConfig": {
            const patch: Record<string, unknown> = { user_id: userId };
            for (const k of [
              "api_id_enc",
              "api_hash_enc",
              "bot_token_enc",
              "session_enc",
              "phone",
              "bot_username",
              "telegram_user_id",
              "telegram_username",
              "is_premium",
            ]) {
              if (k in p) patch[k] = p[k];
            }
            const { error } = await supabaseAdmin
              .from("telegram_config")
              .upsert(patch as never, { onConflict: "user_id" });
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }

          case "setStatus": {
            const patch: Record<string, unknown> = { user_id: userId };
            for (const k of [
              "api_configured",
              "bot_configured",
              "session_configured",
              "bot_username",
              "telegram_username",
              "is_premium",
              "last_error",
            ]) {
              if (k in p) patch[k] = p[k];
            }
            const { error } = await supabaseAdmin
              .from("telegram_status")
              .upsert(patch as never, { onConflict: "user_id" });
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }

          case "pullUserSession": {
            const botUserId = botUserIdSchema.parse(p["bot_user_id"]);
            const { data, error } = await db
              .from("telegram_user_sessions")
              .select(
                "bot_user_id, bot_chat_id, phone, session_enc, telegram_account_id, telegram_username, first_name, last_name, is_premium, last_connected_at",
              )
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .maybeSingle();
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true, session: data ?? null });
          }

          case "saveUserSession": {
            const data = userSessionSchema.parse(p);
            const { error } = await db.from("telegram_user_sessions").upsert(
              {
                user_id: userId,
                ...data,
                last_connected_at: new Date().toISOString(),
              },
              { onConflict: "user_id,bot_user_id" },
            );
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true, bot_user_id: data.bot_user_id });
          }

          case "deleteUserSession": {
            const botUserId = botUserIdSchema.parse(p["bot_user_id"]);
            const { error } = await db
              .from("telegram_user_sessions")
              .delete()
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }

          case "createJob": {
            const botUserId = botUserIdSchema.parse(p["bot_user_id"]);
            const urls = z.array(z.string().max(400)).min(1).max(100).parse(p["urls"]);
            const { data: job, error } = await db
              .from("jobs")
              .insert({
                user_id: userId,
                bot_user_id: botUserId,
                bot_chat_id:
                  typeof p["bot_chat_id"] === "number" ? (p["bot_chat_id"] as number) : null,
                status: "RUNNING",
                stage: "Starting",
                folders_total: urls.length,
              })
              .select("id")
              .single();
            if (error || !job) return json({ error: error?.message ?? "insert_failed" }, 500);

            const { data: folders, error: fErr } = await db
              .from("job_folders")
              .insert(
                urls.map((url, i) => ({
                  job_id: job.id,
                  user_id: userId,
                  bot_user_id: botUserId,
                  position: i + 1,
                  url,
                })),
              )
              .select("id, position, url");
            if (fErr) return json({ error: fErr.message }, 500);
            return json({ ok: true, job_id: job.id, folders });
          }

          case "updateJob": {
            const jobId = z.string().uuid().parse(p["job_id"]);
            const patch = (p["patch"] ?? {}) as Record<string, unknown>;
            const { error } = await supabaseAdmin
              .from("jobs")
              .update(patch as never)
              .eq("id", jobId)
              .eq("user_id", userId);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }

          case "updateFolder": {
            const folderId = z.string().uuid().parse(p["folder_id"]);
            const patch = (p["patch"] ?? {}) as Record<string, unknown>;
            const { error } = await supabaseAdmin
              .from("job_folders")
              .update(patch as never)
              .eq("id", folderId)
              .eq("user_id", userId);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true });
          }

          /**
           * Records every chat found in one source folder.
           * Duplicate detection is done here, by Telegram chat/peer ID only.
           */
          case "recordFolderChats": {
            const jobId = z.string().uuid().parse(p["job_id"]);
            const folderId = z.string().uuid().parse(p["folder_id"]);
            const chats = z
              .array(chatSchema)
              .max(2000)
              .parse(p["chats"] ?? []);
            if (chats.length === 0) return json({ ok: true, inserted: 0, duplicates: 0 });

            const { data: job, error: jobErr } = await db
              .from("jobs")
              .select("bot_user_id")
              .eq("id", jobId)
              .eq("user_id", userId)
              .maybeSingle();
            if (jobErr) return json({ error: jobErr.message }, 500);
            if (!job) return json({ error: "job_not_found" }, 404);
            const botUserId = Number(job.bot_user_id);

            const ids = chats.map((c) => c.telegram_chat_id);

            // Canonical chat rows are unique per bot user and Telegram chat ID.
            const { error: upErr } = await db.from("chats").upsert(
              chats.map((c) => ({
                user_id: userId,
                bot_user_id: botUserId,
                telegram_chat_id: c.telegram_chat_id,
                access_hash: c.access_hash ?? null,
                title: c.title ?? null,
                username: c.username ?? null,
                chat_type: c.chat_type,
                access_status: c.access_status,
              })),
              { onConflict: "user_id,bot_user_id,telegram_chat_id" },
            );
            if (upErr) return json({ error: upErr.message }, 500);

            const { data: canonical } = await db
              .from("chats")
              .select("id, telegram_chat_id")
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .in("telegram_chat_id", ids);
            const canonicalRows = (canonical ?? []) as CanonicalChatRow[];
            const byTg = new Map(
              canonicalRows.map((c: CanonicalChatRow) => [Number(c.telegram_chat_id), c.id]),
            );

            // already seen earlier in this same job => duplicate
            const { data: seen } = await db
              .from("job_chats")
              .select("telegram_chat_id")
              .eq("job_id", jobId)
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .in("telegram_chat_id", ids);
            const seenRows = (seen ?? []) as Pick<CanonicalChatRow, "telegram_chat_id">[];
            const seenSet = new Set(
              seenRows.map((r: Pick<CanonicalChatRow, "telegram_chat_id">) =>
                Number(r.telegram_chat_id),
              ),
            );

            let duplicates = 0;
            const rows: Record<string, unknown>[] = [];
            for (const c of chats) {
              const chatId = byTg.get(c.telegram_chat_id);
              if (!chatId) continue;
              const isDup = seenSet.has(c.telegram_chat_id);
              if (isDup) duplicates += 1;
              else seenSet.add(c.telegram_chat_id);
              rows.push({
                job_id: jobId,
                user_id: userId,
                bot_user_id: botUserId,
                folder_id: folderId,
                chat_id: chatId,
                telegram_chat_id: c.telegram_chat_id,
                is_duplicate: isDup,
                eligible:
                  !isDup &&
                  (c.access_status === "ACCESSIBLE" || c.access_status === "JOIN_REQUIRED"),
                access_status: c.access_status,
              });
            }
            const { error: jcErr } = await db
              .from("job_chats")
              .upsert(rows as never, { onConflict: "job_id,folder_id,telegram_chat_id" });
            if (jcErr) return json({ error: jcErr.message }, 500);
            return json({ ok: true, inserted: rows.length, duplicates });
          }

          /** Marks a chat's real access status once the worker has verified it. */
          case "setChatStatus": {
            const jobId = z.string().uuid().parse(p["job_id"]);
            const tgId = z.number().parse(p["telegram_chat_id"]);
            const status = z.enum(ACCESS_STATUSES).parse(p["access_status"]);
            const { data: job, error: jobErr } = await db
              .from("jobs")
              .select("bot_user_id")
              .eq("id", jobId)
              .eq("user_id", userId)
              .maybeSingle();
            if (jobErr) return json({ error: jobErr.message }, 500);
            if (!job) return json({ error: "job_not_found" }, 404);
            const botUserId = Number(job.bot_user_id);
            await db
              .from("chats")
              .update({ access_status: status })
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .eq("telegram_chat_id", tgId);
            await db
              .from("job_chats")
              .update({
                access_status: status,
                eligible: status === "ACCESSIBLE" || status === "JOIN_REQUIRED",
              })
              .eq("job_id", jobId)
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .eq("telegram_chat_id", tgId)
              .eq("is_duplicate", false);
            return json({ ok: true });
          }

          case "jobAnalysisDetails": {
            const jobId = z.string().uuid().parse(p["job_id"]);
            const requestedBotUserId =
              typeof p["bot_user_id"] === "number" ? botUserIdSchema.parse(p["bot_user_id"]) : null;
            const { data: job, error: jobErr } = await db
              .from("jobs")
              .select("id, bot_user_id, status")
              .eq("id", jobId)
              .eq("user_id", userId)
              .maybeSingle();
            if (jobErr) return json({ error: jobErr.message }, 500);
            if (!job) return json({ error: "job_not_found" }, 404);
            const botUserId = Number(job.bot_user_id);
            if (requestedBotUserId !== null && requestedBotUserId !== botUserId) {
              return json({ error: "job_not_found" }, 404);
            }

            const { data: folders, error: foldersErr } = await db
              .from("job_folders")
              .select("id, position, url, slug, title, status, chats_found, error")
              .eq("job_id", jobId)
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .order("position", { ascending: true });
            if (foldersErr) return json({ error: foldersErr.message }, 500);

            const { data: groups, error: groupsErr } = await db
              .from("job_chats")
              .select(
                "folder_id, telegram_chat_id, access_status, eligible, is_duplicate, chats!inner(access_hash, chat_type, title, username)",
              )
              .eq("job_id", jobId)
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .eq("is_duplicate", false)
              .eq("eligible", true);
            if (groupsErr) return json({ error: groupsErr.message }, 500);

            return json({
              ok: true,
              job,
              folders: folders ?? [],
              groups: groups ?? [],
            });
          }

          case "userFolderHistory": {
            const botUserId = botUserIdSchema.parse(p["bot_user_id"]);
            const { data, error } = await db
              .from("jobs")
              .select(
                "id, folder_name, share_link, share_link_note, final_chats, status, created_at, updated_at",
              )
              .eq("user_id", userId)
              .eq("bot_user_id", botUserId)
              .in("status", ["DONE", "FAILED"])
              .not("folder_name", "is", null)
              .order("updated_at", { ascending: false })
              .limit(25);
            if (error) return json({ error: error.message }, 500);
            return json({ ok: true, folders: data ?? [] });
          }

          /** Final unique + eligible chats for this job. */
          case "finalChats": {
            const jobId = z.string().uuid().parse(p["job_id"]);
            const { data } = await db
              .from("job_chats")
              .select("telegram_chat_id, chats!inner(access_hash, chat_type, title)")
              .eq("job_id", jobId)
              .eq("user_id", userId)
              .eq("is_duplicate", false)
              .eq("eligible", true);
            return json({ ok: true, chats: data ?? [] });
          }

          case "jobTotals": {
            const jobId = z.string().uuid().parse(p["job_id"]);
            const { data } = await db
              .from("job_chats")
              .select("is_duplicate, eligible, access_status")
              .eq("job_id", jobId)
              .eq("user_id", userId);
            const rows = (data ?? []) as JobChatTotalRow[];
            return json({
              ok: true,
              totals: {
                total_chats: rows.length,
                duplicate_chats: rows.filter((r) => r.is_duplicate).length,
                unique_chats: rows.filter((r) => !r.is_duplicate).length,
                inaccessible_chats: rows.filter((r) => !r.is_duplicate && !r.eligible).length,
                final_chats: rows.filter((r) => !r.is_duplicate && r.eligible).length,
              },
            });
          }

          default:
            return json({ error: "unknown_action" }, 400);
        }
      },
    },
  },
});
