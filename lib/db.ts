// lib/db.ts
// All Firestore read/write operations for SmartPrep
// Structure: users/{uid}/sessions/{sessionId}

import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  limit,
  serverTimestamp,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "./firebase";

/* ============================================================
   TYPES
   ============================================================ */
export type SessionMode = "interview" | "coach";

export type SessionSettings = {
  role: string;
  company?: string;
  interviewType?: string;
  difficulty?: string;
  round?: string;
};

export type SessionReport = {
  relevance: number;
  clarity: number;
  depth: number;
  communication: number;
  confidence: number;
  presence: number;
  verdict: string;
  strengths: string;
  weaknesses: string;
  answerBreakdown?: any[];
  avgAnswerDurationSeconds?: number;
  totalFillerWords?: number;
  bgVoiceViolations?: number;
  totalViolations?: number;
};

export type SavedSession = {
  sessionId: string;
  uid: string;
  mode: SessionMode;
  timestamp: number;
  settings: SessionSettings;
  conversationHistory?: any[];
  allMetadata?: any[];
  messages?: any[];           // coach messages
  report?: SessionReport | null;
  integrityFlags?: number;
  cameraViolations?: number;
  bgVoiceViolations?: number;
  totalViolations?: number;
  sessionEndedEarly?: boolean;
  terminationReason?: string;
};

/* ============================================================
   SAVE SESSION
   Called during interview/coach to persist to Firestore.
   Uses merge so partial saves don't overwrite full data.
   ============================================================ */
export async function saveSession(
  uid: string,
  session: Omit<SavedSession, "uid">
): Promise<void> {
  if (!uid || !session.sessionId) return;
  try {
    const ref = doc(db, "users", uid, "sessions", session.sessionId);
    await setDoc(
      ref,
      {
        ...session,
        uid,
        updatedAt: serverTimestamp(),
        // Only set createdAt on first save
      },
      { merge: true }
    );
    console.log("[DB] Session saved:", session.sessionId);
  } catch (err: any) {
    console.error("[DB] saveSession failed:", err?.message);
  }
}

/* ============================================================
   GET ALL SESSIONS
   Returns sessions sorted newest first.
   ============================================================ */
export async function getSessions(
  uid: string,
  maxResults = 50
): Promise<SavedSession[]> {
  if (!uid) return [];
  try {
    const ref = collection(db, "users", uid, "sessions");
    const q = query(ref, orderBy("timestamp", "desc"), limit(maxResults));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as SavedSession);
  } catch (err: any) {
    console.error("[DB] getSessions failed:", err?.message);
    return [];
  }
}

/* ============================================================
   GET SINGLE SESSION
   ============================================================ */
export async function getSession(
  uid: string,
  sessionId: string
): Promise<SavedSession | null> {
  if (!uid || !sessionId) return null;
  try {
    const ref = doc(db, "users", uid, "sessions", sessionId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as SavedSession;
  } catch (err: any) {
    console.error("[DB] getSession failed:", err?.message);
    return null;
  }
}

/* ============================================================
   GET INTERVIEW SESSIONS ONLY
   ============================================================ */
export async function getInterviewSessions(uid: string): Promise<SavedSession[]> {
  const all = await getSessions(uid, 100);
  return all.filter((s) => s.mode === "interview");
}

/* ============================================================
   GET COACH SESSIONS ONLY
   ============================================================ */
export async function getCoachSessions(uid: string): Promise<SavedSession[]> {
  const all = await getSessions(uid, 100);
  return all.filter((s) => s.mode === "coach");
}

/* ============================================================
   SAVE USER PROFILE (on first login)
   ============================================================ */
export async function saveUserProfile(
  uid: string,
  profile: { displayName: string | null; email: string | null; photoURL: string | null }
): Promise<void> {
  if (!uid) return;
  try {
    const ref = doc(db, "users", uid, "profile", "info");
    await setDoc(
      ref,
      { ...profile, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch (err: any) {
    console.error("[DB] saveUserProfile failed:", err?.message);
  }
}

/* ============================================================
   SCORE HELPERS
   ============================================================ */
export function avgReportScore(report?: SessionReport | null): number {
  if (!report) return 0;
  const scores = [
    report.relevance,
    report.clarity,
    report.depth,
    report.communication,
    report.confidence,
    report.presence,
  ].map((score) => Number(score) || 0);
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const isLegacyTenPointScore = average > 0 && Math.max(...scores) <= 10;
  return Math.round(isLegacyTenPointScore ? average * 10 : average);
}

export function getSkillAverages(sessions: SavedSession[]) {
  const withReports = sessions.filter((s) => s.report && s.mode === "interview");
  if (withReports.length === 0) return null;

  const avg = (key: keyof SessionReport) =>
    Math.round(
      withReports.reduce((sum, s) => sum + ((s.report?.[key] as number) || 0), 0) /
        withReports.length
    );

  return {
    communication: avg("communication"),
    clarity: avg("clarity"),
    depth: avg("depth"),
    confidence: avg("confidence"),
    presence: avg("presence"),
    relevance: avg("relevance"),
  };
}
