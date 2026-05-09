"use client";

import { type HTMLAttributes, useEffect, useMemo, useState } from "react";
import { cn } from "./utils";

export type UseDecryptingTextOptions = {
  text: string;
  speed?: number;
  delay?: number;
  symbols?: string;
  startOnMount?: boolean;
};

export type DecryptingTextProps = HTMLAttributes<HTMLSpanElement> & UseDecryptingTextOptions;

const DEFAULT_SYMBOLS = "!<>-_\\/[]{}=*^?#________";

export function useDecryptingText({
  text,
  speed = 28,
  delay = 0,
  symbols = DEFAULT_SYMBOLS,
  startOnMount = true,
}: UseDecryptingTextOptions) {
  const [display, setDisplay] = useState(startOnMount ? "" : text);
  const symbolList = useMemo(() => symbols.split(""), [symbols]);

  useEffect(() => {
    if (!startOnMount) {
      setDisplay(text);
      return;
    }

    let frame = 0;
    let timeout = 0;
    let iteration = 0;
    const maxIterations = text.length + 8;

    function tick() {
      iteration += 1;
      setDisplay(
        text
          .split("")
          .map((char, index) => {
            if (char === " ") return " ";
            if (index < iteration - 8) return char;
            return symbolList[Math.floor(Math.random() * symbolList.length)] || char;
          })
          .join(""),
      );

      if (iteration <= maxIterations) {
        timeout = window.setTimeout(() => {
          frame = requestAnimationFrame(tick);
        }, speed);
      } else {
        setDisplay(text);
      }
    }

    timeout = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delay);

    return () => {
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [delay, speed, startOnMount, symbolList, text]);

  return display;
}

export function DecryptingText({
  text,
  speed,
  delay,
  symbols,
  startOnMount,
  className,
  ...props
}: DecryptingTextProps) {
  const display = useDecryptingText({ text, speed, delay, symbols, startOnMount });
  return (
    <span className={cn("inline-block tabular-nums", className)} aria-label={text} {...props}>
      {display}
    </span>
  );
}
