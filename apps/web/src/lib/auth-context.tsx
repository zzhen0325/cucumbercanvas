"use client";

import type { Session, User } from "@supabase/supabase-js";
import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { getSupabaseBrowserClient } from "./supabase-browser";

// Dev auth bypass — set NEXT_PUBLIC_DEV_SKIP_AUTH=true to skip Supabase login.
const DEV_SKIP_AUTH =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_DEV_SKIP_AUTH === "true";

export const DEV_ACCESS_TOKEN = "dev-skip-auth-token";

const MOCK_USER_ID = "00000000-0000-0000-0000-000000000001";

export const DEV_AUTH_HEADER = `Bearer ${DEV_ACCESS_TOKEN}`;

function makeDevSession(): Session {
  return {
    access_token: DEV_ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 999999,
    expires_at: Math.floor(Date.now() / 1000) + 999999,
    refresh_token: "",
    user: {
      id: MOCK_USER_ID,
      email: "dev@cucumber.studio",
      role: "authenticated",
      aud: "authenticated",
      app_metadata: {},
      user_metadata: { display_name: "Dev User" },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_anonymous: false,
      confirmed_at: new Date().toISOString(),
      email_confirmed_at: new Date().toISOString(),
      phone: "",
      last_sign_in_at: new Date().toISOString(),
      identities: [],
      factors: [],
    } as User,
  };
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (DEV_SKIP_AUTH) {
      const devSession = makeDevSession();
      setSession(devSession);
      setUser(devSession.user);
      setLoading(false);
      return;
    }

    const supabase = getSupabaseBrowserClient();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    if (DEV_SKIP_AUTH) {
      setSession(null);
      setUser(null);
      return;
    }
    const supabase = getSupabaseBrowserClient();
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
