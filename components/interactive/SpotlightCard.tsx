"use client";

import { motion, useMotionValue, useSpring } from "framer-motion";
import { type CSSProperties, type HTMLAttributes, type ReactNode, useRef } from "react";
import { cn } from "./utils";

export type SpotlightCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  spotlightSize?: number;
  spotlightColor?: string;
};

export function SpotlightCard({
  children,
  className,
  spotlightSize = 360,
  spotlightColor = "rgba(59,130,246,0.18)",
  style,
  onMouseMove,
  ...props
}: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  const springConfig = { damping: 20, stiffness: 150 };
  const x = useSpring(mouseX, springConfig);
  const y = useSpring(mouseY, springConfig);

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    onMouseMove?.(event);
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mouseX.set(event.clientX - rect.left);
    mouseY.set(event.clientY - rect.top);
  }

  return (
    <motion.div
      ref={ref}
      className={cn("reactive-spotlight-card premium-card relative overflow-hidden rounded-2xl p-6", className)}
      style={
        {
          "--spotlight-size": `${spotlightSize}px`,
          "--spotlight-color": spotlightColor,
          "--spotlight-x": x.get() + "px",
          "--spotlight-y": y.get() + "px",
          ...style,
        } as any
      }
      onMouseMove={handleMouseMove}
      {...props}
    >
      <motion.div 
        className="pointer-events-none absolute inset-0 z-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(circle var(--spotlight-size) at var(--spotlight-x) var(--spotlight-y), var(--spotlight-color), transparent 70%)`
        } as any}
      />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}
