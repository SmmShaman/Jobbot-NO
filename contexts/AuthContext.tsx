
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
        // Race between auth and 10-second timeout (increased from 5s)
        console.log('[Auth] Calling supabase.auth.getSession()...');
        const start = Date.now();

        const authPromise = supabase.auth.getSession().then(result => {
          console.log(`[Auth] getSession completed in ${Date.now() - start}ms`);
          return result;
        });

        const timeoutPromise = new Promise<{ data: { session: null }, isTimeout: true }>((resolve) => {
          setTimeout(() => {
            console.warn(`[Auth] Timeout after 10 seconds - Supabase not responding`);
            resolve({ data: { session: null }, isTimeout: true });
          }, 10000);
        });

        const result = await Promise.race([authPromise, timeoutPromise]) as any;

        if (!mounted) {
          console.log('[Auth] Component unmounted, skipping state update');
          return;
        }

        if (result.isTimeout) {
          console.warn("[Auth] Service timeout - please refresh or check connection");
          setSession(null);
          setUser(null);
          setRole(null);
        } else {
          const session = result.data?.session;
          console.log('[Auth] Session result:', session ? `User: ${session.user?.email}` : 'No session');
          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            console.log('[Auth] Fetching user role...');
            await fetchUserRole(session.user.id);
          }
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
