import { test, expect } from "bun:test";
import { INFERENCE_BATCH_SIZE, INFERENCE_DELAY_MS, inferenceDelay, requestBatches } from "../scheduling";

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
  expect(INFERENCE_BATCH_SIZE).toBe(600);
});

test("dispatches inference without a wave cooldown", () => {
  expect(INFERENCE_DELAY_MS).toBe(0);
  expect(inferenceDelay(null, 10_000)).toBe(0);
  expect(inferenceDelay(10_000, 10_000)).toBe(0);
  expect(inferenceDelay(10_000, 10_001)).toBe(0);
  expect(inferenceDelay(10_000, 15_000)).toBe(0);
});
