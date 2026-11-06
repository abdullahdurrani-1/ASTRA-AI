import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../services/api";
import type { AnswerLanguage, ChatMessage, ConversationSummary } from "../types/api";

const URDU = /[؀-ۿ]/;

/**
 * One research session shared by chat, research and voice modes: switching modes keeps the
 * conversation, the answer language and any pending request.
 */
export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [language, setLanguage] = useState<AnswerLanguage>("auto");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailed, setLastFailed] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  // Ignore replies that arrive after the user started a new chat or opened another one.
  const generation = useRef(0);

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await api.listConversations());
    } catch {
      /* history is a convenience; chat still works without it */
    }
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  const send = useCallback(
    async (text: string, documentIds: string[]): Promise<ChatMessage | null> => {
      const q = text.trim();
      if (!q || pending) return null;
      const gen = generation.current;
      setError(null);
      setLastFailed(null);
      setPending(true);
      const local: ChatMessage = {
        id: `local-${Date.now()}`,
        role: "user",
        content: q,
        language: URDU.test(q) ? "ur" : "en",
        citations: [],
      };
      const draftId = `draft-${Date.now()}`;
      setMessages((m) => [...m, local]);
      let draftShown = false;
      try {
        const res = await api.chatStream(
          {
            question: q,
            document_ids: documentIds,
            language,
            conversation_id: conversationId,
            tz_offset_minutes: -new Date().getTimezoneOffset(),
          },
          (text) => {
            if (gen !== generation.current) return;
            // First delta: swap the thinking indicator for a live, growing answer.
            setMessages((m) => {
              const i = m.findIndex((x) => x.id === draftId);
              if (i < 0) {
                draftShown = true;
                return [
                  ...m,
                  {
                    id: draftId,
                    role: "assistant",
                    content: text,
                    language: URDU.test(text) ? "ur" : "en",
                    citations: [],
                    streaming: true,
                  },
                ];
              }
              const next = m.slice();
              next[i] = { ...next[i], content: next[i].content + text };
              return next;
            });
          },
        );
        if (gen !== generation.current) return null;
        setConversationId(res.conversation_id);
        if (res.intent === "LANG_SWITCH") setLanguage(res.language);
        const reply: ChatMessage = {
          id: res.message_id,
          role: "assistant",
          content: res.answer,
          language: res.language,
          status: res.status,
          citations: res.citations,
          mock: res.mock,
          intent: res.intent,
          suggestions: res.suggestions,
          searched_question: res.searched_question,
        };
        // Keep the draft's id so the bubble is not remounted (and re-typed) when it completes.
        setMessages((m) =>
          draftShown ? m.map((x) => (x.id === draftId ? { ...reply, id: draftId } : x)) : [...m, reply],
        );
        void refreshHistory();
        return reply;
      } catch (e) {
        if (gen !== generation.current) return null;
        setMessages((m) => m.filter((x) => x.id !== local.id && x.id !== draftId));
        setLastFailed(q);
        setError(e instanceof ApiError ? e.message : "Something went wrong.");
        return null;
      } finally {
        if (gen === generation.current) setPending(false);
      }
    },
    [conversationId, language, pending, refreshHistory],
  );

  const newChat = useCallback(() => {
    generation.current += 1;
    setMessages([]);
    setConversationId(null);
    setPending(false);
    setError(null);
    setLastFailed(null);
  }, []);

  const open = useCallback(async (id: string) => {
    generation.current += 1;
    setPending(false);
    setError(null);
    try {
      const conv = await api.getConversation(id);
      setConversationId(conv.id);
      setMessages(
        conv.messages.map((m) => ({
          id: `hist-${m.id}`,
          role: m.role,
          content: m.content,
          language: m.language === "ur" ? "ur" : "en",
          status: m.status ?? undefined,
          citations: m.citations,
        })),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not open that conversation.");
    }
  }, []);

  return {
    messages,
    conversationId,
    language,
    setLanguage,
    pending,
    error,
    setError,
    lastFailed,
    history,
    send,
    newChat,
    open,
  };
}

export type ChatSession = ReturnType<typeof useChatSession>;
