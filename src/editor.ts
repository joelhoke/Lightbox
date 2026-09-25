import type { LightingScene } from './scene.ts';
import { CONTENT, STICKER } from './config.ts';
import type { NumericRange } from './config.ts';
import { createTextItem, importImage, parseProject, serializeProject, STICKER_CORNERS } from './project.ts';
import type { SceneItem, TextTreatment, ImageStickerPatch, ImageTreatment, StickerCorner } from './project.ts';

function numericField(key: string, label: string, range: NumericRange) {
  return `<label class="inspector-field">${label}<input name="${key}" type="number" min="${range.min}" max="${range.max}" step="${range.step}" required /></label>`;
}
function liveRange(key: string, label: string, range: NumericRange) {
  return `<div class="inspector-field"><label>${label}<input type="range" data-image-setting="${key}" min="${range.min}" max="${range.max}" step="${range.step}" /></label>
    <input aria-label="${label} value" type="number" data-image-setting="${key}" min="${range.min}" max="${range.max}" step="${range.step}" required /></div>`;
}

export function createEditor(host: HTMLElement, sceneHost: HTMLElement, scene: LightingScene) {
  const events = new AbortController();
  let disposed = false;
  let busy = false;
  let renderedSelection: string | null | undefined;
  host.innerHTML = `
    <details class="editor-panel" open>
      <summary><span>Composition <span class="item-count">0</span></span><span aria-hidden="true">⌄</span></summary>
      <div class="editor-body">
        <div class="editor-mode segmented" role="group" aria-label="Interaction mode">
          <label><input type="radio" name="editor-mode" value="arrange" checked /><span>Arrange</span></label>
          <label><input type="radio" name="editor-mode" value="preview" /><span>Preview</span></label>
        </div>
        <div class="editor-actions"><button id="add-text" type="button">+ Text</button><button id="add-image" type="button">+ Image</button></div>
        <input id="image-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
        <p class="editor-help" id="mode-help">Drag the bulb to play. Add something to the wall.</p>
        <div class="item-list" role="group" aria-label="Scene items"></div>
        <form class="inspector" aria-label="Selected item" hidden></form>
        <p class="editor-message" role="status" aria-live="polite" hidden></p>
        <div class="motion-row"><label><input id="motion" type="checkbox" /> Release motion</label><button id="reset-bulb" type="button">Reset bulb</button></div>
        <div class="project-actions"><button id="save-project" type="button">Save project ↓</button><button id="load-project" type="button">Load project ↑</button></div>
        <input id="project-file" type="file" accept="application/json,.json" hidden />
        <p class="local-note">Images stay here. Save a project to keep your work.</p>
      </div>
    </details>`;

  const query = <T extends Element>(selector: string) => host.querySelector<T>(selector)!;
  const inspector = query<HTMLFormElement>('.inspector');
  const message = query<HTMLElement>('.editor-message');
  const imageInput = query<HTMLInputElement>('#image-file');
  const projectInput = query<HTMLInputElement>('#project-file');
  const listen = (element: EventTarget, type: string, listener: EventListener) => element.addEventListener(type, listener, { signal: events.signal });
  function notify(text: string, error = false) {
    message.textContent = text; message.hidden = !text; message.classList.toggle('is-error', error);
  }
  function setBusy(value: boolean) {
    busy = value;
    host.toggleAttribute('aria-busy', value);
    host.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('button, input, select, textarea').forEach((element) => { element.disabled = value; });
  }
  async function work(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); notify('');
    try { await task(); } catch (error) { if (!disposed) notify(error instanceof Error ? error.message : String(error), true); }
    finally { if (!disposed) { setBusy(false); refresh(false); } }
  }

  function renderInspector(item: SceneItem | undefined) {
    renderedSelection = item?.id ?? null;
    inspector.hidden = !item;
    if (!item) { inspector.replaceChildren(); return; }
    inspector.innerHTML = `
      ${item.kind === 'text' ? `
        <label class="inspector-field">Text<textarea name="text" rows="3" maxlength="${CONTENT.maxTextLength}" required></textarea></label>
        <label class="inspector-field">Treatment<select name="treatment"><option value="html">HTML · selectable</option><option value="flat">Flat lit · receives light</option><option value="solid">Solid 3D · casts shadows</option></select></label>
        <p class="treatment-help editor-help"></p>
        <div class="inspector-grid">${numericField('size', 'Text size (m)', CONTENT.size)}<label class="inspector-field">Color<input name="color" type="color" /></label></div>
        <div class="thickness-field">${numericField('thickness', 'Letter thickness (m)', CONTENT.thickness)}</div>
      ` : `<label class="inspector-field">Alternative text<textarea name="alt" rows="2" maxlength="${CONTENT.maxTextLength}"></textarea></label>${numericField('width', 'Width (m) · aspect ratio locked', CONTENT.width)}
        ${liveRange('rotation', 'Rotation (° clockwise)', CONTENT.rotation)}
        <label class="inspector-field">Image treatment<select data-image-setting="treatment"><option value="flat">Flat</option><option value="sticker">Sticker · curled corner</option></select></label>
        <div class="sticker-fields" hidden>
          <label class="inspector-field">Curled corner<select data-image-setting="corner">${STICKER_CORNERS.map((corner) => `<option value="${corner}">${corner.replace('-', ' ')}</option>`).join('')}</select></label>
          ${liveRange('curl', 'Curl amount (%)', STICKER.curl)}${liveRange('peelArea', 'Peel area (%)', STICKER.peelArea)}
          <p class="editor-help">Pull a corner inward to curl it. Arrow keys on a handle adjust curl. Peel area is a percentage of the visible image’s shorter side.</p>
        </div><p class="editor-help">Rotation and sticker controls apply immediately.</p>`}
      <div class="inspector-grid">${numericField('x', 'X position (m)', CONTENT.x)}${numericField('y', 'Y position (m)', CONTENT.y)}</div>
      <div class="offset-field">${numericField('offset', 'Distance off wall (m)', CONTENT.offset)}</div>
      <div class="inspector-actions"><button type="submit" class="apply-button">Apply changes</button><button type="button" class="delete-item">Delete</button></div>`;
    const values = item as unknown as Record<string, string | number>;
    inspector.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[name]').forEach((element) => { element.value = String(values[element.name]); });
    treatmentFields();
    syncImageControls();
  }

  function syncImageControls() {
    const item = scene.items.find((item) => item.id === scene.selectedId);
    if (item?.kind !== 'image' || renderedSelection !== item.id) return;
    const values = { treatment: item.treatment ?? 'flat', rotation: item.rotation ?? 0, ...item.sticker } as Record<string, string | number>;
    inspector.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-image-setting]').forEach((input) => {
      input.value = String(values[input.dataset.imageSetting!]);
    });
    inspector.querySelector<HTMLElement>('.sticker-fields')!.hidden = item.treatment !== 'sticker';
    const type = host.querySelector<HTMLElement>(`[data-item-id="${item.id}"] small`);
    if (type) type.textContent = item.treatment === 'sticker' ? 'Sticker' : 'Image';
  }

  function treatmentFields() {
    const select = inspector.querySelector<HTMLSelectElement>('[name="treatment"]');
    if (!select) return;
    const treatment = select.value;
    inspector.querySelector<HTMLElement>('.thickness-field')!.hidden = treatment !== 'solid';
    inspector.querySelector<HTMLElement>('.offset-field')!.hidden = treatment === 'html';
    inspector.querySelector<HTMLElement>('.treatment-help')!.textContent = treatment === 'html'
      ? 'Selectable in Preview. HTML sits above the canvas and does not receive light or cast shadows.'
      : treatment === 'flat' ? 'Flat lettering receives light. Lift it off the wall to cast a shadow.'
      : 'Solid Helvetiker lettering. Thickness and distance off wall change the shape of its shadow.';
  }

  function refresh(force = false) {
    if (disposed) return;
    const items = scene.items;
    query<HTMLElement>('.item-count').textContent = String(items.length);
    const list = query<HTMLElement>('.item-list');
    list.replaceChildren();
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.itemId = item.id;
      button.className = 'item-button';
      button.setAttribute('aria-pressed', String(scene.selectedId === item.id));
      const label = document.createElement('span');
      label.textContent = item.kind === 'text' ? item.text.replace(/\n/g, ' ') : item.alt || 'Image';
      const type = document.createElement('small');
      type.textContent = item.kind === 'image' ? (item.treatment === 'sticker' ? 'Sticker' : 'Image') : { html: 'HTML', flat: 'Flat lit', solid: '3D' }[item.treatment];
      button.append(label, type); button.disabled = busy;
      list.append(button);
    });
    const selected = items.find((item) => item.id === scene.selectedId);
    if (force || renderedSelection !== scene.selectedId) renderInspector(selected);
    query<HTMLInputElement>('#motion').checked = scene.motionEnabled;
    query<HTMLInputElement>('[value="arrange"]').checked = scene.arrangeMode;
    query<HTMLInputElement>('[value="preview"]').checked = !scene.arrangeMode;
    query<HTMLElement>('#mode-help').textContent = scene.arrangeMode
      ? 'Drag the bulb to play. Select and drag content to arrange it.'
      : 'Hover near a curled sticker corner to relax it. Select HTML text freely; the bulb is still draggable.';
  }

  listen(query('.item-list'), 'click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-item-id]');
    if (button && !busy) { scene.selectItem(button.dataset.itemId!); refresh(true); }
  });
  host.querySelectorAll<HTMLInputElement>('[name="editor-mode"]').forEach((input) => listen(input, 'change', () => scene.setArrangeMode(input.value === 'arrange')));
  listen(query('#add-text'), 'click', () => void work(async () => { await scene.addItem(createTextItem()); refresh(true); }));
  listen(query('#add-image'), 'click', () => imageInput.click());
  async function addImages(files: File[]) {
    for (const file of files) await scene.addItem(await importImage(file));
    refresh(true);
  }
  listen(imageInput, 'change', () => {
    const files = [...imageInput.files ?? []]; imageInput.value = '';
    void work(() => addImages(files));
  });
  listen(sceneHost, 'dragover', (event) => {
    const drag = event as DragEvent;
    if (drag.dataTransfer?.types.includes('Files')) { event.preventDefault(); drag.dataTransfer.dropEffect = 'copy'; sceneHost.classList.add('file-drop-target'); }
  });
  listen(sceneHost, 'dragleave', () => sceneHost.classList.remove('file-drop-target'));
  listen(sceneHost, 'drop', (event) => {
    event.preventDefault(); sceneHost.classList.remove('file-drop-target');
    const files = [...(event as DragEvent).dataTransfer?.files ?? []];
    if (files.length) void work(() => addImages(files));
  });
  listen(inspector, 'change', treatmentFields);
  listen(inspector, 'input', (event) => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    const key = input.dataset.imageSetting;
    if (!key || !scene.selectedId || busy) return;
    if (input instanceof HTMLInputElement && (!input.value || !input.validity.valid)) { notify('Enter a value within the shown range.', true); return; }
    const patch: ImageStickerPatch = key === 'treatment' ? { treatment: input.value as ImageTreatment }
      : key === 'corner' ? { corner: input.value as StickerCorner } : { [key]: Number(input.value) };
    try { scene.updateImageSticker(scene.selectedId, patch); notify(''); }
    catch (error) { notify(error instanceof Error ? error.message : String(error), true); }
  });
  listen(inspector, 'submit', (event) => {
    event.preventDefault();
    const current = scene.items.find((item) => item.id === scene.selectedId);
    if (!current) return;
    const data = new FormData(inspector);
    const number = (key: string) => Number(data.get(key));
    const placement = { x: number('x'), y: number('y'), offset: number('offset') };
    const next: SceneItem = current.kind === 'text'
      ? { ...current, ...placement, text: String(data.get('text')), treatment: data.get('treatment') as TextTreatment,
          size: number('size'), color: String(data.get('color')), thickness: number('thickness') }
      : { ...current, ...placement, alt: String(data.get('alt')), width: number('width') };
    void work(async () => { await scene.updateItem(next); refresh(true); notify('Changes applied.'); });
  });
  listen(inspector, 'click', (event) => {
    if ((event.target as Element).closest('.delete-item') && scene.selectedId) { scene.removeItem(scene.selectedId); refresh(true); notify('Item removed.'); }
  });
  listen(query('#motion'), 'change', () => scene.setMotionEnabled(query<HTMLInputElement>('#motion').checked));
  listen(query('#reset-bulb'), 'click', () => scene.resetBulb());
  listen(query('#save-project'), 'click', () => {
    try {
      const source = serializeProject(scene.exportProject());
      const url = URL.createObjectURL(new Blob([source], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = 'light-study.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Project saved with embedded images. Only applied changes are included.');
    } catch (error) { notify(String(error), true); }
  });
  listen(query('#load-project'), 'click', () => projectInput.click());
  listen(projectInput, 'change', () => {
    const file = projectInput.files?.[0]; projectInput.value = '';
    if (!file) return;
    void work(async () => {
      if (file.size > CONTENT.maxProjectBytes) throw new Error(`Projects must be smaller than ${CONTENT.maxProjectBytes / 1024 / 1024} MB.`);
      await scene.loadProject(parseProject(await file.text()));
      host.dispatchEvent(new Event('study-project-loaded'));
      refresh(true); notify('Project loaded. Bulb returned to rest.');
    });
  });
  // Pointer release commits a position edit; refresh the inspector once, not every animation frame.
  listen(sceneHost, 'study-change', () => refresh(false));
  listen(sceneHost, 'study-sticker-change', syncImageControls);
  listen(sceneHost, 'study-sticker-commit', syncImageControls);
  listen(sceneHost, 'pointerup', () => { if (!busy) refresh(true); });
  refresh(true);
  return { dispose() { disposed = true; events.abort(); host.replaceChildren(); } };
}
