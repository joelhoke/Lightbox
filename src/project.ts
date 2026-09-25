import { CONTENT, LIGHTING, STICKER } from './config.ts';
import type { NumericRange } from './config.ts';
import { normalizeHex } from './settings.ts';
import type { LightingSettings } from './settings.ts';

export type TextTreatment = 'html' | 'flat' | 'solid';
export type ImageTreatment = 'flat' | 'sticker';
export const STICKER_CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
export type StickerCorner = typeof STICKER_CORNERS[number];
export interface StickerSettings { corner: StickerCorner; curl: number; peelArea: number }
export type ImageStickerPatch = Partial<StickerSettings> & { treatment?: ImageTreatment; rotation?: number };
export const defaultSticker = (): StickerSettings => ({ corner: STICKER.corner, curl: STICKER.curl.default, peelArea: STICKER.peelArea.default });
interface Placement { id: string; x: number; y: number; offset: number }
export interface TextItem extends Placement {
  kind: 'text'; text: string; treatment: TextTreatment;
  size: number; color: string; thickness: number;
}
export interface ImageItem extends Placement {
  kind: 'image'; imageData: string; width: number; alt: string;
  /** Optional on input for existing scene callers; validation fills all three fields. */
  treatment?: ImageTreatment; sticker?: StickerSettings; rotation?: number;
}
export type SceneItem = TextItem | ImageItem;
export interface StudyProject {
  format: 'edison-light-study'; version: 2;
  lighting: LightingSettings; motionEnabled: boolean; items: SceneItem[];
}

const record = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, max: number): string => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${label} must be text of at most ${max} characters.`);
  return value;
};
const number = (value: unknown, label: string, range: NumericRange): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < range.min || value > range.max) {
    throw new Error(`${label} must be between ${range.min} and ${range.max}.`);
  }
  return value;
};
const color = (value: unknown, label: string): string => {
  const result = typeof value === 'string' ? normalizeHex(value) : null;
  if (!result) throw new Error(`${label} must be a hex color, like #ffb36b.`);
  return result;
};

export function validateItem(value: unknown): SceneItem {
  const item = record(value, 'Item');
  const id = text(item.id, 'Item ID', 80);
  if (!/^[\w-]+$/.test(id)) throw new Error('Item ID must use letters, numbers, underscores, or hyphens.');
  const placement = {
    id, x: number(item.x, 'X position', CONTENT.x), y: number(item.y, 'Y position', CONTENT.y),
    offset: number(item.offset, 'Distance off wall', CONTENT.offset),
  };
  if (item.kind === 'text') {
    if (!['html', 'flat', 'solid'].includes(String(item.treatment))) throw new Error('Unknown text treatment.');
    const value = text(item.text, 'Text', CONTENT.maxTextLength);
    if (!value.trim()) throw new Error('Enter some text before applying.');
    return { ...placement, kind: 'text', text: value, treatment: item.treatment as TextTreatment,
      size: number(item.size, 'Text size', CONTENT.size), color: color(item.color, 'Text color'),
      thickness: number(item.thickness, 'Thickness', CONTENT.thickness) };
  }
  if (item.kind === 'image') {
    const imageData = text(item.imageData, 'Image', Math.ceil(CONTENT.maxImageBytes * 4 / 3) + 100);
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(imageData)) {
      throw new Error('Images must be embedded PNG, JPEG, or WebP data. External URLs are not supported.');
    }
    return { ...placement, kind: 'image', ...validateImageAppearance(item), imageData, width: number(item.width, 'Image width', CONTENT.width),
      alt: text(item.alt, 'Alternative text', CONTENT.maxTextLength) };
  }
  throw new Error('Unknown content type.');
}

/** Shared by imports and live edits; dragging never rescans the embedded PNG. */
export function validateImageAppearance(value: unknown): Required<Pick<ImageItem, 'treatment' | 'sticker' | 'rotation'>> {
  const item = record(value, 'Image appearance');
  const treatment = item.treatment === undefined ? 'flat' : item.treatment;
  if (treatment !== 'flat' && treatment !== 'sticker') throw new Error('Unknown image treatment.');
  return { treatment, sticker: item.sticker === undefined ? defaultSticker() : validateSticker(item.sticker),
    rotation: item.rotation === undefined ? CONTENT.rotation.default : number(item.rotation, 'Image rotation', CONTENT.rotation) };
}

export function validateSticker(value: unknown): StickerSettings {
  const sticker = record(value, 'Sticker settings');
  if (!STICKER_CORNERS.includes(sticker.corner as StickerCorner)) throw new Error('Choose a valid sticker corner.');
  return { corner: sticker.corner as StickerCorner,
    curl: number(sticker.curl, 'Curl amount', STICKER.curl), peelArea: number(sticker.peelArea, 'Peel area', STICKER.peelArea) };
}

export function validateProject(value: unknown): StudyProject {
  const project = record(value, 'Project');
  if (project.format !== 'edison-light-study' || (project.version !== 1 && project.version !== 2)) throw new Error('This is not a supported light-study project (version 1 or 2).');
  const settings = record(project.lighting, 'Lighting settings');
  if (settings.lightMode !== 'temperature' && settings.lightMode !== 'custom') throw new Error('Unknown light color mode.');
  if (typeof project.motionEnabled !== 'boolean') throw new Error('Project motion setting is missing.');
  if (!Array.isArray(project.items) || project.items.length > CONTENT.maxItems) throw new Error(`A project can contain up to ${CONTENT.maxItems} items.`);
  const items = project.items.map((value) => {
    const item = record(value, 'Item');
    // v1 never defined image treatments. Migrate without interpreting unknown extras.
    return validateItem(project.version === 1 && item.kind === 'image' ? { ...item, treatment: 'flat', sticker: defaultSticker(), rotation: 0 } : item);
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error('Project contains duplicate item IDs.');
  return {
    format: 'edison-light-study', version: 2, motionEnabled: project.motionEnabled,
    lighting: {
      brightness: number(settings.brightness, 'Brightness', LIGHTING.brightness),
      temperature: number(settings.temperature, 'Temperature', LIGHTING.temperature),
      wallDistance: number(settings.wallDistance, 'Wall distance', LIGHTING.wallDistance),
      lightMode: settings.lightMode,
      customLightColor: color(settings.customLightColor, 'Light color'), wallColor: color(settings.wallColor, 'Wall color'),
    }, items,
  };
}

export function parseProject(source: string): StudyProject {
  if (new TextEncoder().encode(source).length > CONTENT.maxProjectBytes) throw new Error('Project file is too large.');
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('Project file is not valid JSON.'); }
  return validateProject(value);
}

export function serializeProject(project: StudyProject): string {
  const result = JSON.stringify(validateProject(project), null, 2);
  if (new TextEncoder().encode(result).length > CONTENT.maxProjectBytes) throw new Error('Project exceeds the export size limit. Remove some large images first.');
  return result;
}

export const createTextItem = (): TextItem => ({
  id: crypto.randomUUID(), kind: 'text', text: CONTENT.text, treatment: 'html',
  x: CONTENT.x.default, y: CONTENT.y.default, offset: CONTENT.offset.default,
  size: CONTENT.size.default, color: CONTENT.color, thickness: CONTENT.thickness.default,
});

export async function decodeImage(imageData: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = imageData;
  try { await image.decode(); } catch { throw new Error('The image could not be decoded. Try another PNG, JPEG, or WebP.'); }
  if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > CONTENT.maxImagePixels) {
    throw new Error(`Image must contain fewer than ${CONTENT.maxImagePixels.toLocaleString()} pixels.`);
  }
  return image;
}

export async function importImage(file: File): Promise<ImageItem> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choose a PNG, JPEG, or WebP image.');
  if (file.size > CONTENT.maxImageBytes) throw new Error(`Images must be smaller than ${CONTENT.maxImageBytes / 1024 / 1024} MB.`);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image file could not be read.'));
    reader.readAsDataURL(file);
  });
  const image = await decodeImage(data);
  const scale = Math.min(1, CONTENT.maxTextureSize / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
  // Lossless PNG retains transparency; export contains pixels, never a file-system path.
  return validateItem({ id: crypto.randomUUID(), kind: 'image', imageData: canvas.toDataURL('image/png'),
    width: CONTENT.width.default, alt: file.name.replace(/\.[^.]+$/, ''),
    x: CONTENT.x.default, y: CONTENT.y.default, offset: CONTENT.offset.default }) as ImageItem;
}
