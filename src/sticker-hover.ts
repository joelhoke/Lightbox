import * as THREE from 'three';
import { STICKER } from './config.ts';
import { cornerDirection, peelDepth } from './sticker.ts';
import type { ContentLayer, RenderedItem } from './content.ts';

export function hoverFalloff(distance: number, radius: number) {
  const t = Math.max(0, Math.min(1, distance / radius));
  return 1 - t * t * (3 - 2 * t);
}
export function easeHover(current: number, target: number, elapsed: number) {
  const time = target > current ? STICKER.hover.approachTime : STICKER.hover.returnTime;
  const next = target + (current - target) * Math.exp(-Math.max(0, Math.min(elapsed, STICKER.hover.maxDelta)) / time);
  return Math.abs(next - target) <= STICKER.hover.settleEpsilon ? target : next;
}

/** Uses the saved shape, never the animated mesh, so the trigger cannot chase itself. */
export function hoverRegion(node: RenderedItem, camera: THREE.Camera, width: number, height: number) {
  if (node.record.kind !== 'image' || node.record.treatment !== 'sticker' || !node.image?.surface || !node.record.sticker?.curl) return null;
  const settings = node.record.sticker;
  const corner = node.image.surface.handle(settings.corner, settings);
  const direction = cornerDirection(settings.corner), depth = peelDepth(node.image.bounds, settings);
  const end = corner.clone().add(new THREE.Vector3(direction.x * depth, direction.y * depth, 0));
  corner.applyMatrix4(node.root.matrixWorld).project(camera);
  end.applyMatrix4(node.root.matrixWorld).project(camera);
  if (corner.z < -1 || corner.z > 1) return null;
  const projectedDepth = Math.hypot((end.x - corner.x) * width / 2, (end.y - corner.y) * height / 2);
  return { x: (corner.x + 1) * width / 2, y: (1 - corner.y) * height / 2,
    radius: Math.max(STICKER.hover.minRadius, Math.min(STICKER.hover.maxRadius, projectedDepth * STICKER.hover.radiusScale)) };
}

/** Decorative state belongs to this controller, never to a project record. */
export function createStickerHover(container: HTMLElement, canvas: HTMLCanvasElement, camera: THREE.Camera,
  content: ContentLayer, isPreview: () => boolean, invalidate: () => void) {
  const events = new AbortController();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const states = new Map<string, { node: RenderedItem; record: RenderedItem['record']; amount: number }>();
  const pressed = new Set<number>();
  let pointer: { x: number; y: number } | null = null;
  function reset() {
    pointer = null; pressed.clear();
    for (const [id, state] of states) if (content.nodes.get(id) === state.node) content.setHoverInfluence(state.node, 0);
    states.clear(); invalidate();
  }
  function remember(event: PointerEvent) {
    if (!event.isPrimary) return;
    if (!event.buttons) pressed.delete(event.pointerId);
    const previous = pointer;
    const top = document.elementFromPoint(event.clientX, event.clientY);
    pointer = isPreview() && !reduced.matches && !event.buttons && (top === canvas || top === container) && (event.pointerType === 'mouse' || event.pointerType === 'pen')
      ? { x: event.clientX, y: event.clientY } : null;
    if (pointer || previous || states.size) invalidate();
  }
  window.addEventListener('pointermove', remember, { capture: true, signal: events.signal });
  window.addEventListener('pointerdown', (event) => {
    pressed.add(event.pointerId); pointer = null;
    if (states.size) invalidate();
  }, { capture: true, signal: events.signal });
  window.addEventListener('pointerup', (event) => { pressed.delete(event.pointerId); remember(event); }, { capture: true, signal: events.signal });
  window.addEventListener('lostpointercapture', (event) => { if (!event.buttons) remember(event); }, { capture: true, signal: events.signal });
  window.addEventListener('pointercancel', (event) => {
    pressed.delete(event.pointerId); pointer = null; if (states.size) invalidate();
  }, { capture: true, signal: events.signal });
  container.addEventListener('pointerleave', () => { pointer = null; if (states.size) invalidate(); }, { signal: events.signal });
  window.addEventListener('blur', reset, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, { signal: events.signal });
  reduced.addEventListener('change', reset, { signal: events.signal });

  return {
    reset,
    advance(elapsed: number) {
      const rect = container.getBoundingClientRect();
      const top = pointer ? document.elementFromPoint(pointer.x, pointer.y) : null;
      const active = isPreview() && !reduced.matches && !pressed.size && !container.classList.contains('is-dragging') && pointer && (top === canvas || top === container);
      camera.updateMatrixWorld(true);
      let moving = false;
      for (const [id, state] of states) if (content.nodes.get(id) !== state.node) states.delete(id);
      for (const [id, node] of content.nodes) {
        let state = states.get(id);
        if (state && state.record !== node.record) {
          content.setHoverInfluence(node, 0); states.delete(id); state = undefined;
        }
        node.root.updateWorldMatrix(true, false);
        const region = active ? hoverRegion(node, camera, rect.width, rect.height) : null;
        const target = region && pointer ? hoverFalloff(Math.hypot(pointer.x - rect.left - region.x, pointer.y - rect.top - region.y), region.radius) : 0;
        if (!target && !state) continue;
        const amount = easeHover(state?.amount ?? 0, target, elapsed);
        content.setHoverInfluence(node, amount);
        if (amount === 0 && target === 0) states.delete(id);
        else states.set(id, { node, record: node.record, amount });
        if (amount !== target) moving = true;
      }
      return moving;
    },
    dispose() { reset(); events.abort(); },
  };
}
