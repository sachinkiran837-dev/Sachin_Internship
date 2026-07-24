import Link from "next/link";
import { listOrgs } from "@/db/repo";
import { UploadForm } from "@/components/upload/UploadForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { hasAI } from "@/lib/ai/client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const orgs = await listOrgs();
  const aiEnabled = hasAI();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Atlas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          POC candidate — org-mapping and redesign scenario tool. Ingest an establishment export,
          explore and edit the structure, model a redesign, and get a plain-language read.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Running {aiEnabled ? "with" : "without"} AI-assisted classification and narrative.
          {!aiEnabled && " Set ANTHROPIC_API_KEY to enable it — deterministic fallbacks are in use."}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start a new establishment</CardTitle>
          <CardDescription>
            Every upload becomes its own org with a confirmed baseline graph.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm />
        </CardContent>
      </Card>

      {orgs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Existing establishments</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {orgs.map((org) => (
              <Link
                key={org.id}
                href={`/org/${org.id}`}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <span>{org.name}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(org.createdAt).toLocaleString()}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
