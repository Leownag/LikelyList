/**
 * Where a chosen language is remembered.
 *
 * A cookie rather than `?lang=` on every link, which is what the email-landing pages use:
 * those are opened once from a mail client and have no session to speak of, but somebody
 * browsing the app would otherwise lose their language on the first link that forgot to
 * carry the parameter.
 *
 * Not HttpOnly, on purpose — nothing secret is in it, and the browser bundle reads it to
 * pick the initial locale before hydration.
 */
export const LOCALE_COOKIE = "likelylist_lang";

/** A year: this is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
