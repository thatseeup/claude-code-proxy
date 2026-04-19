import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useParams,
  useRouteLoaderData,
  useSearchParams,
} from "@remix-run/react";
import { MessageCircle } from "lucide-react";

import { ConversationThread } from "../components/ConversationThread";
import HorizontalSplit from "../components/HorizontalSplit";
import ProjectPicker from "../components/ProjectPicker";
import type { ProjectSummary } from "../components/ProjectPicker";

interface ConversationMessage {
  parentUuid: string | null;
  isSidechain: boolean;
  userType: string;
  cwd: string;
  sessionId: string;
  version: string;
  type: string;
  message: any;
  uuid: string;
  timestamp: string;
}

interface Conversation {
  sessionId: string;
  projectPath: string;
  projectName: string;
  messages: ConversationMessage[];
  startTime: string;
  endTime: string;
  messageCount: number;
}

interface LoaderData {
  conversations: Conversation[];
  projectPath: string;
}

export async function loader({ params }: LoaderFunctionArgs) {
  const projectPath = decodeURIComponent(params.projectId ?? "");

  let conversations: Conversation[] = [];
  try {
    const backendUrl = new URL(
      "http://localhost:3001/api/conversations/project"
    );
    backendUrl.searchParams.set("project", projectPath);
    const res = await fetch(backendUrl.toString());
    if (res.ok) {
      const data = (await res.json()) as Conversation[] | null;
      conversations = data ?? [];
    }
  } catch (err) {
    console.error("Failed to load project conversations:", err);
  }

  return json<LoaderData>({ conversations, projectPath });
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function firstUserText(conv: Conversation): string {
  for (const msg of conv.messages ?? []) {
    if (msg.type !== "user") continue;
    const parsed =
      typeof msg.message === "string"
        ? safeJSONParse(msg.message)
        : msg.message;
    const text = extractText(parsed);
    if (text) {
      return text.length > 200 ? `${text.slice(0, 200)}...` : text;
    }
  }
  return "";
}

function safeJSONParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function extractText(parsed: any): string {
  if (!parsed) return "";
  if (typeof parsed === "string") return parsed;
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const t = extractText(item);
      if (t) return t;
    }
    return "";
  }
  if (typeof parsed === "object") {
    if (typeof parsed.text === "string" && parsed.text) return parsed.text;
    if (parsed.content) return extractText(parsed.content);
  }
  return "";
}

export default function ConversationsForProject() {
  const { conversations, projectPath } = useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData("routes/conversations") as
    | { projects: ProjectSummary[] }
    | undefined;
  const projects = parentData?.projects ?? [];
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const sid = searchParams.get("sid") ?? "";

  const selected =
    conversations.find((c) => c.sessionId === sid) ??
    (sid === "" && conversations.length > 0 ? conversations[0] : undefined);

  const handleSelect = (sessionId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("sid", sessionId);
    setSearchParams(next, { replace: false });
  };

  const listPane = (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden h-full flex flex-col mr-2">
      <ProjectPicker projects={projects} activeProjectId={projectPath} />
      <div className="bg-gray-50 dark:bg-slate-800 px-3 py-2 border-b border-gray-200 dark:border-slate-700 shrink-0">
        <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {conversations.length} conversation
          {conversations.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-slate-700 overflow-y-auto flex-1 min-h-0">
        {conversations.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <MessageCircle className="w-6 h-6 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
              No conversations in this project
            </h3>
          </div>
        ) : (
          conversations.map((conv) => {
            const isSelected =
              conv.sessionId === (selected?.sessionId ?? "");
            const preview = firstUserText(conv as unknown as Conversation);
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set("sid", conv.sessionId);
            return (
              <Link
                key={conv.sessionId}
                to={`/conversations/${encodeURIComponent(
                  params.projectId ?? ""
                )}?${nextParams.toString()}`}
                replace
                onClick={(e) => {
                  // Allow modifier clicks to open in new tab.
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  handleSelect(conv.sessionId);
                }}
                className={`block px-4 py-3 transition-colors ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-900/30"
                    : "hover:bg-gray-50 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-sm font-mono text-gray-900 dark:text-gray-100 truncate">
                        {conv.sessionId.slice(0, 8)}
                      </span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        {conv.messageCount} msg
                        {conv.messageCount === 1 ? "" : "s"}
                      </span>
                    </div>
                    {preview && (
                      <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                        {preview}
                      </div>
                    )}
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {formatTime(conv.endTime)}
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );

  const detailPane = selected ? (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg h-full flex flex-col ml-2">
      <div className="bg-gray-50 dark:bg-slate-800 px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100 uppercase tracking-wider">
          Conversation
        </h2>
        <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
          {selected.sessionId}
        </span>
      </div>
      <div className="p-4 overflow-y-auto flex-1 min-h-0">
        <ConversationThread
          conversation={selected as unknown as Conversation}
        />
      </div>
    </div>
  ) : (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg h-full flex items-center justify-center ml-2">
      <div className="text-center text-gray-500 dark:text-gray-400 px-6 py-10">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
          Select a conversation
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Pick a conversation from the list to see its thread here.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] min-h-0">
      {/* Conversation list + detail, split horizontally */}
      <div className="flex-1 min-h-0">
        <HorizontalSplit left={listPane} right={detailPane} />
      </div>
    </div>
  );
}
