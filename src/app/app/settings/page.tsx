import { requireProfile } from "@/lib/supabase/server";
import { Button, Card, Label, Notice, SectionHeading, Select } from "@/components/ui";
import { TIMEZONES, nextWeekdayAt } from "@/lib/time";
import { deleteAccount, updateSchedule } from "./actions";
import { DeleteAccount } from "./delete-account";

export const metadata = { title: "Settings — likelylist" };

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default async function SettingsPage() {
  const { profile } = await requireProfile();

  const nextSend = nextWeekdayAt(
    new Date(),
    profile.timezone,
    5,
    profile.digest_send_hour,
  );

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading hint="The weekly job runs at a fixed UTC time; delivery is then released when your own local clock reaches this hour, which is what keeps it in the morning through daylight saving.">
          Delivery
        </SectionHeading>
        <Card className="p-5">
          <form action={updateSchedule} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="timezone">Timezone</Label>
                <Select
                  id="timezone"
                  name="timezone"
                  defaultValue={profile.timezone}
                >
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace(/_/g, " ")}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="digest_send_hour">Send around</Label>
                <Select
                  id="digest_send_hour"
                  name="digest_send_hour"
                  defaultValue={String(profile.digest_send_hour)}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHour(hour)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                name="digest_enabled"
                defaultChecked={profile.digest_enabled}
                className="mt-0.5 accent-accent"
              />
              <span>
                Send me the weekly digest
                <span className="mt-1 block text-xs text-muted">
                  Unchecking this is the same as unsubscribing from the email.
                  Nothing you&apos;ve followed is lost.
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit">Save</Button>
              <p className="text-xs text-faint">
                Next: {formatNext(nextSend, profile.timezone)}
              </p>
            </div>
          </form>

          <div className="mt-5">
            <Notice>
              Cloudflare spreads scheduled work across the hour it is triggered
              in, so the exact minute drifts. &ldquo;Friday morning&rdquo; is
              reliable; a precise time is not.
            </Notice>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading hint="Your address, as used for sign-in and delivery.">
          Account
        </SectionHeading>
        <Card className="p-5">
          <p className="font-mono text-sm">{profile.email}</p>
        </Card>
      </section>

      <section>
        <SectionHeading hint="Removes your profile, subscriptions, genres, artists and feeds. This cannot be undone.">
          Delete account
        </SectionHeading>
        <DeleteAccount action={deleteAccount} />
      </section>
    </div>
  );
}

function formatHour(hour: number): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    hour: "numeric",
    hour12: true,
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
}

function formatNext(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}
