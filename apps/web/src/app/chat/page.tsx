import Link from "next/link";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { ChatClient } from "./ui";

export default async function ChatPage() {
  const session = await auth0.getSession();
  if (!session) {
    redirect("/auth/login");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-8">
      <header className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-300">
          ← Home
        </Link>
        <span className="truncate text-sm text-zinc-500">{session.user.email}</span>
      </header>
      <ChatClient />
    </main>
  );
}
