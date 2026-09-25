import * as THREE from 'three';
import { createLightingScene } from '../src/scene.ts';
import { createControls } from '../src/controls.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { CONTENT, CORD, VIEW } from '../src/config.ts';
import { createTextItem, importImage, parseProject, serializeProject } from '../src/project.ts';
import { createEditor } from '../src/editor.ts';
import { checkGlass } from './glass-checks.ts';
import { checkStickers } from './sticker-checks.ts';
import { checkStickerHover } from './sticker-hover-checks.ts';

const results = document.querySelector<HTMLPreElement>('#results')!;
const surface = document.querySelector<HTMLElement>('#test-surface')!;
const controlsHost = document.querySelector<HTMLElement>('#test-controls')!;
const errors: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); originalError(...args); };
window.addEventListener('error', (event) => errors.push(event.message));
window.addEventListener('unhandledrejection', (event) => errors.push(String(event.reason)));

async function run() {
  results.textContent = '';
  document.querySelector('h1')!.textContent = 'Browser checks — running';
  errors.length = 0;
  const report = (message: string) => { results.textContent += `${message}\n`; };
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); report(`PASS ${message}`); };
  let scene: ReturnType<typeof createLightingScene> | undefined;
  let controls: ReturnType<typeof createControls> | undefined;
  const editorHost = document.createElement('div');
  editorHost.style.position = 'absolute'; editorHost.style.left = '-10000px';
  document.body.append(editorHost);
  let editor: ReturnType<typeof createEditor> | undefined;
  try {
    scene = createLightingScene(surface);
    controls = createControls(controlsHost, scene);
    editor = createEditor(editorHost, surface, scene);
    await scene.ready;
    const canvas = surface.querySelector('canvas')!;
    const gl = canvas.getContext('webgl2')!;
    report(`WebGL ${gl.getParameter(gl.VERSION)}; samples: ${gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES)}`);
    assert(gl.getError() === gl.NO_ERROR, 'WebGL renders without errors');
    const sample = document.createElement('canvas');
    sample.width = sample.height = 16;
    const context = sample.getContext('2d')!;
    await new Promise<void>((resolve) => {
      surface.addEventListener('study-render', () => {
        context.drawImage(canvas, 0, 0, 16, 16);
        resolve();
      }, { once: true });
      scene!.invalidate();
    });
    const pixels = context.getImageData(0, 0, 16, 16).data;
    const values = Array.from(pixels).filter((_, i) => i % 4 !== 3);
    assert(Math.max(...values) - Math.min(...values) > 20, 'Canvas contains visible illuminated scene');
    const input = (id: string) => controlsHost.querySelector<HTMLInputElement>(`#${id}`)!;
    const edit = (id: string, value: string) => {
      input(id).value = value;
      input(id).dispatchEvent(new Event('input', { bubbles: true }));
    };
    const mode = (value: string) => controlsHost.querySelector<HTMLInputElement>(`[value="${value}"]`)!.click();
    edit('brightness', '0');
    const world = scene.contentGroup.parent!.parent!;
    const light = world.getObjectByName('filament-light') as import('three').PointLight;
    assert(scene.settings.brightness === 0 && light.intensity === 0, 'Brightness zero turns off actual light');
    const glow = world.getObjectByName('edison-bulb')!;
    async function visibleFilament(label: string) {
      const center = new THREE.Box3().setFromObject(glow.getObjectByName('Object_5')!).getCenter(new THREE.Vector3());
      const camera = new THREE.PerspectiveCamera(VIEW.fieldOfView, surface.clientWidth / surface.clientHeight, 0.01, 30);
      camera.position.z = VIEW.cameraZ; camera.updateMatrixWorld();
      const projected = center.project(camera);
      const capture = document.createElement('canvas'); capture.width = capture.height = 80;
      const ctx = capture.getContext('2d')!;
      await new Promise<void>((resolve) => {
        surface.addEventListener('study-render', () => {
          const x = (projected.x + 1) * canvas.width / 2, y = (1 - projected.y) * canvas.height / 2;
          ctx.drawImage(canvas, x - 40, y - 40, 80, 80, 0, 0, 80, 80); resolve();
        }, { once: true });
        scene!.invalidate();
      });
      const values = ctx.getImageData(0, 0, 80, 80).data;
      let bright = 0;
      for (let i = 0; i < values.length; i += 4) if (values[i] > 230 && values[i + 1] > 150 && values[i + 2] > 80) bright++;
      assert(bright > 8, `${label}: filament visible in rendered pixels (${bright})`);
    }

    let emission = 0;
    glow.traverse((object) => {
      const material = (object as import('three').Mesh).material as import('three').MeshStandardMaterial | undefined;
      if (material?.name === 'glow') emission += material.emissiveIntensity;
    });
    assert(emission === 0, 'Brightness zero turns off filament emission');
    edit('brightness', '200');
    assert(light.intensity > 0, 'Brightness upper endpoint restores illumination');
    const fixtureRoot = world.getObjectByName('hanging-fixture')!;
    const filamentMesh = glow.getObjectByName('Object_5')!;
    const glassMesh = glow.getObjectByName('Object_3') as THREE.Mesh;
    for (const angle of [0, 0.7, -0.7]) {
      fixtureRoot.rotation.z = angle;
      fixtureRoot.updateWorldMatrix(true, true);
      const filamentCenter = new THREE.Box3().setFromObject(filamentMesh).getCenter(new THREE.Vector3());
      assert(light.getWorldPosition(new THREE.Vector3()).distanceTo(filamentCenter) < 0.002, `Light stays inside filament at fixture angle ${angle}`);
      assert(new THREE.Box3().setFromObject(glassMesh).containsPoint(filamentCenter), 'Filament remains inside the visible glass');
    }
    fixtureRoot.rotation.z = 0;
    fixtureRoot.updateWorldMatrix(true, true);
    assert(glassMesh.visible && (glassMesh.material as THREE.MeshPhysicalMaterial).transmission === 1, 'Glass remains visible with transmission enabled');
    for (let i = 0; i < 6; i++) await visibleFilament(`Repeated render ${i + 1}`);
    await checkGlass(scene, surface, assert);
    await visibleFilament('After refraction and PNG pixel checks');
    edit('temperature', '4000');
    mode('custom');
    edit('light-hex', '#00f');
    assert(scene.settings.customLightColor === '#0000ff' && input('light-picker').value === '#0000ff', 'Custom hex updates color and picker');
    assert(light.color.getHexString() === '0000ff', 'Custom light reaches the Three.js light');
    mode('temperature');
    assert(scene.settings.temperature === 4000, 'Temperature is preserved across modes');
    mode('custom');
    assert(scene.settings.customLightColor === '#0000ff', 'Custom color is preserved across modes');
    edit('light-hex', '#oops');
    assert(scene.settings.customLightColor === '#0000ff' && input('light-hex').getAttribute('aria-invalid') === 'true', 'Invalid hex preserves applied color and flags input');
    edit('light-picker', '#6688ff');
    assert(input('light-hex').value === '#6688ff' && input('light-hex').getAttribute('aria-invalid') === 'false', 'Picker synchronizes hex and clears invalid state');
    for (const color of ['#ffffff', '#000000', '#ff3366']) {
      edit('wall-hex', color);
      assert(scene.settings.wallColor === color, `Wall color ${color} applies independently`);
    }
    for (const distance of ['0.15', '1']) {
      edit('wall-distance', distance);
      assert(Math.abs(light.position.z - scene.contentGroup.parent!.position.z - Number(distance)) < 1e-6, `Wall and content move to ${distance} m`);
    }
    controlsHost.querySelector<HTMLButtonElement>('#reset')!.click();
    assert(JSON.stringify(scene.settings) === JSON.stringify(DEFAULT_SETTINGS), 'Reset restores all defaults');
    assert(!controlsHost.querySelector('[aria-invalid="true"]'), 'Reset clears invalid fields');
    const base = createTextItem();
    await scene.addItem(base);
    assert(surface.querySelector('.scene-html')?.textContent === base.text, 'HTML text remains actual DOM content');
    scene.setArrangeMode(false);
    assert(!surface.querySelector('.content-overlay')!.classList.contains('is-arranging'), 'Preview releases HTML from arrange-mode pointer handling');
    scene.setArrangeMode(true);
    const flat = { ...createTextItem(), treatment: 'flat' as const, text: 'Flat\ntext', x: -0.25, offset: 0.05 };
    const solid = { ...createTextItem(), treatment: 'solid' as const, text: 'HOPE', y: -0.25, offset: 0.05 };
    await scene.addItem(flat); await scene.addItem(solid);
    const flatMesh = scene.contentGroup.getObjectByName(`content-${flat.id}`)!.children[0] as import('three').Mesh;
    const flatMaterial = flatMesh.material as import('three').MeshStandardMaterial;
    assert(flatMesh.castShadow && !!flatMaterial.map && flatMaterial.alphaTest === CONTENT.alphaTest, 'Floating flat text uses alpha-aware shadow geometry');
    const solidMesh = scene.contentGroup.getObjectByName(`content-${solid.id}`)!.children[0] as import('three').Mesh;
    solidMesh.geometry.computeBoundingBox();
    assert(Math.abs(solidMesh.geometry.boundingBox!.max.z - solid.thickness) < 1e-6 && solidMesh.castShadow, 'Solid lettering has actual thickness and casts shadows');
    const bitmap = document.createElement('canvas'); bitmap.width = 160; bitmap.height = 80;
    const brush = bitmap.getContext('2d')!; brush.fillStyle = '#6699ee'; brush.fillRect(20, 10, 120, 60); brush.clearRect(65, 25, 30, 30); brush.clearRect(20, 10, 20, 60); brush.fillStyle = 'rgba(102,153,238,0.5)'; brush.fillRect(20, 10, 20, 60);
    const blob = await new Promise<Blob>((resolve) => bitmap.toBlob((value) => resolve(value!), 'image/png'));
    const imageItem = await importImage(new File([blob], 'window.png', { type: 'image/png' }));
    imageItem.offset = 0.08; imageItem.x = 0.3;
    await scene.addItem(imageItem);
    const imageMesh = scene.contentGroup.getObjectByName(`content-${imageItem.id}`)!.children[0] as import('three').Mesh;
    imageMesh.geometry.computeBoundingBox();
    const imageBounds = imageMesh.geometry.boundingBox!;
    assert(Math.abs((imageBounds.max.x - imageBounds.min.x) / (imageBounds.max.y - imageBounds.min.y) - 2) < 1e-6, 'Images preserve their aspect ratio');
    const imageMaterial = imageMesh.material as THREE.MeshStandardMaterial;
    assert(imageMaterial.transparent && !imageMaterial.depthWrite && imageMaterial.alphaTest === CONTENT.imageAlphaTest, 'PNG fades use alpha blending instead of opaque cutouts');
    const imageCanvas = imageMaterial.map!.image as HTMLCanvasElement;
    const alpha = imageCanvas.getContext('2d')!.getImageData(25, 20, 1, 1).data[3];
    assert(alpha >= 126 && alpha <= 129, 'Image import preserves partial alpha values');
    await checkStickers(scene, surface, editorHost, assert, visibleFilament);
    await checkStickerHover(scene, surface, assert);
    await visibleFilament('After sticker, rotation and content checks');
    const cable = world.getObjectByName('simulated-cord') as THREE.InstancedMesh;
    const capacity = cable.instanceMatrix.count;
    assert(capacity >= CORD.segments + Math.ceil(CORD.extraLength / (CORD.length / CORD.segments)), 'Cord reserves capacity for ceiling payout');
    const nextRender = () => new Promise<void>((resolve) => surface.addEventListener('study-render', () => resolve(), { once: true }));
    const pointerAt = (type: string, x: number, y: number, options: PointerEventInit = {}, target: EventTarget = surface) => {
      const camera = new THREE.PerspectiveCamera(VIEW.fieldOfView, surface.clientWidth / surface.clientHeight, 0.01, 30);
      camera.position.z = VIEW.cameraZ; camera.updateMatrixWorld();
      const point = new THREE.Vector3(x, y, 0).project(camera);
      const rect = surface.getBoundingClientRect();
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, pointerId: 77, pointerType: 'touch', isPrimary: true, button: 0,
        buttons: type === 'pointerdown' || type === 'pointermove' ? 1 : 0,
        clientX: rect.left + (point.x + 1) * rect.width / 2,
        clientY: rect.top + (1 - point.y) * rect.height / 2,
        ...options,
      }));
    };
    // Synthetic pointers have no native active-pointer slot. Stub only capture
    // acquisition; actual scene hit-testing, drag, cancellation and reset run normally.
    const acquireCapture = surface.setPointerCapture;
    surface.setPointerCapture = () => {};
    try {
      scene.resetBulb();
      pointerAt('pointerdown', 0, (VIEW.socketTop + VIEW.socketBottom) / 2);
      pointerAt('pointermove', 0.43, 0.4);
      for (let i = 0; i < 180 && cable.count === CORD.segments; i++) await nextRender();
      assert(cable.count > CORD.segments && cable.instanceMatrix.count === capacity, 'Dragging adds ceiling segments without reallocating the cord buffer');
      await visibleFilament('During cord payout');
      const cancelled = nextRender();
      pointerAt('pointercancel', 0.43, 0.4);
      await cancelled;
      assert(cable.count === CORD.segments && Math.abs(fixtureRoot.position.y - VIEW.socketTop) < 1e-6, 'Touch cancellation restores cord count and resting fixture');

      // Reproduce Chrome's observed sequence: lost capture (buttons=0), then
      // pointerup. Neither event may turn a normal release into an instant reset.
      scene.setMotionEnabled(true);
      pointerAt('pointerdown', 0, (VIEW.socketTop + VIEW.socketBottom) / 2, { pointerType: 'mouse' });
      pointerAt('pointermove', 0.43, 0.4, { pointerType: 'mouse' });
      for (let i = 0; i < 180 && cable.count === CORD.segments; i++) await nextRender();
      pointerAt('pointercancel', 0.43, 0.4, { pointerId: 88 });
      pointerAt('lostpointercapture', 0.43, 0.4, { pointerId: 88 });
      assert(surface.classList.contains('is-dragging'), 'Unrelated pointer cancellation and capture loss do not interrupt the active drag');
      const beforeRelease = fixtureRoot.position.clone();
      let released = nextRender();
      pointerAt('lostpointercapture', 0.43, 0.4, { pointerType: 'mouse' });
      await released;
      assert(!surface.classList.contains('is-dragging') && cable.count > CORD.segments && fixtureRoot.position.x > 0.1,
        'Chrome capture loss before pointerup releases into a swing instead of resetting');
      assert(fixtureRoot.position.distanceTo(beforeRelease) < 0.1, 'Capture-loss release preserves the current fixture position');
      released = nextRender();
      pointerAt('pointerup', 0.43, 0.4, { pointerType: 'mouse' });
      pointerAt('lostpointercapture', 0.43, 0.4, { pointerType: 'mouse' });
      await released;
      assert(fixtureRoot.position.x > 0.1, 'Later pointerup and repeated capture loss cannot reset the released bulb');
      await visibleFilament('After Chrome capture-loss release');

      scene.resetBulb();
      pointerAt('pointerdown', 0, (VIEW.socketTop + VIEW.socketBottom) / 2);
      pointerAt('pointermove', -0.43, 0.4);
      for (let i = 0; i < 180 && cable.count === CORD.segments; i++) await nextRender();
      released = nextRender();
      pointerAt('pointerup', -0.43, 0.4, {}, document.body);
      pointerAt('lostpointercapture', -0.43, 0.4);
      await released;
      assert(!surface.classList.contains('is-dragging') && fixtureRoot.position.x < -0.1,
        'Pointerup outside the scene completes a normal release; subsequent capture loss is harmless');

      scene.setMotionEnabled(false);
      pointerAt('pointerdown', 0, (VIEW.socketTop + VIEW.socketBottom) / 2);
      pointerAt('pointermove', -0.43, 0.4);
      for (let i = 0; i < 180 && cable.count === CORD.segments; i++) await nextRender();
      released = nextRender(); pointerAt('lostpointercapture', -0.43, 0.4); pointerAt('pointerup', -0.43, 0.4); await released;
      assert(cable.count === CORD.segments && Math.abs(fixtureRoot.position.y - VIEW.socketTop) < 1e-6, 'Motion-disabled release retracts immediately without animation');
      scene.setMotionEnabled(true);
    } finally { surface.setPointerCapture = acquireCapture; }

    const snapshot = serializeProject(scene.exportProject());
    await scene.loadProject(parseProject(snapshot));
    await visibleFilament('After project load');
    assert(serializeProject(scene.exportProject()) === snapshot && scene.items.length === 4, 'Full project round-trips all content types and images');
    const beforeInvalid = serializeProject(scene.exportProject());
    const invalidFont = scene.exportProject();
    invalidFont.items = [{ ...solid, text: 'Unsupported 🦄' }];
    let rejectedFont = false;
    try { await scene.loadProject(invalidFont); } catch { rejectedFont = true; }
    assert(rejectedFont && serializeProject(scene.exportProject()) === beforeInvalid, 'Unsupported 3D glyph import leaves current scene intact');
    const brokenImage = scene.exportProject();
    brokenImage.items = [{ ...imageItem, imageData: 'data:image/png;base64,YWJj' }];
    let rejectedImage = false;
    try { await scene.loadProject(brokenImage); } catch { rejectedImage = true; }
    assert(rejectedImage && serializeProject(scene.exportProject()) === beforeInvalid, 'Undecodable image import leaves current scene intact');
    let rejectedFile = false;
    try { await importImage(new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })); } catch { rejectedFile = true; }
    assert(rejectedFile, 'Image input rejects unsupported file types');
    for (let i = 0; i < 4; i++) await scene.updateItem({ ...flat, text: `Edit ${i}` });
    assert(scene.items.length === 4 && scene.contentGroup.children.length === 4, 'Repeated edits replace geometry without duplicate scene objects');
    scene.removeItem(flat.id);
    assert(scene.items.length === 3 && !scene.contentGroup.getObjectByName(`content-${flat.id}`), 'Deleting content removes its scene object');
    const fixture = world.getObjectByName('hanging-fixture')!;
    scene.resetBulb();
    assert(Math.abs(fixture.rotation.z) < 1e-6 && Math.abs(fixture.position.y - VIEW.socketTop) < 1e-6, 'Reset bulb restores attachment point and orientation');
    const editorAdd = editorHost.querySelector<HTMLButtonElement>('#add-text')!;
    editorAdd.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert(scene.items.length === 4 && !!editorHost.querySelector('textarea[name="text"]'), 'Editor adds and selects editable text');
    await new Promise<void>((resolve, reject) => {
      const complete = () => {
        if (canvas.width !== Math.floor(320 * Math.min(devicePixelRatio, 2))) return;
        clearTimeout(timeout); surface.removeEventListener('study-render', complete); resolve();
      };
      const timeout = setTimeout(() => {
        surface.removeEventListener('study-render', complete);
        reject(new Error('Resize did not render within 10 seconds; keep the test window visible'));
      }, 10000);
      surface.addEventListener('study-render', complete);
      surface.style.width = '320px';
    });
    assert(canvas.width === 320 * Math.min(devicePixelRatio, 2), 'Resize observer updates drawing buffer and caps DPR');
    scene.dispose();
    scene.dispose();
    controls.dispose();
    editor.dispose();
    assert(!surface.querySelector('canvas') && !controlsHost.children.length, 'Dispose removes canvas and controls and is repeatable');
    scene = createLightingScene(surface);
    await scene.ready;
    scene.dispose();
    assert(!surface.querySelector('canvas'), 'Scene can remount after disposal');
    const loading = createLightingScene(surface);
    loading.dispose();
    await loading.ready;
    assert(!surface.querySelector('canvas'), 'Disposal while loading leaves no late canvas');
    assert(errors.length === 0, 'No console or runtime errors');
    report('\nALL CHECKS PASSED');
    document.querySelector('h1')!.textContent = 'ALL CHECKS PASSED';
  } catch (error) {
    report(`FAIL ${String(error)}`);
    document.querySelector('h1')!.textContent = `FAIL ${String(error)}`;
    if (errors.length) report(errors.join('\n'));
  } finally {
    scene?.dispose();
    controls?.dispose();
    editor?.dispose(); editorHost.remove();
    surface.style.width = '640px';
  }
}

document.querySelector('#run')!.addEventListener('click', run);
run();
