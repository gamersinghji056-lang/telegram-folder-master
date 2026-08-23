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

type LoginResult = {
  ok: boolean;
  connected?: boolean;
  needsPassword?: boolean;
  account?: { username: string | null; firstName: string | null };
};

function connectedStatus(current: MiniStatus | null, result: LoginResult): MiniStatus {
  const next: MiniStatus = {
    ok: true,
    connected: true,
  };

  if (current?.botUser) next.botUser = current.botUser;

  const account = result.account ?? current?.account;
  if (account) next.account = account;

  return next;
}

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

type AgentProfile = {
  aiDisplayName: string;
  ownerName: string;
  businessOrProfession: string;
  businessDescription: string;
  aiPurpose: string;
  preferredLanguages: string[];
  communicationTone: string;
  productsServices: string[];
  allowedToShare: string[];
  restrictedPrivateInfo: string[];
  alwaysFollow: string[];
  neverDo: string[];
  onboardingStatus: string;
};

type TrainingStatus = {
  status: string;
  text: string;
};

type OwnerInstruction = {
  id: string;
  category: string;
  text: string;
  enabled: boolean;
};

type AiTrainingPayload = {
  training: TrainingStatus;
  profile: AgentProfile;
  instructions: OwnerInstruction[];
  result?: { text: string; status: string };
};

type Stage = "loading" | "phone" | "code" | "password" | "app";
type View = "dashboard" | "train" | "profile" | "instructions" | "create" | "history" | "account";

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
  const [training, setTraining] = useState<TrainingStatus | null>(null);
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [instructions, setInstructions] = useState<OwnerInstruction[]>([]);
  const [trainingAnswer, setTrainingAnswer] = useState("");
  const [profileDraft, setProfileDraft] = useState<Partial<AgentProfile>>({});
  const [instructionText, setInstructionText] = useState("");
  const [instructionCategory, setInstructionCategory] = useState("custom");
  const [editingInstructionId, setEditingInstructionId] = useState<string | null>(null);
  const [editingInstructionText, setEditingInstructionText] = useState("");
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

  function applyAiPayload(payload: Partial<AiTrainingPayload>) {
    if (payload.training) setTraining(payload.training);
    if (payload.profile) {
      setProfile(payload.profile);
      setProfileDraft(payload.profile);
    }
    if (payload.instructions) setInstructions(payload.instructions);
  }

  const refreshAiTraining = useCallback(
    async function refreshAiTraining() {
      const data = await mini<AiTrainingPayload>("aiTrainingStatus");
      applyAiPayload(data);
    },
    [mini],
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
          await refreshAiTraining().catch(() => {});
        }
      } catch (e) {
        setError((e as Error).message);
        setStage("phone");
      } finally {
        setBusy(false);
      }
    },
    [mini, refreshAiTraining],
  );

  useEffect(() => {
    if (initData) void refresh();
  }, [initData, refresh]);

  async function startLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await mini<LoginResult>("sendCode", { phone });
      if (data.connected) {
        setStatus((current) => connectedStatus(current, data));
        setPhone("");
        setCode("");
        setPassword("");
        setStage("app");
        setView("dashboard");
      } else {
        setStage("code");
      }
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
      const data = await mini<LoginResult>("signIn", { code });
      if (data.needsPassword) {
        setStage("password");
      } else if (data.connected) {
        setStatus((current) => connectedStatus(current, data));
        setPhone("");
        setCode("");
        setPassword("");
        setStage("app");
        setView("dashboard");
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
      const data = await mini<LoginResult>("checkPassword", { password });
      if (data.connected) {
        setStatus((current) => connectedStatus(current, data));
        setPhone("");
        setCode("");
        setPassword("");
        setStage("app");
        setView("dashboard");
      } else {
        setPassword("");
        await refresh();
      }
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

  async function startTraining() {
    setBusy(true);
    setError(null);
    try {
      const data = await mini<AiTrainingPayload>("aiTrainingStart");
      applyAiPayload(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitTrainingAnswer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await mini<AiTrainingPayload>("aiTrainingAnswer", {
        answer: trainingAnswer,
      });
      setTrainingAnswer("");
      applyAiPayload(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelTraining() {
    setBusy(true);
    setError(null);
    try {
      const data = await mini<AiTrainingPayload>("aiTrainingCancel");
      applyAiPayload(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await mini<{ profile: AgentProfile }>("aiProfileUpdate", {
        profile: profileDraft,
      });
      setProfile(data.profile);
      setProfileDraft(data.profile);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addInstruction(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await mini("aiInstructionAdd", {
        category: instructionCategory,
        text: instructionText,
      });
      setInstructionText("");
      await refreshAiTraining();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateInstruction(instruction: OwnerInstruction) {
    setBusy(true);
    setError(null);
    try {
      await mini("aiInstructionUpdate", {
        instructionId: instruction.id,
        patch: {
          text: editingInstructionText,
          category: instruction.category,
        },
      });
      setEditingInstructionId(null);
      setEditingInstructionText("");
      await refreshAiTraining();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disableInstruction(instructionId: string) {
    setBusy(true);
    setError(null);
    try {
      await mini("aiInstructionDisable", { instructionId });
      await refreshAiTraining();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function enableInstruction(instructionId: string) {
    setBusy(true);
    setError(null);
    try {
      await mini("aiInstructionEnable", { instructionId });
      await refreshAiTraining();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeInstruction(instructionId: string) {
    setBusy(true);
    setError(null);
    try {
      await mini("aiInstructionRemove", { instructionId });
      await refreshAiTraining();
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

  const currentQuestion =
    training?.status === "in_progress"
      ? training.text
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1)
      : null;

  const profileFields: Array<{
    key: keyof AgentProfile;
    label: string;
    multiline?: boolean;
  }> = [
    { key: "aiDisplayName", label: "AI name" },
    { key: "ownerName", label: "Owner name" },
    { key: "businessOrProfession", label: "Business/profession" },
    { key: "businessDescription", label: "Description", multiline: true },
    { key: "aiPurpose", label: "Purpose", multiline: true },
    { key: "preferredLanguages", label: "Languages" },
    { key: "communicationTone", label: "Tone/style" },
    { key: "productsServices", label: "Products/services", multiline: true },
    { key: "allowedToShare", label: "Allowed information", multiline: true },
    { key: "restrictedPrivateInfo", label: "Restricted information", multiline: true },
    { key: "alwaysFollow", label: "Always-follow rules", multiline: true },
    { key: "neverDo", label: "Never-do rules", multiline: true },
  ];

  function profileValue(key: keyof AgentProfile) {
    const value = profileDraft[key] ?? "";
    return Array.isArray(value) ? value.join(", ") : String(value);
  }

  function updateProfileDraft(key: keyof AgentProfile, value: string) {
    setProfileDraft((current) => ({ ...current, [key]: value }));
  }

  const activeInstructionCount = instructions.filter((instruction) => instruction.enabled).length;

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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    "dashboard",
                    "train",
                    "profile",
                    "instructions",
                    "create",
                    "history",
                    "account",
                  ] as View[]
                ).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => setView(item)}
                    className={
                      "rounded-md px-3 py-2 text-sm " +
                      (view === item ? "bg-primary text-primary-foreground" : "bg-secondary")
                    }
                  >
                    {item === "dashboard"
                      ? "AI Dashboard"
                      : item === "train"
                        ? "Train My AI"
                        : item === "profile"
                          ? "AI Profile"
                          : item === "instructions"
                            ? "AI Instructions"
                            : item === "create"
                              ? "Folder Tools"
                              : item === "history"
                                ? "Folder History"
                                : "Connected Session"}
                  </button>
                ))}
              </div>
            </section>

            {view === "dashboard" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">AI Dashboard</h2>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => setView("train")}
                    className="rounded-md border border-border bg-secondary/40 p-4 text-left"
                  >
                    <div className="font-medium">Train My AI</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Resume onboarding and answer one setup question at a time.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("profile")}
                    className="rounded-md border border-border bg-secondary/40 p-4 text-left"
                  >
                    <div className="font-medium">AI Profile</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Edit business, language, tone, and sharing rules.
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setView("instructions")}
                    className="rounded-md border border-border bg-secondary/40 p-4 text-left"
                  >
                    <div className="font-medium">AI Instructions</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Add explicit owner instructions for local training.
                    </div>
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Stat label="Onboarding" value={profile?.onboardingStatus || "not started"} />
                  <Stat label="Active instructions" value={activeInstructionCount} />
                  <Stat label="Connected session" value={accountName} />
                </div>
              </section>
            ) : null}

            {view === "train" ? (
              <section className="panel p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold">Train My AI</h2>
                  <SecondaryButton disabled={busy} onClick={() => void refreshAiTraining()}>
                    <RefreshCw className="size-4" />
                  </SecondaryButton>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Stat label="Status" value={training?.status || "not_started"} />
                  <Stat label="Profile" value={profile?.onboardingStatus || "not_started"} />
                  <Stat label="Instructions" value={instructions.length} />
                </div>
                <div className="mt-4 rounded-md border border-border bg-secondary/40 p-4">
                  {currentQuestion ? (
                    <div>
                      <div className="text-xs text-muted-foreground">Current question</div>
                      <div className="mt-1 text-sm font-medium">{currentQuestion}</div>
                    </div>
                  ) : (
                    <div className="text-sm text-muted-foreground">
                      {training?.status === "completed"
                        ? "Onboarding is complete. You can still edit the profile and instructions."
                        : "Start onboarding to configure your Personal AI Representative."}
                    </div>
                  )}
                </div>
                <form onSubmit={submitTrainingAnswer} className="mt-4 space-y-3">
                  <textarea
                    value={trainingAnswer}
                    onChange={(e) => setTrainingAnswer(e.target.value)}
                    placeholder="Type your answer"
                    rows={4}
                    disabled={!currentQuestion}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
                  />
                  <div className="flex flex-wrap gap-2">
                    <PrimaryButton
                      type="button"
                      disabled={busy}
                      onClick={() => void startTraining()}
                    >
                      {training?.status === "in_progress" ? "Resume" : "Start"}
                    </PrimaryButton>
                    <PrimaryButton
                      type="submit"
                      disabled={busy || !currentQuestion || !trainingAnswer.trim()}
                    >
                      Save Answer
                    </PrimaryButton>
                    <SecondaryButton disabled={busy} onClick={() => void cancelTraining()}>
                      Cancel/Reset
                    </SecondaryButton>
                  </div>
                </form>
              </section>
            ) : null}

            {view === "profile" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">AI Profile</h2>
                <form onSubmit={saveProfile} className="mt-4 space-y-4">
                  {profileFields.map((field) => (
                    <label key={field.key} className="block text-sm">
                      <span className="font-medium">{field.label}</span>
                      {field.multiline ? (
                        <textarea
                          value={profileValue(field.key)}
                          onChange={(e) => updateProfileDraft(field.key, e.target.value)}
                          rows={3}
                          className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      ) : (
                        <input
                          value={profileValue(field.key)}
                          onChange={(e) => updateProfileDraft(field.key, e.target.value)}
                          className="mt-2 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      )}
                    </label>
                  ))}
                  <PrimaryButton type="submit" disabled={busy}>
                    Save Profile
                  </PrimaryButton>
                </form>
              </section>
            ) : null}

            {view === "instructions" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">AI Instructions</h2>
                <form onSubmit={addInstruction} className="mt-4 space-y-3">
                  <select
                    value={instructionCategory}
                    onChange={(e) => setInstructionCategory(e.target.value)}
                    className="min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  >
                    {[
                      "communication",
                      "business_rule",
                      "privacy",
                      "sales",
                      "support",
                      "custom",
                    ].map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={instructionText}
                    onChange={(e) => setInstructionText(e.target.value)}
                    placeholder="Example: Always answer me in Hindi."
                    rows={3}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                  <PrimaryButton type="submit" disabled={busy || !instructionText.trim()}>
                    Add Instruction
                  </PrimaryButton>
                </form>

                <div className="mt-5 space-y-3">
                  {instructions.map((instruction) => (
                    <div
                      key={instruction.id}
                      className="rounded-md border border-border p-3 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          {instruction.category} - {instruction.enabled ? "active" : "disabled"}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <SecondaryButton
                            disabled={busy}
                            onClick={() => {
                              setEditingInstructionId(instruction.id);
                              setEditingInstructionText(instruction.text);
                            }}
                          >
                            Edit
                          </SecondaryButton>
                          <SecondaryButton
                            disabled={busy}
                            onClick={() => void disableInstruction(instruction.id)}
                          >
                            Disable
                          </SecondaryButton>
                          {!instruction.enabled ? (
                            <SecondaryButton
                              disabled={busy}
                              onClick={() => void enableInstruction(instruction.id)}
                            >
                              Enable
                            </SecondaryButton>
                          ) : null}
                          <SecondaryButton
                            disabled={busy}
                            onClick={() => void removeInstruction(instruction.id)}
                          >
                            Remove
                          </SecondaryButton>
                        </div>
                      </div>
                      {editingInstructionId === instruction.id ? (
                        <div className="mt-3 space-y-2">
                          <textarea
                            value={editingInstructionText}
                            onChange={(e) => setEditingInstructionText(e.target.value)}
                            rows={3}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                          />
                          <PrimaryButton
                            disabled={busy || !editingInstructionText.trim()}
                            onClick={() => void updateInstruction(instruction)}
                          >
                            Save
                          </PrimaryButton>
                        </div>
                      ) : (
                        <div className="mt-2">{instruction.text}</div>
                      )}
                    </div>
                  ))}
                  {instructions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No active owner instructions yet.
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {view === "create" ? (
              <section className="panel p-5">
                <h2 className="text-base font-semibold">Legacy Folder Tools</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Existing folder-merger workflow is preserved here.
                </p>
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
