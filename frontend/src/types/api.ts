export type DocumentStatus =
  | "UPLOADED"
  | "EXTRACTING"
  | "CHUNKING"
  | "EMBEDDING"
  | "INDEXING"
  | "VERIFYING"
  | "READY"
  | "FAILED";

export interface AstraDocument {
  id: string;
  original_name: string;
  file_type: string;
  size_bytes: number;
  status: DocumentStatus;
  error_message: string | null;
  warnings: string[];
  page_count: number | null;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export type AnswerLanguage = "auto" | "en" | "ur";
export type AnswerStatus =
  | "answered"
  | "insufficient_evidence"
  | "error"
  | "conversational"
  | "needs_documents"
  | "general";

export interface Citation {
  chunk_id: string;
  document_id: string;
  document_name: string;
  page_start: number | null;
  page_end: number | null;
  heading: string | null;
  excerpt: string;
}

export interface ChatResponse {
  conversation_id: string;
  message_id: string;
  answer: string;
  status: AnswerStatus;
  language: "en" | "ur";
  citations: Citation[];
  mock: boolean;
  intent: string;
  intent_stage: "lexicon" | "classifier" | "default";
  detected_language: "en" | "ur" | "roman_ur" | "mixed";
  suggestions: string[];
  searched_question?: string | null;
}

export interface Health {
  status: "ok";
  app_env: string;
  mock_mode: boolean;
  providers: { embeddings: string; llm: string };
  voice: { stt: boolean; tts: boolean };
  limits: { max_upload_mb: number; allowed_extensions: string[] };
  features?: { ocr?: boolean; general_knowledge?: boolean };
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  language: "en" | "ur";
  status?: AnswerStatus;
  citations: Citation[];
  mock?: boolean;
  intent?: string;
  suggestions?: string[];
  /** Still being written by the model. */
  streaming?: boolean;
  searched_question?: string | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  language: string;
  status: AnswerStatus | null;
  document_ids: string[];
  citations: Citation[];
  created_at: string;
}

export interface Conversation {
  id: string;
  created_at: string;
  messages: ConversationMessage[];
}

/** A citation the user asked to inspect in the reader. */
export interface CitationTarget {
  documentId: string;
  page: number | null;
  citation?: Citation;
}
