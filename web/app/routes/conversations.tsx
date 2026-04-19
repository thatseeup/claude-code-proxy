import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";

import TopNav from "../components/TopNav";
import { type ProjectSummary } from "../components/ProjectPicker";

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
  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav />
      <main className="w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
