"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { LoadingScreen } from "@/components/loading-screen";
import { useAuth } from "@/lib/auth-context";

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      return;
    }

    const destination = user ? "/home" : "/login";
    console.info("[root] landing page removed; redirecting visitor", {
      destination,
      authenticated: Boolean(user),
    });
    router.replace(destination);
  }, [loading, router, user]);

  return <LoadingScreen />;
}
