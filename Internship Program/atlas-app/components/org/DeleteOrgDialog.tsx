"use client";

import { useActionState, useState } from "react";
import { Trash2 } from "lucide-react";
import { deleteOrgAction, type DeleteOrgState } from "@/app/actions/org";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Deletes an establishment permanently — the positions, every derived
 * reading, the uploaded files, all of it. There is no undo, so the button
 * that does it asks for the establishment's own name back before it will
 * submit, the same bar a hosting console holds a project deletion to.
 */

const INITIAL: DeleteOrgState = { error: null };

export function DeleteOrgDialog({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [state, formAction, pending] = useActionState(deleteOrgAction, INITIAL);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const confirmed = typed === orgName;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Delete ${orgName}`}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Trash2 className="size-4 text-muted-foreground hover:text-destructive" aria-hidden />
      </DialogTrigger>

      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Delete &ldquo;{orgName}&rdquo;?</DialogTitle>
          <DialogDescription>
            This removes the establishment, every position in it, everything Atlas has read or
            found from it, and the files it was built from. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="orgId" value={orgId} />
          <label className="flex flex-col gap-1.5 text-sm">
            Type <span className="font-medium">{orgName}</span> to confirm
            <input
              name="confirmName"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          {state.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
