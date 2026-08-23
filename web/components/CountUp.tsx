"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Beat three: the clearing price counts up.
 *
 * Driven by an interval with a hard backstop rather than `requestAnimationFrame`.
 * rAF does not tick in a background tab or under headless capture, and a counter
 * frozen part-way is a worse failure on camera than a slightly less silky tween.
 */
export function CountUp({
  value,
  animate,
  format,
  durationMs = 900,
}: {
  value: bigint;
  animate: boolean;
  format: (v: bigint) => string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(() => (animate ? 0n : value));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const backstop = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      if (backstop.current) clearTimeout(backstop.current);
    };
    stop();
    if (!animate) {
      setShown(value);
      return stop;
    }
    const started = Date.now();
    timer.current = setInterval(() => {
      const p = Math.min((Date.now() - started) / durationMs, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      // Scale through a large integer so bigint precision survives the easing.
      setShown((value * BigInt(Math.round(eased * 1e6))) / 1_000_000n);
      if (p >= 1) stop();
    }, 16);
    backstop.current = setTimeout(() => {
      stop();
      setShown(value);
    }, durationMs + 400);
    return stop;
  }, [value, animate, durationMs]);

  return <>{format(shown)}</>;
}
