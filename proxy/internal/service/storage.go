package service

import (
	"time"

	"github.com/seifghazi/claude-code-monitor/internal/config"
	"github.com/seifghazi/claude-code-monitor/internal/model"
)

// SessionSummary is a compact aggregate view of requests grouped by session_id.
// SessionID == "" represents the "Unknown" (header missing / empty) bucket.
type SessionSummary struct {
	SessionID      string    `json:"sessionId"`
	FirstTimestamp time.Time `json:"firstTimestamp"`
	LastTimestamp  time.Time `json:"lastTimestamp"`
	RequestCount   int       `json:"requestCount"`
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
