
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
      try {
        // Race between auth and 5-second timeout
        const authPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<{ data: { session: null }, isTimeout: true }>((resolve) => {
          setTimeout(() => {
            console.warn("Auth timeout - Supabase not responding");
            resolve({ data: { session: null }, isTimeout: true });
          }, 5000);
        });

        const result = await Promise.race([authPromise, timeoutPromise]) as any;

        if (!mounted) return;

        if (result.isTimeout) {
          console.warn("Auth service timeout - please refresh or check connection");
          setSession(null);
          setUser(null);
          setRole(null);
        } else {
          const session = result.data?.session;
          setSession(session);
          setUser(session?.user ?? null);

          if (session?.user) {
            await fetchUserRole(session.user.id);
          }
        }
      } catch (e) {
        console.error("Auth initialization error:", e);
        if (mounted) {
          setSession(null);
          setUser(null);
          setRole(null);
        }
      } finally {
        if (mounted) {
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
    await supabase.auth.signOut();
    setRole(null);
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
