/**
 * @fileoverview Canvas sizing. The backing store has to be in device pixels or
 * the browser upscales the whole scene: phones report a devicePixelRatio of
 * 2.5-3.5, so a CSS-pixel canvas renders at a third of the panel's resolution.
 */

// Pixel count grows with the square of the ratio, so uncapped DPR 3 is 9x the
// shading work. 2 is the compromise; drop to 1 to trade sharpness for frames.
export const MAX_PIXEL_RATIO = 2;

/**
 * Sizes the canvas backing store in device pixels and pins its CSS box to the
 * viewport. Returns true only when the size actually changed, so callers can
 * skip rebuilding size-bound GPU resources.
 */
export function sizeCanvas(canvas) {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const width = Math.max(1, Math.round(window.innerWidth * ratio));
  const height = Math.max(1, Math.round(window.innerHeight * ratio));
  // Explicit CSS size: the stylesheet's height:100% resolves against an
  // auto-height body, which stops being reliable once the two differ.
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  if (canvas.width === width && canvas.height === height) return false;
  canvas.width = width;
  canvas.height = height;
  return true;
}
