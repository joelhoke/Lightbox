import * as THREE from 'three';
import { CONTENT, STICKER } from './config.ts';
import type { StickerCorner, StickerSettings } from './project.ts';

export interface StickerBounds { minX: number; maxX: number; minY: number; maxY: number }
export function visibleBounds(data: Uint8ClampedArray, pixelsWide: number, pixelsHigh: number, width: number, height: number): StickerBounds {
  let left = pixelsWide, right = -1, top = pixelsHigh, bottom = -1;
  for (let y = 0; y < pixelsHigh; y++) for (let x = 0; x < pixelsWide; x++) {
    // Match the rendering cutoff; retain every visible partial-alpha pixel.
    if (data[(y * pixelsWide + x) * 4 + 3] < CONTENT.imageAlphaTest * 255) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) return { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2 };
  return { minX: width * (left / pixelsWide - 0.5), maxX: width * ((right + 1) / pixelsWide - 0.5),
    minY: height * (0.5 - (bottom + 1) / pixelsHigh), maxY: height * (0.5 - top / pixelsHigh) };
}
export function cornerPoint(bounds: StickerBounds, corner: StickerCorner) {
  return new THREE.Vector3(corner.endsWith('right') ? bounds.maxX : bounds.minX, corner.startsWith('top') ? bounds.maxY : bounds.minY, 0);
}
export function cornerDirection(corner: StickerCorner) {
  return new THREE.Vector2(corner.endsWith('right') ? Math.SQRT1_2 : -Math.SQRT1_2, corner.startsWith('top') ? Math.SQRT1_2 : -Math.SQRT1_2);
}
export function peelDepth(bounds: StickerBounds, settings: StickerSettings) {
  return Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * settings.peelArea / 100;
}
/** Arc-length-preserving cylindrical bend. All units are wall-local metres. */
export function bendPoint(x: number, y: number, bounds: StickerBounds, settings: StickerSettings, target = new THREE.Vector3()) {
  target.set(x, y, 0);
  if (settings.curl === 0) return target;
  const corner = cornerPoint(bounds, settings.corner), direction = cornerDirection(settings.corner);
  const depth = peelDepth(bounds, settings);
  const distance = (x - corner.x) * direction.x + (y - corner.y) * direction.y + depth;
  if (distance <= 0 || depth <= 0) return target;
  const curvature = THREE.MathUtils.degToRad(STICKER.maxAngle) * settings.curl / 100 / depth;
  // Transparent padding beyond the visible corner continues along the tangent;
  // it must not roll into another loop or produce oversized selection bounds.
  const arc = Math.min(distance, depth), remainder = distance - arc;
  const angle = arc * curvature;
  const along = Math.sin(angle) / curvature + remainder * Math.cos(angle);
  target.x += (along - distance) * direction.x;
  target.y += (along - distance) * direction.y;
  target.z = (1 - Math.cos(angle)) / curvature + remainder * Math.sin(angle);
  return target;
}

export class StickerSurface {
  readonly geometry: THREE.PlaneGeometry;
  private readonly rest: Float32Array;
  private readonly triangles: Uint16Array | Uint32Array;
  private readonly order: number[];
  private readonly depths: Float64Array;
  private readonly direction = new THREE.Vector3(NaN, NaN, NaN);
  private dirty = true;
  readonly bounds: StickerBounds;
  constructor(width: number, height: number, bounds: StickerBounds) {
    this.bounds = bounds;
    this.geometry = new THREE.PlaneGeometry(width, height, STICKER.segments, STICKER.segments);
    (this.geometry.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.geometry.index!.setUsage(THREE.DynamicDrawUsage);
    this.rest = (this.geometry.attributes.position.array as Float32Array).slice();
    this.triangles = (this.geometry.index!.array as Uint16Array | Uint32Array).slice();
    this.order = Array.from({ length: this.triangles.length / 3 }, (_, i) => i);
    this.depths = new Float64Array(this.order.length);
  }
  update(settings: StickerSettings, enabled: boolean) {
    const position = this.geometry.attributes.position as THREE.BufferAttribute;
    const point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      if (enabled) bendPoint(this.rest[i * 3], this.rest[i * 3 + 1], this.bounds, settings, point);
      else point.set(this.rest[i * 3], this.rest[i * 3 + 1], 0);
      position.setXYZ(i, point.x, point.y, point.z);
    }
    position.needsUpdate = true;
    this.geometry.computeVertexNormals(); this.geometry.computeBoundingBox(); this.geometry.computeBoundingSphere();
    this.dirty = true;
  }
  /** One double-sided transparent draw, with triangles sorted far-to-near.
   * Re-sort only when bent or the view direction changes; translation doesn't matter. */
  sort(camera: THREE.Camera, root: THREE.Object3D) {
    const view = new THREE.Matrix4().multiplyMatrices(camera.matrixWorldInverse, root.matrixWorld).elements;
    const direction = new THREE.Vector3(view[2], view[6], view[10]);
    if (!this.dirty && direction.distanceToSquared(this.direction) < 1e-12) return;
    this.direction.copy(direction); this.dirty = false;
    const p = this.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < this.order.length; i++) {
      let depth = 0;
      for (let j = 0; j < 3; j++) { const v = this.triangles[i * 3 + j]; depth += p.getX(v) * direction.x + p.getY(v) * direction.y + p.getZ(v) * direction.z; }
      this.depths[i] = depth;
    }
    this.order.sort((a, b) => this.depths[a] - this.depths[b]);
    const index = this.geometry.index!;
    for (let i = 0; i < this.order.length; i++) for (let j = 0; j < 3; j++) index.setX(i * 3 + j, this.triangles[this.order[i] * 3 + j]);
    index.needsUpdate = true;
  }
  handle(corner: StickerCorner, settings: StickerSettings) {
    const point = cornerPoint(this.bounds, corner);
    return bendPoint(point.x, point.y, this.bounds, settings, point);
  }
  projectedBounds(settings: StickerSettings, root: THREE.Object3D, camera: THREE.Camera) {
    // Sample the visible rectangle, not invisible PNG padding, including curved edges.
    const box = new THREE.Box2(), point = new THREE.Vector3();
    for (let y = 0; y <= STICKER.segments; y++) for (let x = 0; x <= STICKER.segments; x++) {
      bendPoint(THREE.MathUtils.lerp(this.bounds.minX, this.bounds.maxX, x / STICKER.segments),
        THREE.MathUtils.lerp(this.bounds.minY, this.bounds.maxY, y / STICKER.segments), this.bounds, settings, point);
      point.applyMatrix4(root.matrixWorld).project(camera); box.expandByPoint(new THREE.Vector2(point.x, point.y));
    }
    return box;
  }
}

export function stickerMaterial(texture: THREE.Texture) {
  const material = new THREE.MeshStandardMaterial({ map: texture, color: '#ffffff', roughness: STICKER.roughness,
    metalness: 0, envMapIntensity: 0, alphaTest: CONTENT.imageAlphaTest, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  material.forceSinglePass = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.stickerBacking = { value: new THREE.Color(STICKER.backingColor) };
    shader.fragmentShader = 'uniform vec3 stickerBacking;\n' + shader.fragmentShader.replace('#include <map_fragment>',
      '#include <map_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb = stickerBacking;');
  };
  material.customProgramCacheKey = () => 'sticker-backing-v1';
  return material;
}
