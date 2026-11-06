// Component tests with a mocked fetch. These verify UI behaviour only — not real model output.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";

const health = {
  status: "ok",
  app_env: "test",
  mock_mode: true,
  providers: { embeddings: "mock", llm: "mock" },
  voice: { stt: false, tts: false },
  limits: { max_upload_mb: 25, allowed_extensions: [".pdf", ".txt", ".md"] },
  features: { ocr: true },
};
const doc = {
  id: "d1",
  original_name: "solar.pdf",
  file_type: "pdf",
  size_bytes: 2048,
  status: "READY",
  error_message: null,
  warnings: [],
  page_count: 2,
  chunk_count: 3,
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
};
const processingDoc = { ...doc, id: "d2", original_name: "big-book.pdf", status: "EMBEDDING", chunk_count: 0 };

/** Mimics POST /chat/stream: a few text deltas, then the full reply. */
function sse(reply: unknown) {
  const r = reply as { answer: string; status: string };
  const grounded = r.status === "answered";
  const frames: string[] = [];
  if (grounded) {
    for (let i = 0; i < r.answer.length; i += 10) {
      frames.push(`event: delta
data: ${JSON.stringify({ text: r.answer.slice(i, i + 10) })}

`);
    }
  }
  frames.push(`event: done
data: ${JSON.stringify(reply)}

`);
  return Promise.resolve(
    new Response(frames.join(""), { status: 200, headers: { "content-type": "text/event-stream" } }),
  );
}

function respond(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

let chatReply: unknown;
let docs: unknown[];
beforeEach(() => {
  sessionStorage.setItem("astra.intro.seen", "1"); // dashboard tests run without the intro
  docs = [doc];
  chatReply = {
    conversation_id: "c1",
    message_id: "m1",
    answer: "[MOCK MODE] Mars has two moons named Phobos and Deimos.",
    status: "answered",
    language: "en",
    mock: true,
    intent: "DOC_QUESTION",
    intent_stage: "default",
    detected_language: "en",
    suggestions: [],
    citations: [
      {
        chunk_id: "d1-1",
        document_id: "d1",
        document_name: "solar.pdf",
        page_start: 2,
        page_end: 2,
        heading: "Mars",
        excerpt: "Mars has two moons named Phobos and Deimos.",
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.endsWith("/health")) return respond(health);
      if (url.endsWith("/documents")) return respond({ documents: docs });
      if (url.endsWith("/conversations"))
        return respond({
          conversations: [
            { id: "old", title: "Who was his father?", created_at: "", updated_at: "", message_count: 2 },
          ],
        });
      if (url.endsWith("/chat/stream")) return sse(chatReply);
      if (url.endsWith("/chat")) return respond(chatReply);
      return respond({ error: { code: "not_found", message: "nope" } }, 404);
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const answer = () => screen.getByRole("article", { name: "Astra's answer" });

describe("Astra UI", () => {
  it("plays the brand intro on first load and reveals the app after skipping", async () => {
    sessionStorage.clear();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole("dialog", { name: "Astra AI intro" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ASTRA AI" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip intro" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Astra AI intro" })).not.toBeInTheDocument());
    expect(await screen.findByLabelText("Your question")).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it("shows mock-mode banner, sources and disabled voice in chat", async () => {
    render(<App />);
    expect(await screen.findByText(/Development mock mode/)).toBeInTheDocument();
    expect(await screen.findByLabelText("solar.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask by voice" })).toBeDisabled();
    expect(await screen.findByText("Who was his father?")).toBeInTheDocument(); // chat history
  });

  it("asks a question and shows an expandable page citation", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("solar.pdf"));
    await user.type(screen.getByLabelText("Your question"), "What are the moons of Mars?");
    await user.click(screen.getByRole("button", { name: "Ask" }));
    expect(await screen.findByText(/^\[MOCK MODE\] Mars has two moons/)).toBeInTheDocument();
    // Citation excerpt sits inside a collapsible <details> block.
    // Sources appear once the typewriter has finished writing the answer.
    expect(await within(answer()).findByRole("group")).toHaveTextContent("Mars has two moons named Phobos");
    expect(screen.getByText(/page 2 · Mars/)).toBeInTheDocument();
    expect(screen.getByText(/not a real model answer/i)).toBeInTheDocument();
  });

  it("opens a citation in the research reader at the cited page", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("solar.pdf"));
    await user.type(screen.getByLabelText("Your question"), "Moons of Mars?{Enter}");
    await user.click(await screen.findByText(/page 2 · Mars/));
    await user.click(screen.getByRole("button", { name: "Open page 2 in reader" }));
    const frame = await screen.findByTitle("solar.pdf reader");
    expect(frame.getAttribute("src")).toBe("/api/documents/d1/file#page=2");
    expect(screen.getByText(/Cited passage · page 2/)).toBeInTheDocument();
  });

  it("renders insufficient evidence clearly", async () => {
    chatReply = {
      ...(chatReply as object),
      answer: "I couldn't find enough information about that in your uploaded document.",
      status: "insufficient_evidence",
      citations: [],
    };
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("solar.pdf"));
    await user.type(screen.getByLabelText("Your question"), "Who won the world cup?{Enter}");
    expect(await screen.findByText("Not enough evidence")).toBeInTheDocument();
  });

  it("renders a greeting as a conversational bubble: no sources, no refusal, no mock label", async () => {
    chatReply = {
      conversation_id: "c1",
      message_id: "m2",
      answer: "Hello! I'm ready to answer from “solar.pdf”. Here are a few questions to try.",
      status: "conversational",
      language: "en",
      mock: false,
      citations: [],
      intent: "GREETING",
      intent_stage: "lexicon",
      detected_language: "en",
      suggestions: ["What does the document say about The Solar System?"],
    };
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByLabelText("solar.pdf"));
    await user.type(screen.getByLabelText("Your question"), "hello{Enter}");
    expect(await screen.findByText(/I'm ready to answer from/)).toBeInTheDocument();
    const bubble = within(answer());
    expect(bubble.queryByText("Sources")).not.toBeInTheDocument();
    expect(bubble.queryByText("Not enough evidence")).not.toBeInTheDocument();
    expect(bubble.queryByText(/not a real model answer/i)).not.toBeInTheDocument();
    expect(
      await bubble.findByRole("button", { name: "What does the document say about The Solar System?" }),
    ).toBeInTheDocument();
  });

  it("lets you chat before selecting a document, in Urdu, right-to-left", async () => {
    chatReply = {
      conversation_id: "c1",
      message_id: "m3",
      answer: "وعلیکم السلام! کوئی PDF فائل اپ لوڈ کریں۔",
      status: "conversational",
      language: "ur",
      mock: false,
      citations: [],
      intent: "GREETING",
      intent_stage: "lexicon",
      detected_language: "ur",
      suggestions: [],
    };
    const user = userEvent.setup();
    render(<App />);
    const input = await screen.findByLabelText("Your question");
    expect(input).toBeEnabled();
    expect(screen.getByRole("button", { name: /What can you do/ })).toBeEnabled();
    // Document-only prompts are disabled until a document is selected.
    expect(screen.getByRole("button", { name: /Summarize a document/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "السلام علیکم" }));
    const reply = await screen.findByText(/وعلیکم السلام/);
    const container = reply.closest("[dir]");
    expect(container).toHaveAttribute("dir", "rtl");
    expect(container).toHaveAttribute("lang", "ur");
  });

  it("library shows real processing stages without inventing percentages", async () => {
    docs = [doc, processingDoc];
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Library/ }));
    expect(await screen.findByText("Ready")).toBeInTheDocument();
    expect(screen.getByText("Step 4 of 6: Creating embeddings")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Processing big-book.pdf" })).toHaveAttribute(
      "aria-valuetext",
      "Creating embeddings",
    );
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.getByText(/scanned PDFs are read with OCR/)).toBeInTheDocument();
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Library/ }));
    await user.click(await screen.findByRole("button", { name: "Delete solar.pdf" }));
    const dialog = screen.getByRole("alertdialog", { name: "Confirm delete" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("voice mode says honestly when voice input is unavailable", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /^Voice$/ }));
    expect(await screen.findByText("Voice input isn't enabled on this server")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start speaking" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Back to chat/ }));
    expect(screen.getByLabelText("Your question")).toBeInTheDocument();
  });

  it("toggles the theme", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "Switch to light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    await user.click(screen.getByRole("button", { name: "Switch to dark theme" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("shows a retryable error when the server is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("network"))));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Can't reach the Astra server/);
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
  });
});
