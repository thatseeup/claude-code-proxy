import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet, useLoaderData, useParams } from "@remix-run/react";

import TopNav from "../components/TopNav";
import ProjectSidebar, {
  type ProjectSummary,
} from "../components/ProjectSidebar";

export const meta: MetaFunction = () => {
  return [
    { title: "Claude Code Monitor — Conversations" },
    {
      name: "description",
      content: "Claude Code Monitor - Conversations view",
    },
  ];
};

export async function loader({ request }: LoaderFunctionArgs) {
  let projects: ProjectSummary[] = [];
  try {
    const res = await fetch("http://localhost:3001/api/projects");
    if (res.ok) {
      projects = (await res.json()) as ProjectSummary[];
    }
  } catch (err) {
    console.error("Failed to fetch projects:", err);
  }

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/conversations" && projects.length > 0) {
    const first = projects[0];
    throw redirect(`/conversations/${encodeURIComponent(first.projectPath)}`);
  }

  return json({ projects });
}

export default function ConversationsLayout() {
  const { projects } = useLoaderData<typeof loader>();
  const params = useParams();
  const activeProjectId = params.projectId ?? "";

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      <div className="max-w-7xl mx-auto px-6 py-6 flex gap-6">
        <ProjectSidebar
          projects={projects}
          activeProjectId={activeProjectId}
        />
        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
