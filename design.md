# Design — Webteering

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

## Genre
atmospheric (game UI floats over a live 3D forest; must read at night and noon)

## Theme — "Expedition" (custom)
Premium outdoor / topographic. Deep pine surfaces, warm paper-white ink,
a single control-flag-orange accent, and an IOF map-paper cream reserved for
map surfaces only. No neon glow, no gradient text, hairline rules over heavy
borders, backdrop blur on at most two surfaces per screen.

- `--color-paper`     oklch(20% 0.02 160)  — deep pine, primary surface
- `--color-paper-2`   oklch(24% 0.02 160)  — raised surface
- `--color-ink`       oklch(94% 0.01 90)   — warm off-white text
- `--color-ink-2`     oklch(70% 0.015 130) — sage-grey secondary text
- `--color-rule`      oklch(34% 0.02 150)  — hairline borders
- `--color-accent`    oklch(68% 0.17 45)   — control-flag orange (≤5% per viewport)
- `--color-accent-ink` oklch(15% 0.03 45)  — text on accent fills
- `--color-focus`     oklch(80% 0.12 80)   — amber focus ring
- `--color-map-paper` oklch(95% 0.02 90)   — IOF map sheet surfaces ONLY
- `--color-danger`    oklch(60% 0.21 25)   — wrong punch / penalties

## Typography (2+1)
- Display: Archivo, weight 700/800 (athletic-expedition headers, logo, tabs)
- Body:    Outfit, weight 300–600 (UI text — preserved from the project)
- Outlier: Share Tech Mono (timers, control codes, bearings, splits — the
  SportIdent voice; preserved from the project)
- Display tracking: 0.02em; uppercase for wordmark and section labels only

## Spacing
4-point named scale in `client/src/tokens.css` (`--space-3xs` … `--space-3xl`).
Pages must use named tokens, never raw values in new rules.

## Z layers
`--z-world: 1 · --z-hud: 3 · --z-panel: 5 · --z-overlay: 9 · --z-modal: 10`
HUD chrome never exceeds `--z-panel`; full-screen overlays own 9–10.

## Motion
- Easing: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`; duration `--dur-short: 220ms`
- Reveals: fade-only. No pulsing glow loops on idle UI.
- Reduced-motion fallback: opacity-only, ≤150ms.

## Microinteractions stance
- Silent success (punch banner already exists; no extra toasts)
- Hover transitions 220ms; `:focus-visible` ring shows instantly, never animated

## CTA voice
- Primary CTA: solid `--color-accent` fill, `--color-accent-ink` text,
  `--radius-input` corners, uppercase Archivo 700, no glow shadow
- Secondary CTA: transparent fill, 1px `--color-rule` border, ink text

## Per-screen rules
- Landing: marketing page — Manifesto macrostructure (statement over the live
  3D forest, one CTA). Typography only; the 3D scene is the enrichment.
- Lobby + in-game HUD + podium: app pages — function carries them. No
  enrichment. HUD panels: `--color-paper` at 80–88% alpha, hairline rules,
  blur only on the settings drawer and e-card.
- Map surfaces (HUD map panel, podium track map, handheld sheet) use
  `--color-map-paper` — the IOF palette lives there and nowhere else.

## What screens MUST share
- The wordmark (Archivo 800, letterspaced, solid ink — never gradient text)
- The single orange accent and its placement discipline
- Mono for all numeric/competitive data (timers, codes, splits, bearings)
- Form input voice (`.form-group` base styles in style.css)

## What screens MAY differ on
- Panel density (lobby is roomier; HUD is compact)
- The landing page may use a display-size statement; app pages may not

## Exports

### tokens.css
See `client/src/tokens.css` (canonical; imported by `client/src/style.css`).
