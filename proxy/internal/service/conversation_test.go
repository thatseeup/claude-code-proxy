package service

import (
	"os"
	"path/filepath"
	"testing"
)

// newExistsFn returns an existsFn that reports true for any path in the given
// set. Used to drive decodeProjectPath without touching the real file system.
func newExistsFn(paths ...string) func(string) bool {
	set := make(map[string]struct{}, len(paths))
	for _, p := range paths {
		set[p] = struct{}{}
	}
	return func(p string) bool {
		_, ok := set[p]
		return ok
	}
}

func TestDecodeProjectPath(t *testing.T) {
	tests := []struct {
		name          string
		encoded       string
		existingDirs  []string
		wantResolved  string
		wantRemainder string
	}{
		{
			name:    "claude-code-proxy full resolution keeps hyphens in final segment",
			encoded: "-Users-syoh-Development-thatseeup-claude-code-proxy",
			existingDirs: []string{
				"/Users",
				"/Users/syoh",
				"/Users/syoh/Development",
				"/Users/syoh/Development/thatseeup",
				"/Users/syoh/Development/thatseeup/claude-code-proxy",
			},
			wantResolved:  "/Users/syoh/Development/thatseeup/claude-code-proxy",
			wantRemainder: "",
		},
		{
			name:    "single segment existing",
			encoded: "-tmp",
			existingDirs: []string{
				"/tmp",
			},
			wantResolved:  "/tmp",
			wantRemainder: "",
		},
		{
			name:          "first token does not exist — everything becomes remainder",
			encoded:       "-nope-foo-bar",
			existingDirs:  nil,
			wantResolved:  "",
			wantRemainder: "nope-foo-bar",
		},
		{
			name:    "partial resolution with unresolved trailing tokens",
			encoded: "-Users-syoh-Development-missing-folder",
			existingDirs: []string{
				"/Users",
				"/Users/syoh",
				"/Users/syoh/Development",
			},
			wantResolved:  "/Users/syoh/Development",
			wantRemainder: "missing-folder",
		},
		{
			name:          "empty string",
			encoded:       "",
			existingDirs:  nil,
			wantResolved:  "",
			wantRemainder: "",
		},
		{
			name:    "no leading hyphen still splits and resolves",
			encoded: "Users-syoh",
			existingDirs: []string{
				"/Users",
				"/Users/syoh",
			},
			wantResolved:  "/Users/syoh",
			wantRemainder: "",
		},
		{
			name:    "hyphen-containing intermediate directory is preserved",
			encoded: "-opt-my-app-src",
			existingDirs: []string{
				"/opt",
				"/opt/my-app",
				"/opt/my-app/src",
			},
			wantResolved:  "/opt/my-app/src",
			wantRemainder: "",
		},
		{
			name:    "prefers shorter match when longer merged form does not exist",
			encoded: "-Users-alice-project-extra",
			existingDirs: []string{
				"/Users",
				"/Users/alice",
				"/Users/alice/project",
			},
			wantResolved:  "/Users/alice/project",
			wantRemainder: "extra",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			resolved, remainder := decodeProjectPath(tc.encoded, newExistsFn(tc.existingDirs...))
			if resolved != tc.wantResolved {
				t.Errorf("resolved = %q, want %q", resolved, tc.wantResolved)
			}
			if remainder != tc.wantRemainder {
				t.Errorf("remainder = %q, want %q", remainder, tc.wantRemainder)
			}
		})
	}
}

func TestProjectDisplayName(t *testing.T) {
	tests := []struct {
		name         string
		projectPath  string
		existingDirs []string
		want         string
	}{
		{
			name:        "hyphenated final directory is preserved when it exists",
			projectPath: "-Users-syoh-Development-thatseeup-claude-code-proxy",
			existingDirs: []string{
				"/Users",
				"/Users/syoh",
				"/Users/syoh/Development",
				"/Users/syoh/Development/thatseeup",
				"/Users/syoh/Development/thatseeup/claude-code-proxy",
			},
			want: "claude-code-proxy",
		},
		{
			name:        "fully resolved simple path returns last segment",
			projectPath: "-Users-syoh-project",
			existingDirs: []string{
				"/Users",
				"/Users/syoh",
				"/Users/syoh/project",
			},
			want: "project",
		},
		{
			name:        "unresolved tail returns remainder joined by hyphen",
			projectPath: "-Users-syoh-Development-missing-folder",
			existingDirs: []string{
				"/Users",
				"/Users/syoh",
				"/Users/syoh/Development",
			},
			want: "missing-folder",
		},
		{
			name:         "no prefix resolves — returns full encoded remainder",
			projectPath:  "-nope-foo-bar",
			existingDirs: nil,
			want:         "nope-foo-bar",
		},
		{
			name:         "empty string falls back to original",
			projectPath:  "",
			existingDirs: nil,
			want:         "",
		},
		{
			name:        "hyphen-containing intermediate dir resolves to final segment",
			projectPath: "-opt-my-app-src",
			existingDirs: []string{
				"/opt",
				"/opt/my-app",
				"/opt/my-app/src",
			},
			want: "src",
		},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := projectDisplayNameWith(tc.projectPath, newExistsFn(tc.existingDirs...))
			if got != tc.want {
				t.Errorf("projectDisplayNameWith(%q) = %q, want %q", tc.projectPath, got, tc.want)
			}
		})
	}
}

// writeTempJSONL writes lines to a temporary .jsonl file and returns its path.
func writeTempJSONL(t *testing.T, dir, name string, lines []string) string {
	t.Helper()
	path := filepath.Join(dir, name)
	content := ""
	for _, l := range lines {
		content += l + "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("writeTempJSONL: %v", err)
	}
	return path
}

func TestExtractSessionTitle(t *testing.T) {
	dir := t.TempDir()

	t.Run("ai-title only returns aiTitle", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "ai-only.jsonl", []string{
			`{"type":"summary","message":{"role":"user","content":"hello"}}`,
			`{"type":"ai-title","aiTitle":"My AI Title","customTitle":""}`,
		})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "My AI Title" {
			t.Errorf("got %q, want %q", got, "My AI Title")
		}
	})

	t.Run("custom-title takes priority over ai-title on same line", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "custom-priority.jsonl", []string{
			`{"type":"custom-title","aiTitle":"AI Title","customTitle":"Custom Title"}`,
		})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "Custom Title" {
			t.Errorf("got %q, want %q", got, "Custom Title")
		}
	})

	t.Run("ai-title fallback when customTitle is empty", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "ai-fallback.jsonl", []string{
			`{"type":"ai-title","aiTitle":"Fallback Title","customTitle":""}`,
		})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "Fallback Title" {
			t.Errorf("got %q, want %q", got, "Fallback Title")
		}
	})

	t.Run("no title lines returns empty string", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "no-title.jsonl", []string{
			`{"type":"summary","message":{"role":"user","content":"hello"}}`,
			`{"type":"summary","message":{"role":"assistant","content":"world"}}`,
		})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "" {
			t.Errorf("got %q, want empty string", got)
		}
	})

	t.Run("multiple title lines — last one wins", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "multi-title.jsonl", []string{
			`{"type":"ai-title","aiTitle":"First Title","customTitle":""}`,
			`{"type":"summary","message":{"role":"user","content":"hello"}}`,
			`{"type":"ai-title","aiTitle":"Second Title","customTitle":""}`,
			`{"type":"custom-title","aiTitle":"","customTitle":"Third Title"}`,
		})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "Third Title" {
			t.Errorf("got %q, want %q", got, "Third Title")
		}
	})

	t.Run("file does not exist returns error", func(t *testing.T) {
		_, err := extractSessionTitle(filepath.Join(dir, "nonexistent.jsonl"))
		if err == nil {
			t.Error("expected error for missing file, got nil")
		}
	})

	t.Run("malformed lines are skipped gracefully", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "malformed.jsonl", []string{
			`not valid json at all`,
			`{"type":"ai-title","aiTitle":"Good Title","customTitle":""}`,
			`{broken`,
		})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "Good Title" {
			t.Errorf("got %q, want %q", got, "Good Title")
		}
	})

	t.Run("empty file returns empty string", func(t *testing.T) {
		path := writeTempJSONL(t, dir, "empty.jsonl", []string{})
		got, err := extractSessionTitle(path)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != "" {
			t.Errorf("got %q, want empty string", got)
		}
	})
}
