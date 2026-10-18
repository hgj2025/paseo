import { expect, it } from "vitest";
import { classifyModelLimit } from "./model-limit-state";
it("does not confuse rate limiting with confirmed quota exhaustion", () => {
  expect(classifyModelLimit("Rate limit exceeded. Please try again later.")).toBe("rate");
  expect(classifyModelLimit("APIError 429 Too Many Requests")).toBe("rate");
  expect(classifyModelLimit("insufficient_quota")).toBe("quota");
  expect(classifyModelLimit("Free usage exceeded")).toBe("quota");
  expect(classifyModelLimit("Maximum context length exceeded")).toBeNull();
  expect(classifyModelLimit("Authentication failed")).toBeNull();
  expect(classifyModelLimit(null)).toBeNull();
});
