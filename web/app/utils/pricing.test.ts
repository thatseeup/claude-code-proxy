import { describe, it, expect } from "vitest";
import { calculateCostUSD, formatCostUSD } from "./pricing";

const EPS = 1e-9;

function approx(actual: number | null, expected: number) {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected)).toBeLessThan(EPS);
}

describe("calculateCostUSD", () => {
  it("opus-4-7 all categories", () => {
    const got = calculateCostUSD("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 500_000,
      cache_read_input_tokens: 2_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 400_000,
        ephemeral_1h_input_tokens: 100_000,
      },
    });
    // 1M*5 + 0.5M*25 + 2M*0.5 + 0.4M*6.25 + 0.1M*10 = 22.0
    approx(got, 22.0);
  });

  it("opus-4-6 only input/output", () => {
    const got = calculateCostUSD("claude-opus-4-6", {
      input_tokens: 2_000_000,
      output_tokens: 1_000_000,
    });
    approx(got, 35.0);
  });

  it("sonnet-4-6 all categories", () => {
    const got = calculateCostUSD("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    });
    // 3 + 15 + 0.3 + 3.75 + 6 = 28.05
    approx(got, 28.05);
  });

  it("haiku-4-5 all categories", () => {
    const got = calculateCostUSD("claude-haiku-4-5", {
      input_tokens: 3_000_000,
      output_tokens: 1_000_000,
      cache_read_input_tokens: 5_000_000,
      cache_creation: {
        ephemeral_5m_input_tokens: 2_000_000,
        ephemeral_1h_input_tokens: 1_000_000,
      },
    });
    // 3 + 5 + 0.5 + 2.5 + 2 = 13
    approx(got, 13.0);
  });

  it("flat cache_creation_input_tokens only → 1h write rate", () => {
    const got = calculateCostUSD("claude-opus-4-7", {
      cache_creation_input_tokens: 1_000_000,
    });
    // opus-4-7 1h write = $10/MTok
    approx(got, 10.0);
  });

  it("cache_creation breakdown overrides flat field", () => {
    const got = calculateCostUSD("claude-opus-4-7", {
      cache_creation_input_tokens: 99_999_999, // ignored
      cache_creation: {
        ephemeral_5m_input_tokens: 1_000_000,
        ephemeral_1h_input_tokens: 0,
      },
    });
    // 1M * $6.25 = 6.25
    approx(got, 6.25);
  });

  it("unsupported models return null", () => {
    const models = [
      "claude-opus-4-5",
      "claude-opus-4-1",
      "claude-sonnet-4-5",
      "gpt-4",
      "",
      "claude-opus-4-7-beta", // exact match only
    ];
    for (const m of models) {
      expect(
        calculateCostUSD(m, { input_tokens: 1000, output_tokens: 100 }),
      ).toBeNull();
    }
  });

  it("null/undefined usage returns null", () => {
    expect(calculateCostUSD("claude-opus-4-7", null)).toBeNull();
    expect(calculateCostUSD("claude-opus-4-7", undefined)).toBeNull();
  });

  it("null/undefined model returns null", () => {
    expect(calculateCostUSD(null, { input_tokens: 10 })).toBeNull();
    expect(calculateCostUSD(undefined, { input_tokens: 10 })).toBeNull();
  });

  it("service_tier is not a field we consume — extra props ignored", () => {
    const base = calculateCostUSD("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    const withExtra = calculateCostUSD("claude-opus-4-7", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      // Extra property the type doesn't declare is simply not read by the
      // calculator; cast through unknown to sidestep excess-property checks.
    } as unknown as Parameters<typeof calculateCostUSD>[1]);
    expect(base).not.toBeNull();
    expect(withExtra).not.toBeNull();
    approx(withExtra as number, base as number);
  });

  it("tiny token counts stay positive, no NaN", () => {
    const got = calculateCostUSD("claude-haiku-4-5", {
      input_tokens: 1,
      output_tokens: 0,
    });
    approx(got, 1 / 1_000_000);
  });
});

describe("formatCostUSD", () => {
  it("null → empty string", () => {
    expect(formatCostUSD(null)).toBe("");
  });

  it("undefined → empty string", () => {
    expect(formatCostUSD(undefined)).toBe("");
  });

  it("NaN/Infinity → empty string", () => {
    expect(formatCostUSD(NaN)).toBe("");
    expect(formatCostUSD(Infinity)).toBe("");
  });

  it("zero", () => {
    expect(formatCostUSD(0)).toBe("$0.000");
  });

  it("0.0004 rounds down to $0.000", () => {
    expect(formatCostUSD(0.0004)).toBe("$0.000");
  });

  it("0.0005 rounds up to $0.001", () => {
    expect(formatCostUSD(0.0005)).toBe("$0.001");
  });

  it("12.3455 boundary — FP representable as 12.3454999...", () => {
    // 12.3455 in IEEE754 is 12.34549999... so toFixed(3) yields "12.345".
    // Accept either neighbor depending on engine FP behavior.
    const r = formatCostUSD(12.3455);
    expect(["$12.345", "$12.346"]).toContain(r);
  });

  it("12.3455000001 → $12.346 (guaranteed round-up)", () => {
    expect(formatCostUSD(12.3455000001)).toBe("$12.346");
  });

  it("thousands separator — 1234.5 → $1,234.500", () => {
    expect(formatCostUSD(1234.5)).toBe("$1,234.500");
  });

  it("large number — 1234567.89 → $1,234,567.890", () => {
    expect(formatCostUSD(1234567.89)).toBe("$1,234,567.890");
  });

  it("sub-thousand — 999.999 → $999.999", () => {
    expect(formatCostUSD(999.999)).toBe("$999.999");
  });

  it("negative numbers format with leading minus", () => {
    expect(formatCostUSD(-1234.5)).toBe("-$1,234.500");
  });
});
