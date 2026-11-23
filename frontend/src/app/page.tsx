"use client";

import { useEffect, useState } from "react";
import { apiFetch, getStoredToken } from "@/lib/api";
import LoginView from "@/components/LoginView";
import LibraryView from "@/components/LibraryView";

export default function HomePage() {
  const [checking, setChecking] = useState(true);
  const [username, setUsername] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    apiFetch<{ username: string }>("/api/auth/me")
      .then((res) => setUsername(res.username))
      .catch(() => {
        if (!token) setUsername(null);
        else setUsername(null);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <main className="min-h-screen bg-[#f9f8f6] text-[#1c1c1c] flex items-center justify-center">
        <div className="text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
          H文献大师 · 正在校验云端会话...
        </div>
      </main>
    );
  }

  if (!username) {
    return <LoginView onSuccess={(user) => setUsername(user)} />;
  }

  return <LibraryView username={username} onLogout={() => setUsername(null)} />;
}
