import { useMemo, useState, type ReactNode } from "react";
import type { ConversationSummary } from "../types/api";
import {
  IconChat,
  IconLibrary,
  IconMic,
  IconMoon,
  IconPlus,
  IconResearch,
  IconSearch,
  IconSidebar,
  IconSun,
  IconX,
} from "./icons";

export type Mode = "chat" | "library" | "research" | "voice";

interface Props {
  mode: Mode;
  onMode: (m: Mode) => void;
  onNewChat: () => void;
  history: ConversationSummary[];
  activeConversation: string | null;
  onOpenConversation: (id: string) => void;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  readyCount: number;
  footer?: ReactNode;
}

const NAV: { mode: Mode; label: string; icon: ReactNode }[] = [
  { mode: "chat", label: "Chat", icon: <IconChat /> },
  { mode: "library", label: "Library", icon: <IconLibrary /> },
  { mode: "research", label: "Research", icon: <IconResearch /> },
  { mode: "voice", label: "Voice", icon: <IconMic /> },
];

export function Sidebar(p: Props) {
  const [query, setQuery] = useState("");
  const chats = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? p.history.filter((c) => c.title.toLowerCase().includes(q)) : p.history;
  }, [p.history, query]);
  const slim = p.collapsed && !p.mobileOpen;

  const item = (active: boolean) =>
    `flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors ${
      active ? "nav-active" : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
    } ${slim ? "justify-center" : ""}`;

  return (
    <>
      {p.mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={p.onCloseMobile} aria-hidden="true" />
      )}
      <aside
        aria-label="Main navigation"
        className={`fixed inset-y-0 start-0 z-40 glass-strong flex flex-col border-y-0 border-s-0 transition-[transform,width] duration-200 md:static md:translate-x-0 ${
          p.mobileOpen ? "translate-x-0" : "-translate-x-full rtl:translate-x-full"
        } ${slim ? "w-[68px]" : "w-[272px]"}`}
      >
        <div className={`flex items-center gap-2 px-3 py-3 ${slim ? "justify-center" : ""}`}>
          {!slim && (
            <div className="flex flex-1 items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-lg brand-mark text-sm font-bold">
                A
              </div>
              <h1 className="text-[15px] font-semibold tracking-tight text-ink">
                Astra <span className="text-accent">AI</span>
              </h1>
            </div>
          )}
          <button
            type="button"
            onClick={p.mobileOpen ? p.onCloseMobile : p.onToggleCollapsed}
            aria-label={p.mobileOpen ? "Close menu" : p.collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-surface hover:text-ink"
          >
            {p.mobileOpen ? <IconX /> : <IconSidebar />}
          </button>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={p.onNewChat}
            className={`flex w-full items-center gap-2 rounded-lg border border-[var(--glass-border)] bg-white/[0.03] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft ${
              slim ? "justify-center" : ""
            }`}
            aria-label="New chat"
          >
            <IconPlus />
            {!slim && "New chat"}
          </button>
        </div>

        <nav className="mt-3 space-y-0.5 px-3" aria-label="Modes">
          {NAV.map((n) => (
            <button
              key={n.mode}
              type="button"
              onClick={() => p.onMode(n.mode)}
              aria-current={p.mode === n.mode ? "page" : undefined}
              aria-label={slim ? n.label : undefined}
              title={slim ? n.label : undefined}
              className={item(p.mode === n.mode)}
            >
              <span className={p.mode === n.mode ? "text-accent" : "text-ink-3"}>{n.icon}</span>
              {!slim && <span className="flex-1 text-start">{n.label}</span>}
              {!slim && n.mode === "library" && p.readyCount > 0 && (
                <span className="rounded-full bg-surface px-1.5 text-[11px] text-ink-3">{p.readyCount}</span>
              )}
            </button>
          ))}
        </nav>

        {!slim && (
          <div className="mt-5 flex min-h-0 flex-1 flex-col px-3">
            <p className="px-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-3">Recent chats</p>
            {p.history.length > 4 && (
              <div className="relative mt-2">
                <IconSearch width={14} height={14} className="pointer-events-none absolute start-2.5 top-2.5 text-ink-3" />
                <label htmlFor="chat-search" className="sr-only">
                  Search chats
                </label>
                <input
                  id="chat-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search chats"
                  className="h-8 w-full rounded-lg border border-[var(--glass-border)] bg-black/20 ps-8 pe-2 text-xs focus:border-accent/50 focus:outline-none text-ink placeholder:text-ink-3"
                />
              </div>
            )}
            <ul className="scroll-thin mt-2 min-h-0 flex-1 space-y-0.5 overflow-y-auto pb-2">
              {chats.length === 0 && (
                <li className="px-2.5 py-2 text-xs text-ink-3">
                  {p.history.length ? "No matching chats" : "Your conversations will appear here."}
                </li>
              )}
              {chats.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => p.onOpenConversation(c.id)}
                    aria-current={p.activeConversation === c.id ? "true" : undefined}
                    dir="auto"
                    title={c.title}
                    className={`block w-full truncate rounded-lg px-2.5 py-1.5 text-start text-[13px] ${
                      p.activeConversation === c.id
                        ? "bg-accent-soft text-ink"
                        : "text-ink-2 hover:bg-white/[0.04] hover:text-ink"
                    }`}
                  >
                    {c.title || "Untitled chat"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {slim && <div className="flex-1" />}

        <div className="border-t border-[var(--glass-border)] p-3">
          {!slim && p.footer}
          <button
            type="button"
            onClick={p.onToggleTheme}
            className={item(false)}
            aria-label={p.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            {p.theme === "dark" ? <IconSun /> : <IconMoon />}
            {!slim && (p.theme === "dark" ? "Light theme" : "Dark theme")}
          </button>
        </div>
      </aside>
    </>
  );
}
