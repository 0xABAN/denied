export const BLOCKS_PER_REQUEST = 20;

/** Split a dispatch wave into independently delivered provider batches. */
export function requestBatches<T>(items: T[]): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += BLOCKS_PER_REQUEST) batches.push(items.slice(i, i + BLOCKS_PER_REQUEST));
  return batches;
}
