"use client";

import { useActionState } from "react";
import { AlertTriangle, Check, RefreshCw } from "lucide-react";
import { answerIngestAction, type AnswerActionState } from "@/app/actions/answers";
import type { IngestNote } from "@/lib/ingest/notes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Everything Atlas assumed and everything it refused to assume, on the last
 * screen before the map.
 *
 * The position of this panel is the point of it. Once someone has seen a map,
 * the numbers on it are facts; before they have, the numbers are still a
 * reading of a spreadsheet that someone can correct. So the register sits
 * between the two, and the questions come first — a question is a hole the
 * client is the only one who can fill, and an assumption is settled unless
 * they disagree with it.
 *
 * Answers go back through a full re-read of the original files rather than a
 * patch, so nothing on the following screens can end up describing a version
 * of the data that no longer exists.
 */

const INITIAL: AnswerActionState = { error: null, ok: false };

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

  if (notes.length === 0) return null;

  const questions = notes.filter((n) => n.kind === "question");
  const assumptions = notes.filter((n) => n.kind === "assumption");

  return (
    <Card className={questions.length > 0 ? "border-amber-500/40" : undefined}>
      <CardHeader>
        <CardTitle>What Atlas assumed, and what it needs you to settle</CardTitle>
        <p className="text-sm text-muted-foreground">
          {questions.length > 0 ? (
            <>
              {questions.length} thing{questions.length === 1 ? "" : "s"} could not be read off your
              files, and Atlas has left {questions.length === 1 ? "it" : "them"} open rather than
              pick a number
              {assumptions.length > 0 && `. ${assumptions.length} reading${assumptions.length === 1 ? " was" : "s were"} made and applied`}
              . Everything below is in the figures on the next screens.
            </>
          ) : (
            <>
              Atlas made {assumptions.length} reading{assumptions.length === 1 ? "" : "s"} your
              files did not state outright. Each one is in the figures on the next screens.
            </>
          )}
        </p>
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
                <NoteBody key={n.id} note={n} tone="question" />
              ))}
            </section>
          )}

          {assumptions.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{assumptions.length}</Badge>
                <span className="text-sm font-medium">Applied — correct any of these and Atlas will read the files again</span>
              </div>
              {assumptions.map((n) => (
                <NoteBody key={n.id} note={n} tone="assumption" />
              ))}
            </section>
          )}

          <div className="flex flex-col gap-2 border-t pt-4">
            <Label htmlFor="extraContext" className="text-sm font-medium">
              Anything else Atlas has read wrong?
            </Label>
            <textarea
              id="extraContext"
              name="extraContext"
              rows={2}
              placeholder="Written here, this is added to your upload instructions and read again with the files."
              className="w-full resize-y rounded-md border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {state.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}
          {state.ok && !pending && (
            <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-accent/40 px-3 py-2 text-sm">
              <Check className="size-4 shrink-0 text-primary" aria-hidden />
              Your files were read again with these answers. Every figure below reflects them.
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

function NoteBody({ note, tone }: { note: IngestNote; tone: "question" | "assumption" }) {
  return (
    <div
      className={`rounded-md border px-4 py-3 ${
        tone === "question" ? "border-amber-500/40 bg-amber-500/5" : "bg-accent/20"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        {tone === "question" ? (
          <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
        ) : (
          <Check className="size-4 shrink-0 text-primary" aria-hidden />
        )}
        <span className="text-sm font-medium">{note.topic}</span>
        {note.answeredWith && (
          <Badge variant="outline" className="ml-auto">
            You said: {note.answeredWith}
          </Badge>
        )}
      </div>

      <p className="text-sm">{note.statement}</p>
      <p className="mt-1 text-sm text-muted-foreground">{note.evidence}</p>
      <p className="mt-1 text-sm text-muted-foreground">{note.effect}</p>

      {note.answerKind === "hours" && <HoursAnswer />}
      {note.answerKind === "mapping" && <MappingAnswer note={note} />}
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
