import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { easeHover, hoverFalloff, hoverRegion } from '../src/sticker-hover.ts';
import { StickerSurface } from '../src/sticker.ts';
import { STICKER_CORNERS, defaultSticker } from '../src/project.ts';
import { STICKER } from '../src/config.ts';
import type { RenderedItem } from '../src/content.ts';

test('hover has smooth bounded falloff and removes 20% of saved curl at closest approach', () => {
  assert.equal(hoverFalloff(0, 100), 1); assert.equal(hoverFalloff(50, 100), 0.5);
  assert.equal(hoverFalloff(100, 100), 0); assert.equal(hoverFalloff(200, 100), 0);
  assert.equal(70 * (1 - STICKER.hover.strength * hoverFalloff(0, 100)), 56);
});
test('easing is monotonic, frame-rate independent, bounded after pauses and eventually sleeps', () => {
  const advance = (fps: number) => { let value = 0; for (let i = 0; i < fps; i++) value = easeHover(value, 1, 1 / fps); return value; };
  assert.ok(Math.abs(advance(60) - advance(120)) < 1e-12);
  assert.equal(easeHover(0, 1, 100), easeHover(0, 1, STICKER.hover.maxDelta));
  assert.equal(easeHover(0.4, 1, -1), 0.4);
  let value = 0;
  for (let i = 0; i < 600; i++) { const next = easeHover(value, 1, 1 / 60); assert.ok(next >= value && next <= 1); value = next; }
  assert.equal(value, 1);
  for (let i = 0; i < 600; i++) { const next = easeHover(value, 0, 1 / 60); assert.ok(next <= value && next >= 0); value = next; }
  assert.equal(value, 0);
  for (let i = 0; i < 100; i++) { const target = i % 2; value = easeHover(value, target, 1 / 60); assert.ok(value >= 0 && value <= 1); }
});
test('hover anchors stay on the saved shape for every corner, rotation and image size', () => {
  const camera = new THREE.PerspectiveCamera(40, 2, 0.01, 30); camera.position.z = 1.45; camera.updateMatrixWorld();
  for (const width of [0.05, 0.4, 1.5]) for (const corner of STICKER_CORNERS) for (const angle of [0, 45, -120]) {
    const bounds = { minX: -width / 2, maxX: width / 2, minY: -width / 4, maxY: width / 4 };
    const surface = new StickerSurface(width, width / 2, bounds), root = new THREE.Group();
    root.rotation.z = THREE.MathUtils.degToRad(angle); root.updateMatrixWorld();
    const sticker = { ...defaultSticker(), corner };
    const node = { root, record: { kind: 'image', treatment: 'sticker', sticker }, image: { surface, bounds } } as unknown as RenderedItem;
    const before = hoverRegion(node, camera, 800, 400)!;
    surface.update({ ...sticker, curl: sticker.curl * 0.8 }, true);
    assert.deepEqual(hoverRegion(node, camera, 800, 400), before);
    assert.ok(before.radius >= 48 && before.radius <= 140);
    assert.ok([before.x, before.y].every(Number.isFinite));
    surface.geometry.dispose();
  }
});

test('controller honors reduced motion, overlays, presses, lifecycle and overlapping stickers', async () => {
  const { createStickerHover } = await import('../src/sticker-hover.ts');
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const media = Object.assign(new EventTarget(), { matches: false });
  const win = Object.assign(new EventTarget(), { matchMedia: () => media });
  const canvas = {};
  let top: unknown = canvas, preview = true, invalidations = 0;
  const doc = Object.assign(new EventTarget(), { hidden: false, elementFromPoint: () => top });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const container = Object.assign(new EventTarget(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }), classList: { contains: () => false } });
  const camera = new THREE.PerspectiveCamera(40, 2, 0.01, 30); camera.position.z = 1.45; camera.updateMatrixWorld();
  const surfaces: StickerSurface[] = [];
  const nodes = new Map<string, RenderedItem>();
  for (const id of ['a', 'b', 'flat', 'zero']) {
    const bounds = { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 }, root = new THREE.Group(); root.updateMatrixWorld();
    const surface = new StickerSurface(0.4, 0.4, bounds); surfaces.push(surface);
    nodes.set(id, { root, record: { id, kind: 'image', treatment: id === 'flat' ? 'flat' : 'sticker', sticker: { ...defaultSticker(), curl: id === 'zero' ? 0 : 70 } }, image: { surface, bounds, hoverInfluence: 0 } } as unknown as RenderedItem);
  }
  const content = { nodes, setHoverInfluence(node: RenderedItem, amount: number) { node.image!.hoverInfluence = amount; } };
  const hover = createStickerHover(container as unknown as HTMLElement, canvas as HTMLCanvasElement, camera, content as never, () => preview, () => invalidations++);
  const region = hoverRegion(nodes.get('a')!, camera, 800, 400)!;
  const pointer = (type = 'pointermove', buttons = 0, pointerType = 'mouse') => win.dispatchEvent(Object.assign(new Event(type), {
    isPrimary: true, pointerId: 1, buttons, pointerType, clientX: region.x, clientY: region.y,
  }));
  const settle = () => { let moving = false; for (let i = 0; i < 600; i++) moving = hover.advance(1 / 60); assert.equal(moving, false); };
  const amount = (id = 'a') => nodes.get(id)!.image!.hoverInfluence;
  try {
    pointer(); settle(); assert.equal(amount(), 1); assert.equal(amount('b'), 1);
    assert.equal(amount('flat'), 0); assert.equal(amount('zero'), 0);
    top = {}; pointer(); settle(); assert.equal(amount(), 0);
    top = canvas; pointer(); settle(); media.matches = true; media.dispatchEvent(new Event('change'));
    assert.equal(amount(), 0); const count = invalidations; pointer(); settle(); assert.equal(amount(), 0); assert.equal(invalidations, count);
    media.matches = false; media.dispatchEvent(new Event('change')); pointer('pointermove', 0, 'touch'); settle(); assert.equal(amount(), 0);
    pointer('pointermove', 0, 'pen'); settle(); assert.equal(amount(), 1);
    pointer('pointerdown', 1); settle(); assert.equal(amount(), 0);
    pointer('lostpointercapture', 0); settle(); assert.equal(amount(), 1);
    doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(amount(), 0);
    doc.hidden = false; pointer(); settle(); win.dispatchEvent(new Event('blur')); assert.equal(amount(), 0);
    pointer(); settle(); preview = false; hover.reset(); assert.equal(amount(), 0); pointer(); settle(); assert.equal(amount(), 0);
    preview = true; pointer(); settle(); nodes.delete('a'); hover.advance(1 / 60);
    hover.dispose(); assert.equal(amount('b'), 0); const disposedCount = invalidations; pointer(); assert.equal(invalidations, disposedCount);
  } finally {
    hover.dispose(); surfaces.forEach((surface) => surface.geometry.dispose());
    if (savedWindow) Object.defineProperty(globalThis, 'window', savedWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});
