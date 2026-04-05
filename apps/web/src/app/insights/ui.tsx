"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ContentPanel, PageHeader } from "@/components/layout/InternalChrome";

type TabId = "assignments" | "tasks";

interface Course {
  id: string;
  name: string;
  course_code: string;
  upcoming_assignments: number;
}

interface DashboardPayload {
  courses: Course[];
  stats: { active_courses: number; total_upcoming_assignments: number };
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function parseTaskLines(raw: string) {
  return raw
    .split(/\n+/)
    .map((l) => l.replace(/^[\s\-*•\d.)\]]+\s*/, "").trim())
    .filter((l) => l.length > 1)
    .slice(0, 36);
}

const FILL = "#4f46e5";
const FILL_DIM = "#312e81";
const FILL_HI = "#a5b4fc";

export function InsightsClient() {
  const [tab, setTab] = useState<TabId>("assignments");
  const [dash, setDash] = useState<DashboardPayload | null>(null);
  const [tasksRaw, setTasksRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selCourse, setSelCourse] = useState<Course | null>(null);
  const [selTaskIdx, setSelTaskIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [dRes, tRes] = await Promise.all([
        fetch("/api/gateway/dashboard"),
        fetch("/api/gateway/tasks"),
      ]);
      if (dRes.ok) {
        const d = (await dRes.json()) as DashboardPayload;
        if (d.courses && d.stats) setDash(d);
        else setDash(null);
      } else {
        setDash(null);
        if (dRes.status === 400 || dRes.status === 401) {
          setErr("Connect Canvas in Settings to see assignment charts.");
        }
      }
      if (tRes.ok) {
        const t = (await tRes.json()) as { tasks_raw?: string };
        setTasksRaw(typeof t.tasks_raw === "string" ? t.tasks_raw : null);
      } else {
        setTasksRaw(null);
      }
    } catch {
      setErr("Could not reach the gateway.");
      setDash(null);
      setTasksRaw(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const chartData = useMemo(() => {
    if (!dash?.courses?.length) return [];
    return dash.courses.map((c) => ({
      short: truncate(c.name, 14),
      full: c.name,
      code: c.course_code,
      count: c.upcoming_assignments,
      id: c.id,
      course: c,
    }));
  }, [dash]);

  const taskLines = useMemo(() => {
    if (!tasksRaw) return [];
    return parseTaskLines(tasksRaw);
  }, [tasksRaw]);

  const taskChartData = useMemo(() => {
    return taskLines.map((line, i) => ({
      n: `T${i + 1}`,
      len: Math.min(line.length, 80),
      preview: truncate(line, 72),
      idx: i,
    }));
  }, [taskLines]);

  const tabs: { id: TabId; label: string; hint: string }[] = [
    {
      id: "assignments",
      label: "Canvas assignments",
      hint: "Tap a bar to focus a course and jump to chat.",
    },
    {
      id: "tasks",
      label: "Google Tasks (playful)",
      hint: "Each bar is one line from your task list (length ≈ “weight”).",
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Insights"
        description="Lightweight charts from your own Canvas and Tasks data—click bars to explore. For fun and quick orientation, not grades."
      />

      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6">
        <div
          role="tablist"
          aria-label="Chart type"
          className="flex flex-wrap gap-2"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              id={`tab-${t.id}`}
              aria-controls={`panel-${t.id}`}
              onClick={() => {
                setTab(t.id);
                setSelCourse(null);
                setSelTaskIdx(null);
              }}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
                tab === t.id
                  ? "bg-indigo-600 text-white"
                  : "border border-zinc-700 bg-zinc-900/50 text-zinc-300 hover:border-zinc-600 hover:bg-zinc-800/60"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <p className="text-xs text-zinc-500">{tabs.find((x) => x.id === tab)?.hint}</p>

        {loading && (
          <p className="text-sm text-zinc-500" role="status">
            Loading your data…
          </p>
        )}

        {!loading && tab === "assignments" && (
          <div
            role="tabpanel"
            id="panel-assignments"
            aria-labelledby="tab-assignments"
            className="flex min-h-[320px] flex-col gap-4 lg:flex-row"
          >
            <ContentPanel className="min-h-[280px] flex-1 lg:min-h-[360px]">
              {err && !dash && (
                <p className="text-sm text-amber-200/90">{err}</p>
              )}
              {!dash?.courses?.length && !err && (
                <p className="text-sm text-zinc-500">No course data yet.</p>
              )}
              {chartData.length > 0 && (
                <>
                  <p className="mb-3 text-xs text-zinc-500">
                    Upcoming assignment rows reported per course (top{" "}
                    {chartData.length}). Click a bar to select.
                  </p>
                  <div className="h-[260px] w-full min-w-0 sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={chartData}
                        margin={{ top: 8, right: 8, left: 0, bottom: 48 }}
                        onClick={(e) => {
                          const p = e?.activePayload?.[0]?.payload as
                            | { course?: Course }
                            | undefined;
                          if (p?.course) {
                            setSelCourse(p.course);
                          }
                        }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#27272a"
                          vertical={false}
                        />
                        <XAxis
                          dataKey="short"
                          tick={{ fill: "#a1a1aa", fontSize: 11 }}
                          interval={0}
                          angle={-35}
                          textAnchor="end"
                          height={56}
                        />
                        <YAxis
                          tick={{ fill: "#71717a", fontSize: 11 }}
                          allowDecimals={false}
                          width={28}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#18181b",
                            border: "1px solid #3f3f46",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                          labelFormatter={(_, payload) =>
                            (payload?.[0]?.payload as { full?: string })
                              ?.full ?? ""
                          }
                          formatter={(value: number) => [`${value}`, "Count"]}
                        />
                        <Bar
                          dataKey="count"
                          radius={[6, 6, 0, 0]}
                          cursor="pointer"
                          name="Assignments"
                        >
                          {chartData.map((_, i) => (
                            <Cell
                              key={chartData[i].id}
                              fill={
                                selCourse?.id === chartData[i].course.id
                                  ? FILL_HI
                                  : FILL
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {dash && (
                    <p className="mt-3 text-xs text-zinc-600">
                      {dash.stats.active_courses} courses ·{" "}
                      {dash.stats.total_upcoming_assignments} assignment rows
                      summed in dashboard scope.
                    </p>
                  )}
                </>
              )}
            </ContentPanel>

            <ContentPanel className="w-full shrink-0 lg:w-72">
              <h2 className="text-sm font-medium text-white">Selection</h2>
              {!selCourse && (
                <p className="mt-2 text-sm text-zinc-500">
                  Click a bar to pin a course here.
                </p>
              )}
              {selCourse && (
                <div className="mt-3 space-y-3">
                  <p className="text-sm font-medium text-zinc-100">
                    {selCourse.name}
                  </p>
                  <p className="font-mono text-xs text-zinc-500">
                    {selCourse.course_code}
                  </p>
                  <p className="text-sm text-zinc-400">
                    Rows:{" "}
                    <span className="font-semibold text-indigo-300">
                      {selCourse.upcoming_assignments}
                    </span>
                  </p>
                  <Link
                    href={`/chat?q=${encodeURIComponent(`Summarize my upcoming work in ${selCourse.name}`)}`}
                    className="inline-flex w-full items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-center text-sm font-medium text-white transition hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-900"
                  >
                    Open in Chat
                  </Link>
                </div>
              )}
            </ContentPanel>
          </div>
        )}

        {!loading && tab === "tasks" && (
          <div
            role="tabpanel"
            id="panel-tasks"
            aria-labelledby="tab-tasks"
            className="flex min-h-[320px] flex-col gap-4 lg:flex-row"
          >
            <ContentPanel className="min-h-[280px] flex-1 lg:min-h-[360px]">
              {!tasksRaw && (
                <p className="text-sm text-zinc-500">
                  No task list text returned. Connect Google Workspace MCP and
                  open Tasks in the gateway.
                </p>
              )}
              {tasksRaw && taskChartData.length === 0 && (
                <p className="text-sm text-zinc-500">
                  Could not split tasks into lines. Raw preview below.
                </p>
              )}
              {taskChartData.length > 0 && (
                <>
                  <p className="mb-3 text-xs text-zinc-500">
                    Bar height = character count (a playful “workload” proxy).
                    Click to read the line.
                  </p>
                  <div className="h-[260px] w-full min-w-0 sm:h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={taskChartData}
                        layout="vertical"
                        margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
                        onClick={(e) => {
                          const p = e?.activePayload?.[0]?.payload as
                            | { idx?: number }
                            | undefined;
                          if (typeof p?.idx === "number") setSelTaskIdx(p.idx);
                        }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#27272a"
                          horizontal={false}
                        />
                        <XAxis type="number" hide />
                        <YAxis
                          type="category"
                          dataKey="n"
                          width={32}
                          tick={{ fill: "#a1a1aa", fontSize: 10 }}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#18181b",
                            border: "1px solid #3f3f46",
                            borderRadius: "8px",
                            fontSize: "12px",
                            maxWidth: 280,
                          }}
                          formatter={(value: number, _n, ctx) => [
                            `${value} chars`,
                            (ctx?.payload as { preview?: string })?.preview ??
                              "",
                          ]}
                        />
                        <Bar
                          dataKey="len"
                          radius={[0, 6, 6, 0]}
                          cursor="pointer"
                        >
                          {taskChartData.map((row) => (
                            <Cell
                              key={row.n}
                              fill={
                                selTaskIdx === row.idx ? FILL_HI : FILL_DIM
                              }
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </ContentPanel>

            <ContentPanel className="w-full shrink-0 lg:w-80">
              <h2 className="text-sm font-medium text-white">Task line</h2>
              {selTaskIdx === null && taskLines.length > 0 && (
                <p className="mt-2 text-sm text-zinc-500">
                  Click a horizontal bar to show the matching text.
                </p>
              )}
              {selTaskIdx !== null && taskLines[selTaskIdx] && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-300">
                  {taskLines[selTaskIdx]}
                </p>
              )}
              {tasksRaw && (
                <details className="mt-4 border-t border-zinc-800 pt-4">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-500 hover:text-zinc-400">
                    Raw response (debug)
                  </summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-500">
                    {tasksRaw}
                  </pre>
                </details>
              )}
            </ContentPanel>
          </div>
        )}
      </div>
    </div>
  );
}
