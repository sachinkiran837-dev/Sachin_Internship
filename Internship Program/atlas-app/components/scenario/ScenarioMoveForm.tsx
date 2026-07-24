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
      <div className="flex gap-2">
        <Input
          name="move"
          placeholder='e.g. "flatten Clinical Operations to 4 layers"'
          className="flex-1"
        />
        <Button type="submit" disabled={isPending}>
          {isPending ? "Applying…" : "Apply move"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Try: flatten &lt;role&gt; to N layers · merge &lt;dept&gt; into &lt;role&gt; · remove
        &lt;role&gt; · reassign &lt;role&gt; to &lt;role&gt; · add a &lt;title&gt; under &lt;role&gt;
      </p>
      {state.message && (
        <p className={`text-sm ${state.isError ? "text-destructive" : "text-muted-foreground"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
