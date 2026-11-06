import { useEffect, useRef, useState } from "react";
import { createIntroScene, TIMELINE } from "../brand/introScene";
import { NEURAL_BOOK } from "../brand/neuralBook";
import { AstraLogo } from "./AstraLogo";

const SEEN_KEY = "astra.intro.seen";
const REDUCED_HOLD_MS = 2200;
const EXIT_MS = TIMELINE.end - TIMELINE.exit;

type Stage = "atmosphere" | "forming" | "formed" | "lit" | "title" | "tagline" | "hold" | "exit";

/** Once per browser tab; `?intro` in the URL forces a replay. */
export function shouldShowIntro(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has("intro")) return true;
    return sessionStorage.getItem(SEEN_KEY) !== "1";
  } catch {
    return false;
  }
}

function markSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private mode: the intro just replays next time */
  }
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface Props {
  onDone: () => void;
}

/**
 * Cinematic brand intro. Timeline (ms): 0 dust → 1000 nodes travel → 3000 book recognizable →
 * 3000–4000 core light + reflection → 4000 title → 5000 tagline → 6000 hold → 7000 fade out.
 * Reduced motion: a still composition with a plain fade, shown briefly.
 */
export function AstraIntro({ onDone }: Props) {
  const reduced = useRef(prefersReducedMotion()).current;
  const [stage, setStage] = useState<Stage>(reduced ? "hold" : "atmosphere");
  const [canvasOk, setCanvasOk] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const exiting = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    doneRef.current();
  };

  // Stage timeline on timers (deterministic, testable); the canvas only draws.
  useEffect(() => {
    markSeen();
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => timers.push(window.setTimeout(fn, ms));
    if (reduced) {
      at(REDUCED_HOLD_MS, () => setStage("exit"));
      at(REDUCED_HOLD_MS + EXIT_MS, finish);
    } else {
      at(TIMELINE.forming, () => setStage("forming"));
      at(TIMELINE.formed, () => setStage("formed"));
      at(TIMELINE.lit + 400, () => setStage("lit"));
      at(TIMELINE.title, () => setStage("title"));
      at(TIMELINE.tagline, () => setStage("tagline"));
      at(TIMELINE.hold, () => setStage("hold"));
      at(TIMELINE.exit, () => setStage("exit"));
      at(TIMELINE.end, finish);
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduced]);

  // Canvas scene: one rAF loop, cleaned up on unmount or when the exit starts.
  useEffect(() => {
    if (reduced) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = createIntroScene(canvas, NEURAL_BOOK);
    if (!scene) {
      setCanvasOk(false);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const loop = () => {
      scene.frame(performance.now() - start);
      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);
    const onResize = () => scene.resize();
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      scene.destroy();
    };
  }, [reduced]);

  function skip() {
    if (exiting.current) return;
    exiting.current = true;
    setStage("exit");
    window.setTimeout(finish, 320);
  }

  // Move focus into the dialog, and give it back when the intro leaves.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Mount-only: skip() reads refs, so a stale closure is harmless.
  }, []);

  const order: Stage[] = ["atmosphere", "forming", "formed", "lit", "title", "tagline", "hold", "exit"];
  const reached = (s: Stage) => order.indexOf(stage) >= order.indexOf(s);
  const showStill = reduced || !canvasOk;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-label="Astra AI intro"
      aria-modal="true"
      data-stage={stage}
      className={`astra-intro fixed inset-0 z-[100] flex flex-col items-center justify-center overflow-hidden outline-none ${
        stage === "exit" ? "astra-intro-exit" : ""
      }`}
    >
      <div aria-hidden="true" className="astra-intro-ambient absolute inset-0" />
      {showStill ? (
        <div className="astra-intro-still relative w-[min(60vw,42vh)]">
          <AstraLogo className="block w-full" />
          <AstraLogo aria-hidden="true" glow={false} className="astra-intro-still-reflection block w-full" />
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          aria-hidden="true"
          className="relative block aspect-[4/3] max-h-[min(70vh,560px)] w-[min(92vw,760px)]"
        />
      )}

      <div className="relative -mt-4 flex flex-col items-center px-6 text-center sm:-mt-10">
        <h1
          className={`astra-intro-text astra-intro-title text-[28px] font-semibold uppercase tracking-[0.42em] text-[#f5edf1] sm:text-[40px] ${
            reduced || reached("title") ? "is-in" : ""
          }`}
        >
          ASTRA AI
        </h1>
        <p
          className={`astra-intro-text mt-3 text-sm tracking-[0.14em] text-[#d9c5cf] sm:text-base ${
            reduced || reached("tagline") ? "is-in" : ""
          }`}
        >
          Knowledge without boundaries.
        </p>
      </div>

      <button
        type="button"
        onClick={skip}
        className="absolute end-5 top-5 rounded-full border border-[var(--glass-border)] bg-black/30 px-3.5 py-1.5 text-xs text-[#d9c5cf] backdrop-blur transition-colors hover:border-[#e6a1b4]/50 hover:text-[#f5edf1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#e6a1b4]"
      >
        Skip intro
      </button>
      <span className="sr-only" aria-live="polite">
        {stage === "exit" ? "Opening Astra AI" : ""}
      </span>
    </div>
  );
}
