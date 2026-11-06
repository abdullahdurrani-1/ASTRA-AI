import { useState } from "react";
import { ApiError } from "../services/api";
import type { AstraDocument, DocumentStatus } from "../types/api";
import { IconAlert, IconBook, IconFile, IconRefresh, IconTrash } from "./icons";

// The real pipeline stages, in order. Progress is the stage reached, never an invented percentage.
export const STEPS: DocumentStatus[] = [
  "UPLOADED",
  "EXTRACTING",
  "CHUNKING",
  "EMBEDDING",
  "INDEXING",
  "VERIFYING",
  "READY",
];

export const STATUS_LABEL: Record<DocumentStatus, string> = {
  UPLOADED: "Queued",
  EXTRACTING: "Extracting text",
  CHUNKING: "Splitting into passages",
  EMBEDDING: "Creating embeddings",
  INDEXING: "Indexing",
  VERIFYING: "Verifying index",
  READY: "Ready",
  FAILED: "Failed",
};

export function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
}

interface Props {
  documents: AstraDocument[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
  onRetry: (id: string) => Promise<void>;
  onOpen?: (id: string) => void;
  emptyText?: string;
}

export function DocumentList({ documents, selected, onToggle, onDelete, onRetry, onOpen, emptyText }: Props) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function act(fn: () => Promise<void>) {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "Action failed.");
    }
  }

  if (!documents.length) {
    return (
      <p className="rounded-xl border border-dashed border-line p-6 text-center text-sm text-ink-3">
        {emptyText ?? "No documents yet. Upload a PDF or text file to get started."}
      </p>
    );
  }

  return (
    <div>
      {actionError && (
        <p role="alert" className="mb-2 text-sm text-danger">
          {actionError}
        </p>
      )}
      <ul className="space-y-2" aria-label="Your documents">
        {documents.map((d) => {
          const ready = d.status === "READY";
          const failed = d.status === "FAILED";
          const step = STEPS.indexOf(d.status);
          return (
            <li
              key={d.id}
              className={`glass rounded-xl p-3 transition-colors ${
                selected.has(d.id) ? "!border-accent/50 bg-accent-soft" : "hover:!border-[var(--border-strong)]"
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  id={`sel-${d.id}`}
                  type="checkbox"
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                  checked={selected.has(d.id)}
                  disabled={!ready}
                  onChange={() => onToggle(d.id)}
                  aria-describedby={`status-${d.id}`}
                  title={ready ? "Use in chat" : "Available once processing finishes"}
                />
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-hover text-ink-2">
                  <IconFile width={16} height={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <label
                    htmlFor={`sel-${d.id}`}
                    className="block truncate text-sm font-medium text-ink"
                    title={d.original_name}
                  >
                    {d.original_name}
                  </label>
                  <p id={`status-${d.id}`} className="mt-0.5 text-xs text-ink-3">
                    <span
                      className={
                        failed ? "font-semibold text-danger" : ready ? "font-semibold text-success" : "font-medium text-violet"
                      }
                    >
                      {STATUS_LABEL[d.status]}
                    </span>
                    {" · "}
                    {d.file_type.toUpperCase()} · {formatSize(d.size_bytes)}
                    {d.page_count ? ` · ${d.page_count} pages` : ""}
                    {ready ? ` · ${d.chunk_count} passages` : ""}
                  </p>
                  {!ready && !failed && (
                    <div className="mt-2">
                      <div
                        className="flex gap-1"
                        role="progressbar"
                        aria-label={`Processing ${d.original_name}`}
                        aria-valuemin={0}
                        aria-valuemax={STEPS.length - 1}
                        aria-valuenow={step}
                        aria-valuetext={STATUS_LABEL[d.status]}
                      >
                        {STEPS.slice(0, -1).map((s, i) => (
                          <span
                            key={s}
                            title={STATUS_LABEL[s]}
                            className={`h-1 flex-1 rounded-full ${
                              i < step ? "bg-crimson" : i === step ? "animate-pulse bg-accent" : "bg-line"
                            }`}
                          />
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-ink-3">
                        Step {step + 1} of {STEPS.length - 1}: {STATUS_LABEL[d.status]}
                      </p>
                    </div>
                  )}
                  {failed && d.error_message && <p className="mt-1 text-xs text-danger">{d.error_message}</p>}
                  {d.warnings.map((w) => (
                    <p key={w} className="mt-1 flex items-start gap-1 text-xs text-warn">
                      <IconAlert width={13} height={13} className="mt-0.5 shrink-0" /> {w}
                    </p>
                  ))}
                  {confirming === d.id && (
                    <div role="alertdialog" aria-label="Confirm delete" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft px-2.5 py-2 text-xs text-ink">
                      <span>Delete this document and its index?</span>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirming(null);
                          void act(() => onDelete(d.id));
                        }}
                        className="rounded-md bg-danger px-2 py-1 font-semibold text-white"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="rounded-md px-2 py-1 text-ink-2 hover:bg-surface-hover"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 gap-0.5 text-ink-3">
                  {ready && onOpen && (
                    <button
                      type="button"
                      onClick={() => onOpen(d.id)}
                      aria-label={`Open ${d.original_name} in reader`}
                      title="Open in reader"
                      className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-hover hover:text-accent"
                    >
                      <IconBook width={16} height={16} />
                    </button>
                  )}
                  {failed && (
                    <button
                      type="button"
                      onClick={() => void act(() => onRetry(d.id))}
                      aria-label={`Retry ${d.original_name}`}
                      title="Retry processing"
                      className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-hover hover:text-ink"
                    >
                      <IconRefresh width={16} height={16} />
                    </button>
                  )}
                  {(ready || failed) && (
                    <button
                      type="button"
                      onClick={() => setConfirming(d.id)}
                      aria-label={`Delete ${d.original_name}`}
                      title="Delete"
                      className="grid h-8 w-8 place-items-center rounded-lg hover:bg-danger-soft hover:text-danger"
                    >
                      <IconTrash width={16} height={16} />
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
