# newmarchy

An Omarchy bar widget that turns each Omarchy release into a checklist, so
after an update you can tell what's new and know you've actually seen it.

- **Bar icon with a badge** counting what you haven't checked off yet in the
  release you're running. It goes away when you've seen everything.
- **Click** to open the checklist: the release's breaking changes (their
  boxes are tinted) and highlights. The long Features / Improvements / Fixes
  lists stay on the release page, one click away.
- **Click an item** to read its full text, and **tick its box** once you've
  seen it.
- **Try it**: the row under the mouse or cursor shows a button when there is
  something to open (the language picker, workspace layouts, Elsewhen, the
  Quake console, the theme menu, a test notification). Pressing it opens the
  feature and ticks the item.
- **Ticks itself** when it can see you've used something new; those items get
  a round check instead of a square one (see below).
- **Right-click** the icon to open the release on GitHub.

## Install

```bash
omarchy plugin add https://github.com/yamz8/newmarchy.git --enable
```

## Keys

| Key | Action |
| --- | --- |
| ↑ ↓ / j k | Move |
| Space | Check or uncheck |
| Enter | Read the item's full text |
| t | Try it |
| a | Mark all seen, or clear them all |
| Esc | Close |

IPC, for a keybinding or a script:

```bash
omarchy-shell yamz8.newmarchy toggle
omarchy-shell yamz8.newmarchy unseen    # prints the badge count
omarchy-shell yamz8.newmarchy refresh
```

## Where the notes come from

The [GitHub releases](https://github.com/omacom/omarchy/releases) of
`omacom/omarchy`, fetched over HTTPS when the shell starts and when the panel
opens (at most once every ten minutes). There is no other network use and no
background polling. The response is capped at 4 MiB and every title and
description is bounded and rendered as plain text.

Some final releases, such as v4.5.0, carry only a short summary and a link,
with the full notes on the last release candidate. When a release candidate
has more to check off than its final release, newmarchy uses the candidate's
notes; the Release notes button's tooltip says which.

The installed version is read locally with `omarchy-version`, once an hour
and whenever the panel opens, so the badge follows an update without a shell
restart.

## What it can tell you've tried

`bin/newmarchy-detect` checks local state, read-only and offline, when the
shell starts, when the panel opens, and once an hour. For 4.5.0 it ticks:

| Item | Signal |
| --- | --- |
| Omarchy in 50 languages | `omarchy-language` is not `en` |
| Floating workspaces with a dock | a workspace layout file says `floating` |
| Quake-style terminal console | the `special:qconsole` workspace exists |
| Elsewhen world clock | Elsewhen has cities of your own in `shell.json` |
| Video wallpapers | the current background is a video file |
| Hype, Signed, Disktree, Monologue | one of them has a config or state directory |
| Starship and Jade Horse themes | one of them is the current theme |

Each item is ticked by detection at most once. If you untick it, it stays
unticked. Items ticked this way show a round check.

The try commands and signals are written by hand per release in
`Features.js`; `tests/features.test.mjs` checks every one against the real
release notes in `tests/fixtures/`.

## State

What you've checked off is kept in `~/.local/state/newmarchy/seen.json`,
keyed by release tag. Delete the file to start over.

## Remove

```bash
omarchy plugin remove yamz8.newmarchy
rm -rf ~/.local/state/newmarchy
```

## Development

```bash
omarchy plugin validate .
node --test tests/newmarchy.test.mjs
```

All parsing lives in `Newmarchy.js`, which the tests run under `node:vm`.

## License

MIT
