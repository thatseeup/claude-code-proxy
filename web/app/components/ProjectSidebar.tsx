import { Link } from "@remix-run/react";

export interface ProjectSummary {
  projectPath: string;
  displayName: string;
  lastMTime: string;
  conversationCount: number;
}

interface ProjectSidebarProps {
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

interface ProjectRowProps {
  project: ProjectSummary;
  isActive: boolean;
}

function ProjectRow({ project, isActive }: Readonly<ProjectRowProps>) {
  return (
    <li>
      <Link
        to={`/conversations/${encodeURIComponent(project.projectPath)}`}
        aria-current={isActive ? "page" : undefined}
        className={`block rounded text-xs px-2 py-2 transition-colors ${
          isActive
            ? "bg-blue-50 border border-blue-200 text-blue-900"
            : "border border-transparent text-gray-800 hover:bg-gray-50"
        }`}
        title={project.projectPath}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium truncate">{project.displayName}</span>
          <span className="shrink-0 text-[10px] text-gray-500">
            {project.conversationCount}
          </span>
        </div>
        <div
          className="text-[10px] text-gray-500 font-mono mt-0.5 truncate"
          title={project.projectPath}
        >
          {project.projectPath}
        </div>
        <div className="text-[10px] text-gray-500 mt-0.5">
          {formatLastMTime(project.lastMTime)}
        </div>
      </Link>
    </li>
  );
}

export default function ProjectSidebar({
  projects,
  activeProjectId,
}: Readonly<ProjectSidebarProps>) {
  if (projects.length === 0) {
    return (
      <aside
        className="w-64 shrink-0 border border-gray-200 bg-white rounded-lg p-3 min-h-[480px]"
        aria-label="Projects"
      >
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1 mb-2">
          Projects
        </div>
        <p className="text-xs text-gray-500 px-1">No projects found.</p>
      </aside>
    );
  }

  return (
    <aside
      className="w-64 shrink-0 border border-gray-200 bg-white rounded-lg p-2 min-h-[480px]"
      aria-label="Projects"
    >
      <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-2 py-2">
        Projects
      </div>
      <ul className="space-y-0.5">
        {projects.map((p) => (
          <ProjectRow
            key={p.projectPath}
            project={p}
            isActive={p.projectPath === activeProjectId}
          />
        ))}
      </ul>
    </aside>
  );
}
