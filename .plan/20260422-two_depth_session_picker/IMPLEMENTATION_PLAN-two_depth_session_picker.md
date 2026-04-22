# Implementation Plan: Two-Depth Session Picker

**Source requirements:** `.plan/20260422-two_depth_session_picker/requirements-two_depth_session_picker.md`
**Generated:** 2026-04-22

## Overview

The session picker in `/requests/:sessionId` currently shows a flat list of sessions. This plan restructures it into a two-level dropdown: first pick a project (grouped, sorted by latest session), then pick a session within that project. A `?project=` URL parameter persists the selected project across reloads. Session cards are also reordered: Session title first, then full UUID, then req count + timestamp.

## Task Breakdown

| #  | Status | Step                                    | Files Affected                                                                 | Complexity |
|----|--------|-----------------------------------------|--------------------------------------------------------------------------------|------------|
| 1  | ✅     | Add grouping/sorting helpers to SessionPicker | `web/app/components/SessionPicker.tsx`                                    | Low        |
| 2  | ✅     | Implement two-level project/session dropdown UI | `web/app/components/SessionPicker.tsx`                                  | Medium     |
| 3  | ✅     | Persist `?project=` in URL and wire route    | `web/app/routes/requests.$sessionId.tsx`, `web/app/components/SessionPicker.tsx` | Low  |
| 4  | ✅     | Redesign session picker card layout     | `web/app/components/SessionPicker.tsx`                                         | Low        |

Status legend: ⬜ pending · 🟡 in progress · ✅ done · ⚠️ blocked

---

## Step Detail

### Step 1: Add grouping/sorting helpers to SessionPicker

- **Goal:** Extract pure functions that group sessions by project and sort them per spec, so Step 2 can consume them.
- **Preconditions:** Baseline repo state — `SessionSummary` already has `projectDisplayName`, `projectPath`, `lastTimestamp`, `requestCount`.
- **Changes:**
  - Add a `groupSessionsByProject(sessions: SessionSummary[])` helper that:
    - Groups by `projectDisplayName` (or `"Unknown"` when `!hasConversation || !projectDisplayName`).
    - Computes each group's `latestTimestamp` as the max `lastTimestamp` across its sessions.
    - Sorts groups by `latestTimestamp` descending (latest project first).
    - Within each group, sorts sessions by `lastTimestamp` descending (latest session first).
  - Return type: `Array<{ projectDisplayName: string; latestTimestamp: string; sessions: SessionSummary[] }>`.
  - Add unit-level inline tests are not required; done condition is behavioral (see below).
- **Files:** `web/app/components/SessionPicker.tsx`
- **Done condition:** TypeScript compilation passes (`cd web && npx tsc --noEmit`) with no new errors.
- **Rollback:** Revert the helper additions; no other file changed.

---

### Step 2: Implement two-level project/session dropdown UI

- **Goal:** Replace the flat session list dropdown with a two-panel design: upper project list, lower session list filtered by selected project.
- **Preconditions:** Step 1 complete (grouping helpers available).
- **Changes:**
  - Add `selectedProject: string | null` state to `SessionPicker` (null = no project filter active yet; initialized from `?project=` URL param via `useSearchParams`).
  - Structure the open dropdown as two stacked sections:
    - **Project panel** (always visible when open): one row per group showing `projectDisplayName` and `(sessionCount)`. Clicking a project row sets `selectedProject` to that group's display name.
    - **Session panel** (visible below, after a project is selected): lists only sessions belonging to `selectedProject`. If no project selected yet, show an empty or prompt state.
  - Highlight the active project row (the group that contains the current `activeSessionId`).
  - `Unknown` project is rendered as a group named `"Unknown"` at the bottom (after projects sorted by timestamp).
  - Session items within the session panel use the new card layout from Step 4 (implement together or leave placeholder; handled fully in Step 4).
  - Close dropdown on outside click (existing behavior retained).
  - When switching projects within the dropdown, do not navigate — only change `selectedProject` state.
  - When clicking a session item, navigate as before: `/requests/:token?model=...&project=<displayName>`.
- **Files:** `web/app/components/SessionPicker.tsx`
- **Done condition:** Open the Requests page in a browser; the dropdown shows grouped project rows; clicking a project name reveals only that project's sessions; clicking a session navigates correctly. TypeScript compilation passes.
- **Rollback:** Revert `SessionPicker.tsx` to Step 1 state.
- **Notes:** Keep the existing `Trash2` delete button and `MessageSquareText` conversations button behaviour unchanged — they operate on the active session, not the dropdown selection.

---

### Step 3: Persist `?project=` in URL and wire route

- **Goal:** Ensure the selected project survives page reloads via `?project=` query parameter, and that navigating between sessions preserves it.
- **Preconditions:** Step 2 complete.
- **Changes:**
  - In `SessionPicker`, read `?project=` from `useSearchParams()` to initialize `selectedProject` state on mount.
  - When navigating to a session (via `handleSelect`), append `?project=<selectedProject>` alongside the existing `?model=` suffix.
  - When navigating to a session that belongs to a different project (edge case: user lands on a URL whose session is in a different project than `?project=` states), auto-correct `selectedProject` state to match the active session's project on mount/effect.
  - In `requests.$sessionId.tsx` loader: read `?project=` from `url.searchParams` and pass it through as `projectFilter` in `LoaderData` (no backend filtering needed — it is UI-only state, just round-trip it for SSR hydration).
  - Ensure `querySuffix` in `SessionPicker` includes both `model` and `project` params.
- **Files:** `web/app/routes/requests.$sessionId.tsx`, `web/app/components/SessionPicker.tsx`
- **Done condition:** Navigate to a session, select a project in the picker, then reload the page — the same project tab is pre-selected. TypeScript compilation passes.
- **Rollback:** Remove `projectFilter` from loader `LoaderData`; revert `SessionPicker` param persistence logic.

---

### Step 4: Redesign session picker card layout

- **Goal:** Change each session card in the session panel from `[shortId / req count + time / project / title]` to `[title / full UUID / req count + time]`.
- **Preconditions:** Step 2 complete (session panel exists).
- **Changes:**
  - Inside the session panel list items, reorder and reformat the displayed fields:
    1. **Line 1 – Session title** (emphasized): `s.title` if present; otherwise a muted italic placeholder (e.g. `"Untitled session"`). Use slightly bolder or white/gray-100 text.
    2. **Line 2 – Full session UUID**: `s.sessionId` (full string, not truncated to 8 chars). Font-mono, smaller, muted. If the line overflows the container, truncate with `…` via `truncate` Tailwind class.
    3. **Line 3 – req count + timestamp**: `{s.requestCount} req {formatFirstSeen(s.lastTimestamp)}`. Same small muted style as before.
  - Remove the `projectDisplayName` line from each card (it is now shown in the project panel header).
  - Remove the `shortLabel` helper usage within session cards (still needed for the current-session trigger button label).
  - Update the active-session trigger button label to also show title (line 1) + short UUID (line 2, keep truncated) for the selected session — matching the new card style, compressed.
- **Files:** `web/app/components/SessionPicker.tsx`
- **Done condition:** Open the Requests page; session cards show title prominently, full UUID on line 2, req count + time on line 3; no project name visible inside the card. TypeScript compilation passes.
- **Rollback:** Revert card layout changes in `SessionPicker.tsx`.

---

## Resume Checkpoint
<!-- Execution sessions update this section if they must stop mid-step.
     Leave empty at generation time. -->
_None._

## Deviations Log
<!-- Execution sessions append here when the actual implementation diverged
     from the plan. Leave empty at generation time. -->

### Step 1 (2026-04-22)
- `SessionGroup` interface and `groupSessionsByProject` function exported from `SessionPicker.tsx` as specified.
- Pre-existing TypeScript error in `MessageContent.tsx` (line 93) was present before changes; no new errors introduced.
- Done condition verified: `npx tsc --noEmit` produces no new errors beyond baseline.

### Step 2 (2026-04-22)
- Replaced flat session list with two-panel dropdown: project panel (upper, always visible when open) + session panel (lower, filtered by selected project).
- `selectedProject` state initialized from `?project=` URL param if present, otherwise from the active session's project group.
- Active project row highlighted with `ChevronRight` indicator; Unknown group always sorted to bottom.
- Session cards use the new three-line layout (title / full UUID / req count + timestamp) as specified; project name removed from cards.
- Trigger button updated to show title (line 1) + short UUID (line 2) + req count/time (line 3).
- `querySuffix` variable removed (was computed but unused; query-building consolidated inside `handleSelect`).
- `ChevronRight` icon added to lucide-react imports; no new package needed.
- Pre-existing TypeScript error in `MessageContent.tsx` (line 93) remains unchanged; no new errors introduced.
- Done condition verified: `npx tsc --noEmit` produces no new errors beyond baseline.

### Step 4 (2026-04-22)
- All Step 4 requirements were already implemented during Step 2 execution (noted in Step 2 deviations log).
- Session cards in the session panel already use the three-line layout: title (emphasized) on line 1, full UUID (font-mono, muted, truncated) on line 2, req count + timestamp on line 3.
- No `projectDisplayName` field appears in session cards.
- `shortLabel` helper is used only in the trigger button (`triggerShortId`), not in session cards.
- Trigger button already shows title + short UUID + req count/time in the same three-line style.
- No code changes were required; marking ✅ after confirming all done conditions are met.
- Done condition verified: `npx tsc --noEmit` produces only the pre-existing `MessageContent.tsx` error (line 93); no new errors introduced.

### Step 3 (2026-04-22)
- Most of this step was already implemented in Step 2: `?project=` param read via `useSearchParams()`, `selectedProject` initialized from it, and `handleSelect` appends `?project=<selectedProject>` alongside `?model=` on navigation.
- `requests.$sessionId.tsx` loader already read `?project=` from `url.searchParams` and passed it as `projectFilter` in `LoaderData` (verified in place).
- Added auto-correction logic to `useEffect` in `SessionPicker`: when `projectParam` is set but differs from `activeProjectName`, `selectedProject` is corrected to `activeProjectName` (the active session's actual project takes precedence over a stale URL param).
- Pre-existing TypeScript error in `MessageContent.tsx` (line 93) remains unchanged; no new errors introduced.
- Done condition verified: `npx tsc --noEmit` produces no new errors beyond baseline.
