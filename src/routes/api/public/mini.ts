import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  action: z.enum([
    "status",
    "sendCode",
    "signIn",
    "checkPassword",
    "cancelLogin",
    "analyzeFolders",
    "joinAndCreate",
    "history",
    "logout",
  ]),
  payload: z.record(z.string(), z.unknown()).default({}),
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

async function callWorker(
  workerUrl: string,
  workerToken: string,
  action: string,
  payload: Record<string, unknown>,
) {
  const res = await fetch(`${workerUrl.replace(/\/+$/, "")}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${workerToken}`,
    },
    body: JSON.stringify({ action: `mini${action[0].toUpperCase()}${action.slice(1)}`, payload }),
    signal: AbortSignal.timeout(120_000),
  });

  const text = await res.text();
  let data: Record<string, unknown>;

  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return json({ error: `Worker returned non-JSON response (HTTP ${res.status}).` }, 502);
  }

  if (!res.ok)
    return json({ error: data.error ?? `Worker error (HTTP ${res.status}).` }, res.status);

  return json(data);
}

export const Route = createFileRoute("/api/public/mini")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json({ error: "bad_request" }, 400);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const db = supabaseAdmin as never as {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          from: (table: string) => any;
        };

        const { data: link, error } = await db
          .from("worker_link")
          .select("worker_url, worker_token, updated_at")
          .not("worker_url", "is", null)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) return json({ error: error.message }, 500);
        if (!link?.worker_url || !link?.worker_token) {
          return json({ error: "Worker URL is not configured." }, 503);
        }

        return callWorker(
          link.worker_url,
          link.worker_token,
          parsed.data.action,
          parsed.data.payload,
        );
      },
    },
  },
});
