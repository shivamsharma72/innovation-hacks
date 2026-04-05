import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { Sidebar } from "./Sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      <Sidebar email={session.user.email} />
      <main className="flex flex-1 flex-col overflow-auto">{children}</main>
    </div>
  );
}
