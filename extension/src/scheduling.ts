export const INFERENCE_DELAY_MS = 5_000;
export const INFERENCE_BATCH_SIZE = 600;
export const BLOCKS_PER_REQUEST = 20;

/** Split a dispatch wave into independently delivered provider batches. */
export function requestBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += BLOCKS_PER_REQUEST) batches.push(items.slice(i, i + BLOCKS_PER_REQUEST));
  return batches;
}

export function inferenceDelay(lastStarted: number | null, now: number): number {
  if (lastStarted === null) return 0;
  return Math.max(0, INFERENCE_DELAY_MS - (now - lastStarted));
}
