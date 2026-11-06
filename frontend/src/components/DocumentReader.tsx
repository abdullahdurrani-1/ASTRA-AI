import { useEffect, useState, type FormEvent } from "react";
import { api } from "../services/api";
import type { AstraDocument, Citation } from "../types/api";
import { IconBook, IconX } from "./icons";

interface Props {
  document: AstraDocument | null;
  page: number | null;
  citation?: Citation;
  onPageChange: (page: number) => void;
  onClearCitation: () => void;
}

/**
 * Uses the browser's built-in PDF viewer (zoom, search, text selection) at the cited page.
 * Passage highlighting needs character offsets the backend doesn't store yet, so the cited
 * excerpt is shown beside the page instead of a fabricated highlight.
 */
export function DocumentReader({ document, page, citation, onPageChange, onClearCitation }: Props) {
  const [pageInput, setPageInput] = useState(String(page ?? 1));
  useEffect(() => setPageInput(String(page ?? 1)), [page, document?.id]);

  if (!document) {
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div>
          <div className="glass mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl text-accent">
            <IconBook />
          </div>
          <p className="text-sm font-medium text-ink">No document open</p>
          <p className="mt-1 text-xs text-ink-3">Pick a ready document, or open a citation from an answer.</p>
        </div>
      </div>
    );
  }

  const isPdf = document.file_type === "pdf";
  const total = document.page_count ?? undefined;
  const current = page ?? 1;
  const src = `${api.fileUrl(document.id)}${isPdf ? `#page=${current}` : ""}`;

  function go(e: FormEvent) {
    e.preventDefault();
    const n = Number(pageInput);
    if (Number.isInteger(n) && n >= 1 && (!total || n <= total)) onPageChange(n);
    else setPageInput(String(current));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="glass flex flex-wrap items-center gap-2 border-x-0 border-t-0 px-3 py-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={document.original_name}>
          {document.original_name}
        </p>
        {isPdf && (
          <form onSubmit={go} className="flex items-center gap-1 text-xs text-ink-2">
            <button
              type="button"
              onClick={() => current > 1 && onPageChange(current - 1)}
              disabled={current <= 1}
              aria-label="Previous page"
              className="h-7 w-7 rounded-md hover:bg-surface-hover disabled:opacity-35"
            >
              ‹
            </button>
            <label htmlFor="reader-page" className="sr-only">
              Page number
            </label>
            <input
              id="reader-page"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              inputMode="numeric"
              className="h-7 w-12 rounded-md border border-[var(--glass-border)] bg-black/25 text-center text-ink focus:border-accent/50 focus:outline-none"
            />
            <span>/ {total ?? "?"}</span>
            <button
              type="button"
              onClick={() => (!total || current < total) && onPageChange(current + 1)}
              disabled={!!total && current >= total}
              aria-label="Next page"
              className="h-7 w-7 rounded-md hover:bg-surface-hover disabled:opacity-35"
            >
              ›
            </button>
          </form>
        )}
      </div>

      {citation && (
        <div className="flex items-start gap-2 border-b border-line bg-accent-soft px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-accent">
              Cited passage{citation.page_start != null ? ` · page ${citation.page_start}` : ""}
            </p>
            <p dir="auto" className="mt-0.5 line-clamp-3 text-ink-2">
              {citation.excerpt}
            </p>
          </div>
          <button
            type="button"
            onClick={onClearCitation}
            aria-label="Dismiss cited passage"
            className="grid h-6 w-6 place-items-center rounded text-ink-3 hover:bg-surface-hover"
          >
            <IconX width={14} height={14} />
          </button>
        </div>
      )}

      {/* Keyed by page: browsers only honour #page= on a fresh load. */}
      <iframe
        key={src}
        title={`${document.original_name} reader`}
        src={src}
        className="min-h-0 w-full flex-1 bg-white shadow-[inset_0_0_0_1px_var(--glass-border)]"
      />
    </div>
  );
}
