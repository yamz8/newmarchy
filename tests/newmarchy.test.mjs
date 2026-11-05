import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("../Newmarchy.js", import.meta.url), "utf8")
const context = vm.createContext({ Array, Error, JSON, Math, Number, String, encodeURIComponent })
vm.runInContext(source, context)
const N = context

// vm objects come from another realm, so compare through JSON.
const plain = (value) => JSON.parse(JSON.stringify(value))

const rcBody = `> **Release candidate.** Expect bugs.

Install on new machines with the ISO:

**x86_64:**

- Download: [https://iso.omarchy.org/x.iso](https://iso.omarchy.org/x.iso)
- SHA256: abc

## Highlights

### Add Omarchy in 50 languages

Pick a language under _Setup > Language_ or run \`omarchy language <code>\`.

![demo.gif](https://example.invalid/demo.gif)

### Add floating workspaces with a dock

\`Super + L\` now cycles layouts.

## Breaking changes

**The boot menu stays out of the way now.** Limine waits 1 second.

**Some shortcuts moved:**

- Calculator: \`Super + Ctrl + Q\` is now \`Super + Shift + Q\`.
- Nightlight no longer has a shortcut.

## Features

- Add Japanese input methods by @dhh in #14433
- Add a Flexoki Light intro by @yamz8 in #15315
- Fix TUXEDO drivers by @bastidotnet in omacom/omarchy-pkgs#1244
- Add 11 more agents by @dhh, @sorenmat, @omarchybot in #14040
`

const finalBody = `Omarchy 4.5 is out.

Release notes: https://omarchy.org/news/2026/11/omarchy-4-5/`

const patchBody = `This patch release fixes things.

## Fixes

- Fix updates stopping at the OpenClaw migration by @spencerbull in #14212

**Full Changelog**: https://github.com/omacom/omarchy/compare/v4.0.5...v4.0.6

## If you installed OpenClaw yourself
If \`~/.local/bin/openclaw\` is your own install, run:
\`\`\`bash
mv ~/.local/bin/openclaw ~/.local/bin/openclaw.mine
\`\`\`
`

function release(tag, body, extra = {}) {
  return {
    tag_name: tag,
    name: tag,
    prerelease: /-rc\d*$/.test(tag),
    draft: false,
    published_at: "2026-11-05T05:36:53Z",
    html_url: `https://github.com/omacom/omarchy/releases/tag/${tag}`,
    body,
    ...extra
  }
}

const feed = JSON.stringify([
  release("v4.5.0", finalBody),
  release("v4.5.0-rc3", rcBody),
  release("v4.5.0-rc2", "## Fixes\n\n- Old\n"),
  release("v4.0.6", patchBody)
])

test("baseVersion reads pacman, tag, and dev forms", () => {
  assert.equal(N.baseVersion("4.5.0-3"), "4.5.0")
  assert.equal(N.baseVersion("v4.0.6"), "4.0.6")
  assert.equal(N.baseVersion("4.5.0"), "4.5.0")
  assert.equal(N.baseVersion("dev (abc1234)"), "")
  assert.equal(N.baseVersion(""), "")
})

test("the preamble and install sections are skipped", () => {
  const titles = plain(N.parseNotes(rcBody)).map((s) => s.title)
  assert.deepEqual(titles, ["Breaking changes", "Highlights", "Features"])
})

test("breaking changes are moved first and marked", () => {
  const [first] = plain(N.parseNotes(rcBody))
  assert.equal(first.title, "Breaking changes")
  assert.equal(first.breaking, true)
  assert.equal(first.key, true)
})

test("### headings become items and their prose becomes detail", () => {
  const highlights = plain(N.parseNotes(rcBody)).find((s) => s.title === "Highlights")
  assert.deepEqual(highlights.items.map((i) => i.title), ["Add Omarchy in 50 languages", "Add floating workspaces with a dock"])
  assert.equal(highlights.items[0].detail, "Pick a language under Setup > Language or run omarchy language <code>.")
  assert.equal(highlights.items[1].detail, "Super + L now cycles layouts.")
})

test("a bold lead owns the bullets after it", () => {
  const breaking = plain(N.parseNotes(rcBody))[0]
  assert.deepEqual(breaking.items.map((i) => i.title), ["The boot menu stays out of the way now", "Some shortcuts moved"])
  assert.equal(breaking.items[0].detail, "Limine waits 1 second.")
  assert.equal(
    breaking.items[1].detail,
    "• Calculator: Super + Ctrl + Q is now Super + Shift + Q.\n• Nightlight no longer has a shortcut."
  )
})

test("plain bullets become items with attribution stripped", () => {
  const features = plain(N.parseNotes(rcBody)).find((s) => s.title === "Features")
  assert.deepEqual(features.items.map((i) => i.title), [
    "Add Japanese input methods",
    "Add a Flexoki Light intro",
    "Fix TUXEDO drivers",
    "Add 11 more agents"
  ])
})

test("a section with only prose becomes a single item, code included", () => {
  const sections = plain(N.parseNotes(patchBody))
  assert.deepEqual(sections.map((s) => s.title), ["Fixes", "If you installed OpenClaw yourself"])
  const own = sections[1].items
  assert.equal(own.length, 1)
  assert.equal(own[0].title, "If you installed OpenClaw yourself")
  assert.match(own[0].detail, /mv ~\/\.local\/bin\/openclaw/)
})

test("the Full Changelog line is not an item", () => {
  const fixes = plain(N.parseNotes(patchBody))[0]
  assert.equal(fixes.items.length, 1)
})

test("markup-shaped input stays inert text", () => {
  const sections = plain(N.parseNotes('## Features\n\n- <img src="https://example.invalid/t"> Tracker\n- **Bold** and [link](https://x.invalid)\n'))
  const titles = sections[0].items.map((i) => i.title)
  assert.deepEqual(titles, ["Tracker", "Bold and link"])
  for (const title of titles) assert.doesNotMatch(title, /</)
})

test("titles and details are bounded", () => {
  const long = "x".repeat(10000)
  const [section] = plain(N.parseNotes(`## Features\n\n### ${long}\n\n${long}\n`))
  assert.ok(section.items[0].title.length <= N.MAX_TITLE)
  assert.ok(section.items[0].detail.length <= N.MAX_DETAIL)
})

test("item count is capped", () => {
  const body = "## Fixes\n\n" + Array.from({ length: 2000 }, (_, i) => `- Fix ${i}`).join("\n")
  assert.equal(N.countItems(N.parseNotes(body)), N.MAX_ITEMS)
})

test("parseReleases drops drafts and bad tags and pins URLs to the repo", () => {
  const raw = JSON.stringify([
    release("v1.0.0", "", { html_url: "https://evil.invalid/x" }),
    release("v0.9.0", "", { draft: true }),
    release("../etc", ""),
    release("v0.8.0", "")
  ])
  const releases = plain(N.parseReleases(raw))
  assert.deepEqual(releases.map((r) => r.tag), ["v1.0.0", "v0.8.0"])
  assert.equal(releases[0].url, "https://github.com/omacom/omarchy/releases/tag/v1.0.0")
  assert.equal(releases[0].published, "2026-11-05")
})

test("parseReleases surfaces an API error message", () => {
  assert.throws(() => N.parseReleases(JSON.stringify({ message: "API rate limit exceeded" })), /rate limit/)
})

test("a thin final release borrows its newest release candidate's notes", () => {
  const notes = plain(N.notesFor(N.parseReleases(feed), "v4.5.0"))
  assert.equal(notes.tag, "v4.5.0")
  assert.equal(notes.sourceTag, "v4.5.0-rc3")
  assert.equal(notes.sections[0].title, "Breaking changes")
})

test("a full final release keeps its own notes", () => {
  const notes = plain(N.notesFor(N.parseReleases(feed), "v4.0.6"))
  assert.equal(notes.sourceTag, "v4.0.6")
})

test("defaultTag picks the installed version, else the newest final", () => {
  const releases = N.parseReleases(feed)
  assert.equal(N.defaultTag(releases, "4.0.6-1"), "v4.0.6")
  assert.equal(N.defaultTag(releases, "4.5.0-3"), "v4.5.0")
  assert.equal(N.defaultTag(releases, "dev (abc)"), "v4.5.0")
  assert.equal(N.defaultTag(releases, "9.9.9-1"), "v4.5.0")
  assert.deepEqual(plain(N.finalTags(releases)), ["v4.5.0", "v4.0.6"])
})

test("the badge counts key sections only when the release has them", () => {
  const releases = N.parseReleases(feed)
  const big = N.notesFor(releases, "v4.5.0")
  assert.equal(N.unseenCount(big, {}), 4) // 2 breaking + 2 highlights, not the 4 features
  const patch = N.notesFor(releases, "v4.0.6")
  assert.equal(N.unseenCount(patch, {}), 2)
})

test("checking items off lowers the count and survives a round trip", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  const ids = notes.sections[0].items.map((i) => i.id)
  let seen = N.setSeen({}, "v4.5.0", ids, true)
  assert.equal(N.unseenCount(notes, seen), 2)
  seen = N.parseSeen(N.serializeSeen(seen))
  assert.equal(N.unseenCount(notes, seen), 2)
  seen = N.setSeen(seen, "v4.5.0", [ids[0]], false)
  assert.equal(N.unseenCount(notes, seen), 3)
})

test("setSeen does not mutate its input", () => {
  const before = { "v1.0.0": ["abc"] }
  N.setSeen(before, "v1.0.0", ["def"], true)
  assert.deepEqual(before, { "v1.0.0": ["abc"] })
})

test("item ids are stable across parses and distinct across sections", () => {
  const a = plain(N.parseNotes(rcBody))
  const b = plain(N.parseNotes(rcBody))
  assert.deepEqual(a.map((s) => s.items.map((i) => i.id)), b.map((s) => s.items.map((i) => i.id)))
  assert.notEqual(N.itemId("Features", "X"), N.itemId("Fixes", "X"))
})

test("parseSeen rejects junk", () => {
  assert.deepEqual(plain(N.parseSeen("not json")), {})
  assert.deepEqual(plain(N.parseSeen("[1,2]")), {})
  assert.deepEqual(plain(N.parseSeen(JSON.stringify({ "v1.0.0": ["abc", "ZZZ", "abc"], "../x": ["abc"], v2: "no" }))), { "v1.0.0": ["abc"] })
})

test("rows open key sections and fold the rest by default", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  const list = plain(N.rows(notes, {}, {}, {}))
  const headers = list.filter((r) => r.kind === "section")
  assert.deepEqual(headers.map((h) => [h.title, h.collapsed]), [
    ["Breaking changes", false],
    ["Highlights", false],
    ["Features", true]
  ])
  assert.equal(list.filter((r) => r.kind === "item").length, 4)
  const opened = plain(N.rows(notes, {}, { Features: false }, {}))
  assert.equal(opened.filter((r) => r.kind === "item").length, 8)
})

test("keyProgress counts what the badge counts", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  assert.deepEqual(plain(N.keyProgress(notes, {})), { done: 0, total: 4 })
  const seen = N.setSeen({}, "v4.5.0", [notes.sections[0].items[0].id], true)
  assert.deepEqual(plain(N.keyProgress(notes, seen)), { done: 1, total: 4 })
  assert.deepEqual(plain(N.keyProgress(null, {})), { done: 0, total: 0 })
})
