# Interactive light and content walkthrough

The latest update adds curled image stickers and clockwise image rotation, on top of the enclosed socket, draggable cord, text/image editing, and portable project files. See the sticker section below for its controls and tuning. The initial composition remains empty. Use the development server while editing; the production preview only changes after rebuilding.

## File map and decisions

| File | Role and reason |
| --- | --- |
| `src/config.ts` | Lighting defaults, ranges, cord tuning, content limits, and rendering settings. Controls and validation read the same values. |
| `src/settings.ts` | Normalizes lighting inputs and converts warm temperature values to RGB. |
| `src/physics.ts` | Independent 2D cord simulation with fixed timesteps, ceiling payout/retraction, compliant segment constraints, gravity, damping, and a hard stretch cap. Independent of Three.js so motion is testable. |
| `src/scene.ts` | Assembles the fixture, wall, light, and camera. Coordinates dragging, simulation, content, and cleanup. Bulb/socket/light move together; ceiling anchor stays fixed. |
| `src/rendering.ts` | Filament-only bloom and final color output. Strongly lit white text/images remain illuminated surfaces instead of acquiring a halo. |
| `src/content.ts` | Converts records into HTML or meshes, positions HTML, draws selection bounds, and disposes replaced resources. Prepares imported assets before committing them. |
| `src/editor.ts` | Item list, inspector, Arrange/Preview, images, project files, and motion controls. Rotation and sticker controls update live; Apply changes commits the other inspector fields. |
| `src/sticker.ts` | Cylindrical surface deformation, visible PNG bounds, transparent triangle ordering, and warm-white backing. |
| `src/sticker-interaction.ts` | Corner gestures, rotation-aware drag directions, keyboard control, and cancellation. |
| `src/project.ts` | Typed content records, validation, image import, and JSON. Exports embed pixels instead of temporary URLs or local file paths. |
| `src/controls.ts` | Lighting panel driven by shared ranges. Reset lighting is separate from Reset bulb and deleting content. |
| `src/style.css` | Panel layout, mobile scrolling, selection borders, HTML overlay. CSS changes do not change the wall material. |
| `src/main.ts` / `index.html` | Connect scene, editor, controls, and loading/error states. Only one tools section is open at a time. |
| `public/fonts/` | Local Helvetiker typeface and license. Original bulb files remain in `public/models/edison/`. |
| `tests/` | Unit tests, browser integration checks, and a development-only visual comparison page. |

`dist/` and `node_modules/` are generated/installed output: edit source instead. The personal walkthrough skill lives outside this project at `~/.codex/skills/project-walkthrough/` for use across projects.

## Text, images, and lighting

**HTML** is real selectable text in Preview mode. It is projected to its wall position but remains a browser overlay: no lighting, shadows, or WebGL occlusion.

**Flat lit** draws text onto a transparent texture on a plane. It receives light, and when lifted its shadow follows the glyphs rather than the texture rectangle.

**Solid 3D** extrudes font outlines into actual geometry. Fronts and sides receive light. Thickness and wall offset independently affect shadows. The bundled font has a finite glyph set; unsupported characters produce an error. HTML and Flat lit can use normal browser font fallback.

Images use lit planes or curled sticker surfaces with alpha-aware shadows. Width preserves aspect ratio. PNG transparency gradients blend smoothly into the scene. Transparent holes allow light through; shadows still approximate image alpha using a cutoff, rather than physically accurate partial or colored transmission.

Filament emission, emitted illumination, and bloom are distinct effects. Brightness drives the first two together; bloom is restricted to the filament. Wall distance moves the wall and its content while leaving the bulb's depth fixed.

## Good manual edits

These values live in `src/config.ts`. Distances are metres. They are design choices unless a technical constraint is called out.

| Setting | Default | What changing it does |
| --- | --- | --- |
| `LIGHTING.brightness` | 0–200, step 1, default 100 | Set `max` to 300 to extend the slider **and** validator. No duplicated clamp to update. `default` controls startup and Reset lighting. |
| `LIGHTING.temperature` | 1800–4000 K, default 2400 | Lower is amber. A broad daylight/blue range needs a fuller conversion algorithm in `settings.ts`, not only a larger maximum. |
| `LIGHTING.wallColor` | `#303030` | Changes material color before illumination, not the final pixel color. |
| `LIGHTING.intensity` | 1.4 | Actual light emitted at 100%. Increase for stronger wall/content illumination. |
| `LIGHTING.filamentEmission` | 7 | Visible filament brightness; increase independently of illumination. |
| `LIGHTING.bloom` | strength .32, radius .35, threshold 1.1 | Controls the filament halo; too much can obscure the loops. |
| `LIGHTING.ambient` | .22 | Raise for more shadow/off-state visibility; lower for stronger contrast. |
| `CORD.length` | .31 m | Relaxed cable length. It stretches slightly under the bulb's weight. Review anchor placement if changing resting height. |
| `CORD.compliance` | .00004 | Higher means softer springs; zero means rigid segment constraints. |
| `CORD.maxStretch` | .15 | Original elastic allowance beyond the deployed cord length. This is stretch, not extra cord. |
| `CORD.extraLength` | .10 m | Extra cord available from the ceiling: 31 cm → 41 cm deployed length. Increase for more reach without softening the springs. |
| `CORD.payoutSpeed` | .25 m/s | Maximum feed-out speed while dragging beyond the deployed length. Higher catches up to a fast pull sooner. |
| `CORD.retractSpeed` | .035 m/s | Constant reel-in speed after release, while swinging. Higher returns sooner; 10 cm takes about 2.9 seconds. |
| `CORD.damping` | 1.8 per second | Higher settles sooner; lower swings longer. |
| `CORD.gravity` | 9.81 m/s² | Lower for slower, stylized movement. Masses/compliance are visual tuning, not a measured replica. |
| `CORD.maxReleaseSpeed` | 1.6 m/s | Limits flick energy. Raise for energetic throws and retest extreme releases. |
| `CONTENT.thickness` | .001–.06 m, default .01 | Solid-letter extrusion: .01 is 1 cm. Independent of wall offset. |
| `CONTENT.offset` | 0–.3 m, default 0 | Moves the back of lit content from the wall toward the camera. HTML stays wall-aligned. |
| `CONTENT.size` | .015–.2 m, default .06 | Font size in world units, not pixels or exact cap height. Camera distance affects its displayed size. |
| `CONTENT.width` | .05–1.5 m, default .38 | Image width; height follows its proportions. |
| `VIEW.socketTop` / `socketBottom` | .34 / .249 m | Socket enclosure dimensions. Review these together if changing `bulbHeight`, and inspect the glass neck. |
| `VIEW.maxPixelRatio` | 2 | Render-resolution cap. Raising 2 to 3 can increase pixel work by 2.25× on a suitable screen; CSS layout stays the same. |

Use the inspector for one composition. Change configuration for a different default or permitted range across all compositions. Edit `CONTENT.text`, `color`, and `size.default` to change newly added text. Edit `style.css` for panel appearance and `editor.ts` for labels or available fields.

## Limits and changes that need more care

Content limits are **20 items**, **240 text characters**, **10 MB per imported image**, **32 million decoded pixels**, a **2048-pixel maximum texture side**, and **50 MB per project file**. These protect geometry generation, point-light shadow work, memory, and embedded JSON size. They are adjustable budgets, not universal Three.js limits. Reducing them can make previously saved, larger projects fail validation.

Cord timestep, solver iterations, mass ratio, and substep count interact. Small damping/compliance edits are easy experiments; changing the solver, adding collisions, moving in full 3D, or wrapping the cord deserves coordinated implementation and tests.

Changing the save format affects types, validation, rendering, editor UI, and tests. Bump the format version if old files become incompatible. Native HTML cannot acquire physical shadows through a CSS change; use a lit-text treatment.

Project files contain applied changes only. There is no browser autosave. Save before reloading, leaving, or editing source that may trigger a development reload. Wide world-space layouts can extend outside a narrow viewport; use the item list and numeric positions to recover offscreen items.

## Verification

- Production build and TypeScript checks pass.
- Nineteen unit tests cover settings, serialization/validation, and deterministic motion: bounded payout/stretch, unchanged lower-segment lengths, ceiling splits/merges, slack, re-grabbing, retraction, settling, timestep behavior, and reduced-motion release.
- Chrome browser checks pass for content modes, real image decoding, project round-trips, failed-import preservation, reset, resize, repeated edits, and disposal/remounting. No captured console/runtime errors in the suite.
- Desktop visual checks confirm the enclosed socket, moving light, letter-shaped shadows, transparent image shadows, and filament-only bloom. A 390 × 700 Chrome iframe checks mobile layout; it is not a physical touch-device test.
- Safari now has a visual confirmation of the restored glass/filament and aligned illumination. Full Safari interaction and physical touch-device verification remain outstanding.
- Save project was exercised through Chrome and produced a valid JSON file with all three text treatments and an embedded PNG. The native macOS Load picker check remains unverified because UI automation mis-targeted the dialog; scene-level import and round-trip checks passed. The subsequent bulb/PNG update completed the full Chrome browser suite successfully, including resize and disposal.
- The personal skill passes the bundled skill validator.

After behavior edits, run `npm test` and `npm run build`. Use `/tests/browser.html` for integration checks and `/tests/visual.html` for the content comparison. Keep browser-test tabs visible while they run.

## Bulb alignment, stable rendering, and PNG fades

The filament center is now measured before the model joins the moving fixture. This avoids depending on a parent world matrix that may not have been updated when cached assets load before the first frame. Wall distance also uses the light's world position. Regression checks compare the actual light and filament positions at rest and at both rotation directions.

The cord uses the original spring softness, damping, gravity, and 15% stretch limit. It starts with 31 cm of cord, and up to 10 cm more can feed from the ceiling when dragged beyond the deployed length. Moving inward retains that length and creates slack. Release starts constant-speed retraction while the original solver handles the swing. Re-grabbing pauses retraction; reset, cancellation, and a motion-disabled release return immediately to the original pose.

Length changes are confined to the ceiling end. The leading segment grows from one to two normal segment lengths, then splits; retraction reverses this. New particles interpolate current and previous positions, while surviving lower particles retain theirs. The rendered cord reserves enough instances for the maximum payout and changes only its active count. Changing `extraLength` automatically adjusts this capacity.

The full-payout maximum is 41 cm of cord plus the original 15% elastic allowance (47.15 cm total). Length and elastic allowance are separate; increasing `extraLength` does not change spring softness. This behavior is independent of viewport width. Deployed length is transient and is not saved into project JSON. `horizontalReach` and `recoilRate` are not used.

For a smaller pull, change `CORD.extraLength` from `.10` to `.05`; this provides 5 cm extra and halves the full retraction duration at the same speed. To preserve a three-second retraction with a different allowance, set `retractSpeed` to roughly `extraLength / 3`. Review both the ceiling anchor and socket starting height if changing the base cord length.

Image materials now use alpha blending with depth writes disabled, preserving soft PNG fades. `CONTENT.imageAlphaTest = 1 / 255` discards only effectively invisible image pixels; the existing `.1` cutoff remains for flat text. Image shadows still use a silhouette approximation. The bloom masking pass preserves the image's blending settings too.

The browser harness captures pixels during `study-render`, before WebGL discards its drawing buffer, and waits for a rendered resize instead of assuming it finishes within 100 ms.

Validation for this fix: production build passes, all 19 unit tests pass, and the expanded Chrome browser suite reports ALL CHECKS PASSED. Safari visually confirms the restored bulb and aligned light. Physical touch-device testing remains unverified.

The remaining bulb disappearance was reproduced by sampling actual filament pixels over repeated frames. Glass refraction in the bloom pass caused the later-frame failure. That pass now omits the glass while retaining filament emission; the main pass draws the glass normally. The regression checks cover repeated frames, brightness changes, added content, and project loading. The earlier transform-only checks could not detect this rendering failure.

Prior visual check for the bulb-rendering fix: Chrome shows the complete bulb with all text/image treatments present, and during a real mouse drag/release with changing shadows. The expanded browser suite and all 19 unit tests pass; production build passes. Physical touch testing remains unverified.

## Limited ceiling payout validation

All 19 unit tests and the production build pass. The expanded Chrome suite passes ceiling segment allocation, payout with a visible filament, touch-pointer cancellation, motion-disabled release, existing content/project checks, resizing, and disposal. Touch events in that suite are synthetic and stub native capture acquisition; physical touch-device behavior is not claimed as tested. A real mouse drag/release in Chrome was also visually inspected with all text treatments and a fading PNG present.

The changes are concentrated in `config.ts` (the three payout values and original stretch limit), `physics.ts` (ceiling split/merge and rate-limited payout/retraction), and `scene.ts` (preallocated cord instances with a changing active count). Scene/editor APIs and saved-project format are unchanged.

## Chrome release correction

The release diagnostic captured Chrome sending `lostpointercapture` with `buttons=0` before `pointerup`, while Release motion was enabled. The old capture-loss handler treated this as cancellation and reset the cord. `src/scene.ts` now completes a normal release on capture loss, handles pointerup outside the scene through a window listener, and ignores cancellation/capture-loss events from unrelated pointers. Completion remains idempotent: later release events cannot reset an already released bulb. A genuine matching `pointercancel` still restores the resting pose.

No physics tuning changed for this correction. Cord length, extra payout, stretch, and damping remain in `src/config.ts`; they cannot correct an input event being mistaken for cancellation. `tests/release.html` and `tests/release.ts` provide the local event trace and are excluded from production.

Validation: all 19 unit tests and the production build pass. The Chrome browser suite passes the captured event sequence, subsequent duplicate events, unrelated pointer IDs, release outside the scene, cancellation, motion-disabled release, filament pixels during release, and existing content/PNG checks. The Safari suite was attempted but stalled waiting for a rendered frame, and native UI control reported `noWindowsAvailable`; the updated Safari behavior was not verified in this run. Physical touch-device verification remains outstanding.

## Glass that sees PNGs, with an unchanged coil

Open `/tests/glass.html` for the colored-grid comparison. It includes a soft PNG alpha fade, a transparent window, flat text, and solid text. Drag the bulb over the grid or use the editor to move the image. This page is development-only; the normal scene still starts empty.

Three.js's built-in transmission capture includes opaque objects but omits alpha-blended PNG planes. That made the glass show their wall shadows while missing the images themselves. The new capture includes lit images with their original alpha blending. It does not turn fades into cutouts.

The first version of this update bent the filament as well as the background. Following your feedback, **only the surrounding scene is refracted**. The coil, supports, and socket are captured separately at their original screen positions and composed inside the physical glass shader. Their shape stays unchanged as the background bends. Following your second adjustment, effective optical depth is 3 cm, half the initial 6 cm; optical magnification itself is nonlinear, so this halves the tuning parameter rather than promising an exact 50% image scale change. The normal filament-only bloom still supplies the glow. Glass reflections can alter apparent brightness slightly; they do not magnify the coil.

### File map and rendering decisions

- `src/glass.ts` owns two reusable render targets and the physical-material shader adapter. One capture contains the background and alpha-blended scene content; the other contains the fixture on transparency. The shader bends the first and overlays the second without refraction. Both captures are linear HDR before bloom and final tone mapping. Capture state is restored even if rendering throws.
- `src/rendering.ts` captures these layers before the existing bloom/main composition. Shadows update once and are reused by subsequent passes. All capture work follows the existing render-on-change/motion scheduler; this adds no idle animation loop.
- `src/scene.ts` registers the bulb and its moving fixture with the adapter. `src/config.ts` holds the glass appearance values alongside existing project tuning. The model files, scene/editor API, project format, and physics are unchanged.
- `tests/glass-fixture.ts` and `tests/glass-visual.ts` create the comparison; `tests/glass-checks.ts` adds real pixel regressions to the browser suite; `tests/glass.test.ts` checks capture-state restoration, depth classification, target reuse, and cleanup.

Fully foreground content is omitted from the refraction color capture while retaining its shadows; it draws normally in front of the bulb. Background content keeps its normal depth ordering. Geometry physically intersecting the bulb and multiple nested glass objects are outside this approximation. HTML text remains outside WebGL and cannot be refracted.

Two extra captures cost GPU memory and rendering time while changing or moving. Targets resize with the canvas, use the existing DPR cap of 2, and are disposed with the scene. The interior pass draws only the fixture. Three.js still performs its built-in opaque transmission preparation, although this material samples our own textures; no engine source is patched. This is a screen-space artistic lens, not ray tracing or a physically measured hollow shell. It cannot recover scenery outside the captured view.

### Useful manual edits

All values below live in `GLASS` in `src/config.ts`. They are design defaults, not UI sliders or saved-project properties; source edits apply to every composition after reload.

| Setting | Default | Effect |
| --- | --- | --- |
| `opticalDepth` | `0.03` m | Effective background lens depth. Lower reduces distortion; higher bends the background more. It never changes coil geometry. |
| `ior` | `1.46` | Dimensionless index of refraction. Toward `1` removes bending and reduces edge reflection; higher strengthens both. Keep this near glass values and use optical depth for artistic strength. |
| `roughness` | `0.055` | Dimensionless 0–1 material roughness. Higher softens the transmitted background and reflections; lower makes them sharper. |
| `environmentIntensity` | `0.7` | Reflection intensity multiplier. Raise for stronger environment highlights. |
| `transmission` | `1` | Dimensionless 0–1 amount transmitted. Lower introduces more surface shading and obscures the background. |

For a gentler effect, change `opticalDepth: 0.03` to `0.015`. No related constants need to change: the adapter automatically converts metres to the normalized model's local thickness. Avoid editing `material.thickness` in scene setup; capture updates it from `GLASS.opticalDepth`. The imported model currently uses uniform world scaling; nonuniform rescaling would require revisiting that conversion. Shader-adapter edits and Three.js upgrades deserve regression testing rather than blind string changes.

### Validation for the glass update

- All **22 unit tests** pass, including cleanup and state restoration after failures in either capture pass. Production build and source TypeScript checks pass; the added browser fixture/check modules also pass a separate TypeScript check. Vite retains its existing large-bundle advisory.
- The expanded **Chrome and Safari browser suites both report ALL CHECKS PASSED** at the final 3 cm optical depth. Pixel comparisons confirm image color transmission, clear and half-alpha PNGs, grid displacement, foreground exclusion, and stable coil silhouette (about 94.5% bright-pixel overlap when comparing refractive/non-refractive glass; the remaining difference is material shading/antialiasing).
- Existing repeated-frame filament, brightness/color, content editing, project round-trip, pointer release/cancellation, resize, and disposal/remount checks pass with the new captures. The suites capture no console/runtime errors.
- Desktop and 390 × 700 comparison layouts were inspected. Chrome mouse drag/release was visually checked with the grid, flat text, and 3D text present. The mobile comparison is an iframe, not a physical phone; physical touch-device testing remains outstanding.

## Sticker image treatment and rotation

Open `http://127.0.0.1:5173/tests/sticker.html` while the development server is running for a prepared comparison. The regular page still starts empty. Add an image, select **Sticker**, then use the four corner handles or the inspector. **Rotation** works with both Flat and Sticker images, clockwise in the wall plane around the image center.

**Curl amount**, **Peel area**, **Curled corner**, **Image treatment**, and **Rotation** apply immediately. Width, alternative text, placement, and wall offset still use **Apply changes**. Pull a handle inward along its rotated diagonal to increase curl; outward decreases it. Perpendicular movement does nothing. Release leaves the curl in place. Cancellation restores the corner and amount from the gesture's start. Arrow keys on a focused handle change curl by 1%; Shift changes it by 10%. Enter/Space selects that corner. Preview hides all handles. Switching to Flat preserves the sticker settings for later.

### Files and implementation reasons

| File | What changed and why |
| --- | --- |
| `src/config.ts` | One source for sticker defaults/ranges, mesh density, backing color, and image rotation. Both inspector and validation use these definitions. |
| `src/sticker.ts` | A 64 × 64 subdivided surface bends along a cylinder. The corner keeps its surface length, so the image curves instead of stretching like rubber. PNG alpha bounds establish the corner region without cropping the embedded pixels. Normals and geometry bounds update with the curl. |
| `src/content.ts` | Reuses the decoded texture and vertex buffers for live edits. Rotation belongs to the image's parent group, so geometry, selection, and handles move together. A lifted corner casts shadows at zero base offset. |
| `src/sticker-interaction.ts` | Gives corner handles first claim on a pointer gesture. Converts movement into the rotated image's local coordinates, captures the pointer, and separates a normal release from cancellation. Whole-image and bulb dragging retain their existing paths. |
| `src/editor.ts` / `src/style.css` | Accessible range/number pairs, corner selector, treatment toggle, labeled handles, and synchronized values. The inspector does not rebuild on every movement. |
| `src/project.ts` / `src/scene.ts` | Image records carry `rotation`, `treatment`, and `sticker: { corner, curl, peelArea }`. `updateImageSticker(id, patch)` is synchronous and validates only appearance; it does not rescan/decode the embedded PNG while dragging. Exports use version 2. Version 1 images migrate to Flat with zero rotation. Complete import validation and staged asset decoding still happen before replacing the composition. |
| `src/rendering.ts` | The bloom mask respects the sticker's single-pass transparent drawing. The existing background refraction capture includes the deformed surface with its alpha; the coil remains in its separate undistorted capture. |
| `tests/sticker.test.ts`, `tests/sticker-checks.ts` | Geometry, migration, invalid settings, live buffers, gesture routing, pixel checks, and cleanup. The browser tests join the existing filament/PNG/glass/physics regressions. |
| `tests/sticker-fixture.ts`, `tests/sticker-visual.ts`, `tests/sticker.html` | Locally drawn PNG comparisons: circular cutout, transparent padding, hole, fade, mounted/floating shapes, and 3D text. Nothing downloads or uploads. |

The front and underside share **one surface and one texture**. The material uses the texture's alpha on both sides, but replaces the back-facing RGB with warm-white. This prevents mirrored artwork and avoids two almost-coplanar surfaces flickering against each other. Transparent triangles draw from far to near within each sticker, and are re-sorted only when the shape or view direction changes. This preserves overlap within a folded corner without introducing a continuous idle render loop.

The sticker stays attached to the same wall-local position and keeps the original image's aspect ratio. Transparent padding remains in the image data, but is excluded when measuring the visible bounding rectangle. Width and the rotation pivot still refer to the original whole image; importing an image with asymmetric padding can therefore produce an off-center-looking rotation. A circular silhouette has no pixels in the rectangle's extreme corners: its visible bend/backing is subtler than a rectangular photo at the same settings. Increase peel area to bring more of that silhouette into the bend.

### Good manual edits

These are design limits, not universal Three.js limits. Edit `src/config.ts`, then reload the development page; rebuild for the production preview. Existing saved records retain their values. Changing a default affects new images, not previously saved sticker settings.

| Setting | Present value and units | Effect and linked values |
| --- | --- | --- |
| `CONTENT.rotation` | −180…180°, step 1°, default 0° | Positive turns clockwise. This spans every orientation; larger limits permit equivalent extra turns. Inspector and validation update together. |
| `STICKER.corner` | `bottom-right` | Initial curled corner. The other values are `top-left`, `top-right`, and `bottom-left`. |
| `STICKER.curl` | 0…100%, step 1%, default 70% | Percent of `maxAngle`: 70% × 150° = 105° at the bounding-box corner. Zero leaves the surface flat. Keep the percent endpoints at 0 and 100; use `maxAngle` to change physical bend strength. |
| `STICKER.maxAngle` | 150° | Maximum bend angle, independent of peel area. Higher exposes more underside. Keep below 180° for this single-fold implementation; rolling the paper over itself would need different geometry/ordering checks. |
| `STICKER.peelArea` | 10…75%, step 1%, default 35% | Fraction of the visible image's shorter dimension, measured inward along the selected corner diagonal. Larger affects more pixels and raises a broader flap. It also increases the handle travel needed for a full 0→100% curl. |
| `STICKER.segments` | 64 per axis | 4,225 vertices / 8,192 triangles per sticker. Raising to 96 improves very tight bends but produces 18,432 triangles, about 2.25× as many. Review this with `CONTENT.maxItems` and test moving-light performance. |
| `STICKER.backingColor` | `#f2ecdf` | Warm-white underside before lighting. Use `#ffffff` for neutral white; the light can still tint it. Alpha remains the image's alpha. |
| `STICKER.roughness` | 0.9, dimensionless | Matte paper shading; lower adds sharper highlights. Applies to both sides. |
| `CONTENT.offset` | 0…0.3 m | Base image distance from the wall. Curl adds positive depth on top; it does not change the saved offset. |

For a gentler default, change `STICKER.curl.default` from `70` to `50`: new stickers start at a maximum 75° corner bend instead of 105°. No other range needs updating. For a wider peel, change `STICKER.peelArea.default` from `35` to `50`: on a 20 cm visible short side this increases peel depth from 7 to 10 cm and increases the full-range pointer travel by the same amount. For individual images these changes are easier in the live inspector than in source.

Changing the geometry formula, adding more curled corners, moving the pivot to visible-alpha center, or supporting intersecting transparent surfaces deserves coordinated implementation work. The current sheet has no physical thickness, paper physics, tearing, or spring-back. Image shadows retain the existing alpha-cutoff silhouette approximation; half-transparent pixels do not transmit half the shadow light. Content that physically intersects the bulb remains outside the glass approximation. Arbitrarily interpenetrating transparent stickers are not an order-independent transparency system.

### Validation for stickers and rotation

- **27 unit tests pass**, including all four corners at zero/default/maximum curl, narrow/broad peel areas, square/portrait/landscape geometry, alpha bounds, unchanged UVs, finite normals, reused buffers, version 1 migration, version 2 round-trips, and malformed sticker/rotation settings. Production build and TypeScript checks pass. Vite retains the existing advisory about the bundle exceeding 500 kB.
- The final **Chrome browser suite reports ALL CHECKS PASSED**, with no captured console/runtime errors. Actual pixels verify plain backing instead of mirrored artwork (front RGB 155/217/223 vs back 247/246/245 in the fixture), open transparent holes, and visible backing on a curled surface. It tests live inspector controls, invalid numeric inputs, Flat/Sticker switching, Preview, rotated handle dragging, perpendicular movement, cancellation, release outside the handle, keyboard adjustment, whole-image dragging, migration, atomic rejection, and resource disposal after repeated removals.
- The existing PNG/refraction and repeated-frame filament regressions pass, including three extra frames with the curled sticker present. Existing release/capture-loss, project loading, resizing, and disposal/remount checks also pass. No physics values were changed.
- Desktop and **390 × 700** Chrome layouts were visually inspected. A real mouse drag adjusted a rotated corner, and bulb drag/release was inspected with stickers and 3D text present. The filament stayed visible during the swing and after settling. The mobile comparison is a resized iframe, not a physical phone.
- **Safari verification remains blocked in this run:** WebGL initialized, but the native test window repeatedly stalled waiting for its first `study-render` frame; its comparison canvas stayed blank. Reloading/raising the test window did not resolve it. Earlier Safari checks documented above belong to earlier updates, not this sticker update. Physical iOS/Android touch testing and device performance remain unverified; synthetic touch/cancellation checks passed in Chrome.

## Subtle sticker hover in Preview

Open `/tests/sticker.html?hover` for a prepared comparison, or select **Preview** in your own composition. Move near a sticker's curled corner to gently relax it. At closest approach, a saved 70% curl displays as 56%; moving away returns to 70%. Arrange mode stays still. Hover does not alter the inspector or saved JSON, and the scene returns to rendering only on changes after the transition settles.

`src/sticker-hover.ts` owns proximity, mouse/hovering-pen input, transient influence, easing, and cleanup. It measures the saved corner's projected position, preventing the moving surface from shifting its own trigger. Each nearby sticker can respond independently. `src/content.ts` applies the temporary influence to existing geometry buffers and recomputes normals/bounds, so lighting, shadows and glass see the same shape. `src/scene.ts` keeps rendering while either the bulb or hover transition is moving. There is no new project field or public scene API.

Hover is suppressed during pointer presses/drags and over controls or HTML overlays. Touch gestures retain their existing behavior. Leaving Preview, losing focus, hiding the page, or loading a project restores the saved shape. Deleted/replaced items lose their transient state. The operating system's reduced-motion preference disables hover, including changes to that preference while the scene is open. **Release motion** remains the bulb's release-animation control; it does not control sticker hover.

Manual tuning lives in `STICKER.hover` in `src/config.ts`:

| Value | Default | Meaning |
| --- | --- | --- |
| `strength` | `0.20` | Fraction of saved curl removed at the closest point. Change to `.10` for half the response (70 → 63). Keep within 0–1; this is a design parameter, not a saved per-image value. |
| `radiusScale` | `1.25` | Multiplier on the saved shape's projected peel depth. Larger starts reacting farther from the corner. |
| `minRadius` / `maxRadius` | `48` / `140` CSS px | Clamp the proximity region. Review these together with radiusScale; a clamp can hide the effect of changing the multiplier. Independent of device pixel ratio. |
| `approachTime` / `returnTime` | `.120` / `.250` seconds | Exponential time constants, not total animation durations. Smaller is faster. Approximately 95% of a transition completes in three time constants; there is no bounce or overshoot. Keep positive. |
| `settleEpsilon` | `.0001` influence | Small remaining influence error snaps exactly to its target, allowing rendering to sleep. Lower prolongs tiny updates. |
| `maxDelta` | `.05` seconds | Bounds elapsed-time catch-up. Background visibility changes also clear transient state. |

The corner, peel area, rotation and image size determine the hover region; changing them uses the new saved geometry as the reference. Hover strength is a fraction of saved curl, so a flat or zero-curl image stays flat. These settings affect all stickers after reloading; saved compositions remain unchanged.

Hover validation: **31 unit tests pass**, the production build passes, and the new browser test module passes TypeScript checking. The Chrome suite reports **ALL CHECKS PASSED**, including exact 70→56 geometry, unchanged saved JSON, fixed buffers/textures, idle rendering after settling, touch exclusion, hovering-pen events, press/overlay suppression, immediate Arrange/blur restoration, project-load restoration, and deletion. Unit controller tests also cover reduced-motion changes, background visibility reset, overlapping stickers, zero/Flat exclusions and listener cleanup. Existing filament, PNG, glass, release, resize and disposal regressions continue to pass. The production build retains its existing large-bundle advisory.

Desktop and 390 × 700 comparison layouts were inspected in Chrome. Safari was attempted again but stalled before the first rendered test frame after WebGL initialization, so Safari visual behavior is unverified for this update. Pen/touch integration checks use synthetic events; physical phone/tablet and pen hardware behavior remains unverified.
