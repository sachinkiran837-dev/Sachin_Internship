"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileSpreadsheet,
  Link2,
  MinusCircle,
  Network,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { FileBinding } from "@/lib/ingest/bindFiles";
import { CANONICAL_FIELDS } from "@/lib/graph/types";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The per-file account of an upload: what each report contained, what Atlas
 * made of each of its columns, and what it contributed to the establishment.
 *
 * This exists because the merged establishment can't answer the questions
 * people actually ask on the confirm screen, and those questions are always
 * about one file: did our payroll extract land? where did the cost centre
 * column go? why is this one greyed out? Collapsed by default so it doesn't
 * crowd the screen, and every file is listed — including the ones that
 * contributed nothing, which are the whole reason to look.
 */

const ROLE_COPY: Record<FileBinding["role"], { label: string; blurb: string }> = {
  roster: {
    label: "Position list",
    blurb: "Read as a list of positions and added to the establishment.",
  },
  attributes: {
    label: "Joined detail",
    blurb: "Matched onto positions from the list above and used to fill in gaps.",
  },
  structure: {
    label: "Reporting lines",
    blurb:
      "Used for its shape rather than its people: its reporting lines were laid over the establishment, replacing the ones the position list carried.",
  },
  excluded: {
    label: "Left out",
    blurb: "Left out of this run because your instructions said to. Nothing from it reached the map.",
  },
  unusable: {
    label: "Not used",
    blurb: "Nothing from this file reached the establishment.",
  },
};

function fieldLabel(field: string): string {
  return (CANONICAL_FIELDS as Record<string, string>)[field] ?? field;
}

export function SourceDataReport({ files }: { files: FileBinding[] }) {
  const [open, setOpen] = useState<string | null>(null);

  const rosters = files.filter((f) => f.role === "roster");
  const joined = files.filter((f) => f.role === "attributes");
  const structure = files.filter((f) => f.role === "structure");
  const excluded = files.filter((f) => f.role === "excluded");
  const unusable = files.filter((f) => f.role === "unusable");
  const rowsRead = files.reduce((sum, f) => sum + f.rowCount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What was in the files you uploaded</CardTitle>
        <p className="text-sm text-muted-foreground">
          {files.length} file{files.length === 1 ? "" : "s"} · {rowsRead.toLocaleString()} row
          {rowsRead === 1 ? "" : "s"} read · {rosters.length} read as position list
          {rosters.length === 1 ? "" : "s"}
          {joined.length > 0 && `, ${joined.length} joined for detail`}
          {structure.length > 0 && `, ${structure.length} used for reporting lines`}
          {excluded.length > 0 && `, ${excluded.length} left out on your instructions`}
          {unusable.length > 0 && `, ${unusable.length} not used`}. Select a file for the detail.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col divide-y border-t p-0">
        {files.map((file) => {
          const isOpen = open === file.filename;
          const copy = ROLE_COPY[file.role];

          return (
            <div key={file.filename}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : file.filename)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-accent/40"
              >
                {file.role === "unusable" ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
                ) : file.role === "excluded" ? (
                  <MinusCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : file.role === "structure" ? (
                  <Network className="size-4 shrink-0 text-primary" aria-hidden />
                ) : file.role === "attributes" ? (
                  <Link2 className="size-4 shrink-0 text-primary" aria-hidden />
                ) : (
                  <FileSpreadsheet className="size-4 shrink-0 text-primary" aria-hidden />
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{file.filename}</span>
                  <span className="block text-xs text-muted-foreground">
                    {file.sourceFormat}
                    {file.rowCount > 0 &&
                      ` · ${file.rowCount.toLocaleString()} row${file.rowCount === 1 ? "" : "s"} · ${file.columns.length} column${file.columns.length === 1 ? "" : "s"}`}
                  </span>
                </span>

                {file.needsReview && (
                  <Badge variant="outline" className="shrink-0 gap-1">
                    <Sparkles className="size-3" aria-hidden />
                    Read by AI
                  </Badge>
                )}
                <Badge
                  variant={
                    file.role === "unusable"
                      ? "destructive"
                      : file.role === "excluded"
                        ? "outline"
                        : "secondary"
                  }
                  className="shrink-0"
                >
                  {copy.label}
                </Badge>
                <ChevronDown
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                  aria-hidden
                />
              </button>

              {isOpen && (
                <div className="flex flex-col gap-4 bg-accent/20 px-6 pb-5 pt-1 text-sm">
                  <p className="text-muted-foreground">{copy.blurb}</p>

                  {file.planReason && (
                    <Detail label="Why it was read this way">
                      <span className="italic">&ldquo;{file.planReason}&rdquo;</span> — from your
                      upload instructions.
                    </Detail>
                  )}

                  <Detail label="How the file was read">{file.conversionDetail}</Detail>
                  <Detail label="What Atlas did with it">{file.detail}</Detail>

                  {file.role === "structure" && (
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
                      <Stat label="Roles matched to the establishment" value={file.matchedRows.toLocaleString()} />
                      <Stat
                        label="Not in the position list"
                        value={file.unmatchedRows.toLocaleString()}
                        tone={file.unmatchedRows > 0 ? "warn" : undefined}
                      />
                    </div>
                  )}

                  {file.role === "attributes" && (
                    <div className="flex flex-wrap gap-x-8 gap-y-2">
                      <Stat label="Matched" value={file.matchedRows.toLocaleString()} />
                      <Stat
                        label="Matched nothing"
                        value={file.unmatchedRows.toLocaleString()}
                        tone={file.unmatchedRows > 0 ? "warn" : undefined}
                      />
                      <Stat
                        label="Disagreed with the position list"
                        value={file.conflicts.toLocaleString()}
                        tone={file.conflicts > 0 ? "warn" : undefined}
                      />
                      <Stat
                        label="Joined on"
                        value={file.joinKey ? fieldLabel(file.joinKey) : "—"}
                      />
                    </div>
                  )}

                  {file.columns.length > 0 && (
                    <div>
                      <p className="mb-2 font-medium">Columns found in this file</p>
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {file.columns.map((c) => {
                          const used = c.field !== null;
                          const contributed =
                            c.field !== null && file.contributedFields.includes(c.field);
                          return (
                            <li key={c.column} className="flex items-start gap-2">
                              {used ? (
                                <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                              ) : (
                                <XCircle
                                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                                  aria-hidden
                                />
                              )}
                              <span className="min-w-0">
                                <span className="font-mono text-xs">{c.column}</span>
                                <span className="text-muted-foreground">
                                  {used
                                    ? ` → ${fieldLabel(c.field!)}${contributed ? " (supplied)" : ""}`
                                    : " → not recognised, kept as an extra column"}
                                </span>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {file.needsReview && (
                    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-900 dark:text-amber-200">
                      These rows were transcribed from a picture by a model rather than exported
                      from a system. Check them against the source before treating this as a
                      baseline.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 font-medium">{label}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-base font-medium ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</p>
    </div>
  );
}
