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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* HITL banner */}
      <HitlBanner items={pendingActions} onResolved={refreshHitl} />

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-600 text-center mt-8">
            Ask me anything about your courses, assignments, calendar, or tasks.
          </p>
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
            title={voiceMode ? "Voice mode on — responses will play as audio" : "Enable voice response mode"}
            className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors ${
              voiceMode
                ? "border-indigo-500 bg-indigo-600/20 text-indigo-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-500"
            }`}
          >
            🔊
          </button>

          <input
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm text-zinc-200 placeholder-zinc-600 outline-none focus:border-indigo-500 transition-colors"
            placeholder="Message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
            disabled={loading}
          />

          <button
            type="button"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40 transition-colors"
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
