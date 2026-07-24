import Link from "next/link";

export function OrgNav({ orgId, active }: { orgId: string; active: string }) {
  const tabs = [
    { key: "confirm", label: "Confirm ingest", href: `/org/${orgId}` },
    { key: "map", label: "Establishment map", href: `/org/${orgId}/map` },
    { key: "scenarios", label: "Scenarios", href: `/org/${orgId}/scenarios` },
    { key: "findings", label: "Findings", href: `/org/${orgId}/findings` },
  ];

  return (
    <nav className="flex gap-1 border-b px-6">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`border-b-2 px-3 py-3 text-sm ${
            active === tab.key
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
