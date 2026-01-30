/**
 * Auth Service
 * 
 * Handles authentication with Supabase
 */

import { supabase, type User, type Session } from '../lib/supabase';

export interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
}

/**
 * Sign in with email and password
 */
export async function signInWithPassword(email: string, password: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

/**
 * Sign up with email and password
 */
export async function signUp(email: string, password: string, displayName?: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split('@')[0],
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

/**
 * Sign in with Google OAuth
 */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

/**
 * Sign out
 */
export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Get current session
 */
export async function getSession(): Promise<Session | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

/**
 * Get current user
 */
export async function getUser(): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChange(callback: (user: User | null, session: Session | null) => void) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(session?.user || null, session);
  });
}
