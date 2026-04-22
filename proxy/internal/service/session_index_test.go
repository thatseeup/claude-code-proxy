package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// buildTestProjectsDir creates a temporary root directory that mimics the
// ~/.claude/projects layout:
//
//	<root>/
//	  <encodedProjA>/
//	    <sid1>.jsonl   — contains an ai-title line
//	    <sid2>.jsonl   — contains a custom-title line
//	  <encodedProjB>/
//	    <sid3>.jsonl   — no title lines
func buildTestProjectsDir(t *testing.T) (rootDir string, encodedProjA, encodedProjB, sid1, sid2, sid3 string) {
	t.Helper()

	rootDir = t.TempDir()
	encodedProjA = "-tmp-project-alpha"
	encodedProjB = "-tmp-project-beta"
	sid1 = "session-aaa-111"
	sid2 = "session-bbb-222"
	sid3 = "session-ccc-333"

	dirA := filepath.Join(rootDir, encodedProjA)
	dirB := filepath.Join(rootDir, encodedProjB)
	if err := os.MkdirAll(dirA, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dirA, err)
	}
	if err := os.MkdirAll(dirB, 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", dirB, err)
	}

	// sid1 — ai-title only
	writeJSONLLines(t, filepath.Join(dirA, sid1+".jsonl"), []string{
		`{"type":"summary","message":{"role":"user","content":"hello"}}`,
		`{"type":"ai-title","aiTitle":"Alpha Session One","customTitle":""}`,
	})

	// sid2 — custom-title wins over ai-title
	writeJSONLLines(t, filepath.Join(dirA, sid2+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"AI Draft","customTitle":""}`,
		`{"type":"custom-title","aiTitle":"","customTitle":"Alpha Custom Two"}`,
	})

	// sid3 — no title
	writeJSONLLines(t, filepath.Join(dirB, sid3+".jsonl"), []string{
		`{"type":"summary","message":{"role":"user","content":"hi"}}`,
	})

	return
}

// writeJSONLLines writes a slice of JSON lines to path.
func writeJSONLLines(t *testing.T, path string, lines []string) {
	t.Helper()
	content := ""
	for _, l := range lines {
		content += l + "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writeJSONLLines %s: %v", path, err)
	}
}

// TestSessionIndexRebuildAndLookup verifies that after Rebuild, Lookup returns
// the correct entry for every known sessionID and returns false for unknown ones.
func TestSessionIndexRebuild(t *testing.T) {
	rootDir, _, _, sid1, sid2, sid3 := buildTestProjectsDir(t)

	idx := NewSessionIndex(rootDir, nil)
	if err := idx.Rebuild(); err != nil {
		t.Fatalf("Rebuild: %v", err)
	}

	t.Run("sid1 has ai-title", func(t *testing.T) {
		e, ok := idx.Lookup(sid1)
		if !ok {
			t.Fatalf("Lookup(%q) returned false", sid1)
		}
		if e.Title != "Alpha Session One" {
			t.Errorf("Title = %q, want %q", e.Title, "Alpha Session One")
		}
		if e.SessionID != sid1 {
			t.Errorf("SessionID = %q, want %q", e.SessionID, sid1)
		}
		if e.ProjectPath == "" {
			t.Error("ProjectPath is empty")
		}
	})

	t.Run("sid2 custom-title wins", func(t *testing.T) {
		e, ok := idx.Lookup(sid2)
		if !ok {
			t.Fatalf("Lookup(%q) returned false", sid2)
		}
		if e.Title != "Alpha Custom Two" {
			t.Errorf("Title = %q, want %q", e.Title, "Alpha Custom Two")
		}
	})

	t.Run("sid3 no title is empty string", func(t *testing.T) {
		e, ok := idx.Lookup(sid3)
		if !ok {
			t.Fatalf("Lookup(%q) returned false", sid3)
		}
		if e.Title != "" {
			t.Errorf("Title = %q, want empty", e.Title)
		}
	})

	t.Run("unknown sessionID returns false", func(t *testing.T) {
		_, ok := idx.Lookup("does-not-exist")
		if ok {
			t.Error("Lookup returned true for unknown session")
		}
	})
}

// TestSessionIndexRootMissing verifies that a non-existent rootDir is treated
// as an empty index rather than an error.
func TestSessionIndexRootMissing(t *testing.T) {
	idx := NewSessionIndex("/nonexistent-path-that-cannot-exist-xyz", nil)
	if err := idx.Rebuild(); err != nil {
		t.Fatalf("Rebuild with missing rootDir should not error, got: %v", err)
	}
	_, ok := idx.Lookup("anything")
	if ok {
		t.Error("expected empty index, got a hit")
	}
}

// TestSessionIndexRebuildAtomicSwap verifies that a second Rebuild replaces
// the index content completely (stale entries from the first build are gone).
func TestSessionIndexRebuildAtomicSwap(t *testing.T) {
	rootDir := t.TempDir()
	projDir := filepath.Join(rootDir, "-tmp-proj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}

	sid := "swap-session"
	writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"Before","customTitle":""}`,
	})

	idx := NewSessionIndex(rootDir, nil)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}
	e, _ := idx.Lookup(sid)
	if e.Title != "Before" {
		t.Fatalf("expected 'Before', got %q", e.Title)
	}

	// Update the file and rebuild — the index should reflect the new title.
	writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"After","customTitle":""}`,
	})
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}
	e, _ = idx.Lookup(sid)
	if e.Title != "After" {
		t.Errorf("expected 'After' after re-Rebuild, got %q", e.Title)
	}
}

// TestSessionIndexConcurrency runs Lookup and Rebuild concurrently to verify
// that the sync.RWMutex prevents races (run with -race).
func TestSessionIndexConcurrency(t *testing.T) {
	rootDir, _, _, sid1, sid2, _ := buildTestProjectsDir(t)

	idx := NewSessionIndex(rootDir, nil)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}

	const goroutines = 20
	var wg sync.WaitGroup
	wg.Add(goroutines)

	for i := 0; i < goroutines; i++ {
		i := i
		go func() {
			defer wg.Done()
			if i%3 == 0 {
				_ = idx.Rebuild()
			} else {
				for _, sid := range []string{sid1, sid2, "unknown"} {
					_, _ = idx.Lookup(sid)
				}
			}
		}()
	}

	wg.Wait()
}

// TestSessionIndexNonJSONLFilesIgnored verifies that non-.jsonl files inside a
// project directory are silently ignored.
func TestSessionIndexNonJSONLFilesIgnored(t *testing.T) {
	rootDir := t.TempDir()
	projDir := filepath.Join(rootDir, "-tmp-misc")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Write a jsonl and a non-jsonl file.
	sid := "real-session"
	writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"Real","customTitle":""}`,
	})
	if err := os.WriteFile(filepath.Join(projDir, "readme.txt"), []byte("ignore me"), 0o644); err != nil {
		t.Fatal(err)
	}

	idx := NewSessionIndex(rootDir, nil)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}

	e, ok := idx.Lookup(sid)
	if !ok {
		t.Fatalf("Lookup(%q) = false, want true", sid)
	}
	if e.Title != "Real" {
		t.Errorf("Title = %q, want Real", e.Title)
	}

	// The txt file must not appear as a session.
	_, ok = idx.Lookup("readme")
	if ok {
		t.Error("non-jsonl file was indexed as a session")
	}
}

// TestSessionIndexMultipleProjects verifies entries from different projects are
// all present after a single Rebuild.
func TestSessionIndexMultipleProjects(t *testing.T) {
	rootDir := t.TempDir()

	for projIdx := 0; projIdx < 3; projIdx++ {
		projDir := filepath.Join(rootDir, fmt.Sprintf("-tmp-proj-%d", projIdx))
		if err := os.MkdirAll(projDir, 0o755); err != nil {
			t.Fatal(err)
		}
		for sessIdx := 0; sessIdx < 2; sessIdx++ {
			sid := fmt.Sprintf("sess-%d-%d", projIdx, sessIdx)
			writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
				fmt.Sprintf(`{"type":"ai-title","aiTitle":"Title %d-%d","customTitle":""}`, projIdx, sessIdx),
			})
		}
	}

	idx := NewSessionIndex(rootDir, nil)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}

	for projIdx := 0; projIdx < 3; projIdx++ {
		for sessIdx := 0; sessIdx < 2; sessIdx++ {
			sid := fmt.Sprintf("sess-%d-%d", projIdx, sessIdx)
			e, ok := idx.Lookup(sid)
			if !ok {
				t.Errorf("Lookup(%q) = false", sid)
				continue
			}
			want := fmt.Sprintf("Title %d-%d", projIdx, sessIdx)
			if e.Title != want {
				t.Errorf("Lookup(%q).Title = %q, want %q", sid, e.Title, want)
			}
		}
	}
}

// ---------------------------------------------------------------------------
// Watch tests (polling mode forced via newSessionIndexWithPollInterval)
// ---------------------------------------------------------------------------

// pollInterval used in watch tests — short enough to make tests fast.
const watchTestPollInterval = 50 * time.Millisecond

// waitForCondition retries f until it returns true or the deadline is reached.
func waitForCondition(t *testing.T, timeout time.Duration, f func() bool) bool {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if f() {
			return true
		}
		time.Sleep(10 * time.Millisecond)
	}
	return false
}

// TestSessionIndexWatchPollCreate verifies that a new *.jsonl file created
// after Watch starts is picked up within a couple of poll intervals.
func TestSessionIndexWatchPollCreate(t *testing.T) {
	rootDir := t.TempDir()
	projDir := filepath.Join(rootDir, "-watch-proj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}

	idx := newSessionIndexWithPollInterval(rootDir, nil, watchTestPollInterval)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = idx.Watch(ctx) }()

	// Give watcher goroutine a moment to start.
	time.Sleep(watchTestPollInterval)

	sid := "watch-create-session"
	writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"Created Title","customTitle":""}`,
	})

	if !waitForCondition(t, 2*time.Second, func() bool {
		_, ok := idx.Lookup(sid)
		return ok
	}) {
		t.Fatalf("session %q not found in index after file creation", sid)
	}

	e, _ := idx.Lookup(sid)
	if e.Title != "Created Title" {
		t.Errorf("Title = %q, want %q", e.Title, "Created Title")
	}
}

// TestSessionIndexWatchPollModify verifies that updating an existing *.jsonl
// file (changing its title) is reflected in the index after the next poll.
func TestSessionIndexWatchPollModify(t *testing.T) {
	rootDir := t.TempDir()
	projDir := filepath.Join(rootDir, "-watch-proj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}

	sid := "watch-modify-session"
	writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"Old Title","customTitle":""}`,
	})

	idx := newSessionIndexWithPollInterval(rootDir, nil, watchTestPollInterval)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = idx.Watch(ctx) }()

	// Give watcher goroutine a moment to start.
	time.Sleep(watchTestPollInterval)

	// Overwrite with a new title.
	writeJSONLLines(t, filepath.Join(projDir, sid+".jsonl"), []string{
		`{"type":"ai-title","aiTitle":"New Title","customTitle":""}`,
	})

	if !waitForCondition(t, 2*time.Second, func() bool {
		e, ok := idx.Lookup(sid)
		return ok && e.Title == "New Title"
	}) {
		e, _ := idx.Lookup(sid)
		t.Fatalf("expected title %q after modify, got %q", "New Title", e.Title)
	}
}

// TestSessionIndexWatchPollDelete verifies that removing a *.jsonl file causes
// its entry to disappear from the index after the next poll.
func TestSessionIndexWatchPollDelete(t *testing.T) {
	rootDir := t.TempDir()
	projDir := filepath.Join(rootDir, "-watch-proj")
	if err := os.MkdirAll(projDir, 0o755); err != nil {
		t.Fatal(err)
	}

	sid := "watch-delete-session"
	filePath := filepath.Join(projDir, sid+".jsonl")
	writeJSONLLines(t, filePath, []string{
		`{"type":"ai-title","aiTitle":"Will Be Deleted","customTitle":""}`,
	})

	idx := newSessionIndexWithPollInterval(rootDir, nil, watchTestPollInterval)
	if err := idx.Rebuild(); err != nil {
		t.Fatal(err)
	}

	if _, ok := idx.Lookup(sid); !ok {
		t.Fatalf("session %q not in index before delete", sid)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = idx.Watch(ctx) }()

	// Give watcher goroutine a moment to start.
	time.Sleep(watchTestPollInterval)

	if err := os.Remove(filePath); err != nil {
		t.Fatal(err)
	}

	if !waitForCondition(t, 2*time.Second, func() bool {
		_, ok := idx.Lookup(sid)
		return !ok
	}) {
		t.Fatalf("session %q still in index after file deletion", sid)
	}
}

// TestSessionIndexWatchContextCancel verifies that Watch returns when the
// context is cancelled (polling mode).
func TestSessionIndexWatchContextCancel(t *testing.T) {
	rootDir := t.TempDir()
	idx := newSessionIndexWithPollInterval(rootDir, nil, watchTestPollInterval)

	ctx, cancel := context.WithCancel(context.Background())

	done := make(chan error, 1)
	go func() { done <- idx.Watch(ctx) }()

	// Cancel quickly.
	time.Sleep(2 * watchTestPollInterval)
	cancel()

	select {
	case err := <-done:
		if err != context.Canceled {
			t.Errorf("Watch returned %v, want context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Watch did not return after context cancel")
	}
}
