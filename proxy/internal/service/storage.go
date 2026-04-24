package service

import (
	"time"

	"github.com/seifghazi/claude-code-monitor/internal/config"
	"github.com/seifghazi/claude-code-monitor/internal/model"
)

// SessionSummary is a compact aggregate view of requests grouped by session_id.
// SessionID == "" represents the "Unknown" (header missing / empty) bucket.
//
// TotalCost is a pointer so the wire format can distinguish "no priceable
// requests in this session" (nil → JSON `null`) from "priceable requests
// summed to zero" (rare but possible; non-nil). It is computed at read time
// from each request's response body + model via CalculateCostUSD — never
// persisted to the DB.
type SessionSummary struct {
	SessionID          string    `json:"sessionId"`
	FirstTimestamp     time.Time `json:"firstTimestamp"`
	LastTimestamp      time.Time `json:"lastTimestamp"`
	RequestCount       int       `json:"requestCount"`
	ProjectPath        string    `json:"projectPath"`
	ProjectDisplayName string    `json:"projectDisplayName"`
	Title              string    `json:"title"`
	HasConversation    bool      `json:"hasConversation"`
	TotalCost          *float64  `json:"totalCost"`
}

type StorageService interface {
	SaveRequest(request *model.RequestLog) (string, error)
	GetRequests(page, limit int) ([]model.RequestLog, int, error)
	ClearRequests() (int, error)
	UpdateRequestWithGrading(requestID string, grade *model.PromptGrade) error
	UpdateRequestWithResponse(request *model.RequestLog) error
	EnsureDirectoryExists() error
	GetRequestByShortID(shortID string) (*model.RequestLog, string, error)
	GetConfig() *config.StorageConfig
	GetAllRequests(modelFilter string) ([]*model.RequestLog, error)
	GetRequestsBySessionID(sessionID string, modelFilter string) ([]*model.RequestLog, error)
	GetSessionSummaries() ([]SessionSummary, error)
	DeleteRequestsBySessionID(sessionID string) (int, error)
}
