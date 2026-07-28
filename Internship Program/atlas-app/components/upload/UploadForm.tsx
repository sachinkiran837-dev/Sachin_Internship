"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { UploadCloud, FileSpreadsheet, FileImage, FileText, X } from "lucide-react";
import { ingestFileAction, type IngestActionState } from "@/app/actions/ingest";
import { MAX_UPLOAD_BYTES, SUPPORTED_FORMATS, formatFor, readerLabel } from "@/lib/ingest/formats";
import { uploadFileInChunks } from "@/lib/ingest/uploadClient";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const initialState: IngestActionState = { error: null };

const ACCEPT = SUPPORTED_FORMATS.map((f) => f.ext).join(",");

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Name + size identifies a file well enough to track selection across drops. */
function fileKey(file: File): string {
  return `${file.name}-${file.size}`;
}

function iconFor(filename: string) {
  switch (formatFor(filename)?.kind) {
    case "visual":
      return FileImage;
    case "document":
      return FileText;
    default:
      return FileSpreadsheet;
  }
}

export function UploadForm() {
  const [state, formAction, isPending] = useActionState(ingestFileAction, initialState);
  const [useSample, setUseSample] = useState(true);
  const [anonymize, setAnonymize] = useState(true);
  const [selected, setSelected] = useState<File[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [context, setContext] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [dragging, setDragging] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Which of the attached files this run actually uses. Keeping a file in
   * the list but out of the run is the point: the same folder of exports can
   * be run as "establishment only", then again with payroll joined on, then
   * again with last year's vacancy report, without re-attaching anything.
   * Only included files are uploaded at all, so the size ceiling applies to
   * what is being run rather than to what happens to be attached.
   */
  const included = selected.filter((f) => !excluded.has(fileKey(f)));
  const totalBytes = included.reduce((sum, f) => sum + f.size, 0);
  const overLimit = totalBytes > MAX_UPLOAD_BYTES;
  const unsupported = included.filter((f) => !formatFor(f.name));
  const busy = isPending || isSubmitting || sent !== null;

  function toggle(file: File) {
    const key = fileKey(file);
    const next = new Set(excluded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExcluded(next);
    syncInput(selected, next);
  }

  /**
   * Files go to /api/upload in chunks first, and only their ids are sent to
   * the Server Action. A form that posted the files themselves would be one
   * request, and the host rejects an oversized request at its edge before
   * any of this code runs — a failure the app cannot see, let alone explain.
   */
  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (useSample || included.length === 0) return; // let the form post normally
    event.preventDefault();
    setUploadError(null);
    setSent(0);

    try {
      const ids: string[] = [];
      let done = 0;
      for (const file of included) {
        const base = done;
        ids.push(await uploadFileInChunks(file, (bytes) => setSent(base + bytes)));
        done += file.size;
        setSent(done);
      }

      const data = new FormData();
      data.set("useSample", "off");
      data.set("anonymize", anonymize ? "on" : "off");
      data.set("context", context);
      data.set("hypothesis", hypothesis);
      for (const id of ids) data.append("uploadId", id);

      startSubmit(() => formAction(data));
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setSent(null);
    }
  }

  /**
   * The real <input type=file> holds exactly the included files, so the
   * no-JavaScript form post ingests the same set the checkboxes describe
   * rather than everything that happens to be attached.
   */
  function syncInput(files: File[], notIncluded: Set<string>) {
    if (!inputRef.current) return;
    const dt = new DataTransfer();
    for (const f of files) if (!notIncluded.has(fileKey(f))) dt.items.add(f);
    inputRef.current.files = dt.files;
  }

  /** Dropping again adds to the set rather than replacing it — people
   *  assemble a multi-file upload one drag at a time. */
  function setFiles(next: File[]) {
    const deduped = next.filter(
      (f, i) => next.findIndex((o) => o.name === f.name && o.size === f.size) === i
    );
    setSelected(deduped);
    // A file that is removed and re-added comes back included.
    const stillPresent = new Set(deduped.map(fileKey));
    const nextExcluded = new Set([...excluded].filter((k) => stillPresent.has(k)));
    setExcluded(nextExcluded);
    syncInput(deduped, nextExcluded);
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} className="flex flex-col gap-5">
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
              Meridian Health Services — ~150 fictional positions.
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
              As many files as you have, in any format. Atlas binds them into one establishment.
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
              An establishment list, a payroll extract, an org chart — Atlas works out what each
              one is.
            </p>
          </div>

          {selected.length > 0 && (
            <div className="flex flex-col rounded-md border">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-xs font-medium">Files to run the engine on</p>
                <button
                  type="button"
                  onClick={() => {
                    const next =
                      included.length === selected.length
                        ? new Set(selected.map(fileKey))
                        : new Set<string>();
                    setExcluded(next);
                    syncInput(selected, next);
                  }}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {included.length === selected.length ? "Clear all" : "Select all"}
                </button>
              </div>

              <ul className="flex flex-col divide-y">
                {selected.map((f) => {
                  const Icon = iconFor(f.name);
                  const known = formatFor(f.name);
                  const on = !excluded.has(fileKey(f));
                  return (
                    <li
                      key={fileKey(f)}
                      className={`flex items-center gap-2 px-3 py-2 ${on ? "" : "opacity-55"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggle(f)}
                        aria-label={`Use ${f.name} in this run`}
                        className="size-4 shrink-0 rounded border-input accent-[var(--primary)]"
                      />
                      <Icon
                        className={`size-4 shrink-0 ${known ? "text-primary" : "text-destructive"}`}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-sm">{f.name}</span>
                      {readerLabel(f.name) && (
                        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                          {readerLabel(f.name)}
                        </span>
                      )}
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
                  );
                })}
              </ul>

              <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-muted-foreground">
                <span>
                  {included.length} of {selected.length} selected
                  {included.length < selected.length && " — unticked files are not uploaded"}
                </span>
                <span className={overLimit ? "font-medium text-destructive" : ""}>
                  {formatBytes(totalBytes)} of {formatBytes(MAX_UPLOAD_BYTES)}
                </span>
              </div>
            </div>
          )}

          {/* Caught here rather than server-side: the request never reaches
              the app at this size, so nothing downstream could report it. */}
          {overLimit && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              These files total {formatBytes(totalBytes)}, over the{" "}
              {formatBytes(MAX_UPLOAD_BYTES)} one upload can carry. Ingest them in two batches —
              the establishment list first — or remove the largest file.
            </p>
          )}

          {unsupported.length > 0 && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Atlas can&apos;t read {unsupported.map((f) => f.name).join(", ")}. Remove{" "}
              {unsupported.length === 1 ? "it" : "them"} to continue.
            </p>
          )}

          {/* The one thing the files themselves can never say: what they are
              to each other. A column list cannot tell Atlas that three brands
              share one export, or that the chart is the source of truth for
              reporting lines and the spreadsheet only for money. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="context">Anything Atlas should know about these files?</Label>
            <textarea
              id="context"
              name="context"
              rows={3}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="Optional. e.g. Consolidate at brand level. The structure is in the PDF; the spreadsheet is payroll only. Exclude leavers."
              className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
          </div>

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

          <p className="text-xs text-muted-foreground">
            Spreadsheets, delimited text, JSON, XML, HTML, Word and PDF · images up to{" "}
            {formatBytes(MAX_UPLOAD_BYTES)} a run.
          </p>
        </div>
      )}

      {/* The second context window, and the one that decides what Atlas can
          say rather than what it can read. An establishment file will tell it
          that a function runs one manager per three people; only a person can
          tell it what that function earns, what the business is trying to
          reach, and what leadership already suspects. Offered on the sample
          run too — the layer is about the business, not about the upload. */}
      <div className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-accent/30 p-4">
        <p className="eyebrow">
          <span className="eyebrow-dot" aria-hidden />
          Hypothesis layer
        </p>
        <Label htmlFor="hypothesis" className="text-sm font-medium">
          What&rsquo;s going on in the business?
        </Label>
        <p className="text-xs text-muted-foreground">
          What it does and what it earns, what you&rsquo;re trying to reach, and what you already
          suspect is wrong. Atlas tests each suspicion against the establishment and tells you
          plainly when the data doesn&rsquo;t support it. Revenue is the one thing no payroll export
          contains and the one that turns &ldquo;this function looks expensive&rdquo; into revenue
          per head — a line each is enough. Everything you write is quoted back next to the figures
          it produced, and nothing here changes the map.
        </p>
        <textarea
          id="hypothesis"
          name="hypothesis"
          rows={4}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder="Optional. e.g. Home care across six brands. AgeUp did about $40m last year, Homewell $26m. We need $3m out of the cost base by FY27 without touching frontline care. We think head office has grown faster than the business and that Platform is over-managed."
          className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground/70 focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
        <p className="text-xs text-muted-foreground">
          You can add or change this at any point after ingest — it never re-reads your files.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <input
          id="anonymize"
          name="anonymize"
          type="checkbox"
          checked={anonymize}
          onChange={(e) => setAnonymize(e.target.checked)}
          className="size-4 rounded border-input accent-[var(--primary)]"
        />
        <Label htmlFor="anonymize">Anonymise names on ingest (on by default)</Label>
      </div>

      {sent !== null && totalBytes > 0 && (
        <div className="flex flex-col gap-1.5">
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full bg-primary transition-[width] duration-200"
              style={{ width: `${Math.min(100, (sent / totalBytes) * 100).toFixed(1)}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Uploading — {formatBytes(sent)} of {formatBytes(totalBytes)}
          </p>
        </div>
      )}

      {(state.error || uploadError) && (
        <p className="whitespace-pre-line rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {uploadError ?? state.error}
        </p>
      )}

      <Button
        type="submit"
        disabled={
          busy || (!useSample && (included.length === 0 || overLimit || unsupported.length > 0))
        }
      >
        {sent !== null
          ? "Uploading…"
          : busy
            ? "Ingesting…"
            : included.length > 1
              ? `Bind ${included.length} selected files and ingest`
              : "Ingest establishment export"}
      </Button>
    </form>
  );
}
