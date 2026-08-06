"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, Check, ChevronDown, RefreshCw } from "lucide-react";
import { answerIngestAction, type AnswerActionState } from "@/app/actions/answers";
import type { IngestNote } from "@/lib/ingest/notes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The issues on the confirm screen that only the client can settle, and one
 * box to answer all of them at once.
 *
 * This panel shows only what Atlas would not guess — questions, never the
 * readings it already made with confidence. An assumption is settled unless
 * something else on this screen contradicts it, so listing it here would be
 * showing data, not an issue to act on.
 *
 * Answers go back through a full re-read of the original files rather than a
 * patch, so nothing on the following screens can end up describing a version
 * of the data that no longer exists.
 */

const INITIAL: AnswerActionState = { error: null, ok: false, planNotes: null, planApplied: null };

export function IngestNotes({
  orgId,
  notes,
  canReread,
}: {
  orgId: string;
  notes: IngestNote[];
  /** False when the original bytes are gone, so answering could do nothing. */
  canReread: boolean;
}) {
  const [state, formAction, pending] = useActionState(answerIngestAction, INITIAL);

  const questions = notes.filter((n) => n.kind === "question");

  return (
    <Card className={questions.length > 0 ? "border-amber-500/40" : undefined}>
      <CardHeader>
        <CardTitle>
          {questions.length > 0 ? "What Atlas needs you to settle" : "Tell Atlas what to do about this"}
        </CardTitle>
        {questions.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {questions.length} thing{questions.length === 1 ? "" : "s"} could not be read off your
            files, and Atlas has left {questions.length === 1 ? "it" : "them"} open rather than
            pick a number.
          </p>
        )}
      </CardHeader>

      <form action={formAction}>
        <input type="hidden" name="orgId" value={orgId} />

        <CardContent className="flex flex-col gap-6">
          {questions.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">{questions.length}</Badge>
                <span className="text-sm font-medium">Open — Atlas would not guess these</span>
              </div>
              {questions.map((n) => (
                <NoteBody key={n.id} note={n} />
              ))}
            </section>
          )}

          <div className="flex flex-col gap-2 border-t pt-4">
            <Label htmlFor="extraContext" className="text-sm font-medium">
              What should Atlas do about this?
            </Label>
            <p className="text-xs text-muted-foreground">
              Answer the questions above, correct a wrong reading, or add business context —
              whatever changes is shown back here.
            </p>
            <textarea
              id="extraContext"
              name="extraContext"
              rows={3}
              placeholder="e.g. The payroll listing is FY27 but the chart is a year old — trust the payroll. NB in the entity column means Northbrook. Northbrook did about forty million last year and we think Operations is carrying too many team leaders."
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {state.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state.ok && !pending && state.planApplied === false && (
            <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Your files were read again, but the note you added wasn&rsquo;t applied.{" "}
                {state.planNotes || "Nothing else changed."}
              </span>
            </p>
          )}
          {state.ok && !pending && state.planApplied !== false && (
            <p className="flex items-start gap-2 rounded-md border border-primary/40 bg-accent/40 px-3 py-2 text-sm">
              <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
              <span>
                {state.planNotes ||
                  "Your files were read again with these answers. Every figure below reflects them."}
              </span>
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || !canReread}>
              {pending ? (
                <>
                  <RefreshCw className="size-4 animate-spin" aria-hidden />
                  Reading the files again…
                </>
              ) : (
                "Apply and read the files again"
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {canReread
                ? "Atlas kept your original files, so nothing needs uploading again. Scenarios built on this establishment are cleared."
                : "Atlas no longer holds the original files — upload them again with your corrections in the instructions box."}
            </span>
          </div>
        </CardContent>
      </form>
    </Card>
  );
}

function NoteBody({ note }: { note: IngestNote }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
        <span className="text-sm font-medium">{note.topic}</span>
        {note.answeredWith && (
          <Badge variant="outline" className="ml-auto">
            You said: {note.answeredWith}
          </Badge>
        )}
      </div>

      <p className="text-sm">{note.statement}</p>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="mt-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {open ? "Hide" : "Show"} why
      </button>
      {open && (
        <div className="mt-1.5">
          <p className="text-sm text-muted-foreground">{note.evidence}</p>
          <p className="mt-1 text-sm text-muted-foreground">{note.effect}</p>
        </div>
      )}

      <div className="mt-2">
        {note.answerKind === "hours" && <HoursAnswer />}
        {note.answerKind === "mapping" && <MappingAnswer note={note} />}
        {note.answerKind === "column" && <ColumnAnswer note={note} />}
      </div>
    </div>
  );
}

/**
 * Pick which column holds a field, from that file's own columns.
 *
 * Shown with a sample of what is in each one, because the column *names* are
 * exactly what Atlas already failed to decide on — a list of them again is no
 * help. What settles it is the client's own data: "Grp3 — Finance,
 * Operations, People" answers the question on sight, and "RateUnit — Hourly,
 * Annually" shows why it was passed over.
 *
 * Any column can be chosen, including the job title. Plenty of exports carry
 * the department nowhere else.
 */
function ColumnAnswer({ note }: { note: IngestNote }) {
  if (note.options.length === 0) return null;

  const filename = note.options[0].seenIn;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <Label htmlFor={`department-column:${filename}`} className="text-xs">
        The column holding the department in {filename}
      </Label>
      <select
        id={`department-column:${filename}`}
        name={`department-column:${filename}`}
        defaultValue=""
        className="h-9 w-full max-w-2xl rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <option value="">Leave this open for now</option>
        {note.options.map((option) => (
          <option key={option.from} value={option.from}>
            {option.from} — {option.to}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Pick the job title column if that is where your departments live — Atlas will read each
        person&rsquo;s function out of it. Everything is read again from your original files.
      </p>
    </div>
  );
}

function HoursAnswer() {
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="hoursPerWeek" className="text-xs">
          Paid hours in a full-time week
        </Label>
        <Input
          id="hoursPerWeek"
          name="hoursPerWeek"
          type="number"
          min={1}
          max={80}
          step={0.5}
          placeholder="e.g. 38"
          className="w-32"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Whatever your enterprise agreement says. Atlas multiplies each hourly rate by this and by 52
        weeks, and states the figure everywhere it is used.
      </p>
    </div>
  );
}

/**
 * One row per value that appears in one file and not the other, with Atlas's
 * proposed counterpart pre-filled. Editable rather than a confirmation, and
 * clearable: two values that genuinely name two different parts of the
 * organisation must be able to stay apart.
 */
function MappingAnswer({ note }: { note: IngestNote }) {
  if (note.options.length === 0) return null;

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Atlas&rsquo;s proposal. Correct anything wrong, or clear a box to keep that value as a group
        of its own.
      </p>
      <ul className="flex flex-col gap-2">
        {note.options.map((option) => (
          <li key={option.from} className="flex items-center gap-3">
            <span className="w-40 shrink-0 truncate font-mono text-xs" title={option.from}>
              {option.from}
            </span>
            <span className="text-xs text-muted-foreground">means</span>
            <Input
              name={`map:${option.seenIn}:${option.from}`}
              defaultValue={option.to}
              placeholder="not the same as anything"
              className="h-8 max-w-64 text-sm"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
