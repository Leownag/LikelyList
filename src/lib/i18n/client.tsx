"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { DEFAULT_LOCALE, type Locale } from "./locales";
import { translator, type Translate } from "./messages";

/**
 * The locale, for the half of the UI that runs in the browser.
 *
 * The server resolves it once (see server.ts) and hands it down through this provider, so
 * a client component never re-derives it and there is no flash of the wrong language.
 *
 * The catalogue itself is imported rather than passed through props: it is a plain object
 * of two locales, so shipping it costs a few KB and saves serialising the whole thing
 * into the RSC payload of every page.
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return <LocaleContext value={locale}>{children}</LocaleContext>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

/** `const t = useT()`, then `t("some.key")`. */
export function useT(): Translate {
  const locale = useLocale();
  return useMemo(() => translator(locale), [locale]);
}
