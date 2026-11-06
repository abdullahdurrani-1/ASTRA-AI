import { useEffect, useState } from "react";

/** Live input levels (0..1) from a microphone stream. Empty when there is no stream. */
export function useAudioLevels(stream: MediaStream | null, bars = 28): number[] {
  const [levels, setLevels] = useState<number[]>([]);

  useEffect(() => {
    if (!stream || typeof AudioContext === "undefined") {
      setLevels([]);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let frame = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / bars));
      const next: number[] = [];
      for (let i = 0; i < bars; i++) next.push((data[i * step] ?? 0) / 255);
      setLevels(next);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close();
      setLevels([]);
    };
  }, [stream, bars]);

  return levels;
}
