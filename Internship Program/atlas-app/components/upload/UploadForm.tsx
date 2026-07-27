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
  const [selected, setSelected] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The real <input type=file> stays the form's source of truth so the
   * server action receives the same FormData whether files were dropped or
   * picked. Dropping again adds to the set rather than replacing it —
   * people assemble a multi-file upload one drag at a time.
   */
  function setFiles(next: File[]) {
    const deduped = next.filter(
      (f, i) => next.findIndex((o) => o.name === f.name && o.size === f.size) === i
    );
    setSelected(deduped);
    if (inputRef.current) {
      const dt = new DataTransfer();
      for (const f of deduped) dt.items.add(f);
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
            <span className="font-medium">Upload your own organisation data</span>
            <span className="block text-muted-foreground">
              One file or many, in any tabular format — Atlas binds them into a single
              establishment.
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
              setFiles([...selected, ...Array.from(e.dataTransfer.files ?? [])]);
            }}
            onClick={() => inputRef.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors ${
              dragging ? "border-primary bg-accent/60" : "border-input hover:border-primary/50 hover:bg-accent/30"
            }`}
          >
            <UploadCloud className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">
              {selected.length > 0
                ? "Add another file, or click to browse"
                : "Drop your files here, or click to browse"}
            </p>
            <p className="text-xs text-muted-foreground">
              Upload as many as you have — an establishment list, a payroll extract, a vacancy
              report. Atlas works out what each one is and binds them into a single organisation.
            </p>
          </div>

          {selected.length > 0 && (
            <ul className="flex flex-col divide-y rounded-md border">
              {selected.map((f) => (
                <li key={`${f.name}-${f.size}`} className="flex items-center gap-2 px-3 py-2">
                  <FileSpreadsheet className="size-4 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(f.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles(selected.filter((o) => o !== f))}
                    aria-label={`Remove ${f.name}`}
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={inputRef}
            id="file"
            name="file"
            type="file"
            multiple
            accept={ACCEPT}
            onChange={(e) => setFiles([...selected, ...Array.from(e.target.files ?? [])])}
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

      <Button type="submit" disabled={isPending || (!useSample && selected.length === 0)}>
        {isPending
          ? "Ingesting…"
          : selected.length > 1
            ? `Bind ${selected.length} files and ingest`
            : "Ingest establishment export"}
      </Button>
    </form>
  );
}
