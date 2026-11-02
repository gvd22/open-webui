# Chat Background Animation Settings

This file documents local experiments for the OpenWebUI chat background. These notes are for comparison while iterating; do not treat every section as a committed target.

## Current Active Design Specification

The selected design is now **gallery variant 59**, the narrower, slightly lower version of 55. It is implemented in `ChatStartBackground.svelte`. Earlier experiments and feedback remain below for comparison; they are not the active specification.

- Palette from the selected preview: rose `#ff6d87`, violet `#8060ef`, blue `#479aff`. This selection supersedes the earlier red/white-only direction; there is no gold or ice-blue page fill.
- One moving gradient field, with overlapping ellipses sized `39% 58%`, `43% 46%`, and `47% 52%`, anchored at `30% 49%`, `44% 72%`, and `65% 64%`.
- Full chat-pane coverage, with soft intersecting masks: ellipse `76% 80% at 50% 60%` (opaque through 12%), plus vertical fade stops `0 / 34 / 74 / 100%`. The animated layer overscans its container by 7%, without expanding document width.
- Movement: 32-second translation cycle, amount `1.3`; 47-second independent shape cycle, amount `0.3`. Horizontal travel is 25% smaller than variant 55. Translate keyframes: `(0,0)`, `(1.5cqw,-4cqh)`, `(3.75cqw,1cqh)`, `(0,8cqh)`, `(-3.75cqw,0)`, multiplied by the motion amount.
- Layer opacity: light `0.32`, dark `0.27`, OLED `0.23`. Page and input colors still come from the existing OpenWebUI theme. Focus slightly reduces the main field's opacity to protect text readability.
- The cross texture uses the original 10px shape on a 52px grid, slightly denser than the faint 56px experiment but smaller and sparser than the rejected 12px/44px version. It is decorative, non-interactive, hidden in normal chats, and restrained. No particle simulation or separate cross pulse.
- Normal chats retain 22% of the background strength (28% during generation); the same component stays mounted so the animation does not restart after sending.
- On screens up to 640px: movement amount `0.8`, cycles `48s / 70s`, static cross texture at `0.45` opacity with no second moving gradient. Reduced-motion disables the animations and transitions. Hidden tabs and offscreen components pause playback.
- Implementation uses CSS transforms, opacity and static masks, with no continuous JavaScript render loop, large blur filter, external imagery, or new library. Chat input styling and functionality are unchanged.
- Integration: `Chat.svelte` owns one background behind the pane. `Placeholder.svelte` binds focus and submit state to it. Theme colors follow `.dark` and the existing theme store's `oled-dark` value.

### Local Preview

- Frontend: `http://127.0.0.1:5173`, Vite from this feature branch.
- Backend: `http://127.0.0.1:8080`, `WEBUI_AUTH=false`, separate `DATA_DIR` and `STATIC_DIR` under `.cache/variant59-preview/`. Neither service is bound to the LAN.
- This preview has no configured model provider; it is intended for visual inspection, not inference. Other running OpenWebUI instances and their data are untouched.
- Snapshot branch: `codex/chat-background-variant59` (2026-11-02).

### Current Refinement: Original Suggestions and Moderate Cross Visibility

User feedback: restore the original Suggested presentation and leave it unchanged. The previous crosses became practically invisible; show a few more, without returning to the aggressive dense version.

- Restored `Suggestions.svelte` to the feature branch's committed baseline, including its original list behavior. Removed the welcome-only variant and restored the original wrapper width and margins in `Placeholder.svelte`. No added tiles or shared panel remain.
- Crosses stay 10px, with spacing adjusted from 56px to 52px (about 16% more per unit area). Coverage changes only slightly from `52% 46%` to `55% 48%`; the large reading clearance is unchanged.
- Light base ink: `rgb(5 40 86 / 0.075)`; dark/OLED: `rgb(226 235 255 / 0.065)`. These remain under half of the aggressive version's 0.18/0.16 values. Moving color opacity: `0.30` / `0.26`, between the too-faint and too-strong settings.
- Pattern opacity remains `0.75` on desktop and `0.45` on mobile. No extra breathing pulse. Main background palette, strength and motion are unchanged.

### Previous Refinement: Rejected Shared Panel and Too-Faint Crosses

Earlier request: the separate tiles did not match the chat input; the heading should be inside the white surface, and the suggestions should not have their own scroll area. The resulting shared panel was also rejected, and the cross texture was judged almost invisible. Retain the settings below only for comparison.

- One shared suggestions surface, including the heading. It reuses the input's `rounded-3xl`, 1.5px border, white/86 light surface, gray-900/88 dark/OLED surface, and shadow. Its width and horizontal inset match the input. Suggestion actions inside have no separate card borders or colored fills.
- All matching prompts remain visible; the list has natural height and no internal overflow scrolling. Two columns from 18rem of available container width, one below that; small screens hide the optional action arrows to leave more room for text. Native page scrolling remains possible when content cannot fit a small viewport.
- Cross shape/spacing restored to 10px / 56px. Coverage reduced to `52% 46%`, reading clearance enlarged to `35% 42%` with a 75% transparent stop. Pattern opacity is a constant `0.75` on desktop; the separate 19-second brightness pulse is removed.
- Base ink reduced from 0.18 to 0.035 in light mode and from 0.16 to 0.025 in dark/OLED. Moving color opacity reduced from 0.48/0.42 to 0.24/0.20. The main aurora colors and motion are unchanged.

### Previous Refinement: Rejected Dense Crosses and Separate Tiles

Earlier request: the plain suggestions no longer fit the animated background; the crosses were a welcome design element but disappeared too often. The following implementation was subsequently rejected; retain these settings only as a comparison.

- Welcome suggestions now use translucent, bordered individual tiles with 8px corners and the existing arrow icon. Two columns when their container is at least 30rem wide, one column otherwise. The list remains scrollable, and all configured prompts remain selectable and searchable.
- Tile surfaces: white at 65% in light mode, the existing `--color-gray-900` at 74% in dark/OLED. Hover surfaces increase to 90% / 94%; keyboard focus has a contrasting 2px outline. No backdrop blur or continuously animated tile effects.
- Cross spacing reduced from 56px to 44px, roughly 62% more crosses per area; shape size increased from 10px to 12px.
- Cross coverage increased from `48% 43%` to `66% 56%`, with the clear reading region reduced from `35% 42%` to `28% 30%`. All outer edges still fade smoothly.
- Base ink: `rgb(5 40 86 / 0.18)` in light mode; `rgb(226 235 255 / 0.16)` in dark/OLED. Moving color opacity: `0.48` / `0.42`. The pattern breathes between 80% and 100% opacity over 19 seconds on desktop, instead of disappearing as the light moves.
- Input behavior is unchanged. The alternate, non-welcome suggestions caller keeps its existing layout via the default variant.

### Earlier Design Goals

The following requests describe the earlier Swiss-themed experiments, not the selected variant 59 palette or texture.

- Overall direction: Swiss/Bundesverwaltung inspired, calm, precise, institutional, and high quality.
- Composition: central dynamic background behind greeting, logo, and chat input; normal chat may keep only a much weaker ambient version.
- Color hierarchy: red and white should dominate; blue is only a restrained technical accent.
- Blue tokens: dark accent `rgb(5 40 86)`, lighter accent `rgb(51 102 204)`.
- Avoidance: do not create a France flag impression, avoid obvious blue-white-red vertical grouping, avoid gaming/RGB effects, avoid visible particle grid, and avoid explicit Swiss-cross symbolism.
- Motion: visible but calm continuous movement, with slow evolving cycles and no hectic animation.
- Accessibility: chat input text must stay readable; the input surface should remain semi-solid with a clear border and a visible blinking caret when focused, including the empty placeholder state before any text is typed.
- Performance: keep the effect CSS-based, GPU-friendly, responsive, weak in normal chat, reduced on mobile, and disabled/simplified for `prefers-reduced-motion`.
- Rejected references: Input-Centric Halo, Swiss Signal, and Soft Cross Glow are documented for comparison but should not be treated as the final direction.

## Baseline Swiss Dynamic Commit

Committed feature baseline before later local experiments:

- Component: `src/lib/components/chat/ChatStartBackground.svelte`
- Character: Swiss red/white dominant, blue as technical accent.
- No particle grid.
- Start background size: roughly `width: min(1380px, 118vw)`, `height: min(700px, 76vh)`.
- Start opacity: light around `0.68`, dark around `0.74`.
- Blur: light around `36px`, dark around `40px`.
- Animation cycles: blue/red/white around `10s`-`16s`, mesh/wave around `12s`-`18s`.
- Normal chat uses weak `ambient` mode.

## Strong Dynamic Experiment

This was the intentionally strongest version and should remain the reference for “very strong”.

- Start background size: `width: min(1680px, 140vw)`, `height: min(860px, 92vh)`.
- Start opacity: light `0.86`, dark `0.94`.
- Active opacity: light `0.96`, dark `1`.
- Blur: light `46px`, dark `50px`.
- Saturation: light `1.16`, dark `1.24`.
- Ambient size: `width: min(1420px, 118vw)`, `height: min(760px, 84vh)`.
- Ambient opacity: light `0.24`, dark `0.32`.
- Layers:
  - Blue halo: `7s`.
  - Red halo: `8s`.
  - White halo: `9s`.
  - Mesh: `11s`.
  - Surge layer: `10s`.
  - Wave: `7.5s`.
- Character: very visible, full-screen, high activity, fast moving, much stronger than preferred calm state.

## Calmer Large Variant

This was the lighter/slower version after the strong experiment. It was still broad, but much less intense.

- Start background size: `width: min(1520px, 128vw)`, `height: min(760px, 84vh)`.
- Start opacity: light `0.72`, dark `0.8`.
- Active opacity: light `0.82`, dark `0.9`.
- Blur: light `42px`, dark `46px`.
- Saturation: light `1.04`, dark `1.12`.
- Ambient size: `width: min(1280px, 110vw)`, `height: min(680px, 78vh)`.
- Ambient opacity: light `0.16`, dark `0.22`.
- Layers:
  - Blue halo: `16s`.
  - Red halo: `19s`.
  - White halo: `22s`.
  - Mesh: `28s`.
  - Surge layer: `26s`.
  - Wave: `24s`.
- Character: softer than the strong experiment, still screen-wide and atmospheric.

## Input-Centric Halo Experiment

This experiment shifted the effect toward the input area instead of covering the whole screen. It is kept as a reference, but was not the preferred direction.

- Start position: `top: 58%` so the glow sits closer to the chat input.
- Start background size: `width: min(1180px, 104vw)`, `height: min(500px, 56vh)`.
- Start opacity: light `0.7`, dark `0.78`.
- Active opacity: light `0.82`, dark `0.9`.
- Blur: light `34px`, dark `38px`.
- Saturation: light `1.08`, dark `1.16`.
- Ambient size: `width: min(1040px, 96vw)`, `height: min(480px, 58vh)`.
- Ambient opacity: light `0.16`, dark `0.22`.
- Layers:
  - Blue halo: `24s`, lower opacity, accent only.
  - Red halo: `26s`, centered closer to input.
  - White halo: `30s`, focused around the center/input area.
  - Mesh: `34s`.
  - Surge layer: `32s`, reduced opacity.
  - Wave: `30s`, reduced opacity.
- Character: input-focused, quieter, still dynamic, less distracting for reading the rest of the page.
- Feedback: not strong enough as a main visual direction; keep in mind, but move on to a more precise Swiss institutional style.

## Swiss Signal Experiment

Previous local experiment. This direction is more Bundesverwaltung/Switzerland: a calm red light carpet, a clear white center, and very sparse blue as a cold technical accent. It should feel precise and institutional rather than like AI fog.

- Start position: `top: 54%`, centered behind the greeting and input without hugging the field too tightly.
- Start background size: `width: min(1460px, 120vw)`, `height: min(620px, 68vh)`.
- Start opacity: light `0.74`, dark `0.82`.
- Active opacity: light `0.82`, dark `0.9`.
- Blur: light `24px`, dark `28px`.
- Saturation: light `1.02`, dark `1.08`.
- Ambient size: `width: min(1180px, 104vw)`, `height: min(560px, 66vh)`.
- Ambient opacity: light `0.14`, dark `0.2`.
- Layers:
  - Blue halo: `34s`, very low opacity and split to the outer edges only.
  - Red halo: `36s`, broad red carpet with slow lateral breathing.
  - White halo: `40s`, compact center clarity behind the hero content.
  - Mesh: `46s`, subtle conic structure instead of visible grid.
  - Surge layer: `48s`, weak institutional signal movement.
  - Wave: `44s`, very subtle secondary motion.
- Character: calmer, wider, more red/white dominant, less misty, with blue only as a restrained technical signal.

## Soft Cross Glow Experiment

Previous local experiment. This keeps the Swiss/Bundesverwaltung direction, but changes the light distribution so it subtly follows a plus/cross logic without drawing a visible Swiss cross. The white structure is made from blurred horizontal and vertical light axes embedded inside the red field.

- Start position: `top: 53%`, centered behind the greeting and input.
- Start background size: `width: min(1480px, 122vw)`, `height: min(660px, 72vh)`.
- Start opacity: light `0.76`, dark `0.84`.
- Active opacity: light `0.84`, dark `0.92`.
- Blur: light `26px`, dark `30px`.
- Saturation: light `1.04`, dark `1.1`.
- Ambient size: `width: min(1180px, 104vw)`, `height: min(560px, 66vh)`.
- Ambient opacity: light `0.13`, dark `0.19`.
- Layers:
  - Blue halo: `42s`, very sparse edge accent only.
  - Red halo: `44s`, broad red embedding field.
  - White halo: `52s`, blurred horizontal and vertical axes plus a soft center.
  - Mesh: `58s`, low-opacity conic support so the axes do not look geometric.
  - Surge layer: `56s`, secondary cross-axis glow with weaker opacity.
  - Wave: `60s`, minimal movement and tiny blue trace.
- Character: more eigenständig than Swiss Signal, still subtle; should read as a soft institutional light structure, not an explicit symbol.
- Feedback: not preferred; keep only as a documented reference, not as the direction to continue.

## Color Tokens

Current shared color direction:

- Dark accent blue: `rgb(5 40 86)`.
- Light accent blue: `rgb(51 102 204)`.
- Red: light `rgb(185 32 44)`, dark `rgb(196 28 44)`.
- Soft red: light `rgb(232 83 72)`, dark `rgb(242 76 68)`.
- White: light `rgb(255 255 255)`, dark `rgb(245 248 255)`.

## Design Notes

- Avoid a France flag impression by avoiding vertical blue-white-red composition.
- Switzerland direction means red/white dominant, blue only as a technical accent.
- Input readability is protected by making the chat input background semi-solid and giving it a clearer border.
- No commit should be made for experimental changes unless explicitly requested.
