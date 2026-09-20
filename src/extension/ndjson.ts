/** Incremental UTF-8 framing only; callers own JSON validation and delivery. */
export class LineDecoder {
  private decoder = new TextDecoder();
  private buffer = "";

  *decode(chunk?: Uint8Array, done = false): Generator<string> {
    this.buffer += this.decoder.decode(chunk, { stream: !done });
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      yield line;
    }
    if (this.buffer.length > 1_000_000) throw new Error("Oversized streamed result");
    if (done && this.buffer.trim()) throw new Error("Truncated judgment stream");
  }
}
