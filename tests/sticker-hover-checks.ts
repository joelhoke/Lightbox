import * as THREE from 'three';
import type { LightingScene } from '../src/scene.ts';
import type { ImageItem } from '../src/project.ts';
import { defaultSticker, serializeProject } from '../src/project.ts';
import { VIEW } from '../src/config.ts';
import { StickerSurface, visibleBounds, cornerPoint, bendPoint } from '../src/sticker.ts';
import { stickerBitmap } from './sticker-fixture.ts';

export async function checkStickerHover(scene: LightingScene, host: HTMLElement, assert: (condition: unknown, message: string) => void) {
  const style = host.style.cssText, originalArrange = scene.arrangeMode;
  host.style.cssText += ';position:fixed;left:20px;top:80px;z-index:10000';
  const item: ImageItem = { id: 'hover-check', kind: 'image', imageData: stickerBitmap('card'), alt: 'Hover comparison',
    width: 0.4, x: -0.24, y: -0.12, offset: 0, treatment: 'sticker', sticker: defaultSticker(), rotation: 30 };
  let expected: StickerSurface | undefined;
  const frames = () => new Promise<void>((resolve) => { host.addEventListener('study-render', () => resolve(), { once: true }); scene.invalidate(); });
  const waitFor = async (condition: () => boolean, label: string) => {
    const start = performance.now();
    while (!condition()) { if (performance.now() - start > 5000) throw new Error(`${label} timed out; keep test tab visible`); await new Promise((resolve) => setTimeout(resolve, 25)); }
  };
  const event = (type: string, x: number, y: number, pointerType = 'mouse', buttons = 0, target: EventTarget = host) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, isPrimary: true, pointerId: 121, pointerType, buttons, button: buttons ? 0 : -1, clientX: x, clientY: y,
  }));
  try {
    await scene.addItem(item); await frames();
    const root = scene.contentGroup.getObjectByName(`content-${item.id}`)!;
    const mesh = root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    const positions = mesh.geometry.attributes.position.array;
    const original = positions.slice(), texture = mesh.material.map!, bitmap = texture.image as HTMLCanvasElement;
    const bounds = visibleBounds(bitmap.getContext('2d')!.getImageData(0, 0, bitmap.width, bitmap.height).data, bitmap.width, bitmap.height, item.width, item.width);
    expected = new StickerSurface(item.width, item.width, bounds); expected.update({ ...defaultSticker(), curl: 56 }, true);
    const relaxed = expected.geometry.attributes.position.array;
    const difference = (other: ArrayLike<number>) => { let max = 0; for (let i = 0; i < positions.length; i++) max = Math.max(max, Math.abs(positions[i] - other[i])); return max; };
    const camera = new THREE.PerspectiveCamera(VIEW.fieldOfView, host.clientWidth / host.clientHeight, 0.01, 30);
    camera.position.z = VIEW.cameraZ; camera.updateMatrixWorld(); root.updateWorldMatrix(true, true);
    const p = cornerPoint(bounds, item.sticker!.corner); bendPoint(p.x, p.y, bounds, item.sticker!, p);
    root.localToWorld(p).project(camera);
    const rect = host.getBoundingClientRect(), x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2;
    const move = (pointerType = 'mouse') => event('pointermove', x, y, pointerType);
    scene.setArrangeMode(true); move(); await frames();
    assert(difference(original) === 0, 'Arrange mode ignores decorative sticker hover');
    scene.setArrangeMode(false);
    const saved = serializeProject(scene.exportProject());
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    move();
    if (reduced) {
      await frames(); assert(difference(original) === 0, 'Reduced-motion preference disables sticker hover');
    } else {
      await waitFor(() => difference(relaxed) < 1e-6, 'Hover approach');
      assert(difference(original) > 0.001 && mesh.geometry.attributes.position.array === positions && mesh.material.map === texture, 'Preview hover relaxes 70% curl to 56% using the same geometry and texture');
      assert(serializeProject(scene.exportProject()) === saved, 'Hover leaves saved curl, inspector records and project JSON unchanged');
      let renders = 0; const count = () => renders++; host.addEventListener('study-render', count);
      await new Promise((resolve) => setTimeout(resolve, 180)); const settledCount = renders;
      await new Promise((resolve) => setTimeout(resolve, 180)); host.removeEventListener('study-render', count);
      assert(renders === settledCount, 'A stationary cursor settles back to rendering only on changes');
      event('pointerleave', x, y);
      await waitFor(() => difference(original) === 0, 'Hover return');
      assert(difference(original) === 0, 'Leaving the sticker gently restores its exact saved shape');
      move('touch'); await frames(); assert(difference(original) === 0, 'Touch movement never activates hover');
      move('pen'); await waitFor(() => difference(relaxed) < 1e-6, 'Pen hover');
      assert(difference(original) > 0.001, 'Hovering pen input is supported');
      event('pointerdown', x, y, 'pen', 1, window);
      await waitFor(() => difference(original) === 0, 'Press suppression');
      assert(difference(original) === 0, 'A pointer press suppresses decorative hover');
      event('pointerup', x, y, 'pen', 0, window);
      await waitFor(() => difference(relaxed) < 1e-6, 'Release hover');
      const overlay = document.createElement('div'); overlay.textContent = 'HTML selection overlay';
      Object.assign(overlay.style, { position: 'fixed', left: `${x - 20}px`, top: `${y - 20}px`, width: '100px', height: '40px', zIndex: '10001' }); document.body.append(overlay);
      event('pointermove', x, y, 'mouse', 0, overlay);
      await waitFor(() => difference(original) === 0, 'HTML suppression'); overlay.remove();
      assert(difference(original) === 0, 'HTML overlays suppress hover without intercepting their text selection');
      move(); await waitFor(() => difference(relaxed) < 1e-6, 'Hover before arrange');
      scene.setArrangeMode(true);
      assert(difference(original) === 0, 'Leaving Preview restores the saved geometry immediately');
      scene.setArrangeMode(false); move(); await waitFor(() => difference(relaxed) < 1e-6, 'Hover before blur');
      window.dispatchEvent(new Event('blur'));
      assert(difference(original) === 0, 'Window blur clears temporary curl');
      move(); await waitFor(() => difference(relaxed) < 1e-6, 'Hover before load');
      await scene.loadProject(JSON.parse(saved)); await frames();
      const loaded = scene.contentGroup.getObjectByName(`content-${item.id}`)!.children[0] as THREE.Mesh;
      assert(Array.from(loaded.geometry.attributes.position.array).every((value, i) => value === original[i]), 'Project loading restores saved curl without residual hover');
    }
    scene.removeItem(item.id); await frames();
    assert(!scene.contentGroup.getObjectByName(`content-${item.id}`), 'Hovered sticker removal clears the surface safely');
  } finally {
    expected?.geometry.dispose(); scene.removeItem(item.id); scene.setArrangeMode(originalArrange); host.style.cssText = style;
  }
}
