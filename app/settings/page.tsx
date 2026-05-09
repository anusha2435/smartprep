//settings pagetsk
"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "coach" | "interview";
type InterviewType = "Technical" | "Behavioral" | "HR" | "Case Study";
type Difficulty = "Beginner" | "Mid-Level" | "Senior";
type Round = "Screening" | "Technical" | "Behavioral" | "Final";
type InputMode = "text" | "speech";

const ROLE_SUGGESTIONS = [
  "Software Engineer", "Frontend Developer", "Data Scientist", "Product Manager",
  "Teacher", "Nurse", "Accountant", "Sales Executive", "HR Manager",
  "Digital Marketer", "Graphic Designer", "Civil Engineer", "Lawyer",
  "Customer Support", "Project Coordinator", "UX Researcher", "DevOps Engineer",
  "Cloud Architect", "Financial Analyst", "Operations Manager"
];

const VALID_ROLE_KEYWORDS = [
  "engineer", "developer", "teacher", "manager", "analyst", "designer", "intern", 
  "consultant", "executive", "specialist", "nurse", "doctor", "accountant", "lawyer", 
  "sales", "marketing", "hr", "qa", "sde", "devops", "support", "admin", "lead", 
  "architect", "trainer", "professor", "recruiter", "writer", "editor", "chef", 
  "pilot", "artist", "agent", "officer", "coordinator", "assistant", "associate", 
  "principal", "staff", "technician", "scientist", "researcher", "analyst", 
  "clerk", "vp", "director", "ceo", "cto", "cfo", "founder"
];

function validateRoleInput(value: string): string | null {
  const role = value.trim().toLowerCase();
  const letters = role.replace(/[^a-z]/gi, "");
  const vowels = (letters.match(/[aeiouy]/gi) || []).length; // Included 'y' as a vowel-ish check
  const hasRoleWord = new RegExp(`\\b(${VALID_ROLE_KEYWORDS.join("|")})\\b`, "i").test(role);

  if (role.length < 3) return "Please enter a valid job title (e.g., Software Engineer).";
  if (!/[a-z]/i.test(role)) return "Job title must contain letters.";
  if (/[^a-z0-9\s/&().,+-]/i.test(role)) return "Job title contains unsupported characters.";
  if (/(.)\1{3,}/i.test(role)) return "This doesn't look like a real job title (repeated characters).";
  
  // Stricter gibberish detection
  const vowelRatio = vowels / Math.max(letters.length, 1);
  const parts = role.split(/\s+/);

  // If it's a long word with very few vowels and no known role keywords, it's likely junk
  if (letters.length >= 6 && vowelRatio < 0.15 && !hasRoleWord) {
    return "This job title looks unrecognized. Please use a standard role name.";
  }

  // Check for long consonant clusters (e.g., "ftsyejfkkf")
  if (parts.some(p => p.length >= 5 && !/[aeiouy]/i.test(p) && !/^(sde|qa|hr)$/i.test(p))) {
    return "This role looks mistyped. Please enter a recognizable job title.";
  }

  // Check for random-looking short inputs (e.g., "asdf", "qwerty")
  const commonGibberish = ["asdf", "qwerty", "zxcv", "jkl", "fjfj"];
  if (parts.some(p => commonGibberish.includes(p))) {
    return "Please enter a valid, non-placeholder job title.";
  }

  return null;
}

async function extractPDFText(file: File): Promise<string> {
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load pdf.js"));
      document.head.appendChild(script);
    });
    (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }
  const pdfjsLib = (window as any).pdfjsLib;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    fullText += content.items.map((item: any) => item.str).join(" ") + "\n";
  }
  return fullText.trim();
}

function truncateResume(text: string): string {
  return text.length <= 3000 ? text : text.slice(0, 3000) + "\n[Resume truncated]";
}

function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode") as Mode | null;

  useEffect(() => {
    if (!modeParam) router.replace("/");
  }, [modeParam, router]);

  const mode: Mode = modeParam === "interview" ? "interview" : "coach";
  const isInterview = mode === "interview";
  const accent = isInterview ? "var(--accent)" : "var(--success)";

  const [role, setRole] = useState("");
  const [roleError, setRoleError] = useState("");
  const [company, setCompany] = useState("");
  const [interviewType, setInterviewType] = useState<InterviewType>("Behavioral");
  const [difficulty, setDifficulty] = useState<Difficulty>("Mid-Level");
  const [round, setRound] = useState<Round>("Behavioral");
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeParsing, setResumeParsing] = useState(false);
  const [resumeError, setResumeError] = useState("");
  const [resumeParsed, setResumeParsed] = useState(false);

  async function handleResumeUpload(file: File) {
    setResumeFile(file);
    setResumeError("");
    setResumeParsed(false);
    if (!file.name.endsWith(".pdf")) {
      setResumeError("Only PDF files are supported.");
      return;
    }
    setResumeParsing(true);
    try {
      const text = await extractPDFText(file);
      if (!text || text.length < 50) {
        setResumeError("Could not extract text. This may be a scanned PDF.");
        sessionStorage.removeItem("resumeText");
      } else {
        sessionStorage.setItem("resumeText", truncateResume(text));
        setResumeParsed(true);
      }
    } catch {
      setResumeError("Failed to parse resume.");
      sessionStorage.removeItem("resumeText");
    }
    setResumeParsing(false);
  }

  function startSession() {
    const validation = validateRoleInput(role);
    if (validation) { setRoleError(validation); return; }
    sessionStorage.setItem("mode", mode);
    sessionStorage.setItem("role", role.trim());
    sessionStorage.setItem("company", company.trim());
    sessionStorage.setItem("interviewType", interviewType);
    sessionStorage.setItem("difficulty", difficulty);
    sessionStorage.setItem("round", round);
    sessionStorage.setItem("inputMode", inputMode);
    sessionStorage.setItem("ttsEnabled", String(ttsEnabled));
    sessionStorage.removeItem("resumeCoachSession");
    sessionStorage.removeItem("resumeCoachSessionId");
    router.push(mode === "interview" ? "/interview" : "/coach");
  }

  const s = {
    page: {
      minHeight: "100vh",
      background: "var(--bg)",
      color: "var(--text)",
      fontFamily: "var(--font-body)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
    } as React.CSSProperties,
    card: {
      width: "100%",
      maxWidth: "480px",
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "20px",
      padding: "36px",
    } as React.CSSProperties,
    label: {
      fontSize: "12px",
      color: "var(--muted)",
      marginBottom: "8px",
      display: "block",
      letterSpacing: "0.03em",
    } as React.CSSProperties,
    input: {
      width: "100%",
      background: "var(--bg)",
      border: "1px solid var(--border)",
      borderRadius: "10px",
      padding: "11px 14px",
      color: "var(--text)",
      fontSize: "14px",
      outline: "none",
      transition: "border-color 0.2s",
    } as React.CSSProperties,
    section: {
      marginBottom: "24px",
    } as React.CSSProperties,
  };

  function OptionButton({
    label, selected, onClick, accent: btnAccent,
  }: { label: string; selected: boolean; onClick: () => void; accent?: string }) {
    return (
      <button className="btn-animated"
        onClick={onClick}
        style={{
          padding: "9px 14px",
          borderRadius: "8px",
          border: selected ? `1px solid ${btnAccent || accent}` : "1px solid var(--border)",
          background: selected ? `color-mix(in srgb, ${btnAccent || accent} 16%, transparent)` : "var(--bg)",
          color: selected ? (btnAccent || accent) : "var(--muted)",
          fontSize: "13px",
          fontWeight: selected ? 600 : 400,
          cursor: "pointer",
          transition: "all 0.15s",
        }}
      >
        {label}
      </button>
    );
  }

  const roundDescriptions: Record<Round, string> = {
    Screening: "HR recruiter — resume fit, communication, culture",
    Technical: "Senior engineer — skills, problem solving, depth",
    Behavioral: "Hiring manager — STAR method, leadership, decisions",
    Final: "Senior leader — strategy, vision, culture fit",
  };

  return (
    <main style={s.page}>
      <div className="premium-card" style={s.card}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "28px", marginBottom: "10px" }}>
            {isInterview ? "🎤" : "🎯"}
          </div>
          <h1 className="font-heading" style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)", marginBottom: "6px" }}>
            {isInterview ? "Interview Mode Setup" : "Coach Mode Setup"}
          </h1>
          <p style={{ fontSize: "13px", color: "var(--muted)" }}>
            {isInterview ? "Configure your mock interview session" : "Configure your coaching session"}
          </p>
        </div>

        {/* Role */}
        <div style={s.section}>
          <label style={s.label}>Target Role <span style={{ color: "var(--danger)" }}>*</span></label>
          <input
            suppressHydrationWarning
            style={s.input}
            placeholder="e.g. Frontend Developer, Teacher, Data Analyst"
            value={role}
            onChange={(e) => { setRole(e.target.value); setRoleError(""); }}
            onFocus={(e) => (e.target.style.borderColor = accent)}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            onKeyDown={(e) => e.key === "Enter" && startSession()}
          />
          {roleError && (
            <div style={{ marginTop: "10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", borderRadius: "10px", padding: "10px 12px" }}>
              <p style={{ fontSize: "12px", color: "var(--danger)", marginBottom: "8px" }}>{roleError}</p>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {ROLE_SUGGESTIONS.map((suggestion) => (
                  <button className="btn-animated"
                    key={suggestion}
                    onClick={() => { setRole(suggestion); setRoleError(""); }}
                    style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", borderRadius: "999px", padding: "5px 9px", fontSize: "11px", cursor: "pointer" }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Company */}
        <div style={s.section}>
          <label style={s.label}>Target Company <span style={{ color: "var(--muted)", fontSize: "11px" }}>(optional)</span></label>
          <input
            suppressHydrationWarning
            style={s.input}
            placeholder="e.g. Google, Infosys, local startup"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            onFocus={(e) => (e.target.style.borderColor = accent)}
            onBlur={(e) => (e.target.style.borderColor = "var(--border)")}
            onKeyDown={(e) => e.key === "Enter" && startSession()}
          />
        </div>

        {/* Interview Type */}
        <div style={s.section}>
          <label style={s.label}>Interview Type</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {(["Behavioral", "Technical", "HR", "Case Study"] as InterviewType[]).map((t) => (
              <OptionButton key={t} label={t} selected={interviewType === t} onClick={() => setInterviewType(t)} />
            ))}
          </div>
        </div>

        {/* Difficulty */}
        <div style={s.section}>
          <label style={s.label}>Difficulty</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "8px" }}>
            {(["Beginner", "Mid-Level", "Senior"] as Difficulty[]).map((d) => (
              <OptionButton key={d} label={d} selected={difficulty === d} onClick={() => setDifficulty(d)} />
            ))}
          </div>
        </div>

        {/* Round — Interview only */}
        {isInterview && (
          <div style={s.section}>
            <label style={s.label}>Interview Round</label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              {(["Screening", "Technical", "Behavioral", "Final"] as Round[]).map((r) => (
                <OptionButton key={r} label={r} selected={round === r} onClick={() => setRound(r)} accent="var(--accent)" />
              ))}
            </div>
            <p style={{ fontSize: "11px", color: "var(--muted)" }}>{roundDescriptions[round]}</p>
          </div>
        )}

        {/* Input Mode */}
        <div style={s.section}>
          <label style={s.label}>Input Mode</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <OptionButton label="⌨️ Text" selected={inputMode === "text"} onClick={() => setInputMode("text")} />
            <OptionButton label="🎙️ Speech" selected={inputMode === "speech"} onClick={() => setInputMode("speech")} />
          </div>
          <p style={{ fontSize: "11px", color: "var(--muted)" }}>
            {inputMode === "speech"
              ? "Speak your answers — text appears in editable field before sending"
              : "Type your answers. You can still enable mic per-message."}
          </p>
        </div>

        {/* TTS Toggle */}
        <div style={{
          ...s.section,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          padding: "12px 14px",
        }}>
          <div>
            <p style={{ fontSize: "13px", color: "var(--text)", marginBottom: "2px" }}>Text-to-Speech</p>
            <p style={{ fontSize: "11px", color: "var(--muted)" }}>
              AI reads responses aloud{isInterview ? " (off by default)" : ""}
            </p>
          </div>
          <button className="btn-animated"
            onClick={() => setTtsEnabled(!ttsEnabled)}
            style={{
              width: "44px",
              height: "24px",
              borderRadius: "12px",
              border: "none",
              background: ttsEnabled ? "var(--success)" : "var(--border)",
              cursor: "pointer",
              position: "relative",
              transition: "background 0.2s",
              flexShrink: 0,
            }}
          >
            <span style={{
              position: "absolute",
              top: "3px",
              left: ttsEnabled ? "23px" : "3px",
              width: "18px",
              height: "18px",
              background: "var(--text)",
              borderRadius: "50%",
              transition: "left 0.2s",
              display: "block",
            }} />
          </button>
        </div>

        {/* Resume Upload */}
        <div style={s.section}>
          <label style={s.label}>
            Resume <span style={{ color: "var(--muted)", fontSize: "11px" }}>(optional — PDF only)</span>
          </label>
          <input
            suppressHydrationWarning
            type="file"
            accept=".pdf"
            id="resumeUpload"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResumeUpload(f); }}
          />
          {!resumeFile ? (
            <label htmlFor="resumeUpload" style={{
              display: "block",
              background: "var(--bg)",
              border: "1px dashed var(--border)",
              borderRadius: "10px",
              padding: "16px",
              textAlign: "center",
              color: "var(--muted)",
              fontSize: "13px",
              cursor: "pointer",
            }}>
              Click to upload resume (PDF)
            </label>
          ) : (
            <div style={{
              background: "var(--bg)",
              border: `1px solid ${resumeError ? "var(--danger)" : resumeParsed ? "var(--success)" : "var(--border)"}`,
              borderRadius: "10px",
              padding: "12px 14px",
              fontSize: "13px",
              color: resumeError ? "var(--danger)" : resumeParsed ? "var(--success)" : "var(--muted)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span>
                {resumeParsing && "⏳ Parsing..."}
                {resumeParsed && `✅ ${resumeFile.name}`}
                {resumeError && `❌ ${resumeError}`}
                {!resumeParsing && !resumeParsed && !resumeError && resumeFile.name}
              </span>
              {!resumeParsing && (
                <label htmlFor="resumeUpload" style={{ color: "var(--muted)", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}>
                  change
                </label>
              )}
            </div>
          )}
        </div>

        {/* Camera notice */}
        {isInterview && (
          <div style={{
            background: "var(--surface-2)",
            border: "1px solid var(--accent)",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "12px",
            color: "var(--accent)",
            marginBottom: "24px",
          }}>
            📷 Camera is required in Interview Mode. You will be prompted to allow access when the session starts.
          </div>
        )}

        {/* Start Button */}
        <button className="btn-animated"
          onClick={startSession}
          disabled={resumeParsing}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            border: "none",
            background: isInterview ? "var(--accent)" : "var(--success)",
            color: "var(--text)",
            fontSize: "15px",
            fontWeight: 700,
            cursor: resumeParsing ? "not-allowed" : "pointer",
            opacity: resumeParsing ? 0.5 : 1,
            marginBottom: "12px",
            transition: "opacity 0.2s",
          }}
        >
          {resumeParsing ? "Parsing resume..." : isInterview ? "Start Interview →" : "Start Coaching →"}
        </button>

        {/* Back */}
        <button className="btn-animated"
          onClick={() => router.push("/")}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "10px",
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--muted)",
            fontSize: "13px",
            cursor: "pointer",
          }}
        >
          ← Back to home
        </button>

      </div>
    </main>
  );
}

export default function Settings() {
  return (
    <Suspense fallback={<main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-body)" }}>Loading settings...</main>}>
      <SettingsContent />
    </Suspense>
  );
}
