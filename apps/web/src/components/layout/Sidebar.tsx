"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { NavIcon } from "@/components/layout/nav-icons";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" as const },
  { href: "/chat", label: "Chat", icon: "chat" as const },
  { href: "/voice", label: "Voice", icon: "voice" as const },
  { href: "/insights", label: "Insights", icon: "insights" as const },
  { href: "/history", label: "History", icon: "history" as const },
  { href: "/tasks", label: "Tasks", icon: "tasks" as const },
  { href: "/onboarding", label: "Settings", icon: "settings" as const },
];

export function Sidebar({ email }: { email?: string | null }) {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/gateway/hitl");
        if (res.ok) {
          const data = await res.json();
          setPendingCount(data.items?.length ?? 0);
        }
      } catch {
        // ignore
      }
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <aside
      className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-zinc-800/90 bg-zinc-950"
      aria-label="Main navigation"
    >
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <span className="font-[family-name:var(--font-display)] text-sm font-medium tracking-tight text-white">
          Meridian
        </span>
        <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-zinc-600">
          Workspace
        </p>
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                active
                  ? "bg-indigo-600/20 font-medium text-indigo-200"
                  : "text-zinc-400 hover:bg-zinc-800/80 hover:text-zinc-100"
              }`}
            >
              <NavIcon name={item.icon} className="h-4 w-4 shrink-0 opacity-90" />
              {item.label}
            </Link>
          );
        })}

        {/* HITL pending badge */}
        {pendingCount > 0 && (
          <Link
            href="/chat"
            className="mt-2 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 transition-colors hover:bg-amber-500/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-black">
              {pendingCount}
            </span>
            Actions pending approval
          </Link>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-zinc-800/90 px-4 py-4">
        {email && (
          <p className="mb-2 truncate text-xs text-zinc-500" title={email}>
            {email}
          </p>
        )}
        <a
          href="/auth/logout"
          className="text-xs text-zinc-500 transition-colors hover:text-zinc-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
        >
          Log out
        </a>
      </div>
    </aside>
  );
}
