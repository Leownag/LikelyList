import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { PixelMosaic } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { siteUrlFromEnv } from "@/lib/site-url";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — likelylist" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  const params = await searchParams;

  // `?mode=signup` is accepted and ignored. There is one form now, but that
  // parameter is already sitting in sent emails and in whatever links exist in
  // the wild, and they should land somewhere useful rather than 404.
  //
  // `next` is sanitised here rather than trusted, because it ends up in the
  // redirect target handed to Supabase.
  const next = safeRedirectPath(
    typeof params.next === "string" ? params.next : null,
    siteUrlFromEnv(),
  );

  // Every in-app link in the digest points here so that `next` survives the
  // sign-in, which means a reader who still has a session must be forwarded on
  // rather than shown a form — and forwarded to `next`, not to a hardcoded /app.
  if (await getUser()) redirect(next);

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <Wordmark />
        <PixelMosaic seed="likelylist-login" cols={5} rows={3} cell={8} density={0.4} />
      </div>
      <LoginForm
        next={next}
        initialError={typeof params.error === "string" ? params.error : null}
      />
    </main>
  );
}
