import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { LIGHTING } from './config.ts';
import { createGlassRendering } from './glass.ts';

/** Bloom only the filament, so strongly lit white text/images don't become emissive-looking. */
export function createRendering(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), LIGHTING.bloom.strength, LIGHTING.bloom.radius, LIGHTING.bloom.threshold);
  bloomComposer.addPass(new RenderPass(scene, camera));
  bloomComposer.addPass(bloom);
  const composer = new EffectComposer(renderer);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const supported = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES) as Int32Array;
  const samples = Math.max(0, ...Array.from(supported).filter((count) => count <= 4));
  const glass = createGlassRendering(renderer, scene, camera, samples);
  composer.renderTarget1.samples = samples;
  composer.renderTarget2.samples = samples;
  composer.addPass(new RenderPass(scene, camera));
  const mix = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, bloomTexture: { value: bloomComposer.renderTarget2.texture } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor=texture2D(tDiffuse,vUv)+vec4(texture2D(bloomTexture,vUv).rgb,0.); }',
  });
  composer.addPass(mix);
  composer.addPass(new OutputPass());
  const masks = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  const replacements = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const black = new THREE.Color(0);

  function mask(material: THREE.Material) {
    if (material.name === 'glow') return material;
    let replacement = masks.get(material);
    if (!replacement) {
      const original = material as THREE.MeshStandardMaterial;
      // Glass is drawn only by the main pass. Reusing its transmissive material
      // in both passes corrupts the refraction result on later frames and hides
      // the filament. The bloom pass needs the unobstructed filament emission.
      const glass = material.name === 'bulb-glass' || material.name === 'inner-glass';
      replacement = new THREE.MeshBasicMaterial({ color: 0, map: original.map ?? null, alphaMap: original.alphaMap ?? null,
        alphaTest: material.alphaTest, side: material.side, visible: material.visible,
        transparent: glass || material.transparent, opacity: glass ? 0 : material.opacity, depthWrite: !glass && material.depthWrite });
      replacement.forceSinglePass = material.forceSinglePass;
      masks.set(material, replacement);
      // Items can be edited/deleted repeatedly; never retain their old textures via a mask.
      material.addEventListener('dispose', () => { replacement!.dispose(); masks.delete(material); });
    }
    return replacement;
  }

  return {
    registerGlass: glass.register,
    setSize(width: number, height: number, ratio: number) {
      glass.setSize(width, height, ratio);
      for (const pipeline of [composer, bloomComposer]) { pipeline.setPixelRatio(ratio); pipeline.setSize(width, height); }
    },
    render(glowing: boolean) {
      const shadowUpdate = renderer.shadowMap.autoUpdate;
      // Capture updates shadows with the real scene, including foreground casters.
      // Reuse those maps for bloom and the main image rather than rendering them twice.
      if (glass.capture()) renderer.shadowMap.autoUpdate = false;
      try {
        mix.enabled = glowing;
        if (glowing) {
          const background = scene.background;
          scene.background = black;
          scene.traverse((object) => {
            if (object instanceof THREE.Mesh) {
              replacements.set(object, object.material);
              object.material = Array.isArray(object.material) ? object.material.map(mask) : mask(object.material);
            }
          });
          const shadowUpdate = renderer.shadowMap.autoUpdate;
          renderer.shadowMap.autoUpdate = false;
          try { bloomComposer.render(); }
          finally {
            scene.background = background;
            replacements.forEach((material, mesh) => { mesh.material = material; });
            replacements.clear();
            renderer.shadowMap.autoUpdate = shadowUpdate;
          }
        }
        composer.render();
      } finally { renderer.shadowMap.autoUpdate = shadowUpdate; }
    },
    dispose() {
      glass.dispose();
      masks.forEach((material) => material.dispose()); masks.clear();
      for (const pipeline of [composer, bloomComposer]) {
        pipeline.passes.forEach((pass) => pass.dispose()); pipeline.dispose();
      }
    },
  };
}
