export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function prefersReducedMotion() {
  if (typeof window === "undefined") return true;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function springStep(
  current: number,
  target: number,
  velocity: number,
  stiffness: number,
  damping: number,
) {
  const force = (target - current) * stiffness;
  const nextVelocity = (velocity + force) * damping;
  return {
    value: current + nextVelocity,
    velocity: nextVelocity,
  };
}
