import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { LandingPage } from "@/components/landing/LandingPage";

export default async function Home() {
  const session = await auth0.getSession();

  if (!session) {
    return <LandingPage />;
  }

  // Authenticated users go straight to dashboard
  redirect("/dashboard");
}
