"use client";

import { useActionState, useState } from "react";
import { ingestFileAction, type IngestActionState } from "@/app/actions/ingest";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const initialState: IngestActionState = { error: null };

export function UploadForm() {
  const [state, formAction, isPending] = useActionState(ingestFileAction, initialState);
  const [useSample, setUseSample] = useState(true);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <input
          id="useSample"
          name="useSample"
          type="checkbox"
          checked={useSample}
          onChange={(e) => setUseSample(e.target.checked)}
          className="size-4 rounded border-input"
        />
        <Label htmlFor="useSample">
          Use the synthetic demo export (Meridian Health Services, ~150 positions, fictional
          data — heavy on frontline nursing/care and contractor roles, with realistic messiness)
        </Label>
      </div>

      {!useSample && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="file">Establishment export (.csv or .xlsx)</Label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,.xlsx,.xls"
            className="rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          id="anonymize"
          name="anonymize"
          type="checkbox"
          defaultChecked
          className="size-4 rounded border-input"
        />
        <Label htmlFor="anonymize">Anonymise names on ingest (on by default)</Label>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Ingesting…" : "Ingest establishment export"}
      </Button>
    </form>
  );
}
