import { useCallback, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "error";

const MAX_SECONDS = 60;

/** Records microphone audio in memory only. Nothing is stored after it is sent. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Exposed so the voice view can draw a level meter from the real input.
  const [stream, setStream] = useState<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const resolver = useRef<((b: Blob | null) => void) | null>(null);
  const timeout = useRef<number | undefined>(undefined);

  const supported =
    typeof window !== "undefined" &&
    "MediaRecorder" in window &&
    !!navigator.mediaDevices?.getUserMedia;

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      setError(
        denied
          ? "Microphone access was blocked. Allow it in your browser settings to use voice."
          : "No microphone was found.",
      );
      setState("error");
      return;
    }
    chunks.current = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
      const blob = chunks.current.length ? new Blob(chunks.current, { type: rec.mimeType }) : null;
      chunks.current = [];
      resolver.current?.(blob);
      resolver.current = null;
    };
    recorder.current = rec;
    setStream(stream);
    rec.start();
    setState("recording");
    timeout.current = window.setTimeout(() => rec.state === "recording" && rec.stop(), MAX_SECONDS * 1000);
  }, []);

  const stop = useCallback((): Promise<Blob | null> => {
    window.clearTimeout(timeout.current);
    const rec = recorder.current;
    setState("idle");
    if (!rec || rec.state !== "recording") return Promise.resolve(null);
    return new Promise((resolve) => {
      resolver.current = resolve;
      rec.stop();
    });
  }, []);

  return { state, error, supported, stream, start, stop, setError };
}
