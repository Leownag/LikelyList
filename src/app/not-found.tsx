import { ButtonLink } from "@/components/ui";
import { PublicHeader } from "@/components/public-header";
import { PixelRule } from "@/components/pixel";
import { DEFAULT_LOCALE } from "@/lib/i18n/locales";
import { translator } from "@/lib/i18n/messages";

export const metadata = { title: "Not found" };

/**
 * The 404, in this site's clothes.
 *
 * Without this file Next serves its own unstyled page — white background, black
 * Helvetica, no header, no way back — which on a dark site reads as the whole
 * thing having crashed rather than as one bad address.
 *
 * Deliberately not `getT()`: a not-found render can be reached on a path Next is
 * free to render statically, and reading cookies there turns the page dynamic (or
 * throws). `translator(DEFAULT_LOCALE)` is pure over two static imports, which is
 * the same reason PublicHeader defaults its own `t` that way.
 */
export default function NotFound() {
  const t = translator(DEFAULT_LOCALE);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-10">
      <PublicHeader t={t} />

      <main className="mt-20 flex-1">
        <p className="label-pixel">404</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          {t("notFound.title")}
        </h1>
        <p className="mt-4 max-w-prose text-sm leading-relaxed text-muted">
          {t("notFound.body")}
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="/">{t("notFound.home")}</ButtonLink>
          <ButtonLink href="/explore" variant="outline">
            {t("common.explore")}
          </ButtonLink>
        </div>

        <PixelRule className="mt-12" />
      </main>
    </div>
  );
}
