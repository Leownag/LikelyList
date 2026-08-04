"use client";

import { useState } from "react";
import { Button, Card, Input, Label, Notice } from "@/components/ui";

/**
 * Two-step deletion: expand, then type the word.
 *
 * Deliberately more friction than a confirm dialog, because this is the one
 * action in the app that cannot be undone.
 */
export function DeleteAccount({
  action,
}: {
  action: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");

  if (!open) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <p className="text-sm text-muted">
          Everything goes: profile, followed cities and genres, learned artists,
          and every feed you&apos;ve added.
        </p>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete my account
        </Button>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <Notice tone="error">
        This is permanent. There is no export and no undo.
      </Notice>

      <form action={action} className="mt-5 space-y-4">
        <div>
          <Label htmlFor="confirm">
            Type DELETE to confirm
          </Label>
          <Input
            id="confirm"
            name="confirm"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="off"
            placeholder="DELETE"
            className="max-w-xs"
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="danger"
            disabled={confirm.trim().toLowerCase() !== "delete"}
          >
            Delete permanently
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              setConfirm("");
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
