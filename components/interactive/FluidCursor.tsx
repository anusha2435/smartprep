"use client";

import { useEffect, useRef } from "react";
import { cn, prefersReducedMotion, springStep } from "./utils";

export type FluidCursorProps = {
  enabled?: boolean;
  snapSelector?: string;
  dotClassName?: string;
  ringClassName?: string;
  className?: string;
};

type Point = { x: number; y: number };

const DEFAULT_SNAP_SELECTOR =
  'a, button, [role="button"], input, textarea, select, summary, [data-cursor-snap="true"]';

export function FluidCursor({
  enabled = true,
  snapSelector = DEFAULT_SNAP_SELECTOR,
  dotClassName,
  ringClassName,
  className,
}: FluidCursorProps) {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const target = useRef<Point>({ x: -100, y: -100 });
  const dot = useRef<Point>({ x: -100, y: -100 });
  const ring = useRef<Point>({ x: -100, y: -100 });
  const dotVelocity = useRef<Point>({ x: 0, y: 0 });
  const ringVelocity = useRef<Point>({ x: 0, y: 0 });
  const ringSize = useRef(34);
  const visible = useRef(false);

  useEffect(() => {
    if (!enabled || prefersReducedMotion() || window.matchMedia?.("(pointer: coarse)").matches) return;

    let raf = 0;
    const bodyCursor = document.body.style.cursor;
    document.body.style.cursor = "none";

    function setVisible(next: boolean) {
      visible.current = next;
      const opacity = next ? "1" : "0";
      if (dotRef.current) dotRef.current.style.opacity = opacity;
      if (ringRef.current) ringRef.current.style.opacity = opacity;
    }

    function move(event: PointerEvent) {
      target.current = { x: event.clientX, y: event.clientY };
      ringSize.current = 34; // Keep it constant and calm

      if (!visible.current) setVisible(true);
    }

    function leave() {
      setVisible(false);
    }

    function animate() {
      const dotX = springStep(dot.current.x, target.current.x, dotVelocity.current.x, 0.12, 0.65);
      const dotY = springStep(dot.current.y, target.current.y, dotVelocity.current.y, 0.12, 0.65);
      const ringX = springStep(ring.current.x, target.current.x, ringVelocity.current.x, 0.04, 0.75);
      const ringY = springStep(ring.current.y, target.current.y, ringVelocity.current.y, 0.04, 0.75);

      dot.current = { x: dotX.value, y: dotY.value };
      ring.current = { x: ringX.value, y: ringY.value };
      dotVelocity.current = { x: dotX.velocity, y: dotY.velocity };
      ringVelocity.current = { x: ringX.velocity, y: ringY.velocity };

      if (dotRef.current) {
        dotRef.current.style.transform = `translate3d(${dot.current.x}px, ${dot.current.y}px, 0) translate(-50%, -50%)`;
      }

      if (ringRef.current) {
        ringRef.current.style.width = `${ringSize.current}px`;
        ringRef.current.style.height = `${ringSize.current}px`;
        ringRef.current.style.transform = `translate3d(${ring.current.x}px, ${ring.current.y}px, 0) translate(-50%, -50%)`;
      }

      raf = requestAnimationFrame(animate);
    }

    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("pointerleave", leave);
      document.body.style.cursor = bodyCursor;
    };
  }, [enabled, snapSelector]);

  if (!enabled) return null;

  return (
    <div className={cn("pointer-events-none fixed inset-0 z-[9999] hidden md:block", className)} aria-hidden="true">
      <div
        ref={ringRef}
        className={cn(
          "fixed left-0 top-0 h-9 w-9 rounded-full border border-blue-300/35 bg-blue-400/10 opacity-0 mix-blend-screen shadow-[0_0_28px_rgba(59,130,246,0.24)] transition-[opacity,width,height] duration-150",
          ringClassName,
        )}
      />
      <div
        ref={dotRef}
        className={cn(
          "fixed left-0 top-0 h-2.5 w-2.5 rounded-full bg-blue-300 opacity-0 shadow-[0_0_18px_rgba(147,197,253,0.85)] transition-opacity duration-150",
          dotClassName,
        )}
      />
    </div>
  );
}
