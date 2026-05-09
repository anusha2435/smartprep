"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFaceProctoring, type CameraViolationType, type VisualConfidenceSample } from "@/lib/useFaceProctoring";
import { useFirebaseSave } from "@/lib/useFirebaseSave";

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
  cameraViolationType?: CameraViolationType | "none";
  cameraViolationNote?: string;
  visualConfidence?: VisualConfidenceSummary;
};

type VisualConfidenceSummary = {
  sampleCount: number;
  faceVisiblePercent: number;
  averageConfidence: number;
  averageEyeContact: number;
  averagePosture: number;
  averageCentered: number;
  averageFacing: number;
  primaryCue: string;
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
const MAX_CAMERA_VIOLATIONS = 3;
const NOISE_WARNING_COOLDOWN = 10000;
const NOISE_BASELINE_SAMPLES = 8;
const NOISE_REQUIRED_SAMPLES = 6;

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

function averageScore(samples: VisualConfidenceSample[], key: keyof Pick<VisualConfidenceSample, "confidenceScore" | "eyeContactScore" | "postureScore" | "centeredScore" | "facingScore">) {
  if (samples.length === 0) return 0;
  return Math.round(samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length);
}

function summarizeVisualConfidence(samples: VisualConfidenceSample[]): VisualConfidenceSummary | undefined {
  if (samples.length === 0) return undefined;

  const faceVisiblePercent = Math.round((samples.filter(sample => sample.faceVisible).length / samples.length) * 100);
  const summary = {
    sampleCount: samples.length,
    faceVisiblePercent,
    averageConfidence: averageScore(samples, "confidenceScore"),
    averageEyeContact: averageScore(samples, "eyeContactScore"),
    averagePosture: averageScore(samples, "postureScore"),
    averageCentered: averageScore(samples, "centeredScore"),
    averageFacing: averageScore(samples, "facingScore"),
    primaryCue: "Steady on camera",
  };

  const cues = [
    { label: "eye contact", value: summary.averageEyeContact },
    { label: "posture", value: summary.averagePosture },
    { label: "centering", value: summary.averageCentered },
    { label: "camera-facing", value: summary.averageFacing },
    { label: "face visibility", value: summary.faceVisiblePercent },
  ].sort((a, b) => a.value - b.value);

  summary.primaryCue = cues[0].value < 65 ? `Improve ${cues[0].label}` : "Steady on camera";
  return summary;
}

/* ============================================================
   INTERVIEW PAGE
   ============================================================ */
export default function Interview() {
  const router = useRouter();
  const { save } = useFirebaseSave();

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

  const [finalTranscriptText, setFinalTranscriptText] = useState("");
  const [interimTranscriptText, setInterimTranscriptText] = useState("");
  const finalTranscriptRef = useRef("");

  const [answerStartTime, setAnswerStartTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [silencePauses, setSilencePauses] = useState(0);
  const [longestPause, setLongestPause] = useState(0);

  const [candidateQsLeft, setCandidateQsLeft] = useState(1);
  const [candidateInput, setCandidateInput] = useState("");
  const [candidateAnswers, setCandidateAnswers] = useState<InterviewMessage[]>([]);

  const [integrityFlags, setIntegrityFlags] = useState(0);
  const [showTabWarning, setShowTabWarning] = useState(false);

  const [cameraViolations, setCameraViolations] = useState(0);
  const [showCameraWarning, setShowCameraWarning] = useState(false);
  const [cameraWarningMsg, setCameraWarningMsg] = useState("");

  const [noiseViolations, setNoiseViolations] = useState(0);
  const [showNoiseWarning, setShowNoiseWarning] = useState(false);


  const [sessionEnded, setSessionEnded] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const visualSamplesRef = useRef<VisualConfidenceSample[]>([]);

  const {
    status: proctoringStatus,
    label: proctoringLabel,
    mode: detectorMode,
  } = useFaceProctoring({
    videoRef,
    enabled: ["prepare", "answering"].includes(phase),
    onViolation: (type) => {
      if (phaseRef.current === "answering") triggerCameraViolation(type);
    },
    onSample: (sample) => {
      if (phaseRef.current === "answering") {
        visualSamplesRef.current.push(sample);
      }
    },
  });
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<any>(null);
  const snapshotRef = useRef<string | undefined>(undefined);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsEnabledRef = useRef(false);
  const phaseRef = useRef<InterviewPhase>("requesting-permissions");
  const integrityRef = useRef(0);
  const cameraViolationsRef = useRef(0);
  const noiseViolationsRef = useRef(0);
  const noiseSamplesRef = useRef(0);
  const noiseBaselineRef = useRef({ samples: 0, low: 0, mid: 0, high: 0 });
  const lastNoiseWarningRef = useRef(0);
  const graceRef = useRef(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const endTriggeredRef = useRef(false);
  const lastSpeechAtRef = useRef(0);

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
     CAMERA ATTACH
     ============================================================ */
  useEffect(() => {
    if (cameraReady && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => { });
    }
  }, [cameraReady]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      timerRef.current && clearInterval(timerRef.current);
      noiseCheckRef.current && clearInterval(noiseCheckRef.current);
      audioCtxRef.current?.close().catch(() => { });
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
        if (integrityRef.current >= 3) handleAutoEnd("tab-switch");
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
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
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
  function takeSnapshot(): string | null {
    if (!videoRef.current) return null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoRef.current.videoWidth || 320;
      canvas.height = videoRef.current.videoHeight || 240;
      canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
      return canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      return null;
    }
  }

  function triggerCameraViolation(type: CameraViolationType) {
    cameraViolationsRef.current += 1;
    setCameraViolations(cameraViolationsRef.current);
    setCameraWarningMsg(violationMessage(type));
    setShowCameraWarning(true);
    setTimeout(() => {
      setShowCameraWarning(false);
    }, 5000);
    if (cameraViolationsRef.current >= MAX_CAMERA_VIOLATIONS) {
      handleAutoEnd("camera-proctoring");
    }
  }

  function violationMessage(type: string): string {
    switch (type) {
      case "absent":
        return "Your face was not visible for an extended period. Please sit directly in front of the camera and ensure your face is well-lit.";
      case "looking_away":
        return "You were looking away from the camera. Please keep your eyes focused on the screen during the interview.";
      case "multiple_faces":
        return "More than one person was detected on camera. This must be a solo interview — please ensure no one else is in view.";
      case "not_centered":
        return "Please keep your face centered in the camera frame.";
      case "not_facing_camera":
        return "Please face the camera directly during the interview.";
      case "possible_device":
        return "Possible phone or device use detected. Please keep your hands and desk area clear.";
      default:
        return "Camera check failed. Please ensure your face is clearly visible.";
    }
  }

  /* ============================================================
     BACKGROUND NOISE DETECTION — Web Audio API
     ============================================================ */
  function startNoiseMonitoring() {
    if (!streamRef.current) return;
    stopNoiseMonitoring();
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const source = ctx.createMediaStreamSource(streamRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      const data = new Uint8Array(analyser.frequencyBinCount);
      noiseSamplesRef.current = 0;
      noiseBaselineRef.current = { samples: 0, low: 0, mid: 0, high: 0 };

      noiseCheckRef.current = setInterval(() => {
        if (phaseRef.current !== "answering") return;
        analyser.getByteFrequencyData(data);

        const upperBins = data.slice(Math.floor(data.length * 0.6));
        const avgHigh = upperBins.reduce((a, b) => a + b, 0) / upperBins.length;

        const midStart = Math.floor(data.length * 0.15);
        const midEnd = Math.floor(data.length * 0.6);
        const midBins = data.slice(midStart, midEnd);
        const avgMid = midBins.reduce((a, b) => a + b, 0) / midBins.length;

        const lowerBins = data.slice(0, midStart);
        const avgLow = lowerBins.reduce((a, b) => a + b, 0) / lowerBins.length;

        const now = Date.now();
        // If it's been more than 1.5s since speech, consider them not speaking
        const recentlySpeaking = now - lastSpeechAtRef.current < 1500;

        const baseline = noiseBaselineRef.current;
        if (!recentlySpeaking && baseline.samples < NOISE_BASELINE_SAMPLES) {
          baseline.samples += 1;
          baseline.low += (avgLow - baseline.low) / baseline.samples;
          baseline.mid += (avgMid - baseline.mid) / baseline.samples;
          baseline.high += (avgHigh - baseline.high) / baseline.samples;
          return;
        }

        const lowOverBaseline = avgLow > Math.max(38, baseline.low + 22);
        const midOverBaseline = avgMid > Math.max(34, baseline.mid + 18);
        const highOverBaseline = avgHigh > Math.max(18, baseline.high + 10);

        // Ignore steady ambient hum. Flag only sustained broadband spikes, usually another voice or music.
        const nonSpeechNoise =
          !recentlySpeaking &&
          ((midOverBaseline && highOverBaseline) ||
            (avgLow > 55 && avgMid > 32) ||
            avgHigh > 34);

        // If they are speaking, only flag if the mid/high frequencies are abnormally loud (like loud music overlapping speech)
        const excessiveMid = recentlySpeaking && avgMid > Math.max(62, baseline.mid + 34);
        const loudNoise = recentlySpeaking && avgHigh > Math.max(38, baseline.high + 18);

        if (nonSpeechNoise || excessiveMid || loudNoise) {
          noiseSamplesRef.current++;
          if (
            noiseSamplesRef.current >= NOISE_REQUIRED_SAMPLES &&
            now - lastNoiseWarningRef.current > NOISE_WARNING_COOLDOWN
          ) {
            lastNoiseWarningRef.current = now;
            noiseSamplesRef.current = 0;
            noiseViolationsRef.current += 1;
            setNoiseViolations(noiseViolationsRef.current);
            setShowNoiseWarning(true);
            setTimeout(() => setShowNoiseWarning(false), 4000);
          }
        } else {
          noiseSamplesRef.current = Math.max(0, noiseSamplesRef.current - 1);
        }
      }, 800);
    } catch (e) {
      console.warn("[NoiseDetect] AudioContext failed:", e);
    }
  }

  function stopNoiseMonitoring() {
    if (noiseCheckRef.current) { clearInterval(noiseCheckRef.current); noiseCheckRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => { }); audioCtxRef.current = null; }
    noiseSamplesRef.current = 0;
    noiseBaselineRef.current = { samples: 0, low: 0, mid: 0, high: 0 };
  }

  /* ============================================================
     SPEECH RECOGNITION
     ============================================================ */
  function startListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;

    if (recognitionRef.current) {
      try { recognitionRef.current.onend = null; recognitionRef.current.stop(); } catch { }
    }

    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.maxAlternatives = 1;
    let pauseStart: number | null = null;

    r.onstart = () => {
      lastSpeechAtRef.current = Date.now();
      setIsListening(true);
    };

    r.onresult = (e: any) => {
      let newFinal = "";
      let interim = "";

      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) {
          newFinal += result[0].transcript + " ";
          if (pauseStart !== null) {
            const d = (Date.now() - pauseStart) / 1000;
            if (d > 1.5) {
              setSilencePauses(p => p + 1);
              setLongestPause(p => Math.max(p, d));
            }
            pauseStart = null;
          }
        } else {
          interim += result[0].transcript;
        }
      }

      if (newFinal || interim) {
        lastSpeechAtRef.current = Date.now();
      }

      if (newFinal) {
        finalTranscriptRef.current = (finalTranscriptRef.current + newFinal).trimStart();
        setFinalTranscriptText(finalTranscriptRef.current);
      }
      setInterimTranscriptText(interim);
    };

    r.onspeechend = () => {
      pauseStart = Date.now();
      setInterimTranscriptText("");
    };

    r.onerror = (e: any) => {
      console.warn("[SR] error:", e.error);
      if ((e.error === "no-speech" || e.error === "network" || e.error === "audio-capture") && phaseRef.current === "answering") {
        setTimeout(() => startListening(), 300);
      } else if (e.error !== "aborted") {
        setIsListening(false);
      }
    };

    r.onend = () => {
      setInterimTranscriptText("");
      if (phaseRef.current === "answering") {
        setTimeout(() => startListening(), 200);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = r;
    try { r.start(); } catch (e) { console.warn("[SR] start() failed:", e); }
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      try { recognitionRef.current.stop(); } catch { }
    }
    setIsListening(false);
    setInterimTranscriptText("");
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
        cameraViolations: cameraViolationsRef.current,
        bgVoiceViolations: noiseViolationsRef.current,
      }),
    });
    return res.json();
  }

  async function callCandidateQuestionAI(msg: string, history: ConversationTurn[]): Promise<any> {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "candidate-question",
        role: settings.role,
        company: settings.company,
        interviewType: settings.interviewType,
        difficulty: settings.difficulty,
        round: settings.round,
        message: msg,
        conversationHistory: history,
      }),
    });
    return res.json();
  }

  /* ============================================================
     SAVE TO LOCALSTORAGE
     ============================================================ */
  const sessionIdRef = useRef<string>(
    `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
  );

  function saveLS(history: ConversationTurn[], metadata: AnswerMetadata[], report?: any) {
    try {
      const d = {
        sessionId: sessionIdRef.current,
        mode: "interview" as const,
        timestamp: Date.now(),
        settings,
        conversationHistory: history,
        allMetadata: metadata,
        integrityFlags: integrityRef.current,
        cameraViolations: cameraViolationsRef.current,
        bgVoiceViolations: noiseViolationsRef.current,
        report: report || null,
      };
      localStorage.setItem("lastInterviewSession", JSON.stringify(d));
      const existing: any[] = JSON.parse(localStorage.getItem("interviewSessions") || "[]");
      const deduped = existing.filter((s: any) => s.sessionId !== sessionIdRef.current);
      deduped.unshift(d);
      localStorage.setItem("interviewSessions", JSON.stringify(deduped.slice(0, 20)));
      save(d);
    } catch { }
  }

  /* ============================================================
     START INTERVIEW
     ============================================================ */
  async function handleStart() {
    setPhase("processing");
    try {
      const data = await callAI("START", []);
      if (endTriggeredRef.current) return;
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
      if (endTriggeredRef.current) return;
      setPhase("ready");
    }
  }

  /* ============================================================
     START ANSWERING
     ============================================================ */
  function handleStartAnswering() {
    finalTranscriptRef.current = "";
    setFinalTranscriptText("");
    setInterimTranscriptText("");
    setSilencePauses(0);
    setLongestPause(0);
    snapshotRef.current = undefined;
    visualSamplesRef.current = [];

    setPhase("answering");
    startTimer();
    startListening();
    startNoiseMonitoring();

  }

  /* ============================================================
     SUBMIT ANSWER
     ============================================================ */
  async function handleSubmit() {
    if (phase !== "answering") return;
    stopListening();
    stopNoiseMonitoring();
    const duration = stopTimer();
    const visualConfidence = summarizeVisualConfidence(visualSamplesRef.current);
    const submittedTranscript = finalTranscriptRef.current.trim();
    if (!submittedTranscript) { setPhase("prepare"); return; }
    setPhase("processing");
    setInterimTranscriptText("");
    snapshotRef.current = takeSnapshot() || undefined;

    const { count, words } = countFillers(submittedTranscript);
    const meta: AnswerMetadata = {
      questionNumber, questionText: currentQuestion, transcript: submittedTranscript,
      fillerWordCount: count, fillerWords: words, answerDurationSeconds: duration,
      idealDurationRange: IDEAL_DURATION[settings.round] || "90-120s",
      silencePausesCount: silencePauses,
      longestPauseSeconds: Math.round(longestPause * 10) / 10,
      cameraSnapshot: snapshotRef.current,
      visualConfidence,
    };

    const newAllMeta = [...allMetadata, meta];
    setAllMetadata(newAllMeta);

    const updatedMsgs: InterviewMessage[] = [...messages, { role: "candidate", text: submittedTranscript }];
    setMessages(updatedMsgs);

    const newHistory: ConversationTurn[] = [...conversationHistory, { role: "user", content: submittedTranscript }];

    try {
      const isLast = questionNumber >= 6;
      const data = await callAI(submittedTranscript, conversationHistory, isLast ? newAllMeta : []);
      if (endTriggeredRef.current) return;
      const updatedHistory: ConversationTurn[] = [...newHistory, { role: "assistant", content: JSON.stringify(data) }];
      setConversationHistory(updatedHistory);

      if (data.done === true || isLast) {
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({
            ...data.report,
            integrityFlags: integrityRef.current,
            cameraViolations: cameraViolationsRef.current,
            bgVoiceViolations: noiseViolationsRef.current,
          }));
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
      if (endTriggeredRef.current) return;
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
      if (endTriggeredRef.current) return;
      const updatedHistory: ConversationTurn[] = [...newHistory, { role: "assistant", content: JSON.stringify(data) }];
      setConversationHistory(updatedHistory);

      if (data.done === true || isLast) {
        if (data.report) {
          sessionStorage.setItem("interviewReport", JSON.stringify({
            ...data.report,
            integrityFlags: integrityRef.current,
            cameraViolations: cameraViolationsRef.current,
            bgVoiceViolations: noiseViolationsRef.current,
          }));
          sessionStorage.setItem("interviewMetadata", JSON.stringify(newAllMeta));
        }
        saveLS(updatedHistory, newAllMeta, data.report);
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
        saveLS(updatedHistory, newAllMeta);
      }
    } catch {
      if (endTriggeredRef.current) return;
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
      const data = await callCandidateQuestionAI(q, conversationHistory);
      if (endTriggeredRef.current) return;
      const answer = data.answer || "Thank you for your question.";
      setCandidateAnswers(prev => [...prev, { role: "interviewer", text: answer }]);
      const remaining = candidateQsLeft - 1;
      setCandidateQsLeft(remaining);
      if (remaining <= 0) setTimeout(navigateToReport, 1500);
    } catch {
      if (endTriggeredRef.current) return;
      setCandidateAnswers(prev => [...prev, { role: "interviewer", text: "Thank you for your question." }]);
    }
    if (endTriggeredRef.current) return;
    setPhase("candidate-questions");
  }

  function handleQuitInterview() {
    if (endTriggeredRef.current) return;
    const shouldQuit = window.confirm("Quit this interview? Your current progress will be saved, but no final report will be generated.");
    if (!shouldQuit) return;

    endTriggeredRef.current = true;
    setSessionEnded(true);
    setShowTabWarning(false);
    setShowCameraWarning(false);
    setShowNoiseWarning(false);
    stopListening();
    stopNoiseMonitoring();
    stopTimer();
    window.speechSynthesis?.cancel();
    streamRef.current?.getTracks().forEach(t => t.stop());

    sessionStorage.setItem("interviewMetadata", JSON.stringify(allMetadata));
    sessionStorage.setItem("terminationReason", "user-quit");
    saveLS(conversationHistory, allMetadata);

    setPhase("done");
    router.push("/");
  }

  function navigateToReport() {
    setPhase("done");
    setSessionEnded(true);
    stopNoiseMonitoring();
    streamRef.current?.getTracks().forEach(t => t.stop());
    router.push("/report");
  }

  /* ============================================================
     AUTO-END
     ============================================================ */
  async function handleAutoEnd(reason: string) {
    if (endTriggeredRef.current) return;
    endTriggeredRef.current = true;
    setSessionEnded(true);
    setShowTabWarning(false);
    setShowCameraWarning(false);
    stopListening();
    stopNoiseMonitoring();
    stopTimer();
    setPhase("done");
    sessionStorage.setItem("interviewMetadata", JSON.stringify(allMetadata));
    sessionStorage.setItem("integrityFlags", String(integrityRef.current));
    sessionStorage.setItem("cameraViolations", String(cameraViolationsRef.current));
    sessionStorage.setItem("bgVoiceViolations", String(noiseViolationsRef.current));
    sessionStorage.setItem("terminationReason", reason);

    const hard = setTimeout(() => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      router.push("/report");
    }, 5000);

    try {
      if (allMetadata.length > 0) {
        const data = await callAI("SESSION ENDED EARLY. Generate partial report.", conversationHistory, allMetadata);
        if (data.report) {
          const partialReport = {
            ...data.report,
            integrityFlags: integrityRef.current,
            cameraViolations: cameraViolationsRef.current,
            bgVoiceViolations: noiseViolationsRef.current,
            sessionEndedEarly: true,
            terminationReason: reason,
          };
          sessionStorage.setItem("interviewReport", JSON.stringify(partialReport));
          saveLS(conversationHistory, allMetadata, partialReport);
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
    if (elapsedSeconds < mn) return "var(--muted)";
    if (elapsedSeconds <= mx) return "var(--success)";
    return "var(--warning)";
  }

  /* ============================================================
     DERIVED
     ============================================================ */
  const isProcessing = phase === "processing";
  const idealDuration = IDEAL_DURATION[settings.round] || "90-120s";
  const totalViolations = integrityFlags + cameraViolations + noiseViolations;

  const S = {
    page: { display: "flex", height: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)", overflow: "hidden" } as React.CSSProperties,
    center: { display: "flex", height: "100vh", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-body)", alignItems: "center", justifyContent: "center" } as React.CSSProperties,
    interviewerBubble: { background: "var(--surface-2)", color: "var(--text)", padding: "12px 16px", borderRadius: "4px 18px 18px 18px", maxWidth: "75%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    candidateBubble: { background: "var(--accent)", color: "var(--text)", padding: "10px 16px", borderRadius: "18px 18px 4px 18px", maxWidth: "68%", fontSize: "14px", lineHeight: 1.6 } as React.CSSProperties,
    skippedBubble: { background: "var(--surface-2)", color: "var(--muted)", padding: "10px 16px", borderRadius: "18px 18px 4px 18px", maxWidth: "68%", fontSize: "14px", fontStyle: "italic" } as React.CSSProperties,
  };

  /* ============================================================
     LOADING SCREENS
     ============================================================ */
  if (phase === "requesting-permissions") return (
    <main style={S.center}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "36px", marginBottom: "16px" }}>📷</div>
        <p style={{ color: "var(--muted)", fontSize: "14px" }}>Requesting camera and microphone access...</p>
        <p style={{ color: "var(--muted)", fontSize: "12px", marginTop: "8px" }}>Allow access in the browser popup</p>
      </div>
    </main>
  );

  if (phase === "permission-denied") return (
    <main style={S.center}>
      <div style={{ textAlign: "center", maxWidth: "360px" }}>
        <div style={{ fontSize: "40px", marginBottom: "16px" }}>📷</div>
        <h2 className="font-heading" style={{ fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>Camera Required</h2>
        <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "6px" }}>Interview Mode requires camera and microphone.</p>
        <p style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "24px" }}>Click the camera icon in your browser address bar → Allow → refresh.</p>
        <button className="btn-animated" onClick={() => window.location.reload()} style={{ background: "var(--accent)", color: "var(--text)", border: "none", padding: "12px 24px", borderRadius: "10px", fontSize: "14px", cursor: "pointer", marginRight: "12px" }}>Retry →</button>
        <button className="btn-animated" onClick={() => router.push("/")} style={{ background: "transparent", color: "var(--muted)", border: "none", fontSize: "14px", cursor: "pointer" }}>← Back</button>
      </div>
    </main>
  );

  if (phase === "done") return (
    <main style={S.center}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "36px", marginBottom: "16px" }}>📊</div>
        <p style={{ color: "var(--muted)", fontSize: "14px" }}>Generating your evaluation report...</p>
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
          <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--danger)", borderRadius: "20px", padding: "40px", maxWidth: "380px", textAlign: "center" }}>
            <div style={{ fontSize: "32px", marginBottom: "12px" }}>⚠️</div>
            <h2 className="font-heading" style={{ fontSize: "18px", fontWeight: 700, color: "var(--danger)", marginBottom: "10px" }}>Tab Switch Detected</h2>
            <p style={{ color: "var(--muted)", fontSize: "13px", marginBottom: "6px" }}>Switching tabs during an interview is not permitted.</p>
            <p style={{ color: "var(--muted)", fontSize: "12px", marginBottom: "20px" }}>
              Violation {integrityFlags} of 3. At 3 violations your session ends.
            </p>
            {integrityFlags >= 3 ? (
              <div>
                <p style={{ color: "var(--danger)", fontWeight: 700, marginBottom: "8px" }}>❌ Session Terminated</p>
                <p style={{ color: "var(--muted)", fontSize: "12px" }}>Generating your report...</p>
              </div>
            ) : (
              <button className="btn-animated" onClick={() => setShowTabWarning(false)} style={{ background: "var(--danger)", color: "var(--text)", border: "none", padding: "10px 24px", borderRadius: "8px", fontSize: "14px", cursor: "pointer" }}>
                Return to Interview
              </button>
            )}
          </div>
        </div>
      )}

      {/* CAMERA VIOLATION BANNER */}
      {showCameraWarning && (
        <div style={{
          position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
          zIndex: 40, background: "rgba(239,68,68,0.12)", border: "1px solid var(--danger)",
          borderRadius: "12px", padding: "14px 20px", maxWidth: "420px", width: "90%",
          display: "flex", alignItems: "center", gap: "12px",
        }}>
          <span style={{ fontSize: "20px" }}>📷</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "13px", color: "var(--danger)", fontWeight: 600, marginBottom: "2px" }}>
              Camera Warning {cameraViolations}/{MAX_CAMERA_VIOLATIONS}
            </p>
            <p style={{ fontSize: "12px", color: "var(--danger)" }}>{cameraWarningMsg}</p>
            {cameraViolations >= MAX_CAMERA_VIOLATIONS && (
              <p style={{ fontSize: "12px", color: "var(--danger)", fontWeight: 700, marginTop: "4px" }}>
                Session terminating...
              </p>
            )}
          </div>
          <button className="btn-animated" onClick={() => setShowCameraWarning(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: "16px" }}>✕</button>
        </div>
      )}

      {/* NOISE WARNING BANNER */}
      {showNoiseWarning && (
        <div style={{
          position: "fixed", top: showCameraWarning ? "90px" : "16px", left: "50%", transform: "translateX(-50%)",
          zIndex: 39, background: "rgba(245,158,11,0.12)", border: "1px solid var(--warning)",
          borderRadius: "12px", padding: "12px 18px", maxWidth: "380px", width: "90%",
          display: "flex", alignItems: "center", gap: "10px",
        }}>
          <span style={{ fontSize: "18px" }}>🔊</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: "13px", color: "var(--warning)", fontWeight: 600 }}>Background Noise Detected</p>
            <p style={{ fontSize: "11px", color: "var(--warning)" }}>
              Flag {noiseViolations}. Please find a quieter environment.
            </p>
          </div>
          <button className="btn-animated" onClick={() => setShowNoiseWarning(false)} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer" }}>✕</button>
        </div>
      )}

      {/* LEFT — CAMERA */}
      <div style={{ width: "clamp(360px, 28vw, 460px)", minWidth: "360px", flexShrink: 0, background: "var(--surface)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, position: "relative", background: "var(--surface)", minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: "block" }}
          />
          {!cameraReady && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface)" }}>
              <p style={{ color: "var(--muted)", fontSize: "12px" }}>Camera loading...</p>
            </div>
          )}
          {isListening && (
            <div style={{ position: "absolute", top: "12px", left: "12px", display: "flex", alignItems: "center", gap: "6px", background: "rgba(0,0,0,0.7)", padding: "6px 12px", borderRadius: "20px" }}>
              <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "var(--danger)", display: "inline-block", animation: "pulse2 1s infinite" }} />
              <span style={{ fontSize: "11px", color: "var(--danger)" }}>Recording</span>
            </div>
          )}

          {/* LIVE PROCTORING STATUS — visible in prepare + answering + processing */}
          {["prepare", "answering", "processing", "candidate-questions"].includes(phase) && (
            <div style={{
              position: "absolute", top: "12px", right: "12px",
              display: "flex", alignItems: "center", gap: "6px",
              background: proctoringStatus === "alert"
                ? "rgba(127,29,29,0.92)"
                : proctoringStatus === "ok"
                  ? "rgba(22,101,52,0.88)"
                  : "rgba(30,30,30,0.80)",
              border: `1px solid ${proctoringStatus === "alert" ? "var(--danger)" :
                proctoringStatus === "ok" ? "var(--success)" :
                  "var(--border)"
                }`,
              padding: "5px 11px", borderRadius: "20px",
              transition: "background 0.3s, border-color 0.3s",
              boxShadow: proctoringStatus === "alert" ? "0 0 10px rgba(239,68,68,0.5)" : "none",
            }}>
              <span style={{
                width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0,
                background: proctoringStatus === "alert" ? "var(--danger)" :
                  proctoringStatus === "ok" ? "var(--success)" : "var(--muted)",
                display: "inline-block",
                animation: proctoringStatus === "alert" ? "pulse2 0.7s infinite" :
                  proctoringStatus === "ok" ? "none" : "pulse2 2s infinite",
              }} />
              <span style={{
                fontSize: "11px", fontWeight: 600,
                color: proctoringStatus === "alert" ? "var(--danger)" :
                  proctoringStatus === "ok" ? "var(--success)" : "var(--muted)",
              }}>
                {proctoringStatus === "idle" ? "Proctoring" :
                  proctoringStatus === "ok" ? `✓ ${proctoringLabel}` :
                    `⚠ ${proctoringLabel}`}
              </span>
            </div>
          )}

          {/* Violation counter */}
          {totalViolations > 0 && (
            <div style={{ position: "absolute", top: "44px", right: "12px", background: "rgba(127,29,29,0.85)", padding: "3px 9px", borderRadius: "20px", marginTop: "2px" }}>
              <span style={{ fontSize: "10px", color: "var(--danger)" }}>
                {totalViolations} flag{totalViolations > 1 ? "s" : ""}
              </span>
            </div>
          )}

          {/* Camera violation badge */}
          {cameraViolations > 0 && (
            <div style={{ position: "absolute", bottom: "12px", left: "12px", background: "rgba(127,29,29,0.85)", padding: "4px 10px", borderRadius: "20px" }}>
              <span style={{ fontSize: "11px", color: "var(--danger)" }}>
                📷 {cameraViolations}/{MAX_CAMERA_VIOLATIONS}
              </span>
            </div>
          )}

          {/* Detector backend badge */}
          {["answering", "prepare"].includes(phase) && (
            <div style={{ position: "absolute", bottom: "12px", right: "12px", background: "rgba(17,24,39,0.75)", padding: "4px 10px", borderRadius: "20px" }}>
              <span style={{ fontSize: "10px", color: detectorMode === "face-api" ? "var(--accent)" : "var(--warning)" }}>
                {detectorMode === "face-api" ? "Local" : "Local starting"}
              </span>
            </div>
          )}
        </div>

        <div style={{ padding: "14px 16px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          <p style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "2px" }}>{settings.role}</p>
          {settings.company && <p style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "6px" }}>{settings.company}</p>}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "11px", background: "var(--surface-2)", color: "var(--muted)", padding: "2px 8px", borderRadius: "20px" }}>{settings.round}</span>
            <span style={{ fontSize: "11px", background: "var(--surface-2)", color: "var(--muted)", padding: "2px 8px", borderRadius: "20px" }}>{settings.difficulty}</span>
          </div>
        </div>
      </div>

      {/* RIGHT — CHAT */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>

        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span>🎤</span>
            <div>
              <p style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>
                {settings.company ? `${settings.company} — ${settings.round} Round` : `${settings.round} Round Interview`}
              </p>
              <p style={{ fontSize: "11px", color: "var(--muted)" }}>{settings.interviewType} · {settings.difficulty}</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {phase === "answering" && (
              <span style={{ fontSize: "18px", fontWeight: 700, color: getTimerColor(), fontVariantNumeric: "tabular-nums" }}>
                {formatTime(elapsedSeconds)}
              </span>
            )}
            <button
              className="btn-animated"
              onClick={handleQuitInterview}
              style={{
                padding: "8px 14px",
                borderRadius: "10px",
                border: "1px solid var(--danger)",
                background: "rgba(239,68,68,0.1)",
                color: "var(--danger)",
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Quit
            </button>
          </div>
        </div>

        {/* READY SCREEN */}
        {phase === "ready" && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px" }}>
            <div style={{ maxWidth: "480px", width: "100%", textAlign: "center" }}>
              <h2 className="font-heading" style={{ fontSize: "22px", fontWeight: 700, marginBottom: "16px" }}>Ready to Begin?</h2>
              <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "16px", padding: "20px", marginBottom: "24px", textAlign: "left" }}>
                {[
                  ["🎙️ Speech", "words appear live as you speak"],
                  ["📷 Camera", `proctored (${detectorMode === "face-api" ? "local AI" : "local AI starting"}), 3 violations = terminated`],
                  ["⚠️ Tab switching", "monitored (3 switches = terminated)"],
                  ["🔊 Noise", "background noise flagged during answering"],
                ].map(([k, v]) => (
                  <p key={k} style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "8px" }}>{k}: <span style={{ color: "var(--text)" }}>{v}</span></p>
                ))}
              </div>
              <button className="btn-animated" onClick={handleStart} style={{ background: "var(--accent)", color: "var(--text)", border: "none", padding: "14px 36px", borderRadius: "12px", fontSize: "15px", fontWeight: 700, cursor: "pointer" }}>
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
                        <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "4px" }}>Question {msg.questionNumber} of 6</span>
                      )}
                      <div style={S.interviewerBubble}>{msg.text}</div>
                    </div>
                  )}
                  {msg.role === "candidate" && (
                    <div style={msg.skipped ? S.skippedBubble : S.candidateBubble}>{msg.text}</div>
                  )}
                </div>
              ))}

              {phase === "candidate-questions" && candidateAnswers.map((msg, i) => (
                <div key={`cq-${i}`} style={{ display: "flex", justifyContent: msg.role === "candidate" ? "flex-end" : "flex-start" }}>
                  <div style={msg.role === "candidate" ? S.candidateBubble : S.interviewerBubble}>{msg.text}</div>
                </div>
              ))}

              {isProcessing && (
                <div style={{ display: "flex" }}>
                  <div style={{ ...S.interviewerBubble, display: "flex", gap: "5px", alignItems: "center" }}>
                    {[0, 150, 300].map((d, i) => (
                      <span key={i} style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--muted)", display: "inline-block", animation: `pulse2 1s ${d}ms infinite` }} />
                    ))}
                  </div>
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* CONTROLS */}
            <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>

              {phase === "prepare" && (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
                  <div>
                    <p style={{ fontSize: "12px", color: "var(--muted)" }}>Ideal: <span style={{ color: "var(--text)" }}>{idealDuration}</span></p>
                    <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>Think, then click when ready</p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button className="btn-animated" onClick={handleSkipQuestion} style={{ padding: "9px 16px", borderRadius: "8px", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer" }}>
                      Skip
                    </button>
                    <button className="btn-animated" onClick={handleStartAnswering} style={{ padding: "9px 20px", borderRadius: "10px", border: "none", background: "var(--accent)", color: "var(--text)", fontSize: "13px", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                      🎙️ Start Answering
                    </button>
                  </div>
                </div>
              )}

              {phase === "answering" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div className="premium-card" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "12px", padding: "12px 16px", minHeight: "60px", maxHeight: "120px", overflowY: "auto" }}>
                    {(finalTranscriptText || interimTranscriptText) ? (
                      <p style={{ fontSize: "14px", lineHeight: 1.5, margin: 0 }}>
                        <span style={{ color: "var(--text)" }}>{finalTranscriptText}</span>
                        {interimTranscriptText && (
                          <span style={{ color: "var(--muted)", fontStyle: "italic" }}>{interimTranscriptText}</span>
                        )}
                      </p>
                    ) : (
                      <p style={{ fontSize: "14px", color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>
                        {isListening ? "Listening… speak now" : "Starting microphone…"}
                      </p>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{
                        width: "8px", height: "8px", borderRadius: "50%",
                        background: isListening ? "var(--danger)" : "var(--muted)",
                        display: "inline-block",
                        animation: isListening ? "pulse2 1s infinite" : "none",
                      }} />
                      <span style={{ fontSize: "12px", color: "var(--muted)" }}>
                        {isListening ? "Listening" : "Paused"} · {formatTime(elapsedSeconds)}
                      </span>
                    </div>
                    <button className="btn-animated" onClick={handleSubmit} style={{ padding: "10px 22px", borderRadius: "10px", border: "none", background: "var(--success)", color: "var(--text)", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>
                      ✓ Submit Answer
                    </button>
                  </div>
                </div>
              )}

              {phase === "candidate-questions" && candidateQsLeft > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  <p style={{ fontSize: "12px", color: "var(--muted)" }}>
                    You may ask {candidateQsLeft} question{candidateQsLeft > 1 ? "s" : ""} — or skip to results
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <textarea
                      value={candidateInput}
                      onChange={e => setCandidateInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleCandidateQuestion(); } }}
                      style={{ flex: 1, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "10px 14px", color: "var(--text)", fontSize: "13px", outline: "none", resize: "none", fontFamily: "inherit" }}
                      placeholder="Ask the interviewer a question..."
                      rows={1}
                    />
                    <button className="btn-animated" onClick={handleCandidateQuestion} disabled={!candidateInput.trim() || isProcessing} style={{ padding: "10px 16px", borderRadius: "10px", border: "none", background: "var(--accent)", color: "var(--text)", fontSize: "13px", cursor: "pointer", opacity: !candidateInput.trim() || isProcessing ? 0.4 : 1 }}>
                      Ask
                    </button>
                    <button className="btn-animated" onClick={navigateToReport} style={{ padding: "10px 16px", borderRadius: "10px", border: "1px solid var(--border)", background: "transparent", color: "var(--muted)", fontSize: "13px", cursor: "pointer" }}>
                      Results →
                    </button>
                  </div>
                </div>
              )}

              {phase === "candidate-questions" && candidateQsLeft <= 0 && (
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button className="btn-animated" onClick={navigateToReport} style={{ padding: "12px 28px", borderRadius: "10px", border: "none", background: "var(--accent)", color: "var(--text)", fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                    See Your Results →
                  </button>
                </div>
              )}

              {isProcessing && (
                <p style={{ fontSize: "12px", color: "var(--muted)", textAlign: "center", marginTop: "8px" }}>
                  Interviewer is responding...
                </p>
              )}
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes pulse2 {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }
      `}</style>
    </main>
  );
}
