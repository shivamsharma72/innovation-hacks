"use client";

import { useEffect, useState } from "react";

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
      setRaw(data.tasks_raw ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchTasks(); }, []);

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
    <div className="flex flex-col flex-1 overflow-auto p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-white">Tasks</h1>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          + Add task
        </button>
      </div>

      {/* Add task form */}
      {adding && (
        <div className="mb-6 rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 space-y-3">
          <input
            autoFocus
            type="text"
            placeholder="Task title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"
          />
          <input
            type="date"
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-400 outline-none focus:border-indigo-500"
          />
          <div className="flex gap-2">
            <button
              onClick={addTask}
              disabled={posting || !newTitle.trim()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
            >
              {posting ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Tasks display */}
      {loading && <p className="text-sm text-zinc-500">Loading tasks…</p>}
      {!loading && raw && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <pre className="whitespace-pre-wrap text-sm text-zinc-300 font-mono leading-relaxed">{raw}</pre>
        </div>
      )}
      {!loading && !raw && (
        <div className="flex flex-1 items-center justify-center text-sm text-zinc-600">
          Google Workspace MCP not connected, or no tasks found.
        </div>
      )}
    </div>
  );
}
