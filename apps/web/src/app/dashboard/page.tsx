import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import AppLayout from "@/components/layout/AppLayout";
import { DashboardClient } from "./ui";

async function fetchCourses(accessToken: string) {
  const base = process.env.GATEWAY_INTERNAL_URL || process.env.GATEWAY_URL || "";
  if (!base) return null;
  try {
    const res = await fetch(`${base}/dashboard/courses`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export default async function DashboardPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  let data = null;
  try {
    const { token } = await auth0.getAccessToken();
    if (token) data = await fetchCourses(token);
  } catch {
    // no token yet
  }

  return (
    <AppLayout>
      <DashboardClient initialData={data} />
    </AppLayout>
  );
}
