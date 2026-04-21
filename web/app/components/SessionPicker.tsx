import {
  useNavigate,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import { ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface SessionSummary {
  sessionId: string;
  firstTimestamp: string;
  lastTimestamp: string;
  requestCount: number;
}

interface SessionPickerProps {
  sessions: SessionSummary[];
  activeSessionId: string; // URL token: real sessionId OR "unknown"
}

const UNKNOWN_TOKEN = "unknown";

function toUrlToken(sessionId: string): string {
  return sessionId === "" ? UNKNOWN_TOKEN : sessionId;
}

function shortLabel(sessionId: string): string {
  if (sessionId === "") return "Unknown";
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

function fullLabelForToken(token: string, sessions: SessionSummary[]): string {
  if (token === UNKNOWN_TOKEN) return "Unknown";
  const match = sessions.find((s) => toUrlToken(s.sessionId) === token);
  if (!match) return shortLabel(token);
  return shortLabel(match.sessionId);
}

function formatFirstSeen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

export default function SessionPicker({
  sessions,
  activeSessionId,
}: Readonly<SessionPickerProps>) {
  const [open, setOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();

  // Preserve `?model=` query when navigating between sessions.
  const modelQuery = searchParams.get("model");
  const querySuffix =
    modelQuery && modelQuery !== "all"
      ? `?model=${encodeURIComponent(modelQuery)}`
      : "";

  // Close dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const handleDelete = async () => {
    if (isDeleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(activeSessionId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        throw new Error(`Failed to delete session (status ${res.status})`);
      }
      revalidator.revalidate();
      navigate("/requests");
    } catch (err) {
      console.error("Failed to delete session:", err);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleSelect = (token: string) => {
    setOpen(false);
    if (token === activeSessionId) return;
    navigate(`/requests/${encodeURIComponent(token)}${querySuffix}`);
  };

  const activeLabel = fullLabelForToken(activeSessionId, sessions);
  const activeSummary = sessions.find(
    (s) => toUrlToken(s.sessionId) === activeSessionId,
  );

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1 border-b border-gray-200 dark:border-slate-700 px-2 py-2 bg-white dark:bg-slate-900"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Switch session"
        className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs"
      >
        <div className="min-w-0 flex flex-col items-start">
          <span
            className={`font-mono truncate ${
              activeSessionId === UNKNOWN_TOKEN
                ? "italic text-gray-500 dark:text-gray-400"
                : "text-gray-800 dark:text-gray-100"
            }`}
            title={activeSessionId === UNKNOWN_TOKEN ? "Unknown" : activeSessionId}
          >
            {activeLabel}
          </span>
          {activeSummary ? (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {activeSummary.requestCount} req ·{" "}
              {formatFirstSeen(activeSummary.firstTimestamp)}
            </span>
          ) : null}
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        disabled={isDeleting || sessions.length === 0}
        aria-label={`Delete session ${activeLabel}`}
        title="Delete session"
        className="shrink-0 p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {open && sessions.length > 0 ? (
        <div
          role="listbox"
          className="absolute left-2 right-2 top-full mt-1 z-20 max-h-80 overflow-auto rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg"
        >
          <ul className="py-1">
            {sessions.map((s) => {
              const token = toUrlToken(s.sessionId);
              const isActive = token === activeSessionId;
              return (
                <li key={token}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(token)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${
                      isActive ? "bg-blue-50 dark:bg-blue-900/40" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`font-mono truncate ${
                          s.sessionId === ""
                            ? "italic text-gray-500 dark:text-gray-400"
                            : "text-gray-800 dark:text-gray-100"
                        }`}
                        title={s.sessionId || "Unknown"}
                      >
                        {shortLabel(s.sessionId)}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                        {s.requestCount}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatFirstSeen(s.firstTimestamp)}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
