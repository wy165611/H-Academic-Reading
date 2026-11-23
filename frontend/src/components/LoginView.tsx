"use client";

import { useState, FormEvent } from "react";
import { apiFetch, setStoredToken } from "@/lib/api";

interface LoginViewProps {
  onSuccess: (username: string) => void;
}

export default function LoginView({ onSuccess }: LoginViewProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ access_token: string; username: string }>(
        "/api/auth/login",
        {
          method: "POST",
          body: JSON.stringify({ username, password }),
        }
      );
      setStoredToken(res.access_token);
      onSuccess(res.username);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f9f8f6] text-[#1c1c1c] flex flex-col justify-between pwa-safe-top pwa-safe-bottom">
      {/* Top Masthead */}
      <header className="w-full max-w-[1200px] mx-auto px-6 md:px-12 pt-8 pb-6 border-b border-[#1c1c1c]/10 flex items-center justify-between">
        <span className="font-serif text-xl tracking-tight">H文献大师</span>
        <span className="text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
          Editorial Archive · Self-Hosted
        </span>
      </header>

      {/* 45 / 55 Split Editorial Hero */}
      <section className="w-full max-w-[1200px] mx-auto px-6 md:px-12 py-12 md:py-20 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
        {/* Left 45% (5 cols) */}
        <div className="lg:col-span-5 space-y-8">
          <div className="section-label">Scholaread Self-Hosted</div>

          <h1 className="font-serif text-[44px] md:text-[60px] leading-[1.05] tracking-[-0.02em] font-normal">
            静心研读，
            <br />
            让学术文献回归纸面。
          </h1>

          <p className="text-[16px] leading-[1.7] text-[#6b7280] max-w-[34em]">
            双栏 PDF 视觉重排、公式与图表自动裁切、双语流式对照、划词锚点 AI 伴读，全端云同步。
          </p>

          <form onSubmit={handleSubmit} className="space-y-5 pt-2 max-w-sm">
            <div>
              <label
                htmlFor="login-username"
                className="block text-[12px] uppercase tracking-[0.2em] text-[#6b7280] mb-2"
              >
                管理员账号
              </label>
              <input
                id="login-username"
                name="username"
                type="text"
                autoComplete="username"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                enterKeyHint="next"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="输入管理员用户名"
                className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-4 py-3 text-[14px] text-[#1c1c1c] placeholder:text-[#6b7280]/60 focus:border-[#1c1c1c] focus:outline-none"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label
                  htmlFor="login-password"
                  className="block text-[12px] uppercase tracking-[0.2em] text-[#6b7280]"
                >
                  访问密码
                </label>
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="text-[11px] uppercase tracking-[0.18em] text-[#6b7280] hover:text-[#1c1c1c] underline-offset-4 hover:underline"
                >
                  {showPassword ? "隐藏密码" : "显示密码"}
                </button>
              </div>
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入访问密码"
                className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-4 py-3 text-[14px] text-[#1c1c1c] placeholder:text-[#6b7280]/60 focus:border-[#1c1c1c] focus:outline-none"
              />
            </div>

            {error && (
              <p
                role="alert"
                className="text-[13px] text-[#816d70] border-l-2 border-[#816d70] pl-3 py-1"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-editorial w-full"
            >
              {loading ? "正在验证身份..." : "进入我的文献库"}
            </button>
          </form>
        </div>

        {/* Right 55% (7 cols): Editorial Magazine Spread Specimen */}
        <div className="lg:col-span-7 border border-[#1c1c1c]/15 p-8 md:p-12 space-y-8 bg-[#f9f8f6]">
          <div className="flex items-center justify-between border-b border-[#1c1c1c]/10 pb-4">
            <span className="text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
              Issue No. 01 · Specimen
            </span>
            <span className="text-[12px] uppercase tracking-[0.2em] text-[#816d70]">
              Bilingual · AI Anchors
            </span>
          </div>

          <div className="space-y-4">
            <h2 className="font-serif text-[28px] md:text-[34px] leading-[1.2] tracking-[-0.01em] font-normal">
              Attention Is All You Need
            </h2>
            <p className="text-[14px] text-[#6b7280] leading-[1.7]">
              注意力机制即全部所需 · NeurIPS · CCF-A
            </p>
          </div>

          <blockquote className="pull-quote">
            <span className="text-[#816d70] text-[1.5em] leading-none mr-2">“</span>
            We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.
            <span className="text-[#816d70] text-[1.5em] leading-none ml-1">”</span>
          </blockquote>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-[#1c1c1c]/10 text-[13px] leading-[1.7]">
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] mb-1">
                01 / 流式重排
              </div>
              <p className="text-[#1c1c1c]/80">
                自动剥离双栏页眉页码，行内公式转为标准 LaTeX，原图以 0–1000 归一化坐标裁切嵌回。
              </p>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] mb-1">
                02 / 锚点对话持久化
              </div>
              <p className="text-[#1c1c1c]/80">
                <span className="qa-anchor-mark px-0.5">划词发起的每一次 AI 解析</span>
                均附着在段落偏移量上，跨端重开随时点击回看追问。
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="w-full max-w-[1200px] mx-auto px-6 md:px-12 py-6 border-t border-[#1c1c1c]/10 flex flex-wrap items-center justify-between gap-4 text-[12px] text-[#6b7280]">
        <span>墨黑 #1C1C1C · 暖米纸 #F9F8F6 · 陈玫点缀 #816D70</span>
        <span className="uppercase tracking-[0.2em]">PWA Ready · iOS &amp; Desktop</span>
      </footer>
    </main>
  );
}
