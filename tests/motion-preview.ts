/** Local, animation-only preview. The effect module is rebuilt on every request. */
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/effects.js") {
    const build = await Bun.build({ entrypoints: ["extension/src/effects.ts"], format: "esm", target: "browser" });
    if (!build.success) return new Response("Build failed", { status: 500 });
    return new Response(await build.outputs[0].text(), { headers: { "Content-Type": "text/javascript", "Cache-Control": "no-store" } });
  }
  if (path === "/") return new Response(Bun.file("tests/motion-preview.html"), { headers: { "Cache-Control": "no-store" } });
  return new Response("Not found", { status: 404 });
} });
console.log(`Motion preview: http://127.0.0.1:${server.port}`);
