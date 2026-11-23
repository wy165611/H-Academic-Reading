"use client";

import { useEffect, useState } from "react";
import { X, Check, AlertCircle, Loader2 } from "lucide-react";
import { apiFetch, SystemSettingItem, useEditorialDialog } from "@/lib/api";

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

interface TestState {
  loading: boolean;
  ok?: boolean;
  message?: string;
}

const OCR_PRESETS = ["qwen3.5-ocr", "qwen3-vl-plus", "qwen4-max"];
const TEXT_PRESETS = ["deepseek-v4.1-flash-1017", "qwen-max", "qwen-plus", "deepseek-v3.2"];

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const dialogRef = useEditorialDialog(open, onClose);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const [globalBaseUrl, setGlobalBaseUrl] = useState(
    "https://dashscope.aliyuncs.com/compatible-mode/v1"
  );
  const [globalApiKey, setGlobalApiKey] = useState("");
  const [globalKeyMask, setGlobalKeyMask] = useState("");

  const [ocrModel, setOcrModel] = useState("qwen3.5-ocr");
  const [ocrBaseUrl, setOcrBaseUrl] = useState("");
  const [ocrApiKey, setOcrApiKey] = useState("");
  const [ocrKeyMask, setOcrKeyMask] = useState("");

  const [translateModel, setTranslateModel] = useState("deepseek-v4.1-flash-1017");
  const [translateBaseUrl, setTranslateBaseUrl] = useState("");
  const [translateApiKey, setTranslateApiKey] = useState("");
  const [translateKeyMask, setTranslateKeyMask] = useState("");

  const [chatModel, setChatModel] = useState("deepseek-v4.1-flash-1017");
  const [chatBaseUrl, setChatBaseUrl] = useState("");
  const [chatApiKey, setChatApiKey] = useState("");
  const [chatKeyMask, setChatKeyMask] = useState("");
  const [chatThinkingLevel, setChatThinkingLevel] = useState<"low" | "medium" | "high">("high");

  const [testStates, setTestStates] = useState<Record<string, TestState>>({});

  useEffect(() => {
    if (!open) return;
    setSaveNotice(null);
    setTestStates({});
    setLoading(true);
    apiFetch<SystemSettingItem>("/api/settings")
      .then((data) => {
        setGlobalBaseUrl(data.global_base_url);
        setGlobalKeyMask(data.global_api_key_masked);
        setGlobalApiKey("");

        setOcrModel(data.ocr_model);
        setOcrBaseUrl(data.ocr_base_url || "");
        setOcrKeyMask(data.ocr_api_key_masked);
        setOcrApiKey("");

        setTranslateModel(data.translate_model);
        setTranslateBaseUrl(data.translate_base_url || "");
        setTranslateKeyMask(data.translate_api_key_masked);
        setTranslateApiKey("");

        setChatModel(data.chat_model);
        setChatBaseUrl(data.chat_base_url || "");
        setChatApiKey(data.chat_api_key_masked ? "" : "");
        setChatKeyMask(data.chat_api_key_masked);
        setChatThinkingLevel(data.chat_thinking_level || "high");
      })
      .catch((err) => {
        setSaveNotice(err instanceof Error ? err.message : "加载设置失败");
      })
      .finally(() => setLoading(false));
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setSaveNotice(null);
    try {
      const updated = await apiFetch<SystemSettingItem>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({
          global_base_url: globalBaseUrl,
          global_api_key: globalApiKey || undefined,
          ocr_model: ocrModel,
          ocr_base_url: ocrBaseUrl,
          ocr_api_key: ocrApiKey || undefined,
          translate_model: translateModel,
          translate_base_url: translateBaseUrl,
          translate_api_key: translateApiKey || undefined,
          chat_model: chatModel,
          chat_base_url: chatBaseUrl,
          chat_api_key: chatApiKey || undefined,
          chat_thinking_level: chatThinkingLevel,
        }),
      });
      setGlobalKeyMask(updated.global_api_key_masked);
      setOcrKeyMask(updated.ocr_api_key_masked);
      setTranslateKeyMask(updated.translate_api_key_masked);
      setChatKeyMask(updated.chat_api_key_masked);
      setGlobalApiKey("");
      setOcrApiKey("");
      setTranslateApiKey("");
      setChatApiKey("");
      setSaveNotice("设置已保存至云端数据库。");
    } catch (err) {
      setSaveNotice(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest(module: "ocr" | "translate" | "chat") {
    setTestStates((prev) => ({ ...prev, [module]: { loading: true } }));

    const payload: Record<string, string | undefined> = { module };
    if (module === "ocr") {
      payload.model = ocrModel;
      payload.base_url = ocrBaseUrl || globalBaseUrl;
      payload.api_key = ocrApiKey || globalApiKey || undefined;
    } else if (module === "translate") {
      payload.model = translateModel;
      payload.base_url = translateBaseUrl || globalBaseUrl;
      payload.api_key = translateApiKey || globalApiKey || undefined;
    } else {
      payload.model = chatModel;
      payload.base_url = chatBaseUrl || globalBaseUrl;
      payload.api_key = chatApiKey || globalApiKey || undefined;
      payload.thinking_level = chatThinkingLevel;
    }

    try {
      const res = await apiFetch<{
        ok: boolean;
        latency_ms: number;
        reply?: string;
        error?: string;
      }>("/api/settings/test", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setTestStates((prev) => ({
        ...prev,
        [module]: {
          loading: false,
          ok: res.ok,
          message: res.ok
            ? `连接成功 (${res.latency_ms}ms): ${res.reply || "OK"}`
            : res.error || "连接失败",
        },
      }));
    } catch (err) {
      setTestStates((prev) => ({
        ...prev,
        [module]: {
          loading: false,
          ok: false,
          message: err instanceof Error ? err.message : "测试失败",
        },
      }));
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="settings-modal-title"
      // @ts-expect-error closedby is supported in Chromium 134+ with Safari fallback in useEditorialDialog
      closedby="any"
      className="w-[min(94vw,760px)]"
    >
      <div className="bg-[#f9f8f6] text-[#1c1c1c] flex flex-col max-h-[88dvh]">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#1c1c1c]/15">
          <div>
            <div className="section-label mb-1">System Preferences</div>
            <h2 id="settings-modal-title" className="font-serif text-2xl font-normal">
              多模型 API 与解析流水线配置
            </h2>
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="关闭设置窗口"
            className="p-2 border border-[#1c1c1c]/20 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-6 space-y-8">
          {loading ? (
            <div className="py-12 text-center text-[13px] text-[#6b7280]">正在读取配置...</div>
          ) : (
            <>
              {/* Global Defaults */}
              <section className="space-y-4 pb-6 border-b border-[#1c1c1c]/10">
                <div className="text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
                  全局默认接入点（默认适配阿里云百炼）
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="global-base-url"
                      className="block text-[12px] text-[#6b7280] mb-1.5"
                    >
                      默认 OpenAI 兼容 Base URL
                    </label>
                    <input
                      id="global-base-url"
                      type="url"
                      value={globalBaseUrl}
                      onChange={(e) => setGlobalBaseUrl(e.target.value)}
                      placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2.5 text-[13px]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="global-api-key"
                      className="block text-[12px] text-[#6b7280] mb-1.5"
                    >
                      全局 API Key {globalKeyMask ? `（当前已配置: ${globalKeyMask}）` : "（未配置）"}
                    </label>
                    <input
                      id="global-api-key"
                      type="password"
                      value={globalApiKey}
                      onChange={(e) => setGlobalApiKey(e.target.value)}
                      placeholder={globalKeyMask ? "留空则保留现有密钥，或输入新密钥覆盖" : "输入 sk-..."}
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2.5 text-[13px]"
                    />
                  </div>
                </div>
              </section>

              {/* Module 1: Vision OCR */}
              <section className="space-y-3 pb-6 border-b border-[#1c1c1c]/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-lg">模块 1：视觉重排与图表坐标解析模型</h3>
                    <p className="text-[12px] text-[#6b7280]">
                      逐页识别双栏顺序、LaTeX 公式及 Qwen 0–1000 归一化图表边界框
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTest("ocr")}
                    disabled={testStates.ocr?.loading}
                    className="btn-editorial-outline text-[11px] py-2 px-3"
                  >
                    {testStates.ocr?.loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    连通性测试
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="ocr-model" className="block text-[11px] text-[#6b7280] mb-1">
                      模型 ID
                    </label>
                    <input
                      id="ocr-model"
                      list="ocr-presets"
                      value={ocrModel}
                      onChange={(e) => setOcrModel(e.target.value)}
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                    <datalist id="ocr-presets">
                      {OCR_PRESETS.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label htmlFor="ocr-url" className="block text-[11px] text-[#6b7280] mb-1">
                      独立 Base URL（可选覆盖）
                    </label>
                    <input
                      id="ocr-url"
                      value={ocrBaseUrl}
                      onChange={(e) => setOcrBaseUrl(e.target.value)}
                      placeholder="默认沿用全局 Base URL"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="ocr-key" className="block text-[11px] text-[#6b7280] mb-1">
                      独立 Key（可选 {ocrKeyMask ? `· ${ocrKeyMask}` : ""}）
                    </label>
                    <input
                      id="ocr-key"
                      type="password"
                      value={ocrApiKey}
                      onChange={(e) => setOcrApiKey(e.target.value)}
                      placeholder="留空沿用全局 Key"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                </div>
                {testStates.ocr?.message && (
                  <p
                    className={`text-[12px] flex items-center gap-1.5 ${
                      testStates.ocr.ok ? "text-[#1c1c1c]" : "text-[#816d70]"
                    }`}
                  >
                    {testStates.ocr.ok ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {testStates.ocr.message}
                  </p>
                )}
              </section>

              {/* Module 2: Translate & Metadata */}
              <section className="space-y-3 pb-6 border-b border-[#1c1c1c]/10">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-lg">模块 2：整篇并发翻译 &amp; 元数据/分区提取</h3>
                    <p className="text-[12px] text-[#6b7280]">
                      结合 Crossref/OpenAlex 补全中文译题、摘要、期刊分区，并分段精翻全文
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTest("translate")}
                    disabled={testStates.translate?.loading}
                    className="btn-editorial-outline text-[11px] py-2 px-3"
                  >
                    {testStates.translate?.loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    连通性测试
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="trans-model" className="block text-[11px] text-[#6b7280] mb-1">
                      模型 ID
                    </label>
                    <input
                      id="trans-model"
                      list="text-presets"
                      value={translateModel}
                      onChange={(e) => setTranslateModel(e.target.value)}
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="trans-url" className="block text-[11px] text-[#6b7280] mb-1">
                      独立 Base URL（可选覆盖）
                    </label>
                    <input
                      id="trans-url"
                      value={translateBaseUrl}
                      onChange={(e) => setTranslateBaseUrl(e.target.value)}
                      placeholder="默认沿用全局 Base URL"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="trans-key" className="block text-[11px] text-[#6b7280] mb-1">
                      独立 Key（可选 {translateKeyMask ? `· ${translateKeyMask}` : ""}）
                    </label>
                    <input
                      id="trans-key"
                      type="password"
                      value={translateApiKey}
                      onChange={(e) => setTranslateApiKey(e.target.value)}
                      placeholder="留空沿用全局 Key"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                </div>
                {testStates.translate?.message && (
                  <p
                    className={`text-[12px] flex items-center gap-1.5 ${
                      testStates.translate.ok ? "text-[#1c1c1c]" : "text-[#816d70]"
                    }`}
                  >
                    {testStates.translate.ok ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {testStates.translate.message}
                  </p>
                )}
              </section>

              {/* Module 3: Reader AI Companion */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="font-serif text-lg">模块 3：侧边栏 AI 伴读 &amp; 划词深度解释</h3>
                    <p className="text-[12px] text-[#6b7280]">
                      支持调节深度推理思考强度（默认 high），用于锚点持久问答与多篇综述
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleTest("chat")}
                    disabled={testStates.chat?.loading}
                    className="btn-editorial-outline text-[11px] py-2 px-3"
                  >
                    {testStates.chat?.loading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    连通性测试
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <label htmlFor="chat-model" className="block text-[11px] text-[#6b7280] mb-1">
                      模型 ID
                    </label>
                    <input
                      id="chat-model"
                      list="text-presets"
                      value={chatModel}
                      onChange={(e) => setChatModel(e.target.value)}
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="chat-thinking"
                      className="block text-[11px] text-[#6b7280] mb-1"
                    >
                      默认思考强度
                    </label>
                    <select
                      id="chat-thinking"
                      value={chatThinkingLevel}
                      onChange={(e) =>
                        setChatThinkingLevel(e.target.value as "low" | "medium" | "high")
                      }
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    >
                      <option value="high">High（深度推理）</option>
                      <option value="medium">Medium（均衡）</option>
                      <option value="low">Low（极速）</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="chat-url" className="block text-[11px] text-[#6b7280] mb-1">
                      独立 Base URL
                    </label>
                    <input
                      id="chat-url"
                      value={chatBaseUrl}
                      onChange={(e) => setChatBaseUrl(e.target.value)}
                      placeholder="沿用全局"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                  <div>
                    <label htmlFor="chat-key" className="block text-[11px] text-[#6b7280] mb-1">
                      独立 Key {chatKeyMask ? `(${chatKeyMask})` : ""}
                    </label>
                    <input
                      id="chat-key"
                      type="password"
                      value={chatApiKey}
                      onChange={(e) => setChatApiKey(e.target.value)}
                      placeholder="沿用全局"
                      className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2 text-[13px]"
                    />
                  </div>
                </div>
                <datalist id="text-presets">
                  {TEXT_PRESETS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                {testStates.chat?.message && (
                  <p
                    className={`text-[12px] flex items-center gap-1.5 ${
                      testStates.chat.ok ? "text-[#1c1c1c]" : "text-[#816d70]"
                    }`}
                  >
                    {testStates.chat.ok ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5" />
                    )}
                    {testStates.chat.message}
                  </p>
                )}
              </section>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#1c1c1c]/15 flex flex-wrap items-center justify-between gap-4">
          <span className="text-[12px] text-[#816d70]">{saveNotice || ""}</span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="btn-editorial-outline"
            >
              关闭
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || loading}
              className="btn-editorial"
            >
              {saving ? "保存中..." : "保存配置"}
            </button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
