"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from "react";

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export function VoiceButton({ onTranscript, disabled }: Props) {
  const [recording, setRecording] = useState(false);
  const [supported, setSupported] = useState(true);
  const recRef = useRef<any>(null);

  useEffect(() => {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition || null;
    if (!SR) {
      setSupported(false);
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e: any) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      if (transcript) onTranscript(transcript);
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recRef.current = rec;
  }, [onTranscript]);

  if (!supported) {
    return (
      <button
        type="button"
        disabled
        title="Voice input requires Chrome or Edge"
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-700 text-zinc-600 cursor-not-allowed"
      >
        🎙
      </button>
    );
  }

  const toggle = () => {
    if (!recRef.current) return;
    if (recording) {
      recRef.current.stop();
      setRecording(false);
    } else {
      recRef.current.start();
      setRecording(true);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={disabled}
      title={recording ? "Stop recording" : "Start voice input"}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
        recording
          ? "border-red-500 bg-red-500/10 text-red-400 animate-pulse"
          : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      🎙
    </button>
  );
}
