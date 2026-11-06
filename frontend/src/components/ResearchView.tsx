import { useState, type ReactNode } from "react";
import type { AstraDocument, Citation } from "../types/api";
import { DocumentReader } from "./DocumentReader";
import { IconFile, IconSidebar } from "./icons";

interface Props {
  documents: AstraDocument[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  activeId: string | null;
  onOpen: (id: string) => void;
  page: number | null;
  onPage: (page: number) => void;
  citation?: Citation;
  onClearCitation: () => void;
  chat: ReactNode;
}

export function ResearchView(p: Props) {
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [mobileTab, setMobileTab] = useState<"doc" | "chat">("doc");
  const ready = p.documents.filter((d) => d.status === "READY");
  const active = ready.find((d) => d.id === p.activeId) ?? null;

  return (
    <section aria-label="Research workspace" className="flex h-full min-h-0 flex-col">
      {/* Mobile: one panel at a time. */}
      <div role="tablist" aria-label="Research panels" className="flex border-b border-line lg:hidden">
        {(["doc", "chat"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={mobileTab === t}
            onClick={() => setMobileTab(t)}
            className={`flex-1 py-2.5 text-sm ${
              mobileTab === t ? "border-b-2 border-accent text-ink" : "text-ink-3"
            }`}
          >
            {t === "doc" ? "Document" : "Chat"}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        <aside
          aria-label="Research sources"
          className={`glass-strong hidden shrink-0 flex-col border-y-0 border-s-0 lg:flex ${sourcesOpen ? "w-64" : "w-12"}`}
        >
          <div className="flex items-center gap-2 px-3 py-2">
            {sourcesOpen && (
              <p className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Sources</p>
            )}
            <button
              type="button"
              onClick={() => setSourcesOpen((o) => !o)}
              aria-label={sourcesOpen ? "Collapse sources" : "Expand sources"}
              className="grid h-7 w-7 place-items-center rounded-md text-ink-3 hover:bg-surface hover:text-ink"
            >
              <IconSidebar width={16} height={16} />
            </button>
          </div>
          {sourcesOpen && (
            <ul className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
              {ready.length === 0 && <li className="px-2 text-xs text-ink-3">No ready documents yet.</li>}
              {ready.map((d) => (
                <li
                  key={d.id}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                    d.id === p.activeId ? "nav-active" : "hover:bg-white/[0.04]"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={p.selected.has(d.id)}
                    onChange={() => p.onToggle(d.id)}
                    aria-label={`Search ${d.original_name}`}
                    title="Include in questions"
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                  <button
                    type="button"
                    onClick={() => p.onOpen(d.id)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-start text-xs text-ink-2 hover:text-ink"
                    title={d.original_name}
                  >
                    <IconFile width={14} height={14} className="shrink-0" />
                    <span className="truncate">{d.original_name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className={`min-w-0 flex-1 ${mobileTab === "doc" ? "flex" : "hidden"} flex-col lg:flex`}>
          {!active && ready.length > 0 && (
            <div className="border-b border-line px-3 py-2 lg:hidden">
              <label htmlFor="mobile-doc" className="sr-only">
                Document
              </label>
              <select
                id="mobile-doc"
                value=""
                onChange={(e) => p.onOpen(e.target.value)}
                className="h-9 w-full rounded-lg border border-line bg-surface px-2 text-sm text-ink"
              >
                <option value="">Choose a document…</option>
                {ready.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.original_name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="min-h-0 flex-1">
            <DocumentReader
              document={active}
              page={p.page}
              citation={p.citation}
              onPageChange={p.onPage}
              onClearCitation={p.onClearCitation}
            />
          </div>
        </div>

        <div
          className={`glass min-w-0 border-y-0 border-e-0 lg:w-[420px] lg:shrink-0 ${
            mobileTab === "chat" ? "flex flex-1" : "hidden"
          } flex-col lg:flex`}
        >
          {p.chat}
        </div>
      </div>
    </section>
  );
}
