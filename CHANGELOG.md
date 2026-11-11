# Changelog

## 1.5.0 — 2026-11-11

- The bar icon is the panel's progress ring, in the bar's colour, with an
  accent dot while anything is unseen. The number badge is gone; the count
  is in the tooltip.

## 1.4.1 — 2026-11-11

- The Try tooltips and the test notifications are translatable strings in
  `i18n/en.json`, not English written into `Features.js`.
- `preview.png` for the marketplace listing.
- The README says what the plugin uses (all part of Omarchy 4) and runs the
  whole test suite.

## 1.4.0 — 2026-11-11

- The checklist follows the release's post on omarchy.org when the GitHub
  release links to one, as stable v4.5.0 does: the post's 17 topics, in page
  order. Before, it used the v4.5.0-rc3 notes, which miss what changed
  after rc3 (Apple Silicon, captive portals, Microsoft 365, Superwhisper,
  agent upgrades, Liftoff).
- More features, Security, and Fixes sit collapsed under the checklist,
  read-only and not counted.
- The notes button opens the page the list came from.
- Try buttons and detection are mapped to the post's headings.
- Credits that name a commit ("in omacom/omarchy-iso@716bc15") are stripped.
- Ticks made against the rc3 titles don't carry over; detection ticks
  again what it can see you've used.

## 1.3.1 — 2026-11-09

- Cleaner header: the title is the release ("Omarchy 4.5.0"), the meta
  line is just the progress ("8 of 20 seen", "All caught up"), and a
  progress ring in the theme accent replaces the NEW glyph.
- One header action: release notes, as an accent-tinted square like the
  Agents panel. Mark all seen moved off the header and stays on the `a`
  key.

## 1.3.0 — 2026-11-07

- Panel rebuilt on the same pieces as Omarchy's built-in panels: a
  "What's new" hero with icon actions, section headings for breaking
  changes and highlights, cursor rows with a MultiSelect-style checkbox, a
  dim caption line, and a ▶ action for Try it. 380 wide, like Dropbox.
- The cursor appears on hover or the first arrow key, as in the built-ins.

## 1.2.1 — 2026-11-07

- Smaller panel: 420 wide instead of 600, a shorter list, tighter rows, and
  a one-line header with icon buttons for Mark all seen and Release notes.

## 1.2.0 — 2026-11-07

- Slimmer panel: one list of the release's breaking changes and highlights.
  The folded Features / Improvements / Fixes sections, the release browser,
  the progress row, and the footer are gone; the count moved into the header.
- Try buttons appear only on the row under the mouse or cursor.
- Items ticked by detection show a round check instead of a caption.
- `a` marks everything seen, or clears it.

## 1.1.0 — 2026-11-05

- Try it buttons on 4.5.0 items that have something to open; pressing one
  opens the feature and ticks the item.
- Items tick themselves when a local, read-only check sees the feature has
  been used: language, floating workspaces, Quake console, Elsewhen, video
  backgrounds, the new apps, the new themes.

## 1.0.0 — 2026-11-05

- First release: a bar badge and checklist of the breaking changes and
  highlights of the installed Omarchy release, with older releases a click
  away and progress saved per release.
