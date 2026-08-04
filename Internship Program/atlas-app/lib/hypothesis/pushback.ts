import type { Archetype } from "@/lib/hypothesis/archetypes";
import type { Hypothesis } from "@/lib/hypothesis/build";

/**
 * i2-consultant-briefing step 4: the objection the client's own people are
 * likely to raise, per archetype, grounded in the specific check that
 * answers it — never a generic rebuttal. Reuses G1's archetype library
 * rather than inventing a second taxonomy for this one skill.
 *
 * Templated, not a model call, for the same reason every other piece of
 * grounded narrative prose in this build is (see `lib/ai/client.ts`'s
 * `AiTier` doc comment for the full inventory of where a model is used
 * instead): a template parameterised only with the hypothesis's own
 * evidence can't invent an objection or answer the evidence doesn't
 * support, which a model asked to write persuasive prose could.
 */

export interface Pushback {
  objection: string;
  response: string;
}

const subject = (h: Hypothesis) => h.unit ?? "this reading";

const PUSHBACK: Record<Archetype, (h: Hypothesis) => Pushback> = {
  "excess-management-depth": (h) => ({
    objection: `"${subject(h)} genuinely needs that depth — the work is more complex than the layer count suggests."`,
    response: `Ask for the falsifier directly: ${h.falsifier} If a real decision surfaces at every layer named, this reading is wrong and the depth is a design choice, not drift.`,
  }),
  "parallel-corporate-functions": (h) => ({
    objection: `"That's a naming artefact, not real duplication — those two teams don't actually do the same thing."`,
    response: `This is exactly the check c2-duplication-detection is built to force before pricing anything: ${h.falsifier} Someone who knows both sites' day-to-day work is the only person who can settle it — that confirmation is the data ask, not a nice-to-have.`,
  }),
  "contingent-concentration": (h) => ({
    objection: `"That agency spend is genuine surge cover, not structural reliance — it comes and goes with demand."`,
    response: `Roster, vacancy and shift-fill data settles this either way: ${h.dataAsk} Until then, the reading holds because the share sits above the stated peer band on this org's own numbers, not on a guess about intent.`,
  }),
  "span-outliers": () => ({
    objection: `"That role is a roster lead running a clinical or frontline team, not a management span — the count is misleading."`,
    response: `Atlas already excludes roster leads from span-health flagging (A2's own exemption) before this reading is generated, so a genuine roster lead would not appear here at all. If it still does, that's a real finding worth raising, not this objection landing.`,
  }),
  "top-heavy-shape": (h) => ({
    objection: `"The seniority mix reflects genuinely more complex work in ${subject(h)}, not drift."`,
    response: `Test it the way the falsifier states: ${h.falsifier} A role-scope review is the fastest way to settle whether the grades match the complexity or just the tenure.`,
  }),
  "stacked-single-report-chains": (h) => ({
    objection: `"Those single-report roles are a career step someone is mid-way through, not a structural layer."`,
    response: `That distinction is already built into the reading's own conditions: ${h.conditions[0] ?? "a single report that is genuinely the whole team is treated differently from a pass-through layer."} Ask the specific question the falsifier names before removing anything: ${h.falsifier}`,
  }),
  "funded-vacancy-latency": (h) => ({
    objection: `"That vacancy is already being actively recruited — closing it now would be premature."`,
    response: `The data ask settles it directly: ${h.dataAsk} A vacancy genuinely in an active recruitment pipeline reads differently from one that's simply been open past the threshold with no movement.`,
  }),
  "classification-drift": (h) => ({
    objection: `"${subject(h)}'s higher grades are doing genuinely higher-grade work — the mix isn't drift."`,
    response: `${h.falsifier} A classification policy document, if one exists, settles this faster than a role-by-role argument.`,
  }),
  "fragmentation-overhead": (h) => ({
    objection: `"The part-time split in ${subject(h)} is a rostering or coverage requirement, not fragmentation for its own sake."`,
    response: `${h.falsifier} If a genuine coverage rule is driving it, that rule is the data ask: ${h.dataAsk}`,
  }),
  "key-person-exposure": (h) => ({
    objection: `"We already have a succession plan for that role — this isn't a real exposure."`,
    response: `${h.falsifier} Atlas can only see the org chart, not a handover plan — if one exists, that single confirmation resolves the flag.`,
  }),
  "control-gap": (h) => ({
    objection: `"That role is filled — it's just under a title your register doesn't recognise."`,
    response: `${h.falsifier} That's a five-minute confirmation with governance or compliance, and it either closes the gap or confirms it's real.`,
  }),
  "function-investment-variance": (h) => ({
    objection: `"That reference band doesn't fit how this organisation actually operates."`,
    response: `${h.falsifier} A stated service commitment for the function is the fastest way to test the band against reality rather than headcount alone.`,
  }),
};

const GENERIC_PUSHBACK = (h: Hypothesis): Pushback => ({
  objection: `"This doesn't reflect how ${subject(h)} actually works day to day."`,
  response: `The falsifier names exactly what would change that: ${h.falsifier}`,
});

/** Every thread gets at least one — the generic fallback is still evidence-grounded via the hypothesis's own falsifier, never boilerplate with nothing behind it. */
export function pushbackFor(h: Hypothesis): Pushback {
  const archetype = h.archetypes?.[0];
  const template = archetype ? PUSHBACK[archetype] : undefined;
  return (template ?? GENERIC_PUSHBACK)(h);
}
