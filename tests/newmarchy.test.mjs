import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const source = readFileSync(new URL("../Newmarchy.js", import.meta.url), "utf8")
const context = vm.createContext({ Array, Error, JSON, Math, Number, String, encodeURIComponent, parseInt })
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


test("the checklist is breaking changes and highlights, breaking first", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  const items = plain(N.checklist(notes))
  assert.deepEqual(items.map((i) => [i.title, i.breaking]), [
    ["The boot menu stays out of the way now", true],
    ["Some shortcuts moved", true],
    ["Add Omarchy in 50 languages", false],
    ["Add floating workspaces with a dock", false]
  ])
})

test("a release without highlights lists everything it has", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.0.6")
  assert.equal(N.checklist(notes).length, 2)
})

test("progress counts what the checklist shows", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  assert.deepEqual(plain(N.progress(notes, {})), { done: 0, total: 4 })
  const seen = N.setSeen({}, "v4.5.0", [notes.sections[0].items[0].id], true)
  assert.deepEqual(plain(N.progress(notes, seen)), { done: 1, total: 4 })
  assert.deepEqual(plain(N.progress(null, {})), { done: 0, total: 0 })
})

// The omarchy.org post that the stable v4.5.0 release links to.
const page = readFileSync(new URL("./fixtures/omarchy-4-5.html", import.meta.url), "utf8")

test("a stable release's omarchy.org link is found, and only that shape of link", () => {
  const stable = { tag: "v4.5.0", prerelease: false, body: finalBody }
  assert.equal(N.newsUrlFor(stable), "https://omarchy.org/news/2026/11/omarchy-4-5/")
  assert.equal(N.newsUrlFor({ ...stable, prerelease: true }), "")
  assert.equal(N.newsUrlFor({ ...stable, body: "See https://omarchy.org.evil.invalid/news/2026/11/x/" }), "")
  assert.equal(N.newsUrlFor({ ...stable, body: "See https://omarchy.org/news/../../etc/" }), "")
  assert.equal(N.newsUrlFor({ ...stable, body: "Notes: https://omarchy.org/news/2026/11/omarchy-4-5" }), "https://omarchy.org/news/2026/11/omarchy-4-5/")
})

test("the omarchy.org post follows the page: its topics, then its lists", () => {
  const sections = plain(N.parseNewsPage(page))
  assert.deepEqual(sections.map((s) => [s.title, s.key, s.items.length]), [
    ["", true, 22],
    ["More features", false, 29],
    ["Security", false, 13],
    ["Fixes", false, 215]
  ])
  const topics = sections[0].items.map((i) => i.title)
  assert.equal(topics[0], "Floating workspaces with a dock")
  assert.equal(topics[21], "Changed hotkeys")
  assert.ok(topics.includes("Omarchy on Apple Silicon"))
})

test("a topic of named apps lists each app in its place", () => {
  const items = plain(N.parseNewsPage(page))[0].items
  const topics = items.map((i) => i.title)
  assert.ok(!topics.includes("Five new default apps"))
  assert.deepEqual(topics.slice(4, 12), [
    "Sign in to captive Wi-Fi portals",
    "Hype", "Signed", "Disktree", "Monologue", "Gliff", "Elsewhen",
    "Microsoft 365"
  ])
  const hype = items.find((i) => i.title === "Hype")
  assert.match(hype.detail, /^Hype makes presentations from a single Markdown file/)
  assert.ok(!hype.detail.includes("Signed"))
  assert.match(items.find((i) => i.title === "Elsewhen").detail, /^And there’s Elsewhen, a world clock/)
})

test("one bold name in a topic does not split it, and ids keep their old key", () => {
  const one = plain(N.parseNewsPage('<article><h2>Tools</h2><p><strong>Hype</strong> is new.</p><p>More text.</p></article>'))
  assert.deepEqual(one[0].items.map((i) => i.title), ["Tools"])
  const two = plain(N.parseNewsPage('<article><h2>Apps</h2><p><strong>A</strong> one.</p><p>And <strong>B</strong> two.</p></article>'))
  assert.deepEqual(two[0].items.map((i) => i.title), ["A", "B"])
  const topic = plain(N.parseNewsPage(page))[0].items[0]
  assert.equal(topic.id, plain(N.itemId("Highlights", "Floating workspaces with a dock")))
})

test("a topic's lists stay under the line that introduces them", () => {
  const hotkeys = plain(N.parseNewsPage(page))[0].items.find((i) => i.title === "Changed hotkeys")
  const lines = hotkeys.detail.split("\n")
  assert.equal(lines[0], "Some shortcuts moved:")
  assert.match(lines[1], /^• Calculator: Super \+ Ctrl \+ Q is now Super \+ Shift \+ Q\.$/)
  assert.ok(lines.indexOf("Notification shortcuts changed:") > 1)
})

test("list items lose their credits, commits included", () => {
  for (const section of plain(N.parseNewsPage(page)).slice(1))
    for (const item of section.items) assert.doesNotMatch(item.title, / by @|#\d|@[0-9a-f]{7}/, item.title)
  assert.equal(N.stripAttribution("Fix boot entries by @emirb in omacom/omarchy-iso@716bc15"), "Fix boot entries")
  assert.equal(N.stripAttribution("Update translations by @ryanrhughes in 2550970"), "Update translations")
  assert.equal(N.stripAttribution("Fix the logo in defaced"), "Fix the logo in defaced")
})

test("page text is plain: tags stripped before entities are decoded", () => {
  const html = '<article><h2>A &lt;b&gt;bold&lt;/b&gt; &amp; <i>new</i> thing</h2><p>It&rsquo;s here &#x2014; <img src="x"> now.</p></article>'
  const [section] = plain(N.parseNewsPage(html))
  assert.equal(section.items[0].title, "A <b>bold</b> & new thing")
  assert.equal(section.items[0].detail, "It’s here — now.")
})

// Code markers, shown as ⟦ ⟧ so the expectations can be read.
const shown = (text) => text.replace(//g, "⟦").replace(//g, "⟧")
const blockList = (item) => item.blocks.map((b) => [b.kind + (b.depth ? "1" : ""), shown(b.text)])

test("the post's topics keep their paragraphs, lists and code as blocks", () => {
  const items = plain(N.parseNewsPage(page))[0].items
  const hotkeys = items.find((i) => i.title === "Changed hotkeys")
  const kinds = blockList(hotkeys)
  assert.deepEqual(kinds[0], ["lead", "Some shortcuts moved:"])
  assert.deepEqual(kinds[1], ["li", "Calculator: ⟦Super + Ctrl + Q⟧ is now ⟦Super + Shift + Q⟧."])
  assert.deepEqual(kinds.filter(([kind]) => kind === "lead").map(([, text]) => text), [
    "Some shortcuts moved:",
    "Notification shortcuts changed:",
    "A few keys work differently:",
    "New defaults that could collide with bindings of your own:"
  ])
  // The closing sentence of key bindings becomes a list of its own.
  assert.deepEqual(kinds.at(-1), ["li", "holding ⟦Right Alt⟧ for push-to-talk dictation"])
  assert.ok(kinds.some(([kind, text]) => kind === "li" && text === "⟦Super + A⟧ (select all)"))

  const mac = items.find((i) => i.title === "Omarchy on Apple Silicon")
  assert.deepEqual(blockList(mac).map(([kind]) => kind), ["p", "pre", "p", "p"])
  assert.equal(mac.blocks[1].text, "brew install omacom/mac/omarchy")

  for (const item of items) {
    assert.equal(item.detail, N.blocksText(item.blocks).slice(0, N.MAX_DETAIL))
    for (const block of item.blocks) assert.doesNotMatch(block.plain, /[]/)
  }
})

test("GitHub's markdown keeps its code spans, fences and nesting as blocks", () => {
  const highlights = plain(N.parseNotes(rcBody)).find((s) => s.title === "Highlights")
  assert.deepEqual(blockList(highlights.items[1]), [["p", "⟦Super + L⟧ now cycles layouts."]])
  const breaking = plain(N.parseNotes(rcBody))[0]
  assert.deepEqual(blockList(breaking.items[1]), [
    ["li", "Calculator: ⟦Super + Ctrl + Q⟧ is now ⟦Super + Shift + Q⟧."],
    ["li", "Nightlight no longer has a shortcut."]
  ])
  const [section] = plain(N.parseNotes("## Notes\n\n### Moved\n\nRun this:\n\n```\nmv a b\n  mv c d\n```\n\n- outer\n  - inner\n"))
  assert.deepEqual(blockList(section.items[0]), [["p", "Run this:"], ["pre", "mv a b\n  mv c d"]])
  const [tail] = plain(N.parseNotes("## Notes\n\n**Lead.** Text.\n\n- outer\n  - inner\n"))
  assert.deepEqual(blockList(tail.items[0]), [["p", "Text."], ["li", "outer"], ["li", "inner"]])
})

test("a sentence with a colon and commas stays a paragraph unless it lists code", () => {
  const prose = '<article><h2>Note</h2><p>Three things: speed, polish, and care for detail.</p></article>'
  assert.deepEqual(blockList(plain(N.parseNewsPage(prose))[0].items[0]), [["p", "Three things: speed, polish, and care for detail."]])
  const keys = '<article><h2>Keys</h2><p>New: <code>A</code> (one, two), <code>B</code>, <code>C</code>, and <code>D</code>.</p></article>'
  assert.deepEqual(blockList(plain(N.parseNewsPage(keys))[0].items[0]), [
    ["lead", "New:"], ["li", "⟦A⟧ (one, two)"], ["li", "⟦B⟧"], ["li", "⟦C⟧"], ["li", "⟦D⟧"]
  ])
})

test("downloaded text cannot forge a code span", () => {
  const html = '<article><h2>X</h2><p>a b c &#xE000;d&#57345; <code>e</code></p></article>'
  const [item] = plain(N.parseNewsPage(html))[0].items
  assert.equal(shown(item.blocks[0].text), "a b c d ⟦e⟧")
  const [section] = plain(N.parseNotes("## Notes\n\n### T\n\nx y `z`\n"))
  assert.equal(shown(section.items[0].blocks[0].text), "x y ⟦z⟧")
})

test("styled text escapes everything and adds only the code color", () => {
  const text = 'Run <img src="x"> & Super + L, then a "long" command that goes past thirty-two chars'
  assert.equal(
    N.styledText(text, "#e0e0e0"),
    'Run &lt;img src=&quot;x&quot;&gt; &amp; <font color="#e0e0e0">Super&nbsp;+&nbsp;L</font>, then ' +
      '<font color="#e0e0e0">a &quot;long&quot; command that goes past thirty-two chars</font>'
  )
  // A color that is not plain hex is never written into a tag.
  assert.equal(N.styledText("<b>", '"><img src=x>'), "&lt;b&gt;")
  // Unbalanced markers still give balanced tags.
  assert.equal(N.styledText("a b", "#ffffff"), 'a <font color="#ffffff">b</font>')
  assert.equal(N.styledText("a b", "#ffffff"), "a b")
})

test("a page without an article gives nothing, and the notes stay as they were", () => {
  assert.deepEqual(plain(N.parseNewsPage("<html><h2>X</h2><p>y</p></html>")), [])
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  assert.equal(N.withNews(notes, [], "https://omarchy.org/news/2026/11/x/"), notes)
})

test("with the post read, the checklist and the link follow it", () => {
  const notes = N.withNews(N.notesFor(N.parseReleases(feed), "v4.5.0"), N.parseNewsPage(page), "https://omarchy.org/news/2026/11/omarchy-4-5/")
  assert.equal(notes.sourceUrl, "https://omarchy.org/news/2026/11/omarchy-4-5/")
  assert.equal(notes.sourceLabel, "omarchy.org")
  assert.deepEqual(plain(N.progress(notes, {})), { done: 0, total: 22 })
  assert.deepEqual(plain(N.moreSections(notes)).map((s) => [s.title, s.items.length]), [
    ["More features", 29],
    ["Security", 13],
    ["Fixes", 215]
  ])
})

test("without the post, the link is to the notes the list came from", () => {
  const notes = N.notesFor(N.parseReleases(feed), "v4.5.0")
  assert.equal(notes.sourceUrl, "https://github.com/omacom/omarchy/releases/tag/v4.5.0-rc3")
  assert.equal(notes.sourceLabel, "v4.5.0-rc3")
})
