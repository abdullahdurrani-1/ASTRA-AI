// Minimal inline icon set (stroke icons, 24px grid). Decorative by default: pass a label to
// the surrounding button, not to the icon.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;

function Icon({ children, ...p }: P) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      width={18}
      height={18}
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconChat = (p: P) => (
  <Icon {...p}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
  </Icon>
);
export const IconLibrary = (p: P) => (
  <Icon {...p}>
    <path d="M4 19.5V5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2Zm0 0A2 2 0 0 0 6 22h12" />
    <path d="M9 7h6M9 11h4" />
  </Icon>
);
export const IconResearch = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
  </Icon>
);
export const IconMic = (p: P) => (
  <Icon {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </Icon>
);
export const IconPlus = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const IconSend = (p: P) => (
  <Icon {...p}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </Icon>
);
export const IconPaperclip = (p: P) => (
  <Icon {...p}>
    <path d="m21 11-8.6 8.6a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.4-2.4L15.5 7" />
  </Icon>
);
export const IconCopy = (p: P) => (
  <Icon {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h8" />
  </Icon>
);
export const IconCheck = (p: P) => (
  <Icon {...p}>
    <path d="m5 12 5 5 9-10" />
  </Icon>
);
export const IconSpeaker = (p: P) => (
  <Icon {...p}>
    <path d="M11 5 6 9H3v6h3l5 4V5Z" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
);
export const IconStop = (p: P) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </Icon>
);
export const IconMenu = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);
export const IconSidebar = (p: P) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </Icon>
);
export const IconX = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const IconSearch = (p: P) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
);
export const IconUpload = (p: P) => (
  <Icon {...p}>
    <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
  </Icon>
);
export const IconTrash = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </Icon>
);
export const IconRefresh = (p: P) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
  </Icon>
);
export const IconFile = (p: P) => (
  <Icon {...p}>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" />
    <path d="M14 3v6h6" />
  </Icon>
);
export const IconSun = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
);
export const IconMoon = (p: P) => (
  <Icon {...p}>
    <path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10Z" />
  </Icon>
);
export const IconBook = (p: P) => (
  <Icon {...p}>
    <path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2V4ZM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8V4Z" />
  </Icon>
);
export const IconSparkle = (p: P) => (
  <Icon {...p}>
    <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" />
  </Icon>
);
export const IconAlert = (p: P) => (
  <Icon {...p}>
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
);
export const IconArrowLeft = (p: P) => (
  <Icon {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Icon>
);
