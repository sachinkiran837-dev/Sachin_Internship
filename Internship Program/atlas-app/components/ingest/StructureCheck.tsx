import { AlertTriangle, Check } from "lucide-react";
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
 * Divergences are listed rather than summarised because the reason matters
 * more than the count: a line Atlas placed because a manager reference didn't
 * resolve is a gap in the data, and a line where both documents state a
 * different manager is a disagreement between two of the client's own systems.
 * Those call for opposite responses, and a percentage hides which one this is.
 */
export function StructureCheck({ verification }: { verification: StructureVerification }) {
  const { checked, verified, divergences, unplaced, claimed, files, fidelity } = verification;
  if (claimed === 0) return null;

  const differs = checked - verified;
  const pct = fidelity === null ? 0 : fidelity * 100;
  const clean = differs === 0 && checked > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {clean ? (
            <Check className="size-4 shrink-0 text-primary" aria-hidden />
          ) : (
            <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
          )}
          The map, checked against your chart
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Every reporting line in {files.map((f) => `"${f}"`).join(", ")} was compared against the
          structure Atlas actually built — not against the other spreadsheets, but against the
          finished map. Nothing here was changed to make the two agree.
        </p>
      </CardHeader>

      <CardContent className="flex flex-col gap-5 text-sm">
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="font-medium">Lines the map reproduces</span>
            <span className="text-muted-foreground">
              {verified.toLocaleString()} of {checked.toLocaleString()} · {pct.toFixed(0)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className={`h-full ${pct >= 95 ? "bg-primary" : pct >= 70 ? "bg-amber-500" : "bg-destructive"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {claimed.toLocaleString()} reporting line{claimed === 1 ? "" : "s"} drawn on the chart
            {unplaced > 0 && (
              <>
                {" "}
                · {unplaced.toLocaleString()} could not be checked, because one end{" "}
                {unplaced === 1 ? "is" : "of each is"} not in the establishment
              </>
            )}
          </p>
        </div>

        {clean ? (
          <p className="rounded-md border border-primary/40 bg-accent/40 px-3 py-2">
            The structure on screen matches the chart you uploaded. Spans, layers and every
            comparison built on them rest on a shape two of your own documents agree about.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="eyebrow">
              <span className="eyebrow-dot" aria-hidden />
              Where the map differs ({differs.toLocaleString()})
            </p>
            <ul className="flex flex-col divide-y rounded-md border">
              {divergences.map((d, i) => (
                <li key={i} className="flex flex-col gap-1 px-3 py-2.5">
                  <span className="font-medium">{d.who}</span>
                  <span className="text-muted-foreground">
                    On the map: <span className="text-foreground">{d.actual}</span> · On your chart:{" "}
                    <span className="text-foreground">{d.expected}</span>
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
              call — say so on the register above and the files are read again with it settled.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
