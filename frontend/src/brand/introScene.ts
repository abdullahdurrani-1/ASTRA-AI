/**
 * Canvas scene for the brand intro: atmospheric dust, neural nodes travelling along curved
 * paths into the open-book formation, connections that settle and breathe, a core light, and a
 * blurred reflection on a dark glass floor. Pure functions + one factory; no React here.
 */
import { nodeById, type BookNode, type NeuralBook } from "./neuralBook";

export const TIMELINE = {
  atmosphere: 0,
  forming: 1000, // nodes start moving
  formed: 3000, // logo recognizable
  lit: 3000, // glow + reflection ramp in (→ 4000)
  title: 4000,
  tagline: 5000,
  hold: 6000,
  exit: 7000,
  end: 7800,
} as const;

const ROSE = [230, 161, 180] as const;
const PALE = [242, 191, 205] as const;
const CRIMSON = [181, 45, 88] as const;

/** Deterministic pseudo-random (mulberry32) so every viewer sees the same choreography. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const easeOutCubic = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
export const easeInOut = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const rgba = (c: readonly [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

interface Particle {
  node: BookNode;
  /** Start point and bezier control point, in logo units. */
  sx: number;
  sy: number;
  cx: number;
  cy: number;
  delay: number; // ms after TIMELINE.forming
  duration: number;
  phase: number;
  drift: number;
}

interface Dust {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  phase: number;
}

export interface SceneOptions {
  /** 0..1 fraction of the canvas width the 200-unit logo box occupies. */
  logoFraction?: number;
  seed?: number;
}

export interface Scene {
  resize: () => void;
  /** Draw the scene at `elapsed` ms since the intro started. */
  frame: (elapsed: number) => void;
  destroy: () => void;
}

/** Progress of a node's journey (0 before it leaves, 1 once settled). */
export function settleProgress(p: Pick<Particle, "delay" | "duration">, elapsed: number): number {
  return easeInOut((elapsed - TIMELINE.forming - p.delay) / p.duration);
}

/** Point on the quadratic curve from start, via control, to the node, at progress u. */
export function curvePoint(p: Particle, u: number): { x: number; y: number } {
  const v = 1 - u;
  return {
    x: v * v * p.sx + 2 * v * u * p.cx + u * u * p.node.x,
    y: v * v * p.sy + 2 * v * u * p.cy + u * u * p.node.y,
  };
}

export function buildParticles(book: NeuralBook, rand: () => number): Particle[] {
  return book.nodes.map((node) => {
    // Nodes arrive from a ring around the book, spine first, halo last.
    const angle = rand() * Math.PI * 2;
    const dist = 140 + rand() * 80;
    const sx = 100 + Math.cos(angle) * dist;
    const sy = 100 + Math.sin(angle) * dist;
    const mx = (sx + node.x) / 2;
    const my = (sy + node.y) / 2;
    const bend = (rand() - 0.5) * 120;
    const order = node.role === "spine" || node.role === "core" ? 0 : node.role === "halo" ? 2 : 1;
    return {
      node,
      sx,
      sy,
      cx: mx - (node.y - sy) * (bend / dist),
      cy: my + (node.x - sx) * (bend / dist),
      // Slowest node: 1000 + 850 + 1250 = 3100 ms, so the book reads by ~3 s.
      delay: order * 250 + rand() * 350,
      duration: 800 + rand() * 450,
      phase: rand() * Math.PI * 2,
      drift: node.role === "halo" ? 2.2 : 0.45,
    };
  });
}

export function createIntroScene(canvas: HTMLCanvasElement, book: NeuralBook, opts: SceneOptions = {}): Scene | null {
  const mainCtx = canvas.getContext("2d");
  const layer = document.createElement("canvas");
  const layerCtx = mainCtx ? layer.getContext("2d") : null;
  if (!mainCtx || !layerCtx) return null;
  const ctx: CanvasRenderingContext2D = mainCtx;
  const lctx: CanvasRenderingContext2D = layerCtx;
  // Safari < 18 has no canvas filter; the reflection then uses offset passes instead of blur.
  const canBlur = typeof (ctx as { filter?: unknown }).filter === "string";

  const rand = seeded(opts.seed ?? 7);
  const particles = buildParticles(book, rand);
  const byId = nodeById(book);
  const edges = book.edges
    .map(([a, b]) => [particles.find((p) => p.node.id === a), particles.find((p) => p.node.id === b), rand() * Math.PI * 2] as const)
    .filter((e): e is readonly [Particle, Particle, number] => !!e[0] && !!e[1]);
  const core = book.nodes.find((n) => n.role === "core") ?? byId.get(book.nodes[0]?.id ?? "");
  const dust: Dust[] = Array.from({ length: 42 }, () => ({
    x: rand(),
    y: rand(),
    r: 0.4 + rand() * 0.9,
    vx: (rand() - 0.5) * 0.004,
    vy: -0.002 - rand() * 0.004,
    phase: rand() * Math.PI * 2,
  }));

  let width = 0;
  let height = 0;
  let dpr = 1;
  let scale = 1; // canvas px per logo unit
  let ox = 0; // logo box origin
  let oy = 0;
  let floorY = 0; // where the reflection starts
  let destroyed = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    layer.width = canvas.width;
    layer.height = canvas.height;
    const logoPx = Math.min(width * (opts.logoFraction ?? 0.6), height * 0.62);
    scale = logoPx / 200;
    ox = (width - logoPx) / 2;
    // Centre the book plus its reflection (about 1.3× the logo box) in the canvas.
    oy = Math.max(height * 0.04, (height - logoPx * 1.3) / 2);
    floorY = oy + logoPx * 0.86; // just under the lowest page nodes
  }

  const toX = (x: number) => ox + x * scale;
  const toY = (y: number) => oy + y * scale;

  function drawLogo(c: CanvasRenderingContext2D, elapsed: number) {
    const formed = clamp01((elapsed - TIMELINE.formed) / 1000); // 0→1 over 3–4 s
    // Page outlines fade in as the book forms.
    const pageAlpha = 0.22 * clamp01((elapsed - TIMELINE.forming - 900) / 1200);
    if (pageAlpha > 0) {
      c.strokeStyle = rgba(ROSE, pageAlpha);
      c.lineWidth = 0.8 * scale;
      for (const d of book.pagePaths) {
        const path = new Path2D(d);
        c.save();
        c.translate(ox, oy);
        c.scale(scale, scale);
        c.lineWidth = 0.8;
        c.stroke(path);
        c.restore();
      }
    }
    // Core light.
    if (core && formed > 0) {
      const g = c.createRadialGradient(toX(core.x), toY(core.y), 0, toX(core.x), toY(core.y), 40 * scale);
      const breathe = 0.85 + 0.15 * Math.sin(elapsed / 900);
      g.addColorStop(0, rgba(CRIMSON, 0.75 * formed * breathe));
      g.addColorStop(0.45, rgba([104, 27, 58], 0.3 * formed));
      g.addColorStop(1, rgba([61, 16, 40], 0));
      c.fillStyle = g;
      c.beginPath();
      c.arc(toX(core.x), toY(core.y), 40 * scale, 0, Math.PI * 2);
      c.fill();
    }
    // Positions this frame.
    const pos = new Map<string, { x: number; y: number; s: number }>();
    for (const p of particles) {
      const s = settleProgress(p, elapsed);
      const pt = curvePoint(p, s);
      if (s >= 1) {
        const t = elapsed / 1000;
        pt.x += Math.sin(t * 0.7 + p.phase) * p.drift;
        pt.y += Math.cos(t * 0.55 + p.phase) * p.drift;
      }
      pos.set(p.node.id, { x: pt.x, y: pt.y, s });
    }
    // Connections: appear as both ends settle, then breathe gently.
    c.lineCap = "round";
    for (const [a, b, phase] of edges) {
      const pa = pos.get(a.node.id)!;
      const pb = pos.get(b.node.id)!;
      const settled = clamp01((Math.min(pa.s, pb.s) - 0.75) / 0.25);
      if (settled <= 0) continue;
      const breathe = 0.65 + 0.35 * Math.sin(elapsed / 1400 + phase);
      c.strokeStyle = rgba(ROSE, 0.38 * settled * breathe);
      c.lineWidth = 0.7 * scale;
      c.beginPath();
      c.moveTo(toX(pa.x), toY(pa.y));
      c.lineTo(toX(pb.x), toY(pb.y));
      c.stroke();
    }
    // Nodes with a soft halo and a subtle pulse.
    for (const p of particles) {
      const q = pos.get(p.node.id)!;
      const appear = clamp01((elapsed - TIMELINE.forming - p.delay + 200) / 400);
      if (appear <= 0) continue;
      const pulse = q.s >= 1 ? 1 + 0.14 * Math.sin(elapsed / 650 + p.phase) : 1;
      const r = p.node.r * scale * pulse;
      const x = toX(q.x);
      const y = toY(q.y);
      const colour =
        p.node.role === "core"
          ? PALE
          : p.node.role === "spine"
            ? CRIMSON
            : p.node.role === "halo"
              ? ([201, 114, 143] as const)
              : ROSE;
      c.fillStyle = rgba(colour, 0.12 * appear);
      c.beginPath();
      c.arc(x, y, r * 3, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = rgba(colour, appear);
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
    }
  }

  function drawDust(c: CanvasRenderingContext2D, elapsed: number) {
    const t = elapsed / 1000;
    const fade = clamp01(elapsed / 1200) * (1 - 0.5 * clamp01((elapsed - TIMELINE.formed) / 2000));
    for (const d of dust) {
      const x = ((d.x + d.vx * t + 1) % 1) * width;
      const y = ((d.y + d.vy * t + 1) % 1) * height;
      const a = (0.18 + 0.12 * Math.sin(t * 1.3 + d.phase)) * fade;
      c.fillStyle = rgba(ROSE, a);
      c.beginPath();
      c.arc(x, y, d.r, 0, Math.PI * 2);
      c.fill();
    }
  }

  function frame(elapsed: number) {
    if (destroyed) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    lctx.clearRect(0, 0, width, height);
    drawDust(ctx, elapsed);
    drawLogo(lctx, elapsed);
    ctx.drawImage(layer, 0, 0, width, height);

    // Reflection: the logo mirrored on a polished dark floor, blurred and fading downward.
    const lit = clamp01((elapsed - TIMELINE.lit) / 1000);
    if (lit > 0) {
      ctx.save();
      ctx.translate(0, floorY * 2);
      ctx.scale(1, -1);
      if (canBlur) {
        ctx.globalAlpha = 0.3 * lit;
        ctx.filter = "blur(3px)";
        ctx.drawImage(layer, 0, 0, width, height);
      } else {
        ctx.globalAlpha = 0.11 * lit;
        for (const dy of [-2, 0, 2]) ctx.drawImage(layer, 0, dy, width, height);
      }
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      const mask = ctx.createLinearGradient(0, floorY, 0, floorY + (height - floorY) * 0.75);
      mask.addColorStop(0, "rgba(0,0,0,0.25)");
      mask.addColorStop(1, "rgba(0,0,0,1)");
      ctx.fillStyle = mask;
      ctx.fillRect(0, floorY, width, height - floorY);
      ctx.restore();
      // Faint floor sheen under the book.
      ctx.save();
      ctx.globalAlpha = 0.5 * lit;
      const sheen = ctx.createRadialGradient(width / 2, floorY, 0, width / 2, floorY, width * 0.35);
      sheen.addColorStop(0, rgba(CRIMSON, 0.16));
      sheen.addColorStop(1, rgba(CRIMSON, 0));
      ctx.fillStyle = sheen;
      ctx.fillRect(0, floorY - 10, width, 60);
      ctx.restore();
    }
  }

  resize();
  return {
    resize,
    frame,
    destroy() {
      destroyed = true;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
