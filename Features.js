// Hand-written knowledge about particular release items: a "Try it" command
// that opens the feature, and a signal from bin/newmarchy-detect that shows
// the feature has been used. Release notes are prose, so none of this can be
// derived from them; it is keyed by release and by the item's title as
// parsed, and tests/features.test.mjs fails if a title stops matching
// both the omarchy.org post and the rc3 notes.
//
// Every command is a fixed argv run without a shell. Nothing from the network
// ever reaches one.

var FEATURES = {
  "4.5.0": {
    // Headings of the 4.5 post on omarchy.org, which the checklist follows.
    "Floating workspaces with a dock": {
      try: ["omarchy-menu", "summon", "appearance.workspace-layout"],
      tryLabel: "Workspace layouts",
      signal: "floating"
    },
    "50 languages and 5 input methods": {
      try: ["omarchy-menu", "summon", "setup.language"],
      tryLabel: "Pick a language",
      signal: "language"
    },
    "Five new default apps": {
      try: ["uwsm-app", "--", "hype.desktop"],
      tryLabel: "Open Hype",
      signal: "new-apps"
    },
    "Agent upgrades": {
      try: ["hyprctl", "dispatch", "hl.dsp.workspace.toggle_special(\"qconsole\")"],
      tryLabel: "Drop the console",
      signal: "quake"
    },
    "Notifications, rebuilt": {
      try: ["omarchy-notification-send", "-g", "󰎔", "This is the new notification card", "It follows your theme. Press Super + Comma to dismiss it."],
      tryLabel: "Send a test card"
    },
    "Video backgrounds and theme intros": {
      try: ["omarchy-menu", "summon", "appearance.background"],
      tryLabel: "Pick a background",
      signal: "video-background"
    },
    "Jade Horse joins the default themes": {
      try: ["omarchy-menu", "summon", "theme"],
      tryLabel: "Open themes",
      signal: "new-themes"
    },
    "Liftoff is the new default background": {
      try: ["omarchy-menu", "summon", "appearance.background"],
      tryLabel: "Pick a background"
    },
    "Changed hotkeys": {
      try: ["omarchy-menu-keybindings"],
      tryLabel: "Show keybindings"
    },

    // Headings of the v4.5.0-rc3 notes, used when omarchy.org can't be read.
    "Some shortcuts moved": {
      try: ["omarchy-menu-keybindings"],
      tryLabel: "Show keybindings"
    },
    "Notification shortcuts changed": {
      try: ["omarchy-notification-send", "-g", "󰎔", "Try the new notification keys", "Super + Comma acts on this card. Super + Ctrl + Comma takes the keyboard."],
      tryLabel: "Send a test card"
    },
    "A few keys work differently": {
      try: ["omarchy-menu-keybindings"],
      tryLabel: "Show keybindings"
    },
    "Add Omarchy in 50 languages": {
      try: ["omarchy-menu", "summon", "setup.language"],
      tryLabel: "Pick a language",
      signal: "language"
    },
    "Add floating workspaces with a dock": {
      try: ["omarchy-menu", "summon", "appearance.workspace-layout"],
      tryLabel: "Workspace layouts",
      signal: "floating"
    },
    "Add new, enhanced notifications": {
      try: ["omarchy-notification-send", "-g", "󰎔", "This is the new notification card", "It follows your theme. Press Super + Comma to dismiss it."],
      tryLabel: "Send a test card"
    },
    "Add an Appearance menu for how the desktop looks": {
      try: ["omarchy-menu", "summon", "appearance"],
      tryLabel: "Open Appearance"
    },
    "Add video wallpapers and theme intros": {
      try: ["omarchy-menu", "summon", "appearance.background"],
      tryLabel: "Pick a background",
      signal: "video-background"
    },
    "Speed up theme switching, menus, panels, and the bash prompt": {
      try: ["omarchy-menu", "summon", "theme"],
      tryLabel: "Open themes"
    },
    "Add Hype, Signed, Disktree, and Monologue as default apps": {
      try: ["uwsm-app", "--", "hype.desktop"],
      tryLabel: "Open Hype",
      signal: "new-apps"
    },
    "Add Elsewhen, a built-in world clock": {
      try: ["omarchy-shell", "shell", "toggle", "omarchy.elsewhen"],
      tryLabel: "Open Elsewhen",
      signal: "elsewhen"
    },
    "Add a Quake-style terminal console": {
      try: ["hyprctl", "dispatch", "hl.dsp.workspace.toggle_special(\"qconsole\")"],
      tryLabel: "Drop the console",
      signal: "quake"
    },
    "Add Starship and Jade Horse as default themes": {
      try: ["omarchy-menu", "summon", "theme"],
      tryLabel: "Open themes",
      signal: "new-themes"
    }
  }
}

// Signal names bin/newmarchy-detect may print. Anything else in its output
// is ignored.
var SIGNALS = ["language", "floating", "quake", "elsewhen", "video-background", "new-apps", "new-themes"]

function releaseKey(tag) {
  var match = /^v?(\d+(?:\.\d+){1,3})$/.exec(String(tag || ""))
  return match ? match[1] : ""
}

function featureFor(tag, title) {
  var release = FEATURES[releaseKey(tag)]
  if (!release || !release.hasOwnProperty(title)) return null
  return release[title]
}

function parseSignals(raw) {
  var found = []
  var words = String(raw || "").split(/\s+/)
  for (var i = 0; i < words.length && i < 64; i++)
    if (SIGNALS.indexOf(words[i]) >= 0 && found.indexOf(words[i]) < 0) found.push(words[i])
  return found
}

// Item ids in notes whose feature's signal is among the signals found.
function detectedIds(notes, signals) {
  var ids = []
  if (!notes) return ids
  for (var i = 0; i < notes.sections.length; i++) {
    var items = notes.sections[i].items
    for (var j = 0; j < items.length; j++) {
      var feature = featureFor(notes.tag, items[j].title)
      if (feature && feature.signal && signals.indexOf(feature.signal) >= 0) ids.push(items[j].id)
    }
  }
  return ids
}
