import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../services/api";

/**
 * Plays answers aloud. Uses the server TTS adapter when enabled, otherwise the browser's built-in
 * speech synthesis (voice availability — especially Urdu — depends on the user's device).
 */
export function useSpeech(serverTts: boolean) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);

  const stop = useCallback(() => {
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setPlayingId(null);
  }, []);

  useEffect(() => stop, [stop]);

  const play = useCallback(
    async (id: string, text: string, language: "en" | "ur") => {
      stop();
      setError(null);
      setPlayingId(id);
      try {
        if (serverTts) {
          const blob = await api.synthesize(text, language);
          url.current = URL.createObjectURL(blob);
          const el = new Audio(url.current);
          audio.current = el;
          el.onended = stop;
          el.onerror = () => {
            setError("Audio playback failed.");
            stop();
          };
          await el.play();
          return;
        }
        if (!("speechSynthesis" in window)) {
          throw new Error("Your browser does not support speech playback.");
        }
        const utter = new SpeechSynthesisUtterance(text);
        utter.lang = language === "ur" ? "ur-PK" : "en-US";
        const voice = window.speechSynthesis
          .getVoices()
          .find((v) => v.lang.toLowerCase().startsWith(language));
        if (language === "ur" && !voice) {
          throw new Error("No Urdu voice is installed in this browser, so it can't be read aloud.");
        }
        if (voice) utter.voice = voice;
        utter.onend = () => setPlayingId(null);
        utter.onerror = () => setPlayingId(null);
        window.speechSynthesis.speak(utter);
      } catch (e) {
        setError(e instanceof ApiError || e instanceof Error ? e.message : "Playback failed.");
        stop();
      }
    },
    [serverTts, stop],
  );

  return { playingId, error, play, stop, setError };
}
