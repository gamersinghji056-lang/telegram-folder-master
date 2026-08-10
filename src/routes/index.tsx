import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Copy, RefreshCw, LogOut } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { StatusRow } from "@/components/StatusRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSetupState,
  saveWorkerUrl,
  saveCredentials,
  startPhoneLogin,
  submitPhoneCode,
  submitPassword,
  runConnectionTest,
  disconnectTelegram,
  rotateWorkerToken,
  type WorkerCheck,
} from "@/lib/setup.functions";

const APP_URL = "https://project--c67f1abf-f9f6-443f-b8db-3b7efbba99c6.lovable.app";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Telegram Folder Merger — Setup & Status" },
      {
        name: "description",
        content:
          "One-time setup for a Telegram bot that merges multiple folder links into one clean folder: imports chats, removes duplicates by chat ID and drops inaccessible chats.",
      },
      { property: "og:title", content: "Telegram Folder Merger — Setup & Status" },
      {
        property: "og:description",
        content:
          "Merge multiple Telegram folder links into one clean, de-duplicated master folder from your bot.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SetupPage,
});

function Section({
  n,
  title,
  desc,
  children,
}: {
  n: number;
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-6">
      <div className="flex items-start gap-3">
        <span className="step-num">{n}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {desc ? <p className="mt-1 text-sm text-muted-foreground">{desc}</p> : null}
          <div className="mt-4">{children}</div>
        </div>
      </div>
    </section>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-display text-xs" />
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success("Copied");
          }}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function SetupPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) void navigate({ to: "/auth" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="font-display text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }
  return <SetupConsole />;
}

function SetupConsole() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["setup"],
    queryFn: () => getSetupState(),
    refetchInterval: 20_000,
  });

  const [workerUrl, setWorkerUrl] = useState("");
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [botToken, setBotToken] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [authStage, setAuthStage] = useState<"phone" | "code" | "password">("phone");
  const [checks, setChecks] = useState<WorkerCheck[] | null>(null);

  useEffect(() => {
    if (data?.workerUrl) setWorkerUrl((v) => v || data.workerUrl!);
  }, [data?.workerUrl]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["setup"] });
  const fail = (e: unknown) => toast.error((e as Error).message);

  const mUrl = useMutation({
    mutationFn: (u: string) => saveWorkerUrl({ data: { workerUrl: u } }),
    onSuccess: () => {
      toast.success("Worker URL saved");
      invalidate();
    },
    onError: fail,
  });
  const mRotate = useMutation({
    mutationFn: () => rotateWorkerToken(),
    onSuccess: () => {
      toast.success("New token generated — update it in your worker and redeploy");
      invalidate();
    },
    onError: fail,
  });
  const mCreds = useMutation({
    mutationFn: (v: Record<string, string>) =>
      saveCredentials({ data: v as { apiId: string } }),
    onSuccess: () => {
      toast.success("Saved securely");
      setApiId("");
      setApiHash("");
      setBotToken("");
      invalidate();
    },
    onError: fail,
  });
  const mPhone = useMutation({
    mutationFn: (p: string) => startPhoneLogin({ data: { phone: p } }),
    onSuccess: () => {
      setAuthStage("code");
      toast.success("Telegram sent you a login code");
    },
    onError: fail,
  });
  const mCode = useMutation({
    mutationFn: (c: string) => submitPhoneCode({ data: { code: c } }),
    onSuccess: (r) => {
      setCode("");
      if (r.needsPassword) {
        setAuthStage("password");
        toast.message("Two-factor password required");
      } else {
        setAuthStage("phone");
        toast.success(r.message ?? "Connected");
        invalidate();
      }
    },
    onError: fail,
  });
  const mPw = useMutation({
    mutationFn: (p: string) => submitPassword({ data: { password: p } }),
    onSuccess: (r) => {
      setPw("");
      setAuthStage("phone");
      toast.success(r.message ?? "Connected");
      invalidate();
    },
    onError: fail,
  });
  const mTest = useMutation({
    mutationFn: () => runConnectionTest(),
    onSuccess: (r) => {
      setChecks(r.checks ?? null);
      if (r.ok) toast.success("All systems verified");
      else toast.error("Some checks failed");
      invalidate();
    },
    onError: fail,
  });
  const mLogout = useMutation({
    mutationFn: () => disconnectTelegram(),
    onSuccess: () => {
      toast.success("Telegram account disconnected");
      invalidate();
    },
    onError: fail,
  });

  if (isLoading || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="font-display text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }

  const s = data.worker.info?.status ?? null;
  const online = data.worker.online;
  const ready = Boolean(online && s?.api_configured && s.bot_configured && s.session_configured);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-display text-xs uppercase tracking-[0.2em] text-primary">
            Folder Merger
          </p>
          <h1 className="mt-1 text-2xl font-semibold">Telegram Setup</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Configure once here. Then use the bot in Telegram.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={"size-4 " + (isFetching ? "animate-spin" : "")} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await supabase.auth.signOut();
              void navigate({ to: "/auth" });
            }}
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </header>

      {/* SYSTEM READY banner */}
      <section
        className={
          "panel mb-8 p-6 " + (ready ? "border-success/50" : "border-border")
        }
      >
        <h2 className="font-display text-sm uppercase tracking-widest">
          {ready ? "System ready" : "Setup incomplete"}
        </h2>
        <div className="mt-3">
          <StatusRow
            label="Backend"
            state={online ? "ok" : "fail"}
            detail={online ? "Worker reachable." : (data.worker.error ?? "Worker not reachable.")}
          />
          <StatusRow label="Database" state={online ? "ok" : "idle"} />
          <StatusRow label="Telegram API" state={s?.api_configured ? "ok" : "fail"} />
          <StatusRow
            label="Telegram Bot"
            state={s?.bot_configured ? "ok" : "fail"}
            detail={s?.bot_username ? `@${s.bot_username}` : null}
          />
          <StatusRow
            label="Telegram Account"
            state={s?.session_configured ? "ok" : "fail"}
            detail={s?.telegram_username ? `@${s.telegram_username}` : null}
          />
          <StatusRow label="Telegram Session" state={s?.session_configured ? "ok" : "fail"} />
          <StatusRow
            label="Telegram Premium"
            state={s?.is_premium ? "ok" : "idle"}
            detail={
              s?.is_premium
                ? "Shareable folder links can be generated."
                : "Without Premium, Telegram will not issue a shareable folder link."
            }
          />
        </div>
        {ready ? (
          <p className="mt-4 rounded-md bg-success/10 p-3 text-sm text-success">
            Your Telegram Folder Merger Bot is ready. Open Telegram, message
            {s?.bot_username ? ` @${s.bot_username}` : " your bot"} and send /addfolder.
          </p>
        ) : null}
      </section>

      <div className="space-y-4">
        <Section
          n={1}
          title="Backend worker"
          desc="Telegram's user API needs a long-running process, which serverless hosting cannot provide. Deploy the worker/ folder from this project to Railway, Fly.io or any VPS, set the three variables below, then paste its public URL here."
        >
          <div className="space-y-4">
            <CopyField label="APP_URL" value={APP_URL} />
            <CopyField label="WORKER_TOKEN" value={data.workerToken} />
            <p className="text-xs text-muted-foreground">
              Also set <code className="font-display">ENCRYPTION_KEY</code> to 64 random hex
              characters (<code className="font-display">openssl rand -hex 32</code>). It encrypts
              your Telegram credentials and session at rest.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="workerUrl">Worker public URL</Label>
              <div className="flex gap-2">
                <Input
                  id="workerUrl"
                  placeholder="https://your-worker.up.railway.app"
                  value={workerUrl}
                  onChange={(e) => setWorkerUrl(e.target.value)}
                />
                <Button
                  onClick={() => mUrl.mutate(workerUrl)}
                  disabled={!workerUrl || mUrl.isPending}
                >
                  Save
                </Button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className={online ? "text-success" : "text-destructive"}>
                {online ? "Worker online." : (data.worker.error ?? "Worker offline.")}
              </span>
              <button
                type="button"
                className="text-muted-foreground underline-offset-4 hover:underline"
                onClick={() => mRotate.mutate()}
              >
                Rotate token
              </button>
            </div>
          </div>
        </Section>

        <Section
          n={2}
          title="Telegram API"
          desc="From my.telegram.org → API development tools. Stored encrypted on your worker; never shown again."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="apiId">API ID</Label>
              <Input
                id="apiId"
                inputMode="numeric"
                placeholder={s?.api_configured ? "•••••• (saved)" : "1234567"}
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="apiHash">API Hash</Label>
              <Input
                id="apiHash"
                type="password"
                placeholder={s?.api_configured ? "•••••••••••••••• (saved)" : "32 hex characters"}
                value={apiHash}
                onChange={(e) => setApiHash(e.target.value)}
              />
            </div>
          </div>
          <Button
            className="mt-3"
            disabled={!online || (!apiId && !apiHash) || mCreds.isPending}
            onClick={() => {
              const v: Record<string, string> = {};
              if (apiId) v['apiId'] = apiId;
              if (apiHash) v['apiHash'] = apiHash;
              mCreds.mutate(v);
            }}
          >
            Save API credentials
          </Button>
        </Section>

        <Section n={3} title="Telegram bot" desc="The bot token from @BotFather.">
          <div className="space-y-1.5">
            <Label htmlFor="botToken">Bot token</Label>
            <Input
              id="botToken"
              type="password"
              placeholder={s?.bot_configured ? "•••••••••••••••• (saved)" : "123456:ABC-DEF..."}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
            />
          </div>
          <Button
            className="mt-3"
            disabled={!online || !botToken || mCreds.isPending}
            onClick={() => mCreds.mutate({ botToken })}
          >
            Save bot token
          </Button>
        </Section>

        <Section
          n={4}
          title="Telegram account"
          desc="Your personal account authorizes the folder access. The code and 2FA password go straight to Telegram through your worker — they are never stored or logged."
        >
          {s?.session_configured ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-success">
                Connected{s.telegram_username ? ` as @${s.telegram_username}` : ""}.
              </p>
              <Button variant="outline" size="sm" onClick={() => mLogout.mutate()}>
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {authStage === "phone" && (
                <div className="flex gap-2">
                  <Input
                    placeholder="+15551234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <Button
                    disabled={!online || !phone || mPhone.isPending}
                    onClick={() => mPhone.mutate(phone)}
                  >
                    Connect
                  </Button>
                </div>
              )}
              {authStage === "code" && (
                <div className="flex gap-2">
                  <Input
                    placeholder="Login code from Telegram"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                  <Button disabled={!code || mCode.isPending} onClick={() => mCode.mutate(code)}>
                    Verify
                  </Button>
                </div>
              )}
              {authStage === "password" && (
                <div className="flex gap-2">
                  <Input
                    type="password"
                    placeholder="Two-factor password"
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                  />
                  <Button disabled={!pw || mPw.isPending} onClick={() => mPw.mutate(pw)}>
                    Verify
                  </Button>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section n={5} title="Connection test" desc="Runs a real check against every component.">
          <Button onClick={() => mTest.mutate()} disabled={!online || mTest.isPending}>
            {mTest.isPending ? "Testing…" : "Run test"}
          </Button>
          {checks ? (
            <div className="mt-4">
              {checks.map((c) => (
                <StatusRow key={c.name} label={c.name} state={c.ok ? "ok" : "fail"} detail={c.detail} />
              ))}
            </div>
          ) : null}
        </Section>
      </div>

      <section className="panel mt-8 p-6 text-sm leading-relaxed">
        <h2 className="font-display text-sm uppercase tracking-widest">Guide</h2>
        <dl className="mt-4 space-y-4 text-muted-foreground">
          <div>
            <dt className="font-medium text-foreground">What was configured</dt>
            <dd>
              A database for chats and jobs, this setup site, and your own MTProto worker that holds
              the authorized Telegram session and runs the bot.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Where credentials live</dt>
            <dd>
              Your API hash, bot token and Telegram session are AES-256-GCM encrypted by the worker
              before storage. The website only ever stores ciphertext and never displays them again.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">How authorization works</dt>
            <dd>
              The worker opens a Telegram login for your phone number; you enter the code (and 2FA
              password if set) on this page. Those values are used in memory only.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">Using the bot</dt>
            <dd>
              Send <code className="font-display">/addfolder</code>, then your{" "}
              <code className="font-display">t.me/addlist/…</code> links one per line, then a folder
              name (or <code className="font-display">-</code>). The bot reports real per-folder
              counts, duplicates, exclusions and the final link.
            </dd>
          </div>
          <div>
            <dt className="font-medium text-foreground">If the connection expires</dt>
            <dd>
              Telegram sessions can be revoked from your device list. The bot will say the session
              expired — come back here, disconnect, and connect again.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}