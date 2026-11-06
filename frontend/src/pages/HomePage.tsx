import { useCallback, useEffect, useMemo, useState } from "react";
import { ChatPanel } from "../components/ChatPanel";
import { IconMenu } from "../components/icons";
import { LibraryView } from "../components/LibraryView";
import { ResearchView } from "../components/ResearchView";
import { Sidebar, type Mode } from "../components/Sidebar";
import { SourcePicker } from "../components/SourcePicker";
import { VoiceView } from "../components/VoiceView";
import { useChatSession } from "../hooks/useChatSession";
import { useDocuments } from "../hooks/useDocuments";
import { useOnline } from "../hooks/useOnline";
import { api, ApiError } from "../services/api";
import type { CitationTarget, Health } from "../types/api";

type Theme = "dark" | "light";

// Per-browser UI preferences only; never application data.
function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference just won't persist */
  }
}

const MODE_TITLE: Record<Mode, string> = {
  chat: "Chat",
  library: "Library",
  research: "Research",
  voice: "Voice",
};

export function HomePage() {
  const online = useOnline();
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const { documents, loading, error, refresh, upload, remove, retry } = useDocuments();
  const session = useChatSession();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Mode>("chat");
  const [theme, setTheme] = useState<Theme>(() => readPref("astra.theme", "dark", ["dark", "light"]));
  const [collapsed, setCollapsed] = useState(() => readPref("astra.sidebar", "open", ["open", "slim"]) === "slim");
  const [mobileNav, setMobileNav] = useState(false);
  const [reader, setReader] = useState<CitationTarget | null>(null);

  async function loadHealth() {
    try {
      setHealth(await api.health());
      setHealthError(null);
    } catch (e) {
      setHealthError(e instanceof ApiError ? e.message : "Server unavailable.");
    }
  }

  useEffect(() => {
    void loadHealth();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    writePref("astra.theme", theme);
  }, [theme]);

  // Keep the selection limited to documents that still exist and are READY.
  const readyIds = useMemo(
    () => new Set(documents.filter((d) => d.status === "READY").map((d) => d.id)),
    [documents],
  );
  const selectedIds = useMemo(() => [...selected].filter((id) => readyIds.has(id)), [selected, readyIds]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  async function handleUpload(file: File) {
    const doc = await upload(file);
    setSelected((s) => new Set(s).add(doc.id)); // becomes usable once READY
    return doc;
  }

  function go(m: Mode) {
    setMode(m);
    setMobileNav(false);
  }

  function openDocument(id: string) {
    setReader({ documentId: id, page: 1 });
    go("research");
  }

  function openCitation(target: CitationTarget) {
    setReader(target);
    go("research");
  }

  if (healthError && !health) {
    return (
      <main className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl brand-mark text-lg font-bold">
            A
          </div>
          <h1 className="text-xl font-semibold text-ink">Astra AI</h1>
          <p role="alert" className="mt-3 text-sm text-danger">
            {healthError}
          </p>
          <button
            type="button"
            onClick={() => {
              void loadHealth();
              void refresh();
            }}
            className="btn-primary mt-5 rounded-lg px-4 py-2 text-sm font-semibold"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const stt = !!health?.voice.stt;
  const tts = !!health?.voice.tts;
  const extensions = (health?.limits.allowed_extensions as string[]) ?? [".pdf", ".txt", ".md"];
  const maxMb = (health?.limits.max_upload_mb as number) ?? 25;

  const chatPanel = (compact: boolean) => (
    <ChatPanel
      session={session}
      documentIds={selectedIds}
      sttEnabled={stt}
      ttsEnabled={tts}
      online={online}
      allowedExtensions={extensions}
      onAttach={handleUpload}
      onOpenCitation={openCitation}
      compact={compact}
      toolbar={
        <div className={compact ? "lg:hidden" : ""}>
          <SourcePicker documents={documents} selected={selectedSet} onToggle={toggle} />
        </div>
      }
    />
  );

  return (
    <div className="flex h-full">
      <Sidebar
        mode={mode}
        onMode={go}
        onNewChat={() => {
          session.newChat();
          go("chat");
        }}
        history={session.history}
        activeConversation={session.conversationId}
        onOpenConversation={(id) => {
          void session.open(id);
          go("chat");
        }}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        collapsed={collapsed}
        onToggleCollapsed={() =>
          setCollapsed((c) => {
            writePref("astra.sidebar", c ? "open" : "slim");
            return !c;
          })
        }
        mobileOpen={mobileNav}
        onCloseMobile={() => setMobileNav(false)}
        readyCount={readyIds.size}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass-strong flex items-center gap-2 border-x-0 border-t-0 px-3 py-2 md:hidden">
          <button
            type="button"
            onClick={() => setMobileNav(true)}
            aria-label="Open menu"
            className="grid h-9 w-9 place-items-center rounded-lg text-ink-2 hover:bg-surface"
          >
            <IconMenu />
          </button>
          <p className="text-sm font-semibold text-ink">
            Astra <span className="text-accent">AI</span>
            <span className="font-normal text-ink-3"> · {MODE_TITLE[mode]}</span>
          </p>
        </header>
        {health?.mock_mode && (
          <p
            className="border-b border-warn/30 bg-warn-soft px-4 py-1.5 text-center text-xs font-medium text-warn"
            title={`Embeddings: ${health.providers.embeddings}, LLM: ${health.providers.llm}`}
          >
            Development mock mode — answers are not from a real AI model
          </p>
        )}

        <main className="min-h-0 flex-1">
          {mode === "chat" && chatPanel(false)}
          {mode === "library" && (
            <LibraryView
              documents={documents}
              loading={loading}
              error={error}
              onRefresh={() => void refresh()}
              selected={selectedSet}
              onToggle={toggle}
              onUpload={handleUpload}
              onDelete={remove}
              onRetry={retry}
              onOpen={openDocument}
              maxMb={maxMb}
              extensions={extensions}
              ocr={!!health?.features?.ocr}
              online={online}
            />
          )}
          {mode === "research" && (
            <ResearchView
              documents={documents}
              selected={selectedSet}
              onToggle={toggle}
              activeId={reader?.documentId ?? null}
              onOpen={(id) => setReader({ documentId: id, page: 1 })}
              page={reader?.page ?? null}
              onPage={(page) => setReader((r) => (r ? { ...r, page, citation: undefined } : r))}
              citation={reader?.citation}
              onClearCitation={() => setReader((r) => (r ? { ...r, citation: undefined } : r))}
              chat={chatPanel(true)}
            />
          )}
          {mode === "voice" && (
            <VoiceView
              session={session}
              documentIds={selectedIds}
              sttEnabled={stt}
              ttsEnabled={tts}
              online={online}
              onBack={() => go("chat")}
            />
          )}
        </main>
      </div>
    </div>
  );
}
