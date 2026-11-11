import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

const context = vm.createContext({ Array, Error, JSON, Math, Number, String, encodeURIComponent, parseInt })
vm.runInContext(readFileSync(new URL("../Newmarchy.js", import.meta.url), "utf8"), context)
vm.runInContext(readFileSync(new URL("../Features.js", import.meta.url), "utf8"), context)
const N = context
const plain = (value) => JSON.parse(JSON.stringify(value))

// The real v4.5.0-rc3 notes, which v4.5.0 borrows.
const body = readFileSync(new URL("./fixtures/v4.5.0-rc3.md", import.meta.url), "utf8")
const notes = { tag: "v4.5.0", sections: N.parseNotes(body) }
const titles = notes.sections.flatMap((section) => section.items.map((item) => item.title))

// The 4.5 post on omarchy.org, which the stable release links to.
const page = readFileSync(new URL("./fixtures/omarchy-4-5.html", import.meta.url), "utf8")
const news = { tag: "v4.5.0", sections: N.parseNewsPage(page) }
const newsTitles = news.sections.flatMap((section) => section.items.map((item) => item.title))

test("every mapped feature names a real item in the omarchy.org post or the rc3 notes", () => {
  for (const title of Object.keys(N.FEATURES["4.5.0"]))
    assert.ok(titles.includes(title) || newsTitles.includes(title), `no item titled "${title}"`)
})

test("the omarchy.org checklist keeps its Try buttons and detection", () => {
  const mapped = newsTitles.filter((title) => N.featureFor("v4.5.0", title))
  assert.equal(mapped.length, 9)
  const ids = plain(N.detectedIds(news, ["quake", "floating"]))
  const byId = Object.fromEntries(news.sections.flatMap((s) => s.items.map((i) => [i.id, i.title])))
  assert.deepEqual(ids.map((id) => byId[id]).sort(), ["Agent upgrades", "Floating workspaces with a dock"])
})

test("every feature command is a fixed argv of plain strings", () => {
  for (const [title, feature] of Object.entries(N.FEATURES["4.5.0"])) {
    assert.ok(Array.isArray(feature.try) && feature.try.length > 0, title)
    for (const arg of feature.try) assert.equal(typeof arg, "string", title)
    assert.ok(feature.tryLabel, title)
    if (feature.signal) assert.ok(N.SIGNALS.includes(feature.signal), `${title}: unknown signal ${feature.signal}`)
  }
})

test("features are matched by release, not by later ones", () => {
  assert.ok(N.featureFor("v4.5.0", "Add a Quake-style terminal console"))
  assert.equal(N.featureFor("v4.0.6", "Add a Quake-style terminal console"), null)
  assert.equal(N.featureFor("v4.5.0", "No such item"), null)
  assert.equal(N.featureFor("v4.5.0-rc3", "Add a Quake-style terminal console"), null)
})

test("parseSignals keeps known words only, once each", () => {
  assert.deepEqual(plain(N.parseSignals("quake\nelsewhen\nquake\nrm -rf /\n<b>x</b>\n")), ["quake", "elsewhen"])
  assert.deepEqual(plain(N.parseSignals("")), [])
})

test("detected signals map to the right items", () => {
  const ids = plain(N.detectedIds(notes, ["quake", "new-apps"]))
  const byId = Object.fromEntries(notes.sections.flatMap((s) => s.items.map((i) => [i.id, i.title])))
  assert.deepEqual(ids.map((id) => byId[id]).sort(), [
    "Add Hype, Signed, Disktree, and Monologue as default apps",
    "Add a Quake-style terminal console"
  ])
})

test("detection ticks an item once and leaves a later untick alone", () => {
  const ids = N.detectedIds(notes, ["quake"])
  let { seen, ticked } = N.applyDetected({}, "v4.5.0", ids)
  assert.equal(ticked.length, 1)
  assert.ok(N.isSeen(seen, "v4.5.0", ids[0]))
  assert.ok(N.wasAutoTicked(seen, "v4.5.0", ids[0]))

  seen = N.setSeen(seen, "v4.5.0", [ids[0]], false) // you untick it
  const again = N.applyDetected(seen, "v4.5.0", ids)
  assert.equal(again.ticked.length, 0)
  assert.equal(N.isSeen(again.seen, "v4.5.0", ids[0]), false)
})

test("the auto-tick record survives the state file round trip", () => {
  const ids = N.detectedIds(notes, ["elsewhen"])
  const { seen } = N.applyDetected({}, "v4.5.0", ids)
  const reread = N.parseSeen(N.serializeSeen(seen))
  assert.ok(N.wasAutoTicked(reread, "v4.5.0", ids[0]))
})

test("the real 4.5.0 notes give 4 breaking changes and 16 highlights", () => {
  assert.deepEqual(plain(N.progress(notes, {})), { done: 0, total: 20 })
  assert.deepEqual(plain(notes.sections.slice(0, 2).map((s) => [s.title, s.items.length])), [
    ["Breaking changes", 4],
    ["Highlights", 16]
  ])
})
