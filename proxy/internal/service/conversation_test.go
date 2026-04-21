package service

import (
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
