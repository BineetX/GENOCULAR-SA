import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X, Send, Sparkles, Trash2, Maximize2 } from "lucide-react";

const createMessage = (role, text) => ({
  id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  role,
  text,
  ts: Date.now(),
});

const STORAGE_KEY = "genoverse_assistant_history_v1";
const defaultMessages = [
  createMessage(
    "assistant",
    "Hi. I can help with GENOCULAR profiles, uploads, job failures, logs, QC, assemblies, MAGs, annotations, and result files."
  ),
];

const loadHistory = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const saveHistory = (messages) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // ignore quota errors
  }
};

const AssistantChat = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    const stored = loadHistory();
    if (stored && stored.length > 0) return stored;
    return defaultMessages;
  });
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const currentJobId = useMemo(() => {
    try {
      const params = new URLSearchParams(location.search || "");
      return params.get("job_id") || params.get("open_job") || "";
    } catch {
      return "";
    }
  }, [location.search]);

  // Scroll to bottom on new messages / open
  useEffect(() => {
    if (!isOpen) return;
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages, isOpen]);

  // Persist chat history
  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  // Focus input on open
  useEffect(() => {
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 120);
    }
  }, [isOpen]);

  // Close with ESC
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  // Toggle with Cmd/Ctrl + K
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleOpen = () => setIsOpen((prev) => !prev);
  const resetChat = () => {
    setMessages(defaultMessages);
    setInput("");
  };

  const appendMessage = (role, text) => {
    setMessages((prev) => [...prev, createMessage(role, text)]);
  };

  const sendMessage = async (overrideText) => {
    const raw = typeof overrideText === "string" ? overrideText : input;
    const trimmed = raw.trim();
    if (!trimmed || isLoading) return;

    appendMessage("user", trimmed);
    setInput("");
    setIsLoading(true);

    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45_000);
      const historyForBackend = messages
        .map((m) => ({
          role: m.role, // "user" or "assistant"
          text: m.text,
        }))
        .slice(-6);

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmed,
          page: `${location.pathname}${location.search || ""}`,
          job_id: currentJobId,
          history: historyForBackend,
        }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);

      if (!res.ok) {
        console.error("assistant HTTP error", res.status, await res.text());
        appendMessage(
          "assistant",
          "Sorry, I couldn’t reach the assistant backend right now. Please try again in a moment."
        );
      } else {
        const data = await res.json().catch(() => ({}));
        const reply =
          data?.reply ||
          "I am not sure how to answer that from the available documentation.";
        appendMessage("assistant", reply);
      }
    } catch (err) {
      console.error("assistant fetch error", err);
      appendMessage(
        "assistant",
        err?.name === "AbortError"
          ? "The assistant is taking too long to respond. Try a shorter question, or ask about one specific profile, step, or job error."
          : "Sorry, I couldn’t reach the assistant backend right now. Please try again in a moment."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const suggestions = [
    "Which profile should I use?",
    "Why is my job slow?",
    "What does this pipeline output?",
    "My job failed — what should I check?",
  ];
  const timeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
    []
  );

  return (
    <>
      {/* Floating trigger button */}
      <button
        type="button"
        onClick={toggleOpen}
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-slate-900/95 px-4 py-3 text-xs font-semibold text-white shadow-lg shadow-slate-900/30 ring-1 ring-white/10 transition hover:scale-[1.03] hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        aria-label={isOpen ? "Close GENOCULAR assistant" : "Open GENOCULAR assistant"}
      >
        <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 text-white">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-slate-900" />
        </span>
        <span className="hidden sm:inline">GENOCULAR HELP</span>
        <span className="text-[10px] text-slate-300">Ctrl + K</span>
      </button>

      {/* Chat dialog */}
      <AnimatePresence>
        {isOpen && (
          <motion.section
            className={[
              "fixed bottom-20 right-6 z-40 flex w-[92vw] max-w-sm flex-col overflow-hidden rounded-3xl border border-slate-200/60 bg-white/80 shadow-2xl backdrop-blur-xl",
              isExpanded ? "h-[70vh] max-h-[70vh]" : "h-[440px]",
            ].join(" ")}
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 26 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="assistant-title"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200/70 bg-gradient-to-r from-slate-50 via-white to-slate-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-emerald-500 text-white shadow-sm">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </div>
                <div>
                  <h2
                    id="assistant-title"
                    className="text-sm font-semibold text-slate-900"
                  >
                    GENOCULAR Help
                  </h2>
                  <p className="text-[11px] text-slate-500">
                    Pipeline help for profiles, jobs, QC, logs, and results
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setIsExpanded((v) => !v)}
                  className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  aria-label={isExpanded ? "Collapse assistant" : "Expand assistant"}
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={resetChat}
                  className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  aria-label="Clear chat"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-full p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
                  aria-label="Close assistant"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* Messages area */}
            <div
              className="flex-1 space-y-2 overflow-y-auto px-3 py-3 text-sm"
              role="log"
              aria-live="polite"
              aria-label="Conversation with GENOCULAR assistant"
            >
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    className={`flex ${
                      m.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div className="max-w-[82%]">
                      <div
                        className={[
                          "whitespace-pre-line rounded-2xl px-3 py-2 leading-snug",
                          m.role === "user"
                            ? "bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-sm"
                            : m.role === "system"
                            ? "bg-amber-500/10 text-amber-800 border border-amber-400/40"
                            : "bg-white text-slate-900 border border-slate-200 shadow-sm",
                        ].join(" ")}
                      >
                        {m.text}
                      </div>
                      <div
                        className={`mt-1 text-[10px] ${
                          m.role === "user" ? "text-slate-400 text-right" : "text-slate-400"
                        }`}
                      >
                        {timeFmt.format(new Date(m.ts))}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isLoading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-500">
                    <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                    <span className="inline-flex h-1.5 w-1.5 animate-[pulse_1s_ease-in-out_0.2s_infinite] rounded-full bg-slate-400" />
                    <span className="inline-flex h-1.5 w-1.5 animate-[pulse_1s_ease-in-out_0.4s_infinite] rounded-full bg-slate-400" />
                    <span className="text-xs text-slate-400">Checking pipeline docs…</span>
                  </div>
                </div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Suggestions + Input */}
            <div className="border-t border-slate-200/70 bg-white/90 px-3 py-2">
              {/* Quick suggestions */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={isLoading}
                    onClick={() => {
                      setInput(s);
                      sendMessage(s);
                    }}
                    className="flex-1 min-w-[40%] rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-300"
                  >
                    {s}
                  </button>
                ))}
              </div>

              <div className="flex items-end gap-2">
                <label className="sr-only" htmlFor="assistant-input">
                  Ask the GENOCULAR assistant
                </label>
                <textarea
                  id="assistant-input"
                  ref={inputRef}
                  className="max-h-24 min-h-[40px] flex-1 resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="Ask about a profile, step, error, output, or job result…"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type="button"
                  onClick={() => sendMessage()}
                  disabled={isLoading || !input.trim()}
                  className="mb-1 inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                  aria-label="Send message"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <p className="mt-1 text-[10px] text-slate-400">
                Answers are based on GENOCULAR’s documentation. Always verify critical results.
              </p>
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  );
};

export default AssistantChat;
