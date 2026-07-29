import type { StructureClaim } from "./bindFiles";
import { note, type IngestNote } from "./notes";
import type { Position } from "@/lib/graph/types";

/**
 * The built map, checked back against the org chart the client uploaded.
 *
 * This is a different question from the cross-check that runs while the files
 * are being bound, and it is the one a client actually asks. The bind-time
 * check compares what two *documents* said about a reporting line before
 * either was used. This compares what the *map* ended up doing — after manager
 * references were resolved, after rows the chart didn't cover were attached
 * somewhere, after cycles were broken and orphans lifted.
 *
 * Those two answers come apart more often than they should. A chart can agree
 * with payroll on paper and still be contradicted by the map, because the
 * graph builder had to place a role the reference didn't resolve to, or
 * because the person the chart puts someone under was dropped by the scrub and
 * never made it into the establishment at all. Reporting "the documents
 * agree" while the map quietly says otherwise is precisely the failure this
 * exists to catch.
 *
 * Nothing here changes the map. A divergence is reported, never repaired: the
 * chart is one account of the organisation and the position list is another,
 * and deciding which is current has always been the client's call.
 */

export interface StructureDivergence {
  /** The person or role the line belongs to. */
  who: string;
  /** Who the chart puts them under. */
  expected: string;
  /** Who the built map puts them under. */
  actual: string;
  /** Why the map ended up somewhere else, read off how the line was resolved. */
  why: string;
}

export interface StructureVerification {
  /** The chart or charts this was checked against. */
  files: string[];
  /** Reporting lines those files draw. */
  claimed: number;
  /** Of those, how many have both ends present in the built map. */
  checked: number;
  /** Of those checked, how many the map reproduces exactly. */
  verified: number;
  /** Lines the map draws differently, worst-explained first. */
  divergences: StructureDivergence[];
  /** Lines where one end never reached the establishment. */
  unplaced: number;
  /** verified ÷ checked. Null when nothing could be checked. */
  fidelity: number | null;
}

export const EMPTY_VERIFICATION: StructureVerification = {
  files: [],
  claimed: 0,
  checked: 0,
  verified: 0,
  divergences: [],
  unplaced: 0,
  fidelity: null,
};

export function hasVerification(v: StructureVerification): boolean {
  return v.claimed > 0;
}

/**
 * Keys are compared the way the scrub leaves them: trimmed, inner whitespace
 * collapsed, case ignored. A claim is captured before the scrub runs, so a
 * position ID that arrived as "P 101 " has to still match the "P 101" that
 * reached the graph.
 */
function norm(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/** How many divergences to keep. Enough to see the pattern, not the whole chart. */
const MAX_DIVERGENCES = 25;

/**
 * Explains a divergence from the confidence the graph builder recorded against
 * the reporting line, which is the only honest record of how it got there.
 *
 * The numbers come from buildOrgGraph: 1 is a manager reference resolved by
 * ID, 0.7 by name, 0.4 an orphan attached to a same-department manager, 0.3 an
 * orphan lifted to the top or placed under a brand heading, 0.2 a line
 * discarded to break a cycle, 0.8 a natural top-of-tree parented onto its own
 * heading.
 */
function explain(subject: Position, actualParent: Position | undefined): string {
  const confidence = subject.confidence.manager;

  // Checked before the shape of the parent, because a cycle is nearly always
  // broken by lifting the role to the top — and "this sits at the top" would
  // describe the symptom while hiding the cause.
  if (confidence <= 0.2) {
    return "The chart puts this role inside a reporting-line loop. The map had to discard one line to remain a tree, and this is the one it dropped — the chart is wrong here, not the data.";
  }
  if (actualParent?.synthetic) {
    return `The map has no reporting line for this role at all — it sits under the "${actualParent.title}" heading, which is scaffolding rather than a manager.`;
  }
  if (!actualParent) {
    return "The map has this role at the top of the structure, reporting to nobody.";
  }
  if (confidence <= 0.3) {
    return "The manager the position list named could not be resolved, so the graph builder placed this role rather than reading its line.";
  }
  if (confidence <= 0.4) {
    return "This role was an orphan and was attached to a manager in the same department, so its line is inferred rather than stated.";
  }
  return "The position list and the chart both state a line for this role, and they name different managers.";
}

/**
 * Checks every reporting line the uploaded chart draws against the reporting
 * line the finished map actually has.
 *
 * `rows` must be the same cleaned rows that were handed to the graph builder —
 * positions carry a `sourceRowIndex` into that array, and it is the only link
 * back from a built position to the keys the chart referred to it by.
 */
export function verifyStructureAgainstMap(
  claims: StructureClaim[],
  rows: Record<string, string>[],
  positions: Position[]
): StructureVerification {
  if (claims.length === 0) return EMPTY_VERIFICATION;

  const files = [...new Set(claims.map((c) => c.filename))];
  const byId = new Map(positions.map((p) => [p.id, p]));

  // Rebuild the two indexes the graph builder resolved manager references by,
  // this time pointing at the positions that actually exist in the map.
  const byKey = new Map<string, Position>();
  for (const position of positions) {
    if (position.synthetic) continue;
    const row = rows[position.sourceRowIndex];
    if (!row) continue;
    for (const value of [row.positionId, row.name]) {
      const k = norm(value ?? "");
      if (k && !byKey.has(k)) byKey.set(k, position);
    }
  }

  let checked = 0;
  let verified = 0;
  let unplaced = 0;
  const divergences: StructureDivergence[] = [];

  for (const claim of claims) {
    const subject = byKey.get(norm(claim.subjectKey));
    const expected = byKey.get(norm(claim.managerKey));

    // One end of the line never reached the establishment. That is a fact
    // about coverage, not about fidelity, so it is counted separately rather
    // than being scored as a mismatch.
    if (!subject || !expected) {
      unplaced++;
      continue;
    }

    checked++;

    if (subject.managerId === expected.id) {
      verified++;
      continue;
    }

    if (divergences.length < MAX_DIVERGENCES) {
      const actualParent = subject.managerId ? byId.get(subject.managerId) : undefined;
      divergences.push({
        who: claim.subjectLabel,
        expected: claim.managerLabel,
        actual: actualParent
          ? actualParent.synthetic
            ? `${actualParent.title} (a heading, not a manager)`
            : actualParent.displayName
          : "nobody — top of the structure",
        why: explain(subject, actualParent),
      });
    }
  }

  return {
    files,
    claimed: claims.length,
    checked,
    verified,
    divergences,
    unplaced,
    fidelity: checked === 0 ? null : verified / checked,
  };
}

/**
 * The result, said in one paragraph on the confirm screen.
 *
 * A map that reproduces the chart is registered as an assumption, because it
 * is a reading that held and the client should be able to see that it was
 * tested rather than asserted. A map that doesn't is a question, because
 * something has to be decided before anyone builds on it — and the thing to
 * decide is which document is current, which Atlas cannot know.
 */
export function verificationNote(v: StructureVerification): IngestNote | null {
  if (v.checked === 0 && v.unplaced === 0) return null;

  const charts = v.files.map((f) => `"${f}"`).join(", ");
  const pct = v.fidelity === null ? "0" : (v.fidelity * 100).toFixed(0);
  const differs = v.checked - v.verified;

  const coverage =
    v.unplaced > 0
      ? ` ${v.unplaced.toLocaleString()} further line${v.unplaced === 1 ? "" : "s"} could not be checked, because one end of ${v.unplaced === 1 ? "it" : "each"} is not in the establishment.`
      : "";

  if (differs === 0 && v.checked > 0) {
    return note("structure-map-qc", "assumption", {
      topic: "Map checked against your chart",
      statement:
        `The establishment map reproduces every reporting line in ${charts} that Atlas was able to check. ` +
        `The structure on screen is not just built from your files — it has been compared back to the chart you drew.`,
      evidence:
        `${v.verified.toLocaleString()} of ${v.checked.toLocaleString()} reporting lines verified against the finished map (${pct}%).${coverage}`,
      effect: `Spans, layers and every comparison built on them rest on a structure that matches your own chart.`,
    });
  }

  return note("structure-map-qc", "question", {
    topic: "Map checked against your chart",
    statement:
      `The establishment map puts ${differs.toLocaleString()} ${differs === 1 ? "person" : "people"} under a different ` +
      `manager than ${charts} does. Atlas has reported the difference rather than reshaping the map to match.`,
    evidence:
      `${v.verified.toLocaleString()} of ${v.checked.toLocaleString()} reporting lines verified (${pct}%).${coverage} ` +
      `For example: ` +
      v.divergences
        .slice(0, 3)
        .map((d) => `${d.who} is under "${d.actual}" on the map and "${d.expected}" on the chart`)
        .join("; ") +
      `.`,
    effect:
      `Spans of control and layer counts follow the map, so ${differs.toLocaleString()} ` +
      `${differs === 1 ? "line is" : "lines are"} counted against a manager your chart does not name. ` +
      `Most of these are roles whose stated manager could not be resolved — supply the reporting lines for them, ` +
      `or say which document is current, and Atlas will read the files again with it settled.`,
  });
}
