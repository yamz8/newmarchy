// Everything newmarchy knows about releases lives here, away from the QML, so
// it can be exercised under node --test. Nothing in this file touches the
// network, the filesystem, or the shell.

var REPO = "omacom/omarchy"
var RELEASES_URL = "https://api.github.com/repos/" + REPO + "/releases?per_page=30"
var RELEASES_PAGE = "https://github.com/" + REPO + "/releases"

// Bounds on what a release can put in front of the user. GitHub caps a body
// at 125,000 characters; these are tighter, because a checklist with more
// than a few hundred rows stops being one.
var MAX_RELEASES = 60
var MAX_BODY = 200000
var MAX_SECTIONS = 40
var MAX_ITEMS = 600
var MAX_TITLE = 220
var MAX_DETAIL = 4000
var MAX_TAG = 64

// Sections that are about installing, not about what changed.
var SKIPPED_SECTIONS = /^(install|download|iso|checksums?|sha256|full changelog|new contributors|contributors)\b/i

// The sections the bar badge counts. A big release lists hundreds of fixes
// under Features, Improvements, and Fixes; counting those would leave a
// badge nobody ever clears. Breaking changes and highlights are what you
// need to have seen. A release without either counts everything.
var KEY_SECTIONS = /^(breaking|highlights?)\b/i
var BREAKING_SECTION = /^breaking\b/i

function clip(text, limit) {
  text = String(text || "")
  if (text.length <= limit) return text
  return text.slice(0, limit - 1).replace(/\s+\S*$/, "") + "…"
}

// "4.5.0-3" (pacman pkgver-pkgrel) or "v4.5.0" or "4.5.0" -> "4.5.0".
// Anything that is not a dotted version, such as "dev (abc123)", is "".
function baseVersion(value) {
  var match = /^v?(\d+(?:\.\d+){1,3})(?:[-+].*)?$/.exec(String(value || "").trim())
  return match ? match[1] : ""
}

// Tags come from the network and are used as keys in the state file, so only
// the characters a git tag for a release would carry are let through.
function safeTag(value) {
  var tag = String(value || "")
  if (tag.length === 0 || tag.length > MAX_TAG) return ""
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag) ? tag : ""
}

function safeReleaseUrl(value, tag) {
  var url = String(value || "")
  var expected = "https://github.com/" + REPO + "/releases/tag/"
  if (url.indexOf(expected) === 0 && /^[A-Za-z0-9._%-]+$/.test(url.slice(expected.length))) return url
  return tag ? expected + encodeURIComponent(tag) : RELEASES_PAGE
}

// Inline markdown to plain text. Links keep their text, images go, emphasis
// and code marks are dropped. The result is still displayed with
// Text.PlainText; this is about readability, not safety.
function plainInline(text) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    // Only the HTML a release body actually uses. A blanket tag strip would
    // also eat placeholders such as `omarchy language <code>`.
    .replace(/<\/?(?:img|br|p|div|a|details|summary|sub|sup|picture|source|video|kbd|hr)\b[^>]*>/gi, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s.,;:!?)]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim()
}

// A changelog bullet ends in attribution: "by @dhh in #14433", or
// "by @a, @b in omacom/omarchy-pkgs#1244". That belongs to the record, not
// to the thing you are checking off.
// The omarchy.org notes also credit commits: "in omacom/omarchy-iso@716bc15"
// or "in 2550970". A bare hash needs a digit, so a word like "defaced"
// is left alone.
var REF = "(?:(?:[\\w.-]+\\/[\\w.-]+)?#\\d+|(?:[\\w.-]+\\/[\\w.-]+@)?(?=[0-9a-f]*\\d)[0-9a-f]{7,40})"
var BY_ATTRIBUTION = new RegExp("\\s+by\\s+@[\\w-]+(?:\\s*(?:,|and)\\s*@[\\w-]+)*(?:\\s+in\\s+" + REF + "(?:\\s*(?:,|and)\\s*" + REF + ")*)?\\s*\\.?\\s*$", "i")
var IN_ATTRIBUTION = new RegExp("\\s+in\\s+" + REF + "\\s*\\.?\\s*$", "i")

function stripAttribution(text) {
  return String(text || "")
    .replace(BY_ATTRIBUTION, "")
    .replace(IN_ATTRIBUTION, "")
    .trim()
}

// A short, stable id for an item, so a check survives a re-fetch and the
// same title in two sections stays two items. djb2, as unsigned hex.
function itemId(section, title) {
  var source = String(section) + "\n" + String(title)
  var hash = 5381
  for (var i = 0; i < source.length; i++)
    hash = ((hash * 33) ^ source.charCodeAt(i)) >>> 0
  return hash.toString(16)
}

function headingTitle(line) {
  return plainInline(line.replace(/^#+\s*/, "").replace(/\s*#+\s*$/, ""))
}

// "**The boot menu stays out of the way now.** Limine waits..." ->
// { title: "The boot menu stays out of the way now", rest: "Limine waits..." }
function boldLead(line) {
  var match = /^\*\*(.+?)\*\*\s*(.*)$/.exec(line)
  if (!match) return null
  var title = plainInline(match[1]).replace(/[.:]\s*$/, "").trim()
  if (title === "") return null
  return { title: title, rest: match[2] }
}

function isBullet(line) {
  return /^\s*[-*+]\s+/.test(line)
}

function bulletText(line) {
  return line.replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, "")
}

// Release notes -> [{ title, key, breaking, items: [{ id, title, detail }] }].
//
// Inside each "## " section:
//   ### heading        an item; the prose under it is the detail
//   **Lead.** text     an item; the text and any bullets after it are detail
//   - bullet           an item of its own, unless it belongs to a lead above
//   a paragraph        detail for the item before it
// A section with prose but no items becomes one item named after itself.
// Anything before the first "## " is the release's preamble (download links,
// checksums) and is skipped, as are sections about installing.
function parseNotes(body) {
  var text = String(body || "")
  if (text.length > MAX_BODY) text = text.slice(0, MAX_BODY)
  var lines = text.replace(/\r\n?/g, "\n").split("\n")

  var sections = []
  var section = null
  var item = null
  var leadOwnsBullets = false
  var inFence = false
  var itemCount = 0
  var sectionProse = []

  function addDetail(target, line) {
    if (target.detail.length >= MAX_DETAIL) return
    target.detail = target.detail === "" ? line : target.detail + "\n" + line
  }

  function finishSection() {
    if (!section) return
    if (section.items.length === 0 && sectionProse.length > 0 && itemCount < MAX_ITEMS) {
      section.items.push({ id: itemId(section.title, section.title), title: section.title, detail: sectionProse.join("\n") })
      itemCount++
    }
    for (var i = 0; i < section.items.length; i++) {
      section.items[i].title = clip(section.items[i].title, MAX_TITLE)
      section.items[i].detail = clip(section.items[i].detail.replace(/\n{3,}/g, "\n\n").trim(), MAX_DETAIL)
    }
    if (section.items.length > 0 && sections.length < MAX_SECTIONS) sections.push(section)
    section = null
    item = null
    sectionProse = []
  }

  function addItem(title, detail, ownsBullets) {
    item = null
    leadOwnsBullets = false
    if (!section || title === "" || itemCount >= MAX_ITEMS) return
    for (var i = 0; i < section.items.length; i++)
      if (section.items[i].title === title) return
    item = { id: itemId(section.title, title), title: title, detail: detail || "" }
    section.items.push(item)
    leadOwnsBullets = ownsBullets
    itemCount++
  }

  for (var i = 0; i < lines.length; i++) {
    var raw = lines[i]
    var line = raw.trim()

    if (/^(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) {
      if (section && item) addDetail(item, "  " + raw.replace(/\s+$/, ""))
      else if (section) sectionProse.push("  " + raw.trim())
      continue
    }

    if (/^##\s+/.test(line) && !/^###/.test(line)) {
      finishSection()
      var title = headingTitle(line)
      if (title === "" || SKIPPED_SECTIONS.test(title)) continue
      section = { title: clip(title, MAX_TITLE), key: KEY_SECTIONS.test(title), breaking: BREAKING_SECTION.test(title), items: [] }
      continue
    }
    if (!section) continue

    if (/^#{3,6}\s+/.test(line)) {
      addItem(headingTitle(line), "", false)
      continue
    }
    if (line === "") {
      // A blank line ends a lead's claim on the bullets after it only when
      // what follows is not itself a bullet.
      continue
    }
    if (/^!\[/.test(line) || /^\*\*full changelog\*\*/i.test(line) || /^-{3,}$/.test(line)) continue

    var lead = boldLead(line)
    if (lead) {
      addItem(lead.title, plainInline(lead.rest), true)
      continue
    }

    if (isBullet(raw)) {
      var bullet = plainInline(bulletText(raw))
      if (bullet === "") continue
      if (item && leadOwnsBullets) addDetail(item, "• " + stripAttribution(bullet))
      else if (item && /^\s{2,}/.test(raw)) addDetail(item, "  • " + stripAttribution(bullet))
      else addItem(stripAttribution(bullet), "", false)
      continue
    }

    var prose = plainInline(line)
    if (prose === "") continue
    if (item) {
      addDetail(item, prose)
    } else {
      sectionProse.push(prose)
    }
  }
  finishSection()

  // Breaking changes go first wherever the notes put them.
  var ordered = []
  for (var b = 0; b < sections.length; b++) if (sections[b].breaking) ordered.push(sections[b])
  for (var o = 0; o < sections.length; o++) if (!sections[o].breaking) ordered.push(sections[o])
  return ordered
}

function countItems(sections) {
  var total = 0
  for (var i = 0; i < sections.length; i++) total += sections[i].items.length
  return total
}

// GitHub's release list -> [{ tag, name, prerelease, published, url, body }],
// newest first, with drafts and malformed entries dropped.
function parseReleases(raw) {
  var data = JSON.parse(raw)
  if (!Array.isArray(data)) {
    var message = data && typeof data.message === "string" ? clip(data.message, 160) : "unexpected response"
    throw new Error(message)
  }
  var releases = []
  for (var i = 0; i < data.length && releases.length < MAX_RELEASES; i++) {
    var entry = data[i]
    if (!entry || typeof entry !== "object" || entry.draft === true) continue
    var tag = safeTag(entry.tag_name)
    if (tag === "") continue
    var published = String(entry.published_at || "")
    releases.push({
      tag: tag,
      name: clip(plainInline(entry.name || tag), 120),
      prerelease: entry.prerelease === true,
      published: /^\d{4}-\d{2}-\d{2}T/.test(published) ? published.slice(0, 10) : "",
      url: safeReleaseUrl(entry.html_url, tag),
      body: typeof entry.body === "string" ? entry.body.slice(0, MAX_BODY) : ""
    })
  }
  return releases
}

function findRelease(releases, tag) {
  for (var i = 0; i < releases.length; i++) if (releases[i].tag === tag) return releases[i]
  return null
}

// A final release's notes are sometimes a paragraph and a link, with the
// full list left on the last release candidate (v4.5.0 is like that, and
// v4.5.0-rc3 carries 30 kB of notes). When the final release has fewer
// items than its newest candidate, the candidate's notes are used.
function notesFor(releases, tag) {
  var release = findRelease(releases, tag)
  if (!release) return null
  var sections = parseNotes(release.body)
  var source = release
  var prefix = release.tag + "-"
  for (var i = 0; i < releases.length; i++) {
    var candidate = releases[i]
    if (!candidate.prerelease || candidate.tag.indexOf(prefix) !== 0) continue
    var candidateSections = parseNotes(candidate.body)
    if (countItems(candidateSections) > countItems(sections)) {
      sections = candidateSections
      source = candidate
    }
    break // releases are newest first, so the first match is the newest RC
  }
  return {
    tag: release.tag,
    name: release.name,
    published: release.published,
    url: release.url,
    sourceTag: source.tag,
    sourceLabel: source.tag,
    sourceUrl: source.url,
    sections: sections
  }
}

// A stable release's GitHub text can be a paragraph and a link to its post
// on omarchy.org ("Release notes: https://omarchy.org/news/2026/11/omarchy-4-5/"),
// with the real notes on that page. Only that exact shape of URL is followed.
var NEWS_URL = /https:\/\/omarchy\.org\/news\/\d{4}\/\d{2}\/[a-z0-9][a-z0-9-]{0,80}\/?(?=[\s)>\]"'.,;]|$)/
var MAX_PAGE = 2 * 1024 * 1024

function newsUrlFor(release) {
  if (!release || release.prerelease) return ""
  var match = NEWS_URL.exec(release.body)
  if (!match) return ""
  return match[0].replace(/\/?$/, "/")
}

var ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", hellip: "…", mdash: "—", ndash: "–",
  middot: "·", deg: "°", times: "×", rarr: "→", larr: "←", copy: "©"
}

function decodeEntities(text) {
  return String(text || "").replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, function (whole, name) {
    if (name.charAt(0) === "#") {
      var code = name.charAt(1) === "x" || name.charAt(1) === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : ""
    }
    var key = name.toLowerCase()
    return ENTITIES.hasOwnProperty(key) ? ENTITIES[key] : whole
  })
}

// An HTML fragment as one line of plain text. Tags go first, then entities
// are decoded, so a decoded "<" can never become markup. The result is
// still displayed with Text.PlainText.
function htmlText(fragment) {
  return decodeEntities(String(fragment || "").replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim()
}

// The <article> of an omarchy.org news post -> the same shape parseNotes
// returns. The page is a run of <h2> topics. A topic written as prose
// (paragraphs, maybe a list or two) is one checklist item, its paragraphs
// the detail. A topic that is only a list ("More features", "Security",
// "Fixes") is a section of its own, one item per bullet. Topics stay in
// page order under one key section; the list sections follow, not counted.
function parseNewsPage(html) {
  var text = String(html || "")
  if (text.length > MAX_PAGE) text = text.slice(0, MAX_PAGE)
  var start = text.search(/<article\b/i)
  var end = text.search(/<\/article\s*>/i)
  if (start < 0 || end < start) return []
  text = text.slice(start, end)

  var blocks = []
  var block = null
  var tokens = /<(h2|p|li)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi
  var match
  while ((match = tokens.exec(text)) !== null) {
    var tag = match[1].toLowerCase()
    if (tag === "h2") {
      var heading = clip(htmlText(match[2]), MAX_TITLE)
      block = heading === "" ? null : { title: heading, prose: 0, lines: [], bullets: [] }
      if (block) blocks.push(block)
      continue
    }
    if (!block) continue
    if (tag === "p") {
      var para = htmlText(match[2])
      if (para !== "") {
        block.prose++
        block.lines.push(para)
      }
      continue
    }
    // A bullet may hold paragraphs of its own: the first is the bullet,
    // the rest its detail.
    var parts = []
    var inner = /<p\b[^>]*>([\s\S]*?)<\/p\s*>/gi
    var p
    while ((p = inner.exec(match[2])) !== null) {
      var part = htmlText(p[1])
      if (part !== "") parts.push(part)
    }
    if (parts.length === 0) parts.push(htmlText(match[2]))
    var bullet = stripAttribution(parts[0])
    if (bullet === "") continue
    block.bullets.push({ title: bullet, detail: parts.slice(1).join("\n") })
    block.lines.push("• " + bullet)
  }

  var topics = { title: "Highlights", key: true, breaking: false, items: [] }
  var lists = []
  var itemCount = 0
  for (var i = 0; i < blocks.length && itemCount < MAX_ITEMS; i++) {
    var b = blocks[i]
    if (b.prose === 0 && b.bullets.length > 0) {
      if (lists.length >= MAX_SECTIONS - 1) continue
      var list = { title: b.title, key: false, breaking: false, items: [] }
      for (var j = 0; j < b.bullets.length && itemCount < MAX_ITEMS; j++) {
        var title = clip(b.bullets[j].title, MAX_TITLE)
        list.items.push({ id: itemId(b.title, title), title: title, detail: clip(b.bullets[j].detail, MAX_DETAIL) })
        itemCount++
      }
      lists.push(list)
      continue
    }
    if (b.prose === 0) continue
    // Paragraphs and bullets in page order, so a topic such as "Changed
    // hotkeys" keeps each list under the line that introduces it.
    topics.items.push({ id: itemId(topics.title, b.title), title: b.title, detail: clip(b.lines.join("\n"), MAX_DETAIL) })
    itemCount++
  }
  return (topics.items.length > 0 ? [topics] : []).concat(lists)
}

// The notes for a release, with the news post's sections in place of
// whatever GitHub had. Without anything usable from the page, the notes
// are returned as they were.
function withNews(notes, sections, url) {
  if (!notes || !sections || countItems(sections) === 0) return notes
  return {
    tag: notes.tag,
    name: notes.name,
    published: notes.published,
    url: notes.url,
    sourceTag: notes.tag,
    sourceLabel: "omarchy.org",
    sourceUrl: url,
    sections: sections
  }
}

// Which release to show when the panel opens: the one you are running, or,
// when that is not in the list (a dev checkout, or a version too old to
// appear), the newest final release.
function defaultTag(releases, installedVersion) {
  var base = baseVersion(installedVersion)
  var newest = ""
  for (var i = 0; i < releases.length; i++) {
    if (releases[i].prerelease) continue
    if (base !== "" && releases[i].tag === "v" + base) return releases[i].tag
    if (newest === "") newest = releases[i].tag
  }
  return newest
}

// Seen state file: { "v4.5.0": ["1a2b3c", ...], ... }. Anything else in the
// file is ignored, and ids are held to the shape itemId() produces.
function parseSeen(raw) {
  var parsed
  try {
    parsed = JSON.parse(String(raw || ""))
  } catch (error) {
    return {}
  }
  var seen = {}
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return seen
  for (var key in parsed) {
    if (!parsed.hasOwnProperty(key) || safeTag(key) === "" || !Array.isArray(parsed[key])) continue
    var ids = []
    for (var i = 0; i < parsed[key].length && ids.length < MAX_ITEMS; i++) {
      var id = String(parsed[key][i])
      if (/^[0-9a-f]{1,8}$/.test(id) && ids.indexOf(id) < 0) ids.push(id)
    }
    seen[key] = ids
  }
  return seen
}

function serializeSeen(seen) {
  return JSON.stringify(seen, null, 2) + "\n"
}

function isSeen(seen, tag, id) {
  return !!(seen[tag] && seen[tag].indexOf(id) >= 0)
}

// Returns a new map; the QML property is reassigned so bindings update.
function setSeen(seen, tag, ids, value) {
  var next = {}
  for (var key in seen) if (seen.hasOwnProperty(key)) next[key] = seen[key].slice()
  var list = next[tag] ? next[tag] : []
  for (var i = 0; i < ids.length; i++) {
    var at = list.indexOf(ids[i])
    if (value && at < 0) list.push(ids[i])
    if (!value && at >= 0) list.splice(at, 1)
  }
  next[tag] = list
  return next
}

// Detection ticks an item once. The ids it has ticked are remembered under
// "auto-<tag>", so an item you untick afterwards stays unticked instead of
// being ticked again on the next check.
function autoKey(tag) {
  return "auto-" + tag
}

function wasAutoTicked(seen, tag, id) {
  return isSeen(seen, autoKey(tag), id)
}

// Returns { seen, ticked }: the new map, and the ids newly ticked (empty
// when nothing changed, so the caller can skip a write).
function applyDetected(seen, tag, ids) {
  var fresh = []
  for (var i = 0; i < ids.length; i++)
    if (!wasAutoTicked(seen, tag, ids[i]) && fresh.indexOf(ids[i]) < 0) fresh.push(ids[i])
  if (fresh.length === 0) return { seen: seen, ticked: [] }
  var next = setSeen(seen, autoKey(tag), fresh, true)
  next = setSeen(next, tag, fresh, true)
  return { seen: next, ticked: fresh }
}

// What the panel lists: breaking changes and highlights when the release
// has them. A big release also lists hundreds of fixes under Features,
// Improvements and Fixes; those stay on the release page. A release without
// either, such as a patch release, lists everything it has.
function checklist(notes) {
  var items = []
  if (!notes) return items
  var hasKey = false
  for (var k = 0; k < notes.sections.length; k++) if (notes.sections[k].key) hasKey = true
  for (var i = 0; i < notes.sections.length; i++) {
    var section = notes.sections[i]
    if (hasKey && !section.key) continue
    for (var j = 0; j < section.items.length; j++) {
      var entry = section.items[j]
      items.push({ id: entry.id, title: entry.title, detail: entry.detail, section: section.title, breaking: section.breaking })
    }
  }
  return items
}

// The sections the checklist leaves out, in the order the notes give them,
// for the read-only part under it: [{ title, items: [{ id, title }] }].
function moreSections(notes) {
  var more = []
  if (!notes) return more
  var hasKey = false
  for (var k = 0; k < notes.sections.length; k++) if (notes.sections[k].key) hasKey = true
  if (!hasKey) return more
  for (var i = 0; i < notes.sections.length; i++) {
    var section = notes.sections[i]
    if (section.key) continue
    var items = []
    for (var j = 0; j < section.items.length; j++) items.push({ id: section.items[j].id, title: section.items[j].title })
    more.push({ title: section.title, items: items })
  }
  return more
}

function progress(notes, seen) {
  var items = checklist(notes)
  var done = 0
  for (var i = 0; i < items.length; i++) if (isSeen(seen, notes.tag, items[i].id)) done++
  return { done: done, total: items.length }
}

// Items the bar badge counts as still to see.
function unseenCount(notes, seen) {
  var counts = progress(notes, seen)
  return counts.total - counts.done
}
