"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useFirebaseSave } from "@/lib/useFirebaseSave";
import { ThemeToggle } from "@/lib/theme";
import { getCoachSessions, getSession } from "@/lib/db";
import { useAuth } from "@/lib/auth";
/* ============================================================
   TYPES
   ============================================================ */
type Feedback = { strengths: string; improve: string; betterPhrasing: string } | null;

type Message =
  | { sender: "user"; text: string }
  | { sender: "ai"; type: "question"; text: string }
  | { sender: "ai"; type: "feedback"; feedback: Feedback }
  | { sender: "ai"; type: "coach-answer"; text: string };

type ConversationTurn = { role: "user" | "assistant"; content: string };

// Single source of truth for what to render — eliminates the
// sessionStarted + sessionState race condition that caused the
// pre-start screen to flash when resuming
type AppPhase =
  | "init"           // loading from storage, show nothing
  | "pre-start"      // show "Ready to practice?" screen
  | "idle"           // session active, answer input shown
  | "waiting-next"   // session active, action buttons shown
  | "asking-coach"   // coach question input shown
  | "coach-answered" // coach answered, "Continue" button shown
  | "loading";       // AI is thinking

/* ============================================================
   COACH PAGE
   ============================================================ */
export default function Coach() {
  const router = useRouter();
  const { save } = useFirebaseSave();
  const { user } = useAuth();
  const [settings, setSettings] = useState({
    role: "Software Engineer", company: "",
    interviewType: "Behavioral", difficulty: "Mid-Level",
  });

  // THE KEY FIX: one phase controls everything
  const [appPhase, setAppPhase] = useState<AppPhase>("init");

  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationHistory, setConversationHistory] = useState<ConversationTurn[]>([]);
  const [answer, setAnswer] = useState("");
  const [coachQuestion, setCoachQuestion] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [savedCoachSessions, setSavedCoachSessions] = useState<any[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const coachInputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string>(
    `coach_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);

  /* ============================================================
     INIT — runs once, reads storage, sets correct phase
     ============================================================ */
  useEffect(() => {
    const mode = sessionStorage.getItem("mode");
    if (!mode) { router.replace("/"); return; }

    const role = sessionStorage.getItem("role") || "Software Engineer";
    const company = sessionStorage.getItem("company") || "";
    const interviewType = sessionStorage.getItem("interviewType") || "Behavioral";
    const difficulty = sessionStorage.getItem("difficulty") || "Mid-Level";
    const s = { role, company, interviewType, difficulty };
    setSettings(s);
    settingsRef.current = s;

    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
      setSpeechSupported(false);
    }
    try {
      setSavedCoachSessions(JSON.parse(localStorage.getItem("coachSessions") || "[]"));
    } catch { }

    // Check if home page flagged a resume
    const shouldResume = sessionStorage.getItem("resumeCoachSession") === "true";
    sessionStorage.removeItem("resumeCoachSession");

    if (shouldResume) {
      try {
        const raw = localStorage.getItem("lastCoachSession");
        if (raw) {
          const saved = JSON.parse(raw);
          // Only require messages — conversationHistory may be missing in older saves
          if (saved.messages?.length > 0) {
            if (saved.sessionId) sessionIdRef.current = saved.sessionId;
            setMessages(saved.messages);
            // Restore conversationHistory if available, otherwise use empty array
            setConversationHistory(saved.conversationHistory || []);
            // Restore settings from saved session if present
            if (saved.settings) {
              const rs = {
                role: saved.settings.role || role,
                company: saved.settings.company || company,
                interviewType: saved.settings.interviewType || interviewType,
                difficulty: saved.settings.difficulty || difficulty,
              };
              setSettings(rs);
              settingsRef.current = rs;
            }
            setAppPhase("waiting-next");
            return;
          }
        }
      } catch (e) {
        console.error("[Coach] restore failed:", e);
      }
      // Resume failed — fall through to pre-start
    }

    if (shouldResume && sessionStorage.getItem("resumeCoachSessionId")) {
      setAppPhase("loading");
      return;
    }

    setAppPhase("pre-start");
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user) return;
    const resumeId = sessionStorage.getItem("resumeCoachSessionId");
    if (resumeId) {
      getSession(user.uid, resumeId).then((remote) => {
        if (remote?.mode === "coach" && remote.messages?.length) {
          sessionStorage.removeItem("resumeCoachSessionId");
          localStorage.setItem("lastCoachSession", JSON.stringify(remote));
          reopenCoachSession(remote);
        } else if (appPhase === "loading") {
          setAppPhase("pre-start");
        }
      }).catch(() => {
        if (appPhase === "loading") setAppPhase("pre-start");
      });
    }
    getCoachSessions(user.uid).then((remote) => {
      setSavedCoachSessions((local) => {
        const byId = new Map<string, any>();
        [...remote, ...local].forEach((s: any) => {
          if (s?.sessionId && !byId.has(s.sessionId)) byId.set(s.sessionId, s);
        });
        return Array.from(byId.values()).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 20);
      });
    }).catch(() => {});
  }, [user]);

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
      if (appPhase !== "pre-start" && appPhase !== "init") {
        e.preventDefault(); e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [appPhase]);

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
        setCameraOn(true);
        setCameraError("");
      } catch {
        setCameraError("Camera access denied.");
      }
    }
  }

  useEffect(() => {
    if (cameraOn && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [cameraOn]);

  useEffect(() => { return () => { streamRef.current?.getTracks().forEach(t => t.stop()); }; }, []);

  /* ============================================================
     SPEECH
     ============================================================ */
  function startListening() {
    if (!speechSupported) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = "en-US";
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
      const d = {
        sessionId: sessionIdRef.current, mode: "coach",
        timestamp: Date.now(), settings: settingsRef.current,
        messages: msgs, conversationHistory: history,
      };
      localStorage.setItem("lastCoachSession", JSON.stringify(d));
      const existing: any[] = JSON.parse(localStorage.getItem("coachSessions") || "[]");
      const deduped = existing.filter((s: any) => s.sessionId !== sessionIdRef.current);
      deduped.unshift(d);
      localStorage.setItem("coachSessions", JSON.stringify(deduped.slice(0, 20)));
      setSavedCoachSessions(deduped.slice(0, 20));
      save({ ...d, mode: "coach" });
    } catch { }
  }

  function reopenCoachSession(saved: any) {
    if (!saved?.messages?.length) return;
    if (saved.sessionId) sessionIdRef.current = saved.sessionId;
    setMessages(saved.messages);
    setConversationHistory(saved.conversationHistory || []);
    if (saved.settings) {
      const restored = {
        role: saved.settings.role || settings.role,
        company: saved.settings.company || "",
        interviewType: saved.settings.interviewType || settings.interviewType,
        difficulty: saved.settings.difficulty || settings.difficulty,
      };
      setSettings(restored);
      settingsRef.current = restored;
    }
    localStorage.setItem("lastCoachSession", JSON.stringify(saved));
    setAppPhase("waiting-next");
  }

  /* ============================================================
     CALL AI — normal interview answer flow
     ============================================================ */
  async function callAI(userMessage: string, currentHistory: ConversationTurn[], currentMessages: Message[]) {
    setAppPhase("loading");
    try {
      const s = settingsRef.current;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "coach", role: s.role, company: s.company,
          interviewType: s.interviewType, difficulty: s.difficulty,
          resumeText: sessionStorage.getItem("resumeText") || "",
          message: userMessage, conversationHistory: currentHistory,
        }),
      });
      const data = await res.json();
      const newHistory: ConversationTurn[] = [
        ...currentHistory,
        { role: "user", content: userMessage },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      setConversationHistory(newHistory);
      let newMsgs = [...currentMessages];
      if (data.feedback) {
        newMsgs = [...newMsgs, {
          sender: "ai", type: "feedback",
          feedback: {
            strengths: data.feedback.strengths || "",
            improve: data.feedback.improve || "",
            betterPhrasing: data.feedback.betterPhrasing || "",
          },
        } as Message];
      }
      if (data.nextQuestion) {
        newMsgs = [...newMsgs, { sender: "ai", type: "question", text: data.nextQuestion } as Message];
      }
      setMessages(newMsgs);
      saveSession(newMsgs, newHistory);
      setAppPhase("waiting-next");
    } catch {
      setMessages(prev => [...prev, { sender: "ai", type: "question", text: "Something went wrong. Please try again." } as Message]);
      setAppPhase("idle");
    }
  }

  /* ============================================================
     CALL COACH AI — user asked a coaching question
     Uses mode:"coach-question" so API answers directly
     instead of asking another interview question
     ============================================================ */
  async function callCoachAI(coachQ: string, currentHistory: ConversationTurn[], currentMessages: Message[]) {
    setAppPhase("loading");
    try {
      const s = settingsRef.current;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "coach-question", role: s.role,
          interviewType: s.interviewType, difficulty: s.difficulty,
          resumeText: sessionStorage.getItem("resumeText") || "",
          message: coachQ, conversationHistory: currentHistory,
        }),
      });
      const data = await res.json();
      const newHistory: ConversationTurn[] = [
        ...currentHistory,
        { role: "user", content: coachQ },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      setConversationHistory(newHistory);
      const answerText = data.coachAnswer || data.nextQuestion || "Let me help you with that.";
      const newMsgs: Message[] = [
        ...currentMessages,
        { sender: "ai", type: "coach-answer", text: answerText } as Message,
      ];
      setMessages(newMsgs);
      saveSession(newMsgs, newHistory);
      setAppPhase("coach-answered");
    } catch {
      setMessages(prev => [...prev, { sender: "ai", type: "coach-answer", text: "Sorry, couldn't answer that. Please try again." } as Message]);
      setAppPhase("coach-answered");
    }
  }

  /* ============================================================
     START FRESH SESSION
     ============================================================ */
  async function handleStart() {
    setAppPhase("loading");
    try {
      const s = settingsRef.current;
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "coach", role: s.role, company: s.company,
          interviewType: s.interviewType, difficulty: s.difficulty,
          resumeText: sessionStorage.getItem("resumeText") || "",
          message: "START", conversationHistory: [],
        }),
      });
      const data = await res.json();
      const firstQ = data.nextQuestion || `Tell me about yourself and what brought you to the ${s.role} role.`;
      const newHistory: ConversationTurn[] = [
        { role: "user", content: "START" },
        { role: "assistant", content: JSON.stringify(data) },
      ];
      const newMsgs: Message[] = [{ sender: "ai", type: "question", text: firstQ }];
      setConversationHistory(newHistory);
      setMessages(newMsgs);
      saveSession(newMsgs, newHistory);
      setAppPhase("idle");
    } catch {
      const s = settingsRef.current;
      const fallback = `Tell me about yourself and what brought you to the ${s.role} role.`;
      setMessages([{ sender: "ai", type: "question", text: fallback }]);
      setAppPhase("idle");
    }
  }

  /* ============================================================
     ACTIONS
     ============================================================ */
  async function handleSend() {
    const trimmed = answer.trim();
    if (!trimmed || appPhase === "loading") return;
    stopListening();
    const newMsgs: Message[] = [...messages, { sender: "user", text: trimmed }];
    setMessages(newMsgs);
    setAnswer("");
    await callAI(trimmed, conversationHistory, newMsgs);
  }

  async function handleSkip() {
    if (appPhase === "loading") return;
    await callAI("Please give me a different question.", conversationHistory, messages);
  }

  function handleOpenCoachQ() {
    setAppPhase("asking-coach");
    setTimeout(() => coachInputRef.current?.focus(), 100);
  }

  async function handleSendCoachQ() {
    const trimmed = coachQuestion.trim();
    if (!trimmed || appPhase === "loading") return;
    const newMsgs: Message[] = [...messages, { sender: "user", text: trimmed }];
    setMessages(newMsgs);
    setCoachQuestion("");
    await callCoachAI(trimmed, conversationHistory, newMsgs);
  }

  function handleAnswerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  function handleCoachKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendCoachQ(); }
  }

  /* ============================================================
     STYLES
     ============================================================ */
  const st = {
    page: { display: "flex", height: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden" } as React.CSSProperties,
    sidebar: { width: "250px", background: "var(--surface)", borderRight: "1px solid var(--border)", padding: "20px 16px", display: "flex", flexDirection: "column" as const, flexShrink: 0 } as React.CSSProperties,
    sideLabel: { fontSize: "11px", color: "var(--muted)", textTransform: "uppercase" as const, letterSpacing: "0.08em", marginBottom: "8px" } as React.CSSProperties,
    pill: { fontSize: "11px", background: "var(--surface-2)", color: "var(--muted)", padding: "3px 10px", borderRadius: "20px" } as React.CSSProperties,
    sideBtn: (active: boolean, color: string): React.CSSProperties => ({ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", padding: "8px 12px", borderRadius: "8px", border: `1px solid ${active ? color : "var(--border)"}`, background: active ? `${color}22` : "transparent", color: active ? color : "var(--muted)", cursor: "pointer", width: "100%", transition: "all 0.15s" }),
    main: { display: "flex", flexDirection: "column" as const, flex: 1, minWidth: 0 } as React.CSSProperties,
    msgArea: { flex: 1, overflowY: "auto" as const, padding: "20px 24px", display: "flex", flexDirection: "column" as const, gap: "14px", alignItems: "stretch" } as React.CSSProperties,
    userBubble: { background: "var(--accent)", color: "var(--text)", padding: "10px 16px", borderRadius: "18px 18px 4px 18px", maxWidth: "68%", fontSize: "14px", lineHeight: 1.6, wordBreak: "break-word" as const, flexShrink: 0 } as React.CSSProperties,
    aiBubble: { background: "var(--surface-2)", color: "var(--text)", padding: "12px 16px", borderRadius: "4px 18px 18px 18px", maxWidth: "75%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    coachBubble: { background: "var(--surface-2)", borderLeft: "3px solid var(--accent)", color: "var(--text)", padding: "14px 16px", borderRadius: "0 16px 16px 0", maxWidth: "78%", fontSize: "14px", lineHeight: 1.75 } as React.CSSProperties,
    inputBar: { padding: "14px 24px", borderTop: "1px solid var(--border)" } as React.CSSProperties,
    inputWrap: { display: "flex", alignItems: "flex-end", gap: "8px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "10px 14px" } as React.CSSProperties,
  };

  /* ============================================================
     RENDER — init: show nothing while loading from storage
     ============================================================ */
  if (appPhase === "init") {
    return (
      <main style={{ ...st.page, alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--muted)", fontSize: "13px" }}>Loading...</p>
      </main>
    );
  }

  /* ============================================================
     RENDER — pre-start: fresh session setup screen
     ============================================================ */
  if (appPhase === "pre-start") {
    return (
      <main style={st.page}>
        <div style={st.sidebar}>
          <p style={st.sideLabel}>Session</p>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>{settings.role}</p>
          {settings.company && <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "8px" }}>{settings.company}</p>}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            <span style={st.pill}>{settings.interviewType}</span>
            <span style={st.pill}>{settings.difficulty}</span>
          </div>
        </div>
        <div style={{ ...st.main, alignItems: "center", justifyContent: "center" }}>
          <div style={{ textAlign: "center", maxWidth: "400px", padding: "40px" }}>
            <div style={{ fontSize: "44px", marginBottom: "16px" }}>🎯</div>
            <h2 className="font-heading" style={{ fontSize: "22px", fontWeight: 700, marginBottom: "10px", color: "var(--text)" }}>Ready to practice?</h2>
            <p style={{ color: "var(--muted)", fontSize: "14px", marginBottom: "28px", lineHeight: 1.6 }}>
              Your AI coach will ask one question at a time and give structured feedback after each answer.
            </p>
            <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px", padding: "18px", textAlign: "left", marginBottom: "28px" }}>
              {[["🎯 Role", settings.role], ["📋 Type", settings.interviewType], ["⚡ Difficulty", settings.difficulty], ...(settings.company ? [["🏢 Company", settings.company]] : [])].map(([k, v]) => (
                <p key={k} style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "8px" }}>{k}: <span style={{ color: "var(--text)" }}>{v}</span></p>
              ))}
            </div>
            <button className="btn-animated" onClick={handleStart} style={{ background: "var(--success)", color: "var(--text)", border: "none", padding: "14px 36px", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
              Start Session →
            </button>
          </div>
        </div>
      </main>
    );
  }

  /* ============================================================
     RENDER — active session (all other phases)
     ============================================================ */
  const isLoading = appPhase === "loading";

  return (
    <main style={st.page}>

      {/* SIDEBAR */}
      <div style={st.sidebar}>
        <div style={{ marginBottom: "20px" }}>
          <p style={st.sideLabel}>Session</p>
          <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)", marginBottom: "4px" }}>{settings.role}</p>
          {settings.company && <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "6px" }}>{settings.company}</p>}
          <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
            <span style={st.pill}>{settings.interviewType}</span>
            <span style={st.pill}>{settings.difficulty}</span>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "16px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button className="btn-animated" onClick={toggleCamera} style={st.sideBtn(cameraOn, "var(--success)")}>
            <span style={{ fontSize: "14px" }}>📷</span>
            <span>{cameraOn ? "Camera On" : "Camera Off"}</span>
          </button>
          {cameraError && <p style={{ fontSize: "11px", color: "var(--danger)" }}>{cameraError}</p>}
          {speechSupported && (
            <button className="btn-animated" onClick={() => isListening ? stopListening() : startListening()} style={st.sideBtn(isListening, "var(--warning)")}>
              <span style={{ fontSize: "14px" }}>🎙️</span>
              <span>{isListening ? "Mic On" : "Mic Off"}</span>
            </button>
          )}
        </div>

        {/* Camera preview always in DOM */}
        <div style={{ marginTop: "16px", borderRadius: "8px", overflow: "hidden", border: "1px solid var(--border)", display: cameraOn ? "block" : "none" }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", display: "block", transform: "scaleX(-1)" }} />
        </div>

        {savedCoachSessions.length > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", marginTop: "16px", paddingTop: "14px" }}>
            <p style={st.sideLabel}>Chat History</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "190px", overflowY: "auto" }}>
              {savedCoachSessions.slice(0, 5).map((s) => (
                <button className="btn-animated"
                  key={s.sessionId}
                  onClick={() => reopenCoachSession(s)}
                  style={{ textAlign: "left", background: s.sessionId === sessionIdRef.current ? "rgba(59,130,246,0.12)" : "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "8px", cursor: "pointer" }}
                >
                  <p style={{ color: "var(--text)", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.settings?.role || "Coaching"}</p>
                  <p style={{ color: "var(--muted)", fontSize: "10px" }}>{new Date(s.timestamp).toLocaleDateString()} · {s.messages?.length || 0} msgs</p>
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          <ThemeToggle />
          <button className="btn-animated" onClick={() => window.print()} style={{ flex: 1, background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", fontSize: "12px", cursor: "pointer", padding: "8px", borderRadius: "8px" }}>
            Export
          </button>
          <button className="btn-animated" onClick={() => router.push("/")} style={{ flex: 1, background: "none", border: "none", color: "var(--muted)", fontSize: "12px", cursor: "pointer", padding: "8px" }}>
            End
          </button>
        </div>
      </div>

      {/* MAIN CHAT */}
      <div style={st.main}>

        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "20px" }}>🎯</span>
          <div>
            <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>AI Coach</p>
            <p style={{ fontSize: "12px", color: "var(--muted)" }}>Feedback after every answer · ask anything anytime</p>
          </div>
        </div>

        {/* Messages */}
        <div style={st.msgArea}>
          {messages.map((msg, i) => {
            if (msg.sender === "user") return (
              <div key={i} style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
                <div style={st.userBubble}>{msg.text}</div>
              </div>
            );

            if (msg.sender === "ai" && msg.type === "question") return (
              <div key={i} style={{ display: "flex", justifyContent: "flex-start", flexShrink: 0 }}>
                <div style={st.aiBubble}>{msg.text}</div>
              </div>
            );

            if (msg.sender === "ai" && msg.type === "coach-answer") return (
              <div key={i} style={{ display: "flex", justifyContent: "flex-start", flexShrink: 0 }}>
                <div style={st.coachBubble}>
                  <div style={{ fontSize: "11px", color: "var(--accent)", marginBottom: "8px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    💬 Coach Answer
                  </div>
                  <div style={{ whiteSpace: "pre-line" }}>{msg.text}</div>
                </div>
              </div>
            );

            if (msg.sender === "ai" && msg.type === "feedback" && msg.feedback) return (
              <div key={i} style={{ borderRadius: "12px", border: "1px solid var(--border)", maxWidth: "85%", display: "flex", flexDirection: "column", flexShrink: 0 }}>
                <div style={{ background: "rgba(34,197,94,0.1)", borderBottom: "1px solid var(--border)", padding: "14px 16px", borderRadius: "12px 12px 0 0" }}>
                  <div style={{ color: "var(--success)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>✅ Strengths</div>
                  <div style={{ color: "var(--success)", fontSize: "13px", lineHeight: 1.75 }}>{msg.feedback.strengths}</div>
                </div>
                <div style={{ background: "rgba(245,158,11,0.1)", borderBottom: "1px solid var(--border)", padding: "14px 16px" }}>
                  <div style={{ color: "var(--warning)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>⚠️ Areas to Improve</div>
                  <div style={{ color: "var(--warning)", fontSize: "13px", lineHeight: 1.75 }}>{msg.feedback.improve}</div>
                </div>
                <div style={{ background: "rgba(59,130,246,0.1)", padding: "14px 16px", borderRadius: "0 0 12px 12px" }}>
                  <div style={{ color: "var(--accent)", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "10px" }}>💡 Better Phrasing</div>
                  <div style={{ color: "var(--text)", fontSize: "13px", lineHeight: 1.75 }}>{msg.feedback.betterPhrasing}</div>
                </div>
              </div>
            );

            return null;
          })}

          {/* Loading dots */}
          {isLoading && (
            <div style={{ display: "flex" }}>
              <div style={{ ...st.aiBubble, display: "flex", gap: "5px", alignItems: "center" }}>
                {[0, 150, 300].map((d, i) => (
                  <span key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--muted)", display: "inline-block", animation: `pulse 1s ${d}ms infinite` }} />
                ))}
              </div>
            </div>
          )}

          {/* Action buttons — shown when waiting for user to answer */}
          {appPhase === "waiting-next" && (
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
              <button className="btn-animated" onClick={handleOpenCoachQ} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer" }}>
                💬 Ask a Question
              </button>
              <button className="btn-animated" onClick={handleSkip} style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer" }}>
                Skip
              </button>
              <button className="btn-animated" onClick={() => setAppPhase("idle")} style={{ padding: "8px 16px", borderRadius: "8px", border: "none", background: "var(--success)", color: "var(--text)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                Answer →
              </button>
            </div>
          )}

          {/* Coach question input */}
          {appPhase === "asking-coach" && (
            <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "16px", maxWidth: "85%" }}>
              <p style={{ fontSize: "13px", color: "var(--accent)", fontWeight: 600, marginBottom: "4px" }}>💬 Ask your coach anything</p>
              <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "12px" }}>
                Interview is paused. Ask about STAR method, salary, nerves, gaps — anything.
              </p>
              <textarea
                ref={coachInputRef}
                value={coachQuestion}
                onChange={e => setCoachQuestion(e.target.value)}
                onKeyDown={handleCoachKey}
                style={{ width: "100%", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px", color: "var(--text)", fontSize: "13px", outline: "none", resize: "none", fontFamily: "inherit", boxSizing: "border-box" }}
                placeholder="e.g. How do I explain a gap in my resume?"
                rows={3}
              />
              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button className="btn-animated"
                  onClick={handleSendCoachQ}
                  disabled={isLoading || !coachQuestion.trim()}
                  style={{ padding: "8px 20px", borderRadius: "8px", border: "none", background: "var(--accent)", color: "var(--text)", fontSize: "13px", fontWeight: 600, cursor: "pointer", opacity: !coachQuestion.trim() ? 0.4 : 1 }}
                >
                  Ask Coach
                </button>
                <button className="btn-animated"
                  onClick={() => { setCoachQuestion(""); setAppPhase("waiting-next"); }}
                  style={{ padding: "8px 14px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Continue Interview — shown ONLY after coach answers */}
          {appPhase === "coach-answered" && (
            <div style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", background: "rgba(34,197,94,0.1)", border: "1px solid var(--border)", borderRadius: "12px", maxWidth: "420px" }}>
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: "13px", color: "var(--success)", fontWeight: 600, marginBottom: "2px" }}>Got your answer?</p>
                <p style={{ fontSize: "12px", color: "var(--muted)" }}>Your interview question is still waiting.</p>
              </div>
              <button className="btn-animated"
                onClick={() => setAppPhase("waiting-next")}
                style={{ padding: "10px 20px", borderRadius: "8px", border: "none", background: "var(--success)", color: "var(--text)", fontSize: "13px", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
              >
                Continue →
              </button>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Answer input — only when idle */}
        {(appPhase === "idle" || isListening) && (
          <div style={st.inputBar}>
            <div style={st.inputWrap}>
              {speechSupported && (
                <button className="btn-animated" onClick={() => isListening ? stopListening() : startListening()} style={{ width: "32px", height: "32px", borderRadius: "50%", border: "none", background: isListening ? "var(--danger)" : "var(--border)", cursor: "pointer", flexShrink: 0, fontSize: "14px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  🎙️
                </button>
              )}
              <textarea
                ref={textareaRef}
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                onKeyDown={handleAnswerKey}
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontSize: "14px", resize: "none", maxHeight: "160px", lineHeight: 1.5, fontFamily: "inherit" }}
                placeholder={isListening ? "Listening... speak your answer" : "Type your answer or press 🎙️ to speak..."}
                rows={1}
              />
              <button className="btn-animated"
                onClick={handleSend}
                disabled={isLoading || !answer.trim()}
                style={{ padding: "8px 18px", borderRadius: "9px", border: "none", background: "var(--success)", color: "var(--text)", fontSize: "13px", fontWeight: 600, cursor: isLoading || !answer.trim() ? "not-allowed" : "pointer", opacity: isLoading || !answer.trim() ? 0.4 : 1, flexShrink: 0 }}
              >
                Send
              </button>
            </div>
            {isListening && <p style={{ fontSize: "11px", color: "var(--danger)", marginTop: "6px" }}>🔴 Recording — tap 🎙️ to stop</p>}
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
