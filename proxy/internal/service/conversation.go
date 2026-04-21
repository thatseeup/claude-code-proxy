package service

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type ConversationService interface {
	GetConversations() (map[string][]*Conversation, error)
	GetConversation(projectPath, sessionID string) (*Conversation, error)
	GetConversationsByProject(projectPath string) ([]*Conversation, error)
	GetProjects() ([]ProjectSummary, error)
}

// ProjectSummary is a compact view of a project directory under
// ~/.claude/projects. LastMTime is the max mtime across that directory's
// jsonl files, used as the sidebar sort key.
type ProjectSummary struct {
	ProjectPath       string    `json:"projectPath"`
	DisplayName       string    `json:"displayName"`
	LastMTime         time.Time `json:"lastMTime"`
	ConversationCount int       `json:"conversationCount"`
}

type conversationService struct {
	claudeProjectsPath string
}

func NewConversationService() ConversationService {
	homeDir, _ := os.UserHomeDir()
	return &conversationService{
		claudeProjectsPath: filepath.Join(homeDir, ".claude", "projects"),
	}
}

// ConversationMessage represents a single message in a Claude conversation
type ConversationMessage struct {
	ParentUUID  *string         `json:"parentUuid"`
	IsSidechain bool            `json:"isSidechain"`
	UserType    string          `json:"userType"`
	CWD         string          `json:"cwd"`
	SessionID   string          `json:"sessionId"`
	Version     string          `json:"version"`
	Type        string          `json:"type"`
	Message     json.RawMessage `json:"message"`
	UUID        string          `json:"uuid"`
	Timestamp   string          `json:"timestamp"`
	ParsedTime  time.Time       `json:"-"`
}

// Conversation represents a complete conversation session
type Conversation struct {
	SessionID    string                 `json:"sessionId"`
	ProjectPath  string                 `json:"projectPath"`
	ProjectName  string                 `json:"projectName"`
	Messages     []*ConversationMessage `json:"messages"`
	StartTime    time.Time              `json:"startTime"`
	EndTime      time.Time              `json:"endTime"`
	MessageCount int                    `json:"messageCount"`
	FileModTime  time.Time              `json:"-"` // Used for sorting, not exported
}

// GetConversations returns all conversations organized by project
func (cs *conversationService) GetConversations() (map[string][]*Conversation, error) {
	conversations := make(map[string][]*Conversation)
	var parseErrors []string

	err := filepath.Walk(cs.claudeProjectsPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Log but don't fail the entire walk
			parseErrors = append(parseErrors, fmt.Sprintf("Error accessing %s: %v", path, err))
			return nil
		}

		if !strings.HasSuffix(path, ".jsonl") {
			return nil
		}

		// Get the project path relative to claudeProjectsPath
		projectDir := filepath.Dir(path)
		projectRelPath, _ := filepath.Rel(cs.claudeProjectsPath, projectDir)

		// Skip files directly in the projects directory
		if projectRelPath == "." || projectRelPath == "" {
			return nil
		}

		conv, err := cs.parseConversationFile(path, projectRelPath)
		if err != nil {
			// Log parsing errors but continue processing other files
			parseErrors = append(parseErrors, fmt.Sprintf("Failed to parse %s: %v", path, err))
			return nil
		}

		if conv != nil {
			// Include conversations even if they have no messages (edge case)
			conversations[projectRelPath] = append(conversations[projectRelPath], conv)
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("failed to walk claude projects: %w", err)
	}

	// Some parsing errors may have occurred but were handled

	// Sort conversations within each project by file modification time (newest first)
	for project := range conversations {
		sort.Slice(conversations[project], func(i, j int) bool {
			return conversations[project][i].FileModTime.After(conversations[project][j].FileModTime)
		})
	}

	return conversations, nil
}

// GetConversation returns a specific conversation by project and session ID
func (cs *conversationService) GetConversation(projectPath, sessionID string) (*Conversation, error) {
	filePath := filepath.Join(cs.claudeProjectsPath, projectPath, sessionID+".jsonl")

	conv, err := cs.parseConversationFile(filePath, projectPath)
	if err != nil {
		return nil, fmt.Errorf("failed to parse conversation: %w", err)
	}

	return conv, nil
}

// GetConversationsByProject returns all conversations for a specific project
func (cs *conversationService) GetConversationsByProject(projectPath string) ([]*Conversation, error) {
	var conversations []*Conversation
	projectDir := filepath.Join(cs.claudeProjectsPath, projectPath)

	files, err := os.ReadDir(projectDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read project directory: %w", err)
	}

	for _, file := range files {
		if !strings.HasSuffix(file.Name(), ".jsonl") {
			continue
		}

		filePath := filepath.Join(projectDir, file.Name())
		conv, err := cs.parseConversationFile(filePath, projectPath)
		if err != nil {
			continue
		}

		if conv != nil && len(conv.Messages) > 0 {
			conversations = append(conversations, conv)
		}
	}

	// Sort by file modification time (newest first)
	sort.Slice(conversations, func(i, j int) bool {
		return conversations[i].FileModTime.After(conversations[j].FileModTime)
	})

	return conversations, nil
}

// GetProjects returns a summary of each project directory under
// claudeProjectsPath, sorted by the most-recent jsonl mtime (DESC).
// Directories without any jsonl files are skipped.
func (cs *conversationService) GetProjects() ([]ProjectSummary, error) {
	entries, err := os.ReadDir(cs.claudeProjectsPath)
	if err != nil {
		if os.IsNotExist(err) {
			return []ProjectSummary{}, nil
		}
		return nil, fmt.Errorf("failed to read claude projects directory: %w", err)
	}

	summaries := make([]ProjectSummary, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		projectPath := entry.Name()
		projectDir := filepath.Join(cs.claudeProjectsPath, projectPath)

		files, err := os.ReadDir(projectDir)
		if err != nil {
			continue
		}

		var (
			lastMTime time.Time
			count     int
		)
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			count++
			if info.ModTime().After(lastMTime) {
				lastMTime = info.ModTime()
			}
		}

		if count == 0 {
			continue
		}

		summaries = append(summaries, ProjectSummary{
			ProjectPath:       projectPath,
			DisplayName:       projectDisplayName(projectPath),
			LastMTime:         lastMTime,
			ConversationCount: count,
		})
	}

	sort.Slice(summaries, func(i, j int) bool {
		return summaries[i].LastMTime.After(summaries[j].LastMTime)
	})

	return summaries, nil
}

// dirExistsOnDisk is the default existsFn used by decodeProjectPath. It reports
// whether the given absolute path exists and is a directory on the local file
// system.
func dirExistsOnDisk(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}

// decodeProjectPath progressively reconstructs an encoded Claude Code project
// path (e.g. "-Users-syoh-Development-thatseeup-claude-code-proxy") back into
// its original directory path by probing the file system. Because Claude Code
// replaces path separators with "-", the mapping is ambiguous whenever a
// directory name itself contains "-" (such as "claude-code-proxy"). We resolve
// the ambiguity greedily from the left: starting with "/", we consume encoded
// tokens one by one and extend the resolved path with the longest suffix that
// still exists as a directory. Tokens that cannot be absorbed form the
// remainder, re-joined with "-" (preserving the original encoded spelling for
// the unresolved tail).
//
// Return values:
//   - resolved: the longest existing directory prefix (without trailing slash),
//     or "" if not even the first token exists.
//   - remainder: the leftover encoded tail joined by "-" (without leading "-"),
//     or "" if the entire encoded path resolved successfully.
//
// existsFn is injected so callers (mainly tests) can drive the algorithm
// without touching the real file system. Pass nil to use the default os.Stat
// based probe.
func decodeProjectPath(encoded string, existsFn func(string) bool) (resolved string, remainder string) {
	if existsFn == nil {
		existsFn = dirExistsOnDisk
	}

	if encoded == "" {
		return "", ""
	}

	trimmed := strings.TrimPrefix(encoded, "-")
	if trimmed == "" {
		return "", ""
	}

	tokens := strings.Split(trimmed, "-")

	// Walk tokens left-to-right. At each step, consume one or more tokens joined
	// by "-" to form a single path segment, choosing the LONGEST run whose
	// concatenation still exists as a directory under the currently resolved
	// prefix. Preferring the longest run keeps multi-hyphen directory names
	// ("claude-code-proxy", "my-app") intact even when intermediate
	// sub-combinations ("claude", "my") do not exist on disk.
	resolved = ""
	i := 0
	for i < len(tokens) {
		if tokens[i] == "" {
			// Consecutive hyphens in the encoded string — treat as a literal
			// separator we cannot resolve further.
			break
		}

		// Find the longest j>i such that joining tokens[i:j] with "-" yields
		// an existing directory under resolved.
		bestJ := 0
		for j := i + 1; j <= len(tokens); j++ {
			segment := strings.Join(tokens[i:j], "-")
			var candidate string
			if resolved == "" {
				candidate = "/" + segment
			} else {
				candidate = resolved + "/" + segment
			}
			if existsFn(candidate) {
				bestJ = j
			}
		}

		if bestJ == 0 {
			// No extension from position i resolved — remaining tokens are
			// the remainder.
			break
		}

		segment := strings.Join(tokens[i:bestJ], "-")
		if resolved == "" {
			resolved = "/" + segment
		} else {
			resolved = resolved + "/" + segment
		}
		i = bestJ
	}

	if i >= len(tokens) {
		return resolved, ""
	}

	remainder = strings.Join(tokens[i:], "-")
	return resolved, remainder
}

// projectDisplayName derives a short human-readable label from Claude Code's
// encoded project path (e.g. "-Users-syoh-Development-thatseeup-claude-code-proxy"
// → "claude-code-proxy"). It delegates to decodeProjectPath so that multi-hyphen
// directory names are preserved whenever the actual directory still exists on
// disk. When part of the encoded path is unresolved, the unresolved tail is
// returned as-is (re-joined with "-"); when the entire path resolves, the
// final path segment is returned.
func projectDisplayName(projectPath string) string {
	return projectDisplayNameWith(projectPath, nil)
}

// projectDisplayNameWith is the test-injectable variant of projectDisplayName.
// A nil existsFn delegates to the default os.Stat based probe inside
// decodeProjectPath.
func projectDisplayNameWith(projectPath string, existsFn func(string) bool) string {
	resolved, remainder := decodeProjectPath(projectPath, existsFn)
	if remainder != "" {
		return remainder
	}
	if resolved != "" {
		return filepath.Base(resolved)
	}
	return projectPath
}

// parseConversationFile reads and parses a JSONL conversation file
func (cs *conversationService) parseConversationFile(filePath, projectPath string) (*Conversation, error) {
	// Get file info for modification time
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to stat file: %w", err)
	}

	file, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	var messages []*ConversationMessage
	var parseErrors int
	lineNum := 0

	scanner := bufio.NewScanner(file)

	// Increase buffer size for large messages
	const maxScanTokenSize = 10 * 1024 * 1024 // 10MB
	buf := make([]byte, maxScanTokenSize)
	scanner.Buffer(buf, maxScanTokenSize)

	for scanner.Scan() {
		lineNum++
		line := scanner.Bytes()

		// Skip empty lines
		if len(line) == 0 {
			continue
		}

		var msg ConversationMessage
		if err := json.Unmarshal(line, &msg); err != nil {
			parseErrors++
			// Log only first few errors to avoid spam
			if parseErrors <= 3 {
				// Skip malformed line
			}
			continue
		}

		// Parse timestamp
		if msg.Timestamp != "" {
			parsedTime, err := time.Parse(time.RFC3339, msg.Timestamp)
			if err != nil {
				// Try alternative timestamp formats
				parsedTime, err = time.Parse(time.RFC3339Nano, msg.Timestamp)
				if err != nil {
					// Skip message with invalid timestamp
				}
			}
			msg.ParsedTime = parsedTime
		}

		messages = append(messages, &msg)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scanner error: %w", err)
	}

	if parseErrors > 3 {
		// Some lines failed to parse but were skipped
	}

	// Return empty conversation if no messages (caller can decide what to do)
	if len(messages) == 0 {
		// Extract session ID from filename
		sessionID := filepath.Base(filePath)
		sessionID = strings.TrimSuffix(sessionID, ".jsonl")

		// Use the full project path as provided
		projectName := projectPath
		// If it looks like a file path, extract the last component
		if strings.Contains(projectPath, "-") {
			// This handles cases like "-Users-seifghazi-dev-llm-proxy"
			projectName = projectPath
		}

		return &Conversation{
			SessionID:    sessionID,
			ProjectPath:  projectPath,
			ProjectName:  projectName,
			Messages:     messages,
			StartTime:    time.Time{},
			EndTime:      time.Time{},
			MessageCount: 0,
			FileModTime:  fileInfo.ModTime(),
		}, nil
	}

	// Sort messages by timestamp
	sort.Slice(messages, func(i, j int) bool {
		return messages[i].ParsedTime.Before(messages[j].ParsedTime)
	})

	// Extract session ID from filename
	sessionID := filepath.Base(filePath)
	sessionID = strings.TrimSuffix(sessionID, ".jsonl")

	// Use the full project path as provided
	projectName := projectPath

	// Find first and last valid timestamps
	var startTime, endTime time.Time
	for _, msg := range messages {
		if !msg.ParsedTime.IsZero() {
			if startTime.IsZero() || msg.ParsedTime.Before(startTime) {
				startTime = msg.ParsedTime
			}
			if endTime.IsZero() || msg.ParsedTime.After(endTime) {
				endTime = msg.ParsedTime
			}
		}
	}

	// If no valid timestamps found, use file modification time
	if startTime.IsZero() {
		startTime = fileInfo.ModTime()
		endTime = fileInfo.ModTime()
	}

	return &Conversation{
		SessionID:    sessionID,
		ProjectPath:  projectPath,
		ProjectName:  projectName,
		Messages:     messages,
		StartTime:    startTime,
		EndTime:      endTime,
		MessageCount: len(messages),
		FileModTime:  fileInfo.ModTime(),
	}, nil
}
