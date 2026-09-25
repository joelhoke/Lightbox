import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { createGlassRendering } from '../src/glass.ts';
import { GLASS } from '../src/config.ts';

function fixture() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#123456');
  const camera = new THREE.PerspectiveCamera(); camera.position.z = 2;
  const material = new THREE.MeshPhysicalMaterial({ transmission: 1 });
  const glass = new THREE.Mesh(new THREE.SphereGeometry(0.1), material);
  glass.scale.setScalar(0.2);
  const assembly = new THREE.Group(); assembly.add(glass); scene.add(assembly);
  const item = new THREE.Group(); item.userData.itemId = 'front'; item.position.z = 0.4;
  const imageMaterial = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5 });
  const image = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), imageMaterial); image.castShadow = true;
  item.add(image); scene.add(item);
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    toneMapping: THREE.ACESFilmicToneMapping, autoClear: false, shadowMap: { autoUpdate: true },
    getClearColor: (color: THREE.Color) => color.set(0x123456), getClearAlpha: () => 1,
    setClearColor: (_color: number | THREE.Color, _alpha: number) => {},
    getRenderTarget: () => target, setRenderTarget: (next: THREE.WebGLRenderTarget | null) => { target = next; },
    getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
    render: (_scene: THREE.Scene, _camera: THREE.Camera) => {},
  };
  const pipeline = createGlassRendering(renderer as unknown as THREE.WebGLRenderer, scene, camera, 4);
  pipeline.register(glass, assembly);
  const dispose = () => { pipeline.dispose(); glass.geometry.dispose(); material.dispose(); image.geometry.dispose(); imageMaterial.dispose(); };
  return { pipeline, scene, glass, image, imageMaterial, item, renderer, dispose };
}

test('glass capture excludes its shell and foreground color while retaining foreground shadows; restores state', () => {
  const f = fixture();
  try {
    f.pipeline.setSize(100, 50, 3);
    let firstTarget: THREE.WebGLRenderTarget | null = null;
    f.renderer.render = () => {
      assert.equal(f.glass.visible, false);
      if (f.renderer.getRenderTarget()!.texture.name === 'bulb-interior-capture') {
        assert.equal(f.image.visible, false); assert.equal(f.scene.background, null);
        assert.equal(f.renderer.shadowMap.autoUpdate, false); return;
      }
      assert.equal(f.image.visible && f.image.castShadow, true);
      assert.equal(f.image.material.colorWrite, false);
      assert.equal(f.image.material.depthWrite, false);
      assert.equal(f.renderer.toneMapping, THREE.NoToneMapping);
      const target = f.renderer.getRenderTarget()!;
      assert.equal(target.width, 200); assert.equal(target.height, 100);
      if (firstTarget) assert.equal(firstTarget, target); else firstTarget = target;
    };
    f.pipeline.capture(); f.pipeline.capture();
    assert.equal(f.glass.visible, true); assert.equal(f.image.material, f.imageMaterial);
    assert.equal(f.renderer.getRenderTarget(), null); assert.equal(f.renderer.autoClear, false);
    assert.equal(f.renderer.toneMapping, THREE.ACESFilmicToneMapping);
    assert.equal(f.renderer.shadowMap.autoUpdate, true);
    assert.ok(Math.abs(f.glass.material.thickness * 0.2 - GLASS.opticalDepth) < 1e-9);
    f.item.position.z = -0.4;
    f.renderer.render = () => { assert.equal(f.image.material, f.imageMaterial); };
    f.pipeline.capture();
  } finally { f.dispose(); }
});

test('failed capture restores materials, visibility, render target, and color-management state', () => {
  const f = fixture();
  try {
    const background = f.scene.background;
    for (const failingPass of ['bulb-scene-capture', 'bulb-interior-capture']) {
      f.renderer.render = () => { if (f.renderer.getRenderTarget()!.texture.name === failingPass) throw new Error('capture failed'); };
      assert.throws(() => f.pipeline.capture(), /capture failed/);
      assert.equal(f.glass.visible, true); assert.equal(f.image.visible, true); assert.equal(f.image.material, f.imageMaterial);
      assert.equal(f.renderer.getRenderTarget(), null); assert.equal(f.renderer.toneMapping, THREE.ACESFilmicToneMapping);
      assert.equal(f.renderer.autoClear, false); assert.equal(f.renderer.shadowMap.autoUpdate, true);
      assert.equal(f.scene.background, background);
    }
  } finally { f.dispose(); }
});

test('foreground masks are released with their source material, capture target on disposal', () => {
  const f = fixture();
  let maskDisposed = 0, targetDisposed = 0;
  f.renderer.render = () => {
    if (f.renderer.getRenderTarget()!.texture.name === 'bulb-scene-capture') f.image.material.addEventListener('dispose', () => maskDisposed++);
    f.renderer.getRenderTarget()!.addEventListener('dispose', () => targetDisposed++);
  };
  f.pipeline.capture();
  f.imageMaterial.dispose(); assert.equal(maskDisposed, 1);
  f.dispose(); assert.equal(maskDisposed, 1); assert.equal(targetDisposed, 2);
});
