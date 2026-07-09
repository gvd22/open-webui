# Chat Background Animation Settings

This file documents local experiments for the OpenWebUI chat background. These notes are for comparison while iterating; do not treat every section as a committed target.

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
