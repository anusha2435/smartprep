// app/api/proctor/route.ts
import { NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "local"
  );
}

function rateLimited(req: Request) {
  const now = Date.now();
  const key = clientKey(req);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_WINDOW;
}

export async function POST(req: Request) {
  if (rateLimited(req)) {
    return NextResponse.json(
      { violation: "none", confidence: "low", note: "Proctor fallback rate limited", model: "disabled" },
      { status: 429 }
    );
  }

  return NextResponse.json({
    violation: "none",
    confidence: "low",
    note: "Cloud proctoring is disabled. Core proctoring runs locally with face-api.js.",
    model: "disabled",
  });
}
