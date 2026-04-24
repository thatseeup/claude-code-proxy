import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Outlet } from "@remix-run/react";

import TopNav from "../components/TopNav";
import { type SessionSummary } from "../components/SessionPicker";

export const meta: MetaFunction = () => {
  return [
    { title: "Claude Code Monitor — Requests" },
    {
      name: "description",
      content: "Claude Code Monitor - Requests view",
    },
  ];
};

const UNKNOWN_TOKEN = "unknown";

function toUrlToken(sessionId: string): string {
  return sessionId === "" ? UNKNOWN_TOKEN : sessionId;
}

export async function loader({ request }: LoaderFunctionArgs) {
  let sessions: SessionSummary[] = [];
  try {
    const res = await fetch("http://localhost:3001/api/sessions");
    if (res.ok) {
      sessions = (await res.json()) as SessionSummary[];
    }
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
  }

  // Auto-select the most recent session when the URL is exactly /requests
  // (no child sessionId segment). We detect this by comparing pathname.
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  if (pathname === "/requests" && sessions.length > 0) {
    const first = sessions[0];
    const token = toUrlToken(first.sessionId);
    throw redirect(`/requests/${encodeURIComponent(token)}`);
  }

  return json({ sessions });
}

// Avoid refetching the sessions list (which scans every response body to
// aggregate cost) on every request-row click. Row selection only changes
// `?rid=` — the parent's data doesn't depend on it. We still revalidate when
// the pathname changes (session switch) or when an action runs (e.g. session
// delete fetcher, explicit revalidator.revalidate()).
export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
  formAction,
}: {
  currentUrl: URL;
  nextUrl: URL;
  defaultShouldRevalidate: boolean;
  formAction?: string;
}) {
  if (formAction) return defaultShouldRevalidate;
  if (currentUrl.pathname === nextUrl.pathname) return false;
  return defaultShouldRevalidate;
}

export default function RequestsLayout() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      <TopNav />
      <main className="w-full px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
