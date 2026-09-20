/** Experimental inputs from rendered synthetic DOM, not semantic descriptions of ownership. */
import { chromium } from "playwright";
import { resolve } from "node:path";

const fixtures = [
  { name: "dom_chat", expected: "B", html: '<main role="log"><div role="group" aria-label="Alex: Tickets for sale"><button aria-label="Alex profile"><img alt="Alex" width="32" height="32"></button><b>Alex</b><time>10:00</time><p id="target">Tickets for sale. DM me.</p></div><div role="group"><b>Sam</b><p>Meeting tomorrow.</p></div></main>' },
  { name: "dom_product", expected: "B", html: '<main><article><img alt="Notebook" width="80" height="80"><h2>Notebook</h2><p id="target">Buy for $5.</p><button>Add to cart</button></article><article><h2>Pencil</h2><p>Buy for $2.</p></article></main>' },
  { name: "dom_separate_messages", expected: "A", html: '<main role="log"><div><p id="target">Tickets for sale. DM me.</p><p>Do not send money to strangers.</p></div><div><p>Meeting tomorrow.</p></div></main>' },
];
const browser = await chromium.launch({ channel: "chromium", headless: true });
const cases = [];
try {
  const page = await browser.newPage();
  for (const fixture of fixtures) {
    await page.setContent(fixture.html);
    const state = await page.evaluate(() => {
      const target = document.getElementById("target")!;
      function describe(node: Element, depth = 0): object {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(), role: node.getAttribute("role") || "",
          label: node.getAttribute("aria-label") || "", alt: node.getAttribute("alt") || "",
          original_target: node === target,
          text: [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join(" ").trim(),
          bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          children: depth < 6 ? [...node.children].map(child => describe(child, depth + 1)) : [],
        };
      }
      return { flagged: target.textContent, options: {
        A: describe(target), B: describe(target.parentElement!), C: describe(target.parentElement!.parentElement!),
      } };
    });
    cases.push({ name: fixture.name, expected: fixture.expected, ...state });
  }
} finally {
  await browser.close();
}
const child = Bun.spawn(["uv", "run", "--env-file", ".env", "python", "benchmark_boundaries.py", "--ownership", "--stdin"], {
  cwd: resolve("src/backend"), stdin: "pipe", stdout: "inherit", stderr: "inherit",
});
child.stdin.write(JSON.stringify(cases));
child.stdin.end();
if (await child.exited !== 0) throw new Error("DOM boundary experiment failed");
