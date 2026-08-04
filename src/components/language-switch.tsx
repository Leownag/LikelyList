"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT, isLocale } from "@/lib/i18n/locales";
import { useLocale } from "@/lib/i18n/client";

/**
 * EN / 中文, in the header.
 *
 * Two locales, so this is a pair of links rather than a dropdown: a `<select>` for two
 * options costs a click and a menu to say what two words already say.
 *
 * Client-side only because it needs the current path to come back to. The links go through
 * /lang, which sets the cookie and redirects — so the choice survives the next navigation,
 * which `?lang=` on one link would not.
 */
export function LanguageSwitch({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromContext = useLocale();

  // `?lang=` wins over the provider, because the landing page honours it per request for
  // crawlability (see localePath in lib/site-url) while the provider only ever sees the
  // cookie — a layout cannot read search params. Without this, /?lang=zh-Hant serves
  // Chinese copy under a highlighted "EN".
  const fromQuery = searchParams.get("lang");
  const current = isLocale(fromQuery) ? fromQuery : fromContext;

  const params = searchParams.toString();
  const next = params ? `${pathname}?${params}` : pathname;

  return (
    <div className={`flex items-center ${className}`} role="group" aria-label="Language">
      {LOCALES.map((locale) =>
        locale === current ? (
          <span
            key={locale}
            aria-current="true"
            lang={locale}
            className="border border-accent px-2 py-1 text-xs text-text"
          >
            {LOCALE_SHORT[locale]}
          </span>
        ) : (
          <a
            key={locale}
            href={`/lang?to=${locale}&next=${encodeURIComponent(next)}`}
            lang={locale}
            hrefLang={locale}
            // The full name is the accessible name; the two characters are for the eye.
            aria-label={LOCALE_LABELS[locale]}
            className="border border-border px-2 py-1 text-xs text-muted hover:border-accent hover:text-text"
          >
            {LOCALE_SHORT[locale]}
          </a>
        ),
      )}
    </div>
  );
}
