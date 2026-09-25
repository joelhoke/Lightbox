import * as THREE from 'three';
import { GLASS, VIEW } from './config.ts';

/** Physical glass sampling a linear scene capture that also contains alpha-blended content. */
export function createGlassRendering(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, samples: number) {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace,
    generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, samples,
  });
  target.texture.name = 'bulb-scene-capture';
  const interiorTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, samples,
  });
  interiorTarget.texture.name = 'bulb-interior-capture';
  const map = { value: target.texture };
  const interiorMap = { value: interiorTarget.texture };
  const size = { value: new THREE.Vector2(1, 1) };
  const glasses = new Set<THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>>();
  const fixtures = new Set<THREE.Object3D>();
  const foregroundMasks = new Map<THREE.Material, THREE.Material>();
  const cleanupListeners = new Map<THREE.Material, () => void>();
  const glassBounds = new THREE.Box3(), itemBounds = new THREE.Box3();
  const scale = new THREE.Vector3();

  function register(mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>, fixture: THREE.Object3D) {
    const material = mesh.material;
    material.onBeforeCompile = (shader) => {
      const include = '#include <transmission_pars_fragment>';
      if (!shader.fragmentShader.includes(include)) throw new Error('Glass shader adapter needs updating for this Three.js version.');
      shader.uniforms.bulbSceneMap = map;
      shader.uniforms.bulbSceneSize = size;
      shader.uniforms.bulbInteriorMap = interiorMap;
      // Own uniform names prevent WebGLMaterials from replacing our complete
      // capture with the renderer's built-in opaque-only transmission texture.
      const chunk = THREE.ShaderChunk.transmission_pars_fragment
        .replaceAll('transmissionSamplerMap', 'bulbSceneMap')
        .replaceAll('transmissionSamplerSize', 'bulbSceneSize')
        .replace('uniform sampler2D bulbSceneMap;', 'uniform sampler2D bulbSceneMap;\n uniform sampler2D bulbInteriorMap;')
        .replace('vec3 attenuatedColor =', `
          // Only the surrounding scene bends. The filament/supports are captured
          // at the same camera coordinates and composed with premultiplied alpha.
          vec4 interior = texture2D(bulbInteriorMap, gl_FragCoord.xy / bulbSceneSize);
          transmittedLight.rgb = transmittedLight.rgb * (1.0 - interior.a) + interior.rgb;
          vec3 attenuatedColor =`);
      shader.fragmentShader = shader.fragmentShader.replace(include, chunk);
    };
    material.customProgramCacheKey = () => 'bulb-background-refraction-v2';
    material.needsUpdate = true;
    glasses.add(mesh);
    fixtures.add(fixture);
    const onDispose = () => { glasses.delete(mesh); material.removeEventListener('dispose', onDispose); cleanupListeners.delete(material); };
    cleanupListeners.set(material, onDispose);
    material.addEventListener('dispose', onDispose);
  }

  function shadowOnly(material: THREE.Material) {
    let mask = foregroundMasks.get(material);
    if (!mask) {
      mask = material.clone();
      mask.colorWrite = false; mask.depthWrite = false;
      // Foreground items remain present to cast their normal shadows, but write
      // neither color nor depth into the refraction capture.
      foregroundMasks.set(material, mask);
      const onDispose = () => {
        mask!.dispose(); foregroundMasks.delete(material);
        material.removeEventListener('dispose', onDispose); cleanupListeners.delete(material);
      };
      cleanupListeners.set(material, onDispose);
      material.addEventListener('dispose', onDispose);
    }
    return mask;
  }

  return {
    register,
    setSize(width: number, height: number, ratio: number) {
      ratio = Math.min(ratio, VIEW.maxPixelRatio);
      const w = Math.max(1, Math.floor(width * ratio)), h = Math.max(1, Math.floor(height * ratio));
      target.setSize(w, h); interiorTarget.setSize(w, h); size.value.set(w, h);
    },
    capture() {
      if (!glasses.size) return false;
      scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
      glassBounds.makeEmpty();
      for (const mesh of glasses) {
        glassBounds.union(itemBounds.setFromObject(mesh));
        // glTF normalization and its nested transforms can include unit scaling.
        // The physical shader multiplies local thickness by this world scale.
        mesh.getWorldScale(scale);
        mesh.material.thickness = GLASS.opticalDepth / Math.max(1e-8, Math.abs(scale.x));
      }
      glassBounds.applyMatrix4(camera.matrixWorldInverse);
      const visibility = new Map<THREE.Object3D, boolean>();
      const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      const previousTarget = renderer.getRenderTarget();
      const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      const toneMapping = renderer.toneMapping, autoClear = renderer.autoClear;
      const background = scene.background;
      const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      const shadowUpdate = renderer.shadowMap.autoUpdate;
      const interiors = new Set<THREE.Mesh>();
      fixtures.forEach((fixture) => fixture.traverse((object) => { if (object instanceof THREE.Mesh && !glasses.has(object)) interiors.add(object); }));
      const maskMesh = (mesh: THREE.Mesh) => {
        if (materials.has(mesh)) return;
        materials.set(mesh, mesh.material);
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(shadowOnly) : shadowOnly(mesh.material);
      };
      try {
        for (const mesh of glasses) { visibility.set(mesh, mesh.visible); mesh.visible = false; }
        interiors.forEach(maskMesh);
        scene.traverse((object) => {
          if (!object.userData.itemId) return;
          itemBounds.setFromObject(object).applyMatrix4(camera.matrixWorldInverse);
          if (itemBounds.isEmpty() || itemBounds.min.z <= glassBounds.max.z) return;
          object.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            maskMesh(child);
          });
        });
        renderer.toneMapping = THREE.NoToneMapping;
        renderer.autoClear = true;
        renderer.setRenderTarget(target);
        renderer.render(scene, camera);
        // A second, small draw list preserves the original coil shape. It shares
        // scene lighting, but neither includes the wall nor recalculates shadows.
        materials.forEach((material, object) => { object.material = material; });
        renderer.shadowMap.autoUpdate = false;
        scene.traverse((object) => {
          if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) || interiors.has(object as THREE.Mesh) || visibility.has(object)) return;
          visibility.set(object, object.visible); object.visible = false;
        });
        scene.background = null;
        renderer.setClearColor(0, 0);
        renderer.setRenderTarget(interiorTarget);
        renderer.render(scene, camera);
      } finally {
        visibility.forEach((visible, object) => { object.visible = visible; });
        materials.forEach((material, object) => { object.material = material; });
        renderer.toneMapping = toneMapping; renderer.autoClear = autoClear;
        renderer.shadowMap.autoUpdate = shadowUpdate;
        scene.background = background; renderer.setClearColor(clearColor, clearAlpha);
        renderer.setRenderTarget(previousTarget, face, mip);
      }
      return true;
    },
    dispose() {
      glasses.clear(); fixtures.clear(); target.dispose(); interiorTarget.dispose();
      cleanupListeners.forEach((listener, material) => material.removeEventListener('dispose', listener)); cleanupListeners.clear();
      foregroundMasks.forEach((material) => material.dispose()); foregroundMasks.clear();
    },
  };
}
