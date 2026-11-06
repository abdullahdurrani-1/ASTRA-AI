import { describe, expect, it } from "vitest";
import { buildParticles, curvePoint, seeded, settleProgress, TIMELINE } from "../brand/introScene";
import { NEURAL_BOOK, nodeById } from "../brand/neuralBook";

describe("neural book geometry", () => {
  it("is symmetric: every left-page node mirrors a right-page node across x=100", () => {
    const right = NEURAL_BOOK.nodes.filter((n) => n.role === "right-page");
    const left = NEURAL_BOOK.nodes.filter((n) => n.role === "left-page");
    expect(left.length).toBe(right.length);
    for (const r of right) {
      const mirror = left.find((l) => Math.abs(l.x - (200 - r.x)) < 0.01 && Math.abs(l.y - r.y) < 0.01);
      expect(mirror, `no mirror for ${r.id}`).toBeDefined();
    }
  });

  it("has exactly one core node on the spine and only valid edges", () => {
    const cores = NEURAL_BOOK.nodes.filter((n) => n.role === "core");
    expect(cores).toHaveLength(1);
    expect(cores[0].x).toBe(100);
    const ids = nodeById(NEURAL_BOOK);
    for (const [a, b] of NEURAL_BOOK.edges) {
      expect(ids.has(a), a).toBe(true);
      expect(ids.has(b), b).toBe(true);
    }
  });
});

describe("intro scene maths", () => {
  const particles = buildParticles(NEURAL_BOOK, seeded(7));

  it("is deterministic for a given seed", () => {
    const again = buildParticles(NEURAL_BOOK, seeded(7));
    expect(again.map((p) => [p.sx, p.sy, p.delay])).toEqual(particles.map((p) => [p.sx, p.sy, p.delay]));
  });

  it("spine and core nodes leave before page nodes, halo nodes last", () => {
    const by = (role: string) => particles.filter((p) => p.node.role === role).map((p) => p.delay);
    expect(Math.max(...by("spine"), ...by("core"))).toBeLessThan(Math.min(...by("left-page"), ...by("right-page")) + 500);
    expect(Math.min(...by("halo"))).toBeGreaterThan(Math.max(...by("spine")));
  });

  it("every node is still before 1 s and settled on its target by 3.2 s", () => {
    for (const p of particles) {
      expect(settleProgress(p, TIMELINE.forming - 1)).toBe(0);
      const start = curvePoint(p, 0);
      expect(start).toEqual({ x: p.sx, y: p.sy });
      const s = settleProgress(p, 3200);
      expect(s).toBe(1);
      expect(curvePoint(p, s)).toEqual({ x: p.node.x, y: p.node.y });
    }
  });

  it("travels along a curve, not a straight line", () => {
    const p = particles[0];
    const mid = curvePoint(p, 0.5);
    const straight = { x: (p.sx + p.node.x) / 2, y: (p.sy + p.node.y) / 2 };
    const off = Math.hypot(mid.x - straight.x, mid.y - straight.y);
    expect(off).toBeGreaterThan(0.5);
  });
});
