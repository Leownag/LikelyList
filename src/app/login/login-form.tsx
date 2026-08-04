"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { signInErrorMessage } from "@/lib/auth-error-message";
import { Button, Input, Label, Notice } from "@/components/ui";
import { useT } from "@/lib/i18n/client";
import { SLOT, interleave } from "@/lib/i18n/interleave";

/**
 * There is no such thing as registering for likelylist, and there is exactly one
 * way in: an emailed link.
 *
 * This is a newsletter, not a SaaS, and the audience arrives at the moment they
 * realise they missed a show — the worst possible moment to ask someone to invent
 * a password or to choose between sign-in methods. So: one field, one button, no
 * signin/signup distinction. The same form starts a subscription and resumes one.
 *
 * Passwords are gone rather than merely hidden. The anonymous subscribe flow
 * creates accounts with no password at all (lib/subscribe/anonymous.ts), so a
 * password form could never have let those subscribers in.
 *
 * Google is gone too. It was carried for one reason — a magic link opened in a
 * different browser than the one that requested it — and the token_hash flow in
 * /auth/callback solves that directly, server-side, with no code verifier to lose.
 * Keeping it meant a second identity provider, a Google Cloud OAuth client to
 * maintain, and a fork in the only screen that must never be confusing.
 */
export function LoginForm({
  next,
  initialError = null,
}: {
  next: string;
  /**
   * Set when /auth/callback bounced back here — nearly always an expired or
   * already-used link, which is a normal thing to happen and needs to be visible
   * next to the field that fixes it.
   */
  initialError?: string | null;
}) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [sent, setSent] = useState(false);

  async function sendLink(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // An address that has never been seen becomes a subscriber by clicking
        // the link, which is the same double opt-in the landing page does.
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (error) {
      // The raw fault stays in the console for whoever is debugging, and only the
      // reader-facing sentence goes on screen — Supabase's own wording blames the
      // address for problems that are ours (see signInErrorMessage).
      console.error("[SIGN_IN]", error);
      setError(signInErrorMessage(error));
      setBusy(false);
      return;
    }

    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("login.sent.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">
          {interleave(t("login.sent.body", { email: SLOT }), [
            <span key="email" className="text-text">
              {email}
            </span>,
          ])}
        </p>
        <div className="mt-8">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
          >
            {t("login.sent.other")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("login.title")}
      </h1>
      <p className="mt-2 text-sm text-muted">{t("login.body")}</p>

      <form onSubmit={sendLink} className="mt-8 space-y-4">
        <div>
          <Label htmlFor="email">{t("login.emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t("login.sending") : t("login.submit")}
        </Button>
      </form>

      <p className="mt-6 text-xs text-faint">{t("login.footnote")}</p>
    </div>
  );
}
