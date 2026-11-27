import { describe, expect, it } from "vitest";
import { computeEventCost, extractTokens, type PricingMap } from "../cost";

const pricing: PricingMap = new Map([
  [
    "provider:gpt-test",
    { pricingInput: 1, pricingOutput: 2 },
  ],
  ["gpt-test", { pricingInput: 1, pricingOutput: 2 }],
]);

describe("Cost helpers", () => {
  it("prefers the new token field names", () => {
    const tokens = extractTokens({
      model: "gpt-test",
      tokensIn: 120,
      tokensOut: 45,
      promptTokens: 1,
      completionTokens: 2,
    });

    expect(tokens).toEqual({ tokensIn: 120, tokensOut: 45, model: "gpt-test" });
  });

  it("falls back to legacy prompt and completion token fields", () => {
    const tokens = extractTokens({
      model: "gpt-test",
      promptTokens: 130,
      completionTokens: 60,
    });

    expect(tokens).toEqual({ tokensIn: 130, tokensOut: 60, model: "gpt-test" });
  });

  it("clamps negative token counts to zero", () => {
    const tokens = extractTokens({
      model: "gpt-test",
      tokensIn: -10,
      tokensOut: -20,
    });

    expect(tokens).toEqual({ tokensIn: 0, tokensOut: 0, model: "gpt-test" });
  });

  it("uses provider-specific pricing before model-only pricing", () => {
    const result = computeEventCost(
      { model: "gpt-test", tokensIn: 1000, tokensOut: 1000 },
      pricing,
      "provider",
    );

    expect(result.tokensIn).toBe(1000);
    expect(result.tokensOut).toBe(1000);
    expect(result.model).toBe("gpt-test");
    expect(result.cost).toBeCloseTo(0.003, 9);
  });

  it("returns zero cost for an unknown pricing model", () => {
    const result = computeEventCost(
      { model: "unknown-model", tokensIn: 1000, tokensOut: 1000 },
      pricing,
    );

    expect(result.cost).toBe(0);
  });
});
