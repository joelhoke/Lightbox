import './style.css';
import { createLightingScene } from './scene.ts';
import { createControls } from './controls.ts';
import { createEditor } from './editor.ts';

const container = document.querySelector<HTMLElement>('#scene')!;
const controlsContainer = document.querySelector<HTMLElement>('#controls')!;
const editorContainer = document.querySelector<HTMLElement>('#editor')!;
const status = document.querySelector<HTMLElement>('#status')!;
let scene: ReturnType<typeof createLightingScene> | undefined;
let controls: ReturnType<typeof createControls> | undefined;
let editor: ReturnType<typeof createEditor> | undefined;
let failed = false;
let disposed = false;
const lifecycle = new AbortController();

function showError(message: string) {
  failed = true;
  status.hidden = false;
  status.classList.add('is-error');
  status.setAttribute('role', 'alert');
  status.replaceChildren();
  const text = document.createElement('p');
  text.textContent = message;
  const retry = document.createElement('button');
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => window.location.reload(), { once: true });
  status.append(text, retry);
}

function onSceneError(event: Event) {
  showError((event as CustomEvent<string>).detail);
}
container.addEventListener('lighting-error', onSceneError, { signal: lifecycle.signal });

try {
  scene = createLightingScene(container);
  controls = createControls(controlsContainer, scene);
  editor = createEditor(editorContainer, container, scene);
  controlsContainer.querySelector('details')!.open = false;
  // One section open at a time keeps long inspectors usable on smaller screens.
  document.querySelectorAll<HTMLDetailsElement>('#workspace-tools details').forEach((panel) => {
    panel.addEventListener('toggle', () => {
      if (panel.open) document.querySelectorAll<HTMLDetailsElement>('#workspace-tools details').forEach((other) => { if (other !== panel) other.open = false; });
    }, { signal: lifecycle.signal });
  });
  scene.ready.then(() => {
    if (!disposed && !failed) status.hidden = true;
  }).catch((error: unknown) => {
    if (disposed) return;
    console.error('Unable to load the Edison bulb.', error);
    showError('The bulb could not be loaded. Check your connection and try again.');
  });
} catch (error) {
  console.error('Unable to initialize the light study.', error);
  showError('This light study needs WebGL 2. Try a current browser with hardware acceleration enabled.');
}

function dispose() {
  if (disposed) return;
  disposed = true;
  lifecycle.abort();
  controls?.dispose();
  editor?.dispose();
  scene?.dispose();
  container.removeEventListener('lighting-error', onSceneError);
}

container.addEventListener('study-change', () => controls?.refresh(), { signal: lifecycle.signal });
editorContainer.addEventListener('study-project-loaded', () => controls?.refresh(true), { signal: lifecycle.signal });

// Keep a page restored from the back/forward cache usable.
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: lifecycle.signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
