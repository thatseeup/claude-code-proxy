import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useState, type ReactNode } from "react";

interface CollapsibleSidebarProps {
  children: ReactNode;
  title?: string;
  defaultOpen?: boolean;
}

/**
 * CollapsibleSidebar wraps sidebar content with a manual open/close toggle.
 *
 * State is held in-component only — never persisted to localStorage or the
 * server. On every mount the sidebar starts in `defaultOpen` state
 * (default: true). Route changes and selection inside `children` do not
 * auto-close the sidebar; only the user-facing toggle button does.
 */
export default function CollapsibleSidebar({
  children,
  title,
  defaultOpen = true,
}: Readonly<CollapsibleSidebarProps>) {
  const [open, setOpen] = useState<boolean>(defaultOpen);

  if (!open) {
    return (
      <div className="shrink-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={title ? `Open ${title} sidebar` : "Open sidebar"}
          title={title ? `Open ${title}` : "Open sidebar"}
          className="inline-flex items-center justify-center w-8 h-8 rounded border border-gray-200 bg-white text-gray-500 hover:text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <PanelLeftOpen className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 relative">
      <div className="absolute top-1 right-1 z-10">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={title ? `Close ${title} sidebar` : "Close sidebar"}
          title={title ? `Close ${title}` : "Close sidebar"}
          className="inline-flex items-center justify-center w-6 h-6 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <PanelLeftClose className="w-4 h-4" />
        </button>
      </div>
      {children}
    </div>
  );
}
