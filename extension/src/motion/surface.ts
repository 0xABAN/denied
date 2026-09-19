import { renderedParent } from "../scan";

/** Match the nearest painted surface, including slotted and shadow content.
 * This chooses decorative contrast, never a filtering or ownership decision.
 */
export function isDarkSurface(element: HTMLElement): boolean {
  for (let ancestor: Element | null = element; ancestor; ancestor = renderedParent(ancestor)) {
    const color = getComputedStyle(ancestor).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (color && (color.length === 3 || color[3] > .5)) {
      return color[0] * .2126 + color[1] * .7152 + color[2] * .0722 < 128;
    }
  }
  return false;
}
