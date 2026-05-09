"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { changePassword, resetPassword, useAuth, signIn, signUp, signOut } from "@/lib/auth";
import { getSessions, getSkillAverages, avgReportScore, SavedSession } from "@/lib/db";
import { saveUserProfile } from "@/lib/db";
import { ThemeToggle } from "@/lib/theme";
import { DecryptingText, SpotlightCard, TiltCard } from "@/components/interactive";

function timeAgo(ts: number): string {
  const d = Date.now() - ts, m = Math.floor(d / 60000), h = Math.floor(d / 3600000), dy = Math.floor(d / 86400000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (dy === 1) return "Yesterday";
  return `${dy} days ago`;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scoreColor(s: number) { return s >= 80 ? "var(--success)" : s >= 65 ? "var(--warning)" : s >= 50 ? "var(--danger)" : "var(--danger)"; }
function scoreBg(s: number) { return s >= 80 ? "rgba(74,222,128,0.12)" : s >= 65 ? "rgba(251,191,36,0.12)" : "rgba(248,113,113,0.12)"; }

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function DashboardProgress({ sessions }: { sessions: SavedSession[] }) {
  const scored = sessions.filter((s) => s.mode === "interview" && s.report).slice(0, 8).reverse();
  if (scored.length < 2) {
    return (
      <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px", marginBottom: "24px", boxShadow: "var(--shadow-soft)" }}>
        <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)", marginBottom: "6px" }}>Progress chart</p>
        <p style={{ fontSize: "13px", color: "var(--muted)" }}>Complete at least 2 interviews to see your score trend.</p>
      </div>
    );
  }

  const W = 520, H = 150, PAD = 24;
  const scores = scored.map((s) => avgReportScore(s.report));
  const points = scores.map((score, i) => ({
    score,
    x: PAD + (i / Math.max(scores.length - 1, 1)) * (W - PAD * 2),
    y: H - PAD - (score / 100) * (H - PAD * 2),
  }));
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const trend = scores[scores.length - 1] - scores[0];

  return (
    <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "20px", marginBottom: "24px", boxShadow: "var(--shadow-soft)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", marginBottom: "12px" }}>
        <div>
          <p style={{ fontSize: "14px", fontWeight: 700, color: "var(--text)", marginBottom: "4px" }}>Progress chart</p>
          <p style={{ fontSize: "12px", color: "var(--muted)" }}>Score improvement across recent interviews.</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "2px" }}>Trend</p>
          <p style={{ fontSize: "18px", fontWeight: 800, color: trend >= 0 ? "var(--success)" : "var(--danger)" }}>{trend >= 0 ? "+" : ""}{trend} pts</p>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[25, 50, 75].map((tick) => {
          const y = H - PAD - (tick / 100) * (H - PAD * 2);
          return <line key={tick} x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="var(--border)" strokeWidth="1" />;
        })}
        <path d={`${path} L ${points[points.length - 1].x} ${H - PAD} L ${points[0].x} ${H - PAD} Z`} fill="rgba(59,130,246,0.08)" />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="3" />
            <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">{p.score}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/* ============================================================
   AUTH FORM — sign in / sign up
   ============================================================ */
function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%", background: "var(--surface)", border: "1px solid var(--border)",
    borderRadius: "10px", padding: "12px 14px", color: "var(--text)",
    fontSize: "14px", outline: "none", boxSizing: "border-box",
    fontFamily: "var(--font-body)",
  };

  async function handleSubmit() {
    setError("");
    setSuccess("");
    if (mode === "forgot") {
      if (!email.trim()) { setError("Enter your email address."); return; }
      setLoading(true);
      const { error: err } = await resetPassword(email.trim());
      setLoading(false);
      if (err) { setError(err); return; }
      setSuccess("Password reset email sent. Check your inbox.");
      return;
    }
    if (!email.trim() || !password.trim()) { setError("Email and password are required."); return; }
    if (mode === "signup" && !name.trim()) { setError("Please enter your name."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }

    setLoading(true);
    if (mode === "signup") {
      const { error: err } = await signUp(email.trim(), password, name.trim());
      if (err) { setError(err); setLoading(false); return; }
    } else {
      const { error: err } = await signIn(email.trim(), password);
      if (err) { setError(err); setLoading(false); return; }
    }
    setLoading(false);
    // onAuthStateChanged in useAuth() will handle the redirect automatically
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)", display: "flex", flexDirection: "column" }}>
      <nav style={{ padding: "20px 32px", borderBottom: "1px solid var(--border)" }}>
        <div>
          <span style={{ fontSize: "18px", fontWeight: 700, color: "var(--text)" }}>Smart</span>
          <span style={{ fontSize: "18px", fontWeight: 700, color: "var(--accent)" }}>Prep</span>
          <span style={{ fontSize: "18px", color: "var(--muted)" }}> AI</span>
        </div>
      </nav>

      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
        <div style={{ width: "100%", maxWidth: "400px" }}>

          {/* Logo + heading */}
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ fontSize: "44px", marginBottom: "16px" }}>🎤</div>
            <h1 className="font-heading" style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>
              {mode === "signin" ? "Welcome back" : "Create your account"}
            </h1>
            <p style={{ color: "var(--muted)", fontSize: "14px" }}>
              {mode === "signin" ? "Sign in to access your sessions and history." : "Start practicing interviews with AI today."}
            </p>
          </div>

          {/* Form */}
          <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "28px", display: "flex", flexDirection: "column", gap: "16px" }}>

            {mode === "signup" && (
              <div>
                <label style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px", display: "block" }}>Full name</label>
                <input
                  style={inputStyle}
                  placeholder="Your name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit()}
                />
              </div>
            )}

            <div>
              <label style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px", display: "block" }}>Email</label>
              <input
                style={inputStyle}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
              />
            </div>

            {mode !== "forgot" && (
            <div>
              <label style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px", display: "block" }}>Password</label>
              <input
                style={inputStyle}
                type="password"
                placeholder={mode === "signup" ? "At least 6 characters" : "Your password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSubmit()}
              />
            </div>
            )}

            {error && (
              <div className="premium-card" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: "8px", padding: "10px 14px" }}>
                <p style={{ fontSize: "13px", color: "var(--danger)" }}>{error}</p>
              </div>
            )}
            {success && (
              <div className="premium-card" style={{ background: "rgba(22,163,74,0.1)", border: "1px solid rgba(22,163,74,0.3)", borderRadius: "8px", padding: "10px 14px" }}>
                <p style={{ fontSize: "13px", color: "var(--success)" }}>{success}</p>
              </div>
            )}

            <button className="btn-animated"
              onClick={handleSubmit}
              disabled={loading}
              style={{
                width: "100%", padding: "13px", borderRadius: "10px", border: "none",
                background: "var(--accent)", color: "var(--text)", fontSize: "15px", fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
                marginTop: "4px",
              }}
            >
              {loading
                ? (mode === "forgot" ? "Sending..." : mode === "signup" ? "Creating account..." : "Signing in...")
                : (mode === "forgot" ? "Send Reset Email" : mode === "signup" ? "Create Account ->" : "Sign In ->")}
            </button>
          </div>

          {/* Toggle */}
          <p style={{ textAlign: "center", fontSize: "13px", color: "var(--muted)", marginTop: "20px" }}>
            {mode === "signin" ? "Don't have an account? " : "Already have an account? "}
            <button className="btn-animated"
              onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(""); setSuccess(""); }}
              style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: "13px", fontWeight: 600 }}
            >
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>
          {mode !== "signup" && (
            <p style={{ textAlign: "center", marginTop: "8px" }}>
              <button className="btn-animated"
                onClick={() => { setMode(mode === "forgot" ? "signin" : "forgot"); setError(""); setSuccess(""); }}
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "12px", fontWeight: 600 }}
              >
                {mode === "forgot" ? "Back to sign in" : "Forgot password?"}
              </button>
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

/* ============================================================
   MAIN HOME PAGE
   ============================================================ */
export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [mounted, setMounted] = useState(false);

  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState("");
  const [showPasswordPanel, setShowPasswordPanel] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [passwordStatus, setPasswordStatus] = useState("");
  const [showLogout, setShowLogout] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (!user) { setSessions([]); return; }
    saveUserProfile(user.uid, {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
    });
    setLoadingSessions(true);
    setSessionsError("");
    getSessions(user.uid, 50)
      .then(setSessions)
      .catch(() => setSessionsError("Could not load your session history."))
      .finally(() => setLoadingSessions(false));
  }, [user]);

  // Show auth form if not logged in
  if (!loading && !user) return <AuthForm />;

  // Loading spinner
  if (loading) {
    return (
      <main className="min-h-screen bg-[#030712] flex items-center justify-center font-body">
        <p className="text-slate-400 text-sm animate-pulse">Initializing Neural Link...</p>
      </main>
    );
  }

  // Derived data
  const interviewSessions = sessions.filter(s => s.mode === "interview");
  const coachSessions = sessions.filter(s => s.mode === "coach");
  const sessionsDone = sessions.length;
  const scoredSessions = interviewSessions.filter(s => s.report);
  const avgScore = scoredSessions.length > 0
    ? Math.round(scoredSessions.reduce((sum, s) => sum + avgReportScore(s.report), 0) / scoredSessions.length)
    : null;
  const bestSession = scoredSessions.reduce<SavedSession | null>((best, s) =>
    (!best || avgReportScore(s.report) > avgReportScore(best.report)) ? s : best, null);
  const coachMsgs = coachSessions.reduce((sum, s) => sum + (s.messages?.length || 0), 0);
  const skills = getSkillAverages(sessions);

  const lastCoach = coachSessions[0] || null;
  const resumeSession = lastCoach;

  function handleResume() {
    if (!resumeSession) return;
    if (lastCoach) {
      localStorage.setItem("lastCoachSession", JSON.stringify(lastCoach));
      sessionStorage.setItem("resumeCoachSessionId", lastCoach.sessionId);
      sessionStorage.setItem("mode", "coach");
      sessionStorage.setItem("role", lastCoach.settings.role || "");
      sessionStorage.setItem("company", lastCoach.settings.company || "");
      sessionStorage.setItem("interviewType", lastCoach.settings.interviewType || "Behavioral");
      sessionStorage.setItem("difficulty", lastCoach.settings.difficulty || "Mid-Level");
      sessionStorage.setItem("ttsEnabled", "false");
      sessionStorage.setItem("resumeCoachSession", "true");
      router.push("/coach");
    }
  }

  async function handleChangePassword() {
    setPasswordStatus("");
    if (newPassword.length < 6) {
      setPasswordStatus("Password must be at least 6 characters.");
      return;
    }
    const { error } = await changePassword(newPassword);
    setPasswordStatus(error || "Password changed successfully.");
    if (!error) setNewPassword("");
  }

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--text)] font-body selection:bg-blue-500/30 transition-colors duration-300">
      
      {/* BACKGROUND DECOR */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-600/10 blur-[120px] rounded-full" />
      </div>

      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-xl border-b border-[var(--border)] bg-[var(--surface)]">
        <div /> {/* Spacer for centering if needed, or just remove the left element */}
        
        <div className="flex items-center gap-6">
          <ThemeToggle />
          {mounted && (
            <div className="flex items-center gap-4 relative">
              <div className="hidden sm:block text-right">
                <p className="text-[10px] font-black text-[var(--text)] uppercase tracking-wider">{user?.displayName || "Operator"}</p>
              </div>
              
              <div className="relative">
                <button 
                  onClick={() => setShowLogout(!showLogout)}
                  className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-xs font-black ring-2 ring-white/10 shadow-lg hover:ring-white/30 transition-all cursor-pointer"
                >
                  {user?.displayName?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || "U"}
                </button>

                {showLogout && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowLogout(false)} />
                    <div className="absolute right-0 mt-2 w-32 py-1 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl z-50 overflow-hidden">
                      <button 
                        onClick={() => {
                          setShowLogout(false);
                          signOut();
                        }}
                        className="w-full px-4 py-2 text-left text-[10px] font-black text-[var(--muted)] hover:text-[var(--danger)] hover:bg-[var(--text)]/5 transition-colors uppercase tracking-widest"
                      >
                        Logout
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-10 lg:py-16 space-y-16">
        
        {/* 1. GREETING SECTION */}
        <section className="space-y-6">
          <div className="inline-flex items-center gap-3 px-4 py-2 bg-[var(--surface)] border border-[var(--border)] rounded-full w-fit">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse shadow-[0_0_12px_#3b82f6]" />
            <span className="text-[9px] font-black tracking-[0.2em] text-blue-400 uppercase">
              {loadingSessions ? "Fetching Logs..." : `${interviewSessions.length} Interviews Completed`}
            </span>
          </div>
          <h1 className="text-4xl md:text-6xl font-black tracking-tighter leading-tight text-[var(--text)] flex flex-wrap items-baseline gap-x-4">
            <span>{mounted ? greeting() : "Hello"},</span>
            <span className="text-[var(--text)] italic">
              {mounted ? (
                <DecryptingText text={user?.displayName?.split(" ")[0] || "Agent"} speed={30} />
              ) : (
                "Operator"
              )}
            </span>
          </h1>
          <p className="text-base text-[var(--muted)] font-medium max-w-xl tracking-tight">
            Select your deployment module to continue training.
          </p>
        </section>

        {/* 2. GLOBAL METRICS GRID */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: "TOTAL SESSIONS", value: loadingSessions ? "..." : (sessionsDone || "0"), sub: `${interviewSessions.length} INTERVIEW - ${coachSessions.length} COACH`, icon: "🚀" },
            { label: "AVG SCORE", value: loadingSessions ? "..." : (avgScore !== null ? `${avgScore}%` : "—"), sub: "ACROSS SESSIONS", icon: "📊" },
            { label: "BEST ROUND", value: bestSession?.settings?.round || "—", sub: "NO DATA", icon: "🏅" },
            { label: "COACH SESSIONS", value: loadingSessions ? "..." : (coachSessions.length || "0"), sub: `${coachMsgs} COACH MESSAGES`, icon: "🧠" },
          ].map((m) => (
            <SpotlightCard key={m.label} className="hover-glow bg-[var(--surface)] border border-[var(--border)] p-6 flex flex-col justify-between h-36 group relative overflow-hidden rounded-xl">
              <div className="space-y-3">
                <div className="text-2xl">{m.icon}</div>
                <div className="text-[9px] font-black tracking-[0.15em] text-[var(--muted)] uppercase">{m.label}</div>
              </div>
              <div>
                <div className="text-3xl font-black text-[var(--text)] mb-1">{m.value}</div>
                <div className="text-[9px] font-bold text-[var(--subtle)] tracking-wider uppercase">{m.sub}</div>
              </div>
            </SpotlightCard>
          ))}
        </section>

        {/* 3. MAIN ACTION MODULES */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <TiltCard className="hover-glow group cursor-pointer bg-[var(--surface)] border border-[var(--border)] rounded-2xl" maxTilt={5}>
            <div className="p-10 space-y-10" onClick={() => router.push("/settings?mode=interview")}>
              <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-3xl shadow-[0_0_30px_rgba(59,130,246,0.1)]">
                🎯
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl font-black text-[var(--text)] tracking-tighter">MOCK INTERVIEW</h2>
                <p className="text-[10px] font-black tracking-[0.3em] text-blue-500 uppercase">SIMULATION PROTOCOL</p>
                <p className="text-[var(--muted)] text-sm font-medium leading-relaxed max-w-sm">
                  Initialize proctored evaluation. 6 adaptive queries with real-time biometric analysis.
                </p>
              </div>
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs font-black tracking-[0.2em] text-[var(--text)] uppercase group-hover:text-blue-400 transition-colors">Start Interview —</span>
              </div>
            </div>
          </TiltCard>

          <TiltCard className="hover-glow group cursor-pointer bg-[var(--surface)] border border-[var(--border)] rounded-2xl" maxTilt={5}>
            <div className="p-10 space-y-10" onClick={() => router.push("/settings?mode=coach")}>
              <div className="w-16 h-16 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-3xl shadow-[0_0_30px_rgba(236,72,153,0.1)]">
                🧠
              </div>
              <div className="space-y-4">
                <h2 className="text-4xl font-black text-[var(--text)] tracking-tighter">AI CAREER COACH</h2>
                <p className="text-[10px] font-black tracking-[0.3em] text-indigo-500 uppercase">NEURAL INSTRUCTION</p>
                <p className="text-[var(--muted)] text-sm font-medium leading-relaxed max-w-sm">
                  Recursive learning loop. Get instant high-fidelity feedback on every response.
                </p>
              </div>
              <div className="flex items-center justify-between pt-4">
                <span className="text-xs font-black tracking-[0.2em] text-indigo-400 uppercase group-hover:text-indigo-300 transition-colors">Start Coaching —</span>
                {resumeSession && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleResume(); }}
                    className="px-4 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-[9px] font-black tracking-[0.1em] text-indigo-400 uppercase hover:bg-indigo-500/20 transition-all"
                  >
                    Resume Mission
                  </button>
                )}
              </div>
            </div>
          </TiltCard>
        </section>

        {/* 4. ANALYTICS SECTION */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          <div className="lg:col-span-2 bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 min-h-[350px] shadow-2xl relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500/0 via-blue-500 to-blue-500/0 opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
            <h3 className="text-[10px] font-black tracking-[0.2em] text-[var(--text)] mb-6 uppercase">Performance Chart</h3>
            <div className="flex flex-col items-center justify-center h-48 border border-dashed border-[var(--border)] rounded-xl bg-[var(--text)]/[0.01]">
              <p className="text-[10px] font-black text-[var(--subtle)] uppercase tracking-widest">Awaiting Telemetry Data</p>
              <p className="text-[9px] text-[var(--subtle)] mt-2">Complete at least 2 interviews to see your score trend.</p>
            </div>
          </div>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-8 space-y-8 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_10px_#3b82f6]" />
              <h3 className="text-[10px] font-black tracking-[0.2em] text-[var(--text)] uppercase">SKILL MATRIX</h3>
            </div>
            {!skills ? (
              <p className="text-xs text-[var(--muted)] italic">No telemetry data available.</p>
            ) : (
              <div className="space-y-8">
                {[
                  { label: "LOGIC", value: skills.clarity },
                  { label: "COMMS", value: skills.communication },
                  { label: "DEPTH", value: skills.depth },
                  { label: "ENERGY", value: skills.confidence },
                ].map((s) => (
                  <div key={s.label} className="space-y-3">
                    <div className="flex justify-between text-[9px] font-black uppercase tracking-[0.15em]">
                      <span className="text-[var(--muted)]">{s.label}</span>
                      <span className="text-[var(--text)]">{s.value}%</span>
                    </div>
                    <div className="h-[2px] w-full bg-[var(--text)]/5 rounded-full overflow-hidden">
                      <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-1000 ease-out" style={{ width: `${s.value}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 5. MISSION HISTORY SECTION */}
        <section className="relative pt-12">
          <div className="flex items-end justify-between border-b border-[var(--border)] pb-8">
            <div className="flex gap-4">
              <div className="w-1 bg-blue-500 h-10 shadow-[0_0_20px_#3b82f6]" />
              <div>
                <h2 className="text-2xl font-black text-[var(--text)] tracking-tighter uppercase leading-none">ARCHIVED MISSIONS</h2>
                <p className="text-[10px] font-black tracking-[0.3em] text-[var(--muted)] uppercase mt-2">TEMPORAL LOG FILES</p>
              </div>
            </div>
            <button onClick={() => router.push("/history")} className="text-[10px] font-black text-blue-500 hover:text-blue-400 tracking-[0.2em] uppercase transition-colors flex items-center gap-2 group">
              Access Full Archive <span className="group-hover:translate-x-1 transition-transform">→</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-8">
            {interviewSessions.length === 0 ? (
              <div className="col-span-2 py-16 text-center bg-[var(--surface)] border border-[var(--border)] rounded-2xl border-dashed">
                <p className="text-[var(--subtle)] text-[10px] font-black uppercase tracking-[0.2em]">No missions recorded in temporal logs.</p>
              </div>
            ) : (
              interviewSessions.slice(0, 6).map((s, i) => {
                const sc = s.report ? avgReportScore(s.report) : null;
                return (
                  <div 
                    key={s.sessionId || i}
                    onClick={() => s.report && (sessionStorage.setItem("interviewReport", JSON.stringify(s.report)), router.push("/report"))}
                    className="group bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 flex items-center gap-4 hover:bg-[var(--text)]/5 transition-all cursor-pointer shadow-lg"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[var(--surface-2)] flex items-center justify-center text-lg shadow-inner border border-[var(--border)]">💾</div>
                    <div className="flex-1">
                      <p className="text-[10px] font-black text-[var(--text)] uppercase tracking-wider">{s.settings?.role || "Field Op"}</p>
                      <p className="text-[9px] font-bold text-[var(--muted)] uppercase tracking-widest mt-0.5">{timeAgo(s.timestamp)}</p>
                    </div>
                    {sc !== null && (
                      <div className="text-right">
                        <div className="text-sm font-black text-[var(--text)]">{sc}%</div>
                        <div className="text-[8px] font-black text-blue-500 tracking-tighter uppercase mt-0.5">Success</div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </section>

      </div>
    </main>
  );
}
