import { redirect } from "next/navigation";
import { getUser } from "@/lib/supabase/server";
import { PixelMosaic } from "@/components/pixel";
import { Wordmark } from "@/components/wordmark";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — likelylist" };

export default async function LoginPage({
  searchParams,
}: PageProps<"/login">) {
  if (await getUser()) redirect("/app");

  const params = await searchParams;
  const mode = params.mode === "signup" ? "signup" : "signin";

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-10 flex items-center justify-between">
        <Wordmark />
        <PixelMosaic seed="likelylist-login" cols={5} rows={3} cell={8} density={0.4} />
      </div>
      <LoginForm initialMode={mode} />
    </main>
  );
}
