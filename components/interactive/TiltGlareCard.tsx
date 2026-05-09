"use client";

import { type CSSProperties, type HTMLAttributes, type ReactNode, useRef } from "react";
import { clamp, cn } from "./utils";

export type TiltGlareCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  maxTilt?: number;
  glare?: boolean;
};

export function TiltGlareCard({
  children,
  className,
  style,
  maxTilt = 10,
  glare = true,
  onMouseMove,
  onMouseLeave,
  ...props
}: TiltGlareCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef({ rotateX: 0, rotateY: 0, glareX: 50, glareY: 50, opacity: 0 });

  function flush() {
    frame.current = null;
    const card = ref.current;
    if (!card) return;
    card.style.transform = `perspective(900px) rotateX(${latest.current.rotateX}deg) rotateY(${latest.current.rotateY}deg) translateY(-2px)`;
    if (glareRef.current) {
      glareRef.current.style.opacity = `${latest.current.opacity}`;
      glareRef.current.style.background = `radial-gradient(circle at ${latest.current.glareX}% ${latest.current.glareY}%, rgba(255,255,255,0.34), transparent 42%)`;
    }
  }

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    onMouseMove?.(event);
    const rect = event.currentTarget.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;

    latest.current = {
      rotateX: clamp((0.5 - py) * maxTilt * 2, -maxTilt, maxTilt),
      rotateY: clamp((px - 0.5) * maxTilt * 2, -maxTilt, maxTilt),
      glareX: px * 100,
      glareY: py * 100,
      opacity: clamp(Math.abs(px - 0.5) + Math.abs(py - 0.5), 0.12, 0.52),
    };

    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }

  function handleMouseLeave(event: React.MouseEvent<HTMLDivElement>) {
    onMouseLeave?.(event);
    latest.current = { rotateX: 0, rotateY: 0, glareX: 50, glareY: 50, opacity: 0 };
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
  }

  return (
    <div
      ref={ref}
      className={cn("premium-card relative overflow-hidden rounded-2xl p-6 transition-transform duration-200 will-change-transform", className)}
      style={{ transformStyle: "preserve-3d", ...style }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      {...props}
    >
      {glare && <div ref={glareRef} className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-200" />}
      <div className="relative z-10" style={{ transform: "translateZ(36px)" }}>
        {children}
      </div>
    </div>
  );
}
