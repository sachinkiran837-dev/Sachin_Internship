"use client";

import { useActionState, useRef, useState } from "react";
import { UploadCloud, FileSpreadsheet, X } from "lucide-react";
import { ingestFileAction, type IngestActionState } from "@/app/actions/ingest";
import { SUPPORTED_FORMATS } from "@/lib/ingest/parseFile";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const initialState: IngestActionState = { error: null };

const ACCEPT = SUPPORTED_FORMATS.map((f) => f.ext).join(",");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadForm() {
  const [state, formAction, isPending] = useActionState(ingestFileAction, initialState);
  const [useSample, setUseSample] = useState(true);
  const [selected, setSelected] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function assignFile(file: File | null) {
    setSelected(file);
    if (inputRef.current && file) {
      // Keep the real <input type=file> as the form's source of truth so the
      // server action receives the file the same way whether it was dropped
      // or picked — no parallel state to fall out of sync.
      const dt = new DataTransfer();
      dt.items.add(file);
      inputRef.current.files = dt.files;
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* The radios are presentation only; this carries the choice to the
          server action in the "on"/"off" shape it already reads. */}
      <input type="hidden" name="useSample" value={useSample ? "on" : "off"} />

      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Data source</legend>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors has-checked:border-primary has-checked:bg-accent/50">
          <input
            name="source"
            type="radio"
            checked={useSample}
            onChange={() => setUseSample(true)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-sm">
            <span className="font-medium">Use the synthetic demo export</span>
            <span className="block text-muted-foreground">
              Meridian Health Services — ~150 positions of fictional data, heavy on frontline
              nursing/care and contractor roles, with realistic messiness.
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors has-checked:border-primary has-checked:bg-accent/50">
          <input
            name="source"
            type="radio"
            checked={!useSample}
            onChange={() => setUseSample(false)}
            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
          />
          <span className="text-sm">
            <span className="font-medium">Upload your own establishment data</span>
            <span className="block text-muted-foreground">
              Any tabular export — Atlas normalises it to CSV before ingest.
            </span>
          </span>
        </label>
      </fieldset>

      {!useSample && (
        <div className="flex flex-col gap-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              assignFile(e.dataTransfer.files?.[0] ?? null);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragging ? "border-primary bg-accent/60" : "border-input hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            {selected ? (
              <>
                <FileSpreadsheet className="size-6 text-primary" aria-hidden />
                <p className="text-sm font-medium">{selected.name}</p>
                <p className="text-xs text-muted-foreground">{formatBytes(selected.size)}</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(null);
                    if (inputRef.current) inputRef.current.value = "";
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  <X className="size-3" aria-hidden /> Choose a different file
                </button>
              </>
            ) : (
              <>
                <UploadCloud className="size-6 text-muted-foreground" aria-hidden />
                <p className="text-sm font-medium">Drop a file here, or click to browse</p>
                <p className="text-xs text-muted-foreground">
                  Atlas converts it to CSV and tells you what it read.
                </p>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            id="file"
            name="file"
            type="file"
            accept={ACCEPT}
            onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
            className="sr-only"
          />

          <div className="flex flex-wrap gap-1.5">
            {SUPPORTED_FORMATS.map((f) => (
              <span
                key={f.ext}
                className="rounded border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              >
                {f.ext}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Spreadsheets, delimited text (comma, tab, semicolon or pipe — auto-detected), JSON,
            XML and HTML tables are all normalised to the same CSV shape before ingest.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <input
          id="anonymize"
          name="anonymize"
          type="checkbox"
          defaultChecked
          className="size-4 rounded border-input accent-[var(--primary)]"
        />
        <Label htmlFor="anonymize">Anonymise names on ingest (on by default)</Label>
      </div>

      {state.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <Button type="submit" disabled={isPending || (!useSample && !selected)}>
        {isPending ? "Ingesting…" : "Ingest establishment export"}
      </Button>
    </form>
  );
}
