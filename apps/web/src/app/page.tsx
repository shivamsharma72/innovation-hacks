import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Academic Copilot</h1>
          <p className="mt-2 text-sm text-zinc-400">
            AI-powered assistant for Canvas LMS, Google Workspace, and your academic life.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <a
            href="/auth/login"
            className="rounded-xl bg-indigo-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
          >
            Log in
          </a>
          <a
            href="/auth/login?screen_hint=signup"
            className="rounded-xl border border-zinc-700 px-4 py-3 text-center text-sm text-zinc-300 hover:bg-zinc-900 transition-colors"
          >
            Sign up
          </a>
        </div>
      </main>
    );
  }

  // Authenticated users go straight to dashboard
  redirect("/dashboard");
}
