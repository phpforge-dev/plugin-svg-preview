export const maxZoom = 8;
export const minZoom = 0.1;

/** Fit the image inside the viewport. Undefined until the viewport has been laid out. */
export function fittedScale(width: number, height: number, viewWidth: number, viewHeight: number): number | undefined {
  if (viewWidth < 8 || viewHeight < 8 || width < 1 || height < 1) return undefined;
  const availableWidth = Math.max(1, viewWidth - 48);
  const availableHeight = Math.max(1, viewHeight - 48);
  return Math.min(maxZoom, availableWidth / width, availableHeight / height, 16384 / width, 16384 / height);
}

export function clampZoom(value: number): number {
  return Math.max(minZoom, Math.min(maxZoom, value));
}

export function zoomAnchor(viewport: HTMLElement, clientX: number, clientY: number, ratio: number) {
  const rect = viewport.getBoundingClientRect();
  const originX = clientX - rect.left + viewport.scrollLeft;
  const originY = clientY - rect.top + viewport.scrollTop;
  viewport.scrollLeft = originX * ratio - (clientX - rect.left);
  viewport.scrollTop = originY * ratio - (clientY - rect.top);
}

/** Wheel zooms, drag pans, double-click toggles fit and actual size. */
export function bindImagePointer(viewport: HTMLElement, actions: {
  zoomBy(factor: number, clientX: number, clientY: number): void;
  toggleFit(): void;
}, own: (cleanup: () => void) => void) {
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    actions.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX, event.clientY);
  };
  let drag: { x: number; y: number; left: number; top: number } | undefined;
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!drag) return;
    viewport.scrollLeft = drag.left - (event.clientX - drag.x);
    viewport.scrollTop = drag.top - (event.clientY - drag.y);
  };
  const up = () => { drag = undefined; };
  const dbl = () => actions.toggleFit();
  viewport.addEventListener('wheel', wheel, { passive: false });
  viewport.addEventListener('pointerdown', down);
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('dblclick', dbl);
  own(() => {
    viewport.removeEventListener('wheel', wheel);
    viewport.removeEventListener('pointerdown', down);
    viewport.removeEventListener('pointermove', move);
    viewport.removeEventListener('pointerup', up);
    viewport.removeEventListener('pointercancel', up);
    viewport.removeEventListener('dblclick', dbl);
  });
}

/** Width and height from attributes or viewBox when the image element has no intrinsic size. */
export function svgBox(text: string): { width: number; height: number } | undefined {
  const tag = /<svg\b([^>]*)>/i.exec(text)?.[1] ?? '';
  const length = (name: string) => {
    const raw = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1] ?? '';
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) && value > 0 ? value : undefined;
  };
  const width = length('width');
  const height = length('height');
  if (width && height) return { width, height };
  const box = /\bviewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)\s*["']/i.exec(tag);
  const boxWidth = Number.parseFloat(box?.[1] ?? '');
  const boxHeight = Number.parseFloat(box?.[2] ?? '');
  if (boxWidth > 0 && boxHeight > 0) return { width: boxWidth, height: boxHeight };
  return undefined;
}
