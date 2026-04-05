import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import AppLayout from "@/components/layout/AppLayout";
import { InsightsClient } from "./ui";

export default async function InsightsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  return (
    <AppLayout>
      <InsightsClient />
    </AppLayout>
  );
}
