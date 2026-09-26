import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStickerPress, easePress } from '../src/sticker-press.ts';
import type { RenderedItem } from '../src/content.ts';

test('press easing fully flattens, restores without overshoot and respects reduced motion', () => {
  let amount = 0;
  for (let i = 0; i < 120; i++) { const next = easePress(amount, 1, 1 / 60, false); assert.ok(next >= amount && next <= 1); amount = next; }
  assert.equal(amount, 1);
  for (let i = 0; i < 180; i++) { const next = easePress(amount, 0, 1 / 60, false); assert.ok(next <= amount && next >= 0); amount = next; }
  assert.equal(amount, 0);
  assert.equal(easePress(0, 1, 100, false), easePress(0, 1, 0.05, false));
  assert.equal(easePress(0.2, 1, 0, true), 1); assert.equal(easePress(0.8, 0, 0, true), 0);
});

test('press ownership, release, cancellation, mode changes and cleanup are safe', () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const media = Object.assign(new EventTarget(), { matches: false });
  const win = Object.assign(new EventTarget(), { matchMedia: () => media });
  const doc = Object.assign(new EventTarget(), { hidden: false });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  let captured = false, preview = true, invalidations = 0;
  const classes = new Set<string>();
  const container = Object.assign(new EventTarget(), {
    setPointerCapture: () => { captured = true; }, hasPointerCapture: () => captured, releasePointerCapture: () => { captured = false; },
    classList: { add: (value: string) => classes.add(value), remove: (value: string) => classes.delete(value) },
  });
  const node = { record: { id: 'sticker', kind: 'image', treatment: 'sticker', sticker: { curl: 70 } }, image: { pressInfluence: 0 } } as RenderedItem;
  const nodes = new Map([['sticker', node]]);
  const content = { nodes, setPressInfluence(value: RenderedItem, amount: number) { value.image!.pressInfluence = amount; } };
  const control = createStickerPress(container as unknown as HTMLElement, {} as HTMLCanvasElement, content as never, () => preview, () => node, () => invalidations++);
  const pointer = (type: string, target: EventTarget = container, pointerId = 1) => target.dispatchEvent(Object.assign(new Event(type), { pointerId, isPrimary: true, button: 0, buttons: type === 'pointermove' ? 0 : 1 }));
  const settle = () => { let moving = true; for (let i = 0; i < 200; i++) moving = control.advance(1 / 60); assert.equal(moving, false); };
  try {
    preview = false; pointer('pointerdown'); settle(); assert.equal(node.image!.pressInfluence, 0);
    preview = true; pointer('pointerdown'); settle(); assert.equal(node.image!.pressInfluence, 1); assert.equal(captured, true);
    pointer('pointerup', win, 2); settle(); assert.equal(node.image!.pressInfluence, 1);
    pointer('pointerup', win); pointer('lostpointercapture'); settle(); assert.equal(node.image!.pressInfluence, 0); assert.equal(captured, false);
    pointer('pointerdown'); settle(); pointer('pointercancel'); assert.equal(node.image!.pressInfluence, 0);
    pointer('pointerdown'); settle(); pointer('lostpointercapture'); settle(); assert.equal(node.image!.pressInfluence, 0);
    pointer('pointerdown'); settle(); pointer('pointermove'); settle(); assert.equal(node.image!.pressInfluence, 0);
    pointer('pointerdown'); settle(); preview = false; control.advance(1 / 60); assert.equal(node.image!.pressInfluence, 0);
    preview = true; media.matches = true; pointer('pointerdown'); assert.equal(node.image!.pressInfluence, 1); pointer('pointerup', win); control.advance(1 / 60); assert.equal(node.image!.pressInfluence, 0);
    pointer('pointerdown'); win.dispatchEvent(new Event('blur')); assert.equal(node.image!.pressInfluence, 0);
    pointer('pointerdown'); doc.hidden = true; doc.dispatchEvent(new Event('visibilitychange')); assert.equal(node.image!.pressInfluence, 0); doc.hidden = false;
    pointer('pointerdown'); nodes.delete('sticker'); control.advance(1 / 60); assert.equal(captured, false);
    assert.equal(node.record.kind === 'image' && node.record.sticker!.curl, 70);
    control.dispose(); const count = invalidations; pointer('pointerdown'); assert.equal(invalidations, count); assert.equal(classes.size, 0);
  } finally {
    control.dispose();
    if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else Reflect.deleteProperty(globalThis, 'document');
  }
});
