package service

import (
	"github.com/seifghazi/claude-code-monitor/internal/model"
)

// modelPricing holds per-million-token USD prices for a single model.
// All values are USD per 1,000,000 tokens.
type modelPricing struct {
	Input           float64 // base input tokens
	Output          float64 // output tokens
	CacheWrite5m    float64 // 5-minute cache write
	CacheWrite1h    float64 // 1-hour cache write
	CacheRead       float64 // cache read / hit
}

// pricingTable is the single source of truth for Anthropic model pricing
// used by the proxy. Matching is strictly by exact model id — no prefix
// matching. Keep this in sync with web/app/utils/pricing.ts.
//
// Source: https://platform.claude.com/docs/en/about-claude/pricing
var pricingTable = map[string]modelPricing{
	"claude-opus-4-7": {
		Input:        5.0,
		Output:       25.0,
		CacheWrite5m: 6.25,
		CacheWrite1h: 10.0,
		CacheRead:    0.50,
	},
	"claude-opus-4-6": {
		Input:        5.0,
		Output:       25.0,
		CacheWrite5m: 6.25,
		CacheWrite1h: 10.0,
		CacheRead:    0.50,
	},
	"claude-sonnet-4-6": {
		Input:        3.0,
		Output:       15.0,
		CacheWrite5m: 3.75,
		CacheWrite1h: 6.0,
		CacheRead:    0.30,
	},
	"claude-haiku-4-5": {
		Input:        1.0,
		Output:       5.0,
		CacheWrite5m: 1.25,
		CacheWrite1h: 2.0,
		CacheRead:    0.10,
	},
}

// tokensToUSD converts a token count to a USD amount given a per-million-token price.
func tokensToUSD(tokens int, pricePerMillion float64) float64 {
	if tokens <= 0 {
		return 0
	}
	return float64(tokens) * pricePerMillion / 1_000_000.0
}

// CalculateCostUSD returns the USD cost of a single (model, usage) pair.
//
// Matching rules:
//   - modelID must appear in pricingTable via exact match (no prefix matching);
//     otherwise ok=false.
//   - If usage is nil, ok=false.
//
// Cache write distribution:
//   - When u.CacheCreation is non-nil, ephemeral_5m_input_tokens is priced at
//     the 5m-write rate and ephemeral_1h_input_tokens at the 1h-write rate.
//     u.CacheCreationInputTokens is IGNORED in that case (the breakdown is
//     authoritative and already sums to the flat total).
//   - When u.CacheCreation is nil but u.CacheCreationInputTokens > 0, the whole
//     amount is priced at the 1h-write rate.
//
// ServiceTier is ignored.
func CalculateCostUSD(modelID string, u *model.AnthropicUsage) (float64, bool) {
	if u == nil {
		return 0, false
	}
	price, known := pricingTable[modelID]
	if !known {
		return 0, false
	}

	cost := 0.0
	cost += tokensToUSD(u.InputTokens, price.Input)
	cost += tokensToUSD(u.OutputTokens, price.Output)
	cost += tokensToUSD(u.CacheReadInputTokens, price.CacheRead)

	if u.CacheCreation != nil {
		cost += tokensToUSD(u.CacheCreation.Ephemeral5mInputTokens, price.CacheWrite5m)
		cost += tokensToUSD(u.CacheCreation.Ephemeral1hInputTokens, price.CacheWrite1h)
	} else if u.CacheCreationInputTokens > 0 {
		cost += tokensToUSD(u.CacheCreationInputTokens, price.CacheWrite1h)
	}

	return cost, true
}
