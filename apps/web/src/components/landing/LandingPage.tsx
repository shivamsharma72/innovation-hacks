import Image from "next/image";
import Link from "next/link";

import { SplineHero } from "@/components/landing/SplineHero";

/** Remote .splinecode URL (default) or same-origin file e.g. `/spline/scene.splinecode` if you export the scene into `public/spline/` for stronger browser caching. */
const SPLINE_SCENE =
  process.env.NEXT_PUBLIC_SPLINE_SCENE_URL?.trim() ||
  "https://prod.spline.design/o0gDyEcaiU1Fit9i/scene.splinecode";

const PRODUCT = "Meridian";

/** Example phrasings aligned with canvas-mcp (Python FastMCP) + google_workspace_mcp default tool load. */
const NLP_EXAMPLES: { title: string; blurb: string; queries: string[] }[] = [
  {
    title: "Canvas  (Python MCP)",
    blurb:
      "The gateway’s default Canvas integration is the Python FastMCP server (streamable HTTP): courses, your assignments and grades, modules and pages, files, inbox-style conversations, peer reviews, groups, and more.",
    queries: [
      "What are my upcoming assignments across my Canvas courses?",
      "What is my submission status for the lab in CHEM 101?",
      "Show my course grades and list the assignments I still owe.",
      "List modules in CS 240 and summarize what is inside Week 4.",
      "Pull the HTML content of the syllabus page for my stats course.",
      "List course files the instructor posted for the midterm review.",
      "How many unread Canvas conversations do I have?",
    ],
  },
  {
    title: "Gmail",
    blurb:
      "Search threads, read messages (including batches), draft or send mail, manage labels and filters, and adjust labels on messages—sends can still go through human approval when your deployment requires it.",
    queries: [
      "Search Gmail for messages from the registrar in the last two weeks.",
      "Show the full body of the latest email in the thread with my advisor.",
      "Draft a short reply asking for clarification on the extension policy.",
      "List my Gmail labels and how many unread messages are in each.",
    ],
  },
  {
    title: "Google Calendar",
    blurb:
      "List calendars and events, create or update events, query free/busy, and manage focus time or out-of-office blocks.",
    queries: [
      "What is on my primary calendar tomorrow between 9am and 5pm?",
      "When am I free for an hour on Thursday afternoon?",
      "Add a calendar event for my study group this Sunday at 3pm.",
      "Set out-of-office for next Friday with an auto-reply message.",
    ],
  },
  {
    title: "Google Drive",
    blurb:
      "Search and list files, create folders or files, copy or update files, inspect permissions, and generate shareable links.",
    queries: [
      "Search Drive for PDFs with “syllabus” in the title.",
      "List items in the folder where I keep this semester’s lecture slides.",
      "Get a shareable link for my group project Doc with view-only access.",
    ],
  },
  {
    title: "Google Docs",
    blurb:
      "Search and read Docs, create documents, insert or replace text, work with tables and tabs, inspect structure, and export to PDF or Markdown.",
    queries: [
      "Search my Google Docs for anything titled “research proposal”.",
      "Summarize the main sections of my “Lit review” document.",
      "Create a new Doc with a bullet outline for my presentation.",
      "Export my “Thesis draft” Doc to PDF.",
    ],
  },
  {
    title: "Tasks, contacts & Program Search",
    blurb:
      "Google Tasks (lists and tasks), People contacts and groups, plus optional Custom Search engines when configured on the Workspace MCP.",
    queries: [
      "List my Google Task lists and the open tasks in my default list.",
      "Add a task to finish the readings by Friday night.",
      "Search my contacts for someone named Avery in the tutoring list.",
      "Run a custom search for pages about our department’s honors program.",
    ],
  },
];

function WhatRunsSection() {
  return (
    <section
      className="border-t border-zinc-800/80 bg-[#08080a]"
      aria-labelledby="wired-heading"
    >
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <h2
          id="wired-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight text-white sm:text-3xl"
        >
          What this deployment actually connects
        </h2>
        <p className="mt-3 max-w-3xl text-zinc-400">
          In the default{" "}
          <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.8rem] text-zinc-300">
            docker-compose
          </code>{" "}
          setup, the API gateway opens streamable-HTTP MCP sessions to two
          backends. Your questions—typed or via the{" "}
          <strong className="font-medium text-zinc-200">ElevenLabs</strong>
          -powered voice agent—are turned into tool calls by the language model,
          then executed against your own Canvas and Google accounts.
        </p>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-zinc-800/90 bg-zinc-900/25 p-6 sm:p-7">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-300/90">
              Canvas MCP
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Python FastMCP app in{" "}
              <code className="font-mono text-[0.8rem] text-zinc-300">
                canvas-mcp
              </code>
              , exposed at{" "}
              <code className="font-mono text-[0.8rem] text-zinc-300">
                /mcp
              </code>
              . Dozens of tools cover your assignments, submissions, grades,
              courses, modules, pages, files, Canvas messaging, peer reviews,
              groups, users, accessibility reports, and developer helpers (e.g.
              tool search and TypeScript execution against the Canvas code API).
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-800/90 bg-zinc-900/25 p-6 sm:p-7">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-violet-300/90">
              Google Workspace MCP
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              Python server in{" "}
              <code className="font-mono text-[0.8rem] text-zinc-300">
                google_workspace_mcp
              </code>
              . With no{" "}
              <code className="font-mono text-[0.8rem] text-zinc-300">
                TOOLS
              </code>{" "}
              or{" "}
              <code className="font-mono text-[0.8rem] text-zinc-300">
                TOOL_TIER
              </code>{" "}
              override, it loads the full surface:{" "}
              <strong className="font-medium text-zinc-300">Gmail</strong>,{" "}
              <strong className="font-medium text-zinc-300">Drive</strong>,{" "}
              <strong className="font-medium text-zinc-300">Calendar</strong>,{" "}
              <strong className="font-medium text-zinc-300">Docs</strong>,{" "}
              <strong className="font-medium text-zinc-300">Tasks</strong>,{" "}
              <strong className="font-medium text-zinc-300">Contacts</strong>,
              and{" "}
              <strong className="font-medium text-zinc-300">
                Custom Search
              </strong>
              —on the order of seventy tools. Narrowing env vars reduces that
              list.
            </p>
          </article>
        </div>

        <p className="mt-8 max-w-3xl border-t border-zinc-800/80 pt-8 text-xs leading-relaxed text-zinc-500">
          <strong className="font-medium text-zinc-400">Note:</strong> This repo
          also contains a TypeScript Canvas server under{" "}
          <code className="rounded bg-zinc-800/60 px-1 font-mono text-[0.7rem]">
            mcp-canvas-lms
          </code>{" "}
          with its own <code className="font-mono text-[0.7rem]">canvas_*</code>{" "}
          tools.{" "}
          <span className="text-zinc-400">
            Default compose does not point the gateway at that server today—the
            live Canvas path is the Python{" "}
            <code className="font-mono text-[0.7rem]">canvas-mcp</code> service.
          </span>
        </p>
      </div>
    </section>
  );
}

function HeroLogoStrip() {
  /** Files live in `public/logos/` — replace SVGs/PNGs there to swap assets. */
  const items = [
    {
      name: "Gemini",
      subtitle: "Model",
      href: "https://deepmind.google/technologies/gemini/",
      src: "/logos/gemini.svg",
      width: 120,
      height: 40,
      label: "Google Gemini — language model",
    },
    {
      name: "ElevenLabs",
      subtitle: "Voice",
      href: "https://elevenlabs.io/",
      src: "/logos/elevenlabs.svg",
      width: 140,
      height: 40,
      label: "ElevenLabs — voice synthesis",
    },
    {
      name: "Auth0",
      subtitle: "Sign-in",
      href: "https://auth0.com/",
      src: "/logos/auth0.svg",
      width: 120,
      height: 40,
      label: "Auth0 — authentication",
    },
  ] as const;

  return (
    <div
      className="flex w-full flex-wrap items-center justify-center gap-x-8 gap-y-5 sm:gap-x-12 sm:gap-y-4"
      aria-label="Integrations in this hero"
    >
      {items.map((item) => (
        <a
          key={item.name}
          href={item.href}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex flex-col items-center gap-2 rounded-xl px-3 py-2 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] sm:flex-row sm:items-center sm:gap-3"
          aria-label={item.label}
        >
          <Image
            src={item.src}
            alt=""
            width={item.width}
            height={item.height}
            className="h-8 w-auto max-w-[min(9rem,28vw)] object-contain object-center opacity-90 transition group-hover:opacity-100 sm:h-9 sm:max-w-none"
            aria-hidden
          />
          <span className="text-center sm:text-left">
            <span className="block text-sm font-medium text-zinc-200 group-hover:text-white">
              {item.name}
            </span>
            <span className="block text-[0.65rem] font-medium uppercase tracking-wider text-zinc-500">
              {item.subtitle}
            </span>
          </span>
        </a>
      ))}
    </div>
  );
}

function PoweredByStrip() {
  const items = [
    {
      name: "Google Gemini",
      href: "https://deepmind.google/technologies/gemini/",
      src: "/brands/gemini.svg",
      width: 28,
      height: 28,
      label: "Google Gemini — model orchestration",
    },
    {
      name: "ElevenLabs",
      href: "https://elevenlabs.io/",
      src: "/brands/elevenlabs.svg",
      width: 28,
      height: 28,
      label: "ElevenLabs — voice synthesis",
    },
    {
      name: "Auth0",
      href: "https://auth0.com/",
      src: "/brands/auth0.svg",
      width: 28,
      height: 28,
      label: "Auth0 — authentication",
    },
  ] as const;

  return (
    <section
      className="border-y border-zinc-800/80 bg-zinc-950/60"
      aria-labelledby="powered-heading"
    >
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <h2
          id="powered-heading"
          className="text-center text-xs font-medium uppercase tracking-[0.25em] text-zinc-500"
        >
          Powered by
        </h2>
        <ul
          className="mt-8 flex flex-col items-stretch gap-6 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-14 sm:gap-y-8"
          role="list"
        >
          {items.map((item) => (
            <li key={item.name} className="flex justify-center">
              <a
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex min-h-[48px] min-w-[200px] max-w-sm flex-row items-center gap-3 rounded-xl border border-zinc-800/90 bg-zinc-900/30 px-5 py-3 transition hover:border-zinc-600 hover:bg-zinc-900/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c] sm:min-w-0 sm:border-0 sm:bg-transparent sm:px-3 sm:py-2"
                aria-label={item.label}
              >
                <Image
                  src={item.src}
                  alt=""
                  width={item.width}
                  height={item.height}
                  className="h-7 w-auto shrink-0 opacity-90 group-hover:opacity-100 sm:h-8"
                  aria-hidden
                />
                <span className="text-sm font-medium text-zinc-200 group-hover:text-white">
                  {item.name}
                </span>
              </a>
            </li>
          ))}
        </ul>
        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-zinc-500">
          <strong className="font-medium text-zinc-400">Google Gemini</strong>{" "}
          plans and invokes MCP tools.{" "}
          <strong className="font-medium text-zinc-400">ElevenLabs</strong>{" "}
          renders spoken replies in voice mode.{" "}
          <strong className="font-medium text-zinc-400">Auth0</strong> protects
          sign-in. Live Canvas and Google data come from the{" "}
          <strong className="font-medium text-zinc-400">Canvas MCP</strong> and{" "}
          <strong className="font-medium text-zinc-400">
            Google Workspace MCP
          </strong>{" "}
          servers. Replace SVGs in{" "}
          <code className="rounded bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[0.7rem] text-zinc-400">
            public/brands/
          </code>{" "}
          with your approved assets anytime.
        </p>
      </div>
    </section>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0a0c] text-zinc-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-zinc-900"
      >
        Skip to main content
      </a>

      <header className="border-b border-zinc-800/80">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-end px-1 sm:px-8">
          <nav aria-label="Account" className="flex items-center gap-3 text-sm">
            <Link
              href="/auth/login"
              className="rounded-lg px-3 py-2 text-zinc-400 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
            >
              Log in
            </Link>
            <Link
              href="/auth/login?screen_hint=signup"
              className="rounded-lg bg-zinc-100 px-3 py-2 font-medium text-zinc-900 transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
            >
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <section
          className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-14 sm:px-8 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-stretch lg:gap-x-14 lg:gap-y-8 lg:py-16 xl:gap-x-16 xl:py-20"
          aria-labelledby="hero-heading"
        >
          <h1
            id="hero-heading"
            className="order-1 font-[family-name:var(--font-display)] text-5xl font-medium leading-none tracking-tight text-white sm:text-6xl lg:order-none lg:col-start-1 lg:row-start-1 lg:self-start lg:text-6xl xl:text-7xl"
          >
            {PRODUCT}
          </h1>

          <div className="order-3 lg:order-none lg:col-start-2 lg:row-start-1 lg:self-start">
            <HeroLogoStrip />
          </div>

          <div className="order-2 flex min-h-0 max-w-xl flex-col justify-between gap-8 lg:order-none lg:col-start-1 lg:row-start-2 lg:max-w-none lg:min-h-full lg:pt-2">
            <div className="space-y-5 sm:space-y-6">
              <p className="text-xs font-medium uppercase tracking-[0.2em] text-violet-300/90">
                Canvas · Google Workspace · ElevenLabs voice
              </p>
              <h2 className="font-[family-name:var(--font-display)] text-4xl font-medium leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[2.65rem] xl:text-[2.85rem]">
                One conversation across Canvas and your Google workspace.
              </h2>
              <p className="max-w-[34rem] text-base leading-relaxed text-zinc-400 sm:text-lg">
                {PRODUCT} routes natural language to{" "}
                <strong className="font-medium text-zinc-300">
                  Canvas MCP
                </strong>{" "}
                and{" "}
                <strong className="font-medium text-zinc-300">
                  Google Workspace MCP
                </strong>
                —Gmail, Drive, Calendar, Docs, Tasks, Contacts, and more. Use
                chat or the{" "}
                <strong className="font-medium text-zinc-300">
                  ElevenLabs
                </strong>{" "}
                voice experience when you want to speak instead of type.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:pt-2">
              <Link
                href="/auth/login?screen_hint=signup"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-violet-500 px-6 text-sm font-semibold text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
              >
                Create an account
              </Link>
              <Link
                href="/auth/login"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-zinc-700 px-6 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0c]"
              >
                I already have access
              </Link>
            </div>
          </div>

          <div className="order-4 flex w-full flex-col items-center gap-6 lg:order-none lg:col-start-2 lg:row-start-2 lg:items-stretch lg:min-h-0">
            <div
              className="relative flex w-full max-w-[min(100%,520px)] flex-col lg:mx-auto lg:max-w-none lg:min-h-0 lg:flex-1"
              style={{ minHeight: "clamp(20rem, 44vw, 38rem)" }}
            >
              <div
                className="landing-spline-fallback absolute inset-0 z-10 hidden items-center justify-center rounded-2xl border border-zinc-800 bg-gradient-to-br from-violet-950/40 via-zinc-900/80 to-zinc-950"
                aria-hidden
              >
                <div className="max-w-xs px-6 text-center text-sm text-zinc-500">
                  Decorative 3D view is paused when reduced motion is preferred.
                </div>
              </div>

              <div
                className="landing-spline-host relative h-full min-h-[inherit] flex-1 overflow-hidden rounded-2xl border border-zinc-800/90 bg-gradient-to-b from-zinc-900/50 to-[#0a0a0c] shadow-[0_0_80px_-20px_rgba(139,92,246,0.35)] lg:min-h-0"
                role="img"
                aria-label="Decorative 3D illustration of a friendly robot"
              >
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-2xl p-3 sm:p-4">
                  <div className="flex h-full w-full max-h-full max-w-full items-center justify-center">
                    <div className="h-full w-full origin-center scale-[0.92] sm:scale-[0.92] lg:scale-[0.92]">
                      <SplineHero
                        scene={SPLINE_SCENE}
                        className="!block !h-full !w-full"
                      />
                    </div>
                  </div>
                </div>
              </div>
              {/* <p className="mt-3 text-center text-[0.7rem] leading-snug text-zinc-600">
                The 3D scene streams from Spline on first visit; hosting the
                exported{" "}
                <code className="font-mono text-zinc-500">.splinecode</code>{" "}
                under{" "}
                <code className="font-mono text-zinc-500">public/spline/</code>{" "}
                and setting{" "}
                <code className="font-mono text-zinc-500">
                  NEXT_PUBLIC_SPLINE_SCENE_URL
                </code>{" "}
                speeds repeat loads.
              </p> */}
            </div>
          </div>
        </section>

        <WhatRunsSection />

        <section
          className="border-t border-zinc-800/80 bg-zinc-950/30"
          aria-labelledby="nlp-heading"
        >
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
            <h2
              id="nlp-heading"
              className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight text-white sm:text-3xl"
            >
              Natural language you can use
            </h2>
            <p className="mt-3 max-w-3xl text-zinc-400">
              No special syntax—the assistant maps plain English to{" "}
              <strong className="font-medium text-zinc-300">canvas__*</strong>{" "}
              and <strong className="font-medium text-zinc-300">gws__*</strong>{" "}
              tools (names are prefixed in the gateway). Examples below mirror
              what those MCP servers expose; optional{" "}
              <code className="rounded bg-zinc-800/80 px-1 font-mono text-[0.8rem] text-zinc-300">
                TOOLS
              </code>{" "}
              /{" "}
              <code className="rounded bg-zinc-800/80 px-1 font-mono text-[0.8rem] text-zinc-300">
                TOOL_TIER
              </code>{" "}
              env on Workspace MCP can shrink the Google side.
            </p>
            <div className="mt-12 grid gap-10 md:grid-cols-2">
              {NLP_EXAMPLES.map((block) => (
                <article
                  key={block.title}
                  className="rounded-2xl border border-zinc-800/80 bg-zinc-900/20 p-6 sm:p-7"
                >
                  <h3 className="text-base font-semibold text-white">
                    {block.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">
                    {block.blurb}
                  </p>
                  <ul
                    className="mt-5 space-y-3 border-t border-zinc-800/60 pt-5"
                    role="list"
                  >
                    {block.queries.map((q) => (
                      <li
                        key={q}
                        className="flex gap-1.5 text-sm leading-snug text-zinc-300"
                      >
                        <span
                          className="shrink-0 text-violet-400/90"
                          aria-hidden
                        >
                          “
                        </span>
                        <span>{q}</span>
                        <span
                          className="shrink-0 text-violet-400/90"
                          aria-hidden
                        >
                          ”
                        </span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="border-t border-zinc-800/80 bg-zinc-950/40"
          aria-labelledby="how-heading"
        >
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
            <h2
              id="how-heading"
              className="font-[family-name:var(--font-display)] text-2xl font-medium tracking-tight text-white sm:text-3xl"
            >
              How it fits into your day
            </h2>
            <p className="mt-3 max-w-2xl text-zinc-400">
              Three short steps—aligned with how people actually recover from
              interruption and rebuild focus.
            </p>
            <ol className="mt-12 grid gap-10 sm:grid-cols-3" role="list">
              <li className="relative pl-11">
                <span
                  className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-violet-500/35 bg-violet-500/10 text-xs font-semibold text-violet-200"
                  aria-hidden
                >
                  1
                </span>
                <h3 className="text-sm font-semibold text-white">
                  Connect once
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Sign in with Auth0, link Canvas, and complete Google OAuth on
                  the Workspace MCP—same accounts you already use.
                </p>
              </li>
              <li className="relative pl-11">
                <span
                  className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-violet-500/35 bg-violet-500/10 text-xs font-semibold text-violet-200"
                  aria-hidden
                >
                  2
                </span>
                <h3 className="text-sm font-semibold text-white">
                  Ask in plain language
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  Type in chat or use voice: Gemini selects Canvas and Google
                  tools; ElevenLabs speaks the reply when you are in voice mode.
                </p>
              </li>
              <li className="relative pl-11">
                <span
                  className="absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border border-violet-500/35 bg-violet-500/10 text-xs font-semibold text-violet-200"
                  aria-hidden
                >
                  3
                </span>
                <h3 className="text-sm font-semibold text-white">
                  Confirm what matters
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  High-impact actions surface in the UI so you approve outbound
                  mail and similar steps explicitly.
                </p>
              </li>
            </ol>
          </div>
        </section>

        <PoweredByStrip />

        <footer className="border-t border-zinc-800/80">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-10 text-center text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:text-left sm:px-8">
            <span>{PRODUCT} — Canvas MCP, Google Workspace MCP, voice.</span>
            <span className="text-zinc-600">
              Your data stays tied to your own accounts and approvals.
            </span>
          </div>
        </footer>
      </main>
    </div>
  );
}
