import { useState } from 'react';
import { 
  ChevronDown, 
  Info, 
  Settings, 
  Cpu, 
  MessageCircle, 
  Brain, 
  User, 
  Bot, 
  Target,
  Copy,
  Check,
  ArrowLeftRight,
  Wifi,
  List,
  FileText,
  Wrench
} from 'lucide-react';
import { MessageContent } from './MessageContent';
import { formatJSON, formatRawHeaders, formatStableDateTime } from '../utils/formatters';
import { getChatCompletionsEndpoint, getProviderName } from '../utils/models';

interface Request {
  id: number;
  timestamp: string;
  method: string;
  endpoint: string;
  headers: Record<string, string[]>;
  originalModel?: string;
  routedModel?: string;
  bodyRaw?: string;
  body?: {
    model?: string;
    messages?: Array<{
      role: string;
      content: any;
    }>;
    system?: Array<{
      text: string;
      type: string;
      cache_control?: { type: string };
    }>;
    tools?: Array<{
      name: string;
      description: string;
      input_schema?: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
      };
    }>;
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
  };
  response?: {
    statusCode: number;
    headers: Record<string, string[]>;
    body?: any;
    bodyText?: string;
    responseTime: number;
    streamingChunks?: string[];
    isStreaming: boolean;
    completedAt: string;
  };
  promptGrade?: {
    score: number;
    criteria: Record<string, { score: number; feedback: string }>;
    feedback: string;
    improvedPrompt: string;
    gradingTimestamp: string;
  };
}

interface RequestDetailContentProps {
  request: Request;
  onGrade: () => void;
}

export default function RequestDetailContent({ request, onGrade }: RequestDetailContentProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    // conversation: true
  });
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleCopy = async (content: string, key: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopied(prev => ({ ...prev, [key]: false }));
      }, 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const canGradeRequest = (request: Request) => {
    return request.body && 
           request.body.messages && 
           request.body.messages.some(msg => msg.role === 'user') &&
           request.endpoint.includes('/messages');
  };

  return (
    <div className="space-y-6">
      {/* Request / Response Overview — side-by-side 50:50 on lg+, stacked below */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Request Overview */}
        <div
          className={`bg-white border border-gray-200 rounded-xl p-6 shadow-sm ${
            request.response ? '' : 'lg:col-span-2'
          }`}
        >
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
              <Info className="w-5 h-5 text-blue-600" />
              <span>Request Overview</span>
            </h4>
            {/* {!request.promptGrade && canGradeRequest(request) && (
              <button
                onClick={onGrade}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2"
              >
                <Target className="w-4 h-4" />
                <span>Grade This Prompt</span>
              </button>
            )} */}
          </div>
          <RequestOverviewTable request={request} />
        </div>

        {/* Response Overview */}
        {request.response && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
                <ArrowLeftRight className="w-5 h-5 text-blue-600" />
                <span>Response Overview</span>
              </h4>
            </div>
            <ResponseOverviewTable response={request.response} />
          </div>
        )}
      </div>

      {/* Headers */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div 
          className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
          onClick={() => toggleSection('headers')}
        >
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
              <Settings className="w-5 h-5 text-blue-600" />
              <span>Request Headers</span>
            </h4>
            <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
              expandedSections.headers ? 'rotate-180' : ''
            }`} />
          </div>
        </div>
        {expandedSections.headers && (
          <div className="p-6">
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">Headers</span>
                <button
                  onClick={() => handleCopy(formatRawHeaders(request.headers), 'headers')}
                  className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                  title="Copy headers"
                >
                  {copied.headers ? (
                    <Check className="w-4 h-4 text-green-600" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <pre className="text-sm text-gray-700 overflow-x-auto">
                {formatRawHeaders(request.headers)}
              </pre>
            </div>
          </div>
        )}
      </div>

      {/* Request Body (Raw) */}
      {request.bodyRaw && (() => {
        const prettyBody = beautifyRawJSON(request.bodyRaw);
        return (
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div
              className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
              onClick={() => toggleSection('requestBody')}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <span>Request Body</span>
                </h4>
                <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
                  expandedSections.requestBody ? 'rotate-180' : ''
                }`} />
              </div>
            </div>
            {expandedSections.requestBody && (
              <div className="p-6">
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-gray-700">Body</span>
                    <button
                      onClick={() => handleCopy(prettyBody, 'requestBody')}
                      className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                      title="Copy request body"
                    >
                      {copied.requestBody ? (
                        <Check className="w-4 h-4 text-green-600" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <CollapsibleJSON json={prettyBody} />
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {request.body && (
        <>
          {/* System Messages */}
          {request.body.system && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div 
                className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
                onClick={() => toggleSection('system')}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
                    <Cpu className="w-5 h-5 text-yellow-600" />
                    <span>System Instructions</span>
                    <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-1 rounded-full border border-yellow-200">
                      {request.body.system.length} items
                    </span>
                  </h4>
                  <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
                    expandedSections.system ? 'rotate-180' : ''
                  }`} />
                </div>
              </div>
              {expandedSections.system && (
                <div className="p-6 space-y-4">
                  {request.body.system.map((sys, index) => (
                    <div key={index} className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-yellow-700 font-medium text-sm">System Message #{index + 1}</span>
                        {sys.cache_control && (
                          <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded-full border border-orange-200">
                            Cache: {sys.cache_control.type}
                          </span>
                        )}
                      </div>
                      <div className="bg-white rounded p-3 border border-gray-200">
                        <MessageContent content={{ type: 'text', text: sys.text }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tools */}
          {request.body.tools && request.body.tools.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div
                className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
                onClick={() => toggleSection('tools')}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
                    <Wrench className="w-5 h-5 text-indigo-600" />
                    <span>Available Tools</span>
                    <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full border border-indigo-200">
                      {request.body.tools.length} tools
                    </span>
                  </h4>
                  <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
                    expandedSections.tools ? 'rotate-180' : ''
                  }`} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {request.body.tools.map((tool, index) => (
                    <span
                      key={index}
                      className="text-xs font-mono bg-white text-gray-700 border border-gray-200 px-2 py-0.5 rounded-full"
                    >
                      {tool.name}
                    </span>
                  ))}
                </div>
              </div>
              {expandedSections.tools && (
                <div className="p-6 space-y-4">
                  {request.body.tools.map((tool, index) => (
                    <ToolCard key={index} tool={tool} index={index} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Conversation */}
          {request.body.messages && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
              <div 
                className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
                onClick={() => toggleSection('conversation')}
              >
                <div className="flex items-center justify-between">
                  <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
                    <MessageCircle className="w-5 h-5 text-blue-600" />
                    <span>Conversation</span>
                    <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full border border-blue-200">
                      {request.body.messages.length} messages
                    </span>
                  </h4>
                  <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
                    expandedSections.conversation ? 'rotate-180' : ''
                  }`} />
                </div>
              </div>
              {expandedSections.conversation && (
                <div className="p-6 space-y-4 max-h-[600px] overflow-y-auto">
                  {request.body.messages.map((message, index) => (
                    <MessageBubble key={index} message={message} index={index} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Model Configuration */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <div 
              className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
              onClick={() => toggleSection('model')}
            >
              <div className="flex items-center justify-between">
                <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
                  <Brain className="w-5 h-5 text-purple-600" />
                  <span>Model Configuration</span>
                </h4>
                <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
                  expandedSections.model ? 'rotate-180' : ''
                }`} />
              </div>
            </div>
            {expandedSections.model && (
              <div className="p-6 space-y-4">
                {/* Model Routing Information */}
                {request.routedModel && request.routedModel !== request.originalModel && (
                  <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-4">
                    <div className="flex items-center space-x-4">
                      <div className="flex-1">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-sm font-semibold text-purple-700">Requested Model</span>
                          <code className="text-xs bg-white px-2 py-1 rounded font-mono border border-purple-200">
                            {request.originalModel || request.body.model}
                          </code>
                        </div>
                        <div className="flex items-center space-x-3">
                          <div className="flex items-center space-x-2">
                            <ArrowLeftRight className="w-4 h-4 text-purple-600" />
                            <span className="text-xs text-purple-600 font-medium">Routed to</span>
                          </div>
                          <code className="text-sm bg-white px-3 py-1.5 rounded font-mono font-semibold border border-blue-200 text-blue-700">
                            {request.routedModel}
                          </code>
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full border border-blue-200">
                            {getProviderName(request.routedModel)}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500 mb-1">Target Endpoint</div>
                        <code className="text-xs bg-white px-2 py-1 rounded font-mono border border-gray-200">
                          {getChatCompletionsEndpoint(request.routedModel)}
                        </code>
                      </div>
                    </div>
                  </div>
                )}

                {/* Model Parameters */}
                <div className="grid grid-cols-2 gap-4">
                  {!request.routedModel || request.routedModel === request.originalModel ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="text-xs text-gray-500 mb-1">Model</div>
                      <div className="text-sm font-medium text-gray-900">{request.originalModel || request.body.model || 'N/A'}</div>
                    </div>
                  ) : null}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Max Tokens</div>
                    <div className="text-sm font-medium text-gray-900">
                      {request.body.max_tokens?.toLocaleString() || 'N/A'}
                    </div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Temperature</div>
                    <div className="text-sm font-medium text-gray-900">{request.body.temperature ?? 'N/A'}</div>
                  </div>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <div className="text-xs text-gray-500 mb-1">Stream</div>
                    <div className="text-sm font-medium text-gray-900">
                      {request.body.stream ? '✅ Yes' : '❌ No'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* API Response */}
      {request.response && (
        <ResponseDetails response={request.response} />
      )}

      {/* Prompt Grading Results */}
      {request.promptGrade && (
        <PromptGradingResults promptGrade={request.promptGrade} />
      )}
    </div>
  );
}

// Message bubble component
function MessageBubble({ message, index }: { message: any; index: number }) {
  const roleColors = {
    'user': 'bg-blue-50 border border-blue-200',
    'assistant': 'bg-gray-50 border border-gray-200',
    'system': 'bg-yellow-50 border border-yellow-200'
  };

  const roleIcons = {
    'user': User,
    'assistant': Bot,
    'system': Settings
  };

  const roleIconColors = {
    'user': 'text-blue-600',
    'assistant': 'text-gray-600',
    'system': 'text-yellow-600'
  };

  const Icon = roleIcons[message.role as keyof typeof roleIcons] || User;

  return (
    <div className={`rounded-lg p-4 ${roleColors[message.role as keyof typeof roleColors] || 'bg-gray-50 border border-gray-200'}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center border border-gray-200">
            <Icon className={`w-4 h-4 ${roleIconColors[message.role as keyof typeof roleIconColors] || 'text-gray-600'}`} />
          </div>
          <span className="font-medium capitalize text-gray-900">{message.role}</span>
          <span className="text-xs text-gray-500 bg-white px-2 py-1 rounded-full border border-gray-200">
            #{index + 1}
          </span>
        </div>
      </div>
      <div>
        <MessageContent content={message.content} />
      </div>
    </div>
  );
}

// Placeholder for prompt grading results - you can expand this
function PromptGradingResults({ promptGrade }: { promptGrade: any }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
      <h4 className="text-lg font-semibold text-gray-900 mb-4">Prompt Quality Analysis</h4>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-gray-700">Overall Score:</span>
          <span className="text-2xl font-bold text-blue-600">{promptGrade.score}/5</span>
        </div>
        <div className="text-sm text-gray-600">
          <p>{promptGrade.feedback}</p>
        </div>
      </div>
    </div>
  );
}

// Response Details Component
function ResponseDetails({ response }: { response: NonNullable<Request['response']> }) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true
  });
  const [copied, setCopied] = useState<Record<string, boolean>>({});

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleCopy = async (content: string, key: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(prev => ({ ...prev, [key]: true }));
      setTimeout(() => {
        setCopied(prev => ({ ...prev, [key]: false }));
      }, 2000);
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
    }
  };

  const getStatusColor = (statusCode: number) => {
    if (statusCode >= 200 && statusCode < 300) {
      return { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', icon: 'text-green-600' };
    }
    if (statusCode >= 400 && statusCode < 500) {
      return { bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', icon: 'text-yellow-600' };
    }
    if (statusCode >= 500) {
      return { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', icon: 'text-red-600' };
    }
    return { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', icon: 'text-gray-600' };
  };

  // Format raw SSE chunks into multiline, JSON-beautified display elements.
  // Each chunk is typically a single SSE line like "data: {...}" or "event: ...",
  // but a chunk may also contain multiple embedded newlines — split defensively.
  const formatSSELines = (chunks: string[]) => {
    const lines = chunks.flatMap(chunk => chunk.split('\n'));
    const elements: React.ReactNode[] = [];
    let key = 0;

    for (const line of lines) {
      if (!line.trim()) continue;

      // SSE field lines: "data: ...", "event: ...", "id: ...", "retry: ..."
      const fieldMatch = /^(data|event|id|retry):\s?(.*)$/s.exec(line);
      if (fieldMatch) {
        const [, fieldName, fieldValue] = fieldMatch;
        let valueNode: React.ReactNode;

        const trimmed = fieldValue.trim();
        if (fieldName === 'data' && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try {
            const parsed = JSON.parse(trimmed);
            const pretty = JSON.stringify(parsed, null, 2);
            valueNode = (
              <pre className="whitespace-pre-wrap text-gray-700 mt-0.5 ml-4">
                {pretty}
              </pre>
            );
          } catch {
            valueNode = <span className="text-gray-700 ml-1 whitespace-pre-wrap">{fieldValue}</span>;
          }
        } else {
          valueNode = <span className="text-gray-700 ml-1 whitespace-pre-wrap">{fieldValue}</span>;
        }

        elements.push(
          <div key={key++} className="mb-1">
            <span className="text-purple-700 font-semibold">{fieldName}:</span>
            {valueNode}
          </div>
        );
      } else {
        elements.push(
          <div key={key++} className="text-gray-500 whitespace-pre-wrap">{line}</div>
        );
      }
    }

    return elements;
  };

  // Parse streaming chunks to extract the final assembled text
  const parseStreamingResponse = (chunks: string[]) => {
    let assembledText = '';
    let rawData = chunks.join('');
    
    try {
      // Split by lines and process each SSE event
      const lines = rawData.split('\n').filter(line => line.trim());
      
      for (const line of lines) {
        // Look for data lines in SSE format
        if (line.startsWith('data: ')) {
          const jsonStr = line.substring(6).trim();
          
          // Skip non-JSON lines (like "data: [DONE]")
          if (!jsonStr.startsWith('{')) continue;
          
          try {
            const eventData = JSON.parse(jsonStr);
            
            // Extract text from content_block_delta events
            if (eventData.type === 'content_block_delta' && 
                eventData.delta && 
                eventData.delta.type === 'text_delta' && 
                typeof eventData.delta.text === 'string') {
              assembledText += eventData.delta.text;
            }
          } catch (parseError) {
            // Skip malformed JSON
            continue;
          }
        }
      }
      
      // If we successfully extracted text, return it
      if (assembledText.trim().length > 0) {
        return {
          finalText: assembledText,
          isFormatted: true,
          rawData: rawData
        };
      }
      
      // Fallback: try to find any text content in the raw data
      const textMatches = rawData.match(/"text":"([^"]+)"/g);
      if (textMatches) {
        let fallbackText = '';
        for (const match of textMatches) {
          const text = match.match(/"text":"([^"]+)"/)?.[1];
          if (text) {
            // Unescape common JSON escape sequences
            fallbackText += text.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
        }
        if (fallbackText.trim()) {
          return {
            finalText: fallbackText,
            isFormatted: true,
            rawData: rawData
          };
        }
      }
      
    } catch (error) {
      console.warn('Error parsing streaming response:', error);
    }
    
    // Ultimate fallback to raw concatenation
    return {
      finalText: rawData,
      isFormatted: false,
      rawData: rawData
    };
  };

  const statusColors = getStatusColor(response.statusCode);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm border-l-4 border-l-blue-500">
      <div 
        className="bg-gray-50 px-6 py-4 border-b border-gray-200 cursor-pointer"
        onClick={() => toggleSection('overview')}
      >
        <div className="flex items-center justify-between">
          <h4 className="text-lg font-semibold text-gray-900 flex items-center space-x-3">
            <ArrowLeftRight className="w-5 h-5 text-blue-600" />
            <span>API Response</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${statusColors.bg} ${statusColors.text} ${statusColors.border}`}>
              {response.statusCode}
            </span>
          </h4>
          <ChevronDown className={`w-5 h-5 text-gray-500 transition-transform ${
            expandedSections.overview ? 'rotate-180' : ''
          }`} />
        </div>
      </div>
      
      {expandedSections.overview && (
        <div className="p-6 space-y-6">
          {/* Response Headers */}
          {response.headers && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
              <div 
                className="px-4 py-3 border-b border-gray-200 cursor-pointer"
                onClick={() => toggleSection('responseHeaders')}
              >
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
                    <List className="w-4 h-4 text-gray-600" />
                    <span>Response Headers</span>
                    <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded-full">
                      {Object.keys(response.headers).length}
                    </span>
                  </h5>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${
                    expandedSections.responseHeaders ? 'rotate-180' : ''
                  }`} />
                </div>
              </div>
              {expandedSections.responseHeaders && (
                <div className="px-4 pb-4">
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Headers</span>
                      <button
                        onClick={() => handleCopy(formatRawHeaders(response.headers), 'responseHeaders')}
                        className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                        title="Copy response headers"
                      >
                        {copied.responseHeaders ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <pre className="text-sm text-gray-700 overflow-x-auto">
                      {formatRawHeaders(response.headers)}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Response Body */}
          {(response.body || response.bodyText) && (
            <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
              <div 
                className="px-4 py-3 border-b border-gray-200 cursor-pointer"
                onClick={() => toggleSection('responseBody')}
              >
                <div className="flex items-center justify-between">
                  <h5 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
                    <FileText className="w-4 h-4 text-gray-600" />
                    <span>Response Body</span>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full border border-blue-200">
                      {response.body ? 'JSON' : 'Text'}
                    </span>
                  </h5>
                  <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${
                    expandedSections.responseBody ? 'rotate-180' : ''
                  }`} />
                </div>
              </div>
              {expandedSections.responseBody && (
                <div className="px-4 pb-4">
                  <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Response</span>
                      <button
                        onClick={() => handleCopy(
                          response.body ? formatJSON(response.body) : (response.bodyText || ''), 
                          'responseBody'
                        )}
                        className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                        title="Copy response body"
                      >
                        {copied.responseBody ? (
                          <Check className="w-4 h-4 text-green-600" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    <CollapsibleJSON json={response.body ? formatJSON(response.body) : (response.bodyText || '')} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Streaming Response */}
          {response.isStreaming && response.streamingChunks && response.streamingChunks.length > 0 && (() => {
            const parsed = parseStreamingResponse(response.streamingChunks);
            return (
              <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
                <div 
                  className="px-4 py-3 border-b border-gray-200 cursor-pointer"
                  onClick={() => toggleSection('streamingResponse')}
                >
                  <div className="flex items-center justify-between">
                    <h5 className="text-sm font-semibold text-gray-900 flex items-center space-x-2">
                      <Wifi className="w-4 h-4 text-gray-600" />
                      <span>Streaming Response</span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full border border-blue-200">
                        {response.streamingChunks.length} chunks
                      </span>
                      {parsed.isFormatted && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full border border-green-200">
                          Parsed
                        </span>
                      )}
                    </h5>
                    <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${
                      expandedSections.streamingResponse ? 'rotate-180' : ''
                    }`} />
                  </div>
                </div>
                {expandedSections.streamingResponse && (
                  <div className="px-4 pb-4 space-y-3">
                    {/* Clean Parsed Response */}
                    {parsed.isFormatted && (
                      <div className="bg-white rounded-lg p-4 border border-green-200">
                        <div className="flex items-center justify-between mb-3">
                          <h6 className="text-sm font-semibold text-green-900 flex items-center space-x-2">
                            <Check className="w-4 h-4" />
                            <span>Final Response (Clean)</span>
                          </h6>
                          <button
                            onClick={() => handleCopy(parsed.finalText, 'streamingClean')}
                            className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                            title="Copy clean response"
                          >
                            {copied.streamingClean ? (
                              <Check className="w-4 h-4 text-green-600" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                        <div className="bg-gray-50 rounded p-3 border border-gray-200">
                          <pre className="text-sm text-gray-900 whitespace-pre-wrap leading-relaxed">
                            {parsed.finalText}
                          </pre>
                        </div>
                        <div className="mt-2 text-xs text-green-600">
                          Extracted clean text from streaming chunks
                        </div>
                      </div>
                    )}

                    {/* Raw Data (Collapsible) */}
                    <div className="bg-gray-50 rounded-lg border border-gray-200">
                      <div 
                        className="px-3 py-2 cursor-pointer flex items-center justify-between"
                        onClick={() => toggleSection('rawStreamingData')}
                      >
                        <span className="text-sm font-medium text-gray-700 flex items-center space-x-2">
                          <FileText className="w-4 h-4" />
                          <span>Raw Streaming Data</span>
                        </span>
                        <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${
                          expandedSections.rawStreamingData ? 'rotate-180' : ''
                        }`} />
                      </div>
                      {expandedSections.rawStreamingData && (
                        <div className="px-3 pb-3">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-gray-600">SSE Events & Metadata</span>
                            <button
                              onClick={() => handleCopy(parsed.rawData, 'streamingRaw')}
                              className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
                              title="Copy raw data"
                            >
                              {copied.streamingRaw ? (
                                <Check className="w-3 h-3 text-green-600" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <div className="text-xs text-gray-600 overflow-x-auto max-h-96 overflow-y-auto bg-gray-100 rounded p-2 font-mono">
                            {formatSSELines(response.streamingChunks)}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="text-xs text-gray-500">
                      {parsed.isFormatted 
                        ? `Successfully parsed ${response.streamingChunks.length} streaming chunks`
                        : `Raw display of ${response.streamingChunks.length} streaming chunks (parsing failed)`
                      }
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// Beautify raw request body JSON while preserving original key order.
// JSON.parse preserves insertion order for non-numeric string keys, so a
// parse → stringify(pretty) round-trip keeps the wire order.
function beautifyRawJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// Collapsible JSON block with truncation
const JSON_PREVIEW_LENGTH = 500;

function CollapsibleJSON({ json }: { readonly json: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = json.length > JSON_PREVIEW_LENGTH;
  const display = isLong && !expanded ? json.slice(0, JSON_PREVIEW_LENGTH) : json;

  return (
    <div>
      <pre className="text-xs text-gray-700 overflow-x-auto font-mono whitespace-pre-wrap">{display}</pre>
      {isLong && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="mt-1 text-xs text-blue-600 hover:text-blue-800 font-medium border border-blue-200 bg-blue-50 px-2 py-0.5 rounded"
        >
          {expanded ? 'Show less' : '(...)'}
        </button>
      )}
    </div>
  );
}

function SchemaBlock({ schema, onCopy, copied }: { readonly schema: any; readonly onCopy: () => void; readonly copied: boolean }) {
  const json = formatJSON(schema);
  return (
    <div className="mt-4">
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
          <span className="text-xs font-semibold text-gray-700 flex items-center space-x-2">
            <Settings className="w-3.5 h-3.5" />
            <span>Input Schema</span>
          </span>
          <button onClick={onCopy} className="p-1 text-gray-500 hover:text-gray-700 transition-colors" title="Copy schema">
            {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <div className="p-3">
          <CollapsibleJSON json={json} />
        </div>
      </div>
    </div>
  );
}

// Tool Card Component
function ToolCard({ tool, index }: { tool: any; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const [copiedSchema, setCopiedSchema] = useState(false);

  const handleCopySchema = async () => {
    try {
      await navigator.clipboard.writeText(formatJSON(tool.input_schema));
      setCopiedSchema(true);
      setTimeout(() => setCopiedSchema(false), 2000);
    } catch (error) {
      console.error('Failed to copy schema:', error);
    }
  };

  // Parse description to identify code blocks and format them
  const formatDescription = (description: string) => {
    // Split by code blocks (text between backticks)
    const parts = description.split(/(`[^`]+`)/g);
    
    return parts.map((part, i) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        // Code inline
        const code = part.slice(1, -1);
        return (
          <code key={i} className="bg-gray-100 text-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">
            {code}
          </code>
        );
      }
      
      // Return non-code parts as plain text
      return <span key={i}>{part}</span>;
    });
  };

  const isLongDescription = tool.description.length > 300;
  const displayDescription = expanded ? tool.description : tool.description.slice(0, 300);

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
      <div className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-gray-200 shadow-sm">
              <Wrench className="w-5 h-5 text-gray-600" />
            </div>
            <div>
              <h5 className="text-lg font-bold text-gray-900">{tool.name}</h5>
              <span className="text-xs text-gray-500">Tool #{index + 1}</span>
            </div>
          </div>
        </div>
        
        <div className="prose prose-sm max-w-none">
          <div className="text-sm text-gray-700 leading-relaxed space-y-2">
            <div className="whitespace-pre-wrap">
              {formatDescription(displayDescription)}
              {isLongDescription && !expanded && '...'}
            </div>
            {isLongDescription && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-blue-600 hover:text-blue-700 text-xs font-medium mt-2"
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        </div>
        
        {tool.input_schema && (
          <SchemaBlock schema={tool.input_schema} onCopy={handleCopySchema} copied={copiedSchema} />
        )}
      </div>
    </div>
  );
}

// Request Overview table: label/value rows per requirements
function RequestOverviewTable({ request }: { readonly request: Request }) {
  const userAgent = request.headers['User-Agent']?.[0];
  const model = request.body?.model;
  const system0 = request.body?.system?.[0]?.text;
  const system1 = request.body?.system?.[1]?.text;
  const maxTokens = request.body?.max_tokens;
  const stream = request.body?.stream;

  const none = <span className="text-gray-400 italic">없음</span>;

  const groups: OverviewGroup[] = [
    {
      rows: [
        {
          label: 'Timestamp',
          value: <span className="text-gray-900">{formatStableDateTime(request.timestamp)}</span>,
        },
        {
          label: 'Method/URL',
          value: (
            <code className="text-blue-700 bg-blue-50 px-2 py-1 rounded font-mono text-xs border border-blue-200 break-all">
              {request.method} {getChatCompletionsEndpoint(request.routedModel, request.endpoint)}
            </code>
          ),
        },
      ],
    },
    {
      title: 'Header',
      rows: [
        {
          label: 'User-Agent',
          value: userAgent ? (
            <span className="text-gray-700 text-xs break-all">{userAgent}</span>
          ) : none,
        },
        {
          label: 'Model',
          value: model ? (
            <span className="text-gray-900 font-mono text-xs break-all">{model}</span>
          ) : none,
        },
      ],
    },
    {
      title: 'Body',
      rows: [
        {
          label: 'system[0]',
          value: system0 ? (
            <span className="text-gray-800 whitespace-pre-wrap break-words text-xs">{system0}</span>
          ) : none,
        },
        {
          label: 'system[1]',
          value: system1 ? (
            <span className="text-gray-800 text-xs block truncate" title={system1}>
              {system1}
            </span>
          ) : none,
        },
        {
          label: 'max_tokens',
          value:
            maxTokens !== undefined && maxTokens !== null ? (
              <span className="text-gray-900">{maxTokens.toLocaleString()}</span>
            ) : none,
        },
        {
          label: 'stream',
          value:
            stream === undefined || stream === null ? none : (
              <span className="text-gray-900">{String(stream)}</span>
            ),
        },
      ],
    },
  ];

  return <OverviewTable groups={groups} labelWidthClass="w-[180px]" tableFixed />;
}

type OverviewRow = { label: string; value: React.ReactNode };
type OverviewGroup = { title?: string; titleCase?: 'upper' | 'lower'; rows: OverviewRow[] };

function OverviewTable({
  groups,
  labelWidthClass,
  tableFixed,
}: {
  readonly groups: OverviewGroup[];
  readonly labelWidthClass: string;
  readonly tableFixed?: boolean;
}) {
  return (
    <table
      className={`w-full ${tableFixed ? 'table-fixed' : ''} text-sm border border-gray-200 rounded-lg overflow-hidden`}
    >
      <tbody>
        {groups.map((group, gi) => (
          <GroupSection
            key={group.title ?? `g${gi}`}
            group={group}
            labelWidthClass={labelWidthClass}
            isLast={gi === groups.length - 1}
          />
        ))}
      </tbody>
    </table>
  );
}

function GroupSection({
  group,
  labelWidthClass,
  isLast,
}: {
  readonly group: OverviewGroup;
  readonly labelWidthClass: string;
  readonly isLast: boolean;
}) {
  return (
    <>
      {group.title && (
        <tr className="border-b border-gray-200 bg-gray-100">
          <td
            colSpan={2}
            className={`px-3 py-0.5 text-[10px] font-semibold text-gray-600 tracking-wide leading-tight ${
              group.titleCase === 'lower' ? '' : 'uppercase'
            }`}
          >
            {group.title}
          </td>
        </tr>
      )}
      {group.rows.map((row, ri) => {
        const isLastRow = isLast && ri === group.rows.length - 1;
        return (
          <tr
            key={row.label}
            className={`align-top ${isLastRow ? '' : 'border-b border-gray-200'}`}
          >
            <td
              className={`bg-gray-50 text-gray-600 font-medium px-3 py-2 ${labelWidthClass} whitespace-nowrap`}
            >
              {row.label}
            </td>
            <td className="px-3 py-2 overflow-hidden">{row.value}</td>
          </tr>
        );
      })}
    </>
  );
}

// Case-insensitive single header lookup. Returns the first value or undefined.
function getHeader(headers: Record<string, string[]>, name: string): string | undefined {
  if (!headers) return undefined;
  const direct = headers[name];
  if (direct && direct.length > 0) return direct[0];
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      if (v && v.length > 0) return v[0];
    }
  }
  return undefined;
}

// Response Overview table: label/value rows per requirements.
// Only renders Ratelimit rows when at least one ratelimit header is present.
function ResponseOverviewTable({ response }: { readonly response: NonNullable<Request['response']> }) {
  const headers = response.headers || {};

  const contentType = getHeader(headers, 'Content-Type');
  const requestId = getHeader(headers, 'Request-Id') ?? getHeader(headers, 'request-id');

  // Ratelimit headers (Anthropic unified 5h / 7d)
  const rl5hUtil = getHeader(headers, 'Anthropic-Ratelimit-Unified-5h-Utilization');
  const rl5hReset = getHeader(headers, 'Anthropic-Ratelimit-Unified-5h-Reset');
  const rl5hStatus = getHeader(headers, 'Anthropic-Ratelimit-Unified-5h-Status');
  const rl7dUtil = getHeader(headers, 'Anthropic-Ratelimit-Unified-7d-Utilization');
  const rl7dReset = getHeader(headers, 'Anthropic-Ratelimit-Unified-7d-Reset');
  const rl7dStatus = getHeader(headers, 'Anthropic-Ratelimit-Unified-7d-Status');
  const hasAnyRatelimit =
    rl5hUtil !== undefined ||
    rl5hReset !== undefined ||
    rl5hStatus !== undefined ||
    rl7dUtil !== undefined ||
    rl7dReset !== undefined ||
    rl7dStatus !== undefined;

  const formatResetTs = (raw: string | undefined): string => {
    if (raw === undefined || raw === null || raw === '') return '없음';
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    return formatStableDateTime(n * 1000);
  };

  const formatRatelimitRow = (
    util: string | undefined,
    reset: string | undefined,
    status: string | undefined,
  ): React.ReactNode => {
    const parts = [
      util ?? '없음',
      formatResetTs(reset),
      status ?? '없음',
    ];
    return <span className="text-gray-900 break-all">{parts.join(' / ')}</span>;
  };

  const body = response.body;
  const usage = body?.usage;

  const none = <span className="text-gray-400 italic">없음</span>;

  const plainText = (v: string | number | undefined | null): React.ReactNode =>
    v === undefined || v === null || v === ''
      ? none
      : <span className="text-gray-900 break-all">{String(v)}</span>;

  const mono = (v: string | number | undefined | null): React.ReactNode =>
    v === undefined || v === null || v === ''
      ? none
      : <span className="text-gray-900 font-mono text-xs break-all">{String(v)}</span>;

  const num = (v: number | undefined | null): React.ReactNode =>
    v === undefined || v === null ? none : <span className="text-gray-900">{Number(v).toLocaleString()}</span>;

  const groups: OverviewGroup[] = [
    {
      rows: [
        { label: 'Status', value: <span className="text-gray-900">{response.statusCode}</span> },
      ],
    },
    {
      title: 'Header',
      rows: [
        { label: 'Content-Type', value: plainText(contentType) },
        { label: 'Request-Id', value: mono(requestId) },
        ...(hasAnyRatelimit
          ? [
              { label: 'Ratelimit-5h', value: formatRatelimitRow(rl5hUtil, rl5hReset, rl5hStatus) },
              { label: 'Ratelimit-7d', value: formatRatelimitRow(rl7dUtil, rl7dReset, rl7dStatus) },
            ]
          : []),
      ],
    },
    {
      title: 'Body',
      rows: [
        { label: 'id', value: mono(body?.id) },
        { label: 'stop_reason', value: plainText(body?.stop_reason) },
      ],
    },
    {
      title: 'usage',
      titleCase: 'lower',
      rows: [
        { label: 'cache_read_input_tokens', value: num(usage?.cache_read_input_tokens) },
        { label: 'cache_creation_input_tokens', value: num(usage?.cache_creation_input_tokens) },
        { label: 'cache_creation.ephemeral_5m_input_tokens', value: num(usage?.cache_creation?.ephemeral_5m_input_tokens) },
        { label: 'cache_creation.ephemeral_1h_input_tokens', value: num(usage?.cache_creation?.ephemeral_1h_input_tokens) },
        { label: 'input_tokens', value: num(usage?.input_tokens) },
        { label: 'output_tokens', value: num(usage?.output_tokens) },
      ],
    },
  ];

  return <OverviewTable groups={groups} labelWidthClass="w-[240px]" />;
}