import * as THREE from 'three';
import { GLASS, VIEW } from '../src/config.ts';
import type { LightingScene } from '../src/scene.ts';
import type { ImageItem } from '../src/project.ts';
import { glassGrid } from './glass-fixture.ts';

/** Pixel comparisons use the actual loaded bulb, real PNG decoding, and final tone-mapped output. */
export async function checkGlass(scene: LightingScene, surface: HTMLElement, assert: (condition: unknown, message: string) => void) {
  const settings = scene.settings;
  scene.updateSettings({ brightness: 0, wallColor: '#303030', wallDistance: 0.35 });
  const canvas = surface.querySelector('canvas')!;
  const world = scene.contentGroup.parent!.parent!;
  const glass = world.getObjectByName('Object_3') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  const camera = new THREE.PerspectiveCamera(VIEW.fieldOfView, surface.clientWidth / surface.clientHeight, 0.01, 30);
  camera.position.z = VIEW.cameraZ; camera.updateMatrixWorld(); world.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(glass);
  const min = bounds.min.clone().project(camera), max = bounds.max.clone().project(camera);
  // Fixed-size sample of the glass only, independent of canvas DPR. Avoid the socket.
  const x = Math.floor((min.x + 1) * canvas.width / 2), y = Math.floor((1 - max.y) * canvas.height / 2);
  const w = Math.ceil((max.x - min.x) * canvas.width / 2), h = Math.ceil((max.y - min.y) * canvas.height / 2);
  const sample = document.createElement('canvas'); sample.width = sample.height = 96;
  const ctx = sample.getContext('2d')!;
  const raycaster = new THREE.Raycaster();
  const pixels: number[] = [];
  for (let py = 8; py < 88; py++) for (let px = 8; px < 88; px++) {
    raycaster.setFromCamera(new THREE.Vector2((x + px / 96 * w) / canvas.width * 2 - 1, 1 - (y + py / 96 * h) / canvas.height * 2), camera);
    if (raycaster.intersectObject(glass).length) pixels.push((py * 96 + px) * 4);
  }
  const capture = () => new Promise<Uint8ClampedArray>((resolve, reject) => {
    const timeout = setTimeout(() => { surface.removeEventListener('study-render', read); reject(new Error('Glass capture timed out: keep test tab visible')); }, 10000);
    const read = () => {
      clearTimeout(timeout); ctx.drawImage(canvas, x, y, w, h, 0, 0, 96, 96);
      resolve(ctx.getImageData(0, 0, 96, 96).data);
    };
    surface.addEventListener('study-render', read, { once: true }); scene.invalidate();
  });
  const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => pixels.reduce((sum, p) => sum + Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]), 0) / (pixels.length * 3);
  function colorImage(color: string): ImageItem {
    const bitmap = document.createElement('canvas'); bitmap.width = bitmap.height = 16;
    const brush = bitmap.getContext('2d')!; brush.fillStyle = color; brush.fillRect(0, 0, 16, 16);
    return { id: 'glass-pixel-test', kind: 'image', imageData: bitmap.toDataURL(), x: 0, y: 0.17, width: 0.4, offset: 0, alt: 'Glass regression swatch' };
  }
  try {
    assert(pixels.length > 1000, 'Glass pixel regression samples the actual bulb silhouette');
    scene.updateSettings({ brightness: 100 });
    const curvedCoil = await capture();
    glass.material.ior = 1;
    const straightCoil = await capture();
    glass.material.ior = GLASS.ior;
    const bright = (image: Uint8ClampedArray, p: number) => image[p] > 220 && image[p + 1] > 140 && image[p + 2] > 70;
    const union = pixels.filter((p) => bright(curvedCoil, p) || bright(straightCoil, p));
    const overlap = union.filter((p) => bright(curvedCoil, p) && bright(straightCoil, p)).length / union.length;
    assert(union.length > 20 && overlap > 0.85, `Refraction preserves the coil silhouette (${(overlap * 100).toFixed(1)}% pixel overlap)`);
    scene.updateSettings({ brightness: 0 });
    const baseline = await capture();
    await scene.addItem(colorImage('#00ffff')); scene.selectItem(null);
    const cyan = await capture();
    await scene.updateItem(colorImage('#ff0000'));
    const red = await capture();
    assert(difference(cyan, red) > 15, `PNG colors appear through glass, rather than only wall shadows (${difference(cyan, red).toFixed(1)})`);
    await scene.updateItem(colorImage('rgba(0,255,255,0)'));
    const clear = await capture();
    assert(difference(clear, baseline) < 1, 'Fully transparent PNG pixels reveal the original scene through glass');
    await scene.updateItem(colorImage('rgba(0,255,255,0.5)'));
    const half = await capture();
    const fullDelta = difference(cyan, baseline), halfDelta = difference(half, baseline);
    assert(halfDelta > 3 && halfDelta < fullDelta - 3, `Partial PNG alpha survives glass capture (${halfDelta.toFixed(1)} vs opaque ${fullDelta.toFixed(1)})`);
    scene.removeItem('glass-pixel-test');
    await scene.addItem({ ...glassGrid(), offset: 0 }); scene.selectItem(null);
    const lens = await capture();
    const ior = glass.material.ior;
    glass.material.ior = 1;
    const straight = await capture();
    glass.material.ior = ior;
    // Reflection differences alone are broad/soft. Grid edge displacement creates
    // large local differences; require numerous strongly changed pixels as well.
    const displaced = pixels.filter((p) => Math.abs(lens[p] - straight[p]) + Math.abs(lens[p + 1] - straight[p + 1]) + Math.abs(lens[p + 2] - straight[p + 2]) > 75).length;
    assert(difference(lens, straight) > 4 && displaced > pixels.length * 0.04, `Curved glass visibly displaces grid pixels (${displaced})`);
    const worldScale = glass.getWorldScale(new THREE.Vector3());
    assert(Math.abs(glass.material.thickness * Math.abs(worldScale.x) - GLASS.opticalDepth) < 1e-7, 'Optical depth stays in metres after imported model scaling');

    // A fully foreground transparent image must blend once over the glass. Move
    // behind again and confirm no stale capture/mask survives the depth change.
    scene.updateSettings({ wallDistance: 0.15 });
    const frontItem = { ...colorImage('rgba(0,255,255,0.5)'), offset: 0.3 };
    await scene.addItem(frontItem); scene.selectItem(null);
    const frontNode = scene.contentGroup.getObjectByName(`content-${frontItem.id}`)!;
    const frontMesh = frontNode.children[0] as THREE.Mesh;
    const frontMaterial = frontMesh.material;
    const foreground = await capture();
    assert(frontMesh.material === frontMaterial && frontMesh.visible, 'Foreground capture mask restores the real image material');
    frontNode.userData.itemId = undefined; // Deliberately include it in capture to expose double compositing.
    const contaminated = await capture();
    frontNode.userData.itemId = frontItem.id;
    assert(difference(foreground, contaminated) > 2, 'Foreground images are excluded from glass sampling instead of appearing twice');
    await scene.updateItem({ ...frontItem, offset: 0 });
    const behind = await capture();
    assert(difference(behind, foreground) > 3, 'Moving content from foreground to background refreshes refraction');
    for (const wallDistance of [0.15, 1]) {
      scene.updateSettings({ wallDistance, brightness: 100, lightMode: 'custom', customLightColor: '#6688ff' });
      await capture();
    }
    assert(canvas.getContext('webgl2')!.getError() === 0, 'Glass renders across wall distances and colored lighting without WebGL errors');
  } finally {
    glass.material.ior = GLASS.ior;
    scene.removeItem('glass-pixel-test'); scene.removeItem('glass-grid'); scene.updateSettings(settings);
  }
}
