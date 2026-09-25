import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { bendPoint, cornerPoint, StickerSurface, visibleBounds } from '../src/sticker.ts';
import { STICKER_CORNERS, defaultSticker, validateProject, serializeProject, parseProject } from '../src/project.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';

test('visible bounds ignore padding but retain even faint alpha and holes', () => {
  const pixels = new Uint8ClampedArray(10 * 20 * 4);
  pixels[(2 * 10 + 3) * 4 + 3] = 1;
  pixels[(15 * 10 + 8) * 4 + 3] = 255;
  const bounds = visibleBounds(pixels, 10, 20, 1, 2);
  assert.deepEqual(bounds, { minX: -0.2, maxX: 0.4, minY: 2 * (0.5 - 0.8), maxY: 0.8 });
  assert.deepEqual(visibleBounds(new Uint8ClampedArray(16), 2, 2, 1, 1), { minX: -0.5, maxX: 0.5, minY: -0.5, maxY: 0.5 });
});

test('cylindrical curl is symmetric, flat outside the peel and finite at all extremes', () => {
  for (const [width, height] of [[0.4, 0.4], [0.2, 0.7], [0.7, 0.2]]) {
    const bounds = { minX: -width / 2, maxX: width / 2, minY: -height / 2, maxY: height / 2 };
    for (const curl of [0, 70, 100]) for (const peelArea of [10, 35, 75]) {
      let elevation: number | undefined;
      for (const corner of STICKER_CORNERS) {
        const settings = { corner, curl, peelArea }, point = cornerPoint(bounds, corner);
        const bent = bendPoint(point.x, point.y, bounds, settings);
        assert.ok([bent.x, bent.y, bent.z].every(Number.isFinite));
        assert.ok(bent.z >= 0);
        if (elevation !== undefined) assert.ok(Math.abs(elevation - bent.z) < 1e-10);
        elevation = bent.z;
        if (curl === 0) assert.deepEqual(bent, point);
        assert.deepEqual(bendPoint(-point.x, -point.y, bounds, settings), new THREE.Vector3(-point.x, -point.y, 0));
      }
    }
  }
});

test('deformation and triangle sorting reuse buffers, preserve UVs and generate back-facing normals', () => {
  const surface = new StickerSurface(0.4, 0.4, { minX: -0.2, maxX: 0.2, minY: -0.2, maxY: 0.2 });
  const geometry = surface.geometry, positions = geometry.attributes.position.array, indices = geometry.index!.array;
  const uv = geometry.attributes.uv.array.slice();
  const camera = new THREE.PerspectiveCamera(); camera.position.z = 2; camera.updateMatrixWorld();
  const root = new THREE.Group(); root.updateMatrixWorld();
  surface.update({ ...defaultSticker(), curl: 100, peelArea: 75 }, true);
  surface.sort(camera, root);
  assert.equal(geometry.attributes.position.array, positions);
  assert.equal(geometry.index!.array, indices);
  assert.deepEqual(geometry.attributes.uv.array, uv);
  assert.ok(geometry.boundingBox!.max.z > 0.1);
  const normals = geometry.attributes.normal;
  assert.ok(Array.from({ length: normals.count }, (_, i) => normals.getZ(i)).some((z) => z < -0.5));
  for (let i = 0; i < normals.count; i++) assert.ok(Math.abs(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) - 1) < 1e-5);
  surface.update(defaultSticker(), false);
  assert.equal(geometry.boundingBox!.max.z, 0);
  geometry.dispose();
});

const image = { id: 'sticker', kind: 'image', imageData: 'data:image/png;base64,YWJj', width: 0.4,
  x: 0, y: 0, offset: 0, alt: 'Sticker', treatment: 'sticker', rotation: -35, sticker: defaultSticker() };
const project = () => ({ format: 'edison-light-study', version: 2, lighting: { ...DEFAULT_SETTINGS }, motionEnabled: true, items: [image] });
test('v2 saves sticker settings and rotation; v1 migrates images to flat without changing placement', () => {
  const normalized = validateProject(project());
  assert.deepEqual(parseProject(serializeProject(normalized)), normalized);
  const legacy = validateProject({ ...project(), version: 1 });
  assert.equal(legacy.version, 2);
  const migrated = legacy.items[0];
  assert.equal(migrated.kind, 'image');
  if (migrated.kind === 'image') {
    assert.equal(migrated.treatment, 'flat'); assert.equal(migrated.rotation, 0);
    assert.deepEqual(migrated.sticker, defaultSticker()); assert.equal(migrated.width, image.width);
  }
});
test('invalid sticker and rotation values reject the whole project without mutating input', () => {
  const source = project(), before = JSON.stringify(source);
  for (const patch of [{ treatment: 'cloth' }, { rotation: 181 }, { rotation: NaN },
    ...[{ corner: 'center' }, { curl: -1 }, { curl: 101 }, { peelArea: 9 }, { peelArea: 76 }].map((p) => ({ sticker: { ...defaultSticker(), ...p } }))]) {
    assert.throws(() => validateProject({ ...source, items: [image, { ...image, id: 'invalid', ...patch }] }));
  }
  assert.equal(JSON.stringify(source), before);
});
