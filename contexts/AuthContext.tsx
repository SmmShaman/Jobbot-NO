
import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../services/supabase';
import { Loader2 } from 'lucide-react';

interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: 'admin' | 'user' | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | 'user' | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUserRole = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('user_settings')
        .select('role')
        .eq('user_id', userId)
        .single();
      
      if (data && data.role) {
        setRole(data.role as 'admin' | 'user');
      } else {
        setRole('user');
      }
    } catch (e) {
      console.error("Error fetching role:", e);
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
                if (parsed.user?.id) {
                  await fetchUserRole(parsed.user.id);
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
        }
      } catch (e) {
        console.error("[Auth] Initialization error:", e);
        if (mounted) {
          setSession(null);
          setUser(null);
          setRole(null);
        }
      } finally {
        if (mounted) {
          console.log('[Auth] Initialization complete, setting loading=false');
          setLoading(false);
        }
      }
    };

    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!mounted) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchUserRole(session.user.id);
      } else {
        setRole(null);
      }
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.error("Sign out error:", e);
    } finally {
      // Always clear local state to show login page
      setSession(null);
      setUser(null);
      setRole(null);
      // Clear any cached auth data
      try {
        localStorage.removeItem('sb-ptrmidlhfdbybxmyovtm-auth-token');
        sessionStorage.clear();
      } catch (e) {
        // Ignore storage errors
      }
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
