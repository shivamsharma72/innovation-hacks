import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { OnboardingForm } from "./ui";

export default async function OnboardingPage() {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }

  const gateway = process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_URL;
  let initialComplete = false;
  if (gateway) {
    try {
      const token = await auth0.getAccessToken();
      const accessToken =
        typeof token === "string" ? token : token?.token ?? null;
      if (accessToken) {
        const res = await fetch(`${gateway}/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as {
            onboarding_complete?: boolean;
          };
          initialComplete = Boolean(data.onboarding_complete);
        }
      }
    } catch {
      /* gateway may be down during dev */
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <Link
        href="/"
        className="text-sm text-zinc-500 hover:text-zinc-300"
      >
        ← Home
      </Link>

      <h1 className="mt-8 text-xl font-semibold">Google (Calendar, Gmail, …)</h1>
      <p className="mt-2 text-sm text-zinc-400">
        One sign-in for all Google Workspace tools used in chat: open your{" "}
        <strong className="text-zinc-300">Workspace MCP</strong> URL (e.g.{" "}
        <code className="text-zinc-300">http://localhost:8002</code> when using
        Docker) and complete OAuth there. No separate “Connect Calendar” step in
        this app.
      </p>

      <h1 className="mt-10 text-xl font-semibold">Canvas connection</h1>
      <p className="mt-2 text-sm text-zinc-400">
        Create a personal access token in Canvas (Account → Settings → New
        Access Token). Use your school&apos;s Canvas hostname, e.g.{" "}
        <code className="text-zinc-300">school.instructure.com</code>.
      </p>
      <div className="mt-8">
        <OnboardingForm initiallyComplete={initialComplete} />
      </div>
    </main>
  );
}
