"use client";

import { useEffect, useRef, useState } from "react";
import { Button, StatusLine } from "@/components/ui";
import { useDetectedTimezone } from "@/lib/use-detected-region";
import { TIMEZONE_LABELS, type TIMEZONES } from "@/lib/time";
import { adoptDetectedTimezone } from "./settings/actions";

type Zone = (typeof TIMEZONES)[number];

/**
 * Adopts the browser's timezone for a profile that has never had one chosen.
 *
 * `profiles.timezone` defaults to America/New_York, and requireProfile creates a
 * row with only an id and an email — so every account made by signing in, rather
 * than through the subscribe box, was Eastern regardless of where its reader
 * was. For somebody in Seattle that is a 5am email, and nothing in the product
 * ever said so.
 *
 * Renders nothing. The server action it calls writes only while the stored value
 * is still that default, so this cannot move a timezone somebody has set.
 */
export function AdoptDetectedTimezone({ current }: { current: string }) {
  const detected = useDetectedTimezone();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current || detected === current) return;
    sent.current = true;
    void adoptDetectedTimezone(detected);
  }, [detected, current]);

  return null;
}

/**
 * Offers the browser's timezone to an account that is still on the default.
 *
 * The silent adoption above only fires for a profile being created. An account
 * that predates it is already sitting on Eastern, and changing that without
 * asking would be presumptuous — it is a real setting by then, even if nobody
 * chose it. So this asks, once, where the setting is.
 */
export function OfferDetectedTimezone({ current }: { current: Zone }) {
  const detected = useDetectedTimezone();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nothing to offer when the guess agrees, or once it has been taken.
  if (done || detected === current) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <StatusLine>
        {`Your browser says ${TIMEZONE_LABELS[detected as Zone] ?? detected}.`}
      </StatusLine>
      <Button
        type="button"
        variant="ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await adoptDetectedTimezone(detected);
          setDone(true);
          setBusy(false);
        }}
      >
        Use that
      </Button>
    </div>
  );
}
