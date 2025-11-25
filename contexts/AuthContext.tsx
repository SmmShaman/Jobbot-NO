
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_KEY } from '../services/supabase';
import { Loader2 } from 'lucide-react';

const SUPABASE_URL = 'https://ptrmidlhfdbybxmyovtm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB0cm1pZGxoZmRieWJ4bXlvdnRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI0MzQ3NDksImV4cCI6MjA3ODAxMDc0OX0.rdOIJ9iMnbz5uxmGrtxJxb0n1cwf6ee3ppz414IaDWM';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: 'admin' | 'user' | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Helper: Fetch with timeout to prevent hanging
const fetchWithTimeout = async (url: string, options: RequestInit, timeoutMs: number = 5000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
};

// Direct API call to fetch user role (bypasses potentially hanging supabase-js)
const fetchUserRoleDirect = async (userId: string, accessToken: string): Promise<'admin' | 'user'> => {
  try {
    const response = await fetchWithTimeout(
      `${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=role`,
      {
        headers: {
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
      5000
    );

    if (response.ok) {
      const data = await response.json();
      if (data && data.length > 0 && data[0].role) {
        return data[0].role as 'admin' | 'user';
      }
    }
    return 'user';
  } catch (e) {
    console.warn('fetchUserRoleDirect failed:', e);
    return 'user';
  }
};

// Get session directly from localStorage (bypasses potentially hanging supabase.auth.getSession())
const getSessionFromStorage = (): { session: Session | null; user: User | null } => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { session: null, user: null };
    }

    const parsed = JSON.parse(stored);

    // Check if session is expired
    if (parsed.expires_at && Date.now() / 1000 > parsed.expires_at) {
      localStorage.removeItem(STORAGE_KEY);
      return { session: null, user: null };
    }

    // Reconstruct session object
    const session: Session = {
      access_token: parsed.access_token,
      refresh_token: parsed.refresh_token,
      expires_in: parsed.expires_in || 3600,
      expires_at: parsed.expires_at,
      token_type: parsed.token_type || 'bearer',
      user: parsed.user,
    };

    return { session, user: parsed.user };
  } catch (e) {
    console.warn('Error reading session from storage:', e);
    return { session: null, user: null };
  }
};

// Clear session from localStorage (fast signOut without API call)
const clearSessionFromStorage = () => {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // Also clear any other supabase-related items
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (e) {
    console.warn('Error clearing session:', e);
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);

  // Use direct fetch to bypass Supabase client hanging issue
  const fetchUserRole = async (userId: string, accessToken: string) => {
    console.log('[Auth] Fetching user role via direct fetch...');
    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/user_settings?user_id=eq.${userId}&select=role`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${accessToken}`,
          }
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log('[Auth] Role response:', data);
        if (data && data[0] && data[0].role) {
          setRole(data[0].role as 'admin' | 'user');
          return;
        }
      }
      console.log('[Auth] No role found, defaulting to user');
      setRole('user');
    } catch (e) {
      console.error("[Auth] Error fetching role:", e);
      setRole('user');
    }
  };

  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      console.log('[Auth] Starting initialization...');
      try {
        // Try to get session from localStorage first (bypass Supabase client issue)
        const storageKey = 'sb-ptrmidlhfdbybxmyovtm-auth-token';
        const storedSession = localStorage.getItem(storageKey);

        if (storedSession) {
          try {
            const parsed = JSON.parse(storedSession);
            console.log('[Auth] Found stored session, checking validity...');

            // Check if token is expired
            const expiresAt = parsed.expires_at;
            const now = Math.floor(Date.now() / 1000);

            if (expiresAt && expiresAt > now) {
              console.log('[Auth] Session valid, using stored session');
              const sessionData = {
                access_token: parsed.access_token,
                refresh_token: parsed.refresh_token,
                expires_at: parsed.expires_at,
                user: parsed.user
              };

              if (mounted) {
                setSession(sessionData as any);
                setUser(parsed.user);
                if (parsed.user?.id && parsed.access_token) {
                  await fetchUserRole(parsed.user.id, parsed.access_token);
                } else {
                  setRole('user');
                }
                setLoading(false);
                return;
              }
            } else {
              console.log('[Auth] Stored session expired, clearing...');
              localStorage.removeItem(storageKey);
            }
          } catch (e) {
            console.error('[Auth] Error parsing stored session:', e);
            localStorage.removeItem(storageKey);
          }
        }

        // No valid stored session - user needs to login
        console.log('[Auth] No valid session found, showing login');
        if (mounted) {
          setSession(null);
          setUser(null);
          setRole(null);
          setLoading(false);
        }
      } catch (e) {
        console.error("[Auth] Initialization error:", e);
        if (mounted) {
          setSession(null);
          setUser(null);
          setRole(null);
          setLoading(false);
        }
      }
    };

    initAuth();

    // Note: onAuthStateChange uses Supabase client which hangs
    // So we don't rely on it - auth state is managed via localStorage
    return () => {
      mounted = false;
    };
  }, []);

  const signOut = async () => {
    console.log('[Auth] Signing out...');
    // Don't use supabase.auth.signOut() - it hangs
    // Just clear local state and storage
    setSession(null);
    setUser(null);
    setRole(null);
    try {
      localStorage.removeItem('sb-ptrmidlhfdbybxmyovtm-auth-token');
      sessionStorage.clear();
      console.log('[Auth] Sign out complete');
    } catch (e) {
      console.error('[Auth] Error clearing storage:', e);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user, role, loading, signOut }}>
      {loading ? (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={40} className="animate-spin text-blue-600" />
            <p className="text-slate-500 font-medium">Loading your workspace...</p>
          </div>
        </div>
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
