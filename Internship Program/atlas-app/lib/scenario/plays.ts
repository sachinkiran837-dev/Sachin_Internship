import assumptions from "@/config/scenario-assumptions.json";
import spanConfig from "@/config/span-thresholds.json";
import { tagNodes } from "@/lib/graph/tagging";
import { matchProtectedRole } from "@/lib/protected-roles/match";
import type { LayoutNode, Position, SpanThresholds } from "@/lib/graph/types";

const SPAN: SpanThresholds = spanConfig;

/**
 * The named redesign plays offered on the Scenarios tab, replacing the
 * free-text move box. Each one answers a question a client actually asks in
 * a redesign, finds its own candidates in this org's graph, and prices them
 * deterministically — the diagnostic engine does the arithmetic, never a
 * model. Where a play needs a rate it can't observe, it reads it from
 * config/scenario-assumptions.json and names it in `method`.
 *
 * The hard part in each play isn't finding candidates, it's *not* counting
 * savings that aren't real: agency conversion banks only the premium, not
 * the whole role; wide-span redistribution banks an avoided hire, not a
 * cut; consolidation only merges where the receiving manager stays inside
 * a healthy span.
 */

export type PlayOperation =
  | { kind: "remove"; positionId: string }
  | { kind: "reassign"; positionId: string; newManagerId: string }
  | { kind: "rebase"; positionId: string; cost: number; status?: Position["status"]; reason: string };

export interface PlayCandidate {
  positionId: string;
  title: string;
  department: string;
  /** Why this specific position qualified — shown per-row so the pick is auditable. */
  rationale: string;
  saving: number;
}

export type SavingNature = "cost-out" | "cost-avoidance" | "cost-rebase";

export interface PlayAnalysis {
  playId: string;
  candidates: PlayCandidate[];
  operations: PlayOperation[];
  projectedSaving: number;
  savingNature: SavingNature;
  headcountDelta: number;
  summary: string;
  /** The arithmetic, stated so a client can check it. */
  method: string;
  /** What the play deliberately left alone, and why. */
  guardrailNote: string | null;
}

/**
 * The serialisable half of a play. `ScenarioPlay` carries an `analyse`
 * function, which cannot cross the server/client boundary — so anything
 * handed to a client component is narrowed to this first.
 */
export interface PlayMeta {
  id: string;
  name: string;
  question: string;
  thesis: string;
  lens: "Structure" | "Workforce mix" | "Spans & layers" | "Portfolio";
}

export interface ScenarioPlay extends PlayMeta {
  analyse(nodes: LayoutNode[]): PlayAnalysis;
}

function toMeta(play: ScenarioPlay): PlayMeta {
  return {
    id: play.id,
    name: play.name,
    question: play.question,
    thesis: play.thesis,
    lens: play.lens,
  };
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                      */
/* ------------------------------------------------------------------ */

const annualCost = (n: Position) => n.cost * n.fte;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const isProtected = (n: LayoutNode) => Boolean(n.flags.protected);
const isManager = (n: LayoutNode) => n.childIds.length > 0;

/**
 * Two different questions, deliberately not conflated:
 *
 * - "structural" moves a role or removes it. A clinical role is off limits,
 *   because changing who covers a shift is a safe-staffing decision.
 * - "commercial" only changes what a role costs — the person, the post and
 *   the roster are untouched. Converting an agency nurse to permanent is
 *   the clearest case: excluding clinical roles here would rule out the
 *   single largest legitimate saving in a health establishment while
 *   protecting nobody.
 *
 * Protected roles are out of scope for both.
 */
type TouchMode = "structural" | "commercial";

function isTouchable(n: LayoutNode, rootId: string | null, mode: TouchMode = "structural"): boolean {
  if (isProtected(n) || n.id === rootId) return false;
  return mode === "commercial" || !n.clinicalFlag;
}

function protectedSkipNote(skipped: LayoutNode[], mode: TouchMode = "structural"): string | null {
  if (skipped.length === 0) return null;
  const distinct = [...new Set(skipped.map((n) => n.title))];
  const names = distinct.slice(0, 3);
  const label = mode === "commercial" ? "protected role" : "protected or clinical role";
  return `Left ${skipped.length} ${label}${skipped.length === 1 ? "" : "s"} in place (${names.join(", ")}${
    distinct.length > names.length ? ", …" : ""
  }) — these are blocked when a change is applied, not merely hidden from this list.`;
}

function empty(playId: string, summary: string, method: string): PlayAnalysis {
  return {
    playId,
    candidates: [],
    operations: [],
    projectedSaving: 0,
    savingNature: "cost-out",
    headcountDelta: 0,
    summary,
    method,
    guardrailNote: null,
  };
}

/** Strips the hire-type prefix so "Agency Registered Nurse" benchmarks against "Registered Nurse". */
const CONTINGENT_PREFIXES = /^(agency|contract|contractor|locum|temp|temporary|casual|interim)\s+/i;
const CONTINGENT_SUFFIXES = /\s+\((agency|contract|locum|temp|casual)\)$/i;

function baseTitle(title: string): string {
  return title
    .replace(CONTINGENT_PREFIXES, "")
    .replace(CONTINGENT_SUFFIXES, "")
    .trim()
    .toLowerCase();
}

const rootIdOf = (nodes: LayoutNode[]) => nodes.find((n) => n.managerId === null)?.id ?? null;

/* ------------------------------------------------------------------ */
/* 1. pass-through management layers                                   */
/* ------------------------------------------------------------------ */

const passThroughLayers: ScenarioPlay = {
  id: "pass-through-layers",
  name: "Strip pass-through management layers",
  question: "Which management roles only relay, rather than run anything?",
  thesis:
    "A manager with exactly one direct report who is themselves a manager isn't running a team — they're a relay between two layers. That is the cleanest cost in an org chart, because the work below them is untouched when they go.",
  lens: "Spans & layers",
  analyse(nodes) {
    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const rootId = rootIdOf(nodes);

    const relays = nodes.filter((n) => {
      if (n.childIds.length !== 1) return false;
      const onlyChild = byId.get(n.childIds[0]);
      // The distinction that makes this safe: a sole report who is a leaf may
      // be a working supervisor. A sole report who manages their own team
      // means this node is purely a relay.
      return Boolean(onlyChild && onlyChild.childIds.length > 0);
    });

    const skipped = relays.filter((n) => !isTouchable(n, rootId));
    const candidates = relays.filter((n) => isTouchable(n, rootId));

    if (candidates.length === 0) {
      return empty(
        this.id,
        "No pass-through layers found — no manager sits above exactly one other manager.",
        "Looked for managers with exactly one direct report where that report also manages a team."
      );
    }

    const total = candidates.reduce((s, n) => s + annualCost(n), 0);

    return {
      playId: this.id,
      candidates: candidates.map((n) => ({
        positionId: n.id,
        title: n.title,
        department: n.department,
        rationale: `Sole report is "${byId.get(n.childIds[0])!.title}", who runs a team of ${byId.get(n.childIds[0])!.childIds.length}.`,
        saving: annualCost(n),
      })),
      operations: candidates.map((n) => ({ kind: "remove" as const, positionId: n.id })),
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -candidates.length,
      summary: `${candidates.length} relay layer${candidates.length === 1 ? "" : "s"} sit between two management levels without widening any span.`,
      method:
        "Saving is the fully-loaded cost (cost × FTE) of each relay role. Their reports are re-parented to the grandparent, so no work is removed — only the layer.",
      guardrailNote: protectedSkipNote(skipped),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 2. agency premium conversion                                        */
/* ------------------------------------------------------------------ */

const agencyPremium: ScenarioPlay = {
  id: "agency-premium",
  name: "Convert agency premium to permanent",
  question: "What is the org paying purely for the flexibility of agency labour?",
  thesis:
    "The saving from an agency nurse is not their salary — the shift still has to be covered. It is only the premium over what the same role costs permanently. Counting the whole role is the most common way redesign business cases overstate themselves.",
  lens: "Workforce mix",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const contingent = nodes.filter((n) => n.status === "contingent");

    if (contingent.length === 0) {
      return empty(
        this.id,
        "No agency or contract positions in this establishment.",
        "Looked for positions with contingent status."
      );
    }

    // Benchmark against this org's own permanent staff doing the same job,
    // and only fall back to an assumed rate when there is no equivalent.
    const permanentByBase = new Map<string, number[]>();
    for (const n of nodes) {
      if (n.status !== "filled") continue;
      const key = baseTitle(n.title);
      permanentByBase.set(key, [...(permanentByBase.get(key) ?? []), annualCost(n)]);
    }

    const candidates: PlayCandidate[] = [];
    const operations: PlayOperation[] = [];
    const skipped: LayoutNode[] = [];
    let benchmarked = 0;
    let assumed = 0;

    for (const n of contingent) {
      // Commercial mode: the nurse keeps the shift, only the employment
      // basis changes, so a clinical flag is not a reason to exclude.
      if (!isTouchable(n, rootId, "commercial")) {
        skipped.push(n);
        continue;
      }

      const peers = permanentByBase.get(baseTitle(n.title)) ?? [];
      const current = annualCost(n);
      let benchmark: number;
      let basis: string;

      if (peers.length > 0) {
        benchmark = median(peers);
        basis = `benchmarked against ${peers.length} permanent "${n.title.replace(CONTINGENT_PREFIXES, "")}" role${peers.length === 1 ? "" : "s"}`;
        benchmarked++;
      } else {
        benchmark = current * (1 - assumptions.agencyPremiumFallbackRate);
        basis = `no permanent equivalent in this org — assumed ${(assumptions.agencyPremiumFallbackRate * 100).toFixed(0)}% premium`;
        assumed++;
      }

      const saving = current - benchmark;
      if (saving <= 0) continue;

      candidates.push({
        positionId: n.id,
        title: n.title,
        department: n.department,
        rationale: `${basis}.`,
        saving,
      });
      operations.push({
        kind: "rebase",
        positionId: n.id,
        cost: benchmark / (n.fte || 1),
        status: "filled",
        reason: basis,
      });
    }

    if (candidates.length === 0) {
      // The usual reason on a real client's data is not that agency is
      // cheap — it is that the agency population arrived with no cost at
      // all, which the confirm screen is already asking about. Saying
      // "none priced above their equivalent" without saying that reads as
      // a finding when it is a gap in the data.
      const unpriced = contingent.filter((n) => annualCost(n) <= 0).length;
      return empty(
        this.id,
        unpriced === contingent.length
          ? `All ${contingent.length} agency position${contingent.length === 1 ? "" : "s"} in this establishment carry no cost, so there is no premium to measure.`
          : "Agency positions found, but none priced above their permanent equivalent.",
        unpriced === contingent.length
          ? "This play compares what agency labour costs against the permanent equivalent. Supply the agency spend or the hours behind these positions on the confirm screen and it can run."
          : "Compared each contingent role's fully-loaded cost against the median permanent cost of the same base title."
      );
    }

    const total = candidates.reduce((s, c) => s + c.saving, 0);

    return {
      playId: this.id,
      candidates: candidates.sort((a, b) => b.saving - a.saving),
      operations,
      projectedSaving: total,
      savingNature: "cost-rebase",
      // Headcount is unchanged on purpose: the roles convert, they don't go.
      headcountDelta: 0,
      summary: `${candidates.length} agency position${candidates.length === 1 ? "" : "s"} priced above the permanent equivalent of the same work.`,
      method:
        `Saving is the premium only — each role's cost minus its permanent benchmark, never the whole role. ` +
        `${benchmarked} benchmarked against this org's own permanent staff` +
        (assumed > 0
          ? `; ${assumed} had no permanent equivalent in this org, so a stated ${(assumptions.agencyPremiumFallbackRate * 100).toFixed(0)}% premium assumption was used instead.`
          : ". No assumed rates were needed.") +
        " Headcount is unchanged — the work stays, only its price changes.",
      guardrailNote: protectedSkipNote(skipped, "commercial"),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 3. thin-span consolidation                                          */
/* ------------------------------------------------------------------ */

const thinSpanConsolidation: ScenarioPlay = {
  id: "thin-span-consolidation",
  name: "Consolidate sub-scale teams",
  question: "Which teams are too small to justify their own manager?",
  thesis:
    "Merging a sub-scale team into a peer only pays if the receiving manager can actually absorb it. Consolidations that push the receiver past a healthy span just move the problem and get reversed within a year.",
  lens: "Spans & layers",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const managers = nodes.filter(isManager);

    const thin = managers.filter((n) => n.childIds.length > 0 && n.childIds.length < SPAN.healthyMin);
    const skipped = thin.filter((n) => !isTouchable(n, rootId));

    const candidates: PlayCandidate[] = [];
    const operations: PlayOperation[] = [];
    // Track receivers' growing spans so two merges can't both claim the same headroom.
    const projectedSpan = new Map(managers.map((m) => [m.id, m.childIds.length] as const));
    const consumed = new Set<string>();

    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const isDescendantOf = (candidateId: string, ancestorId: string): boolean => {
      let cursor = byId.get(candidateId)?.managerId ?? null;
      while (cursor) {
        if (cursor === ancestorId) return true;
        cursor = byId.get(cursor)?.managerId ?? null;
      }
      return false;
    };

    for (const donor of thin.filter((n) => isTouchable(n, rootId))) {
      if (consumed.has(donor.id)) continue;

      const receiver = managers
        .filter(
          (m) =>
            m.id !== donor.id &&
            !consumed.has(m.id) &&
            m.department === donor.department &&
            // Merging into your own child is a pass-through layer, not a
            // consolidation — that case belongs to the delayering play.
            !isDescendantOf(m.id, donor.id) &&
            (projectedSpan.get(m.id) ?? 0) + donor.childIds.length <= SPAN.healthyMax
        )
        // Prefer the receiver that ends closest to the healthy band without exceeding it.
        .sort((a, b) => (projectedSpan.get(b.id) ?? 0) - (projectedSpan.get(a.id) ?? 0))[0];

      if (!receiver) continue;

      const combined = (projectedSpan.get(receiver.id) ?? 0) + donor.childIds.length;
      projectedSpan.set(receiver.id, combined);
      consumed.add(donor.id);

      candidates.push({
        positionId: donor.id,
        title: donor.title,
        department: donor.department,
        rationale: `Team of ${donor.childIds.length} merges into "${receiver.title}", taking that span to ${combined} — inside the healthy ${SPAN.healthyMin}–${SPAN.healthyMax} band.`,
        saving: annualCost(donor),
      });

      for (const childId of donor.childIds) {
        operations.push({ kind: "reassign", positionId: childId, newManagerId: receiver.id });
      }
      operations.push({ kind: "remove", positionId: donor.id });
    }

    if (candidates.length === 0) {
      return empty(
        this.id,
        `No sub-scale team can be merged without pushing the receiving manager past a span of ${SPAN.healthyMax}.`,
        `Looked for managers with fewer than ${SPAN.healthyMin} reports whose team fits under a same-department peer (excluding their own reports) while keeping that peer at or below ${SPAN.healthyMax}.`
      );
    }

    const total = candidates.reduce((s, c) => s + c.saving, 0);

    return {
      playId: this.id,
      candidates,
      operations,
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -candidates.length,
      summary: `${candidates.length} sub-scale team${candidates.length === 1 ? "" : "s"} can merge into a peer that has room to absorb them.`,
      method:
        `Saving is the manager cost released. Teams move intact; only the surplus manager role goes. Every merge is checked against the healthy span band of ${SPAN.healthyMin}–${SPAN.healthyMax}, and receivers are re-checked as they fill so no manager is double-counted.`,
      guardrailNote: protectedSkipNote(skipped),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 4. scattered function → shared service                              */
/* ------------------------------------------------------------------ */

const sharedService: ScenarioPlay = {
  id: "shared-service",
  name: "Consolidate scattered functions",
  question: "Which functions are being run several times over in different departments?",
  thesis:
    "The money in a shared service isn't the analysts — it's the supervisory capacity that fragmenting them created. Consolidating only pays where it leaves a manager with nothing left to manage.",
  lens: "Structure",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    const byTitle = new Map<string, LayoutNode[]>();
    for (const n of nodes) {
      if (isManager(n)) continue; // consolidate the doers, not the leadership
      const key = n.title.trim().toLowerCase();
      byTitle.set(key, [...(byTitle.get(key) ?? []), n]);
    }

    const operations: PlayOperation[] = [];
    const candidates: PlayCandidate[] = [];
    const skipped: LayoutNode[] = [];
    let scatteredGroups = 0;

    for (const group of byTitle.values()) {
      const managerIds = new Set(group.map((n) => n.managerId));
      // Fragmented supervision is the signal, not the department label: the
      // same function split across several managers is the duplication,
      // whether or not the org happens to file them under different
      // departments. Requiring a department split would find nothing in a
      // single-site org that has exactly this problem.
      if (group.length < 3 || managerIds.size < 2) continue;

      const movable = group.filter((n) => isTouchable(n, rootId));
      skipped.push(...group.filter((n) => !isTouchable(n, rootId)));
      if (movable.length < 3) continue;

      // Consolidate under whichever existing manager already holds the most
      // of this function — the lowest-disruption owner, not a new role.
      const counts = new Map<string, number>();
      for (const n of movable) {
        if (n.managerId) counts.set(n.managerId, (counts.get(n.managerId) ?? 0) + 1);
      }
      const ownerId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (!ownerId) continue;

      scatteredGroups++;

      for (const n of movable) {
        if (n.managerId !== ownerId) {
          operations.push({ kind: "reassign", positionId: n.id, newManagerId: ownerId });
        }
      }

      // The saving is only realised where a losing manager is left with an
      // empty team — otherwise this is a structural tidy-up worth $0.
      for (const managerId of managerIds) {
        if (!managerId || managerId === ownerId) continue;
        const manager = byId.get(managerId);
        if (!manager || !isTouchable(manager, rootId)) continue;
        const remaining = manager.childIds.filter((id) => {
          const child = byId.get(id);
          return child && !movable.some((m) => m.id === child.id);
        });
        if (remaining.length === 0) {
          candidates.push({
            positionId: manager.id,
            title: manager.title,
            department: manager.department,
            rationale: `Left with no team once its ${manager.childIds.length} "${byId.get(manager.childIds[0])?.title ?? ""}" report${manager.childIds.length === 1 ? "" : "s"} consolidate under "${byId.get(ownerId)?.title}".`,
            saving: annualCost(manager),
          });
          operations.push({ kind: "remove", positionId: manager.id });
        }
      }
    }

    if (scatteredGroups === 0) {
      return empty(
        this.id,
        "No function is split across enough separate managers to be worth consolidating.",
        "Looked for the same role title held by 3+ people reporting to 2+ different managers."
      );
    }

    const total = candidates.reduce((s, c) => s + c.saving, 0);

    return {
      playId: this.id,
      candidates,
      operations,
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -candidates.length,
      summary:
        `${scatteredGroups} function${scatteredGroups === 1 ? " is" : "s are"} split across separate managers. ` +
        (candidates.length > 0
          ? `Consolidating them empties ${candidates.length} supervisory role${candidates.length === 1 ? "" : "s"}.`
          : "Consolidating them tidies the structure but empties no supervisory role, so the modelled saving is nil."),
      method:
        "Doers are re-parented to whichever manager already holds most of that function. Saving is claimed only for managers left with an empty team afterwards — the practitioners themselves are never counted as savings, because the work continues.",
      guardrailNote: protectedSkipNote(skipped),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 5. wide-span redistribution (avoided hire)                          */
/* ------------------------------------------------------------------ */

const wideSpanRedistribution: ScenarioPlay = {
  id: "wide-span-redistribution",
  name: "Absorb wide spans without hiring",
  question: "Where can an overloaded manager be relieved without adding a role?",
  thesis:
    "An overloaded manager usually triggers a new team-lead hire. If an under-loaded peer can take the overflow, the hire never happens — this is money not spent rather than money cut, and it should be labelled that way.",
  lens: "Spans & layers",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const managers = nodes.filter(isManager);
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    const wide = managers.filter((n) => n.childIds.length > SPAN.healthyMax);
    if (wide.length === 0) {
      return empty(
        this.id,
        `No manager is carrying more than ${SPAN.healthyMax} direct reports.`,
        `Looked for spans above the healthy maximum of ${SPAN.healthyMax}.`
      );
    }

    const managerCost = median(managers.map(annualCost));
    const replacementCost = assumptions.replacementManagerCost ?? managerCost;

    const projectedSpan = new Map(managers.map((m) => [m.id, m.childIds.length] as const));
    const operations: PlayOperation[] = [];
    const candidates: PlayCandidate[] = [];
    const skipped: LayoutNode[] = [];

    for (const overloaded of wide) {
      let moved = 0;
      const surplus = overloaded.childIds.length - SPAN.healthyMax;

      const movableChildren = overloaded.childIds
        .map((id) => byId.get(id))
        .filter((c): c is LayoutNode => Boolean(c))
        .filter((c) => {
          if (!isTouchable(c, rootId)) {
            skipped.push(c);
            return false;
          }
          return true;
        });

      for (const child of movableChildren) {
        if (moved >= surplus) break;
        const receiver = managers
          .filter(
            (m) =>
              m.id !== overloaded.id &&
              m.department === overloaded.department &&
              (projectedSpan.get(m.id) ?? 0) < SPAN.healthyMin
          )
          .sort((a, b) => (projectedSpan.get(a.id) ?? 0) - (projectedSpan.get(b.id) ?? 0))[0];

        if (!receiver) break;

        projectedSpan.set(receiver.id, (projectedSpan.get(receiver.id) ?? 0) + 1);
        projectedSpan.set(overloaded.id, (projectedSpan.get(overloaded.id) ?? 0) - 1);
        operations.push({ kind: "reassign", positionId: child.id, newManagerId: receiver.id });
        moved++;
      }

      if (moved > 0) {
        candidates.push({
          positionId: overloaded.id,
          title: overloaded.title,
          department: overloaded.department,
          rationale: `Span drops from ${overloaded.childIds.length} to ${projectedSpan.get(overloaded.id)} by redistributing ${moved} report${moved === 1 ? "" : "s"} to under-loaded peers — no new team lead needed.`,
          saving: replacementCost,
        });
      }
    }

    if (candidates.length === 0) {
      return empty(
        this.id,
        `${wide.length} manager${wide.length === 1 ? " is" : "s are"} over a healthy span, but no same-department peer has capacity to absorb the overflow.`,
        `Looked for under-loaded peers (span below ${SPAN.healthyMin}) in the same department who could take the surplus.`
      );
    }

    return {
      playId: this.id,
      candidates,
      operations,
      projectedSaving: candidates.length * replacementCost,
      savingNature: "cost-avoidance",
      headcountDelta: 0,
      summary: `${candidates.length} overloaded manager${candidates.length === 1 ? "" : "s"} can be brought back inside a healthy span using existing capacity.`,
      method:
        `This is cost avoidance, not cost-out — nobody leaves and headcount is unchanged. Each relieved manager represents one team-lead hire that no longer needs to happen, priced at this org's own median manager cost (${new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(replacementCost)}) rather than an assumed market rate.`,
      // Naming every clinical report it declined to move would list most of
      // the ward; the useful fact is that reporting lines for clinical staff
      // were left alone at all.
      guardrailNote:
        skipped.length > 0
          ? `Only non-clinical reports were redistributed — ${skipped.length} clinical or protected reporting line${skipped.length === 1 ? " was" : "s were"} left untouched, so ward cover is unchanged.`
          : null,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 6. vacancy rationalisation                                          */
/* ------------------------------------------------------------------ */

const vacancyRationalisation: ScenarioPlay = {
  id: "vacancy-rationalisation",
  name: "Close vacancies the org is running without",
  question: "Which budgeted roles has the org already proved it can operate without?",
  thesis:
    "A long-held vacancy is budget the org isn't using. The discipline is knowing which ones you can't close: a vacant clinical or safety role is a staffing breach waiting to happen, not a saving.",
  lens: "Portfolio",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const vacant = nodes.filter((n) => n.status === "vacant");

    if (vacant.length === 0) {
      return empty(this.id, "No vacant positions in this establishment.", "Looked for positions with vacant status.");
    }

    const skipped = vacant.filter((n) => !isTouchable(n, rootId));
    // A vacancy carrying a live team is a different problem (an acting-up
    // gap), not a closure candidate — closing it would orphan the team.
    const withTeam = vacant.filter((n) => isTouchable(n, rootId) && n.childIds.length > 0);
    const closeable = vacant.filter((n) => isTouchable(n, rootId) && n.childIds.length === 0);

    if (closeable.length === 0) {
      return empty(
        this.id,
        `${vacant.length} vacancy${vacant.length === 1 ? "" : "s"} found, but none can be closed — each is protected, clinical, or still carrying a team.`,
        "Excluded protected, clinical and team-carrying vacancies."
      );
    }

    const rate = assumptions.vacancyRealisationRate;
    const total = closeable.reduce((s, n) => s + annualCost(n) * rate, 0);

    const notes = [protectedSkipNote(skipped)];
    if (withTeam.length > 0) {
      notes.push(
        `Left ${withTeam.length} vacant manager role${withTeam.length === 1 ? "" : "s"} open — ${withTeam.length === 1 ? "it is" : "they are"} still carrying direct reports, so closing would orphan a team.`
      );
    }

    return {
      playId: this.id,
      candidates: closeable.map((n) => ({
        positionId: n.id,
        title: n.title,
        department: n.department,
        rationale: `Vacant, non-clinical, and carries no direct reports.`,
        saving: annualCost(n) * rate,
      })),
      operations: closeable.map((n) => ({ kind: "remove" as const, positionId: n.id })),
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -closeable.length,
      summary: `${closeable.length} vacancy${closeable.length === 1 ? "" : "s"} can be closed without touching a clinical or safety role.`,
      method:
        `Saving is the budgeted cost of each closed vacancy at a stated realisation rate of ${(rate * 100).toFixed(0)}% — lower that assumption if these vacancies are partly covered by overtime that would continue.`,
      guardrailNote: notes.filter(Boolean).join(" ") || null,
    };
  },
};

/* ------------------------------------------------------------------ */
/* 7. shadow / deputy roles                                            */
/* ------------------------------------------------------------------ */

const SHADOW_PREFIX = /^(deputy|assistant|associate|acting|interim|2ic|second[- ]in[- ]charge)\s+/i;

const shadowRoles: ScenarioPlay = {
  id: "shadow-roles",
  name: "Remove shadow deputy roles",
  question: "Which deputy roles duplicate their principal rather than extend them?",
  thesis:
    "A deputy who runs part of the team is real capacity. A deputy with no reports of their own, sitting directly under their principal, is duplicated authority — the org is paying twice for one span of control.",
  lens: "Structure",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const byId = new Map(nodes.map((n) => [n.id, n] as const));

    const shadows = nodes.filter((n) => {
      const match = n.title.match(SHADOW_PREFIX);
      if (!match) return false;
      // Only a shadow if it has no team of its own...
      if (n.childIds.length > 0) return false;
      const principalTitle = n.title.replace(SHADOW_PREFIX, "").trim().toLowerCase();
      const manager = n.managerId ? byId.get(n.managerId) : undefined;
      // ...and reports directly to the role it shadows.
      return Boolean(manager && manager.title.trim().toLowerCase() === principalTitle);
    });

    const skipped = shadows.filter((n) => !isTouchable(n, rootId));
    const candidates = shadows.filter((n) => isTouchable(n, rootId));

    if (candidates.length === 0) {
      return empty(
        this.id,
        "No shadow deputy roles found.",
        "Looked for deputy/assistant/acting/2IC titles with no direct reports that report straight to the role they shadow."
      );
    }

    const total = candidates.reduce((s, n) => s + annualCost(n), 0);

    return {
      playId: this.id,
      candidates: candidates.map((n) => ({
        positionId: n.id,
        title: n.title,
        department: n.department,
        rationale: `No direct reports, and reports straight to "${byId.get(n.managerId!)!.title}" — the role it shadows.`,
        saving: annualCost(n),
      })),
      operations: candidates.map((n) => ({ kind: "remove" as const, positionId: n.id })),
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -candidates.length,
      summary: `${candidates.length} deputy role${candidates.length === 1 ? "" : "s"} duplicate a principal without holding any span of their own.`,
      method:
        "Saving is the fully-loaded cost of each shadow role. Deputies who do run a team are deliberately excluded — they are real capacity, not duplication.",
      guardrailNote: protectedSkipNote(skipped),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 8. deepest-chain compression                                        */
/* ------------------------------------------------------------------ */

const deepChainCompression: ScenarioPlay = {
  id: "deep-chain-compression",
  name: "Compress the longest reporting chains",
  question: "What actually makes this org tall — and how far is the frontline from the top?",
  thesis:
    "Layer counts are an average; decisions travel down a specific chain. Targeting the deepest path attacks the distance between the top of house and the frontline, rather than shaving a layer wherever it happens to be easiest.",
  lens: "Spans & layers",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    if (nodes.length === 0) return empty(this.id, "Nothing to compress.", "No positions.");

    const maxDepth = Math.max(...nodes.map((n) => n.depth));
    if (maxDepth < 3) {
      return empty(
        this.id,
        `The deepest reporting line is only ${maxDepth + 1} layers — already flat.`,
        "Looked at the longest root-to-leaf path in the structure."
      );
    }

    const byId = new Map(nodes.map((n) => [n.id, n] as const));
    const deepest = nodes.filter((n) => n.depth === maxDepth);

    // Walk each deepest leaf back to the root and collect the intermediate
    // managers on that path — those are what make this chain long.
    const onDeepPaths = new Set<string>();
    for (const leaf of deepest) {
      let cursor: string | null = leaf.managerId;
      while (cursor) {
        onDeepPaths.add(cursor);
        cursor = byId.get(cursor)?.managerId ?? null;
      }
    }

    const chainNodes = [...onDeepPaths].map((id) => byId.get(id)!).filter(Boolean);
    const narrow = chainNodes.filter((n) => n.childIds.length > 0 && n.childIds.length < SPAN.healthyMin);
    const skipped = narrow.filter((n) => !isTouchable(n, rootId));
    const candidates = narrow.filter((n) => isTouchable(n, rootId));

    if (candidates.length === 0) {
      return empty(
        this.id,
        `The deepest chain runs ${maxDepth + 1} layers, but every link on it carries a healthy span — there is no slack to remove.`,
        `Walked the longest root-to-leaf paths and looked for links with fewer than ${SPAN.healthyMin} reports.`
      );
    }

    const total = candidates.reduce((s, n) => s + annualCost(n), 0);

    return {
      playId: this.id,
      candidates: candidates.map((n) => ({
        positionId: n.id,
        title: n.title,
        department: n.department,
        rationale: `Sits at layer ${n.depth + 1} on the org's deepest chain with only ${n.childIds.length} report${n.childIds.length === 1 ? "" : "s"}.`,
        saving: annualCost(n),
      })),
      operations: candidates.map((n) => ({ kind: "remove" as const, positionId: n.id })),
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -candidates.length,
      summary: `The longest reporting line runs ${maxDepth + 1} layers deep; ${candidates.length} link${candidates.length === 1 ? "" : "s"} on it carr${candidates.length === 1 ? "ies" : "y"} a thin span.`,
      method:
        `Saving is the cost of each removed link; their reports re-parent upward, shortening the path from the top of house to the frontline. Only links with fewer than ${SPAN.healthyMin} reports are touched.`,
      guardrailNote: protectedSkipNote(skipped),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 9. manager-to-IC ratio                                              */
/* ------------------------------------------------------------------ */

const managerRatio: ScenarioPlay = {
  id: "manager-ratio",
  name: "Rebalance the management ratio",
  question: "How much management does an org this size actually need?",
  thesis:
    "Every span looks defensible one at a time. Sizing management top-down against the number of people actually doing the work exposes the surplus that case-by-case review never finds.",
  lens: "Structure",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const managers = nodes.filter(isManager);
    const ics = nodes.filter((n) => !isManager(n));

    if (managers.length === 0 || ics.length === 0) {
      return empty(this.id, "Not enough structure to assess a management ratio.", "Needs both managers and individual contributors.");
    }

    // At the healthy maximum span, this is the fewest managers that could
    // cover the frontline. Anything above it is structural surplus.
    const requiredManagers = Math.ceil(ics.length / SPAN.healthyMax);
    const surplus = managers.length - requiredManagers;
    const currentRatio = ics.length / managers.length;

    if (surplus <= 0) {
      return empty(
        this.id,
        `${managers.length} managers to ${ics.length} individual contributors (1:${currentRatio.toFixed(1)}) — already at or below the ${requiredManagers} implied by a span of ${SPAN.healthyMax}.`,
        `Compared actual manager count against ceil(individual contributors ÷ ${SPAN.healthyMax}).`
      );
    }

    // Take the surplus from the thinnest spans first — the least disruptive end.
    const ranked = managers
      .filter((n) => isTouchable(n, rootId))
      .sort((a, b) => a.childIds.length - b.childIds.length)
      .slice(0, surplus);
    const skipped = managers.filter((n) => !isTouchable(n, rootId) && n.childIds.length < SPAN.healthyMin);

    if (ranked.length === 0) {
      return empty(
        this.id,
        `${surplus} surplus management role${surplus === 1 ? "" : "s"} implied, but every candidate is protected or clinical.`,
        "All thin-span managers are guarded roles."
      );
    }

    const total = ranked.reduce((s, n) => s + annualCost(n), 0);

    return {
      playId: this.id,
      candidates: ranked.map((n) => ({
        positionId: n.id,
        title: n.title,
        department: n.department,
        rationale: `Carries ${n.childIds.length} report${n.childIds.length === 1 ? "" : "s"} — among the thinnest spans in the org.`,
        saving: annualCost(n),
      })),
      operations: ranked.map((n) => ({ kind: "remove" as const, positionId: n.id })),
      projectedSaving: total,
      savingNature: "cost-out",
      headcountDelta: -ranked.length,
      summary: `${managers.length} managers cover ${ics.length} individual contributors (1:${currentRatio.toFixed(1)}). A span of ${SPAN.healthyMax} implies ${requiredManagers} — a surplus of ${surplus}.`,
      method:
        `Required managers = ceil(${ics.length} individual contributors ÷ healthy max span of ${SPAN.healthyMax}) = ${requiredManagers}. The ${ranked.length} thinnest-span non-protected managers are the removal candidates; their reports re-parent upward. This is a top-down benchmark — treat it as the size of the prize, not a named list to action.`,
      guardrailNote: protectedSkipNote(skipped),
    };
  },
};

/* ------------------------------------------------------------------ */
/* 10. outsourced cluster in-housing                                   */
/* ------------------------------------------------------------------ */

const contractorInsourcing: ScenarioPlay = {
  id: "contractor-insourcing",
  name: "In-house outsourced service clusters",
  question: "Which outsourced services are now big enough to run cheaper in-house?",
  thesis:
    "Outsourcing a handful of roles is cheaper than managing them. Past a certain cluster size that flips, and the vendor margin becomes pure overhead — the trick is knowing where the line sits rather than in-housing everything.",
  lens: "Workforce mix",
  analyse(nodes) {
    const rootId = rootIdOf(nodes);
    const minSize = assumptions.outsourcingMinClusterSize;
    const marginRate = assumptions.outsourcingMarginRate;

    // A contingent role the org also employs permanently is a labour-rate
    // question, not an outsourcing one — that belongs to the agency-premium
    // play, and counting it here as well would bank the same money twice
    // under two different theories.
    const permanentBaseTitles = new Set(
      nodes.filter((n) => n.status === "filled").map((n) => baseTitle(n.title))
    );

    const clusters = new Map<string, LayoutNode[]>();
    let excludedAsAgency = 0;
    for (const n of nodes) {
      if (n.status !== "contingent") continue;
      if (permanentBaseTitles.has(baseTitle(n.title))) {
        excludedAsAgency++;
        continue;
      }
      const key = n.title.trim().toLowerCase();
      clusters.set(key, [...(clusters.get(key) ?? []), n]);
    }

    const qualifying = [...clusters.values()].filter((c) => c.length >= minSize);
    const belowScale = [...clusters.values()].filter((c) => c.length > 0 && c.length < minSize);

    if (qualifying.length === 0) {
      return empty(
        this.id,
        `No wholly outsourced service reaches the ${minSize}-role threshold where in-housing starts to pay.`,
        `Looked for clusters of ${minSize}+ contingent roles sharing a title with no permanent equivalent in the org.` +
          (excludedAsAgency > 0
            ? ` ${excludedAsAgency} contingent role${excludedAsAgency === 1 ? "" : "s"} the org also employs permanently were excluded — those are priced by the agency-premium play instead.`
            : "")
      );
    }

    const candidates: PlayCandidate[] = [];
    const operations: PlayOperation[] = [];
    const skipped: LayoutNode[] = [];

    for (const cluster of qualifying) {
      for (const n of cluster) {
        // Commercial mode, as with agency conversion: in-housing changes who
        // employs the cleaner, not whether the ward gets cleaned.
        if (!isTouchable(n, rootId, "commercial")) {
          skipped.push(n);
          continue;
        }
        const current = annualCost(n);
        const saving = current * marginRate;
        candidates.push({
          positionId: n.id,
          title: n.title,
          department: n.department,
          rationale: `Part of a ${cluster.length}-role ${n.title.toLowerCase()} cluster — above the ${minSize}-role in-housing threshold.`,
          saving,
        });
        operations.push({
          kind: "rebase",
          positionId: n.id,
          cost: (current * (1 - marginRate)) / (n.fte || 1),
          status: "filled",
          reason: `in-housed from a ${cluster.length}-role outsourced cluster`,
        });
      }
    }

    if (candidates.length === 0) {
      return empty(
        this.id,
        "Outsourced clusters found, but every role in them is protected or clinical.",
        "All candidates were guarded roles."
      );
    }

    const total = candidates.reduce((s, c) => s + c.saving, 0);
    const notes = [protectedSkipNote(skipped, "commercial")];
    if (belowScale.length > 0) {
      notes.push(
        `Left ${belowScale.length} smaller outsourced cluster${belowScale.length === 1 ? "" : "s"} alone — below ${minSize} roles, in-housing costs more in supervision than it saves in margin.`
      );
    }
    if (excludedAsAgency > 0) {
      notes.push(
        `Excluded ${excludedAsAgency} contingent role${excludedAsAgency === 1 ? "" : "s"} the org also employs permanently — those are priced by the agency-premium play, and counting them here too would bank the same saving twice.`
      );
    }

    return {
      playId: this.id,
      candidates: candidates.sort((a, b) => b.saving - a.saving),
      operations,
      projectedSaving: total,
      savingNature: "cost-rebase",
      headcountDelta: 0,
      summary: `${qualifying.length} outsourced service${qualifying.length === 1 ? "" : "s"} ${qualifying.length === 1 ? "has" : "have"} reached the scale where in-housing beats the vendor margin.`,
      method:
        `Saving is a stated ${(marginRate * 100).toFixed(0)}% vendor margin released on each in-housed role — not the role's whole cost, since the work and the people continue. Headcount is unchanged. Clusters below ${minSize} roles are deliberately excluded.`,
      guardrailNote: notes.filter(Boolean).join(" ") || null,
    };
  },
};

/* ------------------------------------------------------------------ */

export const SCENARIO_PLAYS: ScenarioPlay[] = [
  passThroughLayers,
  agencyPremium,
  thinSpanConsolidation,
  sharedService,
  wideSpanRedistribution,
  vacancyRationalisation,
  shadowRoles,
  deepChainCompression,
  managerRatio,
  contractorInsourcing,
];

export function getPlay(playId: string): ScenarioPlay | undefined {
  return SCENARIO_PLAYS.find((p) => p.id === playId);
}

/** Analyses one play against a set of positions. */
export function analysePlay(playId: string, positions: Position[], rootId: string | null): PlayAnalysis | null {
  const play = getPlay(playId);
  if (!play) return null;
  return play.analyse(tagNodes(positions, rootId));
}

/**
 * Analyses every play once — the Scenarios tab reads this to rank the
 * options. Returns play *metadata* rather than the play itself so the
 * result is safe to hand straight to a client component.
 */
export function analyseAllPlays(
  positions: Position[],
  rootId: string | null
): { play: PlayMeta; analysis: PlayAnalysis }[] {
  const nodes = tagNodes(positions, rootId);
  return SCENARIO_PLAYS.map((play) => ({ play: toMeta(play), analysis: play.analyse(nodes) }));
}

/** Guardrail-aware count used in the UI copy, kept here so the rule lives with the plays. */
export function protectedRoleCount(positions: Position[]): number {
  return positions.filter((p) => matchProtectedRole(p.title)).length;
}
