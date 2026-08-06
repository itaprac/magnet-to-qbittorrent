# Design

## Theme

**Dark, always.** Scene: a homelab operator glances at the popup after clicking a magnet on a forum, expecting a 0.5-second confirmation, in a dim room at 11pm. The extension is a power tool checked between other tasks; it must not flash white. A single dark theme is the right answer; no light variant, no high-contrast theme switch.

The palette tints every neutral toward a warm, low-chroma hue. Surfaces are cool blue-gray; text is a warm off-white; the accent is a warm amber. This is a deliberate second-order escape from "torrent client → green" and "extension popup → generic dark." The amber reads as "signal engaged / active" without borrowing from any single category reflex.

## Color strategy

**Restrained.** Tinted neutrals carry ~88% of the surface; a single warm amber accent carries the remaining state. Amber is reserved for: primary action, current selection, live progress, success. Other states (error, warning, info) are secondary colors that never compete with the accent for attention.

### Tokens

| Token | OKLCH | Role |
|---|---|---|
| `--bg` | `oklch(13% 0.014 252)` | Page background, app shell |
| `--surface` | `oklch(17% 0.016 252)` | Popup shell, panel background |
| `--field` | `oklch(20% 0.018 252)` | Form fields, nested surface |
| `--line` | `oklch(30% 0.022 252)` | Borders, dividers |
| `--line-strong` | `oklch(42% 0.030 252)` | Hover borders, focused outlines on neutrals |
| `--text` | `oklch(95% 0.012 78)` | Body, headings, primary text (warm off-white) |
| `--muted` | `oklch(70% 0.018 80)` | Secondary text, labels, meta |
| `--dim` | `oklch(55% 0.014 80)` | Tertiary text, placeholder, disabled |
| `--accent` | `oklch(78% 0.16 72)` | Primary accent: warm amber |
| `--accent-strong` | `oklch(85% 0.18 72)` | Accent hover, active state |
| `--accent-ink` | `oklch(18% 0.04 75)` | Text on accent surfaces |
| `--accent-soft` | `oklch(78% 0.16 72 / .14)` | Focus rings, soft accent fills |
| `--success` | `oklch(78% 0.14 152)` | Success state (kept distinct from accent) |
| `--danger` | `oklch(70% 0.18 28)` | Error state |
| `--warn` | `oklch(80% 0.14 88)` | Warning state |

Chroma drops as lightness approaches 0 and 100. The text on the accent surface uses the accent's hue at low lightness. No `#000` or `#fff` anywhere.

## Typography

Single family: system sans stack.

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif;
```

Monospace for numbers, codes, and small data badges:

```css
font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
```

### Scale (1.2 ratio, fixed rem)

| Token | Size | Weight | Use |
|---|---|---|---|
| `display` | 24px | 700 | Options page h1 |
| `title` | 17px | 700 | Popup h1, modal title |
| `h2` | 14px | 650 | Section headings, panel titles |
| `body` | 13px | 500 | Body, form labels, list items |
| `meta` | 12px | 500 | Timestamps, secondary info |
| `mini` | 11px | 600 | Tags, status pills, table headers |

Line height: 1.45 body, 1.2 headings, 1.0 mini. Body line length capped at 70ch.

## Spacing scale

`4, 6, 8, 12, 16, 20, 24, 32, 40, 56`. No other values. Use 6, 12, 20, 32 in surfaces. Smaller steps (4, 6) for inline; larger (32, 40, 56) for page-level rhythm.

## Radius

`6` for pills, `8` for tags, `10` for form fields and buttons, `14` for cards and panels, `999` for progress bars. No other values.

## Layout

**Popup (360px wide, max 540px tall).** Single column. No nested cards. The order follows the hot path: connection state, quick add, queue, Web UI link. The quick-add command stays above the scrolling queue. Each torrent ends in a full-width 3px signal rail that carries progress and completion state.

**Options page.** Single column, max-width 760px, centered. Sections separated by spacing and a section header. No card containers around the form. The hero is replaced by a thin brand row (mark + name + status) at the top of the page.

**Modal (category picker on the page).** Anchored popover near the top of the viewport (not full-screen overlay). Width `min(420px, calc(100vw - 32px))`. The picker feels like a tool surface, not an OS dialog.

## Components

- **Button** — three variants: `primary` (accent), `secondary` (transparent + line), `ghost` (transparent, no border). Min height 36 in popup, 40 in options. Hover: surface tint + 1px line-strong. Focus: 3px accent-soft outline. Active: scale 0.985.
- **Form field** — single line. 1px line border, 10px radius, field background. Focus: accent border + 4px accent-soft ring.
- **Checkbox / toggle** — native input with `accent-color: var(--accent)`. No custom switch widgets.
- **Select** — native. Same border / focus treatment as text inputs.
- **Status pill** — 11px mono, 6px padding, 6px radius, uppercase, color + label, never color alone.
- **Torrent row** — three lines: name and state, category / speed / percent, progress rail. Single column, no side-stripe accents. The 3px rail is the interface's signature element: amber while active, green only when complete.
- **Section header** — small label, no underline, no border. Followed by content with 12px gap.
- **Empty state** — center-aligned single line of muted text. No illustration, no icon, no CTA unless there's a clear next step.
- **Toast / confirmation** — fixed at top-right of the viewport for the content picker, auto-dismiss in 1.6s. No action button.

## Motion

100–180ms transitions, ease-out-quart. No bounce, no elastic. Progress bars ease over 240ms. State changes (success → idle) cross-fade 120ms. Honors `prefers-reduced-motion`: disables transforms and animations, keeps instant state changes.

## Iconography

A single custom SVG mark for the extension: a 16×16 lightning bolt inside a 28×28 rounded square, accent fill. The mark replaces the unicode "↯" character. The mark is the only icon in the extension. All other UI uses text or unicode glyphs (→, ·, ·) sparingly.

## Accessibility

- WCAG 2.2 AA contrast for all text (text on surface ≥ 7:1, text on field ≥ 6.5:1, muted text ≥ 4.5:1).
- Focus visible on every interactive element.
- `prefers-reduced-motion` disables transforms, animations, and the modal scale-in.
- Touch targets ≥ 36px in the popup, ≥ 40px in options.
- All status communicated with both color and text (or text alone in some cases).
- Keyboard reachable end-to-end; the modal uses focus trap and Escape to cancel.

## Voice

Short, declarative, no hand-holding. Examples:

- "Added." not "Your torrent has been successfully added."
- "Can't reach qBittorrent (502)." not "An error occurred while connecting."
- "Default: `linux-iso`" not "The default category is set to linux-iso."
- "Test connection" not "Click here to test your connection settings."

Sentence case for buttons, titles, and labels. Title case reserved for product name "Magnet → qBittorrent".
