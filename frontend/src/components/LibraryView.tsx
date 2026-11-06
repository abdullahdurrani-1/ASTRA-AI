import { useMemo, useState } from "react";
import type { AstraDocument } from "../types/api";
import { DocumentList } from "./DocumentList";
import { IconSearch } from "./icons";
import { UploadDropzone } from "./UploadDropzone";

interface Props {
  documents: AstraDocument[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onUpload: (file: File) => Promise<unknown>;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onOpen: (id: string) => void;
  maxMb: number;
  extensions: string[];
  ocr: boolean;
  online: boolean;
}

export function LibraryView(p: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? p.documents.filter((d) => d.original_name.toLowerCase().includes(q)) : p.documents;
  }, [p.documents, query]);
  const ready = p.documents.filter((d) => d.status === "READY").length;
  const processing = p.documents.filter((d) => d.status !== "READY" && d.status !== "FAILED").length;
  const failed = p.documents.filter((d) => d.status === "FAILED").length;

  return (
    <section aria-label="Document library" className="scroll-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h2 className="text-xl font-semibold tracking-tight text-ink">Library</h2>
        <p className="mt-1 text-sm text-ink-2">
          {ready} ready{processing ? ` · ${processing} processing` : ""}
          {failed ? ` · ${failed} need attention` : ""}. Tick a document to use it in chat.
        </p>

        <div className="mt-6">
          <UploadDropzone
            maxMb={p.maxMb}
            extensions={p.extensions}
            ocr={p.ocr}
            onUpload={p.onUpload}
            disabled={!p.online}
          />
        </div>

        <div className="mt-8 flex items-center gap-3">
          <h3 className="flex-1 text-sm font-semibold text-ink">Your documents</h3>
          <div className="relative w-56">
            <IconSearch width={14} height={14} className="pointer-events-none absolute start-2.5 top-2.5 text-ink-3" />
            <label htmlFor="doc-search" className="sr-only">
              Search documents
            </label>
            <input
              id="doc-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search documents"
              className="glass h-8 w-full rounded-lg ps-8 pe-2 text-xs focus:border-accent/50 focus:outline-none text-ink placeholder:text-ink-3"
            />
          </div>
        </div>
        <div className="mt-3">
          {p.loading ? (
            <div className="space-y-2" aria-label="Loading documents">
              {[0, 1, 2].map((i) => (
                <div key={i} className="glass h-16 animate-pulse rounded-xl" />
              ))}
            </div>
          ) : p.error ? (
            <p role="alert" className="text-sm text-danger">
              {p.error}{" "}
              <button type="button" className="underline" onClick={p.onRefresh}>
                Retry
              </button>
            </p>
          ) : (
            <DocumentList
              documents={filtered}
              selected={p.selected}
              onToggle={p.onToggle}
              onDelete={p.onDelete}
              onRetry={p.onRetry}
              onOpen={p.onOpen}
              emptyText={query ? "No documents match your search." : undefined}
            />
          )}
        </div>
        <p className="mt-6 text-xs leading-relaxed text-ink-3">
          Uploaded files are indexed for search; they don't train or change any AI model. Answers come
          only from retrieved passages. Evidence checks reduce mistakes but can't guarantee perfect
          accuracy, so check the sources.
        </p>
      </div>
    </section>
  );
}
