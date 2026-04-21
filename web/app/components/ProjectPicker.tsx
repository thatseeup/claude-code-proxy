import { useNavigate } from "@remix-run/react";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ProjectSummary {
  projectPath: string;
  displayName: string;
  lastMTime: string;
  conversationCount: number;
}

interface ProjectPickerProps {
  projects: ProjectSummary[];
  activeProjectId: string; // URL-decoded projectPath
}

function formatLastMTime(iso: string): string {
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

export default function ProjectPicker({
  projects,
  activeProjectId,
}: Readonly<ProjectPickerProps>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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

  const handleSelect = (projectPath: string) => {
    setOpen(false);
    if (projectPath === activeProjectId) return;
    // Switching projects: drop the `?sid=` query (only meaningful within
    // the previously selected project).
    navigate(`/conversations/${encodeURIComponent(projectPath)}`);
  };

  const activeSummary = projects.find((p) => p.projectPath === activeProjectId);
  const activeDisplayName = activeSummary?.displayName ?? activeProjectId;
  const activeProjectPath = activeSummary?.projectPath ?? activeProjectId;

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
        aria-label="Switch project"
        className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 text-xs"
      >
        <div className="min-w-0 flex flex-col items-start">
          <span
            className="font-medium truncate text-gray-800 dark:text-gray-100 w-full text-left"
            title={activeProjectPath}
          >
            {activeDisplayName}
          </span>
          <span
            className="text-[10px] text-gray-500 dark:text-gray-400 font-mono truncate w-full text-left"
            title={activeProjectPath}
          >
            {activeProjectPath}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && projects.length > 0 ? (
        <div
          role="listbox"
          className="absolute left-2 right-2 top-full mt-1 z-20 max-h-80 overflow-auto rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg"
        >
          <ul className="py-1">
            {projects.map((p) => {
              const isActive = p.projectPath === activeProjectId;
              return (
                <li key={p.projectPath}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => handleSelect(p.projectPath)}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-700 ${
                      isActive ? "bg-blue-50 dark:bg-blue-900/40" : ""
                    }`}
                    title={p.projectPath}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate text-gray-800 dark:text-gray-100">
                        {p.displayName}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-500 dark:text-gray-400">
                        {p.conversationCount}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono mt-0.5 truncate">
                      {p.projectPath}
                    </div>
                    <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
                      {formatLastMTime(p.lastMTime)}
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
