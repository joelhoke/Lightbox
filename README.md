# Interactive Edison light study

A hanging Edison bulb, an elastic cord, and an editable wall. Built with Three.js, TypeScript, and Vite as a local experiment for future integration with joelhoke.me.

## Run

Use Node.js 22.18+ or a current LTS release.

```sh
npm install
npm run dev
```

`npm run build` type-checks and builds to `dist/`. `npm run preview` serves that build; rebuild before expecting source changes in the production preview. `npm test` checks settings, physics, glass capture, sticker geometry, and project validation.

## Try it

- Grab the bulb with a mouse or touch, lift it, and release. The cord starts at 31 cm and can feed out up to 10 cm more from the ceiling when pulled. It retains the original 15% elastic allowance, goes slack when lifted, and gently reels back in while swinging after release. Reset bulb returns it to its starting position. Disable Release motion for immediate return on release; reduced-motion preferences start with this disabled.
- Use **+ Text** or **+ Image**, or drop a PNG/JPEG/WebP onto the scene. Images stay on your device.
- **Arrange** selects and drags content. **Preview** removes selection outlines and allows normal HTML text selection. The bulb remains draggable in either mode. In Preview, hovering near a curled sticker corner gently relaxes it, then restores its saved shape when you move away. Reduced motion disables this decorative response.
- Select an item, edit its inspector, and click **Apply changes**. Numeric positions and sizes are in metres. Image proportions are preserved.
- Images also have live **Rotation** controls (−180° to 180°, clockwise) and an optional **Sticker** treatment. Pick a corner, adjust **Curl amount** and **Peel area**, or pull a corner handle inward. These controls apply immediately. The remaining inspector fields still use **Apply changes**.
- Text treatments: **HTML** is ordinary selectable text; **Flat lit** receives illumination; **Solid 3D** adds actual thickness and shadows. Distance off wall and letter thickness are independent controls.
- Open **Lighting** for brightness, temperature/custom color, wall color, and wall distance. **Reset lighting** only resets lighting.
- **Save project** downloads JSON with the current applied content and embedded images. **Load project** replaces the composition only after the entire file and its assets validate. It returns the bulb to rest. There is no autosave; save before reloading or leaving.

HTML is a DOM overlay: it does not receive 3D lighting, cast shadows, or obey WebGL occlusion. The bulb moves in a plane parallel to the wall; collisions and cord wrapping are not simulated. Coordinates are preserved on resize, so a wide composition can extend beyond a narrow viewport; use the item list and numeric positions to bring content back into view.

## Editing and integration

Read [WALKTHROUGH.md](WALKTHROUGH.md) for the file map, implementation reasons, tuning values, limits, and validation details. Start tuning in `src/config.ts`: UI ranges and validation share one definition.

`createLightingScene(container)` returns:

- `ready`, `settings`, `updateSettings(patch)`, and `reset()` for loading and lighting.
- `items`, `addItem(item)`, `updateItem(item)`, `removeItem(id)`, and `selectItem(id)` for content. Add/update/load are asynchronous; await them.
- `updateImageSticker(id, patch)` synchronously validates and applies image `rotation`, `treatment`, `corner`, `curl`, and `peelArea` without decoding the image again.
- `setArrangeMode(value)`, `setMotionEnabled(value)`, and `resetBulb()`.
- `exportProject()` and `loadProject(value)`. `src/project.ts` handles JSON parsing/serialization and file-size checks. Exports use version 2; version 1 files still load as Flat images with zero rotation.
- `contentGroup` for future wall-local meshes, with positive Z toward the bulb; `invalidate()` requests a frame.
- `dispose()` to release graphics resources, content, observers, and input listeners. Do not share disposable scene resources with another scene.

The container must have nonzero dimensions. Listen for `study-change` to synchronize UI and `lighting-error` for graphics failures. Rendering runs while the bulb is moving and sleeps after it settles.

## Browser checks

With the dev server running:

- `/tests/browser.html` exercises WebGL, controls, content types, file round-trips, failed-import recovery, resize, and disposal. Includes a 390 × 700 mobile viewport. Keep the tab visible while tests run.
- `/tests/visual.html` is an editable comparison of HTML, flat and solid lettering, and a transparent image. Drag the bulb to compare shadows.
- `/tests/glass.html` compares background refraction over a colored PNG grid with soft fades and a transparent window. The coil stays undistorted. Tune background lens strength with `GLASS.opticalDepth` in `src/config.ts` (currently `0.03` metres).
- `/tests/sticker.html` compares a circular flower sticker and a padded PNG with a transparent hole/fade. It includes rotation, corner handles, floating/mounted shadows, and 3D text. Add `?hover` to open it in Preview for the temporary hover response.
- `/tests/release.html` displays a local pointer-event trace for comparing drag/release behavior between browsers, including capture loss and the actual motion setting.

Test pages are not included in the production build.

## Credits

Based on [Edison Light Bulb](https://sketchfab.com/3d-models/edison-light-bulb-aeb0e4832f04463280510e550e2cdbd5) by [Fishboe](https://sketchfab.com/ministephen), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Original files and license remain in `public/models/edison/`; model orientation, materials, and thread visibility change at runtime.

Solid text uses the Three.js Helvetiker typeface asset, copyright MAGENTA Ltd. Its embedded font information and complete license are retained in `public/fonts/`. Font loading is local.
