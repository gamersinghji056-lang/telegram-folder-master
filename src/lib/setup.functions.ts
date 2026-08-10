import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/** Talks to the user's own MTProto worker. Never exposes secrets to the browser. */
async function callWorker(
  workerUrl: string,
  workerToken: string,
  action: string,
  payload: Record<string, unknown> = {},
) {
  const base = workerUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify({ action, payload }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Worker returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(String(data["error"] ?? `Worker error (HTTP ${res.status}).`));
  return data;
}

/** Creates the worker link row on first visit and returns non-secret setup state. */
export const getSetupState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    let { data: link } = await supabase
      .from("worker_link")
      .select("worker_url, worker_token, last_seen_at")
      .eq("user_id", userId)
      .maybeSingle();

    if (!link) {
      const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
      const { data: created, error } = await supabase
        .from("worker_link")
        .insert({ user_id: userId, worker_token: token })
        .select("worker_url, worker_token, last_seen_at")
        .single();
      if (error) throw new Error(error.message);
      link = created;
    }

    const { data: status } = await supabase
      .from("telegram_status")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    let worker: { online: boolean; error: string | null; info: Record<string, unknown> | null } = {
      online: false,
      error: link.worker_url ? null : "Worker URL not set yet.",
      info: null,
    };
    if (link.worker_url) {
      try {
        const info = await callWorker(link.worker_url, link.worker_token, "status");
        worker = { online: true, error: null, info };
      } catch (e) {
        worker = { online: false, error: (e as Error).message, info: null };
      }
    }

    return {
      workerUrl: link.worker_url,
      workerToken: link.worker_token,
      lastSeenAt: link.last_seen_at,
      status: status ?? null,
      worker,
      appUrl: process.env["APP_PUBLIC_URL"] ?? null,
    };
  });

export const saveWorkerUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workerUrl: string }) =>
    z.object({ workerUrl: z.string().url().max(300) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("worker_link")
      .update({ worker_url: data.workerUrl.replace(/\/+$/, "") })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rotateWorkerToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { error } = await context.supabase
      .from("worker_link")
      .update({ worker_token: token })
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { workerToken: token };
  });

async function withWorker(
  supabase: { from: (t: string) => never },
  userId: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const { data: link } = await (
    supabase as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            a: string,
            b: string,
          ) => { maybeSingle: () => Promise<{ data: { worker_url: string; worker_token: string } | null }> };
        };
      };
    }
  )
    .from("worker_link")
    .select("worker_url, worker_token")
    .eq("user_id", userId)
    .maybeSingle();
  if (!link?.worker_url) throw new Error("Worker URL is not configured yet.");
  return callWorker(link.worker_url, link.worker_token, action, payload);
}

/** Step 3+4: API ID / hash / bot token. Forwarded to the worker, which encrypts them. */
export const saveCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { apiId?: string; apiHash?: string; botToken?: string }) =>
    z
      .object({
        apiId: z.string().regex(/^\d{4,12}$/).optional(),
        apiHash: z.string().regex(/^[a-f0-9]{32}$/i).optional(),
        botToken: z.string().regex(/^\d{6,12}:[\w-]{30,}$/).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    withWorker(context.supabase as never, context.userId, "saveCredentials", data),
  );

/** Step 5: Telegram user authorization (OTP / 2FA) — handled entirely server-side. */
export const startPhoneLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { phone: string }) =>
    z.object({ phone: z.string().regex(/^\+\d{7,15}$/) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    withWorker(context.supabase as never, context.userId, "sendCode", data),
  );

export const submitPhoneCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { code: string }) =>
    z.object({ code: z.string().regex(/^\d{4,8}$/) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    withWorker(context.supabase as never, context.userId, "signIn", data),
  );

export const submitPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { password: string }) =>
    z.object({ password: z.string().min(1).max(256) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    withWorker(context.supabase as never, context.userId, "checkPassword", data),
  );

/** Step 8: real end-to-end connection test. */
export const runConnectionTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    withWorker(context.supabase as never, context.userId, "selfTest", {}),
  );

export const disconnectTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    withWorker(context.supabase as never, context.userId, "logout", {}),
  );