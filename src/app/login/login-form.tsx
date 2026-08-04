"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button, Input, Label, Notice } from "@/components/ui";
import { PixelRule } from "@/components/pixel";

type Mode = "signin" | "signup";

export function LoginForm({ initialMode }: { initialMode: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Same-origin so this works unchanged on localhost and on whatever
        // domain the app ends up deployed to.
        redirectTo: `${window.location.origin}/auth/callback?next=/app`,
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
    }
    // On success the browser is navigating away; leave `busy` set.
  }

  async function submitEmail(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=/app`,
        },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      // With email confirmation enabled there is no session yet; with it
      // disabled there is one and we can go straight in.
      if (data.session) {
        router.replace("/app");
        return;
      }
      setNotice(
        "Check your inbox for a confirmation link. You can close this page.",
      );
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    // Full refresh so the server re-reads the freshly set auth cookie.
    router.replace("/app");
    router.refresh();
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === "signup" ? "Start following shows" : "Welcome back"}
      </h1>
      <p className="mt-2 text-sm text-muted">
        {mode === "signup"
          ? "One email every Friday. Unsubscribe in one click, any time."
          : "Sign in to manage your cities, genres and feeds."}
      </p>

      <div className="mt-8">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={signInWithGoogle}
        >
          Continue with Google
        </Button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <PixelRule />
        <span className="label-pixel shrink-0">or</span>
        <PixelRule />
      </div>

      <form onSubmit={submitEmail} className="space-y-4">
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
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "At least 8 characters" : ""}
          />
        </div>

        {error ? <Notice tone="error">{error}</Notice> : null}
        {notice ? <Notice>{notice}</Notice> : null}

        <Button type="submit" className="w-full" disabled={busy}>
          {busy
            ? "Working…"
            : mode === "signup"
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        {mode === "signup" ? "Already have an account? " : "No account yet? "}
        <button
          type="button"
          className="text-accent underline hover:text-white"
          onClick={() => {
            setMode(mode === "signup" ? "signin" : "signup");
            setError(null);
            setNotice(null);
          }}
        >
          {mode === "signup" ? "Sign in" : "Create one"}
        </button>
      </p>
    </div>
  );
}
