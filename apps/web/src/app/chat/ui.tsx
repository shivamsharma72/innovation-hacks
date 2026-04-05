"use client";

import { useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ToolTraceEntry = {
  round: number;
  tool: string;
  arguments_preview: string;
  source: string;
  result_preview: string;
};

export function ChatClient() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<string[] | null>(null);
  const [toolTrace, setToolTrace] = useState<ToolTraceEntry[] | null>(null);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: text }]);
    setLoading(true);
    setSources(null);
    setToolTrace(null);
    try {
      const res = await fetch("/api/gateway/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content:
              typeof data.detail === "string"
                ? data.detail
                : "Something went wrong.",
          },
        ]);
        return;
      }
      setMessages((m) => [
        ...m,
        { role: "assistant", content: data.reply_text ?? "" },
      ]);
      if (Array.isArray(data.sources)) {
        setSources(data.sources);
      }
      if (Array.isArray(data.tool_trace) && data.tool_trace.length > 0) {
        setToolTrace(data.tool_trace as ToolTraceEntry[]);
      }
    } catch {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network error." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            Try: &quot;What&apos;s my day like?&quot; or &quot;What am I behind
            on?&quot;
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-sm ${msg.role === "user" ? "text-indigo-200" : "text-zinc-200"}`}
          >
            <span className="font-medium text-zinc-500">
              {msg.role === "user" ? "You" : "Assistant"}
            </span>
            <p className="mt-1 whitespace-pre-wrap">{msg.content}</p>
          </div>
        ))}
        {loading && <p className="text-sm text-zinc-500">Thinking…</p>}
      </div>
      {sources && sources.length > 0 && (
        <p className="text-xs text-zinc-500">Sources: {sources.join(", ")}</p>
      )}
      {toolTrace && toolTrace.length > 0 && (
        <details className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 text-xs text-zinc-400">
          <summary className="cursor-pointer font-medium text-zinc-300">
            Tool trace ({toolTrace.length} calls)
          </summary>
          <p className="mt-2 text-zinc-500">
            One row per tool the model invoked this turn (round = loop step).
          </p>
          <ul className="mt-2 space-y-3 font-mono text-[11px] leading-relaxed">
            {toolTrace.map((t, i) => (
              <li key={i} className="border-t border-zinc-800 pt-2 first:border-t-0 first:pt-0">
                <span className="text-indigo-400">
                  r{t.round} · {t.tool}
                </span>{" "}
                <span className="text-zinc-600">({t.source})</span>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-zinc-500">
                  args: {t.arguments_preview}
                </pre>
                <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-all text-zinc-500">
                  → {t.result_preview}
                </pre>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          placeholder="Message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), void send())}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={loading}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
