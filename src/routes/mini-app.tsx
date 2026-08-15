import { createFileRoute } from "@tanstack/react-router";
import { Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  openTelegramLink?: (url: string) => void;
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

type MiniStatus = {
  ok: boolean;
  connected: boolean;
  botUser?: { username: string | null; firstName: string | null };
  account?: { username: string | null; firstName: string | null };
};

type Group = {
  telegramChatId: number;
  title: string;
  username: string | null;
  chatType: string;
  accessStatus: string;
  alreadyJoined: boolean;
};

type Analysis = {
  ok: boolean;
  jobId: string;
  folders: Array<{
    id: string;
    position: number;
    url: string;
    title: string | null;
    status: string;
    chats_found: number;
    error: string | null;
  }>;
  summary: {
    sourceFolders: number;
    sourceFoldersOk: number;
    sourceFoldersFailed: number;
    totalGroups: number;
    duplicates: number;
    alreadyJoined: number;
    availableToJoin: number;
    inaccessibleExcluded: number;
    finalEligibleGroups: number;
  };
  groups: Group[];
};

type FinalResult = {
  ok: boolean;
  folderName: string;
  groupsJoined: number;
  groupsInFolder: number;
  groupsExcluded: number;
  excluded: Array<Group & { reason: string }>;
  shareLink: string | null;
  shareError: string | null;
};

type HistoryFolder = {
  id: string;
  folder_name: string | null;
  share_link: string | null;
  share_link_note: string | null;
  final_chats: number;
  status: string;
  updated_at: string;
};

type Stage = "loading" | "phone" | "code" | "password" | "app";
type View = "dashboard" | "create" | "history" | "account";

export const Route = createFileRoute("/mini-app")({
  head: () => ({
    meta: [
      { title: "Telegram Folder Mini App" },
      {
        name: "description",
        content: "Connect Telegram, analyze folder links, and create a clean shareable folder.",
      },
    ],
  }),
  component: MiniApp,
});

function PrimaryButton({
  children,
  disabled,
  onClick,
  type = "button",
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border border-border bg-secondary/40 p-3">
      <div className="font-display text-lg">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

export function MiniApp() {
  const [initData, setInitData] = useState("");
  const [stage, setStage] = useState<Stage>("loading");
  const [status, setStatus] = useState<MiniStatus | null>(null);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [links, setLinks] = useState("");
  const [folderName, setFolderName] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [result, setResult] = useState<FinalResult | null>(null);
  const [history, setHistory] = useState<HistoryFolder[]>([]);
  const [view, setView] = useState<View>("dashboard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = useMemo(
    () =>
      links
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [links],
  );

  useEffect(() => {
    const boot = () => {
      const app = window.Telegram?.WebApp;
      app?.ready();
      app?.expand();
      setInitData(app?.initData ?? "");
    };

    if (window.Telegram?.WebApp) {
      boot();
      return;
    }

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-web-app.js";
    script.async = true;
    script.onload = boot;
    document.head.appendChild(script);
  }, []);

  const mini = useCallback(
    async function mini<T>(action: string, payload: Record<string, unknown> = {}) {
      if (!initData) throw new Error("Open this page from the Telegram bot Mini App button.");

      const res = await fetch("/api/public/mini", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload: { ...payload, initData } }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
      return data as T;
    },
    [initData],
  );

  const refresh = useCallback(
    async function refresh() {
      setBusy(true);
      setError(null);
      try {
        const next = await mini<MiniStatus>("status");
        setStatus(next);
        setStage(next.connected ? "app" : "phone");
        if (next.connected) {
          const saved = await mini<{ folders: HistoryFolder[] }>("history").catch(() => ({
            folders: [],
          }));
          setHistory(saved.folders ?? []);
        }
      } catch (e) {
        setError((e as Error).message);
        setStage("phone");
      } finally {
        setBusy(false);
      }
    },
    [mini],
  );

  useEffect(() => {
    if (initData) void refresh();
  }, [initData, refresh]);

  async function startLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await mini("sendCode", { phone });
      setStage("code");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await mini<{ needsPassword?: boolean }>("signIn", { code });
      if (data.needsPassword) {
        setStage("password");
      } else {
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await mini("checkPassword", { password });
      setPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function analyze(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const data = await mini<Analysis>("analyzeFolders", { urls: lines });
      setAnalysis(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmCreate() {
    if (!analysis) return;
    setBusy(true);
    setError(null);
    try {
      const data = await mini<FinalResult>("joinAndCreate", {
        jobId: analysis.jobId,
        folderName,
      });
      setResult(data);
      const saved = await mini<{ folders: HistoryFolder[] }>("history").catch(() => ({
        folders: [],
      }));
      setHistory(saved.folders ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openLink(link: string) {
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(link);
      return;
    }
    window.open(link, "_blank", "noopener,noreferrer");
  }

  const accountName =
    status?.account?.username ||
    status?.account?.firstName ||
    status?.botUser?.firstName ||
    "Telegram";

  return (
    <main className="min-h-screen px-4 py-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-5 flex items-start justify-between gap-3">
          <div>
            <p className="font-display text-xs uppercase tracking-[0.2em] text-primary">
              Telegram Mini App
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Folder Merger</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {status?.connected ? `Connected as ${accountName}` : "Connect your Telegram account."}
            </p>
          </div>
          <SecondaryButton disabled={busy || !initData} onClick={() => void refresh()}>
            <RefreshCw className={"size-4 " + (busy ? "animate-spin" : "")} />
          </SecondaryButton>
        </header>

        {!initData ? (
          <section className="panel p-5 text-sm text-muted-foreground">
            Open this from the bot's Mini App button.
          </section>
        ) : null}

        {error ? (
          <section className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </section>
        ) : null}

        {stage === "phone" ? (
          <section className="panel p-5">
            <h2 className="text-base font-semibold">Connect Telegram</h2>
            <form onSubmit={startLogin} className="mt-4 space-y-3">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+919876543210"
                inputMode="tel"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <PrimaryButton type="submit" disabled={busy || !phone.trim()}>
                Send OTP
              </PrimaryButton>
            </form>
          </section>
        ) : null}

        {stage === "code" ? (
          <section className="panel p-5">
            <h2 className="text-base font-semibold">Enter Telegram OTP</h2>
            <form onSubmit={submitCode} className="mt-4 space-y-3">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="Login code"
                inputMode="numeric"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="flex flex-wrap gap-2">
                <PrimaryButton type="submit" disabled={busy || !code.trim()}>
                  Verify
                </PrimaryButton>
                <SecondaryButton
                  disabled={busy}
                  onClick={async () => {
                    await mini("cancelLogin").catch(() => {});
                    setStage("phone");
                  }}
                >
                  Cancel
                </SecondaryButton>
              </div>
            </form>
          </section>
        ) : null}

        {stage === "password" ? (
          <section className="panel p-5">
            <h2 className="text-base font-semibold">Telegram 2FA Password</h2>
            <form onSubmit={submitPassword} className="mt-4 space-y-3">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="2FA password"
                type="password"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <PrimaryButton type="submit" disabled={busy || !password}>
                Complete Login
              </PrimaryButton>
            </form>
          </section>
        ) : null}

        {stage === "app" ? (
          <div className="space-y-5">
            <section className="panel p-3">
              <div className="grid grid-cols-3 gap-2">
                {(["create", "history", "account"] as View[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setView(item)}
                    className={
                      "rounded-md px-3 py-2 text-sm " +
                      (view === item ? "bg-primary text-primary-foreground" : "bg-secondary")
                    }
                  >
                    {item === "create"
                      ? "Create Folder"
                      : item === "history"
                        ? "My Folders"
                        : "Account"}
                  </button>
                ))}
              </div>
            </section>

            {view === "dashboard" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">Dashboard</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setView("create")}
                    className="rounded-md border border-border bg-secondary/40 p-4 text-left"
                  >
                    <div className="font-medium">Create Folder</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Analyze first, then join and create after confirmation.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("history")}
                    className="rounded-md border border-border bg-secondary/40 p-4 text-left"
                  >
                    <div className="font-medium">My Folders</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Open or copy your saved shareable links.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("account")}
                    className="rounded-md border border-border bg-secondary/40 p-4 text-left"
                  >
                    <div className="font-medium">Telegram Account</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      View the account linked to this Telegram user.
                    </div>
                  </button>
                </div>
              </section>
            ) : null}

            {view === "create" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">Analyze Folder Links</h2>
                <form onSubmit={analyze} className="mt-4 space-y-3">
                  <textarea
                    value={links}
                    onChange={(e) => setLinks(e.target.value)}
                    placeholder={"https://t.me/addlist/...\nhttps://t.me/addlist/..."}
                    rows={6}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <input
                    value={folderName}
                    onChange={(e) => setFolderName(e.target.value)}
                    placeholder="New folder name"
                    maxLength={60}
                    className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <PrimaryButton type="submit" disabled={busy || lines.length === 0}>
                    Analyze
                  </PrimaryButton>
                </form>
              </section>
            ) : null}

            {view === "create" && analysis ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">Analysis Results</h2>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat label="Source folders" value={analysis.summary.sourceFolders} />
                  <Stat label="Total groups" value={analysis.summary.totalGroups} />
                  <Stat label="Duplicates" value={analysis.summary.duplicates} />
                  <Stat label="Already joined" value={analysis.summary.alreadyJoined} />
                  <Stat label="Available to join" value={analysis.summary.availableToJoin} />
                  <Stat label="Excluded" value={analysis.summary.inaccessibleExcluded} />
                  <Stat label="Final eligible" value={analysis.summary.finalEligibleGroups} />
                </div>

                <h3 className="mt-5 text-sm font-semibold">Source Folders</h3>
                <div className="mt-2 space-y-2">
                  {analysis.folders.map((folder) => (
                    <div key={folder.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="font-medium">
                        {folder.title || `Folder ${folder.position}`}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {folder.status} · {folder.chats_found} groups
                        {folder.error ? ` · ${folder.error}` : ""}
                      </div>
                    </div>
                  ))}
                </div>

                <h3 className="mt-5 text-sm font-semibold">Eligible Groups</h3>
                <div className="mt-2 max-h-80 space-y-2 overflow-auto pr-1">
                  {analysis.groups.map((group) => (
                    <div
                      key={group.telegramChatId}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{group.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {group.chatType} · {group.alreadyJoined ? "Already joined" : "Available"}
                        </div>
                      </div>
                      <span className="font-display text-xs text-muted-foreground">
                        {group.telegramChatId}
                      </span>
                    </div>
                  ))}
                  {analysis.groups.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No eligible groups found.</p>
                  ) : null}
                </div>

                <div className="mt-5 flex flex-wrap gap-2">
                  <PrimaryButton
                    disabled={busy || analysis.groups.length === 0}
                    onClick={() => void confirmCreate()}
                  >
                    Join Groups & Create Folder
                  </PrimaryButton>
                  <SecondaryButton
                    disabled={busy}
                    onClick={() => {
                      setAnalysis(null);
                      setResult(null);
                    }}
                  >
                    Cancel
                  </SecondaryButton>
                </div>
              </section>
            ) : null}

            {view === "create" && result ? (
              <section className="panel border-success/50 p-5">
                <h2 className="text-base font-semibold text-success">Folder Created</h2>
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Stat label="Folder name" value={result.folderName} />
                  <Stat label="Final group count" value={result.groupsInFolder} />
                  <Stat label="Groups excluded" value={result.groupsExcluded} />
                </div>

                {result.shareLink ? (
                  <div className="mt-5 rounded-md border border-border bg-secondary/40 p-3">
                    <div className="text-xs text-muted-foreground">Shareable Link</div>
                    <div className="mt-1 break-all font-display text-sm">{result.shareLink}</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <PrimaryButton onClick={() => openLink(result.shareLink!)}>
                        <ExternalLink className="size-4" />
                        Open Folder
                      </PrimaryButton>
                      <SecondaryButton
                        onClick={() => void navigator.clipboard.writeText(result.shareLink!)}
                      >
                        <Copy className="size-4" />
                        Copy Link
                      </SecondaryButton>
                    </div>
                  </div>
                ) : (
                  <div className="mt-5 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm text-warning">
                    Telegram created the folder, but shareable-link generation failed:{" "}
                    {result.shareError}
                  </div>
                )}

                {result.excluded.length ? (
                  <div className="mt-5">
                    <h3 className="text-sm font-semibold">Excluded After Join Attempt</h3>
                    <div className="mt-2 space-y-2">
                      {result.excluded.map((group) => (
                        <div
                          key={group.telegramChatId}
                          className="rounded-md border border-border p-3 text-sm"
                        >
                          <div className="font-medium">{group.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{group.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

            {view === "history" ? (
              <section className="panel p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">My Folders</h2>
                  <SecondaryButton
                    disabled={busy}
                    onClick={async () => {
                      const saved = await mini<{ folders: HistoryFolder[] }>("history");
                      setHistory(saved.folders ?? []);
                    }}
                  >
                    <RefreshCw className="size-4" />
                  </SecondaryButton>
                </div>
                <div className="mt-4 space-y-3">
                  {history.map((folder) => (
                    <div key={folder.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="font-medium">{folder.folder_name || "Telegram Folder"}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {folder.final_chats} groups - {folder.status}
                      </div>
                      {folder.share_link ? (
                        <div className="mt-3 rounded-md bg-secondary/40 p-3">
                          <div className="break-all font-display text-xs">{folder.share_link}</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <PrimaryButton onClick={() => openLink(folder.share_link!)}>
                              <ExternalLink className="size-4" />
                              Open Folder
                            </PrimaryButton>
                            <SecondaryButton
                              onClick={() => void navigator.clipboard.writeText(folder.share_link!)}
                            >
                              <Copy className="size-4" />
                              Copy Link
                            </SecondaryButton>
                          </div>
                        </div>
                      ) : folder.share_link_note ? (
                        <div className="mt-3 text-xs text-warning">{folder.share_link_note}</div>
                      ) : null}
                    </div>
                  ))}
                  {history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No folders created yet.</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {view === "account" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">Telegram Account</h2>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="rounded-md border border-border bg-secondary/40 p-3">
                    <div className="text-xs text-muted-foreground">Connected account</div>
                    <div className="mt-1 font-medium">{accountName}</div>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/40 p-3">
                    <div className="text-xs text-muted-foreground">Session</div>
                    <div className="mt-1 font-medium">Connected for this Telegram user</div>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
