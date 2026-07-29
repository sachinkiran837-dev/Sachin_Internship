"use client";

import { useActionState } from "react";
import { submitScenarioMove } from "@/lib/scenario/mutate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FormState {
  message: string | null;
  isError: boolean;
}

const initialState: FormState = { message: null, isError: false };

export function ScenarioMoveForm({ orgId, scenarioId }: { orgId: string; scenarioId: string }) {
  const [state, formAction, isPending] = useActionState(async (_prev: FormState, formData: FormData) => {
    const text = String(formData.get("move") ?? "");
    if (!text.trim()) return { message: null, isError: false };
    const result = await submitScenarioMove(orgId, text, scenarioId);
    return result.blocked
      ? { message: result.blockReason ?? "Blocked", isError: true }
      : { message: result.description, isError: false };
  }, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        For a change the plays above don&apos;t cover — name one role or department and what should
        happen to it. Anything Atlas can&apos;t parse is rejected, never guessed at.
      </p>
      <div className="flex gap-2">
        <Input
          name="move"
          placeholder='e.g. "flatten Field Operations to 4 layers"'
          className="flex-1"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? "Applying…" : "Apply move"}
        </Button>
      </div>
      <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        <span className="font-medium">Recognised phrasings</span>
        <code className="font-mono">flatten &lt;role or department&gt; to &lt;N&gt; layers</code>
        <code className="font-mono">merge &lt;department&gt; into &lt;role&gt;</code>
        <code className="font-mono">reassign &lt;role&gt; to &lt;role&gt;</code>
        <code className="font-mono">add a &lt;title&gt; under &lt;role&gt;</code>
        <code className="font-mono">remove &lt;role&gt;</code>
      </div>
      {state.message && (
        <p className={`text-sm ${state.isError ? "text-destructive" : "text-muted-foreground"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
