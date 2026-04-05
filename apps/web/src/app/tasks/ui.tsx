"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ContentPanel, PageHeader } from "@/components/layout/InternalChrome";

function parseTaskLines(raw: string) {
  return raw
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-*•\d.)\]]+\s*/, "").trim())
    .filter((l) => l.length > 1);
}

export function TasksClient() {
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDue, setNewDue] = useState("");
  const [posting, setPosting] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/gateway/tasks");
      const data = await res.json();
      setRaw(typeof data.tasks_raw === "string" ? data.tasks_raw : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchTasks();
  }, []);

  const lines = useMemo(() => (raw ? parseTaskLines(raw) : []), [raw]);

  const addTask = async () => {
    if (!newTitle.trim()) return;
    setPosting(true);
    try {
      await fetch("/api/gateway/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, due: newDue || undefined }),
      });
      setNewTitle("");
      setNewDue("");
      setAdding(false);
      await fetchTasks();
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Tasks"
        description="Google Tasks via Workspace MCP. Parsed lines below; open Insights for a playful chart."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              {adding ? "Cancel add" : "+ Add task"}
            </button>
            <Link
              href="/insights"
              className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            >
              Task chart →
            </Link>
          </div>
        }
      />

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        {adding && (
          <ContentPanel className="space-y-3">
            <p className="text-xs font-medium text-zinc-500">
              New task (sent through gateway)
            </p>
            <input
              autoFocus
              type="text"
              placeholder="Task title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30"
              aria-label="New task title"
            />
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 outline-none focus:border-indigo-500"
              aria-label="Due date (optional)"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void addTask()}
                disabled={posting || !newTitle.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
              >
                {posting ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
              >
                Cancel
              </button>
            </div>
          </ContentPanel>
        )}

        {loading && (
          <p className="text-sm text-zinc-500" role="status">
            Loading tasks…
          </p>
        )}

        {!loading && raw && lines.length > 0 && (
          <ContentPanel>
            <h2 className="text-sm font-medium text-zinc-200">
              Parsed lines ({lines.length})
            </h2>
            <ul className="mt-3 max-h-[min(50vh,28rem)] space-y-2 overflow-auto">
              {lines.map((line, i) => (
                <li
                  key={`${i}-${line.slice(0, 24)}`}
                  className="rounded-lg border border-zinc-800/80 bg-zinc-950/50 px-3 py-2 text-sm leading-snug text-zinc-300"
                >
                  {line}
                </li>
              ))}
            </ul>
          </ContentPanel>
        )}

        {!loading && raw && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded">
              Raw response from MCP
            </summary>
            <ContentPanel className="mt-2">
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-zinc-400">
                {raw}
              </pre>
            </ContentPanel>
          </details>
        )}

        {!loading && !raw && (
          <ContentPanel className="text-center">
            <p className="text-sm text-zinc-500">
              Google Workspace MCP not connected, or no tasks returned.
            </p>
          </ContentPanel>
        )}
      </div>
    </div>
  );
}
