// Anthropic model pricing for the UI.
//
// Keep this table in sync with proxy/internal/service/pricing.go.
// Matching is by exact model id — no prefix matching — after stripping a
// trailing "-YYYYMMDD" dated alias (see normalizeModelId).
// All values are USD per 1,000,000 tokens.
//
// Source: https://platform.claude.com/docs/en/about-claude/pricing

export type ModelPricing = {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
};

export const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-opus-4-7": {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
  },
  "claude-opus-4-6": {
    input: 5.0,
    output: 25.0,
    cacheWrite5m: 6.25,
    cacheWrite1h: 10.0,
    cacheRead: 0.5,
  },
  "claude-sonnet-4-6": {
    input: 3.0,
    output: 15.0,
    cacheWrite5m: 3.75,
    cacheWrite1h: 6.0,
    cacheRead: 0.3,
  },
  "claude-haiku-4-5": {
    input: 1.0,
    output: 5.0,
    cacheWrite5m: 1.25,
    cacheWrite1h: 2.0,
    cacheRead: 0.1,
  },
};

export type UsageInput = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number;
    ephemeral_1h_input_tokens?: number;
  } | null;
};

// Match a trailing "-YYYYMMDD" snapshot alias (e.g. "-20251001"). Only an
// exact 8-digit date is accepted — arbitrary suffixes like "-beta" must NOT
// match, since pricing lookup is exact-match on the base ID.
const DATED_ALIAS_SUFFIX = /-\d{8}$/;

/**
 * Strip a trailing "-YYYYMMDD" dated alias only when doing so yields a base
 * ID that exists in PRICING_TABLE. Otherwise the input is returned unchanged
 * so unsupported/unknown IDs still fail lookup.
 */
function normalizeModelId(modelId: string): string {
  if (PRICING_TABLE[modelId]) return modelId;
  const stripped = modelId.replace(DATED_ALIAS_SUFFIX, "");
  if (stripped !== modelId && PRICING_TABLE[stripped]) return stripped;
  return modelId;
}

function tokensToUSD(tokens: number | undefined, pricePerMillion: number): number {
  if (!tokens || tokens <= 0) return 0;
  return (tokens * pricePerMillion) / 1_000_000;
}

/**
 * Calculate USD cost for a (model, usage) pair.
 *
 * Returns null when:
 *   - model is null/undefined/empty, or — after stripping a trailing
 *     "-YYYYMMDD" dated alias — is not present in PRICING_TABLE. Matching
 *     is exact (no prefix matching) on the normalized id.
 *   - usage is null/undefined
 *
 * Cache write distribution:
 *   - If `cache_creation` breakdown is present, the 5m and 1h fields are priced
 *     at their respective rates. The flat `cache_creation_input_tokens` is ignored
 *     in that case (breakdown is authoritative).
 *   - Otherwise, if `cache_creation_input_tokens > 0`, the whole amount is priced
 *     at the 1h-write rate.
 *
 * `service_tier` is ignored.
 */
export function calculateCostUSD(
  model: string | null | undefined,
  usage: UsageInput | null | undefined,
): number | null {
  if (!model) return null;
  if (!usage) return null;
  const price = PRICING_TABLE[normalizeModelId(model)];
  if (!price) return null;

  let cost = 0;
  cost += tokensToUSD(usage.input_tokens, price.input);
  cost += tokensToUSD(usage.output_tokens, price.output);
  cost += tokensToUSD(usage.cache_read_input_tokens, price.cacheRead);

  if (usage.cache_creation) {
    cost += tokensToUSD(
      usage.cache_creation.ephemeral_5m_input_tokens,
      price.cacheWrite5m,
    );
    cost += tokensToUSD(
      usage.cache_creation.ephemeral_1h_input_tokens,
      price.cacheWrite1h,
    );
  } else if (
    usage.cache_creation_input_tokens &&
    usage.cache_creation_input_tokens > 0
  ) {
    cost += tokensToUSD(usage.cache_creation_input_tokens, price.cacheWrite1h);
  }

  return cost;
}

/**
 * Format a cost value as a USD string.
 *
 * - null → "" (empty string: caller decides whether to render anything)
 * - 0.0005 rounds up to $0.001 (standard banker-ish rounding via toFixed)
 * - < 0.0005 → $0.000
 * - thousands separator is a literal comma, locale-independent
 *   (does NOT use Number.prototype.toLocaleString — output must be stable
 *   across environments and timezones).
 */
export function formatCostUSD(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return "";
  if (!Number.isFinite(cost)) return "";

  const rounded = cost.toFixed(3); // e.g. "1234.500", "0.000", "-1.234"
  const negative = rounded.startsWith("-");
  const abs = negative ? rounded.slice(1) : rounded;
  const dotIdx = abs.indexOf(".");
  const intPart = dotIdx === -1 ? abs : abs.slice(0, dotIdx);
  const fracPart = dotIdx === -1 ? "" : abs.slice(dotIdx); // includes the "."
  // Insert commas every 3 digits from the right.
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${withCommas}${fracPart}`;
}
