"use client";

import { useActionState } from "react";
import type { ReactNode } from "react";
import { Button, StatusLine } from "@/components/ui";
import type { ScheduleState } from "./actions";

/**
 * The delivery form, wrapped so it can say whether the save landed.
 *
 * It was a bare `<form action={updateSchedule}>`: a full server round trip that
 * re-rendered the same fields with the same values and told the reader nothing
 * at all. Saving your timezone looked identical to not saving it.
 *
 * The fields arrive as `children` and stay server-rendered, so the message
 * catalogue is not dragged into the client bundle just to add a confirmation.
 * Only the labels this component says itself are passed in.
 *
 * A thrown error from the action would surface as Next's error boundary — a
 * blank screen for "that is not one of the offered hours" — so the action
 * returns its failures instead and they land in the status line.
 */
export function DeliveryForm({
  action,
  saveLabel,
  savingLabel,
  savedLabel,
  children,
  footer,
}: {
  action: (state: ScheduleState | null, formData: FormData) => Promise<ScheduleState>;
  saveLabel: string;
  savingLabel: string;
  savedLabel: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-5">
      {children}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending}>
          {pending ? savingLabel : saveLabel}
        </Button>
        {footer}
      </div>

      <StatusLine tone={state && !state.ok ? "error" : "success"}>
        {pending ? null : state ? (state.ok ? savedLabel : state.message) : null}
      </StatusLine>
    </form>
  );
}
