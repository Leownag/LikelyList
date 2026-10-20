import { ButtonLink } from "@/components/ui";
import { Wordmark } from "@/components/wordmark";
import { LanguageSwitch } from "@/components/language-switch";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { translator, type Translate } from "@/lib/i18n/messages";

/**
 * The header on the pages anyone can reach: /, /explore and /privacy.
 *
 * No primary button here on purpose. Each of these pages has its own single primary
 * action — the subscribe box, the search, the policy itself — and a header CTA pointing
 * at /login was competing with it, offering a longer path to the same thing.
 *
 * `signedIn` is deliberately three-valued. Omitted means "this page did not ask", which
 * is how /privacy renders no session-dependent link at all: getUser() is a Supabase
 * round-trip per view, and a legal document does not need to know who is reading it.
 *
 * `t` defaults to English rather than calling getT() so that a caller who has no locale
 * in hand does not have to read cookies to render a header. `translator` is pure over two
 * static imports.
 */
export function PublicHeader({
  current,
  signedIn,
  t = translator(DEFAULT_LOCALE),
}: {
  /** The page this header is on, so it does not link to itself. */
  current?: "home" | "explore";
  signedIn?: boolean;
  t?: Translate;
}) {
  return (
    // No width or padding class: each page's shell owns its own measure, and they
    // disagree — /privacy is max-w-2xl where the other two are max-w-3xl.
    <header className="flex items-center justify-between">
      <Wordmark href={current === "home" ? null : "/"} />
      <nav className="flex items-center gap-2">
        <LanguageSwitch className="mr-1" />
        {current === "explore" ? null : (
          <ButtonLink href="/explore" variant="ghost">
            {t("common.explore")}
          </ButtonLink>
        )}
        {signedIn === undefined ? null : signedIn ? (
          <ButtonLink href="/app" variant="ghost">
            {/* Labelled for where it actually goes. It said nav.feed ("My feed")
                while pointing at the overview, so the one link a signed-in reader
                sees on a public page named a different page than it opened. */}
            {t("nav.overview")}
          </ButtonLink>
        ) : (
          <ButtonLink href="/login" variant="ghost">
            {t("common.signIn")}
          </ButtonLink>
        )}
      </nav>
    </header>
  );
}
