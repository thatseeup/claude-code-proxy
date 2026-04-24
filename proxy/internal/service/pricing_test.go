package service

import (
	"encoding/json"
	"math"
	"testing"

	"github.com/seifghazi/claude-code-monitor/internal/model"
)

const pricingEpsilon = 1e-9

func approxEqual(a, b float64) bool {
	return math.Abs(a-b) < pricingEpsilon
}

func TestCalculateCostUSD_Opus47_AllCategories(t *testing.T) {
	usage := &model.AnthropicUsage{
		InputTokens:          1_000_000,
		OutputTokens:         500_000,
		CacheReadInputTokens: 2_000_000,
		CacheCreation: &model.AnthropicCacheCreation{
			Ephemeral5mInputTokens: 400_000,
			Ephemeral1hInputTokens: 100_000,
		},
	}
	// 1M*$5 + 0.5M*$25 + 2M*$0.50 + 0.4M*$6.25 + 0.1M*$10
	// = 5 + 12.5 + 1 + 2.5 + 1 = 22.0
	want := 22.0
	got, ok := CalculateCostUSD("claude-opus-4-7", usage)
	if !ok {
		t.Fatalf("expected ok=true for claude-opus-4-7")
	}
	if !approxEqual(got, want) {
		t.Fatalf("opus-4-7 cost: got %v want %v", got, want)
	}
}

func TestCalculateCostUSD_Opus46_OnlyInputOutput(t *testing.T) {
	usage := &model.AnthropicUsage{
		InputTokens:  2_000_000,
		OutputTokens: 1_000_000,
	}
	// 2M*$5 + 1M*$25 = 35
	want := 35.0
	got, ok := CalculateCostUSD("claude-opus-4-6", usage)
	if !ok || !approxEqual(got, want) {
		t.Fatalf("opus-4-6: got=%v ok=%v want=%v", got, ok, want)
	}
}

func TestCalculateCostUSD_Sonnet46_AllCategories(t *testing.T) {
	usage := &model.AnthropicUsage{
		InputTokens:          1_000_000,
		OutputTokens:         1_000_000,
		CacheReadInputTokens: 1_000_000,
		CacheCreation: &model.AnthropicCacheCreation{
			Ephemeral5mInputTokens: 1_000_000,
			Ephemeral1hInputTokens: 1_000_000,
		},
	}
	// 1*3 + 1*15 + 1*0.3 + 1*3.75 + 1*6 = 28.05
	want := 28.05
	got, ok := CalculateCostUSD("claude-sonnet-4-6", usage)
	if !ok || !approxEqual(got, want) {
		t.Fatalf("sonnet-4-6: got=%v ok=%v want=%v", got, ok, want)
	}
}

func TestCalculateCostUSD_Haiku45_AllCategories(t *testing.T) {
	usage := &model.AnthropicUsage{
		InputTokens:          3_000_000,
		OutputTokens:         1_000_000,
		CacheReadInputTokens: 5_000_000,
		CacheCreation: &model.AnthropicCacheCreation{
			Ephemeral5mInputTokens: 2_000_000,
			Ephemeral1hInputTokens: 1_000_000,
		},
	}
	// 3*1 + 1*5 + 5*0.10 + 2*1.25 + 1*2 = 3+5+0.5+2.5+2 = 13
	want := 13.0
	got, ok := CalculateCostUSD("claude-haiku-4-5", usage)
	if !ok || !approxEqual(got, want) {
		t.Fatalf("haiku-4-5: got=%v ok=%v want=%v", got, ok, want)
	}
}

func TestCalculateCostUSD_FlatCacheCreationNoBreakdown_UsesOneHourRate(t *testing.T) {
	// No CacheCreation struct — cache_creation_input_tokens is present standalone.
	// Whole amount must be priced at the 1h-write rate.
	usage := &model.AnthropicUsage{
		InputTokens:              0,
		OutputTokens:             0,
		CacheCreationInputTokens: 1_000_000,
	}
	// opus-4-7 1h write = $10/MTok
	want := 10.0
	got, ok := CalculateCostUSD("claude-opus-4-7", usage)
	if !ok || !approxEqual(got, want) {
		t.Fatalf("flat cache_creation: got=%v ok=%v want=%v", got, ok, want)
	}
}

func TestCalculateCostUSD_CacheCreationBreakdownWinsOverFlatTotal(t *testing.T) {
	// When CacheCreation breakdown is present, the flat CacheCreationInputTokens
	// field must be ignored to avoid double-counting.
	usage := &model.AnthropicUsage{
		CacheCreationInputTokens: 99_999_999, // should be ignored
		CacheCreation: &model.AnthropicCacheCreation{
			Ephemeral5mInputTokens: 1_000_000,
			Ephemeral1hInputTokens: 0,
		},
	}
	// opus-4-7: 1M * $6.25 = 6.25
	want := 6.25
	got, ok := CalculateCostUSD("claude-opus-4-7", usage)
	if !ok || !approxEqual(got, want) {
		t.Fatalf("breakdown precedence: got=%v ok=%v want=%v", got, ok, want)
	}
}

func TestCalculateCostUSD_UnsupportedModels(t *testing.T) {
	cases := []string{
		"claude-opus-4-5",     // not in our table
		"claude-opus-4-1",     // not in our table
		"claude-sonnet-4-5",   // not in our table
		"gpt-4",               // different provider
		"",                    // empty
		"claude-opus-4-7-beta", // prefix match must NOT work
	}
	usage := &model.AnthropicUsage{InputTokens: 1000, OutputTokens: 100}
	for _, id := range cases {
		got, ok := CalculateCostUSD(id, usage)
		if ok {
			t.Fatalf("unsupported model %q: expected ok=false, got cost=%v", id, got)
		}
		if got != 0 {
			t.Fatalf("unsupported model %q: expected cost=0, got %v", id, got)
		}
	}
}

func TestCalculateCostUSD_NilUsage(t *testing.T) {
	got, ok := CalculateCostUSD("claude-opus-4-7", nil)
	if ok || got != 0 {
		t.Fatalf("nil usage: expected ok=false cost=0, got ok=%v cost=%v", ok, got)
	}
}

func TestCalculateCostUSD_ServiceTierIgnored(t *testing.T) {
	base := &model.AnthropicUsage{InputTokens: 1_000_000, OutputTokens: 1_000_000}
	tiered := &model.AnthropicUsage{
		InputTokens:  1_000_000,
		OutputTokens: 1_000_000,
		ServiceTier:  "priority",
	}
	a, okA := CalculateCostUSD("claude-opus-4-7", base)
	b, okB := CalculateCostUSD("claude-opus-4-7", tiered)
	if !okA || !okB {
		t.Fatalf("expected ok=true for both")
	}
	if !approxEqual(a, b) {
		t.Fatalf("ServiceTier should not affect cost: base=%v tiered=%v", a, b)
	}
}

// buildResponseJSON wraps the given body JSON in the ResponseLog envelope
// shape that storage_sqlite.go's cost loader parses. Using json.RawMessage
// ensures the body is embedded as raw JSON (not base64-encoded bytes).
func buildResponseJSON(t *testing.T, bodyJSON string) []byte {
	t.Helper()
	env := map[string]interface{}{
		"body": json.RawMessage(bodyJSON),
	}
	out, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return out
}

func TestSumSessionCosts_BodyModelWinsOverFallback(t *testing.T) {
	// response body.model is opus-4-7 but the row's RequestModel column is
	// the routed model. sumSessionCosts must prefer body.model.
	body := `{"model":"claude-opus-4-7","usage":{"input_tokens":1000000,"output_tokens":0}}`
	rows := []sessionCostRow{{
		SessionID:    "s1",
		RequestModel: "claude-haiku-4-5", // would give a different cost
		Response:     buildResponseJSON(t, body),
	}}
	got := sumSessionCosts(rows)
	want := 5.0 // 1M * $5/MTok (opus input)
	if c, ok := got["s1"]; !ok || !approxEqual(c, want) {
		t.Fatalf("s1: got=%v ok=%v want=%v", c, ok, want)
	}
}

func TestSumSessionCosts_FallsBackToRowModelWhenBodyMissingModel(t *testing.T) {
	body := `{"usage":{"input_tokens":1000000,"output_tokens":0}}`
	rows := []sessionCostRow{{
		SessionID:    "s1",
		RequestModel: "claude-haiku-4-5",
		Response:     buildResponseJSON(t, body),
	}}
	got := sumSessionCosts(rows)
	want := 1.0 // 1M * $1/MTok (haiku input)
	if c, ok := got["s1"]; !ok || !approxEqual(c, want) {
		t.Fatalf("s1 fallback: got=%v ok=%v want=%v", c, ok, want)
	}
}

func TestSumSessionCosts_SkipsUnsupportedModelsAndMissingUsage(t *testing.T) {
	rows := []sessionCostRow{
		// priceable
		{
			SessionID:    "s1",
			RequestModel: "claude-opus-4-7",
			Response: buildResponseJSON(t,
				`{"model":"claude-opus-4-7","usage":{"input_tokens":1000000,"output_tokens":0}}`),
		},
		// unsupported model — should be skipped
		{
			SessionID:    "s1",
			RequestModel: "",
			Response: buildResponseJSON(t,
				`{"model":"claude-opus-4-5","usage":{"input_tokens":1000000}}`),
		},
		// missing usage — skipped
		{
			SessionID:    "s1",
			RequestModel: "claude-opus-4-7",
			Response:     buildResponseJSON(t, `{"model":"claude-opus-4-7"}`),
		},
		// session with ONLY an unpriceable row — must not appear in the map
		{
			SessionID:    "s2",
			RequestModel: "gpt-4",
			Response: buildResponseJSON(t,
				`{"model":"gpt-4","usage":{"input_tokens":1000000}}`),
		},
	}
	got := sumSessionCosts(rows)
	if c, ok := got["s1"]; !ok || !approxEqual(c, 5.0) {
		t.Fatalf("s1 partial match: got=%v ok=%v want=5.0", c, ok)
	}
	if _, ok := got["s2"]; ok {
		t.Fatalf("s2 should be absent from the map; got cost=%v", got["s2"])
	}
}

func TestSumSessionCosts_AggregatesMultipleRequestsPerSession(t *testing.T) {
	rows := []sessionCostRow{
		{
			SessionID:    "s1",
			RequestModel: "claude-opus-4-7",
			Response: buildResponseJSON(t,
				`{"model":"claude-opus-4-7","usage":{"input_tokens":1000000,"output_tokens":0}}`),
		},
		{
			SessionID:    "s1",
			RequestModel: "claude-haiku-4-5",
			Response: buildResponseJSON(t,
				`{"model":"claude-haiku-4-5","usage":{"input_tokens":2000000,"output_tokens":1000000}}`),
		},
	}
	got := sumSessionCosts(rows)
	// 1M*$5 (opus in) + 2M*$1 (haiku in) + 1M*$5 (haiku out) = 5 + 2 + 5 = 12
	want := 12.0
	if c, ok := got["s1"]; !ok || !approxEqual(c, want) {
		t.Fatalf("s1 sum: got=%v ok=%v want=%v", c, ok, want)
	}
}

func TestSumSessionCosts_EmptyAndMalformedInputs(t *testing.T) {
	rows := []sessionCostRow{
		{SessionID: "s1", Response: nil},                    // empty
		{SessionID: "s1", Response: []byte("not json")},     // malformed envelope
		{SessionID: "s1", Response: []byte(`{"body":"str"}`)}, // body is a string, not object
		{SessionID: "s1", Response: []byte(`{}`)},           // no body field
	}
	got := sumSessionCosts(rows)
	if _, ok := got["s1"]; ok {
		t.Fatalf("s1 should not appear — all rows unpriceable, got %v", got)
	}
}

func TestCalculateCostUSD_SmallTokenCounts(t *testing.T) {
	// Make sure we don't return NaN / negative for tiny or zero token counts.
	usage := &model.AnthropicUsage{
		InputTokens:  1,
		OutputTokens: 0,
	}
	got, ok := CalculateCostUSD("claude-haiku-4-5", usage)
	if !ok {
		t.Fatalf("expected ok=true")
	}
	// 1 token * $1/MTok = 1e-6
	want := 1.0 / 1_000_000.0
	if !approxEqual(got, want) {
		t.Fatalf("1-token haiku: got=%v want=%v", got, want)
	}
}
