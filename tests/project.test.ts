import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTENT } from '../src/config.ts';
import { createTextItem, parseProject, serializeProject, validateItem, validateProject } from '../src/project.ts';
import type { StudyProject } from '../src/project.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';

const project = (): StudyProject => ({ format: 'edison-light-study', version: 2, lighting: { ...DEFAULT_SETTINGS }, motionEnabled: true, items: [] });

test('portable projects round-trip every content treatment and embedded images', () => {
  const value = project();
  value.items = ['html', 'flat', 'solid'].map((treatment) => ({ ...createTextItem(), treatment } as ReturnType<typeof createTextItem>));
  value.items.push({ id: 'image', kind: 'image', imageData: 'data:image/png;base64,YWJj', width: CONTENT.width.default,
    x: 0, y: 0, offset: 0.1, alt: 'Portable pixels' });
  assert.deepEqual(parseProject(serializeProject(value)), validateProject(value));
});

test('malformed versions, duplicate IDs, invalid numbers and remote images are rejected', () => {
  assert.throws(() => parseProject('bad json'), /JSON/);
  assert.throws(() => validateProject({ ...project(), version: 3 }), /version/);
  const item = createTextItem();
  assert.throws(() => validateProject({ ...project(), items: [item, item] }), /duplicate/);
  assert.throws(() => validateItem({ ...item, x: Infinity }), /X position/);
  assert.throws(() => validateItem({ ...item, thickness: CONTENT.thickness.max + 1 }), /Thickness/);
  assert.throws(() => validateItem({ ...item, text: ' ' }), /Enter some text/);
  assert.throws(() => validateItem({ ...item, kind: 'image', imageData: 'https://example.com/image.png', width: 0.2, alt: '' }), /embedded/);
  assert.throws(() => validateProject({ ...project(), items: Array.from({ length: CONTENT.maxItems + 1 }, createTextItem) }), /up to/);
});

test('validation keeps input immutable and drops unrecognized fields', () => {
  const value = project();
  const source = JSON.stringify(value);
  validateProject({ ...value, unexpected: 'ignored' });
  assert.equal(JSON.stringify(value), source);
  assert.equal('unexpected' in validateProject({ ...value, unexpected: true }), false);
});
