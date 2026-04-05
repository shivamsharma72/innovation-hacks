"use client";

import { useEffect, useState } from "react";
import Spline from "@splinetool/react-spline";

function SplineLoading() {
  return (
    <div
      className="flex h-full w-full min-h-[12rem] animate-pulse items-center justify-center bg-gradient-to-b from-zinc-800/40 to-zinc-950/80"
      aria-hidden
    />
  );
}

export function SplineHero({
  scene,
  className,
}: {
  scene: string;
  className?: string;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
  }, []);

  if (!ready) {
    return <SplineLoading />;
  }

  return <Spline scene={scene} className={className} renderOnDemand />;
}
