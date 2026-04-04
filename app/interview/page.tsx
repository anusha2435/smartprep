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

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

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
const FILLER_WORDS = ["um", "uh", "like", "you know", "basically", "literally", "actually", "so", "right", "okay", "kind of", "sort of"];

const IDEAL_DURATION: Record<string, string> = {
  Screening: "60-90s",
  Technical: "120-180s",
  Behavioral: "90-120s",
  Final: "90-150s",
};

const CANDIDATE_QUESTIONS_ALLOWED: Record<string, number> = {
  Screening: 1,
  Technical: 1,
  Behavioral: 1,
  Final: 2,
};

/* ============================================================
   HELPERS
   ============================================================ */
function countFillers(text: string): { count: number; words: string[] } {
  const lower = text.toLowerCase();
  const found: string[] = [];
  let count = 0;
  for (const word of FILLER_WORDS) {
    const regex = new RegExp(`\\b${word}\\b`, "g");
    const matches = lower.match(regex);
    if (matches) { count += matches.length; found.push(word); }
  }
  return { count, words: found };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/* ============================================================
   INTERVIEW PAGE
   ============================================================ */
export default function Interview() {
  const router = useRouter();

  const [settings, setSettings] = useState({
    role: "Software Engineer",
    company: "",
    interviewType: "Behavioral",
    difficulty: "Mid-Level",
    round: "Behavioral",
    ttsEnabled: false,
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
  const integrityRef = useRef(0);
  const graceRef = useRef(true);

  /* --- Camera --- */
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  /* --- Speech --- */
  const recognitionRef = useRef<any>(null);
  const [isListening, setIsListening] = useState(false);

  const snapshotTakenRef = useRef(false);
  const snapshotRef = useRef<string | undefined>(undefined);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const ttsEnabledRef = useRef(false);
  const phaseRef = useRef<InterviewPhase>("requesting-permissions");

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  /* ============================================================
     AUTO-SCROLL
     ============================================================ */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, candidateAnswers]);

  /* ============================================================
     INIT
     ============================================================ */
  useEffect(() => {
    const mode = sessionStorage.getItem("mode");
    if (!mode) { router.replace("/"); return; }

    const role = sessionStorage.getItem("role") || "Software Engineer";
    const company = sessionStorage.getItem("company") || "";
    const interviewType = sessionStorage.getItem("interviewType") || "Behavioral";
    const difficulty = sessionStorage.getItem("difficulty") || "Mid-Level";
    const round = sessionStorage.getItem("round") || "Behavioral";
    const ttsEnabled = sessionStorage.getItem("ttsEnabled") === "true";

    setSettings({ role, company, interviewType, difficulty, round, ttsEnabled });
    ttsEnabledRef.current = ttsEnabled;
    setCandidateQsLeft(CANDIDATE_QUESTIONS_ALLOWED[round] || 1);

    requestPermissions();
  }, [router]);

  /* ============================================================
     CAMERA — attach stream via useEffect watching cameraReady
     This avoids the race condition of callback refs
     ============================================================ */
  useEffect(() => {
    if (cameraReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraReady]);

  /* ============================================================
     REQUEST CAMERA + MIC
     ============================================================ */
  async function requestPermissions() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
        audio: true,
      });
      streamRef.current = stream;
      setCameraReady(true);
      setPhase("ready");

      // Grace period — ignore tab switches for 3s after permissions
      // Prevents permission dialog from counting as a violation
      graceRef.current = true;
      setTimeout(() => { graceRef.current = false; }, 3000);

    } catch {
      setPhase("permission-denied");
    }
  }

  /* ============================================================
     CLEANUP
     ============================================================ */
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      timerRef.current && clearInterval(timerRef.current);
      window.speechSynthesis?.cancel();
    };
  }, []);

  /* ============================================================
     TAB SWITCH DETECTION
     ============================================================ */
  useEffect(() => {
    function handleVisibilityChange() {
      if (graceRef.current) return;
      if (sessionEnded) return;
      if (document.hidden && ["prepare", "answering", "processing"].includes(phaseRef.current)) {
        integrityRef.current += 1;
        setIntegrityFlags(integrityRef.current);
        setShowTabWarning(true);
        if (integrityRef.current >= 3) {
          handleAutoEnd("integrity");
        }
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [sessionEnded]);

  /* ============================================================
     BEFOREUNLOAD
     ============================================================ */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!["ready", "done"].includes(phase)) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  /* ============================================================
     TTS
     ============================================================ */
  const speak = useCallback((text: string) => {
    if (!ttsEnabledRef.current) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }, []);

  /* ============================================================
     TIMER
     ============================================================ */
  function startTimer() {
    const start = Date.now();
    setAnswerStartTime(start);
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
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
    const delay = Math.random() * durationHint * 0.4 * 1000 + durationHint * 0.3 * 1000;
    setTimeout(() => {
      if (phaseRef.current !== "answering") return;
      if (!videoRef.current || snapshotTakenRef.current) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = videoRef.current.videoWidth || 320;
        canvas.height = videoRef.current.videoHeight || 240;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(videoRef.current, 0, 0);
        snapshotRef.current = canvas.toDataURL("image/jpeg", 0.6);
        snapshotTakenRef.current = true;
      } catch { }
    }, Math.min(delay, 20000));
  }

  /* ============================================================
     SPEECH RECOGNITION — auto-restarts on stop
     ============================================================ */
  function startListening() {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    let pauseStart: number | null = null;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      let finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript + " ";
          if (pauseStart !== null) {
            const pauseDuration = (Date.now() - pauseStart) / 1000;
            if (pauseDuration > 1.5) {
              setSilencePauses((p) => p + 1);
              setLongestPause((prev) => Math.max(prev, pauseDuration));
            }
            pauseStart = null;
          }
        }
      }
      if (finalText) setTranscript((prev) => (prev + finalText).trimStart());
    };

    recognition.onspeechend = () => { pauseStart = Date.now(); };

    recognition.onerror = (e: any) => {
      if ((e.error === "no-speech" || e.error === "network") && phaseRef.current === "answering") {
        setTimeout(() => startListening(), 500);
      } else {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      if (phaseRef.current === "answering") {
        setTimeout(() => startListening(), 300);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.stop();
    }
    setIsListening(false);
  }

  /* ============================================================
     CALL AI
     ============================================================ */
  async function callAI(
    userMessage: string,
    currentHistory: ConversationTurn[],
    metadata?: AnswerMetadata[]
  ): Promise<any> {
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
        message: userMessage,
        conversationHistory: currentHistory,
        answerMetadata: metadata || [],
        integrityFlags: integrityRef.current,
      }),
    });
    return await res.json();
  }

  /* ============================================================
     START INTERVIEW
     ============================================================ */
  async function handleStart() {
    setPhase("processing");
    try {
      const data = await callAI("START", []);
      const q = data.question || "Tell me about yourself.";
      const newHistory: ConversationTurn[] = [
        { role: "user", content: "START" },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      setConversationHistory(newHistory);
      setCurrentQuestion(q);
      setQuestionNumber(1);
      setMessages([{ role: "interviewer", text: q, questionNumber: 1 }]);
      setPhase("prepare");
      speak(q);
      saveToLocalStorage(newHistory, []);
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
    const idealSeconds = parseInt(IDEAL_DURATION[settings.round]?.split("-")[0] || "90");
    scheduleSnapshot(idealSeconds);
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

    const { count: fillerCount, words: fillerWordList } = countFillers(finalTranscript);
    const metadata: AnswerMetadata = {
      questionNumber,
      questionText: currentQuestion,
      transcript: finalTranscript,
      fillerWordCount: fillerCount,
      fillerWords: fillerWordList,
      answerDurationSeconds: duration,
      idealDurationRange: IDEAL_DURATION[settings.round] || "90-120s",
      silencePausesCount: silencePauses,
      longestPauseSeconds: Math.round(longestPause * 10) / 10,
      cameraSnapshot: snapshotRef.current,
    };

    const newAllMetadata = [...allMetadata, metadata];
    setAllMetadata(newAllMetadata);

    const updatedMessages: InterviewMessage[] = [...messages, { role: "candidate", text: finalTranscript }];
    setMessages(updatedMessages);

    const newHistory: ConversationTurn[] = [...conversationHistory, { role: "user", content: finalTranscript }];

    try {
      const isLastQuestion = questionNumber >= 6;
      const data = await callAI(finalTranscript, conversationHistory, isLastQuestion ? newAllMetadata : []);
      const updatedHistory: ConversationTurn[] = [...newHistory, { role: "assistant", content: JSON.stringify(data) }];
      setConversationHistory(updatedHistory);

      if (data.done === true || isLastQuestion) {
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({ ...data.report, integrityFlags: integrityRef.current }));
          sessionStorage.setItem("interviewMetadata", JSON.stringify(newAllMetadata));
        }
        saveToLocalStorage(updatedHistory, newAllMetadata, data.report);
        setMessages([...updatedMessages, {
          role: "interviewer",
          text: `That concludes my questions. ${CANDIDATE_QUESTIONS_ALLOWED[settings.round] > 0 ? "Do you have any questions for me?" : ""}`,
        }]);
        setPhase("candidate-questions");
      } else if (data.question) {
        const nextQ = data.question;
        const nextNum = Math.min(data.questionNumber || questionNumber + 1, 6);
        setCurrentQuestion(nextQ);
        setQuestionNumber(nextNum);
        setMessages([...updatedMessages, { role: "interviewer", text: nextQ, questionNumber: nextNum }]);
        setPhase("prepare");
        speak(nextQ);
        saveToLocalStorage(updatedHistory, newAllMetadata);
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

    const skipMetadata: AnswerMetadata = {
      questionNumber,
      questionText: currentQuestion,
      transcript: "[SKIPPED]",
      fillerWordCount: 0,
      fillerWords: [],
      answerDurationSeconds: 0,
      idealDurationRange: IDEAL_DURATION[settings.round] || "90-120s",
      silencePausesCount: 0,
      longestPauseSeconds: 0,
      skipped: true,
    };

    const newAllMetadata = [...allMetadata, skipMetadata];
    setAllMetadata(newAllMetadata);

    const updatedMessages: InterviewMessage[] = [
      ...messages,
      { role: "candidate", text: "[Question skipped]", skipped: true },
    ];
    setMessages(updatedMessages);

    const newHistory: ConversationTurn[] = [
      ...conversationHistory,
      { role: "user", content: "I need to skip this question." },
    ];

    try {
      const isLastQuestion = questionNumber >= 6;
      const data = await callAI("I need to skip this question.", conversationHistory, isLastQuestion ? newAllMetadata : []);
      const updatedHistory: ConversationTurn[] = [...newHistory, { role: "assistant", content: JSON.stringify(data) }];
      setConversationHistory(updatedHistory);

      if (data.done === true || isLastQuestion) {
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({ ...data.report, integrityFlags: integrityRef.current }));
          sessionStorage.setItem("interviewMetadata", JSON.stringify(newAllMetadata));
        }
        setMessages([...updatedMessages, { role: "interviewer", text: "That concludes my questions. Do you have any questions for me?" }]);
        setPhase("candidate-questions");
      } else if (data.question) {
        const nextQ = data.question;
        const nextNum = Math.min(data.questionNumber || questionNumber + 1, 6);
        setCurrentQuestion(nextQ);
        setQuestionNumber(nextNum);
        setMessages([...updatedMessages, { role: "interviewer", text: nextQ, questionNumber: nextNum }]);
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
    setCandidateAnswers((prev) => [...prev, { role: "candidate", text: q }]);
    setPhase("processing");
    try {
      const data = await callAI(q, conversationHistory);
      const answer = data.question || data.nextQuestion || "Thank you for your question.";
      setCandidateAnswers((prev) => [...prev, { role: "interviewer", text: answer }]);
      const remaining = candidateQsLeft - 1;
      setCandidateQsLeft(remaining);
      if (remaining <= 0) setTimeout(() => navigateToReport(), 1500);
    } catch {
      setCandidateAnswers((prev) => [...prev, { role: "interviewer", text: "Thank you for your question." }]);
    }
    setPhase("candidate-questions");
  }

  function navigateToReport() {
    setPhase("done");
    setSessionEnded(true);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    router.push("/report");
  }

  /* ============================================================
     AUTO-END — hard 5s timeout ensures navigation happens
     ============================================================ */
  async function handleAutoEnd(reason: "integrity" | "manual") {
    setSessionEnded(true);
    setShowTabWarning(false);
    stopListening();
    stopTimer();
    setPhase("done");

    sessionStorage.setItem("interviewMetadata", JSON.stringify(allMetadata));
    sessionStorage.setItem("integrityFlags", String(integrityRef.current));

    // Hard timeout — navigate after 5s no matter what API does
    const hardTimeout = setTimeout(() => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      router.push("/report");
    }, 5000);

    try {
      if (allMetadata.length > 0) {
        const data = await callAI(
          "SESSION ENDED EARLY. Generate partial report from answers received so far.",
          conversationHistory,
          allMetadata
        );
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({
            ...data.report,
            integrityFlags: integrityRef.current,
            sessionEndedEarly: true,
            endReason: reason,
          }));
        }
      }
    } catch { }

    clearTimeout(hardTimeout);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    router.push("/report");
  }

  /* ============================================================
     SAVE TO LOCALSTORAGE
     ============================================================ */
  function saveToLocalStorage(history: ConversationTurn[], metadata: AnswerMetadata[], report?: any) {
  try {
    const sessionData = {
      timestamp: Date.now(),
      settings,
      conversationHistory: history,
      allMetadata: metadata,
      integrityFlags: integrityRef.current,
      report: report || null,
    };

    // Save as last session (existing behaviour)
    localStorage.setItem("lastInterviewSession", JSON.stringify(sessionData));

    // Also append to sessions array for home page history
    const existing = JSON.parse(localStorage.getItem("interviewSessions") || "[]");
    // Remove duplicate if same session already exists (same timestamp within 10s)
    const filtered = existing.filter((s: any) => Math.abs(s.timestamp - sessionData.timestamp) > 10000);
    filtered.unshift(sessionData);
    localStorage.setItem("interviewSessions", JSON.stringify(filtered.slice(0, 20)));

  } catch { }
}

  /* ============================================================
     TIMER COLOR
     ============================================================ */
  function getTimerColor(): string {
    const [minStr, maxStr] = (IDEAL_DURATION[settings.round] || "90-120s").replace("s", "").split("-").map(Number);
    if (elapsedSeconds < minStr) return "text-gray-400";
    if (elapsedSeconds <= maxStr) return "text-green-400";
    return "text-amber-400";
  }

  /* ============================================================
     RENDER — PERMISSION DENIED
     ============================================================ */
  if (phase === "permission-denied") {
    return (
      <main className="flex h-screen bg-black text-white items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">📷</div>
          <h2 className="text-xl font-bold mb-2">Camera Required</h2>
          <p className="text-gray-400 text-sm mb-2">Interview Mode requires camera and microphone access.</p>
          <p className="text-gray-500 text-xs mb-6">
            Click the camera icon in your browser address bar → Allow → then refresh.
          </p>
          <button onClick={() => window.location.reload()} className="bg-blue-600 hover:bg-blue-500 px-6 py-2.5 rounded-xl text-sm font-medium mr-3">
            Retry →
          </button>
          <button onClick={() => router.push("/")} className="text-gray-600 hover:text-gray-400 text-sm">← Back</button>
        </div>
      </main>
    );
  }

  /* ============================================================
     RENDER — REQUESTING PERMISSIONS
     ============================================================ */
  if (phase === "requesting-permissions") {
    return (
      <main className="flex h-screen bg-black text-white items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-4 animate-pulse">📷</div>
          <p className="text-gray-400 text-sm">Requesting camera and microphone access...</p>
          <p className="text-gray-600 text-xs mt-2">Allow access in the browser popup</p>
        </div>
      </main>
    );
  }

  /* ============================================================
     RENDER — DONE
     ============================================================ */
  if (phase === "done") {
    return (
      <main className="flex h-screen bg-black text-white items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-4">📊</div>
          <p className="text-gray-400 text-sm">Generating your evaluation report...</p>
        </div>
      </main>
    );
  }

  const idealDuration = IDEAL_DURATION[settings.round] || "90-120s";
  const isProcessing = phase === "processing";

  /* ============================================================
     RENDER — MAIN
     ============================================================ */
  return (
    <main className="flex h-screen bg-black text-white overflow-hidden">

      {/* ---- TAB SWITCH OVERLAY ---- */}
      {showTabWarning && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center">
          <div className="bg-gray-900 border border-red-700 rounded-2xl p-8 max-w-sm text-center">
            <div className="text-3xl mb-3">⚠️</div>
            <h2 className="text-lg font-bold text-red-400 mb-2">Tab Switch Detected</h2>
            <p className="text-gray-400 text-sm mb-1">Switching tabs during an interview is not permitted.</p>
            <p className="text-gray-500 text-xs mb-4">
              Violation {integrityFlags} of 3. At 3 violations, your session will end and be marked as unethical conduct.
            </p>
            {integrityFlags >= 3 ? (
              <div>
                <p className="text-red-400 text-sm font-semibold mb-2">❌ Unethical Conduct Detected</p>
                <p className="text-gray-500 text-xs">Session is ending...</p>
              </div>
            ) : (
              <button
                onClick={() => setShowTabWarning(false)}
                className="bg-red-700 hover:bg-red-600 px-6 py-2 rounded-lg text-sm font-medium"
              >
                Return to Interview
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- LEFT — CAMERA ---- */}
      <div className="w-80 shrink-0 bg-gray-950 border-r border-gray-800 flex flex-col">

        <div className="relative flex-1 bg-gray-900 flex items-center justify-center min-h-0">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />

          {!cameraReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900">
              <p className="text-xs text-gray-600">Camera loading...</p>
            </div>
          )}

          {isListening && (
            <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-black/60 px-2.5 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-400">Recording</span>
            </div>
          )}

          {integrityFlags > 0 && (
            <div className="absolute top-3 right-3 bg-red-900/80 px-2 py-1 rounded-full">
              <span className="text-xs text-red-300">⚠️ {integrityFlags}/3</span>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 shrink-0">
          <p className="text-xs text-gray-500 mb-0.5">{settings.role}</p>
          {settings.company && <p className="text-xs text-gray-600">{settings.company}</p>}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{settings.round}</span>
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">{settings.difficulty}</span>
          </div>
        </div>
      </div>

      {/* ---- RIGHT — INTERVIEW CHAT ---- */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="text-blue-400">🎤</div>
            <div>
              <h1 className="text-sm font-semibold">
                {settings.company ? `${settings.company} — ${settings.round} Round` : `${settings.round} Round Interview`}
              </h1>
              <p className="text-xs text-gray-500">{settings.interviewType} · {settings.difficulty}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {questionNumber > 0 && phase !== "candidate-questions" && (
              <span className="text-xs text-gray-400">Q {questionNumber} of 6</span>
            )}
            {phase === "answering" && (
              <span className={`text-sm font-mono font-medium ${getTimerColor()}`}>
                {formatTime(elapsedSeconds)}
              </span>
            )}
          </div>
        </div>

        {/* READY SCREEN */}
        {phase === "ready" && (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="text-center max-w-sm">
              <div className="text-4xl mb-4">🎤</div>
              <h2 className="text-xl font-bold mb-2">Ready to begin?</h2>
              <p className="text-gray-400 text-sm mb-6">
                The AI interviewer will ask you <strong className="text-white">6 questions</strong>. No feedback during the session — exactly like a real interview.
              </p>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-left text-sm text-gray-300 space-y-1.5 mb-6">
                <p>📋 Round: <span className="text-white">{settings.round}</span></p>
                <p>⏱ Ideal answer: <span className="text-white">{idealDuration}</span></p>
                <p>🚫 No feedback until the end</p>
                <p>📷 Camera active — maintain eye contact</p>
                <p>⚠️ Tab switching is monitored</p>
              </div>
              <button onClick={handleStart} className="bg-blue-600 hover:bg-blue-500 px-8 py-3 rounded-xl font-semibold transition-colors">
                Begin Interview →
              </button>
            </div>
          </div>
        )}

        {/* MAIN CHAT */}
        {!["ready", "requesting-permissions", "permission-denied", "done"].includes(phase) && (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "candidate" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "interviewer" && (
                    <div className="flex flex-col gap-1 max-w-[75%]">
                      {msg.questionNumber && (
                        <span className="text-xs text-gray-600 ml-1">Question {msg.questionNumber} of 6</span>
                      )}
                      <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-gray-800 text-white text-sm leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  )}
                  {msg.role === "candidate" && (
                    <div className={`px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[70%] text-sm leading-relaxed ${
                      msg.skipped ? "bg-gray-700 text-gray-400 italic" : "bg-blue-700 text-white"
                    }`}>
                      {msg.text}
                    </div>
                  )}
                </div>
              ))}

              {phase === "candidate-questions" && candidateAnswers.map((msg, i) => (
                <div key={`cq-${i}`} className={`flex ${msg.role === "candidate" ? "justify-end" : "justify-start"}`}>
                  <div className={`px-4 py-2.5 rounded-2xl max-w-[70%] text-sm leading-relaxed ${
                    msg.role === "candidate" ? "bg-blue-700 rounded-tr-sm text-white" : "bg-gray-800 rounded-tl-sm text-white"
                  }`}>
                    {msg.text}
                  </div>
                </div>
              ))}

              {isProcessing && (
                <div className="flex justify-start">
                  <div className="px-4 py-2.5 rounded-2xl bg-gray-800 text-gray-500 text-sm flex items-center gap-1.5">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* CONTROLS */}
            <div className="px-6 py-4 border-t border-gray-800 shrink-0">

              {/* PREPARE */}
              {phase === "prepare" && (
                <div className="flex items-center justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <p className="text-xs text-gray-500">
                      Ideal: <span className="text-gray-300">{idealDuration}</span>
                    </p>
                    <p className="text-xs text-gray-600">Think, then click when ready</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSkipQuestion}
                      className="px-4 py-2 rounded-lg text-sm border border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600 transition-colors"
                    >
                      Skip
                    </button>
                    <button
                      onClick={handleStartAnswering}
                      className="bg-blue-600 hover:bg-blue-500 px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors"
                    >
                      🎙️ Start Answering
                    </button>
                  </div>
                </div>
              )}

              {/* ANSWERING */}
              {phase === "answering" && (
                <div className="flex flex-col gap-3">
                  <div className="bg-gray-900 border border-gray-700 rounded-xl px-4 py-3 min-h-[60px] max-h-[120px] overflow-y-auto">
                    <p className="text-sm text-white leading-relaxed">
                      {transcript || <span className="text-gray-600">Speaking... your words will appear here</span>}
                    </p>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-xs text-gray-400">
                        {isListening ? "Listening" : "Paused"} · {formatTime(elapsedSeconds)}
                      </span>
                    </div>
                    <button
                      onClick={handleSubmit}
                      className="bg-green-600 hover:bg-green-500 px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors"
                    >
                      ✓ Submit Answer
                    </button>
                  </div>
                </div>
              )}

              {/* CANDIDATE QUESTIONS */}
              {phase === "candidate-questions" && candidateQsLeft > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-500">
                    You may ask {candidateQsLeft} question{candidateQsLeft > 1 ? "s" : ""} — or skip to results
                  </p>
                  <div className="flex gap-2">
                    <textarea
                      value={candidateInput}
                      onChange={(e) => setCandidateInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCandidateQuestion(); } }}
                      className="flex-1 bg-gray-900 border border-gray-700 rounded-xl px-4 py-2.5 text-sm text-white outline-none resize-none placeholder-gray-600"
                      placeholder="Ask the interviewer a question..."
                      rows={1}
                    />
                    <button
                      onClick={handleCandidateQuestion}
                      disabled={!candidateInput.trim() || isProcessing}
                      className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                    >
                      Ask
                    </button>
                    <button
                      onClick={navigateToReport}
                      className="px-4 py-2 rounded-xl text-sm text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 transition-colors"
                    >
                      Results →
                    </button>
                  </div>
                </div>
              )}

              {phase === "candidate-questions" && candidateQsLeft <= 0 && (
                <div className="flex justify-end">
                  <button onClick={navigateToReport} className="bg-blue-600 hover:bg-blue-500 px-6 py-2.5 rounded-xl text-sm font-semibold transition-colors">
                    See Your Results →
                  </button>
                </div>
              )}

              {isProcessing && (
                <p className="text-xs text-gray-600 text-center mt-2">Interviewer is responding...</p>
              )}

            </div>
          </>
        )}
      </div>
    </main>
  );
}
