"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Notice } from "@/components/ui";

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
      setError(error.message);
      setBusy(false);
      return;
    }

    setSent(true);
    setBusy(false);
  }

  if (sent) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-2 text-sm text-muted">
          We sent a sign-in link to{" "}
          <span className="text-text">{email}</span>. It works once and expires
          in an hour. You can close this page.
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
            Use a different address
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        Your Friday email
      </h1>
      <p className="mt-2 text-sm text-muted">
        Enter your address and we&apos;ll email you a link — whether you&apos;re
        starting the digest or coming back to change what it covers. No password
        to remember.
      </p>

      <form onSubmit={sendLink} className="mt-8 space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
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
          {busy ? "Sending…" : "Email me a link"}
        </Button>
      </form>

      <p className="mt-6 text-xs text-faint">
        One email every Friday. One-click unsubscribe, any time.
      </p>
    </div>
  );
}
