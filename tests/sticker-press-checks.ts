import * as THREE from 'three';
import type { LightingScene } from '../src/scene.ts';
import { defaultSticker, serializeProject } from '../src/project.ts';
import { VIEW } from '../src/config.ts';
import { stickerBitmap } from './sticker-fixture.ts';

export async function checkStickerPress(scene: LightingScene, host: HTMLElement, assert: (condition: unknown, message: string) => void) {
  const style = host.style.cssText, capture = host.setPointerCapture, arrange = scene.arrangeMode;
  host.style.cssText += ';position:fixed;left:20px;top:80px;z-index:10000'; host.setPointerCapture = () => {};
  const item = { id: 'press-check', kind: 'image' as const, imageData: stickerBitmap('card'), width: 0.4, x: -0.45, y: 0.1,
    offset: 0, alt: 'Press check', treatment: 'sticker' as const, rotation: 20, sticker: defaultSticker() };
  const render = () => new Promise<void>((resolve) => { host.addEventListener('study-render', () => resolve(), { once: true }); scene.invalidate(); });
  const wait = async (condition: () => boolean) => {
    const start = performance.now(); while (!condition()) {
      if (performance.now() - start > 4000) throw new Error('Sticker press did not settle; keep the test tab visible');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const camera = new THREE.PerspectiveCamera(VIEW.fieldOfView, host.clientWidth / host.clientHeight, 0.01, 30); camera.position.z = VIEW.cameraZ; camera.updateMatrixWorld();
  const root = () => scene.contentGroup.getObjectByName('content-press-check')!;
  const mesh = () => root().children[0] as THREE.Mesh;
  const pointer = (type: string, local: THREE.Vector3, target: EventTarget = host, pointerId = 151, pointerType = 'touch') => {
    root().updateWorldMatrix(true, true);
    const p = root().localToWorld(local.clone()).project(camera), rect = host.getBoundingClientRect();
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, isPrimary: true, pointerId, pointerType, button: 0,
      buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
      clientX: rect.left + (p.x + 1) * rect.width / 2, clientY: rect.top + (1 - p.y) * rect.height / 2 }));
  };
  const opaque = new THREE.Vector3(-0.1, 0.1, 0), hole = new THREE.Vector3(-0.08, -0.06, 0);
  try {
    await scene.addItem(item); scene.setArrangeMode(false); await render();
    const geometry = mesh().geometry, buffer = geometry.attributes.position.array;
    const saved = serializeProject(scene.exportProject()), originalZ = geometry.boundingBox!.max.z;
    pointer('pointerdown', hole); await render();
    assert(!host.classList.contains('is-sticker-pressed') && geometry.boundingBox!.max.z === originalZ, 'A transparent PNG hole does not capture a sticker press');
    pointer('pointerup', hole, window);
    pointer('pointerdown', opaque);
    await wait(() => geometry.boundingBox!.max.z === 0);
    assert(host.classList.contains('is-sticker-pressed') && !host.classList.contains('is-dragging'), 'Pressing a sticker in Preview fully flattens its corner without starting a drag');
    assert(!mesh().castShadow && geometry.attributes.position.array === buffer, 'A fully flattened wall-mounted sticker reuses its buffer and drops the lifted shadow');
    assert(serializeProject(scene.exportProject()) === saved, 'A held press does not change saved curl, placement or project JSON');
    pointer('pointercancel', opaque, host, 999); await render();
    assert(geometry.boundingBox!.max.z === 0, 'An unrelated pointer cannot release the held sticker');
    pointer('pointerup', opaque, window); pointer('lostpointercapture', opaque);
    await wait(() => geometry.boundingBox!.max.z === originalZ);
    assert(!host.classList.contains('is-sticker-pressed') && mesh().castShadow, 'Release outside the sticker restores curl and its shadow; repeated capture loss is harmless');
    pointer('pointerdown', opaque); await wait(() => geometry.boundingBox!.max.z === 0);
    pointer('pointercancel', opaque);
    assert(geometry.boundingBox!.max.z === originalZ, 'Pointer cancellation immediately restores saved geometry');
    pointer('pointerdown', opaque); await wait(() => geometry.boundingBox!.max.z === 0);
    scene.setArrangeMode(true);
    assert(geometry.boundingBox!.max.z === originalZ && !host.classList.contains('is-sticker-pressed'), 'Returning to Arrange cancels the temporary press');
    pointer('pointerdown', opaque); await render();
    assert(host.classList.contains('is-dragging') && !host.classList.contains('is-sticker-pressed'), 'Arrange keeps ordinary image dragging instead of flattening');
    pointer('pointerup', opaque, window);
    scene.setArrangeMode(false);
    await scene.updateItem({ ...item, offset: 0.05 }); await render();
    pointer('pointerdown', opaque); await wait(() => mesh().geometry.boundingBox!.max.z === 0);
    assert(root().position.z === 0.05 && mesh().castShadow, 'Pressing a floating sticker flattens the sheet at its existing offset');
    // The real API restores loaded geometry even when a pointer remains held.
    await scene.loadProject(JSON.parse(saved)); await render();
    assert(mesh().geometry.boundingBox!.max.z > 0 && !host.classList.contains('is-sticker-pressed'), 'Loading a project clears a held press');
    pointer('pointerdown', opaque, host, 151, 'mouse'); await wait(() => mesh().geometry.boundingBox!.max.z === 0);
    pointer('lostpointercapture', opaque, host, 151, 'mouse');
    // Clear the hover target after mouse release so the exact saved curl can settle.
    host.dispatchEvent(new PointerEvent('pointerleave'));
    await wait(() => mesh().geometry.boundingBox!.max.z === originalZ);
    assert(!host.classList.contains('is-sticker-pressed'), 'Chrome-style lost capture releases mouse presses safely');
    pointer('pointerdown', opaque); await wait(() => mesh().geometry.boundingBox!.max.z === 0);
    scene.removeItem(item.id); await render();
    assert(!host.classList.contains('is-sticker-pressed'), 'Removing a held sticker clears its pointer state');
  } finally {
    scene.removeItem(item.id); scene.setArrangeMode(arrange); host.setPointerCapture = capture; host.style.cssText = style;
  }
}
