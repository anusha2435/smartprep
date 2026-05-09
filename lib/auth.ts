// lib/auth.ts
"use client";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updateProfile,
  updatePassword,
  User,
} from "firebase/auth";
import { auth } from "./firebase";
import { useEffect, useState } from "react";

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<{ user: User | null; error: string | null }> {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    // Save display name
    await updateProfile(result.user, { displayName });
    return { user: result.user, error: null };
  } catch (err: any) {
    return { user: null, error: friendlyError(err.code) };
  }
}

export async function signIn(
  email: string,
  password: string
): Promise<{ user: User | null; error: string | null }> {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return { user: result.user, error: null };
  } catch (err: any) {
    return { user: null, error: friendlyError(err.code) };
  }
}

export async function signOut(): Promise<void> {
  try {
    await firebaseSignOut(auth);
  } catch (err: any) {
    console.error("[Auth] Sign out failed:", err?.message);
  }
}

export async function resetPassword(
  email: string
): Promise<{ ok: boolean; error: string | null }> {
  try {
    await sendPasswordResetEmail(auth, email);
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: friendlyError(err.code) };
  }
}

export async function changePassword(
  password: string
): Promise<{ ok: boolean; error: string | null }> {
  try {
    if (!auth.currentUser) return { ok: false, error: "Please sign in again before changing your password." };
    await updatePassword(auth.currentUser, password);
    return { ok: true, error: null };
  } catch (err: any) {
    return { ok: false, error: friendlyError(err.code) };
  }
}

function friendlyError(code: string): string {
  switch (code) {
    case "auth/email-already-in-use": return "An account with this email already exists.";
    case "auth/invalid-email": return "Invalid email address.";
    case "auth/weak-password": return "Password must be at least 6 characters.";
    case "auth/user-not-found": return "No account found with this email.";
    case "auth/wrong-password": return "Incorrect password.";
    case "auth/invalid-credential": return "Incorrect email or password.";
    case "auth/requires-recent-login": return "Please sign out, sign back in, and try changing your password again.";
    case "auth/too-many-requests": return "Too many attempts. Try again later.";
    default: return "Something went wrong. Please try again.";
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  return { user, loading };
}

export { auth };
