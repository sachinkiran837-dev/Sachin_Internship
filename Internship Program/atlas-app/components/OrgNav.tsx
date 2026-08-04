import Link from "next/link";

export function OrgNav({ orgId, active }: { orgId: string; active: string }) {
  const tabs = [
    { key: "confirm", label: "Confirm ingest", href: `/org/${orgId}` },
    { key: "data", label: "Canonical table", href: `/org/${orgId}/data` },
    { key: "map", label: "Establishment map", href: `/org/${orgId}/map` },
    { key: "findings", label: "Findings", href: `/org/${orgId}/findings` },
    { key: "scenarios", label: "Scenarios", href: `/org/${orgId}/scenarios` },
    { key: "board-pack", label: "Board pack", href: `/org/${orgId}/board-pack` },
    { key: "consultant-briefing", label: "Consultant briefing", href: `/org/${orgId}/consultant-briefing` },
    { key: "ask", label: "Ask Atlas", href: `/org/${orgId}/ask` },
  ];

  return (
    <nav className="sticky top-16 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-7xl gap-1 px-6">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`-mb-px border-b-2 px-3 py-3 text-sm transition-colors ${
              active === tab.key
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
