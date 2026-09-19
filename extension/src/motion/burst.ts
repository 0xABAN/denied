import { OWN } from "../contracts";
import { renderedParent } from "../scan";

const MAX_LAYERS = 4;
const MAX_ATLAS_PIXELS = 1_000_000;
const TAIL_MS = 520;
const MARGIN = 240;
let layers = 0;

type Point = { x: number; y: number };
type Fragment = { points: Point[]; x: number; y: number; dx: number; dy: number; turn: number };
export type Burst = { play: () => void; cancel: () => void };

function monochrome(color: string): string | undefined {
  const values = color.match(/[\d.]+/g)?.map(Number);
  if (!values || values.length < 3 || values[3] === 0) return;
  const shade = Math.round(values[0] * .2126 + values[1] * .7152 + values[2] * .0722);
  return `rgba(${shade},${shade},${shade},${values[3] ?? 1})`;
}

/** Build a bounded local approximation of visible text and painted surfaces.
 * No screenshots, image pixels, private inputs, or cloned page HTML are used.
 * Six large pointed shards cover the component, rather than individual letters.
 * Geometry is purely decorative and never decides which content is unsafe.
 */
export function prepareBurst(element: HTMLElement, peakScale: number): Burst | undefined {
  if (layers >= MAX_LAYERS) return;
  const box = element.getBoundingClientRect();
  const left = Math.max(0, box.left);
  const top = Math.max(0, box.top);
  const width = Math.ceil(Math.min(innerWidth, box.right) - left);
  const height = Math.ceil(Math.min(innerHeight, box.bottom) - top);
  if (width < 2 || height < 2) return;

  const ratio = Math.min(devicePixelRatio || 1, 2, Math.sqrt(MAX_ATLAS_PIXELS / (width * height)));
  const atlas = document.createElement("canvas");
  atlas.width = Math.ceil(width * ratio);
  atlas.height = Math.ceil(height * ratio);
  const ink = atlas.getContext("2d");
  if (!ink) return;
  ink.scale(ratio, ratio);
  ink.textBaseline = "top";

  // Follow rendered ancestry through slots and shadow hosts in either theme.
  let shade = 28;
  for (let ancestor: Element | null = element; ancestor; ancestor = renderedParent(ancestor)) {
    const color = getComputedStyle(ancestor).backgroundColor.match(/[\d.]+/g)?.map(Number);
    if (color && (color.length === 3 || color[3] > .5)) {
      shade = color[0] * .2126 + color[1] * .7152 + color[2] * .0722 < 128 ? 235 : 28;
      break;
    }
  }
  const textColor = `rgb(${shade},${shade},${shade})`;
  const range = document.createRange();
  let words = 0;
  let visited = 0;
  const excluded = `script,style,noscript,input,textarea,select,[role=textbox],[contenteditable]:not([contenteditable=false]),[hidden],[${OWN}]`;
  const seen = new Set<Node>();

  function visit(node: Node): void {
    if (visited++ >= 800 || seen.has(node)) return;
    seen.add(node);
    if (node instanceof Element) {
      if (node.matches(excluded)) return;
      const style = getComputedStyle(node);
      if (style.visibility === "hidden" || style.display === "none") return;
      const rect = node.getBoundingClientRect();
      const background = monochrome(style.backgroundColor);
      if (rect.width && rect.height && background) {
        ink!.fillStyle = background;
        ink!.beginPath();
        const radius = Math.min(parseFloat(style.borderTopLeftRadius) || 0, rect.width / 2, rect.height / 2);
        ink!.roundRect(rect.left - left, rect.top - top, rect.width, rect.height, radius);
        ink!.fill();
      }
      if (node instanceof HTMLSlotElement) {
        const assigned = node.assignedNodes({ flatten: true });
        (assigned.length ? assigned : [...node.childNodes]).forEach(visit);
      } else if (node.shadowRoot) [...node.shadowRoot.childNodes].forEach(visit);
      else [...node.childNodes].forEach(visit);
    } else if (node instanceof Text && node.parentElement) {
      const style = getComputedStyle(node.parentElement);
      ink!.font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      ink!.fillStyle = textColor;
      for (const match of node.data.matchAll(/\S+/g)) {
        if (words >= 100) break;
        range.setStart(node, match.index!);
        range.setEnd(node, match.index! + match[0].length);
        const rectangles = range.getClientRects();
        if (rectangles.length !== 1) continue;
        const rect = rectangles[0];
        if (rect.bottom < top || rect.top > top + height || rect.right < left || rect.left > left + width) continue;
        ink!.fillText(match[0], rect.left - left, rect.top - top, rect.width);
        words++;
      }
    }
  }
  visit(element);
  // Textless media gets a surface outline without inspecting its pixels.
  if (!words) {
    ink.strokeStyle = textColor;
    ink.lineWidth = 2;
    ink.strokeRect(8, 8, Math.max(1, width - 16), Math.max(1, height - 16));
  }

  const noise = (seed: number) => {
    const value = Math.sin(seed * 78.233 + 12.9898) * 43758.5453;
    return value - Math.floor(value);
  };
  // Uneven fractures radiate from one off-center impact point. Shared edges
  // tile the original surface exactly, while every chunk gets a sharp tip.
  const impact: Point = { x: width * .43, y: height * .56 };
  const perimeter: Point[] = [
    { x: 0, y: 0 },
    { x: width * .62, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: width * .35, y: height },
    { x: 0, y: height },
  ];
  const fragments: Fragment[] = [];
  const add = (points: Point[]) => {
    const x = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const y = points.reduce((sum, point) => sum + point.y, 0) / points.length;
    const angle = Math.atan2(y - impact.y, x - impact.x);
    const distance = 85 + noise(fragments.length + 90) * 105;
    // Large sections separate radially with a little independent tilt. Avoid
    // the pinwheel motion of the old Z-axis spin and its tiny confetti fragments.
    fragments.push({ points, x, y,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      turn: (noise(fragments.length + 40) - .5) * 1.4,
    });
  };
  perimeter.forEach((point, index) => add([impact, point, perimeter[(index + 1) % perimeter.length]]));

  const canvas = document.createElement("canvas");
  canvas.setAttribute(OWN, "burst");
  canvas.setAttribute("aria-hidden", "true");
  // Bound the output bitmap too, including the explosion's safety margin.
  const outputRatio = Math.min(ratio, Math.sqrt(2_000_000 / ((width + MARGIN * 2) * (height + MARGIN * 2))));
  canvas.width = Math.ceil((width + MARGIN * 2) * outputRatio);
  canvas.height = Math.ceil((height + MARGIN * 2) * outputRatio);
  const context = canvas.getContext("2d");
  if (!context) return;
  canvas.style.cssText = `all:initial;position:fixed;left:${left - MARGIN}px;top:${top - MARGIN}px;` +
    `width:${width + MARGIN * 2}px;height:${height + MARGIN * 2}px;pointer-events:none;z-index:2147483646;`;
  let frame = 0;
  let timeout: ReturnType<typeof setTimeout>;
  let closed = false;
  let playing = false;
  let pageX = scrollX;
  let pageY = scrollY;
  let canvasLeft = left - MARGIN;
  let canvasTop = top - MARGIN;
  layers++;

  const cancel = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    clearTimeout(timeout);
    window.removeEventListener("scroll", scrolled, true);
    window.removeEventListener("resize", cancel);
    document.removeEventListener("visibilitychange", cancel);
    canvas.remove();
    layers--;
  };
  const scrolled = (event: Event) => {
    const documentScroll = event.target === document || event.target === window;
    // A queued scroll event may arrive after geometry was sampled at its new
    // position. An event without further movement does not invalidate the atlas.
    if (documentScroll && pageX === scrollX && pageY === scrollY) return;
    if (!playing || !documentScroll) return cancel();
    // Closing layout space can trigger the browser's scroll anchoring. Keep an
    // already-released explosion in document coordinates instead of erasing it.
    canvasLeft += pageX - scrollX;
    canvasTop += pageY - scrollY;
    pageX = scrollX;
    pageY = scrollY;
    canvas.style.left = `${canvasLeft}px`;
    canvas.style.top = `${canvasTop}px`;
  };
  // Geometry becomes stale even if the viewport changes during the wind-up,
  // before the canvas is attached. Reserve and cancel the layer as one lifetime.
  window.addEventListener("scroll", scrolled, { capture: true, passive: true });
  window.addEventListener("resize", cancel, { passive: true });
  document.addEventListener("visibilitychange", cancel);

  const play = () => {
    if (closed || playing) return;
    playing = true;
    document.documentElement.append(canvas);
    const started = performance.now();
    const draw = (now: number) => {
      if (closed) return;
      const elapsed = now - started;
      if (elapsed >= TAIL_MS) return cancel();
      const t = Math.min(1, elapsed / TAIL_MS);
      const travel = 1 - (1 - t) ** 3;
      // Keep the pieces physically large throughout the burst; fade them away
      // instead of turning them into dust near the end of their flight.
      const scale = peakScale * (1 - t ** 1.5 * .18);
      context.setTransform(outputRatio, 0, 0, outputRatio, 0, 0);
      context.clearRect(0, 0, width + MARGIN * 2, height + MARGIN * 2);
      for (const piece of fragments) {
        context.save();
        context.globalAlpha = (1 - t) ** 1.3;
        context.translate(MARGIN + width / 2 + (piece.x - width / 2) * peakScale + piece.dx * travel,
          MARGIN + height / 2 + (piece.y - height / 2) * peakScale + piece.dy * travel + 45 * t * t);
        context.rotate(piece.turn * travel);
        context.scale(scale, scale);
        context.beginPath();
        piece.points.forEach((point, index) => {
          if (index) context.lineTo(point.x - piece.x, point.y - piece.y);
          else context.moveTo(point.x - piece.x, point.y - piece.y);
        });
        context.closePath();
        context.clip();
        context.drawImage(atlas, -piece.x, -piece.y, width, height);
        context.restore();
      }
      frame = requestAnimationFrame(draw);
    };
    draw(started);
    timeout = setTimeout(cancel, TAIL_MS + 300);
  };
  return { play, cancel };
}
