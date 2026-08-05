"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Findings is `force-dynamic`, so the server always recomputes it from
 * whatever's in the database — but a client-side Link visit can still be
 * served out of Next's router cache rather than hitting the server again.
 * This is the explicit escape hatch: `router.refresh()` forces the request,
 * so a context change made on the confirm screen, the canonical table or the
 * map a moment ago is guaranteed to be reflected here, not just eventually.
 */
export function RefreshFindingsButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <RefreshCw className={`size-4 ${pending ? "animate-spin" : ""}`} aria-hidden />
      Refresh findings based on the latest dataset and context changes
    </Button>
  );
}
