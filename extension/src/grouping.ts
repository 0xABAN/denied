/** Structural segmentation only: these rules never classify advertising or safety. */
const ITEM = "article,li,[role=article],[role=listitem]";
export const COLLECTION = "main,nav,aside,form,ul,ol,table,[role=main],[role=navigation],[role=region],[role=list],[role=feed],[role=log]";
const CONTAINER = "div,section,article,li";
const NAMED_GROUP = '[role="group"][aria-label], [role="group"][aria-labelledby]';
const MEDIA_TITLE = "h1,h2,h3,h4,h5,h6,figcaption,[itemprop=name]";

/** Associate only a compact, single-title listing/player, never an entire feed.
 * Linked thumbnails must share their destination with the title; their pixels
 * and destination pages are not inspected. These rules also fit non-video cards.
 * ponytail: one title/two paragraphs; use site-specific extraction for complex layouts.
 */
function mediaItem(el: HTMLElement, visible: (el: Element) => boolean): boolean {
  if (el.children.length < 2) return false;
  const titles = [...el.querySelectorAll(MEDIA_TITLE)].filter(visible);
  if (titles.length !== 1 || el.querySelectorAll("p").length > 2) return false;
  const players = el.querySelectorAll("video,iframe");
  const box = el.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) return false;
  if (players.length) return players.length === 1 && box.height <= Math.max(innerHeight * 2, 1600);

  const thumbnails = el.querySelectorAll("a[href] img");
  if (thumbnails.length !== 1 || box.height > 480) return false;
  const imageLink = thumbnails[0].closest("a") as HTMLAnchorElement;
  const titleLink = titles[0].closest("a[href]") || titles[0].querySelector("a[href]");
  return titleLink instanceof HTMLAnchorElement && imageLink.href === titleLink.href;
}

/** Per-discovery caches avoid comparing every text leaf with every sibling. */
export function itemBoundaries(visible: (el: Element) => boolean): (el: HTMLElement) => boolean {
  const answers = new WeakMap<HTMLElement, boolean>();
  const peers = new WeakMap<Element, Map<string, number>>();
  const signature = (el: Element) => `${el.tagName}:${el.getAttribute("role") || ""}:${
    [...el.children].map(child => `${child.tagName}:${child.getAttribute("role") || ""}`).join(",")}`;

  return (el: HTMLElement): boolean => {
    const cached = answers.get(el);
    if (cached !== undefined) return cached;
    let result = false;
    // Never let a whole thread, list, or application become one removal target.
    if (!el.matches(COLLECTION) && !el.querySelector(`${ITEM},${COLLECTION},[role="group"]`) && visible(el)) {
      if (el.matches(ITEM) || mediaItem(el, visible)) {
        result = true;
      } else if (el.matches(NAMED_GROUP)) {
        // Accessibility grouping can supply an item boundary even when the
        // message row is transparent and has a single layout-wrapper child.
        const named = Boolean(el.getAttribute("aria-label")?.trim()) ||
          (el.getAttribute("aria-labelledby") || "").split(/\s+/).some(id =>
            Boolean(el.ownerDocument.getElementById(id)?.textContent?.trim()));
        const rect = el.getBoundingClientRect();
        result = named && rect.width > 0 && rect.height > 0 && rect.height <= 480;
      } else if (el.matches(CONTAINER) && el.children.length >= 2 && el.parentElement) {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const background = style.backgroundColor;
        const bounded = (background !== "transparent" && background !== "rgba(0, 0, 0, 0)") ||
          [style.borderTopWidth, style.borderBottomWidth].some(value => parseFloat(value) > 0);
        // A repeated layout wrapper alone is not enough: require a compact,
        // visibly bounded item. Ambiguous layouts retain their smaller targets.
        if (bounded && rect.width > 0 && rect.height > 0 && rect.height <= 480) {
          let counts = peers.get(el.parentElement);
          if (!counts) {
            counts = new Map();
            for (const sibling of el.parentElement.children) {
              if (!visible(sibling)) continue;
              const key = signature(sibling);
              counts.set(key, (counts.get(key) || 0) + 1);
            }
            peers.set(el.parentElement, counts);
          }
          result = (counts.get(signature(el)) || 0) >= 2;
        }
      }
    }
    answers.set(el, result);
    return result;
  };
}
