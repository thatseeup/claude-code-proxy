package service

import (
	"context"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// SessionIndexEntry holds the project context associated with a single Claude
// Code session (jsonl file). All fields are immutable after insertion — updates
// replace the whole entry.
type SessionIndexEntry struct {
	SessionID   string
	ProjectPath string // encoded directory name under ~/.claude/projects
	DisplayName string // human-readable project label (decoded)
	Title       string // last title from ai-title/custom-title lines (may be "")
}

// SessionIndex is a queryable, live mapping from sessionID to project context.
// Implementations must be safe for concurrent use.
type SessionIndex interface {
	// Lookup returns the entry for the given sessionID and true if found,
	// otherwise returns a zero SessionIndexEntry and false.
	Lookup(sessionID string) (SessionIndexEntry, bool)

	// Rebuild re-scans rootDir and atomically replaces the in-memory map.
	// If rootDir does not exist the index is cleared (not an error). Errors
	// opening/reading individual jsonl files are logged and skipped.
	Rebuild() error

	// Watch monitors the rootDir for file-system changes and updates the index
	// incrementally. It first tries OS-level fsnotify; if that fails, it falls
	// back to periodic polling at the configured poll interval.
	// Watch blocks until ctx is cancelled.
	Watch(ctx context.Context) error
}

// sessionIndexImpl is the concrete in-process implementation of SessionIndex.
type sessionIndexImpl struct {
	rootDir      string
	mu           sync.RWMutex
	entries      map[string]SessionIndexEntry // key: sessionID
	logger       *log.Logger
	pollInterval time.Duration // used as fallback poll period (default 10s)
}

// NewSessionIndex returns a new, empty SessionIndex that scans rootDir on
// Rebuild. rootDir should be the ~/.claude/projects directory.
// If logger is nil a no-op logger writing to os.Stdout is used.
func NewSessionIndex(rootDir string, logger *log.Logger) SessionIndex {
	if logger == nil {
		logger = log.New(os.Stdout, "session-index: ", log.LstdFlags|log.Lshortfile)
	}
	return &sessionIndexImpl{
		rootDir:      rootDir,
		entries:      make(map[string]SessionIndexEntry),
		logger:       logger,
		pollInterval: 10 * time.Second,
	}
}

// newSessionIndexWithPollInterval creates a SessionIndex with a custom poll
// interval. Used in tests to speed up the polling fallback path.
func newSessionIndexWithPollInterval(rootDir string, logger *log.Logger, pollInterval time.Duration) *sessionIndexImpl {
	if logger == nil {
		logger = log.New(os.Stdout, "session-index: ", log.LstdFlags|log.Lshortfile)
	}
	return &sessionIndexImpl{
		rootDir:      rootDir,
		entries:      make(map[string]SessionIndexEntry),
		logger:       logger,
		pollInterval: pollInterval,
	}
}

// Lookup implements SessionIndex.
func (idx *sessionIndexImpl) Lookup(sessionID string) (SessionIndexEntry, bool) {
	idx.mu.RLock()
	defer idx.mu.RUnlock()
	e, ok := idx.entries[sessionID]
	return e, ok
}

// Rebuild implements SessionIndex. It enumerates all project subdirectories
// under rootDir, then all *.jsonl files inside each, and builds a fresh map
// that replaces the current one atomically.
func (idx *sessionIndexImpl) Rebuild() error {
	entries, err := os.ReadDir(idx.rootDir)
	if err != nil {
		if os.IsNotExist(err) {
			// rootDir absent — clear and return (not an error per spec).
			idx.mu.Lock()
			idx.entries = make(map[string]SessionIndexEntry)
			idx.mu.Unlock()
			return nil
		}
		return err
	}

	newMap := make(map[string]SessionIndexEntry)

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		encodedProjectPath := entry.Name()
		displayName := projectDisplayName(encodedProjectPath)
		projectDir := filepath.Join(idx.rootDir, encodedProjectPath)

		files, err := os.ReadDir(projectDir)
		if err != nil {
			idx.logger.Printf("⚠️  session-index: cannot read dir %s: %v", projectDir, err)
			continue
		}

		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}

			sessionID := strings.TrimSuffix(f.Name(), ".jsonl")
			filePath := filepath.Join(projectDir, f.Name())

			title, err := extractSessionTitle(filePath)
			if err != nil {
				idx.logger.Printf("⚠️  session-index: title extract %s: %v", filePath, err)
				// still add the entry with no title
			}

			newMap[sessionID] = SessionIndexEntry{
				SessionID:   sessionID,
				ProjectPath: encodedProjectPath,
				DisplayName: displayName,
				Title:       title,
			}
		}
	}

	idx.mu.Lock()
	idx.entries = newMap
	idx.mu.Unlock()

	idx.logger.Printf("✅ session-index: rebuilt — %d sessions indexed", len(newMap))
	return nil
}

// Watch implements SessionIndex. It tries to use fsnotify for OS-level events
// and falls back to periodic polling if watcher creation fails.
func (idx *sessionIndexImpl) Watch(ctx context.Context) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		idx.logger.Printf("⚠️  session-index: fsnotify unavailable (%v) — falling back to polling every %s", err, idx.pollInterval)
		return idx.watchPoll(ctx)
	}
	defer watcher.Close()

	// Add rootDir and all existing project subdirectories.
	if addErr := idx.addToWatcher(watcher, idx.rootDir); addErr != nil {
		if os.IsNotExist(addErr) {
			// rootDir doesn't exist yet — fall back to polling.
			idx.logger.Printf("⚠️  session-index: rootDir missing — polling fallback")
			return idx.watchPoll(ctx)
		}
		idx.logger.Printf("⚠️  session-index: watcher.Add(%s): %v — polling fallback", idx.rootDir, addErr)
		return idx.watchPoll(ctx)
	}

	subdirs, _ := os.ReadDir(idx.rootDir)
	for _, d := range subdirs {
		if d.IsDir() {
			path := filepath.Join(idx.rootDir, d.Name())
			if addErr := watcher.Add(path); addErr != nil {
				idx.logger.Printf("⚠️  session-index: watcher.Add(%s): %v", path, addErr)
			}
		}
	}

	idx.logger.Printf("👀 session-index: watching %s via fsnotify", idx.rootDir)

	for {
		select {
		case <-ctx.Done():
			idx.logger.Printf("🛑 session-index: watcher stopped")
			return ctx.Err()

		case event, ok := <-watcher.Events:
			if !ok {
				return nil
			}
			idx.handleFSEvent(watcher, event)

		case watchErr, ok := <-watcher.Errors:
			if !ok {
				return nil
			}
			idx.logger.Printf("⚠️  session-index: watcher error: %v", watchErr)
		}
	}
}

// handleFSEvent processes a single fsnotify event and updates the index
// incrementally. It is called from the Watch event loop.
func (idx *sessionIndexImpl) handleFSEvent(watcher *fsnotify.Watcher, event fsnotify.Event) {
	path := event.Name

	switch {
	// New directory created → add to watcher and index all its jsonl files.
	case event.Has(fsnotify.Create):
		info, err := os.Stat(path)
		if err != nil {
			return
		}
		if info.IsDir() {
			// New project directory.
			if addErr := watcher.Add(path); addErr != nil {
				idx.logger.Printf("⚠️  session-index: watcher.Add(%s): %v", path, addErr)
			}
			idx.indexProjectDir(path)
			return
		}
		// New jsonl file.
		if strings.HasSuffix(path, ".jsonl") {
			idx.upsertFile(path)
		}

	// Existing jsonl file written (title may have changed).
	case event.Has(fsnotify.Write):
		if strings.HasSuffix(path, ".jsonl") {
			idx.upsertFile(path)
		}

	// File or directory removed / renamed.
	case event.Has(fsnotify.Remove), event.Has(fsnotify.Rename):
		// We cannot stat a deleted path; infer from extension / known paths.
		if strings.HasSuffix(path, ".jsonl") {
			idx.removeFile(path)
		} else {
			// Possibly a project directory removal — remove all sessions under it.
			idx.removeProjectDir(path)
			// fsnotify auto-removes deleted paths from the watcher; no action needed.
		}
	}
}

// indexProjectDir inserts index entries for every *.jsonl inside projDir.
func (idx *sessionIndexImpl) indexProjectDir(projDir string) {
	encodedProjectPath := filepath.Base(projDir)
	displayName := projectDisplayName(encodedProjectPath)

	files, err := os.ReadDir(projDir)
	if err != nil {
		idx.logger.Printf("⚠️  session-index: cannot read dir %s: %v", projDir, err)
		return
	}

	idx.mu.Lock()
	defer idx.mu.Unlock()

	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".jsonl") {
			continue
		}
		sessionID := strings.TrimSuffix(f.Name(), ".jsonl")
		filePath := filepath.Join(projDir, f.Name())
		title, _ := extractSessionTitle(filePath)
		idx.entries[sessionID] = SessionIndexEntry{
			SessionID:   sessionID,
			ProjectPath: encodedProjectPath,
			DisplayName: displayName,
			Title:       title,
		}
	}
}

// upsertFile inserts or updates the index entry for a single *.jsonl file.
func (idx *sessionIndexImpl) upsertFile(filePath string) {
	projDir := filepath.Dir(filePath)
	encodedProjectPath := filepath.Base(projDir)
	displayName := projectDisplayName(encodedProjectPath)
	sessionID := strings.TrimSuffix(filepath.Base(filePath), ".jsonl")

	title, err := extractSessionTitle(filePath)
	if err != nil {
		idx.logger.Printf("⚠️  session-index: title extract %s: %v", filePath, err)
	}

	idx.mu.Lock()
	idx.entries[sessionID] = SessionIndexEntry{
		SessionID:   sessionID,
		ProjectPath: encodedProjectPath,
		DisplayName: displayName,
		Title:       title,
	}
	idx.mu.Unlock()
}

// removeFile removes the index entry corresponding to a deleted/renamed *.jsonl.
func (idx *sessionIndexImpl) removeFile(filePath string) {
	sessionID := strings.TrimSuffix(filepath.Base(filePath), ".jsonl")
	idx.mu.Lock()
	delete(idx.entries, sessionID)
	idx.mu.Unlock()
}

// removeProjectDir removes all index entries whose ProjectPath matches the
// base name of projDir.
func (idx *sessionIndexImpl) removeProjectDir(projDir string) {
	encodedProjectPath := filepath.Base(projDir)
	idx.mu.Lock()
	for sid, e := range idx.entries {
		if e.ProjectPath == encodedProjectPath {
			delete(idx.entries, sid)
		}
	}
	idx.mu.Unlock()
}

// addToWatcher wraps watcher.Add, returning the error directly.
func (idx *sessionIndexImpl) addToWatcher(watcher *fsnotify.Watcher, path string) error {
	return watcher.Add(path)
}

// watchPoll is the polling fallback: rebuilds the index every pollInterval
// until ctx is cancelled.
func (idx *sessionIndexImpl) watchPoll(ctx context.Context) error {
	ticker := time.NewTicker(idx.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := idx.Rebuild(); err != nil {
				idx.logger.Printf("⚠️  session-index: poll rebuild error: %v", err)
			}
		}
	}
}
