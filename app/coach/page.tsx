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
  | { sender: "ai"; type: "coach-answer"; text: string };

type ConversationTurn = { role: "user" | "assistant"; content: string };
type SessionState = "idle" | "waiting-next" | "asking-coach" | "loading";

/* ============================================================
   COACH PAGE
   ============================================================ */
export default function Coach() {
  const router = useRouter();

  const [settings, setSettings] = useState({
    role: "Software Engineer",
    company: "",
    interviewType: "Behavioral",
    difficulty: "Mid-Level",
  });

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>("loading");
  const [sessionStarted, setSessionStarted] = useState(false);

  const [answer, setAnswer] = useState("");
  const [coachQuestion, setCoachQuestion] = useState("");

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [ttsOn, setTtsOn] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const coachInputRef = useRef<HTMLTextAreaElement>(null);

  /* ============================================================
     INIT
     ============================================================ */
  useEffect(() => {
    const mode = sessionStorage.getItem("mode");
    if (!mode) { router.replace("/"); return; }
    setSettings({
      role: sessionStorage.getItem("role") || "Software Engineer",
      company: sessionStorage.getItem("company") || "",
      interviewType: sessionStorage.getItem("interviewType") || "Behavioral",
      difficulty: sessionStorage.getItem("difficulty") || "Mid-Level",
    });
    setTtsOn(sessionStorage.getItem("ttsEnabled") === "true");
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setSpeechSupported(false);
    }
  }, [router]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 160)}px`;
    }
  }, [answer]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (sessionStarted) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [sessionStarted]);

  /* ============================================================
     TTS
     ============================================================ */
  const speak = useCallback((text: string) => {
    if (!ttsOn) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }, [ttsOn]);

  useEffect(() => { return () => { window.speechSynthesis?.cancel(); }; }, []);

  /* ============================================================
     CAMERA
     ============================================================ */
  async function toggleCamera() {
    if (cameraOn) {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      setCameraOn(false);
      setCameraError("");
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setCameraOn(true);
        setCameraError("");
      } catch {
        setCameraError("Camera access denied.");
      }
    }
  }

  useEffect(() => { return () => { streamRef.current?.getTracks().forEach(t => t.stop()); }; }, []);

  /* ============================================================
     SPEECH
     ============================================================ */
  function startListening() {
    if (!speechSupported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => setIsListening(true);
    r.onresult = (e: any) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
      }
      if (final) setAnswer(prev => (prev + final).trimStart());
    };
    r.onerror = () => setIsListening(false);
    r.onend = () => setIsListening(false);
    recognitionRef.current = r;
    r.start();
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  /* ============================================================
     SAVE SESSION
     ============================================================ */
  function saveSession(msgs: Message[], history: ConversationTurn[]) {
    try {
      localStorage.setItem("lastCoachSession", JSON.stringify({
        timestamp: Date.now(), settings, messages: msgs, conversationHistory: history,
      }));
    } catch { }
  }

  /* ============================================================
     CALL AI
     — takes currentMessages to avoid stale state closure
     ============================================================ */
  async function callAI(
    userMessage: string,
    currentHistory: ConversationTurn[],
    currentMessages: Message[],
    isCoachQ = false
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
      console.log("AI response:", data);

      const newHistory: ConversationTurn[] = [
        ...currentHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      setConversationHistory(newHistory);

      // Build new messages from currentMessages (not stale `messages` state)
      let newMessages = [...currentMessages];

      if (isCoachQ) {
        if (data.nextQuestion) {
          newMessages = [...newMessages, { sender: "ai", type: "coach-answer", text: data.nextQuestion } as Message];
          speak(data.nextQuestion);
        }
        setSessionState("waiting-next");
      } else {
        // Add feedback if present
        if (data.feedback) {
          newMessages = [...newMessages, {
            sender: "ai",
            type: "feedback",
            feedback: {
              strengths: data.feedback.strengths || "",
              improve: data.feedback.improve || "",
              betterPhrasing: data.feedback.betterPhrasing || "",
            },
          } as Message];
        }
        // Add next question if present
        if (data.nextQuestion) {
          newMessages = [...newMessages, { sender: "ai", type: "question", text: data.nextQuestion } as Message];
          speak(data.nextQuestion);
        }
        setSessionState("waiting-next");
      }

      setMessages(newMessages);
      saveSession(newMessages, newHistory);

    } catch (err) {
      console.error("AI call failed:", err);
      setMessages(prev => [...prev, { sender: "ai", type: "question", text: "Something went wrong. Please try again." } as Message]);
      setSessionState("idle");
    }
  }

  /* ============================================================
     START SESSION
     ============================================================ */
  async function handleStart() {
    setSessionStarted(true);
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
          message: "START",
          conversationHistory: [],
        }),
      });

      const data = await res.json();
      const firstQ = data.nextQuestion || `Tell me about yourself and your journey into ${settings.role}.`;
      const newHistory: ConversationTurn[] = [
        { role: "user", content: "START" },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      const newMessages: Message[] = [{ sender: "ai", type: "question", text: firstQ }];
      setConversationHistory(newHistory);
      setMessages(newMessages);
      speak(firstQ);
      setSessionState("idle");
      saveSession(newMessages, newHistory);
    } catch {
      const fallbackQ = `Tell me about yourself and your journey into ${settings.role}.`;
      const newMessages: Message[] = [{ sender: "ai", type: "question", text: fallbackQ }];
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

    // Add user message to messages FIRST, before calling AI
    const newMessages: Message[] = [...messages, { sender: "user", text: trimmed }];
    setMessages(newMessages);
    setAnswer("");

    // Pass newMessages so callAI doesn't use stale state
    await callAI(trimmed, conversationHistory, newMessages);
  }

  /* ============================================================
     SKIP
     ============================================================ */
  async function handleSkip() {
    if (sessionState === "loading") return;
    await callAI("Please give me a different question.", conversationHistory, messages);
  }

  /* ============================================================
     ASK COACH
     ============================================================ */
  function handleOpenCoachQ() {
    setSessionState("asking-coach");
    setTimeout(() => coachInputRef.current?.focus(), 100);
  }

  async function handleSendCoachQ() {
    const trimmed = coachQuestion.trim();
    if (!trimmed || sessionState === "loading") return;
    const newMessages: Message[] = [...messages, { sender: "user", text: trimmed }];
    setMessages(newMessages);
    setCoachQuestion("");
    await callAI(trimmed, conversationHistory, newMessages, true);
  }

  /* ============================================================
     KEY HANDLERS
     ============================================================ */
  function handleAnswerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleCoachKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendCoachQ(); }
  }

  /* ============================================================
     STYLES
     ============================================================ */
  const isLoading = sessionState === "loading";
  const showActions = sessionState === "waiting-next";
  const showCoachInput = sessionState === "asking-coach";

  const st = {
    page: { display: "flex", height: "100vh", background: "#0a0a0a", color: "#f0f0f0", fontFamily: "'DM Sans','Inter',sans-serif", overflow: "hidden" } as React.CSSProperties,
    sidebar: { width: "220px", background: "#111", borderRight: "1px solid #1e1e1e", padding: "20px 16px", display: "flex", flexDirection: "column", flexShrink: 0 } as React.CSSProperties,
    sideLabel: { fontSize: "11px", color: "#555", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" } as React.CSSProperties,
    pill: { fontSize: "11px", background: "#1a1a1a", color: "#888", padding: "3px 10px", borderRadius: "20px" } as React.CSSProperties,
    sideBtn: (active: boolean, color: string): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", padding: "8px 12px", borderRadius: "8px", border: `1px solid ${active ? color : "#2a2a2a"}`, background: active ? `${color}22` : "transparent", color: active ? color : "#666", cursor: "pointer", width: "100%", transition: "all 0.15s" }),
    main: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0 } as React.CSSProperties,
    header: { padding: "16px 24px", borderBottom: "1px solid #1e1e1e", display: "flex", alignItems: "center", gap: "10px" } as React.CSSProperties,
    msgArea: { flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: "14px" } as React.CSSProperties,
    userBubble: { background: "#1d4ed8", color: "#ffffff", padding: "10px 16px", borderRadius: "18px 18px 4px 18px", maxWidth: "68%", fontSize: "14px", lineHeight: 1.6, wordBreak: "break-word" } as React.CSSProperties,
    aiBubble: { background: "#1a1a1a", color: "#e5e7eb", padding: "12px 16px", borderRadius: "4px 18px 18px 18px", maxWidth: "75%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    coachBubble: { background: "#0f1f3a", borderLeft: "3px solid #3b82f6", color: "#bfdbfe", padding: "12px 16px", borderRadius: "0 16px 16px 0", maxWidth: "75%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    inputBar: { padding: "14px 24px", borderTop: "1px solid #1e1e1e" } as React.CSSProperties,
    inputWrap: { display: "flex", alignItems: "flex-end", gap: "8px", background: "#111", border: "1px solid #2a2a2a", borderRadius: "14px", padding: "10px 14px" } as React.CSSProperties,
    sendBtn: (disabled: boolean): React.CSSProperties => ({ padding: "8px 18px", borderRadius: "9px", border: "none", background: "#16a34a", color: "#fff", fontSize: "13px", fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, flexShrink: 0 }),
    micBtn: (active: boolean): React.CSSProperties => ({ width: "32px", height: "32px", borderRadius: "50%", border: "none", background: active ? "#dc2626" : "#2a2a2a", cursor: "pointer", flexShrink: 0, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }),
    actionBtn: (primary: boolean): React.CSSProperties => ({ padding: "8px 16px", borderRadius: "8px", border: primary ? "none" : "1px solid #2a2a2a", background: primary ? "#16a34a" : "transparent", color: primary ? "#fff" : "#888", fontSize: "13px", fontWeight: primary ? 600 : 400, cursor: "pointer" }),
    feedbackCard: { borderRadius: "12px", overflow: "hidden", border: "1px solid #1e1e1e", maxWidth: "85%" } as React.CSSProperties,
    strengthSection: { background: "#0a1f0a", borderBottom: "1px solid #1e1e1e", padding: "14px 16px" } as React.CSSProperties,
    improveSection: { background: "#1a1000", borderBottom: "1px solid #1e1e1e", padding: "14px 16px" } as React.CSSProperties,
    phrasingSection: { background: "#0a1628", padding: "14px 16px" } as React.CSSProperties,
    sectionLabel: (color: string): React.CSSProperties => ({ color, fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "8px" }),
    sectionText: (color: string): React.CSSProperties => ({ color, fontSize: "13px", whiteSpace: "pre-line", lineHeight: 1.7 }),
    loadingDot: { width: "6px", height: "6px", borderRadius: "50%", background: "#555", display: "inline-block" } as React.CSSProperties,
    coachInputBox: { background: "#111", border: "1px solid #2a2a2a", borderRadius: "12px", padding: "14px", maxWidth: "85%" } as React.CSSProperties,
    coachTextarea: { width: "100%", background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: "8px", padding: "10px", color: "#f0f0f0", fontSize: "13px", outline: "none", resize: "none", fontFamily: "inherit" } as React.CSSProperties,
  };

  /* ============================================================
     RENDER — PRE-START
     ============================================================ */
  if (!sessionStarted) {
    return (
      <main style={st.page}>
        <div style={st.sidebar}>
          <p style={st.sideLabel}>Session</p>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "4px" }}>{settings.role}</p>
          {settings.company && <p style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>{settings.company}</p>}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            <span style={st.pill}>{settings.interviewType}</span>
            <span style={st.pill}>{settings.difficulty}</span>
          </div>
        </div>
        <div style={{ ...st.main, alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", maxWidth: "400px", padding: "40px" }}>
            <div style={{ fontSize: "44px", marginBottom: "16px" }}>🎯</div>
            <h2 style={{ fontSize: "22px", fontWeight: 700, marginBottom: "10px", color: "#fff" }}>Ready to practice?</h2>
            <p style={{ color: "#666", fontSize: "14px", marginBottom: "28px", lineHeight: 1.6 }}>
              Your AI coach will ask one question at a time and give structured feedback after each answer.
            </p>
            <div style={{ background: "#111", border: "1px solid #1e1e1e", borderRadius: "14px", padding: "18px", textAlign: "left", marginBottom: "28px" }}>
              {[["🎯 Role", settings.role], ["📋 Type", settings.interviewType], ["⚡ Difficulty", settings.difficulty], ...(settings.company ? [["🏢 Company", settings.company]] : [])].map(([k, v]) => (
                <p key={k} style={{ fontSize: "13px", color: "#888", marginBottom: "8px" }}>{k}: <span style={{ color: "#e5e7eb" }}>{v}</span></p>
              ))}
            </div>
            <button onClick={handleStart} style={{ background: "#16a34a", color: "#fff", border: "none", padding: "14px 36px", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
              Start Session →
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ============================================================
     RENDER — SESSION
     ============================================================ */
  return (
    <main style={st.page}>

      {/* SIDEBAR */}
      <div style={st.sidebar}>
        <div style={{ marginBottom: "20px" }}>
          <p style={st.sideLabel}>Session</p>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff", marginBottom: "4px" }}>{settings.role}</p>
          {settings.company && <p style={{ fontSize: "12px", color: "#666", marginBottom: "6px" }}>{settings.company}</p>}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            <span style={st.pill}>{settings.interviewType}</span>
            <span style={st.pill}>{settings.difficulty}</span>
          </div>
        </div>

        <div style={{ borderTop: "1px solid #1e1e1e", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button onClick={toggleCamera} style={st.sideBtn(cameraOn, "#4ade80")}>
            <span>📷</span><span>{cameraOn ? "Camera On" : "Camera Off"}</span>
          </button>
          {cameraError && <p style={{ fontSize: "11px", color: "#ef4444" }}>{cameraError}</p>}
          <button onClick={() => { window.speechSynthesis?.cancel(); setTtsOn(!ttsOn); }} style={st.sideBtn(ttsOn, "#3b82f6")}>
            <span>🔊</span><span>{ttsOn ? "Voice On" : "Voice Off"}</span>
          </button>
          {!speechSupported && (
            <p style={{ fontSize: "11px", color: "#fbbf24", background: "#1a1200", border: "1px solid #854d0e", borderRadius: "6px", padding: "8px" }}>
              Speech requires Chrome
            </p>
          )}
        </div>

        {cameraOn && (
          <div style={{ marginTop: "16px", borderRadius: "8px", overflow: "hidden", border: "1px solid #2a2a2a" }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", display: "block", transform: "scaleX(-1)" }} />
          </div>
        )}

        <div style={{ marginTop: "auto" }}>
          <button onClick={() => router.push("/")} style={{ width: "100%", background: "none", border: "none", color: "#444", fontSize: "12px", cursor: "pointer", padding: "8px" }}>
            ← End Session
          </button>
        </div>
      </div>

      {/* MAIN CHAT */}
      <div style={st.main}>

        {/* Header */}
        <div style={st.header}>
          <span style={{ fontSize: "20px" }}>🎯</span>
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "#fff" }}>AI Coach</p>
            <p style={{ fontSize: "12px", color: "#555" }}>Warm feedback after every answer</p>
          </div>
        </div>

        {/* Messages */}
        <div style={st.msgArea}>
          {messages.map((msg, i) => {

            /* USER MESSAGE */
            if (msg.sender === "user") {
              return (
                <div key={i} style={{ display: "flex", justifyContent: "flex-end" }}>
                  <div style={st.userBubble}>{msg.text}</div>
                </div>
              );
            }

            /* AI QUESTION */
            if (msg.sender === "ai" && msg.type === "question") {
              return (
                <div key={i} style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={st.aiBubble}>{msg.text}</div>
                </div>
              );
            }

            /* AI COACH ANSWER */
            if (msg.sender === "ai" && msg.type === "coach-answer") {
              return (
                <div key={i} style={{ display: "flex", justifyContent: "flex-start" }}>
                  <div style={st.coachBubble}>{msg.text}</div>
                </div>
              );
            }

            /* FEEDBACK CARD */
            if (msg.sender === "ai" && msg.type === "feedback" && msg.feedback) {
              return (
                <div key={i} style={st.feedbackCard}>
                  {/* Strengths */}
                  <div style={st.strengthSection}>
                    <p style={st.sectionLabel("#4ade80")}>✅ Strengths</p>
                    <p style={st.sectionText("#d1fae5")}>{msg.feedback.strengths}</p>
                  </div>
                  {/* Improve */}
                  <div style={st.improveSection}>
                    <p style={st.sectionLabel("#fbbf24")}>⚠️ Areas to Improve</p>
                    <p style={st.sectionText("#fef3c7")}>{msg.feedback.improve}</p>
                  </div>
                  {/* Better Phrasing */}
                  <div style={st.phrasingSection}>
                    <p style={st.sectionLabel("#60a5fa")}>💡 Better Phrasing</p>
                    <p style={st.sectionText("#dbeafe")}>{msg.feedback.betterPhrasing}</p>
                  </div>
                </div>
              );
            }

            return null;
          })}

          {/* Loading dots */}
          {isLoading && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ ...st.aiBubble, display: "flex", gap: "5px", alignItems: "center" }}>
                {[0, 150, 300].map((d, i) => (
                  <span key={i} style={{ ...st.loadingDot, animation: `pulse 1s ${d}ms infinite` }} />
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          {showActions && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              <button onClick={handleOpenCoachQ} style={st.actionBtn(false)}>💬 Ask a Question</button>
              <button onClick={handleSkip} style={{ ...st.actionBtn(false), color: "#666" }}>Skip</button>
              <button onClick={() => setSessionState("idle")} style={st.actionBtn(true)}>Answer →</button>
            </div>
          )}

          {/* Coach question input */}
          {showCoachInput && (
            <div style={st.coachInputBox}>
              <p style={{ fontSize: "12px", color: "#555", marginBottom: "8px" }}>
                Ask your coach anything — STAR method, salary, gaps...
              </p>
              <textarea
                ref={coachInputRef}
                value={coachQuestion}
                onChange={e => setCoachQuestion(e.target.value)}
                onKeyDown={handleCoachKeyDown}
                style={st.coachTextarea}
                placeholder="e.g. How do I explain a gap in my resume?"
                rows={2}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button
                  onClick={handleSendCoachQ}
                  disabled={isLoading || !coachQuestion.trim()}
                  style={{ padding: "7px 16px", borderRadius: "7px", border: "none", background: "#1d4ed8", color: "#fff", fontSize: "13px", cursor: "pointer", opacity: isLoading || !coachQuestion.trim() ? 0.4 : 1 }}
                >
                  Ask
                </button>
                <button
                  onClick={() => { setCoachQuestion(""); setSessionState("waiting-next"); }}
                  style={{ padding: "7px 16px", borderRadius: "7px", border: "none", background: "transparent", color: "#666", fontSize: "13px", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Input bar — only when idle */}
        {(sessionState === "idle" || isListening) && (
          <div style={st.inputBar}>
            <div style={st.inputWrap}>
              {speechSupported && (
                <button onClick={() => isListening ? stopListening() : startListening()} style={st.micBtn(isListening)}>
                  🎙️
                </button>
              )}
              <textarea
                ref={textareaRef}
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={handleAnswerKeyDown}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "#f0f0f0", fontSize: "14px", resize: "none", maxHeight: "160px", lineHeight: 1.5, fontFamily: "inherit" }}
                placeholder={isListening ? "Listening... speak your answer" : "Type your answer or press 🎙️ to speak..."}
                rows={1}
              />
              <button onClick={handleSend} disabled={isLoading || !answer.trim()} style={st.sendBtn(isLoading || !answer.trim())}>
                Send
              </button>
            </div>
            {isListening && (
              <p style={{ fontSize: "11px", color: "#ef4444", marginTop: "6px", marginLeft: "4px" }}>
                🔴 Recording — tap 🎙️ to stop
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </main>
  );
}
