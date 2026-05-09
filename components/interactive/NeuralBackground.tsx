"use client";

import { type CSSProperties, useEffect, useRef } from "react";
import { cn } from "./utils";

export type NeuralBackgroundProps = {
  className?: string;
  dotColor?: string;
  maskSize?: number;
  opacity?: number;
};

export function NeuralBackground({
  className,
  dotColor = "rgba(148,163,184,0.3)",
  maskSize = 380,
  opacity = 1,
}: NeuralBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);
  const point = useRef({ x: 50, y: 50 });
  const frame = useRef<number | null>(null);

  useEffect(() => {
    function move(event: PointerEvent) {
      point.current = { x: event.clientX, y: event.clientY };
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        ref.current?.style.setProperty("--neural-x", `${point.current.x}px`);
        ref.current?.style.setProperty("--neural-y", `${point.current.y}px`);
      });
    }

    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={cn("neural-background noise-texture pointer-events-none fixed inset-0 z-0 overflow-hidden", className)}
      style={
        {
          "--neural-dot": dotColor,
          "--neural-mask": `${maskSize}px`,
          opacity,
        } as CSSProperties
      }
      aria-hidden="true"
    />
  );
}
