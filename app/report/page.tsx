// report page
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Report = {
  relevance: number; clarity: number; depth: number; communication: number; confidence: number; presence: number;
  verdict: string; strengths: string; weaknesses: string;
  answerBreakdown: { questionNumber: number; questionText: string; relevance: number; clarity: number; depth: number; communication: number; confidence: number; presence: number }[];
  avgAnswerDurationSeconds: number; totalFillerWords: number;
  integrityFlags?: number;
  cameraViolations?: number;       // NEW
  terminationReason?: string;      // NEW: "tab-switch" | "camera-proctoring"
  sessionEndedEarly?: boolean;
};

type Meta = { questionNumber: number; questionText: string; transcript: string; fillerWordCount: number; answerDurationSeconds: number; idealDurationRange: string; skipped?: boolean; cameraViolationType?: string; cameraViolationNote?: string };

function scoreColor(s: number) { return s >= 80 ? "#4ade80" : s >= 65 ? "#fbbf24" : s >= 50 ? "#f87171" : "#ef4444"; }
function barColor(s: number) { return s >= 80 ? "#16a34a" : s >= 65 ? "#d97706" : s >= 50 ? "#dc2626" : "#991b1b"; }

function verdictStyle(v: string) {
  if (v === "Ready to Interview") return { bg: "rgba(22,163,74,0.1)", border: "#15803d", text: "#4ade80", icon: "✅" };
  if (v === "Almost There") return { bg: "rgba(217,119,6,0.1)", border: "#b45309", text: "#fbbf24", icon: "🟡" };
  if (v === "Needs Practice") return { bg: "rgba(220,38,38,0.1)", border: "#b91c1c", text: "#f87171", icon: "🔴" };
  return { bg: "rgba(153,27,27,0.1)", border: "#7f1d1d", text: "#ef4444", icon: "❌" };
}

function avg(r: Report) { return Math.round((r.relevance + r.clarity + r.depth + r.communication + r.confidence + r.presence) / 6); }
function qAvg(q: Report["answerBreakdown"][0]) { return Math.round((q.relevance + q.clarity + q.depth + q.communication + q.confidence + q.presence) / 6); }
function fmtDur(s: number) { if (!s) return "—"; const m = Math.floor(s / 60); return m === 0 ? `${s}s` : `${m}m ${s % 60}s`; }

function terminationLabel(reason?: string) {
  if (reason === "tab-switch") return "Session terminated: 3 tab switches detected";
  if (reason === "camera-proctoring") return "Session terminated: 3 camera violations detected";
  return "Session ended early";
}

function ScoreCard({ label, score, desc }: { label: string; score: number; desc: string }) {
  return (
    <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "12px", padding: "16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <p style={{ fontSize: "13px", color: "#888" }}>{label}</p>
        <p style={{ fontSize: "22px", fontWeight: 700, color: scoreColor(score) }}>{score}</p>
      </div>
      <div style={{ width: "100%", height: "4px", background: "#1e1e1e", borderRadius: "4px", overflow: "hidden", marginBottom: "8px" }}>
        <div style={{ height: "100%", width: `${score}%`, background: barColor(score), borderRadius: "4px" }} />
      </div>
      <p style={{ fontSize: "11px", color: "#555" }}>{desc}</p>
    </div>
  );
}

export default function Report() {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(null);
  const [metadata, setMetadata] = useState<Meta[]>([]);
  const [loading, setLoading] = useState(true);
  const [noData, setNoData] = useState(false);
  const [expandedQ, setExpandedQ] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const raw = sessionStorage.getItem("interviewReport");
      const rawMeta = sessionStorage.getItem("interviewMetadata");
      const flags = sessionStorage.getItem("integrityFlags");
      const camFlags = sessionStorage.getItem("cameraViolations");
      const termReason = sessionStorage.getItem("terminationReason");

      if (!raw) {
        const lastSession = localStorage.getItem("lastInterviewSession");
        if (lastSession) {
          try {
            const parsed = JSON.parse(lastSession);
            if (parsed.report) {
              setReport({
                ...parsed.report,
                integrityFlags: parsed.integrityFlags || 0,
                cameraViolations: parsed.cameraViolations || 0,
              });
              setMetadata(parsed.allMetadata || []);
              setLoading(false);
              return;
            }
          } catch { }
        }
        setNoData(true); setLoading(false); return;
      }

      try {
        const parsed = JSON.parse(raw) as Report;
        if (flags) parsed.integrityFlags = parseInt(flags);
        if (camFlags) parsed.cameraViolations = parseInt(camFlags);
        if (termReason) parsed.terminationReason = termReason;
        setReport(parsed);
      } catch { setNoData(true); setLoading(false); return; }

      if (rawMeta) { try { setMetadata(JSON.parse(rawMeta)); } catch { } }
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    window.history.pushState(null, "", window.location.href);
    const handler = () => window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  const base = { minHeight: "100vh", background: "#0a0a0a", color: "#f0f0f0", fontFamily: "'DM Sans','Inter',sans-serif" } as React.CSSProperties;
  const centerStyle = { ...base, display: "flex", alignItems: "center", justifyContent: "center" } as React.CSSProperties;

  if (loading) return <main style={centerStyle}><div style={{ textAlign: "center" }}><div style={{ fontSize: "32px", marginBottom: "12px" }}>📊</div><p style={{ color: "#888", fontSize: "14px" }}>Loading your results...</p></div></main>;

  if (noData || !report) return (
    <main style={centerStyle}>
      <div style={{ textAlign: "center", maxWidth: "380px" }}>
        <div style={{ fontSize: "40px", marginBottom: "16px" }}>📋</div>
        <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>No Report Found</h2>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "6px" }}>The interview may not have completed all 6 questions.</p>
        <p style={{ color: "#555", fontSize: "12px", marginBottom: "24px" }}>This usually happens if you refresh mid-interview.</p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button onClick={() => router.push("/settings?mode=interview")} style={{ background: "#1d4ed8", color: "#fff", border: "none", padding: "12px 20px", borderRadius: "10px", fontSize: "14px", cursor: "pointer" }}>Try Again →</button>
          <button onClick={() => router.push("/")} style={{ background: "transparent", color: "#888", border: "1px solid #2a2a2a", padding: "12px 20px", borderRadius: "10px", fontSize: "14px", cursor: "pointer" }}>Home</button>
        </div>
      </div>
    </main>
  );

  const overall = avg(report);
  const vs = verdictStyle(report.verdict);
  const role = sessionStorage.getItem("role") || "";
  const round = sessionStorage.getItem("round") || "";
  const company = sessionStorage.getItem("company") || "";

  const totalViolations = (report.integrityFlags || 0) + (report.cameraViolations || 0);
  const wasTerminated = report.sessionEndedEarly && report.terminationReason;

  return (
    <main style={base}>
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>Evaluation Report</p>
          <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "4px" }}>{role || "Interview"} · {round || "Round"}</h1>
          {company && <p style={{ fontSize: "13px", color: "#666" }}>{company}</p>}
          {report.sessionEndedEarly && (
            <p style={{ fontSize: "12px", color: "#fbbf24", marginTop: "6px" }}>
              ⚠️ {terminationLabel(report.terminationReason)}
            </p>
          )}
        </div>

        {/* INTEGRITY + CAMERA VIOLATION BLOCK */}
        {totalViolations > 0 && (
          <div style={{ background: "rgba(127,29,29,0.15)", border: "1px solid #7f1d1d", borderRadius: "12px", padding: "16px 18px", marginBottom: "24px" }}>
            <p style={{ fontSize: "13px", color: "#f87171", fontWeight: 600, marginBottom: "10px" }}>⚠️ Session Integrity Report</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {(report.integrityFlags || 0) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <p style={{ fontSize: "13px", color: "#fca5a5" }}>Tab switches detected</p>
                    <p style={{ fontSize: "11px", color: "#ef4444", marginTop: "2px" }}>Switching tabs during interview is not permitted</p>
                  </div>
                  <span style={{ fontSize: "20px", fontWeight: 700, color: "#ef4444" }}>{report.integrityFlags}</span>
                </div>
              )}
              {(report.cameraViolations || 0) > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: (report.integrityFlags || 0) > 0 ? "8px" : "0", borderTop: (report.integrityFlags || 0) > 0 ? "1px solid rgba(127,29,29,0.4)" : "none" }}>
                  <div>
                    <p style={{ fontSize: "13px", color: "#fca5a5" }}>Camera violations detected</p>
                    <p style={{ fontSize: "11px", color: "#ef4444", marginTop: "2px" }}>Face absent, looking away, or multiple people detected</p>
                  </div>
                  <span style={{ fontSize: "20px", fontWeight: 700, color: "#ef4444" }}>{report.cameraViolations}</span>
                </div>
              )}
              {wasTerminated && (
                <div style={{ marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(127,29,29,0.4)" }}>
                  <p style={{ fontSize: "12px", color: "#ef4444", fontWeight: 600 }}>
                    ❌ {terminationLabel(report.terminationReason)} — partial evaluation only
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Verdict */}
        <div style={{ background: vs.bg, border: `1px solid ${vs.border}`, borderRadius: "16px", padding: "28px", textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "36px", marginBottom: "8px" }}>{vs.icon}</div>
          <p style={{ fontSize: "20px", fontWeight: 700, color: vs.text, marginBottom: "6px" }}>{report.verdict}</p>
          <p style={{ fontSize: "14px", color: "#888" }}>Overall score: <span style={{ color: scoreColor(overall), fontWeight: 700 }}>{overall}/100</span></p>
        </div>

        {/* 6 Score Cards */}
        <div style={{ marginBottom: "32px" }}>
          <p style={{ fontSize: "12px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px" }}>Performance Dimensions</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <ScoreCard label="Relevance" score={report.relevance} desc="Did answers address the questions?" />
            <ScoreCard label="Clarity" score={report.clarity} desc="Structure, logic, STAR method" />
            <ScoreCard label="Depth" score={report.depth} desc="Specific examples, numbers, outcomes" />
            <ScoreCard label="Communication" score={report.communication} desc="Vocabulary, professionalism, grammar" />
            <ScoreCard label="Confidence" score={report.confidence} desc="Filler words, hesitation, answer length" />
            <ScoreCard label="Presence" score={report.presence} desc="Eye contact, posture, engagement" />
          </div>
        </div>

        {/* Insights */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "32px" }}>
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "12px", padding: "16px" }}>
            <p style={{ fontSize: "11px", color: "#555", marginBottom: "6px" }}>Avg Answer Duration</p>
            <p style={{ fontSize: "20px", fontWeight: 700, color: "#fff" }}>{fmtDur(report.avgAnswerDurationSeconds)}</p>
            <p style={{ fontSize: "11px", color: "#555", marginTop: "4px" }}>Ideal: {metadata[0]?.idealDurationRange || "90-120s"}</p>
          </div>
          <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "12px", padding: "16px" }}>
            <p style={{ fontSize: "11px", color: "#555", marginBottom: "6px" }}>Filler Words Used</p>
            <p style={{ fontSize: "20px", fontWeight: 700, color: scoreColor(report.totalFillerWords <= 5 ? 80 : report.totalFillerWords <= 15 ? 65 : 40) }}>{report.totalFillerWords}</p>
            <p style={{ fontSize: "11px", color: "#555", marginTop: "4px" }}>um, uh, like, you know...</p>
          </div>
        </div>

        {/* Strengths */}
        <div style={{ background: "rgba(22,163,74,0.08)", border: "1px solid #15803d", borderRadius: "12px", padding: "20px", marginBottom: "12px" }}>
          <p style={{ fontSize: "11px", color: "#4ade80", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>✅ Strengths</p>
          <p style={{ fontSize: "13px", color: "#d1fae5", whiteSpace: "pre-line", lineHeight: 1.7 }}>{report.strengths}</p>
        </div>

        {/* Weaknesses */}
        <div style={{ background: "rgba(217,119,6,0.08)", border: "1px solid #b45309", borderRadius: "12px", padding: "20px", marginBottom: "32px" }}>
          <p style={{ fontSize: "11px", color: "#fbbf24", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>⚠️ Areas to Improve</p>
          <p style={{ fontSize: "13px", color: "#fef3c7", whiteSpace: "pre-line", lineHeight: 1.7 }}>{report.weaknesses}</p>
        </div>

        {/* Per-Answer Breakdown */}
        {report.answerBreakdown?.length > 0 && (
          <div style={{ marginBottom: "32px" }}>
            <p style={{ fontSize: "12px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "16px" }}>Per-Answer Breakdown</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {report.answerBreakdown.map((q, i) => {
                const qa = qAvg(q);
                const isExp = expandedQ === i;
                const meta = metadata.find(m => m.questionNumber === q.questionNumber);
                return (
                  <div key={i} style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "12px", overflow: "hidden" }}>
                    <button onClick={() => setExpandedQ(isExp ? null : i)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                        <span style={{ fontSize: "11px", color: "#555", flexShrink: 0 }}>Q{q.questionNumber}</span>
                        {meta?.skipped && <span style={{ fontSize: "11px", color: "#666", fontStyle: "italic" }}>[skipped]</span>}
                        {meta?.cameraViolationType && meta.cameraViolationType !== "none" && (
                          <span style={{ fontSize: "11px", color: "#ef4444", background: "rgba(127,29,29,0.2)", padding: "1px 6px", borderRadius: "4px" }}>
                            📷 {meta.cameraViolationType}
                          </span>
                        )}
                        <p style={{ fontSize: "13px", color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{q.questionText}</p>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", flexShrink: 0, marginLeft: "12px" }}>
                        <span style={{ fontSize: "14px", fontWeight: 700, color: scoreColor(qa) }}>{qa}</span>
                        <span style={{ color: "#444", fontSize: "12px" }}>{isExp ? "▲" : "▼"}</span>
                      </div>
                    </button>
                    {isExp && (
                      <div style={{ padding: "0 16px 16px", borderTop: "1px solid #1e1e1e" }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginTop: "14px", marginBottom: "14px" }}>
                          {[["Relevance", q.relevance], ["Clarity", q.clarity], ["Depth", q.depth], ["Communication", q.communication], ["Confidence", q.confidence], ["Presence", q.presence]].map(([label, score]) => (
                            <div key={String(label)}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <span style={{ fontSize: "11px", color: "#666" }}>{label}</span>
                                <span style={{ fontSize: "11px", fontWeight: 600, color: scoreColor(Number(score)) }}>{score}</span>
                              </div>
                              <div style={{ height: "3px", background: "#1e1e1e", borderRadius: "3px", overflow: "hidden" }}>
                                <div style={{ height: "100%", width: `${score}%`, background: barColor(Number(score)), borderRadius: "3px" }} />
                              </div>
                            </div>
                          ))}
                        </div>
                        {meta && (
                          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", fontSize: "11px", color: "#555", borderTop: "1px solid #1e1e1e", paddingTop: "12px" }}>
                            <span>⏱ {fmtDur(meta.answerDurationSeconds)}</span>
                            <span>🗣 {meta.fillerWordCount} filler{meta.fillerWordCount !== 1 ? "s" : ""}</span>
                            <span>Ideal: {meta.idealDurationRange}</span>
                            {meta.cameraViolationType && meta.cameraViolationType !== "none" && (
                              <span style={{ color: "#ef4444" }}>📷 {meta.cameraViolationNote || meta.cameraViolationType}</span>
                            )}
                          </div>
                        )}
                        {meta?.transcript && meta.transcript !== "[SKIPPED]" && (
                          <div style={{ marginTop: "12px", background: "rgba(255,255,255,0.03)", borderRadius: "8px", padding: "12px" }}>
                            <p style={{ fontSize: "11px", color: "#555", marginBottom: "6px" }}>Your answer</p>
                            <p style={{ fontSize: "12px", color: "#888", lineHeight: 1.6, display: "-webkit-box", WebkitLineClamp: 4, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{meta.transcript}</p>
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
        <div style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() => {
              sessionStorage.removeItem("interviewReport");
              sessionStorage.removeItem("interviewMetadata");
              sessionStorage.removeItem("integrityFlags");
              sessionStorage.removeItem("cameraViolations");
              sessionStorage.removeItem("terminationReason");
              router.push("/settings?mode=interview");
            }}
            style={{ flex: 1, background: "#1d4ed8", color: "#fff", border: "none", padding: "14px", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}
          >
            Try Again →
          </button>
          <button onClick={() => router.push("/")} style={{ padding: "14px 24px", borderRadius: "12px", border: "1px solid #2a2a2a", background: "transparent", color: "#888", fontSize: "14px", cursor: "pointer" }}>
            Home
          </button>
        </div>

      </div>
    </main>
  );
}
