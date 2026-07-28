"use client";

import { useActionState } from "react";
import { Check, RefreshCw } from "lucide-react";
import { saveHypothesisAction, type HypothesisActionState } from "@/app/actions/hypothesis";
import type { BusinessContext } from "@/lib/hypothesis/context";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * The hypothesis layer, editable after the fact.
 *
 * It is offered at upload and again here because the two moments are used for
 * different things. At upload it is what the client already knows. Here it is
 * what the map has just prompted them to say — which is usually more useful,
 * because they are now looking at their own organisation and reacting to it.
 *
 * Saving re-reads the words and nothing else. No file is touched, no position
 * moves, and the ingest register is untouched, so this box is safe to change
 * as many times as a conversation needs.
 */

const INITIAL: HypothesisActionState = { error: null, ok: false, summary: null };

export function HypothesisForm({
  orgId,
  business,
}: {
  orgId: string;
  business: BusinessContext;
}) {
  const [state, formAction, pending] = useActionState(saveHypothesisAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="orgId" value={orgId} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="hypothesis" className="text-sm font-medium">
          What&rsquo;s going on in the business?
        </Label>
        <p className="text-xs text-muted-foreground">
          Four things are worth more than everything else you could write here. What each part of
          the business earns — Atlas cannot get revenue from any establishment file, and it is the
          difference between &ldquo;this function looks expensive&rdquo; and &ldquo;this function
          earns half what its sibling does per head&rdquo;. What you&rsquo;re trying to reach, and
          by when. What you already suspect, which Atlas will test and contradict where the data
          contradicts it. And anything that is off limits.
        </p>
        <textarea
          id="hypothesis"
          name="hypothesis"
          rows={8}
          defaultValue={business.raw}
          placeholder="e.g. Home care across six brands. AgeUp did about $40m last year, Homewell $26m, SAI around $12m. We need $3m out of the cost base by FY27 and we can't touch frontline care. We think head office has grown faster than the business, and that Platform is over-managed for what it delivers."
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      </div>

      {state.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state.ok && state.summary && !pending && (
        <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-accent/40 px-3 py-2 text-sm">
          <Check className="size-4 shrink-0 text-primary" aria-hidden />
          {state.summary}
        </p>
      )}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? (
            <>
              <RefreshCw className="size-4 animate-spin" aria-hidden />
              Reading it…
            </>
          ) : (
            "Save and re-read the findings"
          )}
        </Button>
        <span className="text-xs text-muted-foreground">
          Your files are not touched. Only what Atlas is able to say about them changes.
        </span>
      </div>
    </form>
  );
}
