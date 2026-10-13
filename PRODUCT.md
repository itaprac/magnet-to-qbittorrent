# Product

## Register

product

## Users

Self-hosters and homelab operators who already run a qBittorrent instance (locally, on a NAS, behind a VPN, or on a remote box) and use a desktop browser as their primary torrent discovery surface. They are comfortable with Web UIs, JSON APIs, and configuration files. They reach for this extension to skip the round-trip of copy-paste a magnet link, open qBittorrent in another tab, paste, pick a category, hit add. The job to be done is: turn a discovered magnet link into a queued torrent, in the fewest possible steps, with full visibility into what happened.

## Product Purpose

Intercept `magnet:` clicks on any page, route them to the user's qBittorrent Web UI, and let them land the torrent under the right category and tags without breaking flow. The extension is a small, sharp bridge, not a download manager. It should feel like a power tool: dense, fast, predictable, and honest about success and failure. Success means the user thinks about the torrent, not the extension.

## Brand Personality

Three words: **quiet, precise, opinionated**.

Voice: declarative, short, no hand-holding. UI copy uses the same vocabulary the user already uses in qBittorrent (`state`, `category`, `tags`, `paused`). Tool references: Raycast, Linear, Tana, uBlock Origin. The product earns trust by being unflashy and correct.

## Anti-references

- **Generic SaaS / productivity tools.** No cream-on-white, no gradient hero text, no "all-in-one platform" tone, no over-smoothed card grids. This is a 360px popup, not a marketing site.
- **Crypto / Web3 aesthetic.** No neon gradients on black, no floating 3D shapes, no "decentralized" energy. The torrent space has had enough of that.
- **Cute consumer apps.** No mascots, no celebratory confetti, no "delight at every click" patterns. The user is in flow.

## Design Principles

1. **Hot path first.** The intercept-and-add flow is the product. Every screen should make that path feel shorter, not introduce competing priorities.
2. **Show state, not just output.** Always answer "what just happened, and is the torrent actually downloading?" Status badges, recent torrent strip, and clear success / failure feedback are part of the design, not an afterthought.
3. **Earned familiarity over reinvention.** Standard extension conventions: one popup, one options tab, native form controls, system fonts, predictable keyboard. The user should not need to learn a new vocabulary.
4. **Configuration is a one-time thing, not a destination.** The options page should feel quick to set up and rarely visited. Defaults are good; advanced knobs exist but do not crowd the surface.
5. **Honest about failure.** Network errors, auth failures, missing categories, blocked hosts. The user is technical; the UI should name the problem and the next step.

## Accessibility & Inclusion

WCAG 2.2 AA. Keyboard reachable end-to-end (popup included). Visible focus on every interactive element. Honors `prefers-reduced-motion`. Color is never the only carrier of meaning; state badges pair color with a label or icon. Minimum 4.5:1 contrast for body text. Touch targets ≥ 36px in the popup, ≥ 40px in the options page. Dark only, by design (see DESIGN.md): there is no light theme, and `color-scheme: dark` keeps native controls consistent.
