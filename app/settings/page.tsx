"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ============================================================
   TYPES
   ============================================================ */
type Mode = "coach" | "interview";
type InterviewType = "Technical" | "Behavioral" | "HR" | "Case Study";
type Difficulty = "Beginner" | "Mid-Level" | "Senior";
type Round = "Screening" | "Technical" | "Behavioral" | "Final";
type InputMode = "text" | "speech";

/* ============================================================
   PDF TEXT EXTRACTOR
   ============================================================ */
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
    const pageText = content.items.map((item: any) => item.str).join(" ");
    fullText += pageText + "\n";
  }
  return fullText.trim();
}

function truncateResume(text: string): string {
  if (text.length <= 3000) return text;
  return text.slice(0, 3000) + "\n[Resume truncated]";
}

/* ============================================================
   TOGGLE COMPONENT — fixed knob position
   ============================================================ */
function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`relative inline-flex items-center w-11 h-6 rounded-full transition-colors shrink-0 ${
        enabled ? "bg-green-600" : "bg-gray-700"
      }`}
    >
      <span
        className={`inline-block w-4 h-4 bg-white rounded-full shadow transition-transform ${
          enabled ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

/* ============================================================
   SETTINGS PAGE
   ============================================================ */
export default function Settings() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const modeParam = searchParams.get("mode") as Mode | null;

  useEffect(() => {
    if (!modeParam) router.replace("/");
  }, [modeParam, router]);

  const mode: Mode = modeParam === "interview" ? "interview" : "coach";

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
      setResumeError("Failed to parse resume. Please try a different file.");
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

  const isInterview = mode === "interview";

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center px-4 py-10">

      {/* Header */}
      <div className="mb-8 text-center">
        <div className="text-3xl mb-2">{isInterview ? "🎤" : "🎯"}</div>
        <h1 className="text-2xl font-bold">
          {isInterview ? "Interview Mode Setup" : "Coach Mode Setup"}
        </h1>
        <p className="text-gray-400 text-sm mt-1">
          {isInterview ? "Configure your mock interview session" : "Configure your coaching session"}
        </p>
      </div>

      <div className="w-full max-w-md flex flex-col gap-5">

        {/* Role */}
        <div className="flex flex-col gap-1">
          <label className="text-sm text-gray-400">Target Role <span className="text-red-400">*</span></label>
          <input
            className="bg-gray-900 border border-gray-700 focus:border-gray-500 outline-none p-3 rounded-lg text-white placeholder-gray-500 transition-colors"
            placeholder="e.g. Frontend Developer, Teacher, Data Analyst"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          />
        </div>

        {/* Company */}
        <div className="flex flex-col gap-1">
          <label className="text-sm text-gray-400">Target Company <span className="text-gray-600 text-xs">(optional)</span></label>
          <input
            className="bg-gray-900 border border-gray-700 focus:border-gray-500 outline-none p-3 rounded-lg text-white placeholder-gray-500 transition-colors"
            placeholder="e.g. Google, Infosys, local startup"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>

        {/* Interview Type */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Interview Type</label>
          <div className="grid grid-cols-2 gap-2">
            {(["Behavioral", "Technical", "HR", "Case Study"] as InterviewType[]).map((t) => (
              <button
                key={t}
                onClick={() => setInterviewType(t)}
                className={`p-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  interviewType === t
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Difficulty */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Difficulty</label>
          <div className="grid grid-cols-3 gap-2">
            {(["Beginner", "Mid-Level", "Senior"] as Difficulty[]).map((d) => (
              <button
                key={d}
                onClick={() => setDifficulty(d)}
                className={`p-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  difficulty === d
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Round — Interview only */}
        {isInterview && (
          <div className="flex flex-col gap-2">
            <label className="text-sm text-gray-400">Interview Round</label>
            <div className="grid grid-cols-2 gap-2">
              {(["Screening", "Technical", "Behavioral", "Final"] as Round[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRound(r)}
                  className={`p-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    round === r
                      ? "bg-blue-900/50 border-blue-600 text-blue-300"
                      : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-600">
              {round === "Screening" && "HR recruiter — resume fit, communication, culture"}
              {round === "Technical" && "Senior engineer — skills, problem solving, depth"}
              {round === "Behavioral" && "Hiring manager — STAR method, leadership, decisions"}
              {round === "Final" && "Senior leader — strategy, vision, culture fit"}
            </p>
          </div>
        )}

        {/* Input Mode */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">Input Mode</label>
          <div className="grid grid-cols-2 gap-2">
            {(["text", "speech"] as InputMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setInputMode(m)}
                className={`p-2.5 rounded-lg text-sm font-medium border transition-colors ${
                  inputMode === m
                    ? "bg-gray-700 border-gray-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-600"
                }`}
              >
                {m === "text" ? "⌨️ Text" : "🎙️ Speech"}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-600">
            {inputMode === "speech"
              ? "Speak your answers — text appears in editable field before sending"
              : "Type your answers. You can still enable mic per-message."}
          </p>
        </div>

        {/* TTS Toggle — fixed */}
        <div className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg p-3">
          <div>
            <p className="text-sm text-white">Text-to-Speech</p>
            <p className="text-xs text-gray-500">
              AI reads responses aloud{isInterview ? " (off by default in interview)" : ""}
            </p>
          </div>
          <Toggle enabled={ttsEnabled} onToggle={() => setTtsEnabled(!ttsEnabled)} />
        </div>

        {/* Resume Upload */}
        <div className="flex flex-col gap-2">
          <label className="text-sm text-gray-400">
            Resume <span className="text-gray-600 text-xs">(optional — PDF only)</span>
          </label>
          <input
            type="file"
            accept=".pdf"
            id="resumeUpload"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleResumeUpload(f); }}
          />
          {!resumeFile ? (
            <label
              htmlFor="resumeUpload"
              className="bg-gray-900 border border-dashed border-gray-700 hover:border-gray-500 p-4 rounded-lg cursor-pointer text-gray-500 text-sm text-center transition-colors"
            >
              Click to upload resume (PDF)
            </label>
          ) : (
            <div className={`p-3 rounded-lg border text-sm ${
              resumeError ? "bg-red-900/20 border-red-700 text-red-400"
                : resumeParsing ? "bg-gray-900 border-gray-700 text-gray-400"
                : resumeParsed ? "bg-green-900/20 border-green-700 text-green-400"
                : "bg-gray-900 border-gray-700 text-gray-400"
            }`}>
              {resumeParsing && "⏳ Parsing resume..."}
              {resumeParsed && `✅ ${resumeFile.name} — ready`}
              {resumeError && `❌ ${resumeError}`}
              {!resumeParsing && !resumeParsed && !resumeError && resumeFile.name}
              {!resumeParsing && (
                <label htmlFor="resumeUpload" className="ml-2 text-gray-500 underline cursor-pointer text-xs">
                  change
                </label>
              )}
            </div>
          )}
        </div>

        {/* Camera notice for interview */}
        {isInterview && (
          <div className="bg-blue-900/20 border border-blue-800 rounded-lg p-3 text-xs text-blue-300">
            📷 Camera is required in Interview Mode. You will be prompted to allow access when the session starts.
          </div>
        )}

        {/* Start */}
        <button
          onClick={startSession}
          disabled={resumeParsing}
          className={`w-full py-3.5 rounded-xl font-semibold text-white transition-colors disabled:opacity-40 ${
            isInterview ? "bg-blue-600 hover:bg-blue-500" : "bg-green-600 hover:bg-green-500"
          }`}
        >
          {resumeParsing ? "Parsing resume..." : isInterview ? "Start Interview →" : "Start Coaching →"}
        </button>

        <button onClick={() => router.push("/")} className="text-gray-600 text-sm hover:text-gray-400 transition-colors text-center">
          ← Back to home
        </button>

      </div>
    </main>
  );
}
