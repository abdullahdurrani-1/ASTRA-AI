import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../services/api";
import type { AstraDocument } from "../types/api";

const TERMINAL = new Set(["READY", "FAILED"]);
const POLL_MS = 1500;

export function useDocuments() {
  const [documents, setDocuments] = useState<AstraDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setDocuments(await api.listDocuments());
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load documents.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll only while something is still processing; status always comes from the server.
  const processing = documents.some((d) => !TERMINAL.has(d.status));
  useEffect(() => {
    if (!processing) return;
    timer.current = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer.current);
  }, [processing, refresh]);

  const upload = useCallback(
    async (file: File) => {
      const doc = await api.upload(file);
      await refresh();
      return doc;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await api.deleteDocument(id);
      await refresh();
    },
    [refresh],
  );

  const retry = useCallback(
    async (id: string) => {
      await api.reindex(id);
      await refresh();
    },
    [refresh],
  );

  return { documents, loading, error, refresh, upload, remove, retry };
}
