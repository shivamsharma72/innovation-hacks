"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ContentPanel, PageHeader } from "@/components/layout/InternalChrome";

interface Course {
  id: string;
  name: string;
  course_code: string;
  upcoming_assignments: number;
}

interface DashboardData {
  courses: Course[];
  stats: {
    active_courses: number;
    total_upcoming_assignments: number;
  };
}

export function DashboardClient({
  initialData,
}: {
  initialData: DashboardData | null;
}) {
  const [selected, setSelected] = useState<Course | null>(null);
  const data = initialData;

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  if (!data) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader
          title="Dashboard"
          description="Course overview from Canvas (via the gateway)."
        />
        <div className="flex flex-1 items-center justify-center p-8">
          <ContentPanel className="max-w-md text-center">
            <p className="text-sm leading-relaxed text-zinc-400">
              Could not load dashboard data. Connect Canvas in{" "}
              <Link
                href="/onboarding"
                className="text-indigo-400 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                Settings
              </Link>{" "}
              and ensure the API gateway is running.
            </p>
          </ContentPanel>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Dashboard"
        description="Tap a course for a quick summary. Keyboard: Esc closes the detail sheet."
        actions={
          <Link
            href="/insights"
            className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
          >
            View charts →
          </Link>
        }
      />

      <div
        className={`flex flex-1 flex-col overflow-auto p-4 transition-[padding] sm:p-6 lg:pr-6 ${selected ? "lg:pr-[22rem]" : ""}`}
      >
        <div className="mb-6 grid grid-cols-2 gap-3 sm:max-w-lg sm:grid-cols-3">
          <ContentPanel className="!p-4">
            <p className="text-2xl font-bold tabular-nums text-white">
              {data.stats.active_courses}
            </p>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              Active courses
            </p>
          </ContentPanel>
          <ContentPanel className="!p-4">
            <p className="text-2xl font-bold tabular-nums text-indigo-300">
              {data.stats.total_upcoming_assignments}
            </p>
            <p className="mt-1 text-xs font-medium text-zinc-500">
              Assignment rows
            </p>
          </ContentPanel>
        </div>

        <h2 className="mb-3 text-sm font-medium text-zinc-300">Your courses</h2>
        {data.courses.length === 0 ? (
          <p className="text-sm text-zinc-500">No courses found.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.courses.map((course) => {
              const isSel = selected?.id === course.id;
              return (
                <li key={course.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(isSel ? null : course)}
                    aria-expanded={isSel}
                    className={`w-full rounded-xl border p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] ${
                      isSel
                        ? "border-indigo-500 bg-indigo-500/10"
                        : "border-zinc-800/90 bg-zinc-900/40 hover:border-indigo-500/50 hover:bg-zinc-800/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">
                          {course.name}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">
                          {course.course_code}
                        </p>
                      </div>
                      {course.upcoming_assignments > 0 && (
                        <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-indigo-600/90 px-2 py-0.5 text-[10px] font-semibold text-white">
                          {course.upcoming_assignments}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selected && (
        <>
          <button
            type="button"
            aria-label="Close course details"
            className="fixed inset-0 z-30 bg-black/60 backdrop-blur-[1px] lg:hidden"
            onClick={() => setSelected(null)}
          />
          <aside
            className="fixed bottom-0 right-0 top-0 z-40 flex h-full w-full max-w-md flex-col border-l border-zinc-800/90 bg-zinc-950 shadow-2xl lg:max-w-sm"
            aria-labelledby="course-detail-title"
          >
            <div className="flex items-center justify-between border-b border-zinc-800/90 px-5 py-4">
              <h2
                id="course-detail-title"
                className="truncate pr-2 text-sm font-semibold text-white"
              >
                {selected.name}
              </h2>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 overflow-auto p-5">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Course code
                </p>
                <p className="font-mono text-sm text-zinc-300">
                  {selected.course_code}
                </p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Canvas course ID
                </p>
                <p className="font-mono text-sm text-zinc-400">{selected.id}</p>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Assignment rows (list view)
                </p>
                <p className="text-2xl font-bold text-indigo-300">
                  {selected.upcoming_assignments}
                </p>
              </div>
              <Link
                href={`/chat?q=${encodeURIComponent(`Tell me about my assignments in ${selected.name}`)}`}
                className="block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
              >
                Ask about this course →
              </Link>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}
