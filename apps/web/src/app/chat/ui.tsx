"use client";

import { useEffect, useRef, useState } from "react";
import { VoiceButton } from "@/components/chat/VoiceButton";
import { HitlBanner } from "@/components/chat/HitlBanner";

type ChatMessage = { role: "user" | "assistant"; content: string };

type PendingAction = {
  id: number;
  action_type: string;
  payload_json: string;
  created_at: string;
};

const QUICK_PROMPTS = [
  "What are my upcoming Canvas assignments?",
  "Summarize unread emails from this week.",
  "What's on my calendar tomorrow?",
];

interface Props {
  initialSessionId?: number | null;
  initialQuery?: string | null;
}

export function ChatClient({ initialSessionId, initialQuery }: Props) {
  const [input, setInput] = useState(initialQuery ?? "");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(initialSessionId ?? null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch pending HITL actions
  const refreshHitl = async () => {
    try {
      const res = await fetch("/api/gateway/hitl");
      if (res.ok) {
        const data = await res.json();
        setPendingActions(data.items ?? []);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    refreshHitl();
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;
    setInput("");
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);

    try {
      const endpoint = voiceMode ? "/api/gateway/voice" : "/api/gateway/chat";
      const body = JSON.stringify({
        message: text,
        history,
        session_id: sessionId ?? undefined,
      });

      if (voiceMode) {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        const replyText = res.headers.get("x-reply-text") || "";

        if (res.ok && res.headers.get("content-type")?.includes("audio")) {
          // Play audio
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audio.play().catch(() => {});
          setMessages((m) => [...m, { role: "assistant", content: replyText || "(audio response)" }]);
        } else {
          // Fallback JSON
          const data = await res.json().catch(() => ({}));
          setMessages((m) => [...m, { role: "assistant", content: data.reply_text ?? replyText ?? "No response." }]);
          if (data.session_id) setSessionId(data.session_id);
        }
      } else {
        const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setMessages((m) => [
            ...m,
            { role: "assistant", content: typeof data.detail === "string" ? data.detail : "Something went wrong." },
          ]);
        } else {
          setMessages((m) => [...m, { role: "assistant", content: data.reply_text ?? "" }]);
          if (data.session_id) setSessionId(data.session_id);
        }
      }

      // Refresh HITL after each response (a new pending action may have been created)
      await refreshHitl();
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Network error." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-zinc-800/90 bg-zinc-950/40 px-4 py-3 sm:px-5">
        <h1 className="text-base font-semibold tracking-tight text-white">
          Chat
        </h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          Grounded in your Canvas and Google Workspace tools when connected.
        </p>
      </header>

      <HitlBanner items={pendingActions} onResolved={refreshHitl} />

      <div className="flex-1 space-y-4 overflow-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="mx-auto mt-4 max-w-lg space-y-4 text-center">
            <p className="text-sm text-zinc-500">
              Ask anything about courses, assignments, calendar, Gmail, or
              tasks—or try a starter below.
            </p>
            <div
              className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center"
              role="group"
              aria-label="Suggested prompts"
            >
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  disabled={loading}
                  className="rounded-full border border-zinc-700/90 bg-zinc-900/50 px-3 py-1.5 text-left text-xs text-zinc-300 transition hover:border-indigo-500/50 hover:bg-zinc-800/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40 sm:text-center"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
                msg.role === "user"
                  ? "bg-indigo-600 text-white rounded-br-sm"
                  : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
              }`}
            >
              <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm bg-zinc-800 px-4 py-3">
              <span className="flex gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:0ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-zinc-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <VoiceButton onTranscript={(t) => send(t)} disabled={loading} />

          <button
            type="button"
            onClick={() => setVoiceMode((v) => !v)}
            title={
              voiceMode
                ? "Voice mode on — responses will play as audio"
                : "Enable voice response mode"
            }
            aria-pressed={voiceMode}
            aria-label={
              voiceMode
                ? "Disable spoken responses"
                : "Enable spoken responses with ElevenLabs"
            }
            className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              voiceMode
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            }`}
          >
            🔊
          </button>

          <input
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/40"
            placeholder="Message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              !e.shiftKey &&
              (e.preventDefault(), void send())
            }
            disabled={loading}
            aria-label="Message to assistant"
          />

          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            Send
          </button>
        </div>
        {sessionId && (
          <p className="mt-1.5 text-[10px] text-zinc-700 pl-1">Session #{sessionId}</p>
        )}
      </div>
    </div>
  );
}
