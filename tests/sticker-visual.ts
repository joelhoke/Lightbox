import '../src/style.css';
import { createLightingScene } from '../src/scene.ts';
import { createControls } from '../src/controls.ts';
import { createEditor } from '../src/editor.ts';
import { createTextItem, defaultSticker } from '../src/project.ts';
import { stickerBitmap } from './sticker-fixture.ts';
const host = document.querySelector<HTMLElement>('#scene')!;
const scene = createLightingScene(host);
const controls = createControls(document.querySelector('#controls')!, scene);
const editor = createEditor(document.querySelector('#editor')!, host, scene);
host.addEventListener('study-change', () => controls.refresh());
await scene.ready;
const narrow = host.clientWidth < 600;
scene.updateSettings({ wallColor: '#626966', temperature: 3600 });
await scene.addItem({ ...createTextItem(), text: 'Peel & play.', treatment: 'solid', x: narrow ? 0 : -0.24, y: -0.34, size: narrow ? 0.032 : 0.045, offset: 0.025 });
await scene.addItem({ id: 'fade-sticker', kind: 'image', imageData: stickerBitmap('card'), width: narrow ? 0.16 : 0.27, x: 0.14, y: narrow ? 0.14 : 0.02, offset: 0.03, alt: 'Padded card with a hole and soft alpha fade', treatment: 'sticker', sticker: { ...defaultSticker(), corner: 'top-left', curl: 100, peelArea: 65 }, rotation: -16 });
await scene.addItem({ id: 'flower-sticker', kind: 'image', imageData: stickerBitmap(), width: narrow ? 0.29 : 0.42, x: narrow ? -0.08 : -0.22, y: -0.07, offset: 0, alt: 'Circular flower sticker', treatment: 'sticker', sticker: { ...defaultSticker(), curl: 100, peelArea: 65 }, rotation: 12 });
document.querySelectorAll<HTMLDetailsElement>('details').forEach((panel) => { panel.open = false; });
document.querySelector<HTMLElement>('#status')!.hidden = true;
if (new URLSearchParams(location.search).has('hover')) {
  scene.setArrangeMode(false);
  document.querySelector('h1')!.textContent = 'Sticker hover study';
  document.querySelector('.study-label p')!.textContent = 'Move near a curled corner · Preview mode';
}
if (import.meta.hot) import.meta.hot.dispose(() => { controls.dispose(); editor.dispose(); scene.dispose(); });
