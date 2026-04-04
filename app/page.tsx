"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/* ============================================================
   TYPES
   ============================================================ */
type Session = {
  timestamp: number;
  settings: {
    role: string;
    round: string;
    interviewType: string;
    mode: string;
  };
  report?: {
    relevance: number;
    clarity: number;
    depth: number;
    communication: number;
    confidence: number;
    presence: number;
    verdict: string;
  };
  allMetadata?: { questionNumber: number }[];
  integrityFlags?: number;
};

type CoachSession = {
  timestamp: number;
  settings: { role: string; interviewType: string };
  messages: { sender: string }[];
};

type SkillAverages = {
  communication: number;
  clarity: number;
  depth: number;
  confidence: number;
  presence: number;
  relevance: number;
};

/* ============================================================
   HELPERS
   ============================================================ */
function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} minutes ago`;
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function avgReportScore(report: Session["report"]): number {
  if (!report) return 0;
  return Math.round(
    (report.relevance + report.clarity + report.depth +
      report.communication + report.confidence + report.presence) / 6
  );
}

function getScoreColor(score: number): string {
  if (score >= 80) return "#4ade80";
  if (score >= 65) return "#fbbf24";
  if (score >= 50) return "#f87171";
  return "#ef4444";
}

function getScoreBg(score: number): string {
  if (score >= 80) return "rgba(74,222,128,0.12)";
  if (score >= 65) return "rgba(251,191,36,0.12)";
  return "rgba(248,113,113,0.12)";
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

/* ============================================================
   HOME PAGE
   ============================================================ */
export default function Home() {
  const router = useRouter();

  const [interviewSessions, setInterviewSessions] = useState<Session[]>([]);
  const [coachSession, setCoachSession] = useState<CoachSession | null>(null);
  const [lastInterview, setLastInterview] = useState<Session | null>(null);
  const [skillAverages, setSkillAverages] = useState<SkillAverages | null>(null);
  const [loaded, setLoaded] = useState(false);

  /* ============================================================
     LOAD FROM LOCALSTORAGE
     ============================================================ */
  useEffect(() => {
    try {
      // Load all interview sessions (stored as array)
      const rawSessions = localStorage.getItem("interviewSessions");
      let sessions: Session[] = [];

      if (rawSessions) {
        sessions = JSON.parse(rawSessions);
      } else {
        // Fallback — try the single lastInterviewSession key
        const lastRaw = localStorage.getItem("lastInterviewSession");
        if (lastRaw) {
          const last = JSON.parse(lastRaw);
          sessions = [last];
        }
      }

      // Sort newest first
      sessions.sort((a, b) => b.timestamp - a.timestamp);
      setInterviewSessions(sessions);

      // Last interview for resume banner
      if (sessions.length > 0) setLastInterview(sessions[0]);

      // Coach session
      const coachRaw = localStorage.getItem("lastCoachSession");
      if (coachRaw) setCoachSession(JSON.parse(coachRaw));

      // Skill averages across all sessions that have reports
      const withReports = sessions.filter((s) => s.report);
      if (withReports.length > 0) {
        const avg = (key: keyof NonNullable<Session["report"]>) =>
          Math.round(withReports.reduce((sum, s) => sum + (s.report?.[key] as number || 0), 0) / withReports.length);

        setSkillAverages({
          communication: avg("communication"),
          clarity: avg("clarity"),
          depth: avg("depth"),
          confidence: avg("confidence"),
          presence: avg("presence"),
          relevance: avg("relevance"),
        });
      }
    } catch { }

    setLoaded(true);
  }, []);

  /* ============================================================
     DERIVED METRICS
     ============================================================ */
  const sessionsDone = interviewSessions.length;

  const avgScore = interviewSessions.filter((s) => s.report).length > 0
    ? Math.round(
        interviewSessions
          .filter((s) => s.report)
          .reduce((sum, s) => sum + avgReportScore(s.report), 0) /
        interviewSessions.filter((s) => s.report).length
      )
    : null;

  const bestSession = interviewSessions
    .filter((s) => s.report)
    .reduce<Session | null>((best, s) => {
      if (!best) return s;
      return avgReportScore(s.report) > avgReportScore(best.report) ? s : best;
    }, null);

  const coachMessages = coachSession?.messages?.length || 0;

  const lastQuestionNum = lastInterview?.allMetadata?.length || 0;

  /* ============================================================
     RENDER
     ============================================================ */
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#f0f0f0",
        fontFamily: "'DM Sans', 'Inter', sans-serif",
        padding: "0",
      }}
    >
      {/* ---- TOP NAV ---- */}
      <nav style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "18px 32px",
        borderBottom: "1px solid #1e1e1e",
        position: "sticky",
        top: 0,
        background: "#0a0a0a",
        zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "18px", fontWeight: 700, color: "#fff" }}>Smart</span>
          <span style={{ fontSize: "18px", fontWeight: 700, color: "#3b82f6" }}>Prep</span>
          <span style={{ fontSize: "18px", fontWeight: 400, color: "#666" }}> AI</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span style={{
            fontSize: "12px",
            padding: "4px 12px",
            border: "1px solid #3b82f6",
            borderRadius: "20px",
            color: "#3b82f6",
          }}>Free plan</span>
          <div style={{
            width: "32px", height: "32px", borderRadius: "50%",
            background: "#1d4ed8", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: "13px", fontWeight: 600,
          }}>U</div>
        </div>
      </nav>

      <div style={{ maxWidth: "780px", margin: "0 auto", padding: "32px 24px 64px" }}>

        {/* ---- GREETING ---- */}
        <div style={{ marginBottom: "28px" }}>
          <h1 style={{ fontSize: "26px", fontWeight: 700, marginBottom: "6px" }}>
            {getGreeting()} 👋
          </h1>
          <p style={{ color: "#888", fontSize: "14px" }}>
            {sessionsDone > 0
              ? `You have ${sessionsDone} session${sessionsDone > 1 ? "s" : ""} completed. Keep practicing to improve your score.`
              : "Welcome to SmartPrep. Start your first session below."}
          </p>
        </div>

        {/* ---- METRIC CARDS ---- */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px",
          marginBottom: "24px",
        }}>
          {[
            { label: "SESSIONS DONE", value: sessionsDone, sub: "all time" },
            { label: "AVG SCORE", value: avgScore !== null ? `${avgScore}%` : "—", sub: sessionsDone > 0 ? "across sessions" : "no data yet" },
            { label: "BEST ROUND", value: bestSession?.settings?.round || "—", sub: bestSession ? `score ${avgReportScore(bestSession.report)}%` : "no data yet" },
            { label: "COACH CHATS", value: coachMessages || "—", sub: "total messages" },
          ].map((card) => (
            <div key={card.label} style={{
              background: "#111",
              border: "1px solid #1e1e1e",
              borderRadius: "12px",
              padding: "16px",
            }}>
              <p style={{ fontSize: "10px", color: "#555", letterSpacing: "0.08em", marginBottom: "8px" }}>
                {card.label}
              </p>
              <p style={{ fontSize: "22px", fontWeight: 700, color: "#fff", marginBottom: "2px" }}>
                {card.value}
              </p>
              <p style={{ fontSize: "11px", color: "#555" }}>{card.sub}</p>
            </div>
          ))}
        </div>

        {/* ---- RESUME LAST SESSION BANNER ---- */}
        {lastInterview && (
          <div
            onClick={() => router.push("/settings?mode=interview")}
            style={{
              background: "#111",
              border: "1px solid #2a2a2a",
              borderRadius: "12px",
              padding: "16px 20px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              cursor: "pointer",
              transition: "border-color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#3b82f6")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <div style={{
                width: "36px", height: "36px", borderRadius: "50%",
                background: "#1e2a3a", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: "16px",
              }}>▶</div>
              <div>
                <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "3px" }}>
                  Resume last session
                </p>
                <p style={{ fontSize: "12px", color: "#666" }}>
                  {lastInterview.settings?.role || "Interview"} ·{" "}
                  {lastInterview.settings?.round || "Round"} ·{" "}
                  {timeAgo(lastInterview.timestamp)} ·{" "}
                  Q{lastQuestionNum} of 6
                </p>
              </div>
            </div>
            <button style={{
              background: "transparent",
              border: "1px solid #3b82f6",
              borderRadius: "8px",
              padding: "8px 16px",
              color: "#3b82f6",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}>
              Continue →
            </button>
          </div>
        )}

        {/* ---- TWO MAIN CTAs ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "32px" }}>

          {/* Mock Interview */}
          <div
            onClick={() => router.push("/settings?mode=interview")}
            style={{
              background: "#0f1929",
              border: "2px solid #1d4ed8",
              borderRadius: "14px",
              padding: "24px",
              cursor: "pointer",
              transition: "border-color 0.2s, background 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#3b82f6";
              e.currentTarget.style.background = "#111e30";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "#1d4ed8";
              e.currentTarget.style.background = "#0f1929";
            }}
          >
            <div style={{
              width: "40px", height: "40px", borderRadius: "10px",
              background: "#1d4ed8", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: "18px", marginBottom: "14px",
            }}>🎯</div>
            <p style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginBottom: "8px" }}>
              Mock Interview
            </p>
            <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px", lineHeight: "1.5" }}>
              6-question timed session with scoring, camera, and full report.
            </p>
            <p style={{ fontSize: "13px", color: "#3b82f6", fontWeight: 500 }}>
              Start session ↗
            </p>
          </div>

          {/* AI Coach */}
          <div
            onClick={() => router.push("/settings?mode=coach")}
            style={{
              background: "#111",
              border: "1px solid #2a2a2a",
              borderRadius: "14px",
              padding: "24px",
              cursor: "pointer",
              transition: "border-color 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#4ade80")}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#2a2a2a")}
          >
            <div style={{
              width: "40px", height: "40px", borderRadius: "10px",
              background: "#14532d", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: "18px", marginBottom: "14px",
            }}>💬</div>
            <p style={{ fontSize: "16px", fontWeight: 700, color: "#fff", marginBottom: "8px" }}>
              AI Coach
            </p>
            <p style={{ fontSize: "13px", color: "#6b7280", marginBottom: "16px", lineHeight: "1.5" }}>
              Chat with your AI coach for tips, feedback, or answer practice.
            </p>
            <p style={{ fontSize: "13px", color: "#4ade80", fontWeight: 500 }}>
              Open coach ↗
            </p>
          </div>
        </div>

        {/* ---- BOTTOM SECTION: Recent Sessions + Skill Breakdown ---- */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px" }}>

          {/* Recent Sessions */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>Recent sessions</p>
              {interviewSessions.length > 3 && (
                <button
                  onClick={() => {}}
                  style={{ fontSize: "12px", color: "#3b82f6", background: "none", border: "none", cursor: "pointer" }}
                >
                  see all →
                </button>
              )}
            </div>

            {interviewSessions.length === 0 ? (
              <div style={{
                background: "#111", border: "1px solid #1e1e1e", borderRadius: "10px",
                padding: "20px", textAlign: "center",
              }}>
                <p style={{ color: "#555", fontSize: "13px" }}>No sessions yet. Start your first interview above.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {interviewSessions.slice(0, 4).map((s, i) => {
                  const score = s.report ? avgReportScore(s.report) : null;
                  const isToday = new Date(s.timestamp).toDateString() === new Date().toDateString();
                  return (
                    <div
                      key={i}
                      onClick={() => {
                        if (s.report) {
                          sessionStorage.setItem("interviewReport", JSON.stringify(s.report));
                          router.push("/report");
                        }
                      }}
                      style={{
                        background: "#111",
                        border: "1px solid #1e1e1e",
                        borderRadius: "10px",
                        padding: "12px 14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        cursor: s.report ? "pointer" : "default",
                        transition: "border-color 0.15s",
                      }}
                      onMouseEnter={(e) => { if (s.report) e.currentTarget.style.borderColor = "#333"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#1e1e1e"; }}
                    >
                      <div style={{
                        width: "36px", height: "36px", borderRadius: "8px",
                        background: s.settings?.mode === "coach" ? "#14532d" : "#1e2a3a",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "16px", flexShrink: 0,
                      }}>
                        {s.settings?.mode === "coach" ? "💬" : "🎯"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: "13px", fontWeight: 600, color: "#e5e7eb", marginBottom: "2px" }}>
                          {s.settings?.role || "Interview"} · {s.settings?.round || "Session"}
                        </p>
                        <p style={{ fontSize: "11px", color: "#555" }}>
                          {isToday ? `Today, ${formatTime(s.timestamp)}` : timeAgo(s.timestamp)}
                        </p>
                      </div>
                      {score !== null && (
                        <div style={{
                          padding: "4px 10px",
                          borderRadius: "20px",
                          background: getScoreBg(score),
                          color: getScoreColor(score),
                          fontSize: "12px",
                          fontWeight: 700,
                          flexShrink: 0,
                        }}>
                          {score}%
                        </div>
                      )}
                      {s.report && (
                        <span style={{ color: "#444", fontSize: "12px" }}>›</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Skill Breakdown */}
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "14px" }}>
              Skill breakdown
            </p>

            {!skillAverages ? (
              <div style={{
                background: "#111", border: "1px solid #1e1e1e", borderRadius: "10px",
                padding: "20px", textAlign: "center",
              }}>
                <p style={{ color: "#555", fontSize: "13px" }}>Complete an interview to see your skill breakdown.</p>
              </div>
            ) : (
              <div style={{
                background: "#111",
                border: "1px solid #1e1e1e",
                borderRadius: "10px",
                padding: "16px 18px",
                display: "flex",
                flexDirection: "column",
                gap: "14px",
              }}>
                {[
                  { label: "Communication", value: skillAverages.communication, color: "#3b82f6" },
                  { label: "Depth", value: skillAverages.depth, color: "#a78bfa" },
                  { label: "Clarity", value: skillAverages.clarity, color: "#4ade80" },
                  { label: "Confidence", value: skillAverages.confidence, color: "#fbbf24" },
                  { label: "Presence", value: skillAverages.presence, color: "#60a5fa" },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                      <span style={{ fontSize: "12px", color: "#9ca3af" }}>{label}</span>
                      <span style={{ fontSize: "12px", fontWeight: 600, color: "#fff" }}>{value}%</span>
                    </div>
                    <div style={{ height: "4px", background: "#1e1e1e", borderRadius: "4px", overflow: "hidden" }}>
                      <div style={{
                        height: "100%",
                        width: `${value}%`,
                        background: color,
                        borderRadius: "4px",
                        transition: "width 0.6s ease",
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>
    </main>
  );
}
