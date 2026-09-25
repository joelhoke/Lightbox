import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import type { Font } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { CONTENT, STICKER } from './config.ts';
import { decodeImage, validateItem, validateImageAppearance, defaultSticker, STICKER_CORNERS } from './project.ts';
import type { SceneItem, TextItem, ImageStickerPatch } from './project.ts';
import { StickerSurface, stickerMaterial, visibleBounds } from './sticker.ts';
import type { StickerBounds } from './sticker.ts';

let fontPromise: Promise<Font> | undefined;
function loadFont() {
  fontPromise ??= new FontLoader().loadAsync(`${import.meta.env.BASE_URL}${CONTENT.fontAsset}`).catch((error) => {
    fontPromise = undefined;
    throw new Error(`The 3D font could not load. ${String(error)}`);
  });
  return fontPromise;
}

export interface RenderedItem {
  record: SceneItem;
  root: THREE.Group;
  html: HTMLDivElement | null;
  description: HTMLElement | null;
  width: number; height: number;
  image?: { mesh: THREE.Mesh; bounds: StickerBounds; surface?: StickerSurface; hoverInfluence?: number };
}

export function disposeItem(item: RenderedItem) {
  item.root.removeFromParent();
  item.html?.remove();
  item.description?.remove();
  item.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial) material.map?.dispose();
      material.dispose();
    }
  });
}

function textCanvas(item: TextItem) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const fontSize = 128;
  context.font = `${fontSize}px ${CONTENT.fontFamily}`;
  const lines = item.text.split('\n');
  const naturalWidth = Math.max(1, ...lines.map((line) => context.measureText(line).width)) + 16;
  const naturalHeight = lines.length * fontSize * 1.3 + 16;
  const scale = Math.min(1, CONTENT.maxTextureSize / Math.max(naturalWidth, naturalHeight));
  canvas.width = Math.ceil(naturalWidth * scale);
  canvas.height = Math.ceil(naturalHeight * scale);
  context.scale(scale, scale);
  context.font = `${fontSize}px ${CONTENT.fontFamily}`;
  context.textBaseline = 'top';
  context.fillStyle = '#ffffff';
  lines.forEach((line, index) => context.fillText(line, 8, 8 + index * fontSize * 1.3));
  return { canvas, width: naturalWidth / fontSize * item.size, height: naturalHeight / fontSize * item.size };
}

export async function prepareItem(value: SceneItem): Promise<RenderedItem> {
  const item = validateItem(value);
  const root = new THREE.Group();
  root.name = `content-${item.id}`;
  root.userData.itemId = item.id;
  root.position.set(item.x, item.y, (item.kind === 'text' && item.treatment === 'html' ? 0 : item.offset));
  let html: HTMLDivElement | null = null;
  let width: number, height: number;
  let mesh: THREE.Mesh;
  let imageBounds: StickerBounds | undefined;
  if (item.kind === 'text' && item.treatment === 'solid') {
    const font = await loadFont();
    const missing = [...new Set([...item.text].filter((character) => character !== '\n' && !font.data.glyphs[character]))];
    if (missing.length) throw new Error(`The 3D font does not include ${missing.map((character) => `“${character}”`).join(', ')}. Use HTML or Flat lit for this text.`);
    const geometry = new TextGeometry(item.text, {
      font, size: item.size, depth: item.thickness, curveSegments: 6,
      bevelEnabled: false, steps: 1,
    });
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const center = bounds.getCenter(new THREE.Vector3());
    width = bounds.max.x - bounds.min.x; height = bounds.max.y - bounds.min.y;
    geometry.translate(-center.x, -center.y, 0);
    mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: item.color, roughness: 0.65, metalness: 0, envMapIntensity: 0.15 }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  } else {
    let texture: THREE.Texture | undefined;
    if (item.kind === 'image') {
      const image = await decodeImage(item.imageData);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, CONTENT.maxTextureSize / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
      texture = new THREE.CanvasTexture(canvas);
      width = item.width; height = item.width * image.naturalHeight / image.naturalWidth;
      imageBounds = visibleBounds(canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, width, height);
    } else {
      const rendered = textCanvas(item);
      width = rendered.width; height = rendered.height;
      if (item.treatment === 'html') {
        html = document.createElement('div');
        html.className = 'scene-html';
        html.dataset.itemId = item.id;
        html.textContent = item.text;
        html.style.fontSize = `${item.size * 1000}px`;
        html.style.fontFamily = CONTENT.fontFamily;
        html.style.color = item.color;
      } else texture = new THREE.CanvasTexture(rendered.canvas);
    }
    if (texture) texture.colorSpace = THREE.SRGBColorSpace;
    const material = texture ? new THREE.MeshStandardMaterial({
      map: texture, color: item.kind === 'text' ? item.color : '#ffffff',
      roughness: 0.9, metalness: 0, envMapIntensity: 0,
      alphaTest: item.kind === 'image' ? CONTENT.imageAlphaTest : CONTENT.alphaTest,
      transparent: item.kind === 'image', depthWrite: item.kind !== 'image',
      side: THREE.DoubleSide,
    }) : new THREE.MeshBasicMaterial({ visible: false });
    mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.castShadow = !!texture && item.offset > 0;
    mesh.receiveShadow = !!texture;
    // Three's point-light shadow pass copies map + alphaTest into its distance material.
  }
  root.add(mesh);
  let description: HTMLElement | null = null;
  if (!html) {
    description = document.createElement('p');
    description.textContent = item.kind === 'text' ? item.text : item.alt || 'Image';
  }
  const node: RenderedItem = { record: item, root, html, description, width, height,
    image: imageBounds ? { mesh, bounds: imageBounds } : undefined };
  applyImageTreatment(node);
  return node;
}

export function displayedStickerSettings(node: RenderedItem) {
  const saved = node.record.kind === 'image' ? node.record.sticker ?? defaultSticker() : defaultSticker();
  return { ...saved, curl: saved.curl * (1 - STICKER.hover.strength * (node.image?.hoverInfluence ?? 0)) };
}

function applyImageTreatment(node: RenderedItem) {
  if (node.record.kind !== 'image' || !node.image) return;
  const enabled = node.record.treatment === 'sticker', settings = displayedStickerSettings(node);
  node.root.rotation.z = -THREE.MathUtils.degToRad(node.record.rotation ?? 0);
  const image = node.image;
  if (enabled && !image.surface) {
    image.surface = new StickerSurface(node.width, node.height, image.bounds);
    image.mesh.geometry.dispose(); image.mesh.geometry = image.surface.geometry;
    const previous = image.mesh.material as THREE.MeshStandardMaterial;
    image.mesh.material = stickerMaterial(previous.map!); previous.dispose();
  }
  image.surface?.update(settings, enabled);
  image.mesh.castShadow = node.record.offset > 0 || (enabled && settings.curl > 0);
}

export class ContentLayer {
  readonly nodes = new Map<string, RenderedItem>();
  readonly overlay = document.createElement('div');
  readonly accessible = document.createElement('section');
  private selected: string | null = null;
  private arrange = true;
  private selection = document.createElement('div');
  private disposed = false;
  private generation = 0;
  private revisions = new Map<string, number>();
  private handles = STICKER_CORNERS.map((corner) => {
    const handle = document.createElement('button'); handle.type = 'button';
    handle.className = 'sticker-handle'; handle.dataset.stickerCorner = corner;
    handle.setAttribute('aria-label', `Curl ${corner.replace('-', ' ')} corner`);
    handle.title = `Pull ${corner.replace('-', ' ')} corner`; handle.hidden = true;
    handle.textContent = { 'top-left': '↖', 'top-right': '↗', 'bottom-left': '↙', 'bottom-right': '↘' }[corner];
    return handle;
  });

  constructor(private group: THREE.Group, private container: HTMLElement) {
    this.overlay.className = 'content-overlay is-arranging';
    this.accessible.className = 'sr-only';
    this.accessible.setAttribute('aria-label', 'Scene content');
    this.selection.className = 'content-selection';
    this.selection.hidden = true;
    this.selection.setAttribute('aria-hidden', 'true');
    this.overlay.append(this.selection, ...this.handles);
    container.append(this.overlay, this.accessible);
  }

  get items(): SceneItem[] { return [...this.nodes.values()].map((node) => node.record.kind === 'image'
    ? { ...node.record, sticker: { ...node.record.sticker! } } : { ...node.record }); }

  setHoverInfluence(node: RenderedItem, influence: number) {
    if (!node.image || (node.image.hoverInfluence ?? 0) === influence) return;
    node.image.hoverInfluence = influence;
    applyImageTreatment(node);
  }

  updateImageSticker(id: string, patch: ImageStickerPatch) {
    const node = this.nodes.get(id);
    if (!node || node.record.kind !== 'image') throw new Error('Select an image to edit its sticker treatment.');
    const { treatment, rotation, ...settings } = patch;
    const next = { ...node.record, ...validateImageAppearance({ treatment: treatment ?? node.record.treatment,
      rotation: rotation ?? node.record.rotation,
      sticker: { ...node.record.sticker, ...settings } }) };
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    node.record = next; node.image!.hoverInfluence = 0; applyImageTreatment(node);
  }

  async put(item: SceneItem) {
    if (this.disposed) throw new Error('The scene is closed.');
    if (!this.nodes.has(item.id) && this.nodes.size >= CONTENT.maxItems) throw new Error(`This study supports up to ${CONTENT.maxItems} items.`);
    const generation = this.generation;
    const revision = (this.revisions.get(item.id) ?? 0) + 1;
    this.revisions.set(item.id, revision);
    const node = await prepareItem(item);
    if (this.disposed || generation !== this.generation || this.revisions.get(item.id) !== revision) { disposeItem(node); throw new Error('The scene changed while the item was loading.'); }
    const previous = this.nodes.get(item.id);
    if (previous) disposeItem(previous);
    this.attach(node);
  }

  /** Prepare every asset before touching the active composition. */
  async replace(items: SceneItem[]) {
    const generation = ++this.generation;
    const staged = await Promise.allSettled(items.map(prepareItem));
    const failure = staged.find((result) => result.status === 'rejected');
    if (failure || this.disposed || generation !== this.generation) {
      staged.forEach((result) => { if (result.status === 'fulfilled') disposeItem(result.value); });
      if (failure?.status === 'rejected') throw failure.reason;
      throw new Error('The scene changed while the project was loading.');
    }
    this.nodes.forEach(disposeItem);
    this.nodes.clear();
    staged.forEach((result) => { if (result.status === 'fulfilled') this.attach(result.value); });
    this.selected = null;
  }

  private attach(node: RenderedItem) {
    this.nodes.set(node.record.id, node);
    this.group.add(node.root);
    if (node.html) this.overlay.append(node.html);
    if (node.description) this.accessible.append(node.description);
  }

  remove(id: string) {
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    const node = this.nodes.get(id);
    if (!node) return;
    disposeItem(node);
    this.nodes.delete(id);
    if (this.selected === id) this.selected = null;
  }

  move(id: string, x: number, y: number) {
    const node = this.nodes.get(id);
    if (!node) return;
    node.record = { ...node.record, x, y };
    node.root.position.x = x; node.root.position.y = y;
  }

  select(id: string | null) { this.selected = id; }
  setArrange(arrange: boolean) { this.arrange = arrange; this.overlay.classList.toggle('is-arranging', arrange); }

  project(camera: THREE.PerspectiveCamera) {
    const { width, height } = this.container.getBoundingClientRect();
    this.group.updateWorldMatrix(true, true);
    this.selection.hidden = true;
    this.handles.forEach((handle) => { handle.hidden = true; });
    for (const node of this.nodes.values()) {
      node.image?.surface?.sort(camera, node.root);
      const position = node.root.getWorldPosition(new THREE.Vector3());
      const pixelsPerMetre = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * (camera.position.z - position.z));
      const projected = position.project(camera);
      const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
      if (node.html) {
        node.html.style.left = `${x}px`; node.html.style.top = `${y}px`;
        node.html.style.transform = `translate(-50%, -50%) scale(${pixelsPerMetre / 1000})`;
      }
      if (this.arrange && this.selected === node.record.id) {
        this.selection.hidden = false;
        Object.assign(this.selection.style, { left: `${x}px`, top: `${y}px`, width: `${node.width * pixelsPerMetre + 12}px`, height: `${node.height * pixelsPerMetre + 12}px` });
        if (node.record.kind === 'image' && node.record.treatment !== 'sticker') {
          const bounds = new THREE.Box2();
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
            const p = new THREE.Vector3(sx * node.width / 2, sy * node.height / 2, 0).applyMatrix4(node.root.matrixWorld).project(camera);
            bounds.expandByPoint(new THREE.Vector2(p.x, p.y));
          }
          Object.assign(this.selection.style, { left: `${(bounds.min.x + bounds.max.x + 2) * width / 4}px`, top: `${(2 - bounds.min.y - bounds.max.y) * height / 4}px`,
            width: `${(bounds.max.x - bounds.min.x) * width / 2 + 12}px`, height: `${(bounds.max.y - bounds.min.y) * height / 2 + 12}px` });
        }
        if (node.record.kind === 'image' && node.record.treatment === 'sticker' && node.image?.surface) {
          const settings = displayedStickerSettings(node);
          const bounds = node.image.surface.projectedBounds(settings, node.root, camera);
          Object.assign(this.selection.style, { left: `${(bounds.min.x + bounds.max.x + 2) * width / 4}px`,
            top: `${(2 - bounds.min.y - bounds.max.y) * height / 4}px`,
            width: `${(bounds.max.x - bounds.min.x) * width / 2 + 12}px`, height: `${(bounds.max.y - bounds.min.y) * height / 2 + 12}px` });
          this.handles.forEach((handle, i) => {
            const point = node.image!.surface!.handle(STICKER_CORNERS[i], settings).applyMatrix4(node.root.matrixWorld).project(camera);
            handle.hidden = false; handle.dataset.itemId = node.record.id;
            handle.setAttribute('aria-pressed', String(settings.corner === STICKER_CORNERS[i]));
            Object.assign(handle.style, { left: `${(point.x + 1) * width / 2}px`, top: `${(1 - point.y) * height / 2}px`,
              transform: `translate(-50%, -50%) rotate(${node.record.kind === 'image' ? node.record.rotation ?? 0 : 0}deg)` });
          });
        }
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.generation++;
    this.nodes.forEach(disposeItem);
    this.nodes.clear();
    this.overlay.remove(); this.accessible.remove();
  }
}
