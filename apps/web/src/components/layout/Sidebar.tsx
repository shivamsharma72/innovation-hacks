"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "⬡" },
  { href: "/chat",      label: "Chat",      icon: "◎" },
  { href: "/voice",     label: "Voice",     icon: "🎙" },
  { href: "/history",   label: "History",   icon: "⊞" },
  { href: "/tasks",     label: "Tasks",     icon: "✓" },
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
    <aside className="flex h-screen w-56 flex-shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      {/* Logo */}
      <div className="px-5 py-5">
        <span className="text-sm font-semibold text-white tracking-tight">Academic Copilot</span>
      </div>

      {/* Nav */}
      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active
                  ? "bg-indigo-600/20 text-indigo-300 font-medium"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        {/* HITL pending badge */}
        {pendingCount > 0 && (
          <Link
            href="/chat"
            className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-xs text-amber-400 hover:bg-amber-500/20 transition-colors"
          >
            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-black">
              {pendingCount}
            </span>
            Actions pending approval
          </Link>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-zinc-800 px-4 py-4">
        {email && (
          <p className="truncate text-xs text-zinc-500 mb-2">{email}</p>
        )}
        <a
          href="/auth/logout"
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Log out
        </a>
      </div>
    </aside>
  );
}
