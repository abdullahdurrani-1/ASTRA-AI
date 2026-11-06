import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ChatSession } from "../hooks/useChatSession";
import { useRecorder } from "../hooks/useRecorder";
import { useSpeech } from "../hooks/useSpeech";
import { api, ApiError } from "../services/api";
import type { AnswerLanguage, CitationTarget } from "../types/api";
import { IconMic, IconPaperclip, IconSend, IconSparkle, IconStop } from "./icons";
import { MessageBubble } from "./MessageBubble";

interface Props {
  session: ChatSession;
  documentIds: string[];
  sttEnabled: boolean;
  ttsEnabled: boolean;
  online: boolean;
  allowedExtensions: string[];
  onAttach?: (file: File) => Promise<unknown>;
  onOpenCitation?: (target: CitationTarget) => void;
  /** Rendered above the composer (e.g. the source picker). */
  toolbar?: ReactNode;
  /** Narrow layout for the research side panel. */
  compact?: boolean;
}

const PROMPTS: { title: string; text: string; needsDoc: boolean }[] = [
  { title: "Summarize a document", text: "Summarize the main points of this document.", needsDoc: true },
  { title: "Find the key arguments", text: "What are the key arguments the author makes?", needsDoc: true },
  {
    title: "Explain a concept",
    text: "Explain the most important concept in this document in simple terms.",
    needsDoc: true,
  },
  { title: "What can you do?", text: "What can you do?", needsDoc: false },
];

const CARD =
  "glass-card rounded-xl px-4 py-3 text-start disabled:cursor-not-allowed disabled:opacity-45";

export function ChatPanel({
  session,
  documentIds,
  sttEnabled,
  ttsEnabled,
  online,
  allowedExtensions,
  onAttach,
  onOpenCitation,
  toolbar,
  compact = false,
}: Props) {
  const { messages, pending, error, lastFailed, language, setLanguage } = session;
  const [question, setQuestion] = useState("");
  const [transcribing, setTranscribing] = useState(false);
  const [attachMsg, setAttachMsg] = useState<string | null>(null);
  const recorder = useRecorder();
  const speech = useSpeech(ttsEnabled);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const noDocs = documentIds.length === 0;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  // Auto-grow the composer up to a limit.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [question]);

  // A failed question goes back into the composer so it isn't lost.
  useEffect(() => {
    if (lastFailed) setQuestion(lastFailed);
  }, [lastFailed]);

  function send(text: string) {
    if (!text.trim() || pending) return;
    setQuestion("");
    void session.send(text, documentIds);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    send(question);
  }

  async function toggleMic() {
    if (recorder.state === "recording") {
      const blob = await recorder.stop();
      if (!blob) {
        recorder.setError("No audio was captured. Please try again.");
        return;
      }
      setTranscribing(true);
      try {
        const { text } = await api.transcribe(blob);
        setQuestion((q) => (q ? `${q} ${text}` : text));
      } catch (e) {
        recorder.setError(e instanceof ApiError ? e.message : "Transcription failed.");
      } finally {
        setTranscribing(false);
      }
    } else {
      await recorder.start();
    }
  }

  async function attach(file: File | undefined) {
    if (!file || !onAttach) return;
    setAttachMsg(null);
    try {
      await onAttach(file);
      setAttachMsg(`“${file.name}” uploaded. It will be selected once processing finishes.`);
    } catch (e) {
      setAttachMsg(e instanceof ApiError ? e.message : "Upload failed.");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  const micAvailable = sttEnabled && recorder.supported;
  const recording = recorder.state === "recording";
  const shownError = error ?? recorder.error ?? speech.error;

  return (
    <section aria-label="Chat" className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        <div className={`mx-auto w-full ${compact ? "px-4" : "max-w-3xl px-4 sm:px-6"} py-6`}>
          {messages.length === 0 ? (
            <div className={`relative ${compact ? "py-4" : "py-10 sm:py-16"} animate-rise`}>
              {!compact && (
                <div aria-hidden="true" className="ambient-glow pointer-events-none absolute -top-10 start-1/2 -z-10 h-80 w-[36rem] -translate-x-1/2 rtl:translate-x-1/2" />
              )}
              <div className="glass mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs text-ink-2">
                <IconSparkle width={14} height={14} className="text-accent" />
                Grounded answers with page citations
              </div>
              <h2
                className={`${compact ? "text-xl" : "text-2xl sm:text-3xl"} font-semibold tracking-tight text-ink`}
              >
                {compact ? (
                  "Ask about this document"
                ) : (
                  <>
                    Your documents.{" "}
                    <span className="bg-gradient-to-r from-accent to-violet bg-clip-text text-transparent">
                      Your questions.
                    </span>
                  </>
                )}
              </h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-2">
                {noDocs
                  ? "Upload or select a ready document to ask about it. You can also just say hello, in English or Urdu."
                  : "Ask anything about the selected documents. Every answer shows the passages it came from."}
              </p>
              <div className={`mt-6 grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`} aria-label="Quick start">
                {PROMPTS.map((p) => (
                  <button
                    key={p.title}
                    type="button"
                    onClick={() => send(p.text)}
                    disabled={!online || pending || (p.needsDoc && noDocs)}
                    title={p.needsDoc && noDocs ? "Select a ready document first" : undefined}
                    className={CARD}
                  >
                    <span className="block text-sm font-medium text-ink">{p.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-3">{p.text}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => send("السلام علیکم")}
                  disabled={!online || pending}
                  aria-label="السلام علیکم"
                  className={CARD}
                >
                  <span lang="ur" dir="rtl" className="block text-sm text-ink">
                    السلام علیکم
                  </span>
                  <span className="block text-xs text-ink-3">Greet Astra in Urdu</span>
                </button>
              </div>
            </div>
          ) : (
            <ul className="space-y-6">
              {messages.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  playing={speech.playingId === m.id}
                  onPlay={() => void speech.play(m.id, m.content, m.language)}
                  onStop={speech.stop}
                  onAsk={send}
                  onOpenCitation={onOpenCitation}
                />
              ))}
              {pending && !messages[messages.length - 1]?.streaming && (
                <li className="flex gap-3" aria-label="Astra is thinking">
                  <div
                    aria-hidden="true"
                    className="mt-1 h-7 w-7 shrink-0 rounded-full brand-mark opacity-80"
                  />
                  <div className="flex items-center gap-1 py-3 text-ink-3">
                    <span className="sr-only">Astra is thinking…</span>
                    {[0, 1, 2].map((i) => (
                      <span
                        key={i}
                        className="typing-dot h-1.5 w-1.5 rounded-full bg-current"
                        style={{ animationDelay: `${i * 0.15}s` }}
                      />
                    ))}
                  </div>
                </li>
              )}
            </ul>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className={`mx-auto w-full ${compact ? "px-3" : "max-w-3xl px-4 sm:px-6"} pb-4`}>
        {shownError && (
          <div
            role="alert"
            className="mb-2 flex items-center gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            <span className="flex-1">{shownError}</span>
            {error && lastFailed && (
              <button
                type="button"
                onClick={() => send(lastFailed)}
                className="rounded px-2 py-0.5 font-medium underline"
              >
                Retry
              </button>
            )}
          </div>
        )}
        {attachMsg && (
          <p role="status" className="mb-2 text-xs text-ink-2">
            {attachMsg}
          </p>
        )}
        {!online && (
          <p role="status" className="mb-2 text-sm text-warn">
            You're offline. Reconnect to ask questions.
          </p>
        )}
        {toolbar}
        <form
          onSubmit={onSubmit}
          className="glass-composer rounded-2xl p-2"
        >
          <label htmlFor="question" className="sr-only">
            Your question
          </label>
          <textarea
            ref={inputRef}
            id="question"
            rows={1}
            value={question}
            dir="auto"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(question);
              }
            }}
            placeholder="Ask a question… / سوال پوچھیں"
            disabled={!online}
            maxLength={2000}
            className="block max-h-[200px] w-full resize-none bg-transparent px-2.5 py-2 text-[15px] text-ink placeholder:text-ink-3 focus:outline-none disabled:opacity-50"
          />
          <div className="mt-1 flex items-center gap-1">
            {onAttach && (
              <>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={!online}
                  aria-label="Attach a document"
                  title={`Attach ${allowedExtensions.join(", ")}`}
                  className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface-hover hover:text-ink disabled:opacity-40"
                >
                  <IconPaperclip />
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept={allowedExtensions.join(",")}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(e) => void attach(e.target.files?.[0])}
                />
              </>
            )}
            <label htmlFor="answer-lang" className="sr-only">
              Answer language
            </label>
            <select
              id="answer-lang"
              value={language}
              onChange={(e) => setLanguage(e.target.value as AnswerLanguage)}
              className="h-9 rounded-lg bg-transparent px-2 text-xs text-ink-2 hover:bg-white/[0.05] focus:outline-none [&>option]:bg-surface"
            >
              <option value="auto">Auto language</option>
              <option value="en">English</option>
              <option value="ur">اردو</option>
            </select>
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void toggleMic()}
              disabled={!micAvailable || transcribing || !online}
              title={
                micAvailable ? undefined : "Voice input is not enabled on this server (typed chat still works)."
              }
              aria-label={recording ? "Stop recording" : "Ask by voice"}
              aria-pressed={recording}
              className={`grid h-9 w-9 place-items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-35 ${
                recording ? "bg-danger-soft text-danger" : "text-ink-2 hover:bg-surface-hover hover:text-ink"
              }`}
            >
              {transcribing ? "…" : recording ? <IconStop /> : <IconMic />}
            </button>
            <button
              type="submit"
              disabled={!question.trim() || pending || !online}
              aria-label="Ask"
              className="btn-primary grid h-9 w-9 place-items-center rounded-lg disabled:cursor-not-allowed"
            >
              <IconSend />
            </button>
          </div>
        </form>
        {!compact && (
          <p className="mt-2 text-center text-[11px] text-ink-3">
            Answers come only from your selected documents. Check the sources.
          </p>
        )}
      </div>
    </section>
  );
}
