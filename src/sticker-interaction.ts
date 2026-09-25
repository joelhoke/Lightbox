import * as THREE from 'three';
import { STICKER, clamp } from './config.ts';
import { STICKER_CORNERS } from './project.ts';
import type { ImageStickerPatch, StickerCorner, StickerSettings } from './project.ts';
import type { ContentLayer } from './content.ts';
import { cornerDirection, peelDepth } from './sticker.ts';

/** Corner handles own their gesture; ordinary content/bulb dragging remains in scene.ts. */
export function createStickerInteraction(container: HTMLElement, camera: THREE.Camera, content: ContentLayer,
  update: (id: string, patch: ImageStickerPatch) => void, isArrange: () => boolean) {
  const events = new AbortController();
  let drag: { pointerId: number; id: string; before: StickerSettings; corner: StickerCorner;
    start: THREE.Vector3; depth: number; z: number; root: THREE.Object3D } | null = null;
  const ray = new THREE.Raycaster(), plane = new THREE.Plane();
  function point(event: PointerEvent, z: number) {
    const rect = container.getBoundingClientRect(); camera.updateMatrixWorld(true);
    ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
    plane.set(new THREE.Vector3(0, 0, 1), -z);
    return ray.ray.intersectPlane(plane, new THREE.Vector3());
  }
  function finish(cancelled: boolean) {
    if (!drag) return;
    const current = drag; drag = null;
    if (cancelled && content.nodes.has(current.id)) update(current.id, current.before);
    if (container.hasPointerCapture(current.pointerId)) container.releasePointerCapture(current.pointerId);
    container.classList.remove('is-dragging');
    container.dispatchEvent(new Event('study-sticker-commit'));
  }
  container.addEventListener('pointerdown', (event) => {
    const handle = (event.target as Element).closest<HTMLButtonElement>('.sticker-handle');
    if (!handle || !isArrange() || drag || !event.isPrimary || event.button !== 0) return;
    const id = handle.dataset.itemId!, corner = handle.dataset.stickerCorner as StickerCorner;
    const node = content.nodes.get(id);
    if (node?.record.kind !== 'image' || node.record.treatment !== 'sticker' || !node.image?.surface) return;
    node.root.updateWorldMatrix(true, false);
    const z = node.root.getWorldPosition(new THREE.Vector3()).z;
    const start = point(event, z); if (!start) return;
    drag = { pointerId: event.pointerId, id, before: { ...node.record.sticker! }, corner,
      start: node.root.worldToLocal(start), depth: peelDepth(node.image.bounds, node.record.sticker!), z, root: node.root };
    update(id, { corner }); handle.focus({ preventScroll: true });
    container.setPointerCapture(event.pointerId); container.classList.add('is-dragging');
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  container.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const position = point(event, drag.z);
    if (position) {
      drag.root.worldToLocal(position);
      const direction = cornerDirection(drag.corner);
      const inward = (drag.start.x - position.x) * direction.x + (drag.start.y - position.y) * direction.y;
      update(drag.id, { curl: clamp(Math.round((drag.before.curl + inward / Math.max(1e-8, drag.depth) * 100) / STICKER.curl.step) * STICKER.curl.step, STICKER.curl) });
    }
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  window.addEventListener('pointerup', (event) => { if (drag?.pointerId === event.pointerId) finish(false); }, { capture: true, signal: events.signal });
  container.addEventListener('pointercancel', (event) => { if (drag?.pointerId === event.pointerId) finish(true); }, { signal: events.signal });
  container.addEventListener('lostpointercapture', (event) => { if (drag?.pointerId === event.pointerId) finish(false); }, { signal: events.signal });
  // Enter/Space activates the native button, selecting a corner without dragging.
  container.addEventListener('click', (event) => {
    const handle = (event.target as Element).closest<HTMLButtonElement>('.sticker-handle');
    if (handle && isArrange() && (event as MouseEvent).detail === 0) update(handle.dataset.itemId!, { corner: handle.dataset.stickerCorner as StickerCorner });
  }, { signal: events.signal });
  container.addEventListener('keydown', (event) => {
    const handle = (event.target as Element).closest<HTMLButtonElement>('.sticker-handle');
    if (!handle || !isArrange()) return;
    const corner = handle.dataset.stickerCorner as StickerCorner;
    if (!STICKER_CORNERS.includes(corner) || !['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(event.key)) return;
    const node = content.nodes.get(handle.dataset.itemId!);
    if (node?.record.kind !== 'image') return;
    const direction = event.key === 'ArrowUp' || event.key === 'ArrowRight' ? 1 : -1;
    update(node.record.id, { corner, curl: clamp(node.record.sticker!.curl + direction * STICKER.curl.step * (event.shiftKey ? 10 : 1), STICKER.curl) });
    event.preventDefault();
  }, { signal: events.signal });
  window.addEventListener('blur', () => finish(true), { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(true); }, { signal: events.signal });
  return { cancel: () => finish(true), dispose() { finish(true); events.abort(); } };
}
