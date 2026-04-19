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
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
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
      className="relative flex items-center gap-1 border-b border-gray-200 px-2 py-2 bg-white"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Switch project"
        className="flex-1 min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-gray-200 bg-white hover:bg-gray-50 text-xs"
      >
        <div className="min-w-0 flex flex-col items-start">
          <span
            className="font-medium truncate text-gray-800 w-full text-left"
            title={activeProjectPath}
          >
            {activeDisplayName}
          </span>
          <span
            className="text-[10px] text-gray-500 font-mono truncate w-full text-left"
            title={activeProjectPath}
          >
            {activeProjectPath}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && projects.length > 0 ? (
        <div
          role="listbox"
          className="absolute left-2 right-2 top-full mt-1 z-20 max-h-80 overflow-auto rounded border border-gray-200 bg-white shadow-lg"
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
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${
                      isActive ? "bg-blue-50" : ""
                    }`}
                    title={p.projectPath}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium truncate text-gray-800">
                        {p.displayName}
                      </span>
                      <span className="shrink-0 text-[10px] text-gray-500">
                        {p.conversationCount}
                      </span>
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono mt-0.5 truncate">
                      {p.projectPath}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-0.5">
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
