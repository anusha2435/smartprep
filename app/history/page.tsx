"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSessions, avgReportScore, SavedSession } from "@/lib/db";
import { ThemeToggle } from "@/lib/theme";

function timeAgo(ts: number) {
  const d = Date.now() - ts, m = Math.floor(d / 60000), h = Math.floor(d / 3600000), dy = Math.floor(d / 86400000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy === 1) return "Yesterday";
  return `${dy}d ago`;
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function scoreColor(s: number) { return s >= 80 ? "var(--success)" : s >= 65 ? "var(--warning)" : s >= 50 ? "var(--danger)" : "var(--danger)"; }
function scoreBg(s: number) { return s >= 80 ? "rgba(74,222,128,0.12)" : s >= 65 ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.12)"; }

function interviewReplay(session: SavedSession) {
  const metadata = session.allMetadata || [];
  if (metadata.length > 0) {
    return metadata.map((m: any) => ({
      question: m.questionText || `Question ${m.questionNumber}`,
      answer: m.transcript || "",
      skipped: Boolean(m.skipped),
    }));
  }

  const turns = session.conversationHistory || [];
  const replay: { question: string; answer: string; skipped?: boolean }[] = [];
  let pendingQuestion = "";
  for (const turn of turns) {
    if (turn.role === "assistant") {
      try {
        const parsed = JSON.parse(turn.content);
        if (parsed.question) pendingQuestion = parsed.question;
      } catch {
        pendingQuestion = String(turn.content || "");
      }
    }
    if (turn.role === "user" && pendingQuestion && turn.content !== "START") {
      replay.push({ question: pendingQuestion, answer: String(turn.content || "") });
      pendingQuestion = "";
    }
  }
  return replay;
}

function MiniChart({ sessions }: { sessions: SavedSession[] }) {
  const scored = sessions
    .filter(s => s.report && s.mode === "interview")
    .slice(0, 10)
    .reverse(); // oldest first for chart

  if (scored.length < 2) return (
    <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)", fontSize: "13px" }}>
      Complete at least 2 interviews to see your progress chart.
    </div>
  );

  const scores = scored.map(s => avgReportScore(s.report));
  const max = 100, min = 0;
  const W = 400, H = 120, PAD = 20;

  const points = scores.map((sc, i) => {
    const x = PAD + (i / (scores.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((sc - min) / (max - min)) * (H - PAD * 2);
    return { x, y, sc };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = `${path} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`;

  const avgSc = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
  const trend = scores[scores.length - 1] - scores[0];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <div>
          <p style={{ fontSize: "13px", color: "var(--muted)" }}>Average score</p>
          <p style={{ fontSize: "28px", fontWeight: 700, color: scoreColor(avgSc) }}>{avgSc}%</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: "13px", color: "var(--muted)" }}>Trend</p>
          <p style={{ fontSize: "20px", fontWeight: 700, color: trend >= 0 ? "var(--success)" : "var(--danger)" }}>
            {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)} pts
          </p>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto" }}>
        {/* Grid lines */}
        {[25, 50, 75].map(y => {
          const yPos = H - PAD - ((y - min) / (max - min)) * (H - PAD * 2);
          return (
            <g key={y}>
              <line x1={PAD} y1={yPos} x2={W - PAD} y2={yPos} stroke="var(--border)" strokeWidth="1" />
              <text x={PAD - 4} y={yPos + 4} fill="var(--muted)" fontSize="9" textAnchor="end">{y}</text>
            </g>
          );
        })}
        {/* Area fill */}
        <path d={area} fill="rgba(59,130,246,0.08)" />
        {/* Line */}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {/* Points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="4" fill="var(--accent)" />
            <text x={p.x} y={p.y - 8} fill={scoreColor(p.sc)} fontSize="9" textAnchor="middle">{p.sc}</text>
          </g>
        ))}
      </svg>
      <p style={{ fontSize: "11px", color: "var(--muted)", textAlign: "center", marginTop: "4px" }}>
        Last {scored.length} interview{scored.length > 1 ? "s" : ""}
      </p>
    </div>
  );
}

export default function History() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [filter, setFilter] = useState<"all" | "interview" | "coach">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setLoadingSessions(true);
    setSessionsError("");
    getSessions(user.uid, 100)
      .then(setSessions)
      .catch(() => setSessionsError("Could not load session history."))
      .finally(() => setLoadingSessions(false));
  }, [user]);

  if (loading) return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <p style={{ color: "var(--muted)", fontSize: "14px", fontFamily: "var(--font-body)" }}>Loading...</p>
    </main>
  );

  if (!user) {
    router.replace("/");
    return null;
  }

  const displayed = sessions.filter(s => filter === "all" || s.mode === filter);
  const interviewSessions = sessions.filter(s => s.mode === "interview");

  function reopenCoachSession(s: SavedSession) {
    localStorage.setItem("lastCoachSession", JSON.stringify(s));
    sessionStorage.setItem("resumeCoachSessionId", s.sessionId);
    sessionStorage.setItem("mode", "coach");
    sessionStorage.setItem("role", s.settings?.role || "Software Engineer");
    sessionStorage.setItem("company", s.settings?.company || "");
    sessionStorage.setItem("interviewType", s.settings?.interviewType || "Behavioral");
    sessionStorage.setItem("difficulty", s.settings?.difficulty || "Mid-Level");
    sessionStorage.setItem("ttsEnabled", "false");
    sessionStorage.setItem("resumeCoachSession", "true");
    router.push("/coach");
  }

  const base: React.CSSProperties = { minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)" };

  return (
    <main style={base}>
      {/* NAV */}
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 32px", borderBottom: "1px solid var(--border)", position: "sticky", top: 0, background: "var(--bg)", zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <button className="btn-animated" onClick={() => router.push("/")} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "13px" }}>← Home</button>
          <div>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--text)" }}>Smart</span>
            <span style={{ fontSize: "16px", fontWeight: 700, color: "var(--accent)" }}>Prep</span>
          </div>
        </div>
        <h1 className="font-heading" style={{ fontSize: "16px", fontWeight: 600, color: "var(--text)" }}>Session History</h1>
        <ThemeToggle />
      </nav>

      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "32px 24px 64px" }}>

        {/* PROGRESS CHART */}
        {sessionsError && (
          <div className="premium-card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: "12px", padding: "12px 16px", marginBottom: "18px" }}>
            <p style={{ color: "var(--danger)", fontSize: "13px" }}>{sessionsError}</p>
          </div>
        )}

        {/* PROGRESS CHART */}
        <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px", marginBottom: "28px" }}>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>Progress charts</p>
          <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>Line graph showing score improvement across interview sessions.</p>
          <MiniChart sessions={sessions} />
        </div>

        {/* SKILL BARS */}
        {interviewSessions.filter(s => s.report).length > 0 && (
          <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "24px", marginBottom: "28px" }}>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "16px" }}>🎯 Skill Averages</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              {(() => {
                const withR = interviewSessions.filter(s => s.report);
                const av = (k: string) => Math.round(withR.reduce((s, x) => s + ((x.report as any)?.[k] || 0), 0) / withR.length);
                return [
                  { label: "Communication", value: av("communication"), color: "var(--accent)" },
                  { label: "Depth", value: av("depth"), color: "var(--accent)" },
                  { label: "Clarity", value: av("clarity"), color: "var(--success)" },
                  { label: "Confidence", value: av("confidence"), color: "var(--warning)" },
                  { label: "Presence", value: av("presence"), color: "var(--accent)" },
                  { label: "Relevance", value: av("relevance"), color: "var(--warning)" },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>{label}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text)" }}>{value}%</span>
                    </div>
                    <div style={{ height: "5px", background: "var(--border)", borderRadius: "4px", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: "4px" }} />
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* FILTER TABS */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          {(["all", "interview", "coach"] as const).map(f => (
            <button className="btn-animated"
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "7px 16px", borderRadius: "8px", fontSize: "13px", cursor: "pointer",
                border: filter === f ? "1px solid var(--accent)" : "1px solid var(--border)",
                background: filter === f ? "rgba(59,130,246,0.1)" : "transparent",
                color: filter === f ? "var(--accent)" : "var(--muted)",
                fontWeight: filter === f ? 600 : 400,
              }}
            >
              {f === "all" ? `All (${sessions.length})` : f === "interview" ? `Interviews (${interviewSessions.length})` : `Coaching (${sessions.filter(s => s.mode === "coach").length})`}
            </button>
          ))}
        </div>

        {/* SESSION LIST */}
        {loadingSessions ? (
          <p style={{ color: "var(--muted)", fontSize: "13px", textAlign: "center", padding: "40px" }}>Loading sessions...</p>
        ) : displayed.length === 0 ? (
          <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "40px", textAlign: "center" }}>
            <p style={{ color: "var(--muted)", fontSize: "13px" }}>No {filter === "all" ? "" : filter} sessions yet.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {displayed.map((s, i) => {
              const sc = s.report ? avgReportScore(s.report) : null;
              const isExpanded = expandedId === s.sessionId;
              return (
                <div key={s.sessionId || i} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", overflow: "hidden" }}>
                  {/* Row */}
                  <div
                    onClick={() => setExpandedId(isExpanded ? null : (s.sessionId || null))}
                    style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }}
                    onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.02)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    <div style={{ width: "36px", height: "36px", borderRadius: "8px", background: s.mode === "coach" ? "var(--success)" : "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>
                      {s.mode === "coach" ? "💬" : "🎯"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--text)", marginBottom: "2px" }}>
                        {s.settings?.role || "Session"} · {s.mode === "coach" ? "Coaching" : (s.settings?.round || "Interview")}
                      </p>
                      <p style={{ fontSize: "11px", color: "var(--muted)" }}>{formatDate(s.timestamp)} · {timeAgo(s.timestamp)}</p>
                    </div>
                    {sc !== null && (
                      <div style={{ padding: "4px 10px", borderRadius: "20px", background: scoreBg(sc), color: scoreColor(sc), fontSize: "12px", fontWeight: 700, flexShrink: 0 }}>{sc}%</div>
                    )}
                    {s.sessionEndedEarly && (
                      <span style={{ fontSize: "11px", color: "var(--warning)", background: "rgba(245,158,11,0.1)", padding: "2px 8px", borderRadius: "20px" }}>Early end</span>
                    )}
                    <span style={{ color: "var(--muted)", fontSize: "13px" }}>{isExpanded ? "▲" : "▼"}</span>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div style={{ padding: "0 16px 16px", borderTop: "1px solid var(--border)" }}>
                      {s.report ? (
                        <>
                          {/* Scores */}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginTop: "14px", marginBottom: "14px" }}>
                            {["relevance", "clarity", "depth", "communication", "confidence", "presence"].map(k => (
                              <div key={k}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                  <span style={{ fontSize: "11px", color: "var(--muted)", textTransform: "capitalize" }}>{k}</span>
                                  <span style={{ fontSize: "11px", fontWeight: 600, color: scoreColor((s.report as any)[k]) }}>{(s.report as any)[k]}</span>
                                </div>
                                <div style={{ height: "3px", background: "var(--border)", borderRadius: "3px", overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${(s.report as any)[k]}%`, background: scoreColor((s.report as any)[k]), borderRadius: "3px" }} />
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{ display: "flex", gap: "10px", marginTop: "12px" }}>
                            <button className="btn-animated"
                              onClick={() => {
                                sessionStorage.setItem("interviewReport", JSON.stringify(s.report));
                                sessionStorage.setItem("interviewMetadata", JSON.stringify(s.allMetadata || []));
                                router.push("/report");
                              }}
                              style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--accent)", color: "var(--text)", fontSize: "13px", cursor: "pointer" }}
                            >
                              View Full Report →
                            </button>
                            <div style={{ fontSize: "11px", color: "var(--muted)", display: "flex", gap: "12px", alignItems: "center" }}>
                              {s.integrityFlags ? <span>⚠️ {s.integrityFlags} flag{s.integrityFlags > 1 ? "s" : ""}</span> : null}
                            </div>
                          </div>
                          {interviewReplay(s).length ? (
                            <div style={{ marginTop: "16px", borderTop: "1px solid var(--border)", paddingTop: "12px" }}>
                              <p style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 700, marginBottom: "8px" }}>Session Replay</p>
                              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "260px", overflowY: "auto" }}>
                                {interviewReplay(s).map((turn, ti: number) => (
                                  <div key={ti} style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px" }}>
                                    <p style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "5px" }}>Question {ti + 1}</p>
                                    <p style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.55, marginBottom: "8px" }}>{turn.question}</p>
                                    <p style={{ fontSize: "10px", color: "var(--accent)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "5px" }}>Candidate answer</p>
                                    <p style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{turn.skipped ? "[Skipped]" : turn.answer}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : s.mode === "coach" && s.messages ? (
                        <div style={{ marginTop: "12px" }}>
                          <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>{s.messages.length} messages in this session</p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "260px", overflowY: "auto" }}>
                            {s.messages.map((m: any, mi: number) => (
                              <div key={mi} style={{ background: m.sender === "user" ? "rgba(59,130,246,0.1)" : "var(--surface-2)", border: "1px solid var(--border)", borderRadius: "8px", padding: "9px 10px" }}>
                                <p style={{ fontSize: "10px", color: m.sender === "user" ? "var(--accent)" : "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "4px" }}>{m.sender === "user" ? "You" : m.type === "feedback" ? "Feedback" : "Coach"}</p>
                                <p style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                                  {m.text || [m.feedback?.strengths, m.feedback?.improve, m.feedback?.betterPhrasing].filter(Boolean).join("\n\n")}
                                </p>
                              </div>
                            ))}
                          </div>
                          <button className="btn-animated"
                            onClick={() => reopenCoachSession(s)}
                            style={{ marginTop: "12px", padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--success)", color: "var(--text)", fontSize: "13px", cursor: "pointer" }}
                          >
                            Reopen Chat →
                          </button>
                        </div>
                      ) : (
                        <p style={{ fontSize: "12px", color: "var(--muted)", marginTop: "12px" }}>No report data available for this session.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
