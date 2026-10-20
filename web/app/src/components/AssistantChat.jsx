import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { BotMessageSquare, MessageCircle, X, Send, Trash2, Maximize2, Minimize2 } from "lucide-react";
import { useGuidedTour } from "../lib/GuidedTourContext.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { apiJson } from "../lib/api.js";

const createMessage = (role, text, meta = {}) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  text,
  ts: Date.now(),
  ...meta,
});

const renderInlineMarkdown = (text) => {
  const parts = String(text || "").split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*)/g);

  return parts.map((part, index) => {
    if (!part) return null;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={index}
          className="rounded-md bg-slate-100 px-1 py-0.5 font-mono text-[12px] text-slate-700"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={index} className="font-semibold text-slate-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return (
        <em key={index} className="italic">
          {part.slice(1, -1)}
        </em>
      );
    }
    return part;
  });
};

const FormattedMessage = ({ text, isUser }) => {
  if (isUser) {
    return <>{text}</>;
  }

  const lines = String(text || "").split(/\r?\n/);
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`} className="my-1 space-y-1 pl-4">
        {listItems.map((item, index) => (
          <li key={index} className="list-disc marker:text-sky-500">
            {renderInlineMarkdown(item)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listItems.push(bullet[1]);
      return;
    }

    flushList();
    blocks.push(
      <p key={`p-${blocks.length}`} className="my-1 first:mt-0 last:mb-0">
        {renderInlineMarkdown(trimmed)}
      </p>
    );
  });

  flushList();

  return <div className="assistant-message-format">{blocks}</div>;
};

const looksLikeGuidedTourRequest = (text) =>
  /\b(guide|guided|walk\s*me|tour|help\s+me\s+(submit|start|run)|show\s+me\s+how)\b/i.test(
    String(text || "")
  );

const looksLikeDemoRequest = (text) =>
  /\b(demo|demonstration|example run|sample run|show me (?:a )?run)\b/i.test(
    String(text || "")
  );

const DEMO_PROFILES = [
  ["wgs:short", "WGS · Short"],
  ["wgs:long", "WGS · Long"],
  ["wgs:hybrid", "WGS · Hybrid"],
  ["metagenomics:short", "Metagenomics · Short"],
  ["metagenomics:long", "Metagenomics · Long"],
  ["metagenomics:hybrid", "Metagenomics · Hybrid"],
];

const LEGACY_STORAGE_KEY = "genoverse_assistant_history_v1";
const MAX_MESSAGES_PER_SESSION = 24;
const MAX_CONTEXT_MESSAGES = 6;
const MIN_THINKING_MS = 1000;
const defaultMessages = [
  createMessage(
    "assistant",
    "Hi. I can help with GENOCULAR profiles, uploads, job failures, logs, QC, assemblies, MAGs, annotations, and result files."
  ),
];

const AssistantChat = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const guidedTour = useGuidedTour();
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(defaultMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const requestRef = useRef(null);
  const sessionVersionRef = useRef(0);
  const currentJobId = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || "");
      return params.get("job_id") || params.get("open_job") || "";
    } catch {
      return "";
    }
  }, [location.search]);
  const isAnalysisContext = location.pathname === "/analysis" && Boolean(currentJobId);
  const scopedGreeting = () =>
    createMessage(
      "assistant",
      isAnalysisContext
        ? "Ask me about this run’s quality, assembly, taxonomy, abundance, annotations, or limitations. Answers are grounded in this job’s generated result data."
        : defaultMessages[0].text,
      { greeting: true }
    );

  const waitForMinimumThinking = async (startedAt) => {
    const elapsed = performance.now() - startedAt;
    const remaining = MIN_THINKING_MS - elapsed;
    if (remaining > 0) {
      await new Promise(resolve => window.setTimeout(resolve, remaining));
    }
  };

  const buildRequestContext = () =>
    messages
      .filter((message) => message?.role && message?.text)
      .filter(
        (message) =>
          !message.greeting &&
          !(message.role === "assistant" && defaultMessages.some((defaultMessage) => defaultMessage.text === message.text))
      )
      .slice(-MAX_CONTEXT_MESSAGES)
      .map((message) => ({
        role: message.role,
        text: message.text,
      }));

  // Scroll to bottom on new messages / open
  useEffect(() => {
    if (!isOpen) return;
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isOpen]);

  // Chat is intentionally temporary: do not persist or share across accounts.
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setMessages([scopedGreeting()]);
    setInput("");
  }, [user?.uid]);

  useEffect(() => {
    sessionVersionRef.current += 1;
    requestRef.current?.abort?.();
    requestRef.current = null;
    setMessages([scopedGreeting()]);
    setInput("");
    setIsLoading(false);
  }, [currentJobId, isAnalysisContext]);

  // Focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

  const clearChatSession = () => {
    sessionVersionRef.current += 1;
    requestRef.current?.abort?.();
    requestRef.current = null;
    fetch("/api/chat/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
    }).catch(() => {});
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
    setMessages([scopedGreeting()]);
    setInput("");
    setIsLoading(false);
  };

  const closeAssistant = () => {
    clearChatSession();
    setIsOpen(false);
  };

  const resetChat = clearChatSession;

  const toggleOpen = () => {
    if (isOpen) {
      closeAssistant();
    } else {
      setIsOpen(true);
    }
  };

  // Close with ESC; toggle with Cmd/Ctrl + K.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape" && isOpen) {
        closeAssistant();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggleOpen();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

	  const appendMessage = (role, text, meta = {}) => {
	    setMessages((prev) =>
	      [...prev, createMessage(role, text, meta)].slice(-MAX_MESSAGES_PER_SESSION)
	    );
	  };

  const showEvidence = (evidence) => {
    const renderer = String(evidence?.renderer || "").trim();
    if (!renderer) return;
    const escaped = window.CSS?.escape ? window.CSS.escape(renderer) : renderer.replace(/[^a-zA-Z0-9_-]/g, "");
    const target = document.querySelector(`[data-analysis-renderer="${escaped}"]`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.animate?.(
      [
        { boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
        { boxShadow: "0 0 0 5px rgba(14,165,233,0.28)" },
        { boxShadow: "0 0 0 0 rgba(14,165,233,0)" },
      ],
      { duration: 1400, easing: "ease-out" }
    );
  };

  const startGuidedTour = () => {
    guidedTour.start();
    navigate("/run");
    setIsOpen(true);
    appendMessage(
      "assistant",
      "Guided mode is on. I moved you to job submission. First choose the analysis type: WGS or Metagenomics."
    );
  };

  const startDemoRun = (profile) => {
    if (!DEMO_PROFILES.some(([key]) => key === profile)) return;
    const destination = `/run?demo_profile=${encodeURIComponent(profile)}`;
    appendMessage("assistant", "Opening the selected demonstration run.");
    navigate(destination);
  };

  const sendMessage = async (overrideText) => {
    const raw = typeof overrideText === "string" ? overrideText : input;
    const trimmed = raw.trim();
    if (!trimmed || isLoading) return;

    appendMessage("user", trimmed);
    setInput("");

    if (looksLikeDemoRequest(trimmed)) {
      appendMessage(
        "assistant",
        "Choose the pipeline profile you want to see.",
        { demoChooser: true }
      );
      return;
    }

    if (looksLikeGuidedTourRequest(trimmed)) {
      startGuidedTour();
      return;
    }

    setIsLoading(true);
    const startedAt = performance.now();
    const requestVersion = sessionVersionRef.current;
    const controller = new AbortController();
    let timeout = null;
    requestRef.current = controller;

    try {
      timeout = window.setTimeout(() => controller.abort(), isAnalysisContext ? 130_000 : 45_000);

      const endpoint = isAnalysisContext
        ? `/jobs/${encodeURIComponent(currentJobId)}/analysis/chat`
        : "/chat";
      const data = await apiJson(endpoint, {
        method: "POST",
        body: JSON.stringify({
          message: trimmed,
          page: `${location.pathname}${location.search || ""}`,
          history: buildRequestContext(),
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      if (requestVersion !== sessionVersionRef.current) return;
      await waitForMinimumThinking(startedAt);
      if (requestVersion !== sessionVersionRef.current) return;
      const reply = data?.reply || "I am not sure how to answer that from the available documentation.";
      appendMessage("assistant", reply, {
        caveat: data?.caveat || "",
        evidence: Array.isArray(data?.evidence) ? data.evidence : [],
        grounded: Boolean(data?.grounded),
      });
    } catch (err) {
      console.error("assistant fetch error", err);
      if (requestVersion !== sessionVersionRef.current) return;
      await waitForMinimumThinking(startedAt);
      if (requestVersion !== sessionVersionRef.current) return;
      appendMessage(
        "assistant",
        err?.name === "AbortError"
          ? "The assistant is taking too long to respond. Try a shorter question, or ask about one specific profile, step, or job error."
          : "Sorry, I couldn’t reach the assistant backend right now. Please try again in a moment."
      );
    } finally {
      if (timeout) window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
      }
      if (requestVersion === sessionVersionRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestions = isAnalysisContext
    ? ["Summarize this run", "What needs attention?", "Explain the quality results", "Which result supports that?"]
    : ["Guide me", "Show me a demo run", "Choose a profile", "Job is slow", "Job failed"];

  const showSuggestions = messages.length <= 1 && !isLoading;
	  const guidedStepCopy = {
	    analysis: "Choose the analysis type. You can click WGS/Metagenomics here or on the page.",
	    readMode: "Choose the read mode for your data.",
	    jobName: "Give this run a clear job name. Use a sample ID or project label you can recognize later.",
	    upload: "Upload the required FASTQ files in the highlighted boxes.",
	    submit: "Review the selections, then run the pipeline when ready.",
	  };

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        onClick={toggleOpen}
        className="fixed bottom-6 right-6 z-40 inline-flex h-[52px] items-center gap-2 rounded-full border border-white/60 bg-slate-950 px-4 py-3 text-sm font-medium text-white shadow-[0_18px_40px_-18px_rgba(15,23,42,0.8)] transition hover:-translate-y-0.5 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sky-400"
        aria-label={isOpen ? "Close GENOCULAR help" : "Open GENOCULAR help"}
      >
        {isOpen ? (
          <X className="h-5 w-5" aria-hidden="true" />
        ) : (
          <MessageCircle className="h-5 w-5" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">Help</span>
      </button>

      {/* Chat dialog */}
      <AnimatePresence>
        {isOpen && (
		          <Motion.section
		            className={[
		              "genocular-assistant fixed bottom-24 right-4 z-40 flex w-[calc(100vw-2rem)] max-w-[400px] flex-col overflow-hidden rounded-[1.35rem] border shadow-[0_28px_80px_-34px_rgba(15,23,42,0.65)] backdrop-blur-xl transition-[background-color,border-color,box-shadow,backdrop-filter] duration-300 ease-out sm:right-6",
	              guidedTour.active
	                ? "border-white/40 bg-white/38 shadow-[0_32px_90px_-38px_rgba(15,23,42,0.72),inset_0_1px_0_rgba(255,255,255,0.62)] backdrop-blur-2xl"
	                : "border-white/70 bg-white/95",
	              isExpanded ? "h-[76vh] max-h-[740px]" : "h-[520px]",
	            ].join(" ")}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="assistant-title"
          >
            <div className="assistant-wave-layer" aria-hidden="true" />

            {/* Header */}
            <div className="relative flex items-center justify-between px-4 py-3.5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-slate-950 text-white shadow-sm">
                  <BotMessageSquare className="h-[18px] w-[18px]" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="assistant-title"
                    className="truncate text-sm font-semibold text-slate-950"
                  >
                    GENOCULAR Assistant
                  </h2>
                  <p className="truncate text-xs text-slate-500">
                    {isAnalysisContext ? "Grounded interpretation of this job" : "Pipeline help and result guidance"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-white/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                  aria-label={isExpanded ? "Collapse" : "Expand"}
                >
                  {isExpanded ? (
                    <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={resetChat}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-white/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                  aria-label="Clear chat"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={closeAssistant}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-white/80 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Messages area */}
	            <div
		              className={[
		                "genocular-assistant-messages relative flex-1 space-y-3 overflow-y-auto border-y px-4 py-4 text-sm transition-[background-color,border-color] duration-300 ease-out",
	                guidedTour.active
	                  ? "border-white/24 bg-white/12"
	                  : "border-slate-100/80 bg-slate-50/70",
	              ].join(" ")}
	              role="log"
              aria-live="polite"
              aria-label="Conversation with GENOCULAR assistant"
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
	                  <div
	                    className={[
	                      "genocular-assistant-bubble max-w-[86%] whitespace-pre-line px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm",
	                      m.role === "user"
	                        ? "genocular-assistant-bubble-user rounded-2xl rounded-br-md bg-slate-950 text-white shadow-slate-950/10"
	                        : m.role === "system"
	                        ? "genocular-assistant-bubble-system rounded-2xl rounded-bl-md border border-amber-100 bg-amber-50 text-amber-800"
	                        : "genocular-assistant-bubble-assistant rounded-2xl rounded-bl-md border border-white bg-white text-slate-800",
                    ].join(" ")}
                  >
                    <FormattedMessage text={m.text} isUser={m.role === "user"} />
                    {m.role === "assistant" && m.demoChooser && (
                      <div className="mt-3 grid grid-cols-2 gap-1.5 border-t border-slate-100 pt-3">
                        {DEMO_PROFILES.map(([profile, label]) => (
                          <button
                            key={profile}
                            type="button"
                            onClick={() => startDemoRun(profile)}
                            className="rounded-xl border border-sky-200 bg-sky-50 px-2 py-2 text-left text-[11px] font-semibold leading-tight text-sky-900 transition hover:border-sky-300 hover:bg-sky-100"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    )}
                    {m.role === "assistant" && m.caveat && (
                      <p className="mt-2 border-t border-slate-100 pt-2 text-[11px] leading-4 text-slate-500">
                        {m.caveat}
                      </p>
                    )}
                    {m.role === "assistant" && Array.isArray(m.evidence) && m.evidence.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5 border-t border-slate-100 pt-2">
                        {m.evidence.map((evidence) => (
                          <button
                            key={evidence.id}
                            type="button"
                            onClick={() => showEvidence(evidence)}
                            className="max-w-full truncate rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100"
                            title={`${evidence.title || "Result"}: ${evidence.label || evidence.id}`}
                          >
                            View {evidence.title || "evidence"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
	                  <div className="genocular-assistant-loader flex items-center gap-1 rounded-2xl rounded-bl-md border border-white bg-white px-3.5 py-3 shadow-sm">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-sky-400 [animation-delay:-0.2s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-teal-400 [animation-delay:-0.1s]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                  </div>
                </div>
              )}

              {showSuggestions && (
	                <div className="genocular-assistant-suggestions flex flex-wrap items-start gap-2 pt-1">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => sendMessage(s)}
                      className="rounded-full border border-white bg-white/90 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:-translate-y-0.5 hover:text-slate-950"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <div ref={bottomRef} />
            </div>

	            {guidedTour.active && (
		              <div className="genocular-guided-panel-shell border-t border-white/24 bg-white/12 px-3 py-3 backdrop-blur-xl transition-[background-color,border-color] duration-300 ease-out">
		                <div className="genocular-guided-panel rounded-2xl border border-sky-100/70 bg-sky-50/80 p-3 shadow-[0_0_0_1px_rgba(255,255,255,0.72),0_16px_42px_-30px_rgba(2,132,199,0.9)] transition-[background-color,border-color,box-shadow] duration-300 ease-out">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-slate-900">
                        Guided mode · Step {guidedTour.stepNumber}/{guidedTour.totalSteps}
                      </div>
                      <div className="mt-0.5 text-xs leading-relaxed text-slate-600">
                        {guidedStepCopy[guidedTour.step]}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={guidedTour.stop}
	                      className="genocular-guided-exit rounded-full px-2 py-1 text-[11px] text-slate-500 hover:bg-white hover:text-slate-800"
                    >
                      Exit
                    </button>
                  </div>

                  {guidedTour.step === "analysis" && (
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {[
                        ["wgs", "WGS"],
                        ["metagenomics", "Metagenomics"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => guidedTour.chooseAnalysis(key)}
	                          className={[
	                            "genocular-guided-choice rounded-xl border px-3 py-2 text-xs font-semibold transition",
	                            guidedTour.analysisType === key
	                              ? "border-sky-300 bg-white text-sky-800 shadow-sm"
	                              : "border-white/70 bg-white/70 text-slate-600 hover:text-slate-900",
	                          ].join(" ")}
	                          data-active={guidedTour.analysisType === key ? "true" : "false"}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {guidedTour.step === "readMode" && (
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {[
                        ["short", "Short"],
                        ["long", "Long"],
                        ["hybrid", "Hybrid"],
                      ].map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => guidedTour.chooseReadMode(key)}
	                          className={[
	                            "genocular-guided-choice rounded-xl border px-2 py-2 text-xs font-semibold transition",
	                            guidedTour.readMode === key
	                              ? "border-emerald-300 bg-white text-emerald-800 shadow-sm"
	                              : "border-white/70 bg-white/70 text-slate-600 hover:text-slate-900",
	                          ].join(" ")}
	                          data-active={guidedTour.readMode === key ? "true" : "false"}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="mt-3 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={guidedTour.back}
                      disabled={guidedTour.isFirstStep}
	                      className="genocular-guided-nav rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={guidedTour.next}
                      disabled={guidedTour.isLastStep}
	                      className="genocular-guided-next rounded-full bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}

	            {/* Input */}
	            <div
		              className={[
		                "genocular-assistant-input-shell relative px-3 py-3 transition-colors duration-300 ease-out",
	                guidedTour.active ? "bg-white/14 backdrop-blur-xl" : "bg-white",
	              ].join(" ")}
	            >
	              <div
	                className={[
		                  "flex items-end gap-2 rounded-2xl border p-1.5 transition-[background-color,border-color,box-shadow] duration-300 ease-out focus-within:border-sky-200",
		                  "genocular-assistant-input-box",
	                  guidedTour.active
	                    ? "border-white/32 bg-white/22 shadow-[inset_0_1px_0_rgba(255,255,255,0.42)] backdrop-blur-xl"
	                    : "border-slate-200/80 bg-slate-50/80",
	                ].join(" ")}
	              >
                <label className="sr-only" htmlFor="assistant-input">
                  Ask the GENOCULAR assistant
                </label>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  rows={1}
                  className="max-h-24 min-h-[38px] flex-1 resize-none border-0 bg-transparent px-2.5 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                  placeholder={isAnalysisContext ? "Ask about this job’s results..." : "Ask about uploads, jobs, QC..."}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-950 text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </Motion.section>
        )}
      </AnimatePresence>
    </>
  );
};

export default AssistantChat;
