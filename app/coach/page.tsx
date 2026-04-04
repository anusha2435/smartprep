"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

/* ============================================================
   TYPES
   ============================================================ */
type Feedback = {
  strengths: string;
  improve: string;
  betterPhrasing: string;
} | null;

type Message =
  | { sender: "user"; text: string }
  | { sender: "ai"; type: "question"; text: string }
  | { sender: "ai"; type: "feedback"; feedback: Feedback }
  | { sender: "ai"; type: "coach-answer"; text: string }; // response to user's own question

type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type SessionState = "idle" | "waiting-next" | "asking-coach" | "loading";
//  idle          → user can type/speak answer
//  waiting-next  → feedback shown, showing Next + Ask buttons
//  asking-coach  → user clicked "Ask a Question", inline input shown
//  loading       → API call in progress

/* ============================================================
   FILLER WORDS (used for speech confidence proxy)
   ============================================================ */
const FILLER_WORDS = ["um", "uh", "like", "you know", "basically", "literally", "actually", "so", "right"];

function countFillers(text: string): number {
  const lower = text.toLowerCase();
  return FILLER_WORDS.reduce((count, word) => {
    const regex = new RegExp(`\\b${word}\\b`, "g");
    return count + (lower.match(regex)?.length || 0);
  }, 0);
}

/* ============================================================
   COACH PAGE
   ============================================================ */
export default function Coach() {
  const router = useRouter();

  /* --- Settings from sessionStorage --- */
  const [settings, setSettings] = useState({
    role: "Software Engineer",
    company: "",
    interviewType: "Behavioral",
    difficulty: "Mid-Level",
    inputMode: "text" as "text" | "speech",
    ttsEnabled: false,
  });

  /* --- UI state --- */
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [sessionStarted, setSessionStarted] = useState(false);

  /* --- Input state --- */
  const [answer, setAnswer] = useState("");
  const [coachQuestion, setCoachQuestion] = useState(""); // for "Ask a Question" inline input

  /* --- Camera state --- */
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  /* --- Speech state --- */
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef<any>(null);

  /* --- TTS state --- */
  const [ttsOn, setTtsOn] = useState(false);

  /* --- Refs --- */
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const coachInputRef = useRef<HTMLTextAreaElement>(null);

  /* ============================================================
     INIT — read settings from sessionStorage
     ============================================================ */
  useEffect(() => {
    // Redirect if no settings saved (direct URL access)
    const mode = sessionStorage.getItem("mode");
    if (!mode) {
      router.replace("/");
      return;
    }

    const role = sessionStorage.getItem("role") || "Software Engineer";
    const company = sessionStorage.getItem("company") || "";
    const interviewType = sessionStorage.getItem("interviewType") || "Behavioral";
    const difficulty = sessionStorage.getItem("difficulty") || "Mid-Level";
    const inputMode = (sessionStorage.getItem("inputMode") || "text") as "text" | "speech";
    const ttsEnabled = sessionStorage.getItem("ttsEnabled") === "true";

    setSettings({ role, company, interviewType, difficulty, inputMode, ttsEnabled });
    setTtsOn(ttsEnabled);

    // Check speech support
    if (typeof window !== "undefined" && !("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setSpeechSupported(false);
    }
  }, [router]);

  /* ============================================================
     AUTO-SCROLL
     ============================================================ */
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /* ============================================================
     TEXTAREA AUTO-EXPAND
     ============================================================ */
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [answer]);

  useEffect(() => {
    if (coachInputRef.current) {
      coachInputRef.current.style.height = "auto";
      coachInputRef.current.style.height = `${Math.min(coachInputRef.current.scrollHeight, 120)}px`;
    }
  }, [coachQuestion]);

  /* ============================================================
     BEFOREUNLOAD WARNING
     ============================================================ */
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (sessionStarted) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionStarted]);

  /* ============================================================
     TTS — speak text
     ============================================================ */
  const speak = useCallback((text: string) => {
    if (!ttsOn || typeof window === "undefined") return;
    window.speechSynthesis.cancel(); // cancel any ongoing speech
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }, [ttsOn]);

  // Cancel TTS on unmount
  useEffect(() => {
    return () => { window.speechSynthesis?.cancel(); };
  }, []);

  /* ============================================================
     CAMERA
     ============================================================ */
  async function toggleCamera() {
    if (cameraOn) {
      // Turn off
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);
      setCameraError("");
    } else {
      // Turn on
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setCameraOn(true);
        setCameraError("");
      } catch {
        setCameraError("Camera access denied. Check browser permissions.");
      }
    }
  }

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  /* ============================================================
     SPEECH RECOGNITION
     ============================================================ */
  function startListening() {
    if (!speechSupported) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript + " ";
        } else {
          interim += transcript;
        }
      }
      // Append final to textarea, show interim as preview
      if (final) {
        setAnswer((prev) => (prev + final).trimStart());
      }
    };

    recognition.onerror = () => {
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function toggleMic() {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }

  /* ============================================================
     SAVE SESSION TO LOCALSTORAGE
     ============================================================ */
  function saveSession(msgs: Message[], history: ConversationTurn[]) {
    try {
      localStorage.setItem("lastCoachSession", JSON.stringify({
        timestamp: Date.now(),
        settings,
        messages: msgs,
        conversationHistory: history,
      }));
    } catch {
      // localStorage full — ignore
    }
  }

  /* ============================================================
     CALL AI
     ============================================================ */
  async function callAI(
    userMessage: string,
    currentHistory: ConversationTurn[],
    isCoachQuestion = false
  ) {
    setSessionState("loading");

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "coach",
          role: settings.role,
          company: settings.company,
          interviewType: settings.interviewType,
          difficulty: settings.difficulty,
          resumeText: sessionStorage.getItem("resumeText") || "",
          message: userMessage,
          conversationHistory: currentHistory,
        }),
      });

      const data = await res.json();

      // Build new history entry
      const newHistory: ConversationTurn[] = [
        ...currentHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      setConversationHistory(newHistory);

      let newMessages = [...messages];

      if (isCoachQuestion) {
        // User asked the coach a question — show plain response
        if (data.nextQuestion) {
          const msg: Message = { sender: "ai", type: "coach-answer", text: data.nextQuestion };
          newMessages = [...newMessages, msg];
          speak(data.nextQuestion);
        }
        setSessionState("waiting-next");
      } else {
        // Normal answer flow
        if (data.feedback) {
          const feedbackMsg: Message = { sender: "ai", type: "feedback", feedback: data.feedback };
          newMessages = [...newMessages, feedbackMsg];
        }

        if (data.nextQuestion) {
          const questionMsg: Message = { sender: "ai", type: "question", text: data.nextQuestion };
          newMessages = [...newMessages, questionMsg];
          speak(data.nextQuestion);
        }

        setSessionState("waiting-next");
      }

      setMessages(newMessages);
      saveSession(newMessages, newHistory);

    } catch {
      setMessages((prev) => [
        ...prev,
        { sender: "ai", type: "question", text: "Something went wrong. Please try again." },
      ]);
      setSessionState("idle");
    }
  }

  /* ============================================================
     START SESSION
     ============================================================ */
  async function handleStart() {
    setSessionStarted(true);
    setSessionState("loading");

    // Send START to API — AI sends warm-up question
    const startHistory: ConversationTurn[] = [];

    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "coach",
          role: settings.role,
          company: settings.company,
          interviewType: settings.interviewType,
          difficulty: settings.difficulty,
          resumeText: sessionStorage.getItem("resumeText") || "",
          message: "START",
          conversationHistory: [],
        }),
      });

      const data = await res.json();

      const firstQuestion = data.nextQuestion || `Tell me about yourself and your journey into ${settings.role}.`;

      const newHistory: ConversationTurn[] = [
        { role: "user", content: "START" },
        { role: "assistant", content: JSON.stringify(data) },
      ];

      const newMessages: Message[] = [
        { sender: "ai", type: "question", text: firstQuestion },
      ];

      setConversationHistory(newHistory);
      setMessages(newMessages);
      speak(firstQuestion);
      setSessionState("idle");
      saveSession(newMessages, newHistory);

    } catch {
      const fallbackQ = `Tell me about yourself and your journey into ${settings.role}.`;
      const newMessages: Message[] = [
        { sender: "ai", type: "question", text: fallbackQ },
      ];
      setMessages(newMessages);
      speak(fallbackQ);
      setSessionState("idle");
    }
  }

  /* ============================================================
     SEND ANSWER
     ============================================================ */
  async function handleSend() {
    const trimmed = answer.trim();
    if (!trimmed || sessionState === "loading") return;

    stopListening();

    const userMsg: Message = { sender: "user", text: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setAnswer("");

    await callAI(trimmed, conversationHistory);
  }

  /* ============================================================
     SKIP QUESTION
     ============================================================ */
  async function handleSkip() {
    if (sessionState === "loading") return;
    await callAI("Please give me a different question.", conversationHistory);
    setSessionState("idle");
  }

  /* ============================================================
     ASK COACH A QUESTION
     ============================================================ */
  function handleOpenCoachQuestion() {
    setSessionState("asking-coach");
    setTimeout(() => coachInputRef.current?.focus(), 100);
  }

  async function handleSendCoachQuestion() {
    const trimmed = coachQuestion.trim();
    if (!trimmed || sessionState === "loading") return;

    const userMsg: Message = { sender: "user", text: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setCoachQuestion("");

    await callAI(trimmed, conversationHistory, true);
  }

  /* ============================================================
     NEXT QUESTION
     ============================================================ */
  async function handleNextQuestion() {
    if (sessionState === "loading") return;
    setSessionState("loading");
    await callAI("next", conversationHistory);
    setSessionState("idle");
  }

  /* ============================================================
     KEY HANDLERS
     ============================================================ */
  function handleAnswerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleCoachKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendCoachQuestion();
    }
  }

  /* ============================================================
     RENDER
     ============================================================ */
  const isLoading = sessionState === "loading";
  const showActionButtons = sessionState === "waiting-next";
  const showCoachInput = sessionState === "asking-coach";

  return (
    <main className="flex h-screen bg-black text-white overflow-hidden">

      {/* ---- LEFT SIDEBAR ---- */}
      <div className="w-56 bg-gray-950 border-r border-gray-800 p-4 flex flex-col shrink-0">

        {/* Session info */}
        <div className="mb-4">
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Session</p>
          <p className="text-sm text-white font-medium">{settings.role}</p>
          {settings.company && (
            <p className="text-xs text-gray-400">{settings.company}</p>
          )}
          <div className="flex flex-wrap gap-1 mt-2">
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
              {settings.interviewType}
            </span>
            <span className="text-xs bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full">
              {settings.difficulty}
            </span>
          </div>
        </div>

        <div className="border-t border-gray-800 pt-4 flex flex-col gap-2">

          {/* Camera toggle */}
          <button
            onClick={toggleCamera}
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors ${
              cameraOn
                ? "bg-green-900/40 text-green-400 border border-green-800"
                : "bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600"
            }`}
          >
            <span>{cameraOn ? "📷" : "📷"}</span>
            <span>{cameraOn ? "Camera On" : "Camera Off"}</span>
          </button>

          {cameraError && (
            <p className="text-xs text-red-400">{cameraError}</p>
          )}

          {/* TTS toggle */}
          <button
            onClick={() => {
              window.speechSynthesis?.cancel();
              setTtsOn(!ttsOn);
            }}
            className={`flex items-center gap-2 text-sm px-3 py-2 rounded-lg transition-colors ${
              ttsOn
                ? "bg-blue-900/40 text-blue-400 border border-blue-800"
                : "bg-gray-900 text-gray-400 border border-gray-800 hover:border-gray-600"
            }`}
          >
            <span>🔊</span>
            <span>{ttsOn ? "Voice On" : "Voice Off"}</span>
          </button>

          {/* Speech not supported warning */}
          {!speechSupported && (
            <div className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800 rounded-lg p-2">
              Speech input requires Chrome. Use text input instead.
            </div>
          )}

        </div>

        {/* Camera preview */}
        {cameraOn && (
          <div className="mt-4 rounded-lg overflow-hidden border border-gray-700">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              className="w-full"
              style={{ transform: "scaleX(-1)" }} // mirror
            />
          </div>
        )}

        {/* End session */}
        <div className="mt-auto">
          <button
            onClick={() => router.push("/")}
            className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors py-2"
          >
            ← End Session
          </button>
        </div>

      </div>

      {/* ---- MAIN CHAT AREA ---- */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3 shrink-0">
          <div className="text-green-400 text-lg">🎯</div>
          <div>
            <h1 className="text-base font-semibold">AI Coach</h1>
            <p className="text-xs text-gray-500">
              Warm feedback after every answer
            </p>
          </div>
        </div>

        {/* ---- PRE-START SCREEN ---- */}
        {!sessionStarted ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="text-center max-w-sm">
              <div className="text-4xl mb-4">🎯</div>
              <h2 className="text-xl font-bold mb-2">Ready to practice?</h2>
              <p className="text-gray-400 text-sm mb-6">
                Your AI coach will ask one question at a time and give structured
                feedback after each answer.
              </p>
              <div className="bg-gray-900 rounded-xl p-4 text-left text-sm text-gray-300 space-y-1.5 mb-6 border border-gray-800">
                <p>🎯 Role: <span className="text-white">{settings.role}</span></p>
                {settings.company && <p>🏢 Company: <span className="text-white">{settings.company}</span></p>}
                <p>📋 Type: <span className="text-white">{settings.interviewType}</span></p>
                <p>⚡ Difficulty: <span className="text-white">{settings.difficulty}</span></p>
              </div>
              <button
                onClick={handleStart}
                className="bg-green-600 hover:bg-green-500 px-8 py-3 rounded-xl font-semibold text-white transition-colors"
              >
                Start Session →
              </button>
            </div>
          </div>

        ) : (
          <>
            {/* ---- MESSAGES ---- */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

              {messages.map((msg, i) => {

                if (msg.sender === "user") {
                  return (
                    <div key={i} className="flex justify-end">
                      <div className="px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-[70%] bg-blue-600 text-white text-sm leading-relaxed">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.sender === "ai" && msg.type === "question") {
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex justify-start">
                        <div className="px-4 py-3 rounded-2xl rounded-tl-sm max-w-[75%] bg-gray-800 text-white text-sm leading-relaxed">
                          {msg.text}
                        </div>
                      </div>
                      {/* Skip link — only on last question when idle */}
                      {i === messages.length - 1 && sessionState === "idle" && (
                        <button
                          onClick={handleSkip}
                          className="text-xs text-gray-600 hover:text-gray-400 ml-1 transition-colors self-start"
                        >
                          Skip this question
                        </button>
                      )}
                    </div>
                  );
                }

                if (msg.sender === "ai" && msg.type === "coach-answer") {
                  return (
                    <div key={i} className="flex justify-start">
                      <div className="px-4 py-3 rounded-2xl rounded-tl-sm max-w-[75%] bg-gray-700 text-white text-sm leading-relaxed border-l-2 border-blue-500">
                        {msg.text}
                      </div>
                    </div>
                  );
                }

                if (msg.sender === "ai" && msg.type === "feedback" && msg.feedback) {
                  return (
                    <div key={i} className="max-w-[85%] rounded-xl overflow-hidden border border-gray-700">
                      <div className="bg-green-900/30 border-b border-gray-700 px-4 py-3">
                        <p className="text-green-400 text-xs font-semibold mb-1.5 uppercase tracking-wide">
                          ✅ Strengths
                        </p>
                        <p className="text-gray-200 text-sm whitespace-pre-line leading-relaxed">
                          {msg.feedback.strengths}
                        </p>
                      </div>
                      <div className="bg-amber-900/20 border-b border-gray-700 px-4 py-3">
                        <p className="text-amber-400 text-xs font-semibold mb-1.5 uppercase tracking-wide">
                          ⚠️ Improve
                        </p>
                        <p className="text-gray-200 text-sm whitespace-pre-line leading-relaxed">
                          {msg.feedback.improve}
                        </p>
                      </div>
                      <div className="bg-blue-900/20 px-4 py-3">
                        <p className="text-blue-400 text-xs font-semibold mb-1.5 uppercase tracking-wide">
                          💡 Better Phrasing
                        </p>
                        <p className="text-gray-200 text-sm whitespace-pre-line leading-relaxed">
                          {msg.feedback.betterPhrasing}
                        </p>
                      </div>
                    </div>
                  );
                }

                return null;
              })}

              {/* Loading */}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="px-4 py-2.5 rounded-2xl bg-gray-800 text-gray-400 text-sm flex items-center gap-2">
                    <span className="animate-pulse">●</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.2s" }}>●</span>
                    <span className="animate-pulse" style={{ animationDelay: "0.4s" }}>●</span>
                  </div>
                </div>
              )}

              {/* Action buttons — shown after feedback */}
              {showActionButtons && (
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={handleOpenCoachQuestion}
                    className="px-4 py-2 rounded-lg text-sm border border-gray-700 text-gray-300 hover:bg-gray-800 transition-colors"
                  >
                    💬 Ask a Question
                  </button>
                  <button
                    onClick={() => { setSessionState("idle"); }}
                    className="px-4 py-2 rounded-lg text-sm bg-green-700 hover:bg-green-600 text-white transition-colors"
                  >
                    Next Question →
                  </button>
                </div>
              )}

              {/* Inline coach question input */}
              {showCoachInput && (
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 max-w-[85%]">
                  <p className="text-xs text-gray-500 mb-2">
                    Ask your coach anything — STAR method, salary, gaps, etc.
                  </p>
                  <textarea
                    ref={coachInputRef}
                    value={coachQuestion}
                    onChange={(e) => setCoachQuestion(e.target.value)}
                    onKeyDown={handleCoachKeyDown}
                    className="w-full bg-gray-800 text-white text-sm rounded-lg p-2.5 outline-none resize-none placeholder-gray-500"
                    placeholder="e.g. How do I explain a gap in my resume?"
                    rows={2}
                  />
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={handleSendCoachQuestion}
                      disabled={isLoading || !coachQuestion.trim()}
                      className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 rounded-lg text-sm text-white transition-colors"
                    >
                      Ask
                    </button>
                    <button
                      onClick={() => { setCoachQuestion(""); setSessionState("waiting-next"); }}
                      className="px-4 py-1.5 text-gray-400 hover:text-gray-200 text-sm transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* ---- INPUT BAR ---- */}
            {(sessionState === "idle" || isListening) && (
              <div className="px-6 py-4 border-t border-gray-800 shrink-0">
                <div className="flex items-end gap-2 bg-gray-900 border border-gray-700 rounded-xl px-4 py-3">

                  {/* Mic button */}
                  {speechSupported && (
                    <button
                      onClick={toggleMic}
                      className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors mb-0.5 ${
                        isListening
                          ? "bg-red-600 animate-pulse"
                          : "bg-gray-700 hover:bg-gray-600"
                      }`}
                      title={isListening ? "Stop listening" : "Speak answer"}
                    >
                      🎙️
                    </button>
                  )}

                  {/* Textarea */}
                  <textarea
                    ref={textareaRef}
                    value={answer}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={handleAnswerKeyDown}
                    className="flex-1 bg-transparent outline-none resize-none text-white placeholder-gray-500 text-sm leading-relaxed"
                    placeholder={
                      isListening
                        ? "Listening... speak your answer"
                        : "Type your answer or press 🎙️ to speak..."
                    }
                    rows={1}
                    style={{ maxHeight: "160px", overflowY: "auto" }}
                  />

                  {/* Send button */}
                  <button
                    onClick={handleSend}
                    disabled={isLoading || !answer.trim()}
                    className="shrink-0 bg-green-600 hover:bg-green-500 disabled:opacity-40 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors mb-0.5"
                  >
                    Send
                  </button>
                </div>

                {isListening && (
                  <p className="text-xs text-red-400 mt-1.5 ml-1">
                    🔴 Recording — tap 🎙️ to stop
                  </p>
                )}
              </div>
            )}

          </>
        )}
      </div>
    </main>
  );
}
