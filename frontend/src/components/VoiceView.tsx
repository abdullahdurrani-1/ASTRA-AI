import { useEffect, useRef, useState } from "react";
import { useAudioLevels } from "../hooks/useAudioLevels";
import type { ChatSession } from "../hooks/useChatSession";
import { useRecorder } from "../hooks/useRecorder";
import { useSpeech } from "../hooks/useSpeech";
import { api, ApiError } from "../services/api";
import type { AnswerLanguage, ChatMessage } from "../types/api";
import { IconArrowLeft, IconMic, IconSpeaker, IconStop } from "./icons";

interface Props {
  session: ChatSession;
  documentIds: string[];
  sttEnabled: boolean;
  ttsEnabled: boolean;
  online: boolean;
  onBack: () => void;
}

type VoiceState = "idle" | "listening" | "transcribing" | "thinking" | "speaking" | "error";

const STATE_TEXT: Record<VoiceState, string> = {
  idle: "Tap the microphone and ask your question",
  listening: "Listening… tap again when you're done",
  transcribing: "Turning your speech into text…",
  thinking: "Searching your documents…",
  speaking: "Speaking the answer",
  error: "Something went wrong",
};

export function VoiceView({ session, documentIds, sttEnabled, ttsEnabled, online, onBack }: Props) {
  const recorder = useRecorder();
  const speech = useSpeech(ttsEnabled);
  const levels = useAudioLevels(recorder.stream);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [answer, setAnswer] = useState<ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [autoSpeak, setAutoSpeak] = useState(true);
  const active = useRef(true);

  // Leaving voice mode stops the microphone and any playback.
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      void recorder.stop();
      speech.stop();
    };
    // Mount/unmount only: stop() and recorder.stop() are stable callbacks.
  }, []);

  const micAvailable = sttEnabled && recorder.supported;
  const state: VoiceState =
    recorder.state === "recording"
      ? "listening"
      : transcribing
        ? "transcribing"
        : session.pending
          ? "thinking"
          : speech.playingId
            ? "speaking"
            : error || recorder.error
              ? "error"
              : "idle";

  async function toggle() {
    setError(null);
    if (recorder.state === "recording") {
      const blob = await recorder.stop();
      if (!blob) {
        setError("No audio was captured. Please try again.");
        return;
      }
      setTranscribing(true);
      let text = "";
      try {
        text = (await api.transcribe(blob)).text.trim();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Transcription failed.");
        return;
      } finally {
        setTranscribing(false);
      }
      if (!text) {
        setError("I couldn't hear any words. Please try again.");
        return;
      }
      setTranscript(text);
      setAnswer(null);
      const reply = await session.send(text, documentIds);
      if (!active.current || !reply) return;
      setAnswer(reply);
      if (autoSpeak && reply.status !== "error") void speech.play(reply.id, reply.content, reply.language);
    } else {
      speech.stop();
      await recorder.start();
    }
  }

  const shownError = error ?? recorder.error ?? speech.error ?? session.error;
  const peak = levels.length ? Math.max(...levels) : 0;

  return (
    <section aria-label="Voice assistant" className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-ink-2 hover:bg-surface-hover hover:text-ink"
        >
          <IconArrowLeft width={16} height={16} /> Back to chat
        </button>
        <div className="flex-1" />
        <label htmlFor="voice-lang" className="text-xs text-ink-3">
          Language
        </label>
        <select
          id="voice-lang"
          value={session.language}
          onChange={(e) => session.setLanguage(e.target.value as AnswerLanguage)}
          className="glass h-8 rounded-lg px-2 text-xs text-ink [&>option]:bg-surface"
        >
          <option value="auto">Auto</option>
          <option value="en">English</option>
          <option value="ur">اردو</option>
        </select>
      </div>

      <div className="scroll-thin flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-8">
        <div className="mt-6 flex w-full max-w-xl flex-col items-center text-center">
          {!micAvailable && (
            <div role="status" className="mb-6 w-full rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-start text-sm text-ink">
              <p className="font-semibold text-warn">Voice input isn't enabled on this server</p>
              <p className="mt-1 text-ink-2">
                {!recorder.supported
                  ? "This browser can't record audio."
                  : "Speech-to-text needs a speech provider in the server settings (STT_PROVIDER). Typed questions still work, and answers can still be read aloud."}
              </p>
            </div>
          )}

          {/* The orb only reacts to the real microphone level; it never fakes activity. */}
          <div className="relative grid h-48 w-48 place-items-center">
            <div
              aria-hidden="true"
              className="ambient-glow absolute -inset-10 rounded-full transition-transform duration-100"
              style={{ transform: `scale(${0.85 + peak * 0.5})` }}
            />
            <button
              type="button"
              onClick={() => void toggle()}
              disabled={!micAvailable || !online || transcribing || session.pending}
              aria-label={state === "listening" ? "Stop and send" : "Start speaking"}
              aria-pressed={state === "listening"}
              className={`relative grid h-28 w-28 place-items-center rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                state === "listening"
                  ? "btn-primary border-transparent shadow-[0_0_0_10px_rgb(181_45_88/0.15),0_0_50px_-5px_var(--crimson)]"
                  : "glass-card text-ink hover:text-accent"
              }`}
            >
              {state === "listening" ? <IconStop width={34} height={34} /> : <IconMic width={34} height={34} />}
            </button>
          </div>

          <div className="mt-6 flex h-10 items-center gap-[3px]" aria-hidden="true">
            {(levels.length ? levels : Array.from({ length: 28 }, () => 0)).map((v, i) => (
              <span
                key={i}
                className={`w-[3px] rounded-full transition-[height] duration-75 ${levels.length ? "bg-gradient-to-t from-crimson to-accent" : "bg-line"}`}
                style={{ height: `${4 + v * 36}px` }}
              />
            ))}
          </div>

          <p role="status" className="mt-4 text-sm font-medium text-ink">
            {STATE_TEXT[state]}
          </p>
          {state === "speaking" && (
            <button
              type="button"
              onClick={speech.stop}
              className="mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-ink-2 hover:bg-surface-hover"
            >
              <IconStop width={14} height={14} /> Stop speaking
            </button>
          )}
          {shownError && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {shownError}
            </p>
          )}
          <label className="mt-4 inline-flex items-center gap-2 text-xs text-ink-3">
            <input
              type="checkbox"
              checked={autoSpeak}
              onChange={(e) => setAutoSpeak(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Read answers aloud{ttsEnabled ? "" : " (uses your browser's voice; Urdu depends on your device)"}
          </label>
          {documentIds.length === 0 && (
            <p className="mt-3 text-xs text-ink-3">
              No document selected. Astra can chat, but needs a document to answer questions.
            </p>
          )}

          {(transcript || answer) && (
            <div className="mt-8 w-full space-y-3 text-start">
              {transcript && (
                <div className="rounded-xl border border-[var(--glass-border)] bg-user-bubble px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">You said</p>
                  <p dir="auto" className="mt-1 text-sm text-ink">
                    {transcript}
                  </p>
                </div>
              )}
              {answer && (
                <div className="glass rounded-xl px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">Astra</p>
                  <p
                    lang={answer.language === "ur" ? "ur" : "en"}
                    dir={answer.language === "ur" ? "rtl" : "ltr"}
                    className="mt-1 whitespace-pre-wrap text-sm text-ink"
                  >
                    {answer.content}
                  </p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-ink-3">
                    <button
                      type="button"
                      onClick={() => void speech.play(answer.id, answer.content, answer.language)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-surface-hover hover:text-ink"
                    >
                      <IconSpeaker width={14} height={14} /> Replay
                    </button>
                    {answer.citations.length > 0 && (
                      <button type="button" onClick={onBack} className="rounded-md px-2 py-1 text-accent hover:bg-accent-soft">
                        {answer.citations.length} source(s), view in chat
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
