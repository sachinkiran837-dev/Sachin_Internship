"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import type { StructureVerification } from "@/lib/ingest/verifyStructure";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The map, shown against the chart the client drew.
 *
 * This is the one screen on which a client can settle the question they came
 * in with — "is this our organisation?" — without reading a single number.
 * Every line the chart draws was checked against the finished structure, and
 * the ones that came out differently are named, with the reason each ended up
 * elsewhere.
 *
 * The one-line summary is what earns this card its place among the issues;
 * the itemised divergences — which line, why it ended up elsewhere — sit
 * behind an expand, because the reason matters more than the count but not
 * more than knowing there's something to look at at all.
 */
export function StructureCheck({ verification }: { verification: StructureVerification }) {
  const { checked, verified, divergences, unplaced, claimed, files, fidelity } = verification;
  const [open, setOpen] = useState(false);
  if (claimed === 0) return null;

  const differs = checked - verified;
  const pct = fidelity === null ? 0 : fidelity * 100;

  // This card only earns a place on the confirm screen when it has a
  // divergence to report — a chart that agrees with the map is not
  // something the client needs to act on.
  if (differs === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
          The map, checked against your chart
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {verified.toLocaleString()} of {checked.toLocaleString()} reporting lines match
          ({pct.toFixed(0)}%) — {differs.toLocaleString()} differ from {files.map((f) => `"${f}"`).join(", ")}.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-3 text-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-fit items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            aria-hidden
          />
          {open ? "Hide" : "Show"} which lines differ, and why
        </button>

        {open && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className={`h-full ${pct >= 95 ? "bg-primary" : pct >= 70 ? "bg-amber-500" : "bg-destructive"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {claimed.toLocaleString()} reporting line{claimed === 1 ? "" : "s"} drawn on the
                chart
                {unplaced > 0 && (
                  <>
                    {" "}
                    · {unplaced.toLocaleString()} could not be checked, because one end{" "}
                    {unplaced === 1 ? "is" : "of each is"} not in the establishment
                  </>
                )}
              </p>
            </div>

            <ul className="flex flex-col divide-y rounded-md border">
              {divergences.map((d, i) => (
                <li key={i} className="flex flex-col gap-1 px-3 py-2.5">
                  <span className="font-medium">{d.who}</span>
                  <span className="text-muted-foreground">
                    On the map: <span className="text-foreground">{d.actual}</span> · On your
                    chart: <span className="text-foreground">{d.expected}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{d.why}</span>
                </li>
              ))}
            </ul>
            {differs > divergences.length && (
              <p className="text-xs text-muted-foreground">
                {(differs - divergences.length).toLocaleString()} further difference
                {differs - divergences.length === 1 ? "" : "s"} not listed.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Atlas has not reshaped the map to match the chart. Which document is current is your
              call — say so below and the files are read again with it settled.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
