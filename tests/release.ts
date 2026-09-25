import '../src/style.css';
import { createLightingScene } from '../src/scene.ts';
import { createControls } from '../src/controls.ts';
import { createEditor } from '../src/editor.ts';
const host = document.querySelector<HTMLElement>('#scene')!;
const scene = createLightingScene(host);
const controls = createControls(document.querySelector('#controls')!, scene);
const editor = createEditor(document.querySelector('#editor')!, host, scene);
const log = document.querySelector('#event-log')!;
const rows: string[] = [];
const events = new AbortController();
const fixture = scene.contentGroup.parent!.parent!.getObjectByName('hanging-fixture')!;
function record(message: string) {
  rows.push(message); while (rows.length > 10) rows.shift();
  log.replaceChildren(...rows.map((text) => { const row = document.createElement('div'); row.textContent = text; return row; }));
}
for (const name of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
  document.addEventListener(name, (event) => {
    const p = event as PointerEvent;
    if (name === 'pointermove' && !p.buttons) return;
    record(`${name} id=${p.pointerId} buttons=${p.buttons} client=${p.clientX},${p.clientY} target=${(p.target as Element).id || (p.target as Element).tagName} motion=${scene.motionEnabled} dragging=${host.classList.contains('is-dragging')} x=${fixture.position.x.toFixed(3)} y=${fixture.position.y.toFixed(3)}`);
  }, { signal: events.signal });
}
window.addEventListener('blur', () => record('window blur'), { signal: events.signal });
document.addEventListener('visibilitychange', () => record(`visibility=${document.visibilityState}`), { signal: events.signal });
host.addEventListener('study-change', () => controls.refresh(), { signal: events.signal });
await scene.ready;
document.querySelector<HTMLElement>('#status')!.hidden = true;
record(`ready; motion=${scene.motionEnabled}; reduced=${matchMedia('(prefers-reduced-motion: reduce)').matches}`);
if (import.meta.hot) import.meta.hot.dispose(() => { events.abort(); editor.dispose(); controls.dispose(); scene.dispose(); });
