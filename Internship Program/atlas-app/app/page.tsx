import Link from "next/link";
import { listOrgs } from "@/db/repo";
import { UploadForm } from "@/components/upload/UploadForm";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeleteOrgDialog } from "@/components/org/DeleteOrgDialog";

export const dynamic = "force-dynamic";

export default async function Home() {
  const orgs = await listOrgs();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-14">
      <div>
        <p className="eyebrow mb-3">
          <span className="eyebrow-dot" aria-hidden />
          Establishment mapping
        </p>
        <h1 className="text-4xl">Map the org. Model the redesign.</h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          Ingest an establishment export in any format, explore and edit the structure, model a
          redesign against real cost and safe-staffing guardrails, and get a plain-language read.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Start a new establishment</CardTitle>
          <CardDescription>
            Hand over the files — Atlas works out what each one is. Every upload becomes its own
            org with a confirmed baseline graph.
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
              <div
                key={org.id}
                className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent"
              >
                <Link href={`/org/${org.id}`} className="flex flex-1 items-center justify-between gap-2">
                  <span>{org.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(org.createdAt).toLocaleString()}
                  </span>
                </Link>
                <DeleteOrgDialog orgId={org.id} orgName={org.name} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
