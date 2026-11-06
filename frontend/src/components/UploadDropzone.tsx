import { useRef, useState, type DragEvent } from "react";
import { ApiError } from "../services/api";
import { IconUpload } from "./icons";

interface Props {
  maxMb: number;
  extensions: string[];
  ocr: boolean;
  onUpload: (file: File) => Promise<unknown>;
  disabled?: boolean;
}

export function UploadDropzone({ maxMb, extensions, ocr, onUpload, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function handle(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
    // Quick client-side hints; the server re-validates everything.
    if (!extensions.includes(ext)) {
      setMessage({ kind: "error", text: `Unsupported type. Use ${extensions.join(", ")}.` });
      return;
    }
    if (file.size > maxMb * 1024 * 1024) {
      setMessage({ kind: "error", text: `File is larger than ${maxMb} MB.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await onUpload(file);
      // Uploaded is not indexed: the list below shows the real processing status.
      setMessage({ kind: "success", text: `“${file.name}” uploaded. Processing has started.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof ApiError ? e.message : "Upload failed." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    if (!disabled && !busy) void handle(e.dataTransfer.files);
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-2xl border border-dashed p-6 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "glass border-dashed !border-[var(--border-strong)]"
        }`}
      >
        <div className="brand-mark mx-auto mb-3 grid h-10 w-10 place-items-center rounded-xl">
          <IconUpload />
        </div>
        <p className="text-sm text-ink">
          Drag a file here, or{" "}
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={disabled || busy}
            className="font-semibold text-accent underline-offset-2 hover:underline disabled:opacity-50"
          >
            {busy ? "uploading…" : "browse"}
          </button>
        </p>
        <p className="mt-1 text-xs text-ink-3">
          {extensions.map((e) => e.slice(1).toUpperCase()).join(", ")} · up to {maxMb} MB ·{" "}
          {ocr ? "scanned PDFs are read with OCR (slower)" : "scanned PDFs need OCR, which is off"}
        </p>
        <input
          ref={input}
          type="file"
          accept={extensions.join(",")}
          className="sr-only"
          aria-label="Upload a document"
          onChange={(e) => void handle(e.target.files)}
        />
      </div>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`mt-2 text-sm ${message.kind === "error" ? "text-danger" : "text-accent"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
