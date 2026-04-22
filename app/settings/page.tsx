//settings pagetsk
"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type Mode = "coach" | "interview";
type InterviewType = "Technical" | "Behavioral" | "HR" | "Case Study";
type Difficulty = "Beginner" | "Mid-Level" | "Senior";
type Round = "Screening" | "Technical" | "Behavioral" | "Final";
type InputMode = "text" | "speech";

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

export default function Settings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode") as Mode | null;

  useEffect(() => {
    if (!modeParam) router.replace("/");
  }, [modeParam, router]);

  const mode: Mode = modeParam === "interview" ? "interview" : "coach";
  const isInterview = mode === "interview";
  const accent = isInterview ? "#3b82f6" : "#4ade80";

  const [role, setRole] = useState("");
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
    if (!role.trim()) { alert("Please enter your target role."); return; }
    sessionStorage.setItem("mode", mode);
    sessionStorage.setItem("role", role.trim());
    sessionStorage.setItem("company", company.trim());
    sessionStorage.setItem("interviewType", interviewType);
    sessionStorage.setItem("difficulty", difficulty);
    sessionStorage.setItem("round", round);
    sessionStorage.setItem("inputMode", inputMode);
    sessionStorage.setItem("ttsEnabled", String(ttsEnabled));
    router.push(mode === "interview" ? "/interview" : "/coach");
  }

  const s = {
    page: {
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#f0f0f0",
      fontFamily: "'DM Sans', 'Inter', sans-serif",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "40px 20px",
    } as React.CSSProperties,
    card: {
      width: "100%",
      maxWidth: "480px",
      background: "#111",
      border: "1px solid #1e1e1e",
      borderRadius: "20px",
      padding: "36px",
    } as React.CSSProperties,
    label: {
      fontSize: "12px",
      color: "#888",
      marginBottom: "8px",
      display: "block",
      letterSpacing: "0.03em",
    } as React.CSSProperties,
    input: {
      width: "100%",
      background: "#0a0a0a",
      border: "1px solid #2a2a2a",
      borderRadius: "10px",
      padding: "11px 14px",
      color: "#f0f0f0",
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
      <button
        onClick={onClick}
        style={{
          padding: "9px 14px",
          borderRadius: "8px",
          border: selected ? `1px solid ${btnAccent || accent}` : "1px solid #2a2a2a",
          background: selected ? `${(btnAccent || accent)}18` : "#0a0a0a",
          color: selected ? (btnAccent || accent) : "#888",
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
      <div style={s.card}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div style={{ fontSize: "28px", marginBottom: "10px" }}>
            {isInterview ? "🎤" : "🎯"}
          </div>
          <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#fff", marginBottom: "6px" }}>
            {isInterview ? "Interview Mode Setup" : "Coach Mode Setup"}
          </h1>
          <p style={{ fontSize: "13px", color: "#666" }}>
            {isInterview ? "Configure your mock interview session" : "Configure your coaching session"}
          </p>
        </div>

        {/* Role */}
        <div style={s.section}>
          <label style={s.label}>Target Role <span style={{ color: "#ef4444" }}>*</span></label>
          <input
            style={s.input}
            placeholder="e.g. Frontend Developer, Teacher, Data Analyst"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            onFocus={(e) => (e.target.style.borderColor = accent)}
            onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
          />
        </div>

        {/* Company */}
        <div style={s.section}>
          <label style={s.label}>Target Company <span style={{ color: "#444", fontSize: "11px" }}>(optional)</span></label>
          <input
            style={s.input}
            placeholder="e.g. Google, Infosys, local startup"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            onFocus={(e) => (e.target.style.borderColor = accent)}
            onBlur={(e) => (e.target.style.borderColor = "#2a2a2a")}
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
                <OptionButton key={r} label={r} selected={round === r} onClick={() => setRound(r)} accent="#3b82f6" />
              ))}
            </div>
            <p style={{ fontSize: "11px", color: "#555" }}>{roundDescriptions[round]}</p>
          </div>
        )}

        {/* Input Mode */}
        <div style={s.section}>
          <label style={s.label}>Input Mode</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
            <OptionButton label="⌨️ Text" selected={inputMode === "text"} onClick={() => setInputMode("text")} />
            <OptionButton label="🎙️ Speech" selected={inputMode === "speech"} onClick={() => setInputMode("speech")} />
          </div>
          <p style={{ fontSize: "11px", color: "#555" }}>
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
          background: "#0a0a0a",
          border: "1px solid #1e1e1e",
          borderRadius: "10px",
          padding: "12px 14px",
        }}>
          <div>
            <p style={{ fontSize: "13px", color: "#e5e7eb", marginBottom: "2px" }}>Text-to-Speech</p>
            <p style={{ fontSize: "11px", color: "#555" }}>
              AI reads responses aloud{isInterview ? " (off by default)" : ""}
            </p>
          </div>
          <button
            onClick={() => setTtsEnabled(!ttsEnabled)}
            style={{
              width: "44px",
              height: "24px",
              borderRadius: "12px",
              border: "none",
              background: ttsEnabled ? "#4ade80" : "#2a2a2a",
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
              background: "#fff",
              borderRadius: "50%",
              transition: "left 0.2s",
              display: "block",
            }} />
          </button>
        </div>

        {/* Resume Upload */}
        <div style={s.section}>
          <label style={s.label}>
            Resume <span style={{ color: "#444", fontSize: "11px" }}>(optional — PDF only)</span>
          </label>
          <input
            type="file"
            accept=".pdf"
            id="resumeUpload"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResumeUpload(f); }}
          />
          {!resumeFile ? (
            <label htmlFor="resumeUpload" style={{
              display: "block",
              background: "#0a0a0a",
              border: "1px dashed #2a2a2a",
              borderRadius: "10px",
              padding: "16px",
              textAlign: "center",
              color: "#555",
              fontSize: "13px",
              cursor: "pointer",
            }}>
              Click to upload resume (PDF)
            </label>
          ) : (
            <div style={{
              background: "#0a0a0a",
              border: `1px solid ${resumeError ? "#ef4444" : resumeParsed ? "#4ade80" : "#2a2a2a"}`,
              borderRadius: "10px",
              padding: "12px 14px",
              fontSize: "13px",
              color: resumeError ? "#ef4444" : resumeParsed ? "#4ade80" : "#888",
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
                <label htmlFor="resumeUpload" style={{ color: "#555", fontSize: "12px", cursor: "pointer", textDecoration: "underline" }}>
                  change
                </label>
              )}
            </div>
          )}
        </div>

        {/* Camera notice */}
        {isInterview && (
          <div style={{
            background: "#0f1929",
            border: "1px solid #1d4ed8",
            borderRadius: "10px",
            padding: "12px 14px",
            fontSize: "12px",
            color: "#93c5fd",
            marginBottom: "24px",
          }}>
            📷 Camera is required in Interview Mode. You will be prompted to allow access when the session starts.
          </div>
        )}

        {/* Start Button */}
        <button
          onClick={startSession}
          disabled={resumeParsing}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: "12px",
            border: "none",
            background: isInterview ? "#1d4ed8" : "#16a34a",
            color: "#fff",
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
        <button
          onClick={() => router.push("/")}
          style={{
            width: "100%",
            padding: "10px",
            borderRadius: "10px",
            border: "1px solid #1e1e1e",
            background: "transparent",
            color: "#555",
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
