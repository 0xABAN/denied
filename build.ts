import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
for (const [entrypoints, format] of [
  [["extension/src/content.ts"], "iife"],
  [["extension/src/background.ts", "extension/src/popup.ts"], "esm"],
] as const) {
  const result = await Bun.build({ entrypoints: [...entrypoints], format, target: "browser", outdir: "dist" });
  if (!result.success) throw new AggregateError(result.logs, "Extension build failed");
}
for (const file of ["manifest.json", "popup.html", "popup.css"]) {
  await cp(`extension/${file}`, `dist/${file}`);
}
console.log("Built dist/; load it as an unpacked extension.");
