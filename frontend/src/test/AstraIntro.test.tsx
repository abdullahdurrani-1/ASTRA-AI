// Intro behaviour: gating, timeline, skip, reduced motion. Drawing is not tested here (jsdom has
// no canvas); the pure scene maths is covered in introScene.test.ts.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AstraIntro, prefersReducedMotion, shouldShowIntro } from "../components/AstraIntro";

function mockMatchMedia(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: reduced && q.includes("reduce"),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  mockMatchMedia(false);
  // jsdom has no 2D context; the component then shows the still composition.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("intro gating", () => {
  it("shows once per tab and can be forced with ?intro", () => {
    expect(shouldShowIntro()).toBe(true);
    sessionStorage.setItem("astra.intro.seen", "1");
    expect(shouldShowIntro()).toBe(false);
    window.history.replaceState({}, "", "/?intro");
    expect(shouldShowIntro()).toBe(true);
  });

  it("marks the tab as seen when it mounts", () => {
    render(<AstraIntro onDone={() => {}} />);
    expect(sessionStorage.getItem("astra.intro.seen")).toBe("1");
  });
});

describe("intro timeline", () => {
  it("brings the title in at 4 s, the tagline at 5 s and finishes at 7.8 s", () => {
    const onDone = vi.fn();
    render(<AstraIntro onDone={onDone} />);
    const title = screen.getByRole("heading", { name: "ASTRA AI" });
    const tagline = screen.getByText("Knowledge without boundaries.");
    expect(title).not.toHaveClass("is-in");
    act(() => vi.advanceTimersByTime(3999));
    expect(title).not.toHaveClass("is-in");
    act(() => vi.advanceTimersByTime(1));
    expect(title).toHaveClass("is-in");
    expect(tagline).not.toHaveClass("is-in");
    act(() => vi.advanceTimersByTime(1000));
    expect(tagline).toHaveClass("is-in");
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("dialog")).toHaveAttribute("data-stage", "exit");
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(800));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("skip button and Escape both end the intro quickly, only once", () => {
    const onDone = vi.fn();
    render(<AstraIntro onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip intro" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByRole("dialog")).toHaveAttribute("data-stage", "exit");
    act(() => vi.advanceTimersByTime(320));
    expect(onDone).toHaveBeenCalledTimes(1);
    // The scheduled 7.8 s completion must not fire a second time after unmount.
    act(() => vi.advanceTimersByTime(8000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reduced motion shows the still composition immediately and leaves sooner", () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    const onDone = vi.fn();
    render(<AstraIntro onDone={onDone} />);
    expect(screen.getByRole("heading", { name: "ASTRA AI" })).toHaveClass("is-in");
    expect(screen.getAllByRole("img", { name: "Astra AI" }).length).toBeGreaterThan(0);
    act(() => vi.advanceTimersByTime(3000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("intro focus", () => {
  it("moves focus into the dialog and gives it back when the intro leaves", () => {
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(<AstraIntro onDone={() => {}} />);
    expect(screen.getByRole("dialog", { name: "Astra AI intro" })).toHaveFocus();
    unmount();
    expect(outside).toHaveFocus();
    outside.remove();
  });
});
