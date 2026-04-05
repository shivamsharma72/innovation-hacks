import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import AppLayout from "@/components/layout/AppLayout";
import { OnboardingForm } from "./ui";

export default async function OnboardingPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const gateway = process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_URL;
  let initialComplete = false;
  if (gateway) {
    try {
      const token = await auth0.getAccessToken();
      const accessToken = typeof token === "string" ? token : token?.token ?? null;
      if (accessToken) {
        const res = await fetch(`${gateway}/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as { onboarding_complete?: boolean };
          initialComplete = Boolean(data.onboarding_complete);
        }
      }
    } catch {
      // gateway may be down during dev
    }
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-lg px-6 py-10">
        <h1 className="text-xl font-semibold text-white mb-2">Setup</h1>

        <section className="mt-6">
          <h2 className="text-base font-medium text-zinc-200">Google Workspace</h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            Open your Workspace MCP URL (e.g. <code className="text-zinc-300">http://localhost:8002</code>) and
            complete OAuth there. No extra step needed here.
          </p>
        </section>

        <section className="mt-8">
          <h2 className="text-base font-medium text-zinc-200">Canvas LMS</h2>
          <p className="mt-1.5 text-sm text-zinc-400">
            Create a personal access token in Canvas (Account → Settings → New Access Token). Use your
            school&apos;s Canvas hostname, e.g.{" "}
            <code className="text-zinc-300">canvas.asu.edu</code>.
          </p>
          <div className="mt-6">
            <OnboardingForm initiallyComplete={initialComplete} />
          </div>
        </section>
      </div>
    </AppLayout>
  );
}
