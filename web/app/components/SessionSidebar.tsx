import { Link, useFetcher, useNavigate } from "@remix-run/react";
import { Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

export interface SessionSummary {
  sessionId: string;
  firstTimestamp: string;
  lastTimestamp: string;
  requestCount: number;
}

interface SessionSidebarProps {
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

function formatFirstSeen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

interface SessionRowProps {
  session: SessionSummary;
  activeSessionId: string;
}

function SessionRow({ session, activeSessionId }: Readonly<SessionRowProps>) {
  const token = toUrlToken(session.sessionId);
  const isActive = token === activeSessionId;
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const wasSubmittingRef = useRef(false);

  const isDeleting =
    fetcher.state === "submitting" || fetcher.state === "loading";

  // After a successful delete fetcher cycle, if the deleted item was the
  // active session, navigate back to /requests so the parent loader
  // auto-redirects to the next most-recent session (or empty state).
  useEffect(() => {
    if (wasSubmittingRef.current && fetcher.state === "idle") {
      wasSubmittingRef.current = false;
      if (isActive) {
        navigate("/requests");
      }
    }
    if (fetcher.state === "submitting") {
      wasSubmittingRef.current = true;
    }
  }, [fetcher.state, isActive, navigate]);

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fetcher.submit(null, {
      method: "delete",
      action: `/api/sessions/${encodeURIComponent(token)}`,
    });
  };

  return (
    <li>
      <div
        className={`group flex items-stretch rounded text-xs transition-colors ${
          isActive
            ? "bg-blue-50 border border-blue-200"
            : "border border-transparent hover:bg-gray-50"
        } ${isDeleting ? "opacity-50" : ""}`}
      >
        <Link
          to={`/requests/${encodeURIComponent(token)}`}
          className={`flex-1 min-w-0 px-2 py-2 ${
            isActive ? "text-blue-900" : "text-gray-800"
          }`}
          aria-current={isActive ? "page" : undefined}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={`font-mono truncate ${
                session.sessionId === "" ? "italic text-gray-500" : ""
              }`}
              title={session.sessionId || "Unknown"}
            >
              {shortLabel(session.sessionId)}
            </span>
            <span className="shrink-0 text-[10px] text-gray-500">
              {session.requestCount}
            </span>
          </div>
          <div className="text-[10px] text-gray-500 mt-0.5">
            {formatFirstSeen(session.firstTimestamp)}
          </div>
        </Link>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label={`Delete session ${shortLabel(session.sessionId)}`}
          title="Delete session"
          className="shrink-0 px-2 flex items-center justify-center text-gray-400 hover:text-red-600 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-30"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
}: Readonly<SessionSidebarProps>) {
  if (sessions.length === 0) {
    return (
      <aside
        className="w-64 shrink-0 border border-gray-200 bg-white rounded-lg p-3 min-h-[480px]"
        aria-label="Sessions"
      >
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 mb-2">
          Sessions
        </div>
        <p className="text-xs text-gray-500 px-1">No sessions yet.</p>
      </aside>
    );
  }

  return (
    <aside
      className="w-64 shrink-0 border border-gray-200 bg-white rounded-lg p-2 min-h-[480px]"
      aria-label="Sessions"
    >
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-2">
        Sessions
      </div>
      <ul className="space-y-0.5">
        {sessions.map((s) => (
          <SessionRow
            key={toUrlToken(s.sessionId)}
            session={s}
            activeSessionId={activeSessionId}
          />
        ))}
      </ul>
    </aside>
  );
}
