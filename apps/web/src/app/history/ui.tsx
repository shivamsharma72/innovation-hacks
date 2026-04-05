"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/InternalChrome";

interface Session {
  id: number;
  title: string;
  created_at: string;
  last_message_at: string;
}

interface Message {
  role: string;
  content: string;
  created_at: string;
}

export function HistoryClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/gateway/history")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openSession = async (s: Session) => {
    setSelected(s);
    setLoadingMsgs(true);
    try {
      const res = await fetch(`/api/gateway/history/${s.id}`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } finally {
      setLoadingMsgs(false);
    }
  };

  const resume = (s: Session) => {
    localStorage.setItem("resume_session_id", String(s.id));
    router.push("/chat");
  };

  const deleteSession = async (s: Session) => {
    await fetch(`/api/gateway/history/${s.id}`, { method: "DELETE" });
    setSessions((prev) => prev.filter((x) => x.id !== s.id));
    if (selected?.id === s.id) {
      setSelected(null);
      setMessages([]);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <PageHeader
        title="History"
        description="Browse past chat sessions. Resume continues in Chat with the same thread context when supported."
      />
      <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-64 shrink-0 flex-col overflow-auto border-r border-zinc-800/90">
        <div className="border-b border-zinc-800/90 px-4 py-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Sessions
          </h2>
        </div>
        {loading && <p className="p-4 text-xs text-zinc-500">Loading…</p>}
        {!loading && sessions.length === 0 && (
          <p className="p-4 text-xs text-zinc-500">No conversations yet.</p>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => openSession(s)}
            aria-current={selected?.id === s.id ? "true" : undefined}
            className={`group w-full border-b border-zinc-800/60 px-4 py-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
              selected?.id === s.id ? "bg-indigo-600/10" : "hover:bg-zinc-800/50"
            }`}
          >
            <p className="text-xs font-medium text-zinc-200 truncate">{s.title || "Untitled"}</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">
              {new Date(s.last_message_at).toLocaleDateString()}
            </p>
          </button>
        ))}
      </div>

      {/* Message viewer */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {!selected ? (
          <div className="flex flex-1 items-center justify-center px-4 text-center text-sm text-zinc-500">
            Select a conversation to view messages.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800/90 px-4 py-3 sm:px-6">
              <h2 className="min-w-0 truncate text-sm font-medium text-zinc-200">
                {selected.title}
              </h2>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => resume(selected)}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={() => void deleteSession(selected)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto px-6 py-4 space-y-3">
              {loadingMsgs && <p className="text-xs text-zinc-500">Loading messages…</p>}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
                      m.role === "user"
                        ? "bg-indigo-600/80 text-white"
                        : "bg-zinc-800 text-zinc-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      </div>
    </div>
  );
}
