import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Link,
  useLoaderData,
  useParams,
  useSearchParams,
} from "@remix-run/react";
import { ArrowLeftRight, Brain, Sparkles, Zap } from "lucide-react";

import RequestDetailContent from "../components/RequestDetailContent";
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
  if (!model) return <span className="text-gray-900">API</span>;
  if (model.includes("opus"))
    return <span className="text-purple-600 font-semibold">Opus</span>;
  if (model.includes("sonnet"))
    return <span className="text-indigo-600 font-semibold">Sonnet</span>;
  if (model.includes("haiku"))
    return <span className="text-teal-600 font-semibold">Haiku</span>;
  if (model.includes("gpt-4o"))
    return <span className="text-green-600 font-semibold">GPT-4o</span>;
  if (model.includes("gpt"))
    return <span className="text-green-600 font-semibold">GPT</span>;
  return <span className="text-gray-900">{model.split("-")[0]}</span>;
}

function statusPillClass(status: number) {
  if (status >= 200 && status < 300)
    return "bg-green-100 text-green-700";
  if (status >= 300 && status < 400) return "bg-yellow-100 text-yellow-700";
  return "bg-red-100 text-red-700";
}

export default function RequestsForSession() {
  const { requests, modelFilter, sessionIdToken } =
    useLoaderData<typeof loader>();
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

  const displaySessionLabel =
    sessionIdToken === UNKNOWN_TOKEN || sessionIdToken === ""
      ? "Unknown"
      : sessionIdToken;

  return (
    <div className="space-y-4">
      {/* Session header + model filter */}
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">
              Session
            </div>
            <div className="font-mono text-sm text-gray-900 break-all">
              {displaySessionLabel}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {requests.length} request{requests.length === 1 ? "" : "s"}
            </div>
          </div>
          <div className="inline-flex items-center bg-gray-100 rounded p-0.5 space-x-0.5">
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
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
                    active
                      ? `bg-white shadow-sm ${opt.color || "text-gray-900"}`
                      : "bg-transparent text-gray-600 hover:text-gray-900"
                  }`}
                >
                  {opt.icon}
                  <span>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Request list */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
          <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
            Requests
          </h2>
        </div>
        <div className="divide-y divide-gray-200">
          {requests.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <h3 className="text-sm font-medium text-gray-600 mb-1">
                No requests in this session
              </h3>
              <p className="text-xs text-gray-500">
                Make sure you have set{" "}
                <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">
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
                  className={`block px-4 py-3 transition-colors border-b border-gray-100 last:border-b-0 ${
                    isSelected
                      ? "bg-blue-50"
                      : "hover:bg-gray-50"
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
                            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex items-center space-x-1">
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
                      <div className="text-xs text-gray-600 font-mono mb-1 truncate">
                        {getChatCompletionsEndpoint(
                          req.routedModel,
                          req.endpoint
                        )}
                      </div>
                      <div className="flex items-center space-x-3 text-xs">
                        {req.response?.body?.usage && (
                          <span className="font-mono text-gray-600">
                            <span className="font-medium text-gray-900">
                              {(
                                (req.response.body.usage.input_tokens || 0) +
                                (req.response.body.usage.output_tokens || 0)
                              ).toLocaleString()}
                            </span>{" "}
                            tokens
                          </span>
                        )}
                        {req.response?.responseTime && (
                          <span className="font-mono text-gray-600">
                            <span className="font-medium text-gray-900">
                              {(req.response.responseTime / 1000).toFixed(2)}
                            </span>
                            s
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <div className="text-xs text-gray-500">
                        {new Date(req.timestamp).toLocaleDateString()}
                      </div>
                      <div className="text-xs text-gray-400">
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

      {/* Detail pane */}
      {selected && (
        <div className="bg-white border border-gray-200 rounded-lg">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Request Details
            </h2>
            <span className="text-xs font-mono text-gray-500">
              {selected.requestId}
            </span>
          </div>
          <div className="p-4">
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
      )}
    </div>
  );
}
