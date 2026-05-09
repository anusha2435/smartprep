"use client";

import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { clamp, cn, prefersReducedMotion, springStep } from "./utils";

export type MagneticProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  strength?: number;
  range?: number;
  scale?: number;
  disabled?: boolean;
};

export function Magnetic({
  children,
  className,
  style,
  strength = 0.32,
  range = 120,
  scale = 1.03,
  disabled = false,
}: MagneticProps) {
  const ref = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0, scale: 1 });
  const current = useRef({ x: 0, y: 0, scale: 1 });
  const velocity = useRef({ x: 0, y: 0, scale: 0 });

  useEffect(() => {
    if (!ref.current || disabled || prefersReducedMotion()) return;
    const element = ref.current;

    let raf = 0;

    function onPointerMove(event: PointerEvent) {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = event.clientX - centerX;
      const dy = event.clientY - centerY;
      const distance = Math.hypot(dx, dy);
      const pull = clamp(1 - distance / range, 0, 1);

      target.current.x = dx * strength * pull;
      target.current.y = dy * strength * pull;
      target.current.scale = 1 + (scale - 1) * pull;
    }

    function onPointerLeave() {
      target.current = { x: 0, y: 0, scale: 1 };
    }

    function animate() {
      const x = springStep(current.current.x, target.current.x, velocity.current.x, 0.12, 0.72);
      const y = springStep(current.current.y, target.current.y, velocity.current.y, 0.12, 0.72);
      const nextScale = springStep(current.current.scale, target.current.scale, velocity.current.scale, 0.1, 0.74);
      current.current = { x: x.value, y: y.value, scale: nextScale.value };
      velocity.current = { x: x.velocity, y: y.velocity, scale: nextScale.velocity };
      element.style.transform = `translate3d(${current.current.x}px, ${current.current.y}px, 0) scale(${current.current.scale})`;
      raf = requestAnimationFrame(animate);
    }

    element.addEventListener("pointermove", onPointerMove, { passive: true });
    element.addEventListener("pointerleave", onPointerLeave);
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerleave", onPointerLeave);
      element.style.transform = "";
    };
  }, [disabled, range, scale, strength]);

  return (
    <div ref={ref} className={cn("inline-block will-change-transform", className)} style={style}>
      {children}
    </div>
  );
}
