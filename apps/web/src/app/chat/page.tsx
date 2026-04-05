import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import AppLayout from "@/components/layout/AppLayout";
import { ChatClient } from "./ui";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; session_id?: string }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const params = await searchParams;
  const initialQuery = params.q ?? null;
  const initialSessionId = params.session_id ? parseInt(params.session_id, 10) : null;

  return (
    <AppLayout>
      <ChatClient initialSessionId={initialSessionId} initialQuery={initialQuery} />
    </AppLayout>
  );
}
