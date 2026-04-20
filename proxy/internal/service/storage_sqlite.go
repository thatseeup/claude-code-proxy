package service

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"

	"github.com/seifghazi/claude-code-monitor/internal/config"
	"github.com/seifghazi/claude-code-monitor/internal/model"
)

type sqliteStorageService struct {
	db     *sql.DB
	config *config.StorageConfig
}

func NewSQLiteStorageService(cfg *config.StorageConfig) (StorageService, error) {
	db, err := sql.Open("sqlite3", cfg.DBPath)
	if err != nil {
		return nil, fmt.Errorf("failed to open database: %w", err)
	}

	service := &sqliteStorageService{
		db:     db,
		config: cfg,
	}

	if err := service.createTables(); err != nil {
		return nil, fmt.Errorf("failed to create tables: %w", err)
	}

	return service, nil
}

func (s *sqliteStorageService) createTables() error {
	schema := `
	CREATE TABLE IF NOT EXISTS requests (
		id TEXT PRIMARY KEY,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		method TEXT NOT NULL,
		endpoint TEXT NOT NULL,
		headers TEXT NOT NULL,
		body_raw TEXT NOT NULL,
		user_agent TEXT,
		content_type TEXT,
		prompt_grade TEXT,
		response TEXT,
		model TEXT,
		original_model TEXT,
		routed_model TEXT,
		session_id TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_timestamp ON requests(timestamp DESC);
	CREATE INDEX IF NOT EXISTS idx_endpoint ON requests(endpoint);
	CREATE INDEX IF NOT EXISTS idx_model ON requests(model);
	CREATE INDEX IF NOT EXISTS idx_session_id ON requests(session_id);
	`

	_, err := s.db.Exec(schema)
	return err
}

func (s *sqliteStorageService) SaveRequest(request *model.RequestLog) (string, error) {
	headersJSON, err := json.Marshal(request.Headers)
	if err != nil {
		return "", fmt.Errorf("failed to marshal headers: %w", err)
	}

	query := `
		INSERT INTO requests (id, timestamp, method, endpoint, headers, body_raw, user_agent, content_type, model, original_model, routed_model, session_id)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`

	_, err = s.db.Exec(query,
		request.RequestID,
		request.Timestamp,
		request.Method,
		request.Endpoint,
		string(headersJSON),
		request.BodyRaw,
		request.UserAgent,
		request.ContentType,
		request.Model,
		request.OriginalModel,
		request.RoutedModel,
		request.SessionID,
	)

	if err != nil {
		return "", fmt.Errorf("failed to insert request: %w", err)
	}

	return request.RequestID, nil
}

func (s *sqliteStorageService) GetRequests(page, limit int) ([]model.RequestLog, int, error) {
	// Get total count
	var total int
	err := s.db.QueryRow("SELECT COUNT(*) FROM requests").Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to get total count: %w", err)
	}

	// Get paginated results
	offset := (page - 1) * limit
	query := `
		SELECT id, timestamp, method, endpoint, headers, body_raw, model, user_agent, content_type, prompt_grade, response, original_model, routed_model, session_id
		FROM requests
		ORDER BY timestamp DESC
		LIMIT ? OFFSET ?
	`

	rows, err := s.db.Query(query, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var requests []model.RequestLog
	for rows.Next() {
		var req model.RequestLog
		var headersJSON, bodyRaw string
		var promptGradeJSON, responseJSON, sessionID sql.NullString

		err := rows.Scan(
			&req.RequestID,
			&req.Timestamp,
			&req.Method,
			&req.Endpoint,
			&headersJSON,
			&bodyRaw,
			&req.Model,
			&req.UserAgent,
			&req.ContentType,
			&promptGradeJSON,
			&responseJSON,
			&req.OriginalModel,
			&req.RoutedModel,
			&sessionID,
		)
		if err != nil {
			// Error scanning row - skip
			continue
		}

		if sessionID.Valid {
			req.SessionID = sessionID.String
		}
		req.BodyRaw = bodyRaw

		// Unmarshal JSON fields
		if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
			// Error unmarshaling headers
			continue
		}

		var body interface{}
		if err := json.Unmarshal([]byte(bodyRaw), &body); err != nil {
			// Error unmarshaling body
			continue
		}
		req.Body = body

		if promptGradeJSON.Valid {
			var grade model.PromptGrade
			if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
				req.PromptGrade = &grade
			}
		}

		if responseJSON.Valid {
			var resp model.ResponseLog
			if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
				req.Response = &resp
			}
		}

		requests = append(requests, req)
	}

	return requests, total, nil
}

func (s *sqliteStorageService) ClearRequests() (int, error) {
	result, err := s.db.Exec("DELETE FROM requests")
	if err != nil {
		return 0, fmt.Errorf("failed to clear requests: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}

	return int(rowsAffected), nil
}

func (s *sqliteStorageService) UpdateRequestWithGrading(requestID string, grade *model.PromptGrade) error {
	gradeJSON, err := json.Marshal(grade)
	if err != nil {
		return fmt.Errorf("failed to marshal grade: %w", err)
	}

	query := "UPDATE requests SET prompt_grade = ? WHERE id = ?"
	_, err = s.db.Exec(query, string(gradeJSON), requestID)
	if err != nil {
		return fmt.Errorf("failed to update request with grading: %w", err)
	}

	return nil
}

func (s *sqliteStorageService) UpdateRequestWithResponse(request *model.RequestLog) error {
	responseJSON, err := json.Marshal(request.Response)
	if err != nil {
		return fmt.Errorf("failed to marshal response: %w", err)
	}

	query := "UPDATE requests SET response = ? WHERE id = ?"
	_, err = s.db.Exec(query, string(responseJSON), request.RequestID)
	if err != nil {
		return fmt.Errorf("failed to update request with response: %w", err)
	}

	return nil
}

func (s *sqliteStorageService) EnsureDirectoryExists() error {
	// No directory needed for SQLite
	return nil
}

func (s *sqliteStorageService) GetRequestByShortID(shortID string) (*model.RequestLog, string, error) {
	query := `
		SELECT id, timestamp, method, endpoint, headers, body_raw, model, user_agent, content_type, prompt_grade, response, original_model, routed_model, session_id
		FROM requests
		WHERE id LIKE ?
		ORDER BY timestamp DESC
		LIMIT 1
	`

	var req model.RequestLog
	var headersJSON, bodyRaw string
	var promptGradeJSON, responseJSON, sessionID sql.NullString

	err := s.db.QueryRow(query, "%"+shortID).Scan(
		&req.RequestID,
		&req.Timestamp,
		&req.Method,
		&req.Endpoint,
		&headersJSON,
		&bodyRaw,
		&req.Model,
		&req.UserAgent,
		&req.ContentType,
		&promptGradeJSON,
		&responseJSON,
		&req.OriginalModel,
		&req.RoutedModel,
		&sessionID,
	)

	if err == sql.ErrNoRows {
		return nil, "", fmt.Errorf("request with ID %s not found", shortID)
	}
	if err != nil {
		return nil, "", fmt.Errorf("failed to query request: %w", err)
	}

	if sessionID.Valid {
		req.SessionID = sessionID.String
	}
	req.BodyRaw = bodyRaw

	// Unmarshal JSON fields
	if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal headers: %w", err)
	}

	var body interface{}
	if err := json.Unmarshal([]byte(bodyRaw), &body); err != nil {
		return nil, "", fmt.Errorf("failed to unmarshal body: %w", err)
	}
	req.Body = body

	if promptGradeJSON.Valid {
		var grade model.PromptGrade
		if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
			req.PromptGrade = &grade
		}
	}

	if responseJSON.Valid {
		var resp model.ResponseLog
		if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
			req.Response = &resp
		}
	}

	return &req, req.RequestID, nil
}

func (s *sqliteStorageService) GetConfig() *config.StorageConfig {
	return s.config
}

func (s *sqliteStorageService) GetAllRequests(modelFilter string) ([]*model.RequestLog, error) {
	query := `
		SELECT id, timestamp, method, endpoint, headers, body_raw, model, user_agent, content_type, prompt_grade, response, original_model, routed_model, session_id
		FROM requests
	`
	args := []interface{}{}

	if modelFilter != "" && modelFilter != "all" {
		query += " WHERE LOWER(model) LIKE ?"
		args = append(args, "%"+strings.ToLower(modelFilter)+"%")

	}

	query += " ORDER BY timestamp DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query requests: %w", err)
	}
	defer rows.Close()

	var requests []*model.RequestLog
	for rows.Next() {
		var req model.RequestLog
		var headersJSON, bodyRaw string
		var promptGradeJSON, responseJSON, sessionID sql.NullString

		err := rows.Scan(
			&req.RequestID,
			&req.Timestamp,
			&req.Method,
			&req.Endpoint,
			&headersJSON,
			&bodyRaw,
			&req.Model,
			&req.UserAgent,
			&req.ContentType,
			&promptGradeJSON,
			&responseJSON,
			&req.OriginalModel,
			&req.RoutedModel,
			&sessionID,
		)
		if err != nil {
			// Error scanning row - skip
			continue
		}

		if sessionID.Valid {
			req.SessionID = sessionID.String
		}
		req.BodyRaw = bodyRaw

		// Unmarshal JSON fields
		if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
			// Error unmarshaling headers
			continue
		}

		var body interface{}
		if err := json.Unmarshal([]byte(bodyRaw), &body); err != nil {
			// Error unmarshaling body
			continue
		}
		req.Body = body

		if promptGradeJSON.Valid {
			var grade model.PromptGrade
			if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
				req.PromptGrade = &grade
			}
		}

		if responseJSON.Valid {
			var resp model.ResponseLog
			if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
				req.Response = &resp
			}
		}

		requests = append(requests, &req)
	}

	return requests, nil
}

// GetRequestsBySessionID returns all requests for a given session_id, applying
// the optional model filter in the same way as GetAllRequests. If
// sessionIDFilter is the literal empty string, this returns rows where
// session_id IS NULL OR session_id = '' (the "Unknown" bucket).
func (s *sqliteStorageService) GetRequestsBySessionID(sessionIDFilter string, modelFilter string) ([]*model.RequestLog, error) {
	query := `
		SELECT id, timestamp, method, endpoint, headers, body_raw, model, user_agent, content_type, prompt_grade, response, original_model, routed_model, session_id
		FROM requests
	`
	conds := []string{}
	args := []interface{}{}

	if sessionIDFilter == "" {
		conds = append(conds, "(session_id IS NULL OR session_id = '')")
	} else {
		conds = append(conds, "session_id = ?")
		args = append(args, sessionIDFilter)
	}

	if modelFilter != "" && modelFilter != "all" {
		conds = append(conds, "LOWER(model) LIKE ?")
		args = append(args, "%"+strings.ToLower(modelFilter)+"%")
	}

	if len(conds) > 0 {
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += " ORDER BY timestamp DESC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to query requests by session: %w", err)
	}
	defer rows.Close()

	var requests []*model.RequestLog
	for rows.Next() {
		var req model.RequestLog
		var headersJSON, bodyRaw string
		var promptGradeJSON, responseJSON, sessionID sql.NullString

		err := rows.Scan(
			&req.RequestID,
			&req.Timestamp,
			&req.Method,
			&req.Endpoint,
			&headersJSON,
			&bodyRaw,
			&req.Model,
			&req.UserAgent,
			&req.ContentType,
			&promptGradeJSON,
			&responseJSON,
			&req.OriginalModel,
			&req.RoutedModel,
			&sessionID,
		)
		if err != nil {
			continue
		}

		if sessionID.Valid {
			req.SessionID = sessionID.String
		}
		req.BodyRaw = bodyRaw

		if err := json.Unmarshal([]byte(headersJSON), &req.Headers); err != nil {
			continue
		}

		var body interface{}
		if err := json.Unmarshal([]byte(bodyRaw), &body); err != nil {
			continue
		}
		req.Body = body

		if promptGradeJSON.Valid {
			var grade model.PromptGrade
			if err := json.Unmarshal([]byte(promptGradeJSON.String), &grade); err == nil {
				req.PromptGrade = &grade
			}
		}

		if responseJSON.Valid {
			var resp model.ResponseLog
			if err := json.Unmarshal([]byte(responseJSON.String), &resp); err == nil {
				req.Response = &resp
			}
		}

		requests = append(requests, &req)
	}

	return requests, nil
}

func (s *sqliteStorageService) GetSessionSummaries() ([]SessionSummary, error) {
	// Group by session_id treating NULL and '' as the same "Unknown" bucket.
	// COALESCE(session_id, '') lets us collapse NULLs into the empty-string group.
	query := `
		SELECT COALESCE(session_id, '') AS sid,
		       MIN(timestamp) AS first_ts,
		       MAX(timestamp) AS last_ts,
		       COUNT(*) AS cnt
		FROM requests
		GROUP BY sid
		ORDER BY last_ts DESC
	`

	rows, err := s.db.Query(query)
	if err != nil {
		return nil, fmt.Errorf("failed to query session summaries: %w", err)
	}
	defer rows.Close()

	summaries := make([]SessionSummary, 0)
	for rows.Next() {
		var sum SessionSummary
		var firstTS, lastTS string
		if err := rows.Scan(&sum.SessionID, &firstTS, &lastTS, &sum.RequestCount); err != nil {
			return nil, fmt.Errorf("failed to scan session summary: %w", err)
		}
		if t, err := parseStoredTimestamp(firstTS); err == nil {
			sum.FirstTimestamp = t
		}
		if t, err := parseStoredTimestamp(lastTS); err == nil {
			sum.LastTimestamp = t
		}
		summaries = append(summaries, sum)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("failed to iterate session summaries: %w", err)
	}

	return summaries, nil
}

// parseStoredTimestamp parses the timestamp format(s) we might find in the
// requests.timestamp column. Historically we insert RFC3339 strings from Go,
// but SQLite may also return CURRENT_TIMESTAMP defaults as "2006-01-02 15:04:05".
func parseStoredTimestamp(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("unrecognized timestamp format: %q", s)
}

func (s *sqliteStorageService) DeleteRequestsBySessionID(sessionID string) (int, error) {
	var (
		result sql.Result
		err    error
	)
	if sessionID == "" {
		// Unknown bucket: empty or NULL session_id.
		result, err = s.db.Exec("DELETE FROM requests WHERE session_id IS NULL OR session_id = ''")
	} else {
		result, err = s.db.Exec("DELETE FROM requests WHERE session_id = ?", sessionID)
	}
	if err != nil {
		return 0, fmt.Errorf("failed to delete requests for session %q: %w", sessionID, err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("failed to get rows affected: %w", err)
	}
	return int(rowsAffected), nil
}

func (s *sqliteStorageService) Close() error {
	return s.db.Close()
}
