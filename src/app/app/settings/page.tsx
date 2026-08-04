import { requireProfile } from "@/lib/supabase/server";
import { Button, Card, Label, Notice, SectionHeading, Select } from "@/components/ui";
import { TIMEZONES, nextWeekdayAt } from "@/lib/time";
import { deleteAccount, updateSchedule } from "./actions";
import { DeleteAccount } from "./delete-account";
import { getI18n, getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/locales";

export async function generateMetadata() {
  return { title: (await getT())("title.settings") };
}

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

export default async function SettingsPage() {
  const { profile } = await requireProfile();
  const { locale, t } = await getI18n();

  const nextSend = nextWeekdayAt(
    new Date(),
    profile.timezone,
    5,
    profile.digest_send_hour,
  );

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading hint={t("settings.delivery.hint")}>
          {t("settings.delivery.heading")}
        </SectionHeading>
        <Card className="p-5">
          <form action={updateSchedule} className="space-y-5">
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="timezone">{t("settings.timezone")}</Label>
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
                <Label htmlFor="digest_send_hour">{t("settings.sendAround")}</Label>
                <Select
                  id="digest_send_hour"
                  name="digest_send_hour"
                  defaultValue={String(profile.digest_send_hour)}
                >
                  {HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {formatHour(hour, locale)}
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
                {t("settings.enabled")}
                <span className="mt-1 block text-xs text-muted">
                  {t("settings.enabled.hint")}
                </span>
              </span>
            </label>

            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit">{t("common.save")}</Button>
              <p className="text-xs text-faint">
                {t("settings.next", {
                  when: formatNext(nextSend, profile.timezone, locale),
                })}
              </p>
            </div>
          </form>

          <div className="mt-5">
            <Notice>{t("settings.drift")}</Notice>
          </div>
        </Card>
      </section>

      <section>
        <SectionHeading hint={t("settings.account.hint")}>
          {t("settings.account.heading")}
        </SectionHeading>
        <Card className="p-5">
          <p className="font-mono text-sm">{profile.email}</p>
        </Card>
      </section>

      <section>
        <SectionHeading hint={t("settings.delete.hint")}>
          {t("settings.delete.heading")}
        </SectionHeading>
        <DeleteAccount action={deleteAccount} />
      </section>
    </div>
  );
}

function formatHour(hour: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    hour: "numeric",
    hour12: true,
  }).format(new Date(Date.UTC(2000, 0, 1, hour)));
}

function formatNext(at: Date, timezone: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}
