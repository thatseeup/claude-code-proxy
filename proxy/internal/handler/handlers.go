package handler

import (
	"bufio"
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"

	"github.com/seifghazi/claude-code-monitor/internal/model"
	"github.com/seifghazi/claude-code-monitor/internal/service"
)

type Handler struct {
	anthropicService    service.AnthropicService
	storageService      service.StorageService
	conversationService service.ConversationService
	modelRouter         *service.ModelRouter
	logger              *log.Logger
	sanitizeHeaders     bool
}

func New(anthropicService service.AnthropicService, storageService service.StorageService, logger *log.Logger, modelRouter *service.ModelRouter, sanitizeHeaders bool) *Handler {
	conversationService := service.NewConversationService()

	return &Handler{
		anthropicService:    anthropicService,
		storageService:      storageService,
		conversationService: conversationService,
		modelRouter:         modelRouter,
		logger:              logger,
		sanitizeHeaders:     sanitizeHeaders,
	}
}

func (h *Handler) ChatCompletions(w http.ResponseWriter, r *http.Request) {
	// This endpoint is for compatibility but we're an Anthropic proxy
	// Return a helpful error message
	writeErrorResponse(w, "This is an Anthropic proxy. Please use the /v1/messages endpoint instead of /v1/chat/completions", http.StatusBadRequest)
}

func (h *Handler) Messages(w http.ResponseWriter, r *http.Request) {
	// Get body bytes from context (set by middleware)
	bodyBytes := getBodyBytes(r)
	if bodyBytes == nil {
		http.Error(w, "Error reading request body", http.StatusBadRequest)
		return
	}

	// Parse the request
	var req model.AnthropicRequest
	if err := json.Unmarshal(bodyBytes, &req); err != nil {
		log.Printf("❌ Error parsing JSON: %v", err)
		writeErrorResponse(w, "Invalid JSON", http.StatusBadRequest)
		return
	}

	requestID := generateRequestID()
	startTime := time.Now()

	// Use model router to determine provider and route the request
	decision, err := h.modelRouter.DetermineRoute(&req)
	if err != nil {
		log.Printf("❌ Error routing request: %v", err)
		writeErrorResponse(w, "Failed to route request", http.StatusInternalServerError)
		return
	}

	// Create request log with routing information
	requestLog := &model.RequestLog{
		RequestID:     requestID,
		Timestamp:     time.Now().Format(time.RFC3339),
		Method:        r.Method,
		Endpoint:      r.URL.Path,
		Headers:       SanitizeHeaders(r.Header, h.sanitizeHeaders),
		BodyRaw:       string(bodyBytes),
		Model:         decision.OriginalModel,
		OriginalModel: decision.OriginalModel,
		RoutedModel:   decision.TargetModel,
		UserAgent:     r.Header.Get("User-Agent"),
		ContentType:   r.Header.Get("Content-Type"),
		SessionID:     r.Header.Get("X-Claude-Code-Session-Id"),
	}

	if _, err := h.storageService.SaveRequest(requestLog); err != nil {
		log.Printf("❌ Error saving request: %v", err)
	}

	// If the model was changed by routing, update the request body
	if decision.TargetModel != decision.OriginalModel {
		req.Model = decision.TargetModel

		// Re-marshal the request with the updated model
		updatedBodyBytes, err := json.Marshal(req)
		if err != nil {
			log.Printf("❌ Error marshaling updated request: %v", err)
			writeErrorResponse(w, "Failed to process request", http.StatusInternalServerError)
			return
		}

		// Update the request body
		r.Body = io.NopCloser(bytes.NewReader(updatedBodyBytes))
		r.ContentLength = int64(len(updatedBodyBytes))
		r.Header.Set("Content-Length", fmt.Sprintf("%d", len(updatedBodyBytes)))
	}

	// Forward the request to the selected provider
	resp, err := decision.Provider.ForwardRequest(r.Context(), r)
	if err != nil {
		log.Printf("❌ Error forwarding to %s API: %v", decision.Provider.Name(), err)
		writeErrorResponse(w, "Failed to forward request", http.StatusInternalServerError)
		return
	}
	defer resp.Body.Close()

	if req.Stream {
		h.handleStreamingResponse(w, resp, requestLog, startTime)
		return
	}

	h.handleNonStreamingResponse(w, resp, requestLog, startTime)
}

func (h *Handler) Models(w http.ResponseWriter, r *http.Request) {
	// This proxy uses pattern-based routing and supports any model dynamically.
	// Returning an empty list since the actual supported models depend on the
	// upstream providers (Anthropic, OpenAI) and their current offerings.
	response := &model.ModelsResponse{
		Object: "list",
		Data:   []model.ModelInfo{},
	}

	writeJSONResponse(w, response)
}

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	response := &model.HealthResponse{
		Status:    "healthy",
		Timestamp: time.Now(),
	}

	writeJSONResponse(w, response)
}

func (h *Handler) UI(w http.ResponseWriter, r *http.Request) {
	htmlContent, err := os.ReadFile("index.html")
	if err != nil {
		// Error reading index.html
		http.Error(w, "UI not available", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "text/html")
	w.Write(htmlContent)
}

func (h *Handler) GetRequests(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 10 // Default limit
	}

	// Get model filter from query parameters
	modelFilter := r.URL.Query().Get("model")
	if modelFilter == "" {
		modelFilter = "all"
	}

	// Optional sessionId filter — when present, restrict to that session.
	// The literal path token "unknown" maps to the empty sessionID bucket.
	sessionIDQuery, hasSessionFilter := "", false
	if raw, ok := r.URL.Query()["sessionId"]; ok && len(raw) > 0 {
		hasSessionFilter = true
		sessionIDQuery = raw[0]
		if sessionIDQuery == sessionPathUnknown {
			sessionIDQuery = ""
		}
	}

	var (
		allRequests []*model.RequestLog
		err         error
	)
	if hasSessionFilter {
		allRequests, err = h.storageService.GetRequestsBySessionID(sessionIDQuery, modelFilter)
	} else {
		allRequests, err = h.storageService.GetAllRequests(modelFilter)
	}
	if err != nil {
		log.Printf("Error getting requests: %v", err)
		http.Error(w, "Failed to get requests", http.StatusInternalServerError)
		return
	}

	// Convert pointers to values for consistency
	requests := make([]model.RequestLog, len(allRequests))
	for i, req := range allRequests {
		if req != nil {
			requests[i] = *req
		}
	}

	// Calculate total before pagination
	total := len(requests)

	// Apply pagination
	start := (page - 1) * limit
	end := start + limit
	if start >= len(requests) {
		requests = []model.RequestLog{}
	} else {
		if end > len(requests) {
			end = len(requests)
		}
		requests = requests[start:end]
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		Requests []model.RequestLog `json:"requests"`
		Total    int                `json:"total"`
	}{
		Requests: requests,
		Total:    total,
	})
}

func (h *Handler) DeleteRequests(w http.ResponseWriter, r *http.Request) {

	clearedCount, err := h.storageService.ClearRequests()
	if err != nil {
		log.Printf("Error clearing requests: %v", err)
		writeErrorResponse(w, "Error clearing request history", http.StatusInternalServerError)
		return
	}

	response := map[string]interface{}{
		"message": "Request history cleared",
		"deleted": clearedCount,
	}

	writeJSONResponse(w, response)
}

func (h *Handler) NotFound(w http.ResponseWriter, r *http.Request) {
	writeErrorResponse(w, "Not found", http.StatusNotFound)
}

// sessionResponse mirrors service.SessionSummary but uses RFC3339 string
// timestamps so the wire format matches RequestLog.Timestamp.
type sessionResponse struct {
	SessionID      string `json:"sessionId"`
	FirstTimestamp string `json:"firstTimestamp"`
	LastTimestamp  string `json:"lastTimestamp"`
	RequestCount   int    `json:"requestCount"`
}

func (h *Handler) GetSessions(w http.ResponseWriter, r *http.Request) {
	summaries, err := h.storageService.GetSessionSummaries()
	if err != nil {
		log.Printf("❌ Error getting session summaries: %v", err)
		writeErrorResponse(w, "Failed to get sessions", http.StatusInternalServerError)
		return
	}

	out := make([]sessionResponse, 0, len(summaries))
	for _, s := range summaries {
		out = append(out, sessionResponse{
			SessionID:      s.SessionID,
			FirstTimestamp: s.FirstTimestamp.Format(time.RFC3339),
			LastTimestamp:  s.LastTimestamp.Format(time.RFC3339),
			RequestCount:   s.RequestCount,
		})
	}

	writeJSONResponse(w, out)
}

// sessionPathUnknown is the literal path segment that maps to the empty
// ("Unknown") session bucket.
const sessionPathUnknown = "unknown"

func (h *Handler) DeleteSession(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	id, ok := vars["id"]
	if !ok {
		writeErrorResponse(w, "Session ID is required", http.StatusBadRequest)
		return
	}

	sessionID := id
	if sessionID == sessionPathUnknown {
		sessionID = ""
	}

	deleted, err := h.storageService.DeleteRequestsBySessionID(sessionID)
	if err != nil {
		log.Printf("❌ Error deleting session %q: %v", sessionID, err)
		writeErrorResponse(w, "Failed to delete session", http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, map[string]interface{}{
		"deleted": deleted,
	})
}

func (h *Handler) handleStreamingResponse(w http.ResponseWriter, resp *http.Response, requestLog *model.RequestLog, startTime time.Time) {

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Anthropic API error: %d", resp.StatusCode)
		errorBytes, _ := io.ReadAll(resp.Body)
		log.Printf("Error details: %s", string(errorBytes))

		responseLog := &model.ResponseLog{
			StatusCode:   resp.StatusCode,
			Headers:      SanitizeHeaders(resp.Header, h.sanitizeHeaders),
			BodyText:     string(errorBytes),
			ResponseTime: time.Since(startTime).Milliseconds(),
			IsStreaming:  true,
			CompletedAt:  time.Now().Format(time.RFC3339),
		}

		requestLog.Response = responseLog
		if err := h.storageService.UpdateRequestWithResponse(requestLog); err != nil {
			log.Printf("❌ Error updating request with error response: %v", err)
		}

		w.WriteHeader(resp.StatusCode)
		w.Write(errorBytes)
		return
	}

	// Blocks are keyed by their streaming `index` so text and tool_use blocks
	// can interleave correctly. partialJSON accumulates `input_json_delta`
	// chunks per index; we parse them once the stream completes.
	blocks := map[int]*model.AnthropicContentBlock{}
	partialJSON := map[int]*strings.Builder{}
	var blockOrder []int

	var streamingChunks []string
	var finalUsage *model.AnthropicUsage
	var messageID string
	var modelName string
	var stopReason string
	// Raw `message` object from the first `message_start` event — used to
	// preserve upstream key order when we rebuild the stored response body.
	var messageStartRaw json.RawMessage

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if line == "" || !strings.HasPrefix(line, "data:") {
			continue
		}

		streamingChunks = append(streamingChunks, line)
		fmt.Fprintf(w, "%s\n\n", line)
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

		jsonData := strings.TrimPrefix(line, "data: ")

		// Parse as generic JSON first to capture usage data
		var genericEvent map[string]interface{}
		if err := json.Unmarshal([]byte(jsonData), &genericEvent); err != nil {
			log.Printf("⚠️ Error unmarshalling streaming event: %v", err)
			continue
		}

		// Capture metadata from message_start event
		if eventType, ok := genericEvent["type"].(string); ok && eventType == "message_start" {
			if message, ok := genericEvent["message"].(map[string]interface{}); ok {
				// Capture message metadata
				if id, ok := message["id"].(string); ok {
					messageID = id
				}
				if model, ok := message["model"].(string); ok {
					modelName = model
				}
				if reason, ok := message["stop_reason"].(string); ok {
					stopReason = reason
				}
			}
			// Preserve upstream key order by keeping the raw bytes of the
			// `message` object from message_start.
			if messageStartRaw == nil {
				var envelope struct {
					Message json.RawMessage `json:"message"`
				}
				if err := json.Unmarshal([]byte(jsonData), &envelope); err == nil {
					messageStartRaw = envelope.Message
				}
			}
		}

		// Capture usage data from message_delta event
		if eventType, ok := genericEvent["type"].(string); ok && eventType == "message_delta" {
			// Usage is at top level for message_delta events
			if usage, ok := genericEvent["usage"].(map[string]interface{}); ok {
				// Create finalUsage if it doesn't exist yet
				if finalUsage == nil {
					finalUsage = &model.AnthropicUsage{}
				}

				// Capture all usage fields
				if inputTokens, ok := usage["input_tokens"].(float64); ok {
					finalUsage.InputTokens = int(inputTokens)
				}
				if outputTokens, ok := usage["output_tokens"].(float64); ok {
					finalUsage.OutputTokens = int(outputTokens)
				}
				if cacheCreation, ok := usage["cache_creation_input_tokens"].(float64); ok {
					finalUsage.CacheCreationInputTokens = int(cacheCreation)
				}
				if cacheRead, ok := usage["cache_read_input_tokens"].(float64); ok {
					finalUsage.CacheReadInputTokens = int(cacheRead)
				}

			}
		}

		// Parse as structured event for content processing
		var event model.StreamingEvent
		if err := json.Unmarshal([]byte(jsonData), &event); err != nil {
			// Skip if structured parsing fails, but we already got the usage data above
			continue
		}

		switch event.Type {
		case "content_block_start":
			if event.ContentBlock != nil && event.Index != nil {
				idx := *event.Index
				if _, exists := blocks[idx]; !exists {
					blockOrder = append(blockOrder, idx)
				}
				block := &model.AnthropicContentBlock{
					Type: event.ContentBlock.Type,
					Text: event.ContentBlock.Text,
					ID:   event.ContentBlock.ID,
					Name: event.ContentBlock.Name,
				}
				if len(event.ContentBlock.Input) > 0 {
					block.Input = event.ContentBlock.Input
				}
				blocks[idx] = block
			}
		case "content_block_delta":
			if event.Delta != nil && event.Index != nil {
				idx := *event.Index
				block, ok := blocks[idx]
				if !ok {
					block = &model.AnthropicContentBlock{}
					blocks[idx] = block
					blockOrder = append(blockOrder, idx)
				}
				switch event.Delta.Type {
				case "text_delta":
					if block.Type == "" {
						block.Type = "text"
					}
					block.Text += event.Delta.Text
				case "input_json_delta":
					sb, ok := partialJSON[idx]
					if !ok {
						sb = &strings.Builder{}
						partialJSON[idx] = sb
					}
					sb.WriteString(event.Delta.PartialJSON)
				}
			}
		case "message_delta":
			if event.Delta != nil && event.Delta.StopReason != "" {
				stopReason = event.Delta.StopReason
			}
		case "message_stop":
			// End of stream - scanner will exit on its own
		}
	}

	responseLog := &model.ResponseLog{
		StatusCode:      resp.StatusCode,
		Headers:         SanitizeHeaders(resp.Header, h.sanitizeHeaders),
		StreamingChunks: streamingChunks,
		ResponseTime:    time.Since(startTime).Milliseconds(),
		IsStreaming:     true,
		CompletedAt:     time.Now().Format(time.RFC3339),
	}

	// Finalize tool_use input by parsing accumulated partial_json. If the
	// stream ended mid-input (unlikely but possible) we fall back to the raw
	// string so the UI can still render something.
	for idx, sb := range partialJSON {
		block, ok := blocks[idx]
		if !ok {
			continue
		}
		raw := sb.String()
		if raw == "" {
			block.Input = json.RawMessage("{}")
			continue
		}
		if json.Valid([]byte(raw)) {
			block.Input = json.RawMessage(raw)
		} else {
			encoded, _ := json.Marshal(raw)
			block.Input = encoded
		}
	}

	contentBlocks := make([]model.AnthropicContentBlock, 0, len(blockOrder))
	for _, idx := range blockOrder {
		if block, ok := blocks[idx]; ok && block.Type != "" {
			if block.Type == "tool_use" && len(block.Input) == 0 {
				block.Input = json.RawMessage("{}")
			}
			contentBlocks = append(contentBlocks, *block)
		}
	}

	// Build overrides: values we assembled from the stream that should replace
	// the corresponding keys in the original message_start object.
	overrides := map[string]interface{}{
		"content":     contentBlocks,
		"stop_reason": stopReason,
	}
	if finalUsage != nil {
		overrides["usage"] = finalUsage
	}

	responseBodyBytes, err := mergePreservingOrder(messageStartRaw, overrides, map[string]interface{}{
		"id":    messageID,
		"model": modelName,
		"role":  "assistant",
		"type":  "message",
	})
	if err != nil {
		log.Printf("❌ Error marshaling streaming response body: %v", err)
		responseBodyBytes = []byte("{}")
	}

	responseLog.Body = json.RawMessage(responseBodyBytes)

	requestLog.Response = responseLog
	if err := h.storageService.UpdateRequestWithResponse(requestLog); err != nil {
		log.Printf("❌ Error updating request with streaming response: %v", err)
	}

	if err := scanner.Err(); err != nil {
		log.Printf("❌ Streaming error: %v", err)
	} else {
		log.Println("✅ Streaming response completed")
	}
}

func (h *Handler) handleNonStreamingResponse(w http.ResponseWriter, resp *http.Response, requestLog *model.RequestLog, startTime time.Time) {
	responseBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("❌ Error reading Anthropic response: %v", err)
		writeErrorResponse(w, "Failed to read response", http.StatusInternalServerError)
		return
	}

	responseLog := &model.ResponseLog{
		StatusCode:   resp.StatusCode,
		Headers:      SanitizeHeaders(resp.Header, h.sanitizeHeaders),
		ResponseTime: time.Since(startTime).Milliseconds(),
		IsStreaming:  false,
		CompletedAt:  time.Now().Format(time.RFC3339),
	}

	// Parse the response as AnthropicResponse for consistent structure
	if resp.StatusCode == http.StatusOK {
		var anthropicResp model.AnthropicResponse
		if err := json.Unmarshal(responseBytes, &anthropicResp); err == nil {
			// Successfully parsed - store the structured response
			responseLog.Body = json.RawMessage(responseBytes)
		} else {
			// If parsing fails, store as text but log the error
			log.Printf("⚠️ Failed to parse Anthropic response: %v", err)
			log.Printf("📄 Response body (first 500 chars): %s", string(responseBytes[:min(500, len(responseBytes))]))
			responseLog.BodyText = string(responseBytes)
		}
	} else {
		// For error responses, store as text
		responseLog.BodyText = string(responseBytes)
	}

	requestLog.Response = responseLog
	if err := h.storageService.UpdateRequestWithResponse(requestLog); err != nil {
		log.Printf("❌ Error updating request with response: %v", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("❌ Anthropic API error: %d %s", resp.StatusCode, string(responseBytes))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(resp.StatusCode)
		w.Write(responseBytes)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(responseBytes)
}

// Helper function to get minimum of two integers
func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// mergePreservingOrder rebuilds a JSON object that keeps the key order of
// `original`, replacing values for any key present in `overrides`. Keys present
// in `original` but not in `overrides` keep their upstream bytes verbatim.
// Keys in `overrides` or `fallback` that don't appear in `original` are
// appended at the end (overrides first, then fallback) — this covers cases
// where `message_start` didn't include a field (e.g. `usage` arriving only in
// `message_delta`, or the entire `message_start` event being absent).
//
// Only the top-level key order is preserved; nested objects (content blocks,
// usage, etc.) are re-marshaled through standard encoding and their nested
// key order follows struct field order.
func mergePreservingOrder(original json.RawMessage, overrides, fallback map[string]interface{}) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')

	written := map[string]bool{}
	first := true
	writeKV := func(key string, valueBytes []byte) {
		if !first {
			buf.WriteByte(',')
		}
		first = false
		keyBytes, _ := json.Marshal(key)
		buf.Write(keyBytes)
		buf.WriteByte(':')
		buf.Write(valueBytes)
		written[key] = true
	}

	if len(original) > 0 {
		dec := json.NewDecoder(bytes.NewReader(original))
		tok, err := dec.Token()
		if err != nil {
			return nil, fmt.Errorf("read opening token: %w", err)
		}
		if d, ok := tok.(json.Delim); !ok || d != '{' {
			return nil, fmt.Errorf("expected object, got %v", tok)
		}
		for dec.More() {
			tok, err := dec.Token()
			if err != nil {
				return nil, fmt.Errorf("read key: %w", err)
			}
			key, ok := tok.(string)
			if !ok {
				return nil, fmt.Errorf("expected string key, got %v", tok)
			}
			if override, exists := overrides[key]; exists {
				valueBytes, err := json.Marshal(override)
				if err != nil {
					return nil, fmt.Errorf("marshal override %q: %w", key, err)
				}
				writeKV(key, valueBytes)
				// Consume the original value so the decoder stays in sync.
				var discard json.RawMessage
				if err := dec.Decode(&discard); err != nil {
					return nil, fmt.Errorf("discard original %q: %w", key, err)
				}
			} else {
				var raw json.RawMessage
				if err := dec.Decode(&raw); err != nil {
					return nil, fmt.Errorf("read original %q: %w", key, err)
				}
				writeKV(key, raw)
			}
		}
	}

	// Append keys that weren't in the original — overrides first (they're the
	// assembled stream state), then fallback scalars.
	for _, key := range []string{"content", "stop_reason", "usage"} {
		if v, ok := overrides[key]; ok && !written[key] {
			valueBytes, err := json.Marshal(v)
			if err != nil {
				return nil, fmt.Errorf("marshal trailing override %q: %w", key, err)
			}
			writeKV(key, valueBytes)
		}
	}
	for _, key := range []string{"id", "type", "role", "model"} {
		if v, ok := fallback[key]; ok && !written[key] {
			valueBytes, err := json.Marshal(v)
			if err != nil {
				return nil, fmt.Errorf("marshal fallback %q: %w", key, err)
			}
			writeKV(key, valueBytes)
		}
	}

	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func generateRequestID() string {
	bytes := make([]byte, 8)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

func getBodyBytes(r *http.Request) []byte {
	if bodyBytes, ok := r.Context().Value(model.BodyBytesKey).([]byte); ok {
		return bodyBytes
	}
	return nil
}

func writeJSONResponse(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(data); err != nil {
		log.Printf("❌ Error encoding JSON response: %v", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

func writeErrorResponse(w http.ResponseWriter, message string, statusCode int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	json.NewEncoder(w).Encode(&model.ErrorResponse{Error: message})
}

// extractTextFromMessage tries multiple strategies to extract text from a message
func extractTextFromMessage(message json.RawMessage) string {
	// Strategy 1: Direct string (simple text message)
	var directString string
	if err := json.Unmarshal(message, &directString); err == nil && directString != "" {
		return directString
	}

	// Strategy 2: Array format [{"type": "text", "text": "..."}]
	var msgArray []interface{}
	if err := json.Unmarshal(message, &msgArray); err == nil {
		for _, item := range msgArray {
			if itemMap, ok := item.(map[string]interface{}); ok {
				if itemMap["type"] == "text" {
					if text, ok := itemMap["text"].(string); ok && text != "" {
						return text
					}
				}
			}
		}
	}

	// Strategy 3: Content object format {"content": [{"type": "text", "text": "..."}]}
	var msgContent map[string]interface{}
	if err := json.Unmarshal(message, &msgContent); err == nil {
		if content, ok := msgContent["content"]; ok {
			if contentArray, ok := content.([]interface{}); ok {
				for _, block := range contentArray {
					if blockMap, ok := block.(map[string]interface{}); ok {
						if blockMap["type"] == "text" {
							if text, ok := blockMap["text"].(string); ok && text != "" {
								return text
							}
						}
					}
				}
			}
		}

		// Also check if content is a string directly
		if contentStr, ok := msgContent["content"].(string); ok && contentStr != "" {
			return contentStr
		}
	}

	// Strategy 4: Single object with text field {"type": "text", "text": "..."}
	var singleObj map[string]interface{}
	if err := json.Unmarshal(message, &singleObj); err == nil {
		if singleObj["type"] == "text" {
			if text, ok := singleObj["text"].(string); ok && text != "" {
				return text
			}
		}

		// Also check for content field at top level
		if text, ok := singleObj["content"].(string); ok && text != "" {
			return text
		}
	}

	return ""
}

// Conversation handlers

func (h *Handler) GetConversations(w http.ResponseWriter, r *http.Request) {

	conversations, err := h.conversationService.GetConversations()
	if err != nil {
		log.Printf("❌ Error getting conversations: %v", err)
		writeErrorResponse(w, "Failed to get conversations", http.StatusInternalServerError)
		return
	}

	// Flatten all conversations into a single array for the UI
	var allConversations []map[string]interface{}
	for _, convs := range conversations {
		for _, conv := range convs {
			// Extract first user message from the conversation
			var firstMessage string
			for _, msg := range conv.Messages {
				if msg.Type == "user" {
					// Try multiple parsing strategies
					text := extractTextFromMessage(msg.Message)
					if text != "" {
						firstMessage = text
						if len(firstMessage) > 200 {
							firstMessage = firstMessage[:200] + "..."
						}
						break
					}
				}
			}

			allConversations = append(allConversations, map[string]interface{}{
				"id":           conv.SessionID,
				"requestCount": conv.MessageCount,
				"startTime":    conv.StartTime.Format(time.RFC3339),
				"lastActivity": conv.EndTime.Format(time.RFC3339),
				"duration":     conv.EndTime.Sub(conv.StartTime).Milliseconds(),
				"firstMessage": firstMessage,
				"projectName":  conv.ProjectName,
			})
		}
	}

	// Sort by last activity (newest first)
	sort.Slice(allConversations, func(i, j int) bool {
		t1, _ := time.Parse(time.RFC3339, allConversations[i]["lastActivity"].(string))
		t2, _ := time.Parse(time.RFC3339, allConversations[j]["lastActivity"].(string))
		return t1.After(t2)
	})

	// Apply pagination
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 {
		limit = 10
	}

	start := (page - 1) * limit
	end := start + limit
	if start > len(allConversations) {
		allConversations = []map[string]interface{}{}
	} else {
		if end > len(allConversations) {
			end = len(allConversations)
		}
		allConversations = allConversations[start:end]
	}

	response := map[string]interface{}{
		"conversations": allConversations,
	}

	writeJSONResponse(w, response)
}

func (h *Handler) GetConversationByID(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	sessionID, ok := vars["id"]
	if !ok {
		http.Error(w, "Session ID is required", http.StatusBadRequest)
		return
	}

	projectPath := r.URL.Query().Get("project")
	if projectPath == "" {
		http.Error(w, "Project path is required", http.StatusBadRequest)
		return
	}

	conversation, err := h.conversationService.GetConversation(projectPath, sessionID)
	if err != nil {
		log.Printf("❌ Error getting conversation: %v", err)
		http.Error(w, "Conversation not found", http.StatusNotFound)
		return
	}

	writeJSONResponse(w, conversation)
}

// projectResponse mirrors service.ProjectSummary but uses RFC3339 strings
// for timestamps to stay consistent with other API responses.
type projectResponse struct {
	ProjectPath       string `json:"projectPath"`
	DisplayName       string `json:"displayName"`
	LastMTime         string `json:"lastMTime"`
	ConversationCount int    `json:"conversationCount"`
}

func (h *Handler) GetProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.conversationService.GetProjects()
	if err != nil {
		log.Printf("❌ Error getting projects: %v", err)
		writeErrorResponse(w, "Failed to get projects", http.StatusInternalServerError)
		return
	}

	out := make([]projectResponse, 0, len(projects))
	for _, p := range projects {
		out = append(out, projectResponse{
			ProjectPath:       p.ProjectPath,
			DisplayName:       p.DisplayName,
			LastMTime:         p.LastMTime.Format(time.RFC3339),
			ConversationCount: p.ConversationCount,
		})
	}

	writeJSONResponse(w, out)
}

func (h *Handler) GetConversationsByProject(w http.ResponseWriter, r *http.Request) {
	projectPath := r.URL.Query().Get("project")
	if projectPath == "" {
		http.Error(w, "Project path is required", http.StatusBadRequest)
		return
	}

	conversations, err := h.conversationService.GetConversationsByProject(projectPath)
	if err != nil {
		log.Printf("❌ Error getting project conversations: %v", err)
		writeErrorResponse(w, "Failed to get project conversations", http.StatusInternalServerError)
		return
	}

	writeJSONResponse(w, conversations)
}
