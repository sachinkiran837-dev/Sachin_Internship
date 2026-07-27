import Link from "next/link";

/**
 * The tractin.com chrome: a sticky white bar, brand mark hard left, and the
 * product name set off from it — so Atlas reads as a Tract In tool rather
 * than a standalone app.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-4 px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-[5px] bg-primary text-[15px] font-bold leading-none text-primary-foreground"
          >
            t
          </span>
          <span className="text-lg font-bold tracking-tight text-primary">Tract In</span>
        </Link>

        <span aria-hidden className="h-5 w-px bg-border" />

        <div className="flex min-w-0 items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">Atlas</span>
          <span className="hidden truncate text-sm text-muted-foreground sm:inline">
            Establishment mapping
          </span>
        </div>

        <span className="ml-auto hidden rounded-full border px-2.5 py-1 text-xs font-medium text-muted-foreground md:inline">
          POC candidate
        </span>
      </div>
    </header>
  );
}
