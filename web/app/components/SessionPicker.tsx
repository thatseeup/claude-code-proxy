import {
  useNavigate,
  useRevalidator,
  useSearchParams,
} from "@remix-run/react";
import { ChevronDown, MessageSquareText, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { formatCostUSD } from "~/utils/pricing";

export interface SessionSummary {
  sessionId: string;
  firstTimestamp: string;
  lastTimestamp: string;
  requestCount: number;
  projectPath?: string;
  projectDisplayName?: string;
  title?: string;
  hasConversation?: boolean;
  totalCost?: number | null;
}

interface SessionPickerProps {
  sessions: SessionSummary[];
  activeSessionId: string; // URL token: real sessionId OR "unknown"
}

const UNKNOWN_TOKEN = "unknown";
const UNKNOWN_PROJECT = "Unknown";

function toUrlToken(sessionId: string): string {
  return sessionId === "" ? UNKNOWN_TOKEN : sessionId;
}

function shortLabel(sessionId: string): string {
  if (sessionId === "") return "Unknown";
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId;
}

export interface SessionGroup {
  projectDisplayName: string;
  latestTimestamp: string;
  sessions: SessionSummary[];
}

export function groupSessionsByProject(sessions: SessionSummary[]): SessionGroup[] {
  const groupMap = new Map<string, SessionSummary[]>();

  for (const s of sessions) {
    const key =
      s.hasConversation && s.projectDisplayName
        ? s.projectDisplayName
        : UNKNOWN_PROJECT;
    const group = groupMap.get(key);
    if (group) {
      group.push(s);
    } else {
      groupMap.set(key, [s]);
    }
  }

  const groups: SessionGroup[] = [];
  for (const [projectDisplayName, groupSessions] of groupMap.entries()) {
    groupSessions.sort((a, b) => {
      const ta = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
      const tb = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
      return tb - ta;
    });

    const latestTimestamp = groupSessions.reduce((best, s) => {
      const t = s.lastTimestamp ? new Date(s.lastTimestamp).getTime() : 0;
      return t > new Date(best).getTime() ? s.lastTimestamp : best;
    }, "");

    groups.push({ projectDisplayName, latestTimestamp, sessions: groupSessions });
  }

  groups.sort((a, b) => {
    if (a.projectDisplayName === UNKNOWN_PROJECT && b.projectDisplayName !== UNKNOWN_PROJECT) return 1;
    if (b.projectDisplayName === UNKNOWN_PROJECT && a.projectDisplayName !== UNKNOWN_PROJECT) return -1;
    const ta = a.latestTimestamp ? new Date(a.latestTimestamp).getTime() : 0;
    const tb = b.latestTimestamp ? new Date(b.latestTimestamp).getTime() : 0;
    return tb - ta;
  });

  return groups;
}

function formatFirstSeen(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function getActiveProjectName(activeSessionId: string, sessions: SessionSummary[]): string {
  if (activeSessionId === UNKNOWN_TOKEN) return UNKNOWN_PROJECT;
  const match = sessions.find((s) => toUrlToken(s.sessionId) === activeSessionId);
  if (!match) return UNKNOWN_PROJECT;
  return match.hasConversation && match.projectDisplayName
    ? match.projectDisplayName
    : UNKNOWN_PROJECT;
}

export default function SessionPicker({
  sessions,
  activeSessionId,
}: Readonly<SessionPickerProps>) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const projectRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();

  const modelQuery = searchParams.get("model");
  const projectParam = searchParams.get("project");
  const activeProjectName = getActiveProjectName(activeSessionId, sessions);

  const groups = useMemo(() => groupSessionsByProject(sessions), [sessions]);

  // The project displayed as "currently selected" in the project picker.
  // Follows: URL ?project= if present, else the active session's project.
  const selectedProject = projectParam ?? activeProjectName;

  const buildQuery = (project: string) => {
    const parts: string[] = [];
    if (modelQuery && modelQuery !== "all") {
      parts.push(`model=${encodeURIComponent(modelQuery)}`);
    }
    if (project) {
      parts.push(`project=${encodeURIComponent(project)}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
  };

  // Close dropdowns on outside click.
  useEffect(() => {
    if (!projectOpen && !sessionOpen) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (projectOpen && projectRef.current && !projectRef.current.contains(target)) {
        setProjectOpen(false);
      }
      if (sessionOpen && sessionRef.current && !sessionRef.current.contains(target)) {
        setSessionOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [projectOpen, sessionOpen]);

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

  const handleSelectProject = (projectDisplayName: string) => {
    setProjectOpen(false);
    const group = groups.find((g) => g.projectDisplayName === projectDisplayName);
    if (!group || group.sessions.length === 0) return;
    const latest = group.sessions[0];
    const token = toUrlToken(latest.sessionId);
    navigate(`/requests/${encodeURIComponent(token)}${buildQuery(projectDisplayName)}`);
  };

  const handleSelectSession = (token: string) => {
    setSessionOpen(false);
    if (token === activeSessionId) return;
    navigate(`/requests/${encodeURIComponent(token)}${buildQuery(selectedProject)}`);
  };

  const activeSummary = sessions.find(
    (s) => toUrlToken(s.sessionId) === activeSessionId,
  );

  const selectedGroup = groups.find((g) => g.projectDisplayName === selectedProject);
  const visibleSessions = selectedGroup ? selectedGroup.sessions : [];

  const triggerTitle = activeSummary?.title ?? null;
  const triggerShortId =
    activeSessionId === UNKNOWN_TOKEN ? "Unknown" : shortLabel(activeSessionId);

  return (
    <div className="flex flex-col gap-1 border-b border-gray-200 dark:border-slate-700 px-2 py-2 bg-white dark:bg-slate-900">
      {/* Project picker */}
      <div ref={projectRef} className="relative">
        <button
          type="button"
          onClick={() => setProjectOpen((v) => !v)}
          aria-expanded={projectOpen}
          aria-haspopup="listbox"
          aria-label="Switch project"
          className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs"
        >
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 shrink-0">
              Project
            </span>
            <span
              className={`truncate ${
                selectedProject === UNKNOWN_PROJECT
                  ? "italic text-gray-500 dark:text-gray-400"
                  : "text-gray-800 dark:text-gray-100"
              }`}
              title={selectedProject}
            >
              {selectedProject}
            </span>
            {selectedGroup ? (
              <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                ({selectedGroup.sessions.length})
              </span>
            ) : null}
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0 transition-transform ${
              projectOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {projectOpen && groups.length > 0 ? (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-full mt-1 z-20 max-h-60 overflow-auto rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg"
          >
            <ul className="py-1">
              {groups.map((g) => {
                const isSelected = g.projectDisplayName === selectedProject;
                return (
                  <li key={g.projectDisplayName}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelectProject(g.projectDisplayName)}
                      className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-slate-700 ${
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                          : "text-gray-700 dark:text-gray-300"
                      }`}
                    >
                      <span
                        className={`truncate ${
                          g.projectDisplayName === UNKNOWN_PROJECT
                            ? "italic text-gray-400 dark:text-gray-500"
                            : ""
                        }`}
                        title={g.projectDisplayName}
                      >
                        {g.projectDisplayName}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-400 dark:text-gray-500">
                        ({g.sessions.length})
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {/* Session picker */}
      <div ref={sessionRef} className="relative flex items-center gap-1">
        <button
          type="button"
          onClick={() => setSessionOpen((v) => !v)}
          aria-expanded={sessionOpen}
          aria-haspopup="listbox"
          aria-label="Switch session"
          className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs"
        >
          <div className="min-w-0 flex flex-col items-start">
            {triggerTitle ? (
              <span
                className="font-medium text-gray-800 dark:text-gray-100 truncate max-w-full"
                title={triggerTitle}
              >
                {triggerTitle}
              </span>
            ) : (
              <span className="font-medium italic text-gray-500 dark:text-gray-400 truncate max-w-full">
                Untitled session
              </span>
            )}
            <span
              className="font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate max-w-full"
              title={activeSessionId === UNKNOWN_TOKEN ? "Unknown" : activeSessionId}
            >
              {triggerShortId}
            </span>
            {activeSummary ? (
              (() => {
                const costText = formatCostUSD(activeSummary.totalCost ?? null);
                return (
                  <span className="w-full flex items-center justify-between gap-2 text-[10px]">
                    <span className="flex items-center gap-1 min-w-0 text-gray-500 dark:text-gray-400">
                      <span>{activeSummary.requestCount} req</span>
                      {costText ? (
                        <>
                          <span>·</span>
                          <span className="text-gray-700 dark:text-gray-300">
                            {costText}
                          </span>
                        </>
                      ) : null}
                    </span>
                    <span className="ml-auto shrink-0 text-gray-500 dark:text-gray-400">
                      {formatFirstSeen(activeSummary.lastTimestamp)}
                    </span>
                  </span>
                );
              })()
            ) : null}
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0 transition-transform ${
              sessionOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => {
            if (activeSummary?.hasConversation && activeSummary.projectPath) {
              navigate(
                `/conversations/${encodeURIComponent(activeSummary.projectPath)}?sid=${encodeURIComponent(activeSessionId === UNKNOWN_TOKEN ? "" : activeSessionId)}`,
              );
            }
          }}
          disabled={!activeSummary?.hasConversation}
          aria-label="Go to Conversations"
          title={
            activeSummary?.hasConversation
              ? "Go to Conversations"
              : "No matching conversation"
          }
          className="shrink-0 p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
        >
          <MessageSquareText className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting || sessions.length === 0}
          aria-label={`Delete session ${triggerShortId}`}
          title="Delete session"
          className="shrink-0 p-1.5 rounded text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {sessionOpen && visibleSessions.length > 0 ? (
          <div
            role="listbox"
            className="absolute left-0 right-0 top-full mt-1 z-20 max-h-80 overflow-auto rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg"
          >
            <ul className="py-1">
              {visibleSessions.map((s) => {
                const token = toUrlToken(s.sessionId);
                const isActive = token === activeSessionId;
                return (
                  <li key={token}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      onClick={() => handleSelectSession(token)}
                      className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${
                        isActive ? "bg-blue-50 dark:bg-blue-900/40" : ""
                      }`}
                    >
                      {s.title ? (
                        <div
                          className="font-medium text-gray-800 dark:text-gray-100 truncate"
                          title={s.title}
                        >
                          {s.title}
                        </div>
                      ) : (
                        <div className="italic text-gray-400 dark:text-gray-500 truncate">
                          Untitled session
                        </div>
                      )}
                      <div
                        className="font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate mt-0.5"
                        title={s.sessionId || "Unknown"}
                      >
                        {s.sessionId || "Unknown"}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px] mt-0.5">
                        <span className="flex items-center gap-1 min-w-0 text-gray-500 dark:text-gray-400">
                          <span>{s.requestCount} req</span>
                          {(() => {
                            const costText = formatCostUSD(s.totalCost ?? null);
                            return costText ? (
                              <>
                                <span>·</span>
                                <span className="text-gray-700 dark:text-gray-300">
                                  {costText}
                                </span>
                              </>
                            ) : null;
                          })()}
                        </span>
                        <span className="ml-auto shrink-0 text-gray-500 dark:text-gray-400">
                          {formatFirstSeen(s.lastTimestamp)}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
