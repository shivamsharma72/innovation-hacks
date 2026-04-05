"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { HitlBanner } from "@/components/chat/HitlBanner";

// ─── Types ──────────────────────────────────────────────────────────────────

type AgentStatus = "idle" | "listening" | "processing" | "speaking";

interface Turn {
  role: "user" | "agent";
  text: string;
  thoughts?: string[];   // tool calls the agent made, shown as thought bubbles
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SILENCE_THRESHOLD  = 10;    // RMS below this = silence
const SILENCE_DURATION   = 2500;  // ms of silence before we stop recognition (increased to avoid cutting off mid-sentence)
const MIN_SPEECH_MS      = 800;   // ignore utterances shorter than this
const BARGE_IN_THRESHOLD = 28;    // mic RMS while agent speaks (ElevenLabs) — interrupt threshold
const BARGE_IN_MS        = 350;   // ms of sustained voice before we cut TTS

// ─── Ring ────────────────────────────────────────────────────────────────────

function Ring({ status, level }: { status: AgentStatus; level: number }) {
  const base   = 80;
  const expand = Math.min(level * 1.4, 60);
  const radius = base + (status === "listening" || status === "speaking" ? expand : 0);

  const colors: Record<AgentStatus, string> = {
    idle:       "rgba(99,102,241,0.15)",
    listening:  "rgba(99,102,241,0.35)",
    processing: "rgba(251,191,36,0.25)",
    speaking:   "rgba(52,211,153,0.30)",
  };
  const strokeColors: Record<AgentStatus, string> = {
    idle:       "#6366f1",
    listening:  "#818cf8",
    processing: "#fbbf24",
    speaking:   "#34d399",
  };

  return (
    <div className="relative flex items-center justify-center" style={{ width: 220, height: 220 }}>
      <div
        className="absolute rounded-full"
        style={{
          width:  radius * 2 + 40,
          height: radius * 2 + 40,
          background: colors[status],
          filter: "blur(18px)",
          transition: "all 80ms ease-out",
        }}
      />
      <svg width={220} height={220} className="absolute">
        <circle
          cx={110} cy={110}
          r={Math.min(radius, 100)}
          fill="none"
          stroke={strokeColors[status]}
          strokeWidth={status === "listening" ? 3 : 2}
          strokeDasharray={status === "processing" ? "12 8" : undefined}
          style={{
            transition: "r 80ms ease-out, stroke 300ms",
            animation: status === "processing" ? "spin 2s linear infinite" : undefined,
          }}
        />
      </svg>
      <div
        className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full border-2"
        style={{
          background: status === "idle" ? "#18181b" : "#1e1e2e",
          borderColor: strokeColors[status],
          transition: "border-color 300ms",
        }}
      >
        {status === "processing" ? (
          <span className="text-2xl animate-spin" style={{ display: "inline-block" }}>⟳</span>
        ) : status === "speaking" ? (
          <span className="text-2xl">🔊</span>
        ) : (
          <span className="text-2xl">🎙</span>
        )}
      </div>
    </div>
  );
}

// ─── Thought bubble ──────────────────────────────────────────────────────────

function ThoughtBubble({ steps }: { steps: string[] }) {
  if (!steps.length) return null;
  return (
    <div className="flex flex-col gap-1 max-w-[90%]">
      {steps.map((s, i) => (
        <div key={i} className="flex items-center gap-1.5 text-[10px] text-zinc-500 italic">
          <span className="text-zinc-600">·</span>
          {s}
        </div>
      ))}
    </div>
  );
}

// ─── Live thinking indicator ─────────────────────────────────────────────────

function ThinkingRow({ steps }: { steps: string[] }) {
  const latest = steps[steps.length - 1];
  return (
    <div className="flex justify-start">
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-zinc-400 max-w-[90%] space-y-1">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className={`text-[10px] ${i === steps.length - 1 ? "text-amber-400 animate-pulse" : "text-zinc-600"}`}>●</span>
            <span className={i === steps.length - 1 ? "text-zinc-300" : "text-zinc-600 line-through"}>{s}</span>
          </div>
        ))}
        {latest && (
          <div className="flex items-center gap-1 pt-0.5">
            <span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "0ms" }} />
            <span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "150ms" }} />
            <span className="w-1 h-1 rounded-full bg-amber-400 animate-bounce" style={{ animationDelay: "300ms" }} />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VoiceAgent() {
  const [status, setStatus]             = useState<AgentStatus>("idle");
  const [level, setLevel]               = useState(0);
  const [transcript, setTranscript]     = useState("");
  const [turns, setTurns]               = useState<Turn[]>([]);
  const [thinkingSteps, setThinkingSteps] = useState<string[]>([]);
  const [error, setError]               = useState<string | null>(null);
  const [sessionId, setSessionId]       = useState<number | null>(null);
  const [pendingActions, setPendingActions] = useState<any[]>([]);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetch("/api/gateway/hitl");
      if (res.ok) {
        const data = await res.json();
        setPendingActions(data.items ?? []);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, 10_000);
    return () => clearInterval(id);
  }, [fetchPending]);

  // Refs
  const recognitionRef  = useRef<any>(null);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const animFrameRef    = useRef<number>(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechStartRef  = useRef<number>(0);
  const activeRef       = useRef(false);
  const statusRef       = useRef<AgentStatus>("idle");
  const turnsRef        = useRef<Turn[]>([]);
  const sessionIdRef    = useRef<number | null>(null);
  // Playback control
  const audioElemRef      = useRef<HTMLAudioElement | null>(null);
  const audioObjectUrlRef = useRef<string | null>(null);
  const ttsResolveRef     = useRef<(() => void) | null>(null);
  const bargeInStartRef   = useRef<number>(0);
  // Signals the sentence-loop in playElevenLabs to stop (set by stopPlayback / barge-in)
  const playbackCancelRef = useRef(false);
  // Transcript auto-scroll
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => { statusRef.current    = status;    }, [status]);
  useEffect(() => { turnsRef.current     = turns;     }, [turns]);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns, thinkingSteps]);

  // ── Stop any in-progress playback ─────────────────────────────────────────

  const stopPlayback = useCallback(() => {
    playbackCancelRef.current = true;   // tell sentence loop to exit immediately
    if (audioElemRef.current) {
      audioElemRef.current.pause();
      audioElemRef.current.src = "";
      audioElemRef.current = null;
    }
    if (audioObjectUrlRef.current) {
      URL.revokeObjectURL(audioObjectUrlRef.current);
      audioObjectUrlRef.current = null;
    }
    const res = ttsResolveRef.current;
    ttsResolveRef.current = null;
    res?.();
  }, []);

  // ── Audio analyser loop ───────────────────────────────────────────────────

  const startAnalyser = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!activeRef.current) return;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += (v - 128) ** 2;
        const rms = Math.sqrt(sum / data.length);
        setLevel(rms);

        // Silence detection while listening
        if (statusRef.current === "listening") {
          if (rms < SILENCE_THRESHOLD) {
            if (!silenceTimerRef.current && Date.now() - speechStartRef.current > MIN_SPEECH_MS) {
              silenceTimerRef.current = setTimeout(() => {
                if (statusRef.current === "listening") {
                  recognitionRef.current?.stop();
                }
              }, SILENCE_DURATION);
            }
          } else {
            if (silenceTimerRef.current) {
              clearTimeout(silenceTimerRef.current);
              silenceTimerRef.current = null;
            }
          }
        }

        // Barge-in: user speaks while agent is speaking → interrupt
        if (statusRef.current === "speaking") {
          if (rms > BARGE_IN_THRESHOLD) {
            if (!bargeInStartRef.current) {
              bargeInStartRef.current = Date.now();
            } else if (Date.now() - bargeInStartRef.current > BARGE_IN_MS) {
              bargeInStartRef.current = 0;
              stopPlayback();
              setStatus("listening");  // immediate visual feedback
            }
          } else {
            bargeInStartRef.current = 0;
          }
        } else {
          bargeInStartRef.current = 0;
        }

        animFrameRef.current = requestAnimationFrame(tick);
      };
      animFrameRef.current = requestAnimationFrame(tick);
    } catch (e: any) {
      setError("Microphone access denied: " + e.message);
    }
  }, [stopPlayback]);

  // ── Play blob (ElevenLabs audio) — poll so barge-in / stop cuts audio mid-clip ──

  const playBlob = (blob: Blob) =>
    new Promise<void>((resolve) => {
      const url = URL.createObjectURL(blob);
      let pollHandle: number | null = null;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        if (pollHandle !== null) {
          window.clearInterval(pollHandle);
          pollHandle = null;
        }
        if (audioObjectUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioObjectUrlRef.current = null;
        }
        audioElemRef.current = null;
        if (ttsResolveRef.current === resolve) ttsResolveRef.current = null;
        resolve();
      };

      ttsResolveRef.current = resolve;
      audioObjectUrlRef.current = url;
      const audio = new Audio(url);
      audioElemRef.current = audio;

      pollHandle = window.setInterval(() => {
        if (playbackCancelRef.current || !activeRef.current) {
          audio.pause();
          finish();
        }
      }, 64);

      audio.onended = () => finish();
      audio.onerror = () => finish();
      audio.play().catch(() => finish());
    });

  // ── Sentence splitter (mirrors backend _split_sentences) ─────────────────

  const splitSentences = (text: string): string[] =>
    text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

  /** Strip common markdown so TTS does not say "hash hash" or "asterisk". */
  const plainTextForSpeech = (raw: string): string => {
    if (!raw) return raw;
    let s = raw.replace(/\r\n/g, "\n");
    s = s.replace(/```(?:\w+)?\n[\s\S]*?```/g, (m) => m.replace(/```[^\n]*\n?|```/g, "").trim());
    s = s.replace(/^#{1,6}\s+/gm, "");
    s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
    s = s.replace(/__([^_]+)__/g, "$1");
    s = s.replace(/^\s*[-*+]\s+/gm, "");
    s = s.replace(/^\s*\d+\.\s+/gm, "");
    s = s.replace(/`+/g, "");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  };

  // ── Fetch a single sentence as an audio blob from ElevenLabs ─────────────

  const fetchTTSBlob = async (sentence: string): Promise<Blob | null> => {
    try {
      const res = await fetch("/api/gateway/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sentence }),
      });
      if (res.ok && (res.headers.get("content-type") ?? "").includes("audio")) {
        const blob = await res.blob();
        if (blob.size > 0) return blob;
      }
    } catch { /* fall through */ }
    return null;
  };

  // ── ElevenLabs TTS — sentence-level pipeline (starts on first sentence) ──
  //
  // 1. Split reply into sentences.
  // 2. Fetch sentence 0 from ElevenLabs → play as soon as its blob arrives.
  // 3. While sentence N is playing, sentence N+1 is already being fetched.
  // → Time-to-first-audio ≈ one sentence TTS (~300-500 ms) instead of the
  //   whole reply, and each subsequent sentence starts instantly after the
  //   previous one ends.

  const playElevenLabs = async (text: string): Promise<void> => {
    const spoken = plainTextForSpeech(text);
    if (!spoken.trim()) return;
    const sentences = splitSentences(spoken);
    if (sentences.length === 0) return;

    // NOTE: do NOT reset playbackCancelRef here — sendToAgent resets it once per
    // turn before any audio plays. Resetting here causes barge-in to be ignored
    // when the second playElevenLabs call (main reply) starts after preamble.

    // Kick off the first fetch immediately
    let currentFetch = fetchTTSBlob(sentences[0]);

    for (let i = 0; i < sentences.length; i++) {
      if (!activeRef.current || playbackCancelRef.current) break;

      // While waiting for the current blob, pre-fetch the next sentence
      const nextFetch = i + 1 < sentences.length ? fetchTTSBlob(sentences[i + 1]) : null;

      const blob = await currentFetch;
      if (!activeRef.current || playbackCancelRef.current) break;

      if (blob) {
        await playBlob(blob);
      }
      // No browser SpeechSynthesis fallback — avoids Chrome speaking after End conversation

      if (nextFetch) currentFetch = nextFetch;
    }
  };

  // ── Speech recognition ────────────────────────────────────────────────────

  const startListening = useCallback(() => {
    if (!activeRef.current) return;
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) { setError("Voice requires Chrome or Edge."); return; }

    const rec = new SR();
    rec.continuous     = true;
    rec.interimResults = true;
    rec.lang           = "en-US";

    rec.onstart = () => {
      speechStartRef.current = Date.now();
      setStatus("listening");
      setTranscript("");
    };

    rec.onresult = (e: any) => {
      let interim = "", final = "";
      for (const result of e.results) {
        if (result.isFinal) final   += result[0].transcript;
        else                interim += result[0].transcript;
      }
      rec._lastFinal = final || interim;
      setTranscript(final || interim);
    };

    rec.onend = async () => {
      // If stop() was called, activeRef is false — do not send anything
      if (!activeRef.current) return;
      const text = (rec._lastFinal ?? "").trim();
      if (text.length > 2) {
        await sendToAgent(text);
      } else {
        startListening();
      }
    };

    recognitionRef.current = rec;
    rec.start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Send to gateway via SSE ───────────────────────────────────────────────

  const sendToAgent = useCallback(async (text: string) => {
    if (!text.trim()) return;
    playbackCancelRef.current = false;  // reset once per turn before any audio
    setStatus("processing");
    setTranscript("");
    setThinkingSteps([]);

    const newTurns: Turn[] = [...turnsRef.current, { role: "user", text }];
    setTurns(newTurns);

    const historyForServer =
      sessionIdRef.current != null
        ? []
        : newTurns.slice(-10).map((t) => ({
            role: t.role === "user" ? "user" : "assistant",
            content: t.text,
          }));

    const collectedThoughts: string[] = [];
    let replyText = "";
    let ttsText = "";
    // Preamble plays concurrently while agent fetches data
    let preambleAudioPromise: Promise<void> | null = null;

    try {
      const res = await fetch("/api/gateway/voice/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history:
            sessionIdRef.current != null
              ? historyForServer
              : historyForServer.slice(0, -1),
          session_id: sessionIdRef.current ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Gateway returned ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break outer;
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "meta" && typeof evt.session_id === "number") {
              setSessionId(evt.session_id as number);
            } else if (evt.type === "preamble") {
              // Speak preamble immediately via ElevenLabs — don't await, runs in parallel
              setStatus("speaking");
              preambleAudioPromise = playElevenLabs(evt.text as string).then(() => {
                // Once preamble finishes, switch back to processing if still working
                if (activeRef.current && statusRef.current === "speaking") {
                  setStatus("processing");
                }
              });
            } else if (evt.type === "tool_call") {
              setStatus("processing");
              collectedThoughts.push(evt.label as string);
              setThinkingSteps([...collectedThoughts]);
            } else if (evt.type === "reply") {
              replyText = (evt.text as string) || "";
              const alt = typeof evt.tts_text === "string" ? evt.tts_text.trim() : "";
              ttsText = alt || replyText;
            } else if (evt.type === "error") {
              throw new Error(evt.message as string);
            }
          } catch (parseErr: any) {
            if (parseErr?.message?.startsWith("Gateway")) throw parseErr;
            // malformed SSE line — ignore
          }
        }
      }
    } catch (e: any) {
      setError("Error: " + e.message);
      setStatus("idle");
      setThinkingSteps([]);
      return;
    }

    // Wait for preamble audio to finish before playing reply
    if (preambleAudioPromise) await preambleAudioPromise;

    // Add agent turn with thought process
    setThinkingSteps([]);
    setTurns((prev) => [
      ...prev,
      { role: "agent", text: replyText || "(no response)", thoughts: collectedThoughts },
    ]);

    // Spoken layer: human summary (tts_text) — on-screen already shows full replyText
    if (ttsText && !playbackCancelRef.current) {
      setStatus("speaking");
      await playElevenLabs(ttsText);
    }

    // Always transition back to listening (covers barge-in path too)
    stopPlayback();
    if (activeRef.current) {
      setStatus("listening");
      startListening();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startListening, stopPlayback]);

  // ── Start / stop ──────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    setError(null);
    setTurns([]);
    setThinkingSteps([]);
    activeRef.current = true;
    await startAnalyser();
    startListening();
  }, [startAnalyser, startListening]);

  const stop = useCallback(() => {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
    activeRef.current = false;
    cancelAnimationFrame(animFrameRef.current);
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    // Clear buffered transcript so onend doesn't send a partial utterance
    if (recognitionRef.current) recognitionRef.current._lastFinal = "";
    recognitionRef.current?.stop();
    streamRef.current?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    audioCtxRef.current?.close();
    stopPlayback();
    setStatus("idle");
    setLevel(0);
    setTranscript("");
    setThinkingSteps([]);
  }, [stopPlayback]);

  useEffect(() => () => stop(), [stop]);

  const isActive = status !== "idle";

  const statusLabel: Record<AgentStatus, string> = {
    idle:       "Tap to start",
    listening:  "Listening…",
    processing: "Thinking…",
    speaking:   "Speaking…",
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <h1 className="text-sm font-semibold text-white">Voice Mode</h1>
        <a href="/chat" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
          Switch to text chat →
        </a>
      </div>

      {/* HITL approval banner */}
      <HitlBanner items={pendingActions} onResolved={fetchPending} />

      <div className="flex flex-1 overflow-hidden">
        {/* Left: ring + controls */}
        <div className="flex flex-col items-center justify-center gap-6 flex-1 px-8">
          <button
            onClick={isActive ? stop : start}
            className="group relative focus:outline-none"
            aria-label={isActive ? "Stop voice agent" : "Start voice agent"}
          >
            <Ring status={status} level={level} />
          </button>

          <p className="text-sm text-zinc-400 font-medium">{statusLabel[status]}</p>

          {status === "processing" && thinkingSteps.length > 0 && (
            <p className="text-xs text-amber-400/80 italic animate-pulse">
              {thinkingSteps[thinkingSteps.length - 1]}…
            </p>
          )}

          {transcript && (
            <p className="max-w-xs text-center text-sm text-zinc-500 italic">
              &ldquo;{transcript}&rdquo;
            </p>
          )}

          {error && (
            <p className="max-w-xs text-center text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {isActive && (
            <button
              onClick={stop}
              className="rounded-full border border-zinc-700 px-5 py-2 text-xs text-zinc-400 hover:bg-zinc-800 transition-colors"
            >
              End conversation
            </button>
          )}
        </div>

        {/* Right: transcript with thought bubbles */}
        {(turns.length > 0 || thinkingSteps.length > 0) && (
          <div className="w-80 flex-shrink-0 border-l border-zinc-800 overflow-auto flex flex-col">
            <div className="border-b border-zinc-800 px-4 py-3">
              <p className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Transcript</p>
            </div>
            <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
              {turns.map((t, i) => (
                <div key={i} className={`flex flex-col gap-1 ${t.role === "user" ? "items-end" : "items-start"}`}>
                  {/* Tool thought process (agent turns only) */}
                  {t.role === "agent" && t.thoughts && t.thoughts.length > 0 && (
                    <ThoughtBubble steps={t.thoughts} />
                  )}
                  {/* Message bubble */}
                  <div
                    className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                      t.role === "user"
                        ? "bg-indigo-600/70 text-white"
                        : "bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    {t.text}
                  </div>
                </div>
              ))}

              {/* Live thinking indicator */}
              {thinkingSteps.length > 0 && status === "processing" && (
                <ThinkingRow steps={thinkingSteps} />
              )}

              <div ref={transcriptEndRef} />
            </div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { stroke-dashoffset: 0 } to { stroke-dashoffset: -80 } }`}</style>
    </div>
  );
}
