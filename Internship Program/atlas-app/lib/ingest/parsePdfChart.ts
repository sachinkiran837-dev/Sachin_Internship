import type { ParsedFile } from "./parseFile";
import type { PdfContent, Rect, Segment, TextRun } from "./parsePdf";

/**
 * Reads a *drawn* org chart out of a PDF — boxes joined by connector lines,
 * the shape a structure chart actually arrives in — rather than a table.
 *
 * This is inference, and it is labelled as such. Nothing here is stated by
 * the file: the reporting lines are worked out from which connector touches
 * which box, and where there are no connectors, from how the boxes are laid
 * out on the page. So every row this produces is flagged for review, exactly
 * like a row transcribed by a model, and the confirm screen says the
 * structure was read from a drawing. A chart read this way is a starting
 * point for a conversation with the client, not a confirmed baseline.
 *
 * What it will not do is produce a *partial* structure quietly. If the
 * geometry doesn't resolve into a single connected hierarchy, it says so and
 * hands the file on rather than importing whichever half it managed.
 */

export class NotAChartError extends Error {}

interface ChartBox {
  id: number;
  rect: Rect;
  lines: string[];
  parent: number | null;
}

/** Endpoints within this distance are treated as joined. */
const JOIN_TOLERANCE = 4;
/** How far outside a box edge a connector may start and still count. */
const TOUCH_TOLERANCE = 6;

/**
 * Whether this content is better read as a drawn chart than as a table.
 *
 * The two are genuinely confusable: a chart's boxes are laid out in a grid,
 * so its text lines up in rows and columns exactly as a table's does. Two
 * things separate them, and both are properties of the drawing rather than
 * guesses about the words:
 *
 * - connector lines that resolve the boxes into one hierarchy. Tables do not
 *   join their cells with elbow connectors, so this is near-conclusive.
 * - boxes that each hold several lines of text. A table cell holds one value;
 *   a chart box holds a name over a title.
 */
export function looksLikeChart(content: PdfContent): boolean {
  const boxes = findBoxes(content);
  if (boxes.length < 2) return false;

  if (linkByConnectors(boxes, content.segments)) return true;

  const fromRects = content.rects.length > 0;
  const multiline = boxes.filter((b) => b.lines.length >= 2).length;
  return fromRects && multiline >= Math.ceil(boxes.length * 0.6);
}

export function parsePdfChart(filename: string, content: PdfContent): ParsedFile {
  const boxes = findBoxes(content);

  if (boxes.length < 2) {
    throw new NotAChartError(
      `"${filename}" has no boxed roles Atlas could pick out — it does not look like a structure chart.`
    );
  }

  const method = link(boxes, content.segments);
  const roots = boxes.filter((b) => b.parent === null);

  if (roots.length > 1) {
    // Several disconnected trees usually means the connectors weren't
    // understood, not that the organisation has several heads. Saying so
    // beats importing a structure that is quietly wrong.
    const named = roots.slice(0, 3).map((r) => `"${label(r)}"`).join(", ");
    throw new NotAChartError(
      `"${filename}" looks like a structure chart, but Atlas could not resolve it into a single reporting hierarchy — ` +
        `${roots.length} of the ${boxes.length} boxes ended up with no one above them (${named}${roots.length > 3 ? ", …" : ""}). ` +
        `The connectors may be drawn in a way this reader doesn't follow.`
    );
  }

  const headers = ["Position ID", "Employee Name", "Position Title", "Manager ID"];
  const rows = boxes.map((box) => {
    const { name, title } = splitLabel(box.lines);
    return {
      "Position ID": `box-${box.id}`,
      "Employee Name": name,
      "Position Title": title,
      "Manager ID": box.parent === null ? "" : `box-${box.parent}`,
    };
  });

  return {
    headers,
    rows,
    conversion: {
      sourceFormat: "PDF",
      detail:
        `Read as a drawn structure chart, not a table: ${boxes.length} boxed roles, ` +
        `with reporting lines worked out ${method}.`,
      rowCount: rows.length,
      needsReview:
        `The structure in "${filename}" was drawn, not tabulated, so Atlas worked the reporting lines out ${method} ` +
        `rather than reading them from a column. Check the hierarchy against the chart before treating it as a baseline.`,
    },
  };
}

// --- boxes ----------------------------------------------------------------

function findBoxes(content: PdfContent): ChartBox[] {
  const fromRects = boxesFromRects(content.rects, content.runs);
  // Charts drawn without rectangles (text-only trees, or boxes drawn as four
  // separate strokes) still cluster into readable groups.
  return fromRects.length >= 2 ? fromRects : boxesFromClusters(content.runs);
}

function boxesFromRects(rects: Rect[], runs: TextRun[]): ChartBox[] {
  // Largest first, so a run inside nested rectangles is claimed by the
  // innermost — the role box, not the swimlane it sits in.
  const candidates = [...rects].sort((a, b) => b.width * b.height - a.width * a.height);
  const contents = new Map<Rect, TextRun[]>(candidates.map((r) => [r, []]));

  for (const run of runs) {
    let smallest: Rect | null = null;
    for (const rect of candidates) {
      if (!contains(rect, run)) continue;
      if (!smallest || rect.width * rect.height < smallest.width * smallest.height) smallest = rect;
    }
    if (smallest) contents.get(smallest)!.push(run);
  }

  return [...contents.entries()]
    .filter(([, inside]) => inside.length > 0)
    .map(([rect, inside], i) => ({
      id: i,
      rect,
      lines: linesOf(inside),
      parent: null,
    }))
    .sort(byPosition)
    .map((box, i) => ({ ...box, id: i }));
}

function contains(rect: Rect, run: TextRun): boolean {
  return (
    run.x >= rect.x - TOUCH_TOLERANCE &&
    run.x <= rect.x + rect.width + TOUCH_TOLERANCE &&
    run.y >= rect.y - TOUCH_TOLERANCE &&
    run.y <= rect.y + rect.height + TOUCH_TOLERANCE
  );
}

/** Runs close enough together to be one label form one box. */
function boxesFromClusters(runs: TextRun[]): ChartBox[] {
  const remaining = [...runs];
  const clusters: TextRun[][] = [];

  while (remaining.length > 0) {
    const cluster = [remaining.pop()!];
    let grew = true;

    while (grew) {
      grew = false;
      for (let i = remaining.length - 1; i >= 0; i--) {
        const run = remaining[i];
        if (cluster.some((c) => Math.abs(c.x - run.x) < 90 && Math.abs(c.y - run.y) < 22)) {
          cluster.push(run);
          remaining.splice(i, 1);
          grew = true;
        }
      }
    }

    clusters.push(cluster);
  }

  return clusters
    .map((cluster, i) => {
      const xs = cluster.map((c) => c.x);
      const ys = cluster.map((c) => c.y);
      return {
        id: i,
        rect: {
          x: Math.min(...xs),
          y: Math.min(...ys),
          width: Math.max(...xs) - Math.min(...xs) + 80,
          height: Math.max(...ys) - Math.min(...ys) + 12,
        },
        lines: linesOf(cluster),
        parent: null,
      };
    })
    .sort(byPosition)
    .map((box, i) => ({ ...box, id: i }));
}

function byPosition(a: ChartBox, b: ChartBox): number {
  const top = b.rect.y + b.rect.height - (a.rect.y + a.rect.height);
  return Math.abs(top) > 6 ? top : a.rect.x - b.rect.x;
}

function linesOf(runs: TextRun[]): string[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: string[] = [];
  let currentY: number | null = null;

  for (const run of sorted) {
    if (currentY !== null && Math.abs(run.y - currentY) <= 3) {
      lines[lines.length - 1] += ` ${run.text}`;
    } else {
      lines.push(run.text);
      currentY = run.y;
    }
  }

  return lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// --- reporting lines ------------------------------------------------------

/** Sets `parent` on each box and returns how it was decided, for the report. */
function link(boxes: ChartBox[], segments: Segment[]): string {
  const byConnector = linkByConnectors(boxes, segments);
  if (byConnector) return "from the connector lines drawn between the boxes";

  linkByLayout(boxes);
  return "from how the boxes are arranged on the page, as the chart has no connector lines this reader could follow";
}

/**
 * Org charts join a parent to its children with elbow connectors: a line
 * down from the parent, a horizontal run, then a line down into each child.
 * Segments that share endpoints are therefore one connector network, and a
 * network that touches one box from below and others from above states a
 * reporting relationship outright.
 */
function linkByConnectors(boxes: ChartBox[], segments: Segment[]): boolean {
  const usable = segments.filter(
    (s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) > 1 && !isBoxEdge(s, boxes)
  );
  if (usable.length === 0) return false;

  const parentOf = new Map<number, number>();

  for (const network of connectedNetworks(usable)) {
    const above: number[] = [];
    const below: number[] = [];

    for (const box of boxes) {
      const bottom = box.rect.y;
      const top = box.rect.y + box.rect.height;

      for (const point of endpoints(network)) {
        const withinX =
          point.x >= box.rect.x - TOUCH_TOLERANCE &&
          point.x <= box.rect.x + box.rect.width + TOUCH_TOLERANCE;
        if (!withinX) continue;
        if (Math.abs(point.y - bottom) <= TOUCH_TOLERANCE && !above.includes(box.id)) {
          above.push(box.id); // the network leaves this box from underneath
        }
        if (Math.abs(point.y - top) <= TOUCH_TOLERANCE && !below.includes(box.id)) {
          below.push(box.id); // ...and arrives at this one from on top
        }
      }
    }

    // Exactly one box above is what makes the relationship unambiguous.
    if (above.length !== 1) continue;
    for (const child of below) {
      if (child !== above[0] && !parentOf.has(child)) parentOf.set(child, above[0]);
    }
  }

  if (parentOf.size < boxes.length - 1) return false;

  for (const box of boxes) box.parent = parentOf.get(box.id) ?? null;
  return true;
}

/** A segment lying along a box's own outline is the box, not a connector. */
function isBoxEdge(s: Segment, boxes: ChartBox[]): boolean {
  return boxes.some((b) => {
    const { x, y, width, height } = b.rect;
    const onVertical =
      (Math.abs(s.x1 - x) < 2 || Math.abs(s.x1 - (x + width)) < 2) && Math.abs(s.x1 - s.x2) < 2;
    const onHorizontal =
      (Math.abs(s.y1 - y) < 2 || Math.abs(s.y1 - (y + height)) < 2) && Math.abs(s.y1 - s.y2) < 2;
    const inside =
      Math.min(s.x1, s.x2) >= x - 2 &&
      Math.max(s.x1, s.x2) <= x + width + 2 &&
      Math.min(s.y1, s.y2) >= y - 2 &&
      Math.max(s.y1, s.y2) <= y + height + 2;
    return inside && (onVertical || onHorizontal);
  });
}

function connectedNetworks(segments: Segment[]): Segment[][] {
  const parent = segments.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (touching(segments[i], segments[j])) union(i, j);
    }
  }

  const groups = new Map<number, Segment[]>();
  segments.forEach((s, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), s]);
  });

  return [...groups.values()];
}

function touching(a: Segment, b: Segment): boolean {
  return endpoints([a]).some((p) =>
    endpoints([b]).some((q) => Math.hypot(p.x - q.x, p.y - q.y) <= JOIN_TOLERANCE)
  );
}

function endpoints(segments: Segment[]): { x: number; y: number }[] {
  return segments.flatMap((s) => [
    { x: s.x1, y: s.y1 },
    { x: s.x2, y: s.y2 },
  ]);
}

/**
 * The fallback when a chart has no followable connectors: rows of boxes down
 * the page, each box reporting to the nearest box on the row above. Weaker
 * than reading the lines, which is why the report says which was used.
 */
function linkByLayout(boxes: ChartBox[]): void {
  const rows: ChartBox[][] = [];

  for (const box of [...boxes].sort((a, b) => b.rect.y - a.rect.y)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row[0].rect.y - box.rect.y) <= box.rect.height) row.push(box);
    else rows.push([box]);
  }

  for (let i = 1; i < rows.length; i++) {
    for (const box of rows[i]) {
      const centre = box.rect.x + box.rect.width / 2;
      // Prefer a box above that horizontally spans this one — a parent is
      // normally drawn over its children — and fall back to the nearest.
      const above = rows[i - 1];
      const spanning = above.filter(
        (p) => centre >= p.rect.x - p.rect.width && centre <= p.rect.x + p.rect.width * 2
      );
      const pool = spanning.length > 0 ? spanning : above;
      const parent = pool.reduce((best, p) =>
        Math.abs(p.rect.x + p.rect.width / 2 - centre) <
        Math.abs(best.rect.x + best.rect.width / 2 - centre)
          ? p
          : best
      );
      box.parent = parent.id;
    }
  }
}

// --- labels ---------------------------------------------------------------

function label(box: ChartBox): string {
  return box.lines.join(" — ") || `box ${box.id}`;
}

/**
 * A chart box is usually a person's name over their job title. A single line
 * is treated as the title, since a structure chart without names is still a
 * structure — and inventing a name from a title would be worse than leaving
 * it blank.
 */
function splitLabel(lines: string[]): { name: string; title: string } {
  if (lines.length === 0) return { name: "", title: "Unspecified title" };
  if (lines.length === 1) {
    return looksLikeName(lines[0])
      ? { name: lines[0], title: "" }
      : { name: "", title: lines[0] };
  }
  return looksLikeName(lines[0])
    ? { name: lines[0], title: lines.slice(1).join(", ") }
    : { name: "", title: lines.join(", ") };
}

const TITLE_WORDS =
  /\b(chief|director|manager|head|lead|officer|nurse|coordinator|analyst|advisor|assistant|executive|president|supervisor|specialist|engineer|consultant|administrator|vacant)\b/i;

function looksLikeName(line: string): boolean {
  if (TITLE_WORDS.test(line)) return false;
  const words = line.trim().split(/\s+/);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Z][\w'’.-]*$/.test(w));
}
