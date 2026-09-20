import { test, expect } from "bun:test";
import { requestBatches } from "../scheduling";
import { MAX_BATCH } from "../contracts";

test("groups a 600-block wave into thirty requests and retains partial batches", () => {
  const blocks = Array.from({ length: 600 }, (_, i) => i);
  const batches = requestBatches(blocks);
  expect(batches.length).toBe(30);
  expect(batches.every(batch => batch.length === 20)).toBe(true);
  expect(batches.flat()).toEqual(blocks);
  expect(requestBatches(blocks.slice(0, 21)).map(batch => batch.length)).toEqual([20, 1]);
  expect(requestBatches([])).toEqual([]);
});

test("uses the full large-page inference batch", () => {
  expect(MAX_BATCH).toBe(600);
});
