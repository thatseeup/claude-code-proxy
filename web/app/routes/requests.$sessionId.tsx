import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useParams,
  useRouteLoaderData,
  useSearchParams,
} from "@remix-run/react";
import { ArrowLeftRight, Brain, Sparkles, Zap } from "lucide-react";

import HorizontalSplit from "../components/HorizontalSplit";
import RequestDetailContent from "../components/RequestDetailContent";
import SessionPicker from "../components/SessionPicker";
import type { SessionSummary } from "../components/SessionPicker";
import { getChatCompletionsEndpoint } from "../utils/models";

interface RequestLog {
  requestId: string;
  timestamp: string;
  method: string;
  endpoint: string;
  headers: Record<string, string[]>;
  originalModel?: string;
  routedModel?: string;
  sessionId?: string;
  body?: any;
  response?: any;
  promptGrade?: any;
}

interface LoaderData {
  requests: RequestLog[];
  total: number;
  sessionIdToken: string;
  modelFilter: string;
}

const UNKNOWN_TOKEN = "unknown";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const sessionIdToken = params.sessionId ?? "";
  const url = new URL(request.url);
  const modelFilter = url.searchParams.get("model") ?? "all";

  const backendUrl = new URL("http://localhost:3001/api/requests");
  backendUrl.searchParams.set("sessionId", sessionIdToken);
  if (modelFilter !== "all") {
    backendUrl.searchParams.set("model", modelFilter);
  }
  // Pull a generous page so we can render all requests for a single session.
  backendUrl.searchParams.set("page", "1");
  backendUrl.searchParams.set("limit", "1000");

  let requests: RequestLog[] = [];
  let total = 0;
  try {
    const res = await fetch(backendUrl.toString());
    if (res.ok) {
      const data = (await res.json()) as {
        requests?: RequestLog[];
        total?: number;
      };
      requests = data.requests ?? [];
      total = data.total ?? requests.length;
    }
  } catch (err) {
    console.error("Failed to load session requests:", err);
  }

  return json<LoaderData>({
    requests,
    total,
    sessionIdToken,
    modelFilter,
  });
}

function modelBadge(model: string | undefined) {
  if (!model) return <span className="text-gray-900 dark:text-gray-100">API</span>;
  if (model.includes("opus"))
    return <span className="text-purple-600 dark:text-purple-400 font-semibold">Opus</span>;
  if (model.includes("sonnet"))
    return <span className="text-indigo-600 dark:text-indigo-400 font-semibold">Sonnet</span>;
  if (model.includes("haiku"))
    return <span className="text-teal-600 dark:text-teal-400 font-semibold">Haiku</span>;
  if (model.includes("gpt-4o"))
    return <span className="text-green-600 dark:text-green-400 font-semibold">GPT-4o</span>;
  if (model.includes("gpt"))
    return <span className="text-green-600 dark:text-green-400 font-semibold">GPT</span>;
  return <span className="text-gray-900 dark:text-gray-100">{model.split("-")[0]}</span>;
}

function statusPillClass(status: number) {
  if (status >= 200 && status < 300)
    return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
  if (status >= 300 && status < 400)
    return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
}

export default function RequestsForSession() {
  const { requests, modelFilter, sessionIdToken } =
    useLoaderData<typeof loader>();
  const parentData = useRouteLoaderData("routes/requests") as
    | { sessions: SessionSummary[] }
    | undefined;
  const sessions = parentData?.sessions ?? [];
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const rid = searchParams.get("rid") ?? "";

  const selected =
    requests.find((r) => r.requestId === rid) ??
    (rid === "" && requests.length > 0 ? requests[0] : undefined);

  const handleModelFilter = (newFilter: string) => {
    const next = new URLSearchParams(searchParams);
    if (newFilter === "all") {
      next.delete("model");
    } else {
      next.set("model", newFilter);
    }
    // Reset selected request when filter changes.
    next.delete("rid");
    setSearchParams(next, { replace: false });
  };

  const activeSessionToken =
    sessionIdToken === "" ? UNKNOWN_TOKEN : sessionIdToken;

  const listPane = (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden h-full flex flex-col mr-2">
      <SessionPicker
        sessions={sessions}
        activeSessionId={activeSessionToken}
      />
      <div className="bg-gray-50 dark:bg-slate-800 px-3 py-2 border-b border-gray-200 dark:border-slate-700 shrink-0 flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
          {requests.length} request{requests.length === 1 ? "" : "s"}
        </div>
        <div className="inline-flex items-center bg-gray-100 dark:bg-slate-700 rounded p-0.5 space-x-0.5">
          {[
            { key: "all", label: "All", color: "", icon: null },
            {
              key: "opus",
              label: "Opus",
              color: "text-purple-600",
              icon: <Brain className="w-3 h-3" />,
            },
            {
              key: "sonnet",
              label: "Sonnet",
              color: "text-indigo-600",
              icon: <Sparkles className="w-3 h-3" />,
            },
            {
              key: "haiku",
              label: "Haiku",
              color: "text-teal-600",
              icon: <Zap className="w-3 h-3" />,
            },
          ].map((opt) => {
            const active = modelFilter === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => handleModelFilter(opt.key)}
                className={`px-2 py-1 rounded text-[11px] font-medium transition-all duration-200 flex items-center space-x-1 ${
                  active
                    ? `bg-white dark:bg-slate-900 shadow-sm ${opt.color || "text-gray-900 dark:text-gray-100"}`
                    : "bg-transparent text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                }`}
              >
                {opt.icon}
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="divide-y divide-gray-200 dark:divide-slate-700 overflow-y-auto flex-1 min-h-0">
        {requests.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-gray-400">
            <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
              No requests in this session
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Make sure you have set{" "}
              <code className="font-mono bg-gray-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                ANTHROPIC_BASE_URL
              </code>{" "}
              to point at the proxy.
            </p>
          </div>
        ) : (
          requests.map((req) => {
            const isSelected = req.requestId === (selected?.requestId ?? "");
            const model = req.routedModel || req.body?.model;
            const status = req.response?.statusCode as number | undefined;
            const nextParams = new URLSearchParams(searchParams);
            nextParams.set("rid", req.requestId);
            return (
              <Link
                key={req.requestId}
                to={`/requests/${encodeURIComponent(
                  params.sessionId ?? ""
                )}?${nextParams.toString()}`}
                replace
                className={`block px-4 py-3 transition-colors border-b border-gray-100 dark:border-slate-800 last:border-b-0 ${
                  isSelected
                    ? "bg-blue-50 dark:bg-blue-900/30"
                    : "hover:bg-gray-50 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="flex items-center space-x-3 mb-1">
                      <h3 className="text-sm font-medium">
                        {modelBadge(model)}
                      </h3>
                      {req.routedModel &&
                        req.originalModel &&
                        req.routedModel !== req.originalModel && (
                          <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 rounded font-medium flex items-center space-x-1">
                            <ArrowLeftRight className="w-3 h-3" />
                            <span>routed</span>
                          </span>
                        )}
                      {typeof status === "number" && (
                        <span
                          className={`text-xs font-medium px-1.5 py-0.5 rounded ${statusPillClass(
                            status
                          )}`}
                        >
                          {status}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-gray-400 font-mono mb-1 truncate">
                      {getChatCompletionsEndpoint(
                        req.routedModel,
                        req.endpoint
                      )}
                    </div>
                    <div className="flex items-center space-x-3 text-xs">
                      {req.response?.body?.usage && (
                        <span className="font-mono text-gray-600 dark:text-gray-400">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {(
                              (req.response.body.usage.input_tokens || 0) +
                              (req.response.body.usage.output_tokens || 0)
                            ).toLocaleString()}
                          </span>{" "}
                          tokens
                        </span>
                      )}
                      {req.response?.responseTime && (
                        <span className="font-mono text-gray-600 dark:text-gray-400">
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {(req.response.responseTime / 1000).toFixed(2)}
                          </span>
                          s
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {new Date(req.timestamp).toLocaleDateString()}
                    </div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">
                      {new Date(req.timestamp).toLocaleTimeString()}
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
          Request Details
        </h2>
        <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
          {selected.requestId}
        </span>
      </div>
      <div className="p-4 overflow-y-auto flex-1 min-h-0">
        <RequestDetailContent
          request={
            {
              ...selected,
              // RequestDetailContent expects `id` as number — re-use requestId
              // string; its usage is only for onGrade / display keys.
              id: selected.requestId as unknown as number,
            } as any
          }
          onGrade={() => {
            /* grading UI out of scope for this step */
          }}
        />
      </div>
    </div>
  ) : (
    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-lg h-full flex items-center justify-center ml-2">
      <div className="text-center text-gray-500 dark:text-gray-400 px-6 py-10">
        <h3 className="text-sm font-medium text-gray-600 dark:text-gray-300 mb-1">
          Select a request
        </h3>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          Pick a request from the list to see its details here.
        </p>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] min-h-0">
      {/* Request list + detail, split horizontally */}
      <div className="flex-1 min-h-0">
        <HorizontalSplit left={listPane} right={detailPane} />
      </div>
    </div>
  );
}
