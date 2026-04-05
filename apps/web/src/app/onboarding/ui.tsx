"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function OnboardingForm({
  initiallyComplete,
}: {
  initiallyComplete: boolean;
}) {
  const router = useRouter();
  const [canvasDomain, setCanvasDomain] = useState("");
  const [canvasToken, setCanvasToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/gateway/me/canvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canvas_domain: canvasDomain.trim(),
          canvas_token: canvasToken.trim(),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(body.detail ?? res.statusText);
        return;
      }
      setStatus("Saved. You can use chat now.");
      router.refresh();
    } catch {
      setStatus("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {initiallyComplete && (
        <p className="rounded-lg border border-emerald-900/50 bg-emerald-950/30 px-3 py-2 text-sm text-emerald-200">
          Canvas is already configured. Submit again to replace the token.
        </p>
      )}
      <label className="block text-sm">
        <span className="text-zinc-400">Canvas domain</span>
        <input
          required
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          placeholder="yourschool.instructure.com"
          value={canvasDomain}
          onChange={(e) => setCanvasDomain(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="text-zinc-400">Canvas access token</span>
        <input
          required
          type="password"
          autoComplete="off"
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
          placeholder="Paste token (stored encrypted server-side)"
          value={canvasToken}
          onChange={(e) => setCanvasToken(e.target.value)}
        />
      </label>
      <button
        type="submit"
        disabled={loading}
        className="rounded-lg bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {loading ? "Saving…" : "Save"}
      </button>
      {status && (
        <p
          className={`text-sm ${status.startsWith("Saved") ? "text-emerald-400" : "text-red-400"}`}
        >
          {status}
        </p>
      )}
    </form>
  );
}
