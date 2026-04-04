"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/* ============================================================
   TYPES
   ============================================================ */
type Report = {
  relevance: number;
  clarity: number;
  depth: number;
  communication: number;
  confidence: number;
  presence: number;
  verdict: "Ready to Interview" | "Almost There" | "Needs Practice" | "Not Ready";
  strengths: string;
  weaknesses: string;
  answerBreakdown: AnswerBreakdown[];
  avgAnswerDurationSeconds: number;
  totalFillerWords: number;
  integrityFlags?: number;
  sessionEndedEarly?: boolean;
};

type AnswerBreakdown = {
  questionNumber: number;
  questionText: string;
  relevance: number;
  clarity: number;
  depth: number;
  communication: number;
  confidence: number;
  presence: number;
};

type AnswerMetadata = {
  questionNumber: number;
  questionText: string;
  transcript: string;
  fillerWordCount: number;
  answerDurationSeconds: number;
  idealDurationRange: string;
  skipped?: boolean;
};

/* ============================================================
   HELPERS
   ============================================================ */
function getScoreColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 65) return "text-amber-400";
  if (score >= 50) return "text-red-400";
  return "text-red-600";
}

function getBarColor(score: number): string {
  if (score >= 80) return "bg-green-500";
  if (score >= 65) return "bg-amber-500";
  if (score >= 50) return "bg-red-500";
  return "bg-red-700";
}

function getVerdictStyle(verdict: string) {
  switch (verdict) {
    case "Ready to Interview":
      return { bg: "bg-green-900/30", border: "border-green-700", text: "text-green-400", icon: "✅" };
    case "Almost There":
      return { bg: "bg-amber-900/30", border: "border-amber-700", text: "text-amber-400", icon: "🟡" };
    case "Needs Practice":
      return { bg: "bg-red-900/30", border: "border-red-700", text: "text-red-400", icon: "🔴" };
    case "Not Ready":
      return { bg: "bg-red-900/40", border: "border-red-800", text: "text-red-500", icon: "❌" };
    default:
      return { bg: "bg-gray-900", border: "border-gray-700", text: "text-gray-400", icon: "—" };
  }
}

function avgScore(report: Report): number {
  return Math.round(
    (report.relevance + report.clarity + report.depth +
      report.communication + report.confidence + report.presence) / 6
  );
}

function formatDuration(seconds: number): string {
  if (!seconds) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/* ============================================================
   SCORE CARD
   ============================================================ */
function ScoreCard({ label, score, description }: { label: string; score: number; description: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-400 font-medium">{label}</p>
        <p className={`text-xl font-bold ${getScoreColor(score)}`}>{score}</p>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-1.5 mb-2">
        <div className={`h-1.5 rounded-full transition-all ${getBarColor(score)}`} style={{ width: `${score}%` }} />
      </div>
      <p className="text-xs text-gray-600">{description}</p>
    </div>
  );
}

/* ============================================================
   REPORT PAGE
   ============================================================ */
export default function Report() {
  const router = useRouter();

  const [report, setReport] = useState<Report | null>(null);
  const [metadata, setMetadata] = useState<AnswerMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [expandedQ, setExpandedQ] = useState<number | null>(null);

  /* ============================================================
     LOAD DATA FROM SESSIONSTORAGE
     ============================================================ */
  useEffect(() => {
    // Small delay to ensure sessionStorage is populated after navigation
    const timer = setTimeout(() => {
      const rawReport = sessionStorage.getItem("interviewReport");
      const rawMeta = sessionStorage.getItem("interviewMetadata");
      const flags = sessionStorage.getItem("integrityFlags");

      if (!rawReport) {
        // Try localStorage as fallback
        const lastSession = localStorage.getItem("lastInterviewSession");
        if (lastSession) {
          try {
            const parsed = JSON.parse(lastSession);
            if (parsed.report) {
              setReport({ ...parsed.report, integrityFlags: parsed.integrityFlags || 0 });
              setMetadata(parsed.allMetadata || []);
              setLoading(false);
              return;
            }
          } catch { }
        }
        setNoData(true);
        setLoading(false);
        return;
      }

      try {
        const parsed = JSON.parse(rawReport) as Report;
        if (flags) parsed.integrityFlags = parseInt(flags);
        setReport(parsed);
      } catch {
        setNoData(true);
        setLoading(false);
        return;
      }

      if (rawMeta) {
        try { setMetadata(JSON.parse(rawMeta)); } catch { }
      }

      setLoading(false);
    }, 300);

    return () => clearTimeout(timer);
  }, []);

  /* ============================================================
     ROUTER GUARD — back button
     ============================================================ */
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const handler = () => window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  /* ============================================================
     LOADING
     ============================================================ */
  if (loading) {
    return (
      <main className="flex h-screen bg-black text-white items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-3 animate-pulse">📊</div>
          <p className="text-gray-400 text-sm">Loading your results...</p>
        </div>
      </main>
    );
  }

  /* ============================================================
     NO DATA — interview didn't complete properly
     ============================================================ */
  if (noData || !report) {
    return (
      <main className="flex h-screen bg-black text-white items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">📋</div>
          <h2 className="text-xl font-bold mb-2">No Report Found</h2>
          <p className="text-gray-400 text-sm mb-2">
            The interview may not have completed all 6 questions, or the report data was not saved.
          </p>
          <p className="text-gray-600 text-xs mb-6">
            This usually happens if you refresh the page mid-interview or the interview ended before question 6.
          </p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => router.push("/settings?mode=interview")}
              className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-xl text-sm font-medium"
            >
              Try Again →
            </button>
            <button
              onClick={() => router.push("/")}
              className="px-5 py-2.5 rounded-xl text-sm text-gray-400 border border-gray-700 hover:border-gray-500"
            >
              Home
            </button>
          </div>
        </div>
      </main>
    );
  }

  const overall = avgScore(report);
  const verdictStyle = getVerdictStyle(report.verdict);
  const role = sessionStorage.getItem("role") || "";
  const round = sessionStorage.getItem("round") || "";
  const company = sessionStorage.getItem("company") || "";

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <main className="min-h-screen bg-black text-white">
      <div className="max-w-3xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="mb-8">
          <p className="text-xs text-gray-600 uppercase tracking-wider mb-1">Evaluation Report</p>
          <h1 className="text-2xl font-bold mb-0.5">
            {role || "Interview"} · {round || "Interview"} Round
          </h1>
          {company && <p className="text-sm text-gray-500">{company}</p>}
          {report.sessionEndedEarly && (
            <p className="text-xs text-amber-500 mt-1">⚠️ Session ended early — partial evaluation</p>
          )}
        </div>

        {/* Integrity Warning */}
        {report.integrityFlags && report.integrityFlags > 0 ? (
          <div className="mb-6 bg-red-900/20 border border-red-800 rounded-xl px-4 py-3 flex items-start gap-3">
            <span className="text-red-400 mt-0.5">⚠️</span>
            <div>
              <p className="text-sm text-red-400 font-medium">Session Integrity Flag</p>
              <p className="text-xs text-red-500 mt-0.5">
                {report.integrityFlags} tab switch{report.integrityFlags > 1 ? "es" : ""} detected during this session.
              </p>
            </div>
          </div>
        ) : null}

        {/* Verdict */}
        <div className={`mb-8 rounded-2xl border p-6 text-center ${verdictStyle.bg} ${verdictStyle.border}`}>
          <div className="text-3xl mb-2">{verdictStyle.icon}</div>
          <p className={`text-xl font-bold ${verdictStyle.text}`}>{report.verdict}</p>
          <p className="text-gray-400 text-sm mt-1">
            Overall score: <span className={`font-semibold ${getScoreColor(overall)}`}>{overall}/100</span>
          </p>
        </div>

        {/* 6 Score Cards */}
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Performance Dimensions</h2>
          <div className="grid grid-cols-2 gap-3">
            <ScoreCard label="Relevance" score={report.relevance} description="Did answers address the questions?" />
            <ScoreCard label="Clarity" score={report.clarity} description="Structure, logic, STAR method" />
            <ScoreCard label="Depth" score={report.depth} description="Specific examples, numbers, outcomes" />
            <ScoreCard label="Communication" score={report.communication} description="Vocabulary, professionalism, grammar" />
            <ScoreCard label="Confidence" score={report.confidence} description="Filler words, hesitation, answer length" />
            <ScoreCard label="Presence" score={report.presence} description="Eye contact, posture, facial engagement" />
          </div>
        </div>

        {/* Session Insights */}
        <div className="mb-8 grid grid-cols-2 gap-3">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Avg Answer Duration</p>
            <p className="text-lg font-semibold text-white">{formatDuration(report.avgAnswerDurationSeconds)}</p>
            <p className="text-xs text-gray-600 mt-1">Ideal: {metadata[0]?.idealDurationRange || "90-120s"}</p>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Filler Words Used</p>
            <p className={`text-lg font-semibold ${
              report.totalFillerWords <= 5 ? "text-green-400"
                : report.totalFillerWords <= 15 ? "text-amber-400"
                : "text-red-400"
            }`}>{report.totalFillerWords}</p>
            <p className="text-xs text-gray-600 mt-1">um, uh, like, you know...</p>
          </div>
        </div>

        {/* Strengths */}
        <div className="mb-4 bg-green-900/20 border border-green-800 rounded-xl p-5">
          <p className="text-green-400 text-sm font-semibold mb-3 uppercase tracking-wide">✅ Strengths</p>
          <p className="text-gray-200 text-sm whitespace-pre-line leading-relaxed">{report.strengths}</p>
        </div>

        {/* Weaknesses */}
        <div className="mb-8 bg-amber-900/20 border border-amber-800 rounded-xl p-5">
          <p className="text-amber-400 text-sm font-semibold mb-3 uppercase tracking-wide">⚠️ Areas to Improve</p>
          <p className="text-gray-200 text-sm whitespace-pre-line leading-relaxed">{report.weaknesses}</p>
        </div>

        {/* Per-Answer Breakdown */}
        {report.answerBreakdown && report.answerBreakdown.length > 0 && (
          <div className="mb-8">
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Per-Answer Breakdown</h2>
            <div className="flex flex-col gap-2">
              {report.answerBreakdown.map((q, i) => {
                const qAvg = Math.round(
                  (q.relevance + q.clarity + q.depth + q.communication + q.confidence + q.presence) / 6
                );
                const isExpanded = expandedQ === i;
                const meta = metadata.find((m) => m.questionNumber === q.questionNumber);

                return (
                  <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setExpandedQ(isExpanded ? null : i)}
                      className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-800/50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-500 shrink-0">Q{q.questionNumber}</span>
                        {meta?.skipped && <span className="text-xs text-gray-600 italic">[skipped]</span>}
                        <p className="text-sm text-gray-300 truncate">{q.questionText}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 ml-3">
                        <span className={`text-sm font-semibold ${getScoreColor(qAvg)}`}>{qAvg}</span>
                        <span className="text-gray-600 text-xs">{isExpanded ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 border-t border-gray-800">
                        <div className="grid grid-cols-3 gap-2 mt-3 mb-4">
                          {[
                            { label: "Relevance", score: q.relevance },
                            { label: "Clarity", score: q.clarity },
                            { label: "Depth", score: q.depth },
                            { label: "Communication", score: q.communication },
                            { label: "Confidence", score: q.confidence },
                            { label: "Presence", score: q.presence },
                          ].map(({ label, score }) => (
                            <div key={label}>
                              <div className="flex justify-between mb-1">
                                <span className="text-xs text-gray-600">{label}</span>
                                <span className={`text-xs font-medium ${getScoreColor(score)}`}>{score}</span>
                              </div>
                              <div className="w-full bg-gray-800 rounded-full h-1">
                                <div className={`h-1 rounded-full ${getBarColor(score)}`} style={{ width: `${score}%` }} />
                              </div>
                            </div>
                          ))}
                        </div>

                        {meta && (
                          <div className="flex gap-4 text-xs text-gray-600 border-t border-gray-800 pt-3">
                            <span>⏱ {formatDuration(meta.answerDurationSeconds)}</span>
                            <span>🗣 {meta.fillerWordCount} filler{meta.fillerWordCount !== 1 ? "s" : ""}</span>
                            <span className="text-gray-700">Ideal: {meta.idealDurationRange}</span>
                          </div>
                        )}

                        {meta?.transcript && meta.transcript !== "[SKIPPED]" && (
                          <div className="mt-3 bg-gray-800/50 rounded-lg p-3">
                            <p className="text-xs text-gray-600 mb-1">Your answer</p>
                            <p className="text-xs text-gray-400 leading-relaxed line-clamp-4">{meta.transcript}</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => {
              sessionStorage.removeItem("interviewReport");
              sessionStorage.removeItem("interviewMetadata");
              sessionStorage.removeItem("integrityFlags");
              router.push("/settings?mode=interview");
            }}
            className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-semibold text-sm transition-colors"
          >
            Try Again →
          </button>
          <button
            onClick={() => router.push("/")}
            className="px-6 py-3 rounded-xl text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-colors"
          >
            Home
          </button>
        </div>

      </div>
    </main>
  );
}
