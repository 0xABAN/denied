import { expect, test } from "bun:test";
import { LineDecoder } from "../ndjson";

const encode = (value: string) => new TextEncoder().encode(value);

test("frames split UTF-8 lines without delaying completed siblings", () => {
  const decoder = new LineDecoder();
  const lines: string[] = [];
  for (const byte of encode('"café 🦋"\n\n{"next":1}\n')) {
    lines.push(...decoder.decode(new Uint8Array([byte])));
  }
  expect(lines).toEqual(['"café 🦋"', "", '{"next":1}']);
  expect([...decoder.decode(undefined, true)]).toEqual([]);

  expect([...decoder.decode(encode("ready\npending"))]).toEqual(["ready"]);
  expect(() => [...decoder.decode(undefined, true)]).toThrow("Truncated judgment stream");
});

test("delivers completed lines before rejecting an oversized remainder", () => {
  const lines = new LineDecoder().decode(encode("ready\n" + "x".repeat(1_000_001)));
  expect(lines.next().value).toBe("ready");
  expect(() => lines.next()).toThrow("Oversized streamed result");
});
