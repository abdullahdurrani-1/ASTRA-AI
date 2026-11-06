import type {
  AnswerLanguage,
  AstraDocument,
  ChatResponse,
  Conversation,
  ConversationSummary,
  Health,
} from "../types/api";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, init);
  } catch {
    throw new ApiError(
      "Can't reach the Astra server. Check that the backend is running.",
      "network_error",
      0,
    );
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    let code = "http_error";
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      code = body?.error?.code ?? code;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, code, res.status);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("application/json") ? res.json() : res.blob()) as Promise<T>;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export interface ChatStreamBody {
  question: string;
  document_ids: string[];
  language: AnswerLanguage;
  conversation_id?: string | null;
  tz_offset_minutes?: number;
}

export const api = {
  health: () => request<Health>("/health"),
  listConversations: async () =>
    (await request<{ conversations: ConversationSummary[] }>("/conversations")).conversations,
  getConversation: (id: string) =>
    request<Conversation>(`/conversations/${encodeURIComponent(id)}`),
  /** URL of the original upload, served inline for the reader. */
  fileUrl: (id: string) => `${BASE}/documents/${encodeURIComponent(id)}/file`,
  listDocuments: async () =>
    (await request<{ documents: AstraDocument[] }>("/documents")).documents,
  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<AstraDocument>("/documents/upload", { method: "POST", body: form });
  },
  deleteDocument: (id: string) =>
    request<void>(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  reindex: (id: string) =>
    request<AstraDocument>(`/documents/${encodeURIComponent(id)}/reindex`, { method: "POST" }),
  chat: (body: {
    question: string;
    document_ids: string[];
    language: AnswerLanguage;
    conversation_id?: string | null;
    tz_offset_minutes?: number;
  }) => request<ChatResponse>("/chat", json(body)),
  /**
   * Streams a chat reply over server-sent events. `onDelta` receives answer text as it is
   * written; resolves with the same body as `chat()`. Falls back to `chat()` when the body
   * cannot be read as a stream.
   */
  chatStream: async (
    body: ChatStreamBody,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<ChatResponse> => {
    let res: Response;
    try {
      res = await fetch(`${BASE}/chat/stream`, { ...json(body), signal });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      throw new ApiError(
        "Can't reach the Astra server. Check that the backend is running.",
        "network_error",
        0,
      );
    }
    if (!res.ok) {
      let message = `Request failed (${res.status}).`;
      let code = "http_error";
      try {
        const err = await res.json();
        message = err?.error?.message ?? message;
        code = err?.error?.code ?? code;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(message, code, res.status);
    }
    if (!res.body) return api.chat(body);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done: ChatResponse | null = null;
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        let event = "message";
        const dataLines: string[] = [];
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length) continue;
        const data = JSON.parse(dataLines.join("\n"));
        if (event === "delta") onDelta(String(data.text ?? ""));
        else if (event === "done") done = data as ChatResponse;
        else if (event === "error") throw new ApiError(data.message ?? "Request failed.", data.code ?? "error", 500);
      }
    }
    if (!done) throw new ApiError("The answer stream ended early.", "stream_error", 0);
    return done;
  },
  transcribe: (audio: Blob) => {
    const form = new FormData();
    const ext = audio.type.includes("ogg") ? "ogg" : audio.type.includes("mp4") ? "mp4" : "webm";
    form.append("file", new File([audio], `recording.${ext}`, { type: audio.type.split(";")[0] }));
    return request<{ text: string; language: string | null }>("/voice/transcribe", {
      method: "POST",
      body: form,
    });
  },
  synthesize: (text: string, language: "en" | "ur") =>
    request<Blob>("/voice/synthesize", json({ text, language })),
};
