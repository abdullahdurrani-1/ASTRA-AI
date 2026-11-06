import type { AstraDocument } from "../types/api";

interface Props {
  documents: AstraDocument[];
  selected: Set<string>;
  onToggle: (id: string) => void;
}

/** Chooses which ready documents the next question searches. Only real, READY documents. */
export function SourcePicker({ documents, selected, onToggle }: Props) {
  const ready = documents.filter((d) => d.status === "READY");
  const processing = documents.length - ready.length;
  return (
    <fieldset className="mb-2 min-w-0">
      <legend className="sr-only">Sources for your question</legend>
      <div className="scroll-thin flex items-center gap-1.5 overflow-x-auto pb-1">
        <span className="shrink-0 text-[11px] font-medium uppercase tracking-wider text-ink-3">
          Sources
        </span>
        {ready.length === 0 && (
          <span className="text-xs text-ink-3">
            {processing ? `${processing} document(s) still processing…` : "No ready documents yet"}
          </span>
        )}
        {ready.map((d) => {
          const on = selected.has(d.id);
          return (
            <label
              key={d.id}
              className={`flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                on ? "border-accent/50 bg-accent-soft text-accent" : "glass text-ink-2 hover:border-accent/30 hover:text-ink"
              }`}
              title={d.original_name}
            >
              <input
                type="checkbox"
                className="sr-only"
                aria-label={d.original_name}
                checked={on}
                onChange={() => onToggle(d.id)}
              />
              <span aria-hidden="true">{on ? "✓" : "+"}</span>
              <span className="truncate">{d.original_name}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
