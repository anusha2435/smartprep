"use client";

import type { ReactNode } from "react";

export const FILLER_WORDS = [
  "um",
  "uh",
  "like",
  "you know",
  "basically",
  "actually",
  "literally",
  "so",
  "right",
  "okay",
];

const fillerPattern = new RegExp(`\\b(${FILLER_WORDS.map((w) => w.replace(/\s+/g, "\\s+")).join("|")})\\b`, "gi");

export function countFillerWords(text: string) {
  return (text.match(fillerPattern) || []).length;
}

export function HighlightedTranscript({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  text.replace(fillerPattern, (match, _word, offset: number) => {
    if (offset > lastIndex) parts.push(text.slice(lastIndex, offset));
    parts.push(
      <mark key={`${match}-${offset}`} className="filler-highlight">
        {match}
      </mark>
    );
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return <>{parts}</>;
}
