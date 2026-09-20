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

/** Alpha-following shadows work on both intact elements and transparent shards. */
export function motionShadow(element: HTMLElement): string {
  return isDarkSurface(element)
    ? "drop-shadow(0 8px 12px rgba(0,0,0,.8)) drop-shadow(0 2px 3px rgba(0,0,0,.5))"
    : "drop-shadow(0 8px 12px rgba(0,0,0,.28)) drop-shadow(0 2px 3px rgba(0,0,0,.18))";
}
