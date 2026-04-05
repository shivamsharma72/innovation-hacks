"use client";

import { useState } from "react";

interface PendingAction {
  id: number;
  action_type: string;
  payload_json: string;
  created_at: string;
}

interface Props {
  items: PendingAction[];
  onResolved: () => void;
}

export function HitlBanner({ items, onResolved }: Props) {
  const [loading, setLoading] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;

  const handle = async (id: number, action: "approve" | "reject") => {
    setLoading(id);
    try {
      await fetch(`/api/gateway/hitl/${id}?action=${action}`, { method: "POST" });
      onResolved();
    } finally {
      setLoading(null);
    }
  };

  return (
    <>
      {/* Banner */}
      <div className="mx-4 mt-3 flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-300">
        <span>
          <span className="font-semibold">{items.length}</span> action
          {items.length !== 1 ? "s" : ""} awaiting your approval
        </span>
        <button
          onClick={() => setOpen(true)}
          className="ml-4 rounded bg-amber-500/20 px-3 py-1 text-xs font-medium hover:bg-amber-500/30 transition-colors"
        >
          Review
        </button>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Pending Actions</h2>
              <button
                onClick={() => setOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <div className="space-y-4 max-h-96 overflow-y-auto">
              {items.map((item) => {
                let prettyPayload = item.payload_json;
                try {
                  prettyPayload = JSON.stringify(JSON.parse(item.payload_json), null, 2);
                } catch {
                  // keep raw
                }
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-4"
                  >
                    <p className="mb-1 text-xs font-mono text-indigo-400">{item.action_type}</p>
                    <pre className="mb-3 max-h-32 overflow-auto text-[11px] text-zinc-400 whitespace-pre-wrap break-all">
                      {prettyPayload}
                    </pre>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handle(item.id, "approve")}
                        disabled={loading === item.id}
                        className="flex-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50 transition-colors"
                      >
                        {loading === item.id ? "…" : "Approve"}
                      </button>
                      <button
                        onClick={() => handle(item.id, "reject")}
                        disabled={loading === item.id}
                        className="flex-1 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50 transition-colors"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-lg border border-zinc-700 py-2 text-sm text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}
