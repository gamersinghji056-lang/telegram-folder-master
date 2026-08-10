import { Check, X, Minus } from "lucide-react";

export function StatusRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: "ok" | "fail" | "idle";
  detail?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <div className="min-w-0">
        <p className="font-display text-sm">{label}</p>
        {detail ? (
          <p className="mt-0.5 break-words text-xs text-muted-foreground">{detail}</p>
        ) : null}
      </div>
      <span
        className={
          "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full " +
          (state === "ok"
            ? "bg-success/15 text-success"
            : state === "fail"
              ? "bg-destructive/15 text-destructive"
              : "bg-muted text-muted-foreground")
        }
      >
        {state === "ok" ? (
          <Check className="size-3.5" />
        ) : state === "fail" ? (
          <X className="size-3.5" />
        ) : (
          <Minus className="size-3.5" />
        )}
      </span>
    </div>
  );
}