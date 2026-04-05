import Link from "next/link";
import { auth0 } from "@/lib/auth0";

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Academic Copilot
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in with Auth0 to connect Canvas and ask about your day,
            assignments, and calendar.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <a
            href="/auth/login"
            className="rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-indigo-500"
          >
            Log in
          </a>
          <a
            href="/auth/login?screen_hint=signup"
            className="rounded-lg border border-zinc-700 px-4 py-3 text-center text-sm text-zinc-300 hover:bg-zinc-900"
          >
            Sign up
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col gap-8 px-6 py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Welcome</h1>
          <p className="mt-1 text-sm text-zinc-400">{session.user.email}</p>
        </div>
        <a
          href="/auth/logout"
          className="text-sm text-zinc-400 underline hover:text-zinc-200"
        >
          Log out
        </a>
      </header>
      <nav className="flex flex-col gap-3">
        <Link
          href="/onboarding"
          className="rounded-lg border border-zinc-700 bg-zinc-900/50 px-4 py-3 text-sm hover:bg-zinc-900"
        >
          Canvas setup →
        </Link>
        <Link
          href="/chat"
          className="rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-medium text-white hover:bg-indigo-500"
        >
          Open chat
        </Link>
      </nav>
    </main>
  );
}
