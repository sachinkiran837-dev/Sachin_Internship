"use client";

import { useActionState } from "react";
import { askAction } from "@/app/actions/ask";
import type { AskResponse } from "@/lib/ask/interpret";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

const EXAMPLES = [
  "which single report managers cost the most",
  "duplicated functions across sites",
  "how many layers between the ceo and the frontline",
  "contingent reliance by directorate",
  "flatten Operations to 4 layers",
];

export function AskAtlasForm({ orgId }: { orgId: string }) {
  const [state, formAction, isPending] = useActionState<AskResponse | null, FormData>(async (_prev, formData) => {
    return askAction(orgId, _prev, formData);
  }, null);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input name="query" placeholder="Ask a question, or give a restructure instruction…" className="flex-1" />
          <Button type="submit" disabled={isPending}>
            {isPending ? "Asking…" : "Ask"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          <span className="font-medium">Try:</span>
          {EXAMPLES.map((e) => (
            <code key={e} className="rounded bg-muted px-1.5 py-0.5 font-mono">
              {e}
            </code>
          ))}
        </div>
      </form>

      {state && (
        <Card>
          <CardContent className="flex flex-col gap-3 pt-6 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={state.compiled ? "default" : "destructive"}>
                {state.compiled ? (state.kind === "instruction" ? "instruction compiled" : "query compiled") : "did not compile"}
              </Badge>
              {state.toolId && <Badge variant="secondary">{state.toolId}</Badge>}
            </div>

            <p>{state.narrative}</p>

            {state.data.length > 0 && (
              <div className="flex flex-col gap-1 rounded-lg border p-3">
                {state.data.map((row, i) => (
                  <div key={i} className="flex justify-between gap-4">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-medium">{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            <p className="text-xs text-muted-foreground">Tool trace: {state.toolTrace}</p>

            {state.followUps.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Follow-ups: </span>
                {state.followUps.join(" · ")}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
