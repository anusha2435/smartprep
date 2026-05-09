// lib/useFirebaseSave.ts
"use client";

import { auth } from "./firebase";
import { saveSession, SavedSession } from "./db";

// Uses auth.currentUser directly — no hooks needed
// This avoids the "invalid hook call" error

export function useFirebaseSave() {
  async function save(session: Omit<SavedSession, "uid">) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    await saveSession(uid, session);
  }

  return { save };
}