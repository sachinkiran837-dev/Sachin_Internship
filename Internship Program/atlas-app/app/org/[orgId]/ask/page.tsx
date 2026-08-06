import { notFound } from "next/navigation";
import { getOrg } from "@/db/repo";
import { OrgNav } from "@/components/OrgNav";
import { AskAtlasForm } from "@/components/ask/AskAtlasForm";

export const dynamic = "force-dynamic";

/**
 * i3-ask-atlas-interpretation: a bounded conversational surface over Atlas's
 * named engine tools — one per built skill with a genuine standalone
 * question to answer — plus h1's redesign-pattern compiler. Never a general
 * chatbot, and never a number the model composed: a model may pick which
 * tool ran or phrase the sentence around what it returned, never invent a
 * figure of its own. See lib/ask/interpret.ts for the actual compilation
 * logic and its own note on how each of those three roles stays bounded.
 */
export default async function AskPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const org = await getOrg(orgId);
  if (!org) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <OrgNav orgId={orgId} active="ask" />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-8">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-dot" aria-hidden />
            Ask Atlas
          </p>
          <h1 className="mt-1 text-2xl">A bounded question, not an open chat</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            Every answer traces to a named engine call — shown as the tool trace below it. A question or
            instruction Atlas doesn&rsquo;t recognise gets an honest &ldquo;can&rsquo;t compile&rdquo; and the
            nearest thing it can do instead, never a guess.
          </p>
        </div>

        <AskAtlasForm orgId={orgId} />
      </main>
    </div>
  );
}
