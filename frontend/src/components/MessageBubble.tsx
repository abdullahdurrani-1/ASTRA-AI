import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, Citation, CitationTarget } from "../types/api";
import { IconAlert, IconBook, IconCheck, IconCopy, IconSpeaker, IconStop } from "./icons";

function pages(c: Citation) {
  if (c.page_start == null) return "no page numbers (text file)";
  return c.page_start === c.page_end ? `page ${c.page_start}` : `pages ${c.page_start}–${c.page_end}`;
}

interface Props {
  message: ChatMessage;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onAsk: (text: string) => void;
  onOpenCitation?: (target: CitationTarget) => void;
}

const NON_GROUNDED = new Set(["conversational", "needs_documents", "general"]);

/** Reveals `text` progressively (ChatGPT-style) and reports when it has fully caught up. */
function useTypewriter(text: string, enabled: boolean): string {
  const [shown, setShown] = useState(enabled ? "" : text);
  const shownRef = useRef(shown);
  useEffect(() => {
    if (!enabled || typeof requestAnimationFrame === "undefined") {
      shownRef.current = text;
      setShown(text);
      return;
    }
    if (!text.startsWith(shownRef.current)) {
      // Keep whatever still matches (e.g. the final answer was only trimmed); restart otherwise.
      let i = 0;
      while (i < text.length && i < shownRef.current.length && text[i] === shownRef.current[i]) i++;
      shownRef.current = text.slice(0, i);
      setShown(shownRef.current);
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      const behind = text.length - shownRef.current.length;
      if (behind > 0) {
        // Faster when far behind so a burst never lags; never slower than a brisk typist.
        const rate = Math.max(60, behind * 4); // chars per second
        const step = Math.max(1, Math.round((rate * elapsed) / 1000));
        shownRef.current = text.slice(0, shownRef.current.length + step);
        setShown(shownRef.current);
      }
      if (shownRef.current.length < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, enabled]);
  return enabled && typeof requestAnimationFrame !== "undefined" ? shown : text;
}

export function MessageBubble({ message, playing, onPlay, onStop, onAsk, onOpenCitation }: Props) {
  const [copied, setCopied] = useState(false);
  const animate =
    message.role === "assistant" &&
    !message.id.startsWith("hist-") &&
    !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const shown = useTypewriter(message.content, animate);
  const typing = message.streaming || shown.length < message.content.length;
  const isUser = message.role === "user";
  const rtl = message.language === "ur";
  const lang = rtl ? "ur" : "en";
  const dir = rtl ? "rtl" : "ltr";
  // Conversational replies never show sources, evidence or the not-enough-evidence state.
  const grounded = !NON_GROUNDED.has(message.status ?? "");

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked: nothing to do */
    }
  }

  if (isUser) {
    return (
      <li className="animate-rise flex justify-end">
        <article
          aria-label="Your question"
          className="max-w-[85%] rounded-2xl rounded-ee-md border border-[var(--glass-border)] bg-user-bubble px-4 py-2.5 text-ink"
        >
          <p lang={lang} dir={dir} className="whitespace-pre-wrap text-[15px] leading-relaxed">
            {message.content}
          </p>
        </article>
      </li>
    );
  }

  const boxed = ["insufficient_evidence", "error", "general"].includes(message.status ?? "");
  const tone =
    message.status === "insufficient_evidence"
      ? "border-warn/40 bg-warn-soft"
      : message.status === "error"
        ? "border-danger/40 bg-danger-soft"
        : message.status === "general"
          ? "border-violet/40 bg-violet-soft"
          : "border-transparent";

  return (
    <li className="animate-rise flex gap-3">
      <div
        aria-hidden="true"
        className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full brand-mark text-[11px] font-bold"
      >
        A
      </div>
      <article
        aria-label="Astra's answer"
        className={`min-w-0 flex-1 rounded-xl border ${tone} ${boxed ? "px-4 py-3" : "py-1"}`}
      >
        {message.mock && grounded && (
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-warn">
            Mock mode — not a real model answer
          </p>
        )}
        {message.status === "insufficient_evidence" && (
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-warn">
            <IconAlert width={14} height={14} /> Not enough evidence
          </p>
        )}
        {message.status === "general" && (
          <p className="mb-1 text-xs font-semibold text-violet">
            General answer, not from your documents
          </p>
        )}

        {message.searched_question && (
          <p className="mb-2 text-xs text-ink-3">
            Searched for: <span dir="auto" className="text-ink-2">{message.searched_question}</span>
          </p>
        )}
        <div lang={lang} dir={dir} className={`prose-astra text-ink ${typing ? "astra-typing" : ""}`}>
          {/* Markdown is rendered without raw HTML, so model output cannot inject markup. */}
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{shown}</ReactMarkdown>
        </div>

        {!typing && grounded && message.citations.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
              Sources
            </p>
            <div className="space-y-1.5">
              {message.citations.map((c, i) => (
                <details
                  key={c.chunk_id}
                  className="group glass rounded-lg transition-colors hover:border-accent/30 open:border-accent/35"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-ink-2 hover:text-ink">
                    <span className="grid h-5 min-w-5 place-items-center rounded bg-accent-soft px-1 font-semibold text-accent">
                      {i + 1}
                    </span>
                    <span className="truncate">
                      {c.document_name} · {pages(c)}
                      {c.heading ? ` · ${c.heading}` : ""}
                    </span>
                  </summary>
                  <div className="border-t border-line px-3 py-2.5">
                    <blockquote dir="auto" className="text-xs leading-relaxed text-ink-2">
                      {c.excerpt}
                    </blockquote>
                    {onOpenCitation && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenCitation({ documentId: c.document_id, page: c.page_start, citation: c })
                        }
                        className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
                      >
                        <IconBook width={14} height={14} />
                        {c.page_start != null ? `Open page ${c.page_start} in reader` : "Open in reader"}
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}

        {!typing && message.suggestions && message.suggestions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Suggested questions">
            {message.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                dir="auto"
                onClick={() => onAsk(s)}
                className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-accent"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {!typing && message.status !== "error" && (
          <div className="mt-2 flex gap-1 text-ink-3">
            <button
              type="button"
              onClick={playing ? onStop : onPlay}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-surface-hover hover:text-ink"
              aria-label={playing ? "Stop reading aloud" : "Read answer aloud"}
            >
              {playing ? <IconStop width={14} height={14} /> : <IconSpeaker width={14} height={14} />}
              {playing ? "Stop" : "Listen"}
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-surface-hover hover:text-ink"
              aria-label="Copy answer"
            >
              {copied ? <IconCheck width={14} height={14} /> : <IconCopy width={14} height={14} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        )}
      </article>
    </li>
  );
}
