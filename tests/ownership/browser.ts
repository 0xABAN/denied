import type { Page } from "playwright";
import { documentHTML, type OwnershipCase, type Variant } from "./corpus";

/** Fixtures and their labels stay in the harness; only observations go to the provider. */
export async function loadCase(page: Page, test: OwnershipCase, variant: Variant = "original"): Promise<void> {
  await page.setContent(documentHTML(test));
  await page.evaluate(variant => {
    const visit = (root: ParentNode): void => {
      for (const element of [...root.querySelectorAll("*")]) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (variant === "restyled" && element instanceof HTMLElement) {
          element.className = `renamed-${element.tagName.toLowerCase()}`;
          element.style.backgroundColor = "transparent";
          element.style.border = "none";
          element.style.fontSize = "19px";
        }
        if (variant === "wrappers" && element.id === "seed" && element.parentNode) {
          const wrapper = document.createElement("div");
          element.replaceWith(wrapper);
          wrapper.append(element);
        }
      }
    };
    visit(document.querySelector("#fixture")!);
  }, variant);
}

export async function installPrototype(page: Page, script: string): Promise<void> {
  await page.evaluate(async script => {
    const url = URL.createObjectURL(new Blob([script], { type: "text/javascript" }));
    (window as any).ownership = await import(url);
    URL.revokeObjectURL(url);
    (window as any).findFixture = (id: string): Element | null => {
      const search = (root: ParentNode): Element | null => {
        for (const node of root.querySelectorAll("*")) {
          if (node.id === id) return node;
          if (node.shadowRoot) {
            const match = search(node.shadowRoot);
            if (match) return match;
          }
        }
        return null;
      };
      return search(document);
    };
  }, script);
}
