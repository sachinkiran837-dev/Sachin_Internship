"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Check, ChevronDown, RefreshCw } from "lucide-react";
import { answerIngestAction, type AnswerActionState } from "@/app/actions/answers";
import { Button } from "@/components/ui/button";

/**
 * The same re-read `IngestNotes` offers on the confirm screen, offered again
 * wherever else a client might notice something is off — the canonical table
 * once they're reading real rows, the map once they're looking at the actual
 * shape. One box, one action, the same full re-read of the original files;
 * only the heading and the button's wording change to fit where it sits.
 *
 * Collapsed by default. Both screens it lives on are explicitly "the data,
 * and nothing else" — this earns its place only when someone reaches for it.
 */

const INITIAL: AnswerActionState = { error: null, ok: false, planNotes: null, planApplied: null };

export function ContextRedo({
  orgId,
  canReread,
  heading,
  placeholder,
  buttonLabel,
}: {
  orgId: string;
  canReread: boolean;
  heading: string;
  placeholder: string;
  buttonLabel: string;
}) {
  const [state, formAction, pending] = useActionState(answerIngestAction, INITIAL);
  const [open, setOpen] = useState(false);

  if (!canReread) return null;

  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-2.5 text-left text-sm font-medium transition-colors hover:bg-accent/40"
      >
        {heading}
        <ChevronDown
          className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <form action={formAction} className="flex flex-col gap-3 border-t px-4 py-3">
          <input type="hidden" name="orgId" value={orgId} />
          <textarea
            name="extraContext"
            rows={3}
            placeholder={placeholder}
            className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />

          {state.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state.ok && !pending && state.planApplied === false && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Your files were read again, but that instruction wasn&rsquo;t applied.{" "}
                {state.planNotes || "Nothing on the table changed."}
              </span>
            </p>
          )}
          {state.ok && !pending && state.planApplied !== false && (
            <p className="flex items-start gap-2 rounded-md border border-primary/40 bg-accent/40 px-3 py-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>{state.planNotes || "Your files were read again with this applied."}</span>
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending} size="sm">
              {pending ? (
                <>
                  <RefreshCw className="size-4 animate-spin" aria-hidden />
                  Reading the files again…
                </>
              ) : (
                buttonLabel
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Scenarios built on this establishment are cleared.</span>
          </div>
        </form>
      )}
    </div>
  );
}
