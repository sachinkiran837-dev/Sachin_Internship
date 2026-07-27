/**
 * Deletes establishments and everything hanging off them. The verification
 * scripts each create a real org in the real database, so a few runs leave
 * the home page listing a dozen "verify-run"s — this is how they get cleared.
 *
 * Nothing is deleted without being listed first. There are no cascading
 * foreign keys in the schema, so the children are removed explicitly.
 *
 *   npx tsx --env-file=.env.local scripts/delete-orgs.ts              # list only
 *   npx tsx --env-file=.env.local scripts/delete-orgs.ts <id> [<id>…] # delete those
 *   npx tsx --env-file=.env.local scripts/delete-orgs.ts --all        # delete every org
 *
 * Ids may be given in full or as the short prefix the listing shows.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { auditLog, ingestIssues, orgs, positions, scenarios } from "../db/schema";

async function main() {
  const args = process.argv.slice(2);
  const all = await db.select().from(orgs);

  if (args.length === 0) {
    console.log(`${all.length} establishment${all.length === 1 ? "" : "s"}:\n`);
    for (const o of all) {
      console.log(`  ${o.id}  ${o.createdAt.slice(0, 16)}  ${o.name}`);
    }
    console.log(`\nPass ids (or --all) to delete. Nothing has been deleted.`);
    return;
  }

  const targets = args.includes("--all")
    ? all
    : all.filter((o) => args.some((a) => o.id === a || o.id.startsWith(a)));

  const unmatched = args.filter(
    (a) => a !== "--all" && !all.some((o) => o.id === a || o.id.startsWith(a))
  );
  if (unmatched.length > 0) {
    throw new Error(`No establishment matches: ${unmatched.join(", ")}`);
  }
  if (targets.length === 0) {
    console.log("Nothing to delete.");
    return;
  }

  console.log(`Deleting ${targets.length} establishment${targets.length === 1 ? "" : "s"}:`);
  for (const o of targets) console.log(`  ${o.id.slice(0, 8)}  ${o.name}`);

  const orgIds = targets.map((o) => o.id);
  const scenarioRows = await db.select().from(scenarios).where(inArray(scenarios.orgId, orgIds));

  if (scenarioRows.length > 0) {
    await db.delete(auditLog).where(
      inArray(auditLog.scenarioId, scenarioRows.map((s) => s.id))
    );
  }
  await db.delete(scenarios).where(inArray(scenarios.orgId, orgIds));
  await db.delete(ingestIssues).where(inArray(ingestIssues.orgId, orgIds));
  await db.delete(positions).where(inArray(positions.orgId, orgIds));

  for (const id of orgIds) {
    await db.delete(orgs).where(eq(orgs.id, id));
  }

  const left = (await db.select().from(orgs)).length;
  console.log(`\nDone. ${left} establishment${left === 1 ? "" : "s"} remaining.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
