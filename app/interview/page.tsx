"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ============================================================
   TYPES
   ============================================================ */
type InterviewPhase =
  | "requesting-permissions"
  | "permission-denied"
  | "ready"
  | "prepare"
  | "answering"
  | "processing"
  | "candidate-questions"
  | "done";

type ConversationTurn = { role: "user" | "assistant"; content: string };

type AnswerMetadata = {
  questionNumber: number;
  questionText: string;
  transcript: string;
  fillerWordCount: number;
  fillerWords: string[];
  answerDurationSeconds: number;
  idealDurationRange: string;
  silencePausesCount: number;
  longestPauseSeconds: number;
  skipped?: boolean;
  cameraSnapshot?: string;
};

type InterviewMessage = {
  role: "interviewer" | "candidate";
  text: string;
  questionNumber?: number;
  skipped?: boolean;
};

/* ============================================================
   CONSTANTS
   ============================================================ */
const FILLER_WORDS = ["um", "uh", "like", "you know", "basically", "literally", "actually", "so", "right", "okay"];
const IDEAL_DURATION: Record<string, string> = { Screening: "60-90s", Technical: "120-180s", Behavioral: "90-120s", Final: "90-150s" };
const CANDIDATE_QS: Record<string, number> = { Screening: 1, Technical: 1, Behavioral: 1, Final: 2 };

/* ============================================================
   HELPERS
   ============================================================ */
function countFillers(text: string) {
  const lower = text.toLowerCase();
  const found: string[] = [];
  let count = 0;
  for (const w of FILLER_WORDS) {
    const m = lower.match(new RegExp(`\\b${w}\\b`, "g"));
    if (m) { count += m.length; found.push(w); }
  }
  return { count, words: found };
}

function formatTime(s: number) {
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
}

/* ============================================================
   INTERVIEW PAGE
   ============================================================ */
export default function Interview() {
  const router = useRouter();

  const [settings, setSettings] = useState({
    role: "Software Engineer", company: "", interviewType: "Behavioral",
    difficulty: "Mid-Level", round: "Behavioral", ttsEnabled: false,
  });

  const [phase, setPhase] = useState<InterviewPhase>("requesting-permissions");
  const [questionNumber, setQuestionNumber] = useState(0);
  const [currentQuestion, setCurrentQuestion] = useState("");
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [allMetadata, setAllMetadata] = useState<AnswerMetadata[]>([]);

  const [transcript, setTranscript] = useState("");
  const [answerStartTime, setAnswerStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [silencePauses, setSilencePauses] = useState(0);
  const [longestPause, setLongestPause] = useState(0);

  const [candidateQsLeft, setCandidateQsLeft] = useState(1);
  const [candidateInput, setCandidateInput] = useState("");
  const [candidateAnswers, setCandidateAnswers] = useState<InterviewMessage[]>([]);

  const [integrityFlags, setIntegrityFlags] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const snapshotTakenRef = useRef(false);
  const snapshotRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsEnabledRef = useRef(false);
  const phaseRef = useRef<InterviewPhase>("requesting-permissions");
  const integrityRef = useRef(0);
  const graceRef = useRef(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, candidateAnswers]);

  /* ============================================================
     INIT
     ============================================================ */
  useEffect(() => {
    const mode = sessionStorage.getItem("mode");
    if (!mode) { router.replace("/"); return; }
    const round = sessionStorage.getItem("round") || "Behavioral";
    const ttsEnabled = sessionStorage.getItem("ttsEnabled") === "true";
    setSettings({
      role: sessionStorage.getItem("role") || "Software Engineer",
      company: sessionStorage.getItem("company") || "",
      interviewType: sessionStorage.getItem("interviewType") || "Behavioral",
      difficulty: sessionStorage.getItem("difficulty") || "Mid-Level",
      round, ttsEnabled,
    });
    ttsEnabledRef.current = ttsEnabled;
    setCandidateQsLeft(CANDIDATE_QS[round] || 1);
    requestPermissions();
  }, [router]);

  /* ============================================================
     CAMERA — attach via useEffect watching cameraReady
     ============================================================ */
  useEffect(() => {
    if (cameraReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraReady]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      timerRef.current && clearInterval(timerRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  /* ============================================================
     TAB SWITCH DETECTION
     ============================================================ */
  useEffect(() => {
    function onVisibility() {
      if (graceRef.current || sessionEnded) return;
      if (document.hidden && ["prepare", "answering", "processing"].includes(phaseRef.current)) {
        integrityRef.current += 1;
        setIntegrityFlags(integrityRef.current);
        setShowTabWarning(true);
        if (integrityRef.current >= 3) handleAutoEnd("integrity");
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [sessionEnded]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!["ready", "done"].includes(phase)) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  /* ============================================================
     REQUEST PERMISSIONS
     ============================================================ */
  async function requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      setCameraReady(true);
      setPhase("ready");
      graceRef.current = true;
      setTimeout(() => { graceRef.current = false; }, 3000);
    } catch {
      setPhase("permission-denied");
    }
  }

  /* ============================================================
     TTS
     ============================================================ */
  const speak = useCallback((text: string) => {
    if (!ttsEnabledRef.current) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }, []);

  /* ============================================================
     TIMER
     ============================================================ */
  function startTimer() {
    const start = Date.now();
    setAnswerStartTime(start);
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
  }

  function stopTimer(): number {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    if (!answerStartTime) return 0;
    return Math.floor((Date.now() - answerStartTime) / 1000);
  }

  /* ============================================================
     SNAPSHOT
     ============================================================ */
  function scheduleSnapshot(durationHint = 30) {
    snapshotTakenRef.current = false;
    snapshotRef.current = undefined;
    const delay = Math.min(Math.random() * durationHint * 0.4 * 1000 + durationHint * 0.3 * 1000, 20000);
    setTimeout(() => {
      if (phaseRef.current !== "answering" || !videoRef.current || snapshotTakenRef.current) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoRef.current.videoWidth || 320;
        canvas.height = videoRef.current.videoHeight || 240;
        canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
        snapshotRef.current = canvas.toDataURL("image/jpeg", 0.6);
        snapshotTakenRef.current = true;
      } catch { }
    }, delay);
  }

  /* ============================================================
     SPEECH RECOGNITION — auto-restarts
     ============================================================ */
  function startListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    let pauseStart: number | null = null;

    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          final += e.results[i][0].transcript + " ";
          if (pauseStart !== null) {
            const d = (Date.now() - pauseStart) / 1000;
            if (d > 1.5) { setSilencePauses(p => p + 1); setLongestPause(p => Math.max(p, d)); }
            pauseStart = null;
          }
        }
      }
      if (final) setTranscript(prev => (prev + final).trimStart());
    };
    r.onspeechend = () => { pauseStart = Date.now(); };
    r.onerror = (e: any) => {
      if ((e.error === "no-speech" || e.error === "network") && phaseRef.current === "answering") {
        setTimeout(() => startListening(), 500);
      } else {
        setIsListening(false);
      }
    };
    r.onend = () => {
      if (phaseRef.current === "answering") setTimeout(() => startListening(), 300);
      else setIsListening(false);
    };
    recognitionRef.current = r;
    r.start();
  }

  function stopListening() {
    if (recognitionRef.current) { recognitionRef.current.onend = null; recognitionRef.current.stop(); }
    setIsListening(false);
  }

  /* ============================================================
     CALL AI
     ============================================================ */
  async function callAI(msg: string, history: ConversationTurn[], metadata?: AnswerMetadata[]): Promise<any> {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "interview",
        role: settings.role,
        company: settings.company,
        interviewType: settings.interviewType,
        difficulty: settings.difficulty,
        round: settings.round,
        resumeText: sessionStorage.getItem("resumeText") || "",
        message: msg,
        conversationHistory: history,
        answerMetadata: metadata || [],
        integrityFlags: integrityRef.current,
      }),
    });
    return res.json();
  }

  /* ============================================================
     SAVE TO LOCALSTORAGE
     ============================================================ */
  function saveLS(history: ConversationTurn[], metadata: AnswerMetadata[], report?: any) {
    try {
      const d = {
        timestamp: Date.now(), settings,
        conversationHistory: history,
        allMetadata: metadata,
        integrityFlags: integrityRef.current,
        report: report || null,
      };
      localStorage.setItem("lastInterviewSession", JSON.stringify(d));
      const existing = JSON.parse(localStorage.getItem("interviewSessions") || "[]");
      const filtered = existing.filter((s: any) => Math.abs(s.timestamp - d.timestamp) > 10000);
      filtered.unshift(d);
      localStorage.setItem("interviewSessions", JSON.stringify(filtered.slice(0, 20)));
    } catch { }
  }

  /* ============================================================
     START INTERVIEW
     ============================================================ */
  async function handleStart() {
    setPhase("processing");
    try {
      const data = await callAI("START", []);
      const q = data.question || "Tell me about yourself.";
      const history: ConversationTurn[] = [
        { role: "user", content: "START" },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      setConversationHistory(history);
      setCurrentQuestion(q);
      setQuestionNumber(1);
      setMessages([{ role: "interviewer", text: q, questionNumber: 1 }]);
      setPhase("prepare");
      speak(q);
      saveLS(history, []);
    } catch {
      setPhase("ready");
    }
  }

  /* ============================================================
     START ANSWERING
     ============================================================ */
  function handleStartAnswering() {
    setTranscript("");
    setSilencePauses(0);
    setLongestPause(0);
    snapshotRef.current = undefined;
    snapshotTakenRef.current = false;
    setPhase("answering");
    startTimer();
    startListening();
    scheduleSnapshot(parseInt(IDEAL_DURATION[settings.round]?.split("-")[0] || "90"));
  }

  /* ============================================================
     SUBMIT ANSWER
     ============================================================ */
  async function handleSubmit() {
    if (phase !== "answering") return;
    stopListening();
    const duration = stopTimer();
    const finalTranscript = transcript.trim();
    if (!finalTranscript) { setPhase("prepare"); return; }
    setPhase("processing");

    const { count, words } = countFillers(finalTranscript);
    const meta: AnswerMetadata = {
      questionNumber, questionText: currentQuestion, transcript: finalTranscript,
      fillerWordCount: count, fillerWords: words, answerDurationSeconds: duration,
      idealDurationRange: IDEAL_DURATION[settings.round] || "90-120s",
      silencePausesCount: silencePauses,
      longestPauseSeconds: Math.round(longestPause * 10) / 10,
      cameraSnapshot: snapshotRef.current,
    };

    const newAllMeta = [...allMetadata, meta];
    setAllMetadata(newAllMeta);

    const updatedMsgs: InterviewMessage[] = [...messages, { role: "candidate", text: finalTranscript }];
    setMessages(updatedMsgs);

    const newHistory: ConversationTurn[] = [...conversationHistory, { role: "user", content: finalTranscript }];

    try {
      const isLast = questionNumber >= 6;
      const data = await callAI(finalTranscript, conversationHistory, isLast ? newAllMeta : []);
      const updatedHistory: ConversationTurn[] = [...newHistory, { role: "assistant", content: JSON.stringify(data) }];
      setConversationHistory(updatedHistory);

      if (data.done === true || isLast) {
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({ ...data.report, integrityFlags: integrityRef.current }));
          sessionStorage.setItem("interviewMetadata", JSON.stringify(newAllMeta));
        }
        saveLS(updatedHistory, newAllMeta, data.report);
        setMessages([...updatedMsgs, {
          role: "interviewer",
          text: `That concludes my questions. ${CANDIDATE_QS[settings.round] > 0 ? "Do you have any questions for me?" : ""}`,
        }]);
        setPhase("candidate-questions");
      } else if (data.question) {
        const nextQ = data.question;
        const nextNum = Math.min(data.questionNumber || questionNumber + 1, 6);
        setCurrentQuestion(nextQ);
        setQuestionNumber(nextNum);
        setMessages([...updatedMsgs, { role: "interviewer", text: nextQ, questionNumber: nextNum }]);
        setPhase("prepare");
        speak(nextQ);
        saveLS(updatedHistory, newAllMeta);
      }
    } catch {
      setPhase("prepare");
    }
  }

  /* ============================================================
     SKIP QUESTION
     ============================================================ */
  async function handleSkipQuestion() {
    if (phase !== "prepare") return;
    setPhase("processing");

    const skipMeta: AnswerMetadata = {
      questionNumber, questionText: currentQuestion, transcript: "[SKIPPED]",
      fillerWordCount: 0, fillerWords: [], answerDurationSeconds: 0,
      idealDurationRange: IDEAL_DURATION[settings.round] || "90-120s",
      silencePausesCount: 0, longestPauseSeconds: 0, skipped: true,
    };

    const newAllMeta = [...allMetadata, skipMeta];
    setAllMetadata(newAllMeta);
    const updatedMsgs: InterviewMessage[] = [...messages, { role: "candidate", text: "[Question skipped]", skipped: true }];
    setMessages(updatedMsgs);
    const newHistory: ConversationTurn[] = [...conversationHistory, { role: "user", content: "I need to skip this question." }];

    try {
      const isLast = questionNumber >= 6;
      const data = await callAI("I need to skip this question.", conversationHistory, isLast ? newAllMeta : []);
      const updatedHistory: ConversationTurn[] = [...newHistory, { role: "assistant", content: JSON.stringify(data) }];
      setConversationHistory(updatedHistory);

      if (data.done === true || isLast) {
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({ ...data.report, integrityFlags: integrityRef.current }));
          sessionStorage.setItem("interviewMetadata", JSON.stringify(newAllMeta));
        }
        setMessages([...updatedMsgs, { role: "interviewer", text: "That concludes my questions. Do you have any questions for me?" }]);
        setPhase("candidate-questions");
      } else if (data.question) {
        const nextQ = data.question;
        const nextNum = Math.min(data.questionNumber || questionNumber + 1, 6);
        setCurrentQuestion(nextQ);
        setQuestionNumber(nextNum);
        setMessages([...updatedMsgs, { role: "interviewer", text: nextQ, questionNumber: nextNum }]);
        setPhase("prepare");
        speak(nextQ);
      }
    } catch {
      setPhase("prepare");
    }
  }

  /* ============================================================
     CANDIDATE QUESTIONS
     ============================================================ */
  async function handleCandidateQuestion() {
    const q = candidateInput.trim();
    if (!q) return;
    setCandidateInput("");
    setCandidateAnswers(prev => [...prev, { role: "candidate", text: q }]);
    setPhase("processing");
    try {
      const data = await callAI(q, conversationHistory);
      const answer = data.question || data.nextQuestion || "Thank you for your question.";
      setCandidateAnswers(prev => [...prev, { role: "interviewer", text: answer }]);
      const remaining = candidateQsLeft - 1;
      setCandidateQsLeft(remaining);
      if (remaining <= 0) setTimeout(navigateToReport, 1500);
    } catch {
      setCandidateAnswers(prev => [...prev, { role: "interviewer", text: "Thank you for your question." }]);
    }
    setPhase("candidate-questions");
  }

  function navigateToReport() {
    setPhase("done");
    setSessionEnded(true);
    streamRef.current?.getTracks().forEach(t => t.stop());
    router.push("/report");
  }

  /* ============================================================
     AUTO-END
     ============================================================ */
  async function handleAutoEnd(reason: string) {
    setSessionEnded(true);
    setShowTabWarning(false);
    stopListening();
    stopTimer();
    setPhase("done");
    sessionStorage.setItem("interviewMetadata", JSON.stringify(allMetadata));
    sessionStorage.setItem("integrityFlags", String(integrityRef.current));
    const hard = setTimeout(() => { streamRef.current?.getTracks().forEach(t => t.stop()); router.push("/report"); }, 5000);
    try {
      if (allMetadata.length > 0) {
        const data = await callAI("SESSION ENDED EARLY. Generate partial report.", conversationHistory, allMetadata);
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({ ...data.report, integrityFlags: integrityRef.current, sessionEndedEarly: true }));
        }
      }
    } catch { }
    clearTimeout(hard);
    streamRef.current?.getTracks().forEach(t => t.stop());
    router.push("/report");
  }

  /* ============================================================
     TIMER COLOR
     ============================================================ */
  function getTimerColor() {
    const [mn, mx] = (IDEAL_DURATION[settings.round] || "90-120s").replace("s", "").split("-").map(Number);
    if (elapsedSeconds < mn) return "#888";
    if (elapsedSeconds <= mx) return "#4ade80";
    return "#fbbf24";
  }

  /* ============================================================
     STYLES
     ============================================================ */
  const isProcessing = phase === "processing";
  const idealDuration = IDEAL_DURATION[settings.round] || "90-120s";

  const S = {
    page: { display: "flex", height: "100vh", background: "#0a0a0a", color: "#f0f0f0", fontFamily: "'DM Sans','Inter',sans-serif", overflow: "hidden" } as React.CSSProperties,
    center: { display: "flex", height: "100vh", background: "#0a0a0a", color: "#f0f0f0", fontFamily: "'DM Sans','Inter',sans-serif", alignItems: "center", justifyContent: "center" } as React.CSSProperties,
    interviewerBubble: { background: "#1a1a1a", color: "#e5e7eb", padding: "12px 16px", borderRadius: "4px 18px 18px 18px", maxWidth: "75%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    candidateBubble: { background: "#1d4ed8", color: "#ffffff", padding: "10px 16px", borderRadius: "18px 18px 4px 18px", maxWidth: "68%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    skippedBubble: { background: "#1a1a1a", color: "#666", padding: "10px 16px", borderRadius: "18px 18px 4px 18px", maxWidth: "68%", fontSize: "14px", fontStyle: "italic" } as React.CSSProperties,
  };

  /* ============================================================
     LOADING SCREENS
     ============================================================ */
  if (phase === "requesting-permissions") return (
    <main style={S.center}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "36px", marginBottom: "16px" }}>📷</div>
        <p style={{ color: "#888", fontSize: "14px" }}>Requesting camera and microphone access...</p>
        <p style={{ color: "#555", fontSize: "12px", marginTop: "8px" }}>Allow access in the browser popup</p>
      </div>
    </main>
  );

  if (phase === "permission-denied") return (
    <main style={S.center}>
      <div style={{ textAlign: "center", maxWidth: "360px" }}>
        <div style={{ fontSize: "40px", marginBottom: "16px" }}>📷</div>
        <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>Camera Required</h2>
        <p style={{ color: "#888", fontSize: "13px", marginBottom: "6px" }}>Interview Mode requires camera and microphone.</p>
        <p style={{ color: "#555", fontSize: "12px", marginBottom: "24px" }}>Click the camera icon in your browser address bar → Allow → refresh.</p>
        <button onClick={() => window.location.reload()} style={{ background: "#1d4ed8", color: "#fff", border: "none", padding: "12px 24px", borderRadius: "10px", fontSize: "14px", cursor: "pointer", marginRight: "12px" }}>Retry →</button>
        <button onClick={() => router.push("/")} style={{ background: "transparent", color: "#666", border: "none", fontSize: "14px", cursor: "pointer" }}>← Back</button>
      </div>
    </main>
  );

  if (phase === "done") return (
    <main style={S.center}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "36px", marginBottom: "16px" }}>📊</div>
        <p style={{ color: "#888", fontSize: "14px" }}>Generating your evaluation report...</p>
      </div>
    </main>
  );

  /* ============================================================
     MAIN RENDER
     ============================================================ */
  return (
    <main style={S.page}>

      {/* TAB SWITCH OVERLAY */}
      {showTabWarning && (
        <div style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,0.92)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#111", border: "1px solid #7f1d1d", borderRadius: "20px", padding: "40px", maxWidth: "380px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
            <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#ef4444", marginBottom: "10px" }}>Tab Switch Detected</h2>
            <p style={{ color: "#888", fontSize: "13px", marginBottom: "6px" }}>Switching tabs during an interview is not permitted.</p>
            <p style={{ color: "#666", fontSize: "12px", marginBottom: "20px" }}>
              Violation {integrityFlags} of 3. At 3 violations your session ends and is marked as unethical conduct.
            </p>
            {integrityFlags >= 3 ? (
              <div>
                <p style={{ color: "#ef4444", fontWeight: 700, marginBottom: "8px" }}>❌ Unethical Conduct Detected</p>
                <p style={{ color: "#666", fontSize: "12px" }}>Session is ending...</p>
              </div>
            ) : (
              <button onClick={() => setShowTabWarning(false)} style={{ background: "#7f1d1d", color: "#fff", border: "none", padding: "10px 24px", borderRadius: "8px", fontSize: "14px", cursor: "pointer" }}>
                Return to Interview
              </button>
            )}
          </div>
        </div>
      )}

      {/* LEFT — CAMERA */}
      <div style={{ width: "300px", flexShrink: 0, background: "#0d0d0d", borderRight: "1px solid #1e1e1e", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, position: "relative", background: "#111", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }}
          />
          {!cameraReady && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#111" }}>
              <p style={{ color: "#444", fontSize: "12px" }}>Camera loading...</p>
            </div>
          )}
          {isListening && (
            <div style={{ position: "absolute", top: "12px", left: "12px", display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.7)", padding: "6px 12px", borderRadius: "20px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse2 1s infinite" }} />
              <span style={{ fontSize: "11px", color: "#ef4444" }}>Recording</span>
            </div>
          )}
          {integrityFlags > 0 && (
            <div style={{ position: "absolute", top: "12px", right: "12px", background: "rgba(127,29,29,0.85)", padding: "4px 10px", borderRadius: "20px" }}>
              <span style={{ fontSize: "11px", color: "#fca5a5" }}>⚠️ {integrityFlags}/3</span>
            </div>
          )}
        </div>
        <div style={{ padding: "14px 16px", borderTop: "1px solid #1e1e1e", flexShrink: 0 }}>
          <p style={{ fontSize: "12px", color: "#888", marginBottom: "2px" }}>{settings.role}</p>
          {settings.company && <p style={{ fontSize: "11px", color: "#555", marginBottom: "6px" }}>{settings.company}</p>}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", background: "#1a1a1a", color: "#888", padding: "2px 8px", borderRadius: "20px" }}>{settings.round}</span>
            <span style={{ fontSize: "11px", background: "#1a1a1a", color: "#888", padding: "2px 8px", borderRadius: "20px" }}>{settings.difficulty}</span>
          </div>
        </div>
      </div>

      {/* RIGHT — CHAT */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid #1e1e1e", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span>🎤</span>
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>
                {settings.company ? `${settings.company} — ${settings.round} Round` : `${settings.round} Round Interview`}
              </p>
              <p style={{ fontSize: "11px", color: "#555" }}>{settings.interviewType} · {settings.difficulty}</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {questionNumber > 0 && phase !== "candidate-questions" && (
              <span style={{ fontSize: "12px", color: "#666" }}>Q {questionNumber} of 6</span>
            )}
            {phase === "answering" && (
              <span style={{ fontSize: "14px", fontFamily: "monospace", fontWeight: 600, color: getTimerColor() }}>
                {formatTime(elapsedSeconds)}
              </span>
            )}
          </div>
        </div>

        {/* READY SCREEN */}
        {phase === "ready" && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
            <div style={{ textAlign: "center", maxWidth: "420px" }}>
              <div style={{ fontSize: "44px", marginBottom: "16px" }}>🎤</div>
              <h2 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "10px" }}>Ready to begin?</h2>
              <p style={{ color: "#666", fontSize: "14px", marginBottom: "28px", lineHeight: 1.6 }}>
                The AI interviewer will ask you <strong style={{ color: "#fff" }}>6 questions</strong>. No feedback during the session — exactly like a real interview.
              </p>
              <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "14px", padding: "18px", textAlign: "left", marginBottom: "28px" }}>
                {[["📋 Round", settings.round], ["⏱ Ideal answer", idealDuration], ["🚫 Feedback", "only after all 6 questions"], ["📷 Camera", "active — maintain eye contact"], ["⚠️ Tab switching", "is monitored"]].map(([k, v]) => (
                  <p key={k} style={{ fontSize: "13px", color: "#888", marginBottom: "8px" }}>{k}: <span style={{ color: "#e5e7eb" }}>{v}</span></p>
                ))}
              </div>
              <button onClick={handleStart} style={{ background: "#1d4ed8", color: "#fff", border: "none", padding: "14px 36px", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
                Begin Interview →
              </button>
            </div>
          </div>
        )}

        {/* CHAT AREA */}
        {!["ready", "requesting-permissions", "permission-denied", "done"].includes(phase) && (
          <>
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "16px" }}>

              {messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", justifyContent: msg.role === "candidate" ? "flex-end" : "flex-start" }}>
                  {msg.role === "interviewer" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", maxWidth: "75%" }}>
                      {msg.questionNumber && (
                        <span style={{ fontSize: "11px", color: "#555", marginLeft: "4px" }}>Question {msg.questionNumber} of 6</span>
                      )}
                      <div style={S.interviewerBubble}>{msg.text}</div>
                    </div>
                  )}
                  {msg.role === "candidate" && (
                    <div style={msg.skipped ? S.skippedBubble : S.candidateBubble}>{msg.text}</div>
                  )}
                </div>
              ))}

              {/* Candidate questions */}
              {phase === "candidate-questions" && candidateAnswers.map((msg, i) => (
                <div key={`cq-${i}`} style={{ display: "flex", justifyContent: msg.role === "candidate" ? "flex-end" : "flex-start" }}>
                  <div style={msg.role === "candidate" ? S.candidateBubble : S.interviewerBubble}>{msg.text}</div>
                </div>
              ))}

              {isProcessing && (
                <div style={{ display: "flex" }}>
                  <div style={{ ...S.interviewerBubble, display: "flex", gap: "5px", alignItems: "center" }}>
                    {[0, 150, 300].map((d, i) => (
                      <span key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#555", display: "inline-block", animation: `pulse2 1s ${d}ms infinite` }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* CONTROLS */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid #1e1e1e", flexShrink: 0 }}>

              {/* PREPARE */}
              {phase === "prepare" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <p style={{ fontSize: "12px", color: "#666" }}>Ideal: <span style={{ color: "#e5e7eb" }}>{idealDuration}</span></p>
                    <p style={{ fontSize: "11px", color: "#444", marginTop: "2px" }}>Think, then click when ready</p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={handleSkipQuestion} style={{ padding: "9px 16px", borderRadius: "8px", border: "1px solid #2a2a2a", background: "transparent", color: "#666", fontSize: "13px", cursor: "pointer" }}>
                      Skip
                    </button>
                    <button onClick={handleStartAnswering} style={{ padding: "9px 20px", borderRadius: "10px", border: "none", background: "#1d4ed8", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                      🎙️ Start Answering
                    </button>
                  </div>
                </div>
              )}

              {/* ANSWERING */}
              {phase === "answering" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "12px 16px", minHeight: "60px", maxHeight: "120px", overflowY: "auto" }}>
                    <p style={{ fontSize: "14px", color: transcript ? "#fff" : "#444", lineHeight: 1.5 }}>
                      {transcript || "Speaking... your words will appear here"}
                    </p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444", display: "inline-block", animation: "pulse2 1s infinite" }} />
                      <span style={{ fontSize: "12px", color: "#888" }}>
                        {isListening ? "Listening" : "Paused"} · {formatTime(elapsedSeconds)}
                      </span>
                    </div>
                    <button onClick={handleSubmit} style={{ padding: "10px 22px", borderRadius: "10px", border: "none", background: "#16a34a", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                      ✓ Submit Answer
                    </button>
                  </div>
                </div>
              )}

              {/* CANDIDATE QUESTIONS */}
              {phase === "candidate-questions" && candidateQsLeft > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <p style={{ fontSize: "12px", color: "#666" }}>
                    You may ask {candidateQsLeft} question{candidateQsLeft > 1 ? "s" : ""} — or skip to results
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <textarea
                      value={candidateInput}
                      onChange={e => setCandidateInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCandidateQuestion(); } }}
                      style={{ flex: 1, background: "#111", border: "1px solid #2a2a2a", borderRadius: "10px", padding: "10px 14px", color: "#f0f0f0", fontSize: "13px", outline: "none", resize: "none", fontFamily: "inherit" }}
                      placeholder="Ask the interviewer a question..."
                      rows={1}
                    />
                    <button onClick={handleCandidateQuestion} disabled={!candidateInput.trim() || isProcessing} style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: "#1d4ed8", color: "#fff", fontSize: "13px", cursor: "pointer", opacity: !candidateInput.trim() || isProcessing ? 0.4 : 1 }}>
                      Ask
                    </button>
                    <button onClick={navigateToReport} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid #2a2a2a", background: "transparent", color: "#888", fontSize: "13px", cursor: "pointer" }}>
                      Results →
                    </button>
                  </div>
                </div>
              )}

              {phase === "candidate-questions" && candidateQsLeft <= 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button onClick={navigateToReport} style={{ padding: "12px 28px", borderRadius: "10px", border: "none", background: "#1d4ed8", color: "#fff", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                    See Your Results →
                  </button>
                </div>
              )}

              {isProcessing && (
                <p style={{ fontSize: "12px", color: "#555", textAlign: "center", marginTop: "8px" }}>
                  Interviewer is responding...
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse2 {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </main>
  );
}
