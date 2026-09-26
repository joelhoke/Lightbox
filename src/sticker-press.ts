import { STICKER } from './config.ts';
import type { ContentLayer, RenderedItem } from './content.ts';

export function easePress(current: number, target: number, elapsed: number, reducedMotion: boolean) {
  if (reducedMotion) return target;
  const time = target > current ? STICKER.press.flattenTime : STICKER.press.releaseTime;
  const next = target + (current - target) * Math.exp(-Math.max(0, Math.min(elapsed, STICKER.press.maxDelta)) / time);
  return Math.abs(next - target) <= STICKER.press.settleEpsilon ? target : next;
}

/** Pressing is a temporary shape override; neither the record nor wall offset changes. */
export function createStickerPress(container: HTMLElement, canvas: HTMLCanvasElement, content: ContentLayer,
  isPreview: () => boolean, pick: (event: PointerEvent) => RenderedItem | null, invalidate: () => void) {
  const events = new AbortController(), reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const states = new Map<string, { node: RenderedItem; record: RenderedItem['record']; amount: number }>();
  let held: { pointerId: number; node: RenderedItem } | null = null;
  function release() {
    if (!held) return;
    const { pointerId } = held; held = null;
    container.classList.remove('is-sticker-pressed');
    if (container.hasPointerCapture(pointerId)) container.releasePointerCapture(pointerId);
    invalidate();
  }
  function reset() {
    release();
    for (const [id, state] of states) if (content.nodes.get(id) === state.node) content.setPressInfluence(state.node, 0);
    states.clear(); invalidate();
  }
  container.addEventListener('pointerdown', (event) => {
    if (!isPreview() || held || event.button !== 0 || !event.isPrimary || (event.target !== canvas && event.target !== container)) return;
    const node = pick(event);
    if (node?.record.kind !== 'image' || node.record.treatment !== 'sticker' || !node.record.sticker?.curl) return;
    held = { pointerId: event.pointerId, node };
    if (!states.has(node.record.id)) states.set(node.record.id, { node, record: node.record, amount: 0 });
    container.setPointerCapture(event.pointerId);
    container.classList.add('is-sticker-pressed');
    // Reduced motion still provides the requested interaction, without animation.
    if (reduced.matches) { states.get(node.record.id)!.amount = 1; content.setPressInfluence(node, 1); }
    event.preventDefault(); event.stopImmediatePropagation(); invalidate();
  }, { capture: true, signal: events.signal });
  container.addEventListener('pointermove', (event) => {
    if (held?.pointerId !== event.pointerId) return;
    if (!event.buttons) release();
    event.preventDefault(); event.stopImmediatePropagation();
  }, { capture: true, signal: events.signal });
  window.addEventListener('pointerup', (event) => { if (held?.pointerId === event.pointerId) release(); }, { capture: true, signal: events.signal });
  container.addEventListener('lostpointercapture', (event) => { if (held?.pointerId === event.pointerId) release(); }, { signal: events.signal });
  container.addEventListener('pointercancel', (event) => { if (held?.pointerId === event.pointerId) reset(); }, { signal: events.signal });
  window.addEventListener('blur', reset, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); }, { signal: events.signal });
  reduced.addEventListener('change', reset, { signal: events.signal });
  return {
    reset,
    advance(elapsed: number) {
      let moving = false;
      for (const [id, state] of states) {
        if (!isPreview() || content.nodes.get(id) !== state.node || state.node.record !== state.record) {
          if (held?.node === state.node) release();
          if (content.nodes.get(id) === state.node) content.setPressInfluence(state.node, 0);
          states.delete(id); continue;
        }
        const target = held?.node === state.node ? 1 : 0;
        state.amount = easePress(state.amount, target, elapsed, reduced.matches);
        content.setPressInfluence(state.node, state.amount);
        if (state.amount !== target) moving = true;
        if (!target && !state.amount) states.delete(id);
      }
      return moving;
    },
    dispose() { reset(); events.abort(); },
  };
}
