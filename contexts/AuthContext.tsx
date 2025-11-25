
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY, STORAGE_KEY } from '../services/supabase';
import { Loader2 } from 'lucide-react';

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

  useEffect(() => {
    const initAuth = async () => {
      console.log('[Auth] Initializing...');

      // Step 1: Get session from localStorage (instant, no API call)
      const { session: storedSession, user: storedUser } = getSessionFromStorage();

      if (storedSession && storedUser) {
        console.log('[Auth] Found stored session for:', storedUser.email);
        setSession(storedSession);
        setUser(storedUser);

        // Step 2: Fetch user role with direct HTTP call
        const userRole = await fetchUserRoleDirect(storedUser.id, storedSession.access_token);
        console.log('[Auth] User role:', userRole);
        setRole(userRole);
      } else {
        console.log('[Auth] No stored session found');
      }

      setLoading(false);
      console.log('[Auth] Initialization complete');
    };

    initAuth();

    // Listen for auth state changes (for login events)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      console.log('[Auth] State change:', event);

      if (event === 'SIGNED_IN' && newSession) {
        setSession(newSession);
        setUser(newSession.user);

        // Fetch role with direct HTTP
        const userRole = await fetchUserRoleDirect(newSession.user.id, newSession.access_token);
        setRole(userRole);
      } else if (event === 'SIGNED_OUT') {
        setSession(null);
        setUser(null);
        setRole(null);
      }

      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    console.log('[Auth] Signing out...');

    // Clear local storage immediately (instant, no hanging)
    clearSessionFromStorage();

    // Update state
    setSession(null);
    setUser(null);
    setRole(null);

    // Try to call supabase signOut in background, but don't wait for it
    try {
      // Use a short timeout for the API call
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('SignOut timeout')), 2000)
      );
      await Promise.race([
        supabase.auth.signOut(),
        timeoutPromise
      ]);
    } catch (e) {
      // Ignore errors - local storage is already cleared
      console.log('[Auth] SignOut API call skipped or timed out');
    }

    console.log('[Auth] Signed out');
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
