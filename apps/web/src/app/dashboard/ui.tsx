"use client";

import { useState } from "react";

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

export function DashboardClient({ initialData }: { initialData: DashboardData | null }) {
  const [selected, setSelected] = useState<Course | null>(null);
  const data = initialData;

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="text-center">
          <p className="text-zinc-400 text-sm">
            Could not load dashboard data. Make sure Canvas is connected and the gateway is running.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Main panel */}
      <div className={`flex flex-col flex-1 overflow-auto p-6 transition-all ${selected ? "mr-80" : ""}`}>
        {/* Stats bar */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-white mb-4">Your Courses</h1>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 max-w-lg">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-2xl font-bold text-white">{data.stats.active_courses}</p>
              <p className="text-xs text-zinc-500 mt-1">Active courses</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-2xl font-bold text-indigo-400">{data.stats.total_upcoming_assignments}</p>
              <p className="text-xs text-zinc-500 mt-1">Upcoming assignments</p>
            </div>
          </div>
        </div>

        {/* Course cards grid */}
        {data.courses.length === 0 ? (
          <p className="text-sm text-zinc-500">No courses found.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.courses.map((course) => (
              <button
                key={course.id}
                onClick={() => setSelected(selected?.id === course.id ? null : course)}
                className={`text-left rounded-xl border p-4 transition-all hover:border-indigo-500/60 ${
                  selected?.id === course.id
                    ? "border-indigo-500 bg-indigo-500/10"
                    : "border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{course.name}</p>
                    <p className="text-xs text-zinc-500 mt-0.5 font-mono truncate">{course.course_code}</p>
                  </div>
                  {course.upcoming_assignments > 0 && (
                    <span className="flex-shrink-0 inline-flex items-center justify-center rounded-full bg-indigo-600/80 px-2 py-0.5 text-[10px] font-semibold text-white">
                      {course.upcoming_assignments}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Slide-out detail panel */}
      {selected && (
        <div className="fixed right-0 top-0 h-full w-80 border-l border-zinc-800 bg-zinc-950 shadow-2xl overflow-auto z-30 flex flex-col">
          <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
            <h2 className="text-sm font-semibold text-white truncate pr-2">{selected.name}</h2>
            <button
              onClick={() => setSelected(null)}
              className="text-zinc-500 hover:text-zinc-300 text-xl leading-none flex-shrink-0"
            >
              ×
            </button>
          </div>
          <div className="p-5 space-y-4">
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Course Code</p>
              <p className="text-sm font-mono text-zinc-300">{selected.course_code}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Course ID</p>
              <p className="text-sm font-mono text-zinc-400">{selected.id}</p>
            </div>
            <div>
              <p className="text-xs text-zinc-500 uppercase tracking-wide mb-1">Upcoming Assignments</p>
              <p className="text-2xl font-bold text-indigo-400">{selected.upcoming_assignments}</p>
            </div>
            <a
              href={`/chat?q=${encodeURIComponent(`Tell me about my assignments in ${selected.name}`)}`}
              className="block w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-indigo-500 transition-colors"
            >
              Ask about this course →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
