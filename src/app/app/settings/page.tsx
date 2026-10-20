import { requireProfile } from "@/lib/supabase/server";
import { Card, Label, Notice, SectionHeading, Select } from "@/components/ui";
import {
  DIGEST_SEND_HOURS,
  DIGEST_WEEKDAY,
  TIMEZONES,
  TIMEZONE_LABELS,
  morningSendHour,
  supportedTimezone,
  nextWeekdayAt,
} from "@/lib/time";
import { deleteAccount, updateSchedule } from "./actions";
import { DeliveryForm } from "./delivery-form";
import { DeleteAccount } from "./delete-account";
import { getI18n, getT } from "@/lib/i18n/server";
import type { Locale } from "@/lib/i18n/locales";

export async function generateMetadata() {
  return { title: (await getT())("title.settings") };
}

export default async function SettingsPage() {
  const { profile } = await requireProfile();
  const { locale, t } = await getI18n();

  // Clamped for display as well as for sending, so the select cannot fall back
  // to its first option on a profile whose stored hour predates the morning
  // window and then silently save that instead.
  const sendHour = morningSendHour(profile.digest_send_hour);
  const timezone = supportedTimezone(profile.timezone);

  const nextSend = nextWeekdayAt(new Date(), timezone, DIGEST_WEEKDAY, sendHour);

  return (
    <div className="space-y-10">
      <section>
        <SectionHeading hint={t("settings.delivery.hint")}>
          {t("settings.delivery.heading")}
        </SectionHeading>
        <Card className="p-5">
          <DeliveryForm
            action={updateSchedule}
            saveLabel={t("common.save")}
            savingLabel={t("common.saving")}
            savedLabel={t("settings.saved")}
            footer={
              <p className="text-xs text-faint">
                {t("settings.next", {
                  when: formatNext(nextSend, timezone, locale),
                })}
              </p>
            }
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="timezone">{t("settings.timezone")}</Label>
                <Select
                  id="timezone"
                  name="timezone"
                  defaultValue={timezone}
                >
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {TIMEZONE_LABELS[zone]}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="digest_send_hour">{t("settings.sendAround")}</Label>
                <Select
                  id="digest_send_hour"
                  name="digest_send_hour"
                  defaultValue={String(sendHour)}
                >
                  {DIGEST_SEND_HOURS.map((hour) => (
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

          </DeliveryForm>

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
    // No minutes: Cloudflare spreads a trigger across its hour, which the
    // drift notice below this form says outright.
    timeZoneName: "short",
  }).format(at);
}
