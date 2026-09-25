import * as THREE from 'three';
import type { LightingScene } from '../src/scene.ts';
import { CONTENT, VIEW } from '../src/config.ts';
import { defaultSticker, serializeProject, STICKER_CORNERS } from '../src/project.ts';
import type { ImageItem } from '../src/project.ts';
import { stickerBitmap } from './sticker-fixture.ts';

export async function checkStickers(scene: LightingScene, host: HTMLElement, editor: HTMLElement, assert: (condition: unknown, message: string) => void, filament: (label: string) => Promise<void>) {
  const item: ImageItem = { id: 'sticker-check', kind: 'image', imageData: stickerBitmap('card'), width: 0.6,
    x: -0.25, y: -0.08, offset: 0, alt: 'Sticker check', treatment: 'sticker', rotation: 0, sticker: defaultSticker() };
  await scene.addItem(item);
  const root = scene.contentGroup.getObjectByName(`content-${item.id}`)!;
  const mesh = root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const geometry = mesh.geometry, texture = mesh.material.map, buffer = geometry.attributes.position.array;
  const get = () => scene.items.find((value) => value.id === item.id) as ImageItem;
  const render = () => new Promise<void>((resolve) => { host.addEventListener('study-render', () => resolve(), { once: true }); scene.invalidate(); });
  for (const corner of STICKER_CORNERS) for (const curl of [0, 70, 100]) for (const peelArea of [10, 75]) {
    scene.updateImageSticker(item.id, { corner, curl, peelArea });
    assert(geometry.boundingBox!.max.z >= 0 && mesh.castShadow === (curl > 0), `${corner} curl ${curl} / area ${peelArea}: finite shape and mounted shadow state`);
  }
  for (let i = 0; i < 3; i++) await filament(`Curled sticker frame ${i + 1}`);
  scene.updateImageSticker(item.id, { ...defaultSticker(), rotation: 35 });
  await render();
  assert(mesh.geometry === geometry && geometry.attributes.position.array === buffer && mesh.material.map === texture, 'Live sticker edits reuse geometry buffers and the decoded image texture');
  assert(Math.abs(root.rotation.z + THREE.MathUtils.degToRad(35)) < 1e-8, 'Clockwise rotation is applied to the image and deformed surface together');
  assert(host.querySelectorAll('.sticker-handle:not([hidden])').length === 4, 'Selected sticker has four visible corner handles');
  const leaked = get(); leaked.sticker!.curl = 5;
  assert(get().sticker!.curl === 70, 'Public records cannot mutate nested sticker settings');

  const live = (key: string, value: string) => {
    const input = editor.querySelector<HTMLInputElement>(`[data-image-setting="${key}"]`)!;
    input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  live('rotation', '-45'); live('curl', '85'); live('peelArea', '60');
  assert(get().rotation === -45 && get().sticker!.curl === 85 && get().sticker!.peelArea === 60, 'Inspector rotation, curl and area update live without Apply');
  const numeric = editor.querySelector<HTMLInputElement>('input[type="number"][data-image-setting="curl"]')!;
  numeric.value = '101'; numeric.dispatchEvent(new Event('input', { bubbles: true }));
  assert(get().sticker!.curl === 85, 'Invalid numeric curl leaves the last valid shape applied');
  live('curl', '70');
  scene.updateImageSticker(item.id, { treatment: 'flat' }); await render();
  assert(geometry.boundingBox!.max.z === 0 && !mesh.castShadow && host.querySelectorAll('.sticker-handle:not([hidden])').length === 0, 'Flat treatment removes deformation, mounted shadows and handles');
  scene.updateImageSticker(item.id, { treatment: 'sticker' }); await render();
  assert(get().sticker!.curl === 70 && geometry.boundingBox!.max.z > 0, 'Switching back to Sticker restores its retained curl');
  scene.setArrangeMode(false); await render();
  assert(host.querySelectorAll('.sticker-handle:not([hidden])').length === 0, 'Preview hides all sticker handles');
  scene.setArrangeMode(true); await render();

  // Compare actual front/back pixels using the same PNG: backside must be neutral,
  // and retain its transparent hole/fade rather than showing mirrored artwork.
  const originalSettings = scene.settings;
  scene.updateSettings({ lightMode: 'custom', customLightColor: '#ffffff', brightness: 100 });
  scene.updateImageSticker(item.id, { curl: 0, rotation: 0 });
  const canvas = host.querySelector('canvas')!;
  const capture = document.createElement('canvas'); capture.width = canvas.width; capture.height = canvas.height;
  const ctx = capture.getContext('2d')!;
  const pixels = () => new Promise<Uint8ClampedArray>((resolve) => {
    host.addEventListener('study-render', () => { ctx.drawImage(canvas, 0, 0); resolve(ctx.getImageData(0, 0, capture.width, capture.height).data); }, { once: true }); scene.invalidate();
  });
  const camera = new THREE.PerspectiveCamera(VIEW.fieldOfView, host.clientWidth / host.clientHeight, 0.01, 30);
  camera.position.z = VIEW.cameraZ; camera.updateMatrixWorld();
  const sample = (data: Uint8ClampedArray, x: number, y: number) => {
    const p = root.localToWorld(new THREE.Vector3(x, y, 0)).project(camera);
    const index = (Math.round((1 - p.y) * capture.height / 2) * capture.width + Math.round((p.x + 1) * capture.width / 2)) * 4;
    return Array.from(data.slice(index, index + 3));
  };
  const front = await pixels(), frontColor = sample(front, -0.14, 0.12);
  root.rotation.y = Math.PI; root.updateWorldMatrix(true, true);
  const back = await pixels(), backColor = sample(back, -0.14, 0.12);
  assert(frontColor[2] > frontColor[0] + 15 && Math.max(...backColor) - Math.min(...backColor) < 35,
    `Backside pixels use plain warm-white instead of mirrored artwork (front ${frontColor}; back ${backColor})`);
  const hole = sample(back, -0.12, -0.09);
  assert(backColor.reduce((a, b) => a + b) > hole.reduce((a, b) => a + b) + 50, 'Transparent hole remains open through the backing');
  root.rotation.y = 0; root.updateWorldMatrix(true, true);
  scene.updateImageSticker(item.id, { corner: 'top-left', curl: 100, peelArea: 75 });
  const curled = await pixels();
  const position = geometry.attributes.position, index = geometry.index!;
  const ray = new THREE.Raycaster(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let testedBack = 0, neutralBack = 0;
  for (let i = 0; i < index.count && testedBack < 20; i += 3) {
    a.fromBufferAttribute(position, index.getX(i)); b.fromBufferAttribute(position, index.getX(i + 1)); c.fromBufferAttribute(position, index.getX(i + 2));
    const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    const world = root.localToWorld(center.clone());
    if (normal.dot(camera.position.clone().sub(world)) >= 0) continue;
    const uv = geometry.attributes.uv;
    const u = (uv.getX(index.getX(i)) + uv.getX(index.getX(i + 1)) + uv.getX(index.getX(i + 2))) / 3;
    const v = (uv.getY(index.getX(i)) + uv.getY(index.getX(i + 1)) + uv.getY(index.getX(i + 2))) / 3;
    const bitmap = texture!.image as HTMLCanvasElement;
    if (bitmap.getContext('2d')!.getImageData(Math.floor(u * bitmap.width), Math.floor((1 - v) * bitmap.height), 1, 1).data[3] < 240) continue;
    ray.set(camera.position, world.clone().sub(camera.position).normalize());
    const hit = ray.intersectObject(mesh)[0];
    if (!hit || hit.point.distanceTo(world) > 0.0001) continue;
    const p = world.project(camera);
    const pixel = (Math.round((1 - p.y) * capture.height / 2) * capture.width + Math.round((p.x + 1) * capture.width / 2)) * 4;
    const rgb = Array.from(curled.slice(pixel, pixel + 3));
    testedBack++; if (Math.max(...rgb) - Math.min(...rgb) < 35) neutralBack++;
  }
  assert(testedBack > 0 && neutralBack > 0, `Curled corner exposes visible plain backing pixels (${neutralBack}/${testedBack})`);
  scene.updateSettings(originalSettings);

  // Synthetic touch pointers exercise rotation-aware geometry and gesture routing.
  scene.updateImageSticker(item.id, { ...defaultSticker(), rotation: 45 }); await render();
  const handle = host.querySelector<HTMLButtonElement>('[data-sticker-corner="bottom-right"]')!;
  const box = handle.getBoundingClientRect(), start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const capturePointer = host.setPointerCapture; host.setPointerCapture = () => {};
  const pointer = (target: EventTarget, type: string, x: number, y: number) => target.dispatchEvent(new PointerEvent(type, {
    bubbles: true, pointerId: 93, isPrimary: true, pointerType: 'touch', button: 0,
    buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0, clientX: x, clientY: y,
  }));
  try {
    pointer(handle, 'pointerdown', start.x, start.y);
    // A clockwise 45° rotation sends this corner's inward diagonal straight up.
    pointer(host, 'pointermove', start.x, start.y - 25);
    assert(get().sticker!.curl > 70 && get().x === item.x && get().y === item.y, 'Rotated handle dragging changes curl without moving the image');
    pointer(host, 'pointercancel', start.x, start.y - 25);
    assert(get().sticker!.curl === 70 && !host.classList.contains('is-dragging'), 'Pointer cancellation restores the complete starting curl');
    pointer(handle, 'pointerdown', start.x, start.y);
    pointer(host, 'pointermove', start.x + 30, start.y);
    assert(get().sticker!.curl === 70, 'Movement perpendicular to the rotated diagonal is ignored');
    pointer(host, 'pointermove', start.x, start.y - 20);
    pointer(window, 'pointerup', start.x, start.y - 20);
    assert(get().sticker!.curl > 70 && !host.classList.contains('is-dragging'), 'Release outside the handle keeps the edited curl');
    const beforeKey = get().sticker!.curl;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert(get().sticker!.curl === beforeKey - 1, 'Corner handles also support keyboard curl adjustment');
    scene.updateImageSticker(item.id, { rotation: 0, curl: 0 }); await render();
    const p = root.localToWorld(new THREE.Vector3(-0.15, 0.15, 0)).project(camera), rect = host.getBoundingClientRect();
    const x = rect.left + (p.x + 1) * rect.width / 2, y = rect.top + (1 - p.y) * rect.height / 2;
    pointer(host, 'pointerdown', x, y); pointer(host, 'pointermove', x + 20, y + 10); pointer(window, 'pointerup', x + 20, y + 10);
    assert(get().x > item.x + 0.01 && get().y < item.y - 0.01, 'Dragging away from handles moves the whole sticker');
    scene.updateImageSticker(item.id, { ...defaultSticker(), rotation: 45 });

  } finally { host.setPointerCapture = capturePointer; }

  const saved = serializeProject(scene.exportProject());
  await scene.loadProject(JSON.parse(saved));
  assert(serializeProject(scene.exportProject()) === saved && scene.exportProject().version === 2, 'Version 2 round-trips the curled, rotated sticker');
  const invalid = scene.exportProject();
  (invalid.items.find((value) => value.id === item.id) as ImageItem).sticker!.peelArea = 100;
  let rejected = false; try { await scene.loadProject(invalid); } catch { rejected = true; }
  assert(rejected && serializeProject(scene.exportProject()) === saved, 'Invalid sticker imports cannot partially replace the composition');
  const legacy = { ...scene.exportProject(), version: 1 }; await scene.loadProject(legacy);
  assert(get().treatment === 'flat' && get().rotation === 0, 'Version 1 project images migrate to Flat at zero rotation');
  await scene.loadProject(JSON.parse(saved));
  for (let i = 0; i < 3; i++) {
    const current = scene.contentGroup.getObjectByName(`content-${item.id}`)!.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
    let geometryDisposed = false, textureDisposed = false, materialDisposed = false;
    current.geometry.addEventListener('dispose', () => { geometryDisposed = true; });
    current.material.map!.addEventListener('dispose', () => { textureDisposed = true; });
    current.material.addEventListener('dispose', () => { materialDisposed = true; });
    scene.removeItem(item.id);
    assert(geometryDisposed && textureDisposed && materialDisposed, `Sticker removal ${i + 1} disposes geometry, texture and material`);
    if (i < 2) await scene.addItem(item);
  }
  assert(!host.querySelector(`[data-item-id="${item.id}"]:not([hidden])`), 'Removed stickers leave no active handles');
  // Maintain the original suite's composition and selected image for later checks.
  scene.resetBulb();
}
