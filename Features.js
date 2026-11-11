// Hand-written knowledge about particular release items: a "Try it" command
// that opens the feature, an optional signal it needs before it is offered,
// and a signal from bin/newmarchy-detect that shows the feature has been used. Release notes are prose, so none of this can be
// derived from them; it is keyed by release and by the item's title as
// parsed, and tests/features.test.mjs fails if a title stops matching
// both the omarchy.org post and the rc3 notes.
//
// Every command is a fixed argv run without a shell. Nothing from the network
// ever reaches one. tryLabel is a key in i18n/, and an argument written as
// { t: "key" } is replaced by that translated string when the command runs.

var FEATURES = {
  "4.5.0": {
    // Headings of the 4.5 post on omarchy.org, which the checklist follows.
    "Floating workspaces with a dock": {
      try: ["omarchy-menu", "summon", "appearance.workspace-layout"],
      tryLabel: "try.workspaceLayouts",
      signal: "floating"
    },
    "50 languages and 5 input methods": {
      try: ["omarchy-menu", "summon", "setup.language"],
      tryLabel: "try.language",
      signal: "language"
    },
    "Hype": {
      try: ["uwsm-app", "--", "hype.desktop"],
      tryLabel: "try.hype",
      needs: "has-hype",
      signal: "hype"
    },
    "Signed": {
      try: ["uwsm-app", "--", "signed.desktop"],
      tryLabel: "try.signed",
      needs: "has-signed",
      signal: "signed"
    },
    "Disktree": {
      try: ["uwsm-app", "--", "disktree.desktop"],
      tryLabel: "try.disktree",
      needs: "has-disktree",
      signal: "disktree"
    },
    "Monologue": {
      try: ["uwsm-app", "--", "monologue.desktop"],
      tryLabel: "try.monologue",
      needs: "has-monologue",
      signal: "monologue"
    },
    "Gliff": {
      try: ["uwsm-app", "--", "gliff.desktop"],
      tryLabel: "try.gliff",
      needs: "has-gliff",
      signal: "gliff"
    },
    "Elsewhen": {
      try: ["omarchy-shell", "shell", "toggle", "omarchy.elsewhen"],
      tryLabel: "try.elsewhen",
      signal: "elsewhen"
    },
    "Agent upgrades": {
      try: ["hyprctl", "dispatch", "hl.dsp.workspace.toggle_special(\"qconsole\")"],
      tryLabel: "try.console",
      signal: "quake"
    },
    "Notifications, rebuilt": {
      try: ["omarchy-notification-send", "-g", "󰎔", { t: "try.cardTitle" }, { t: "try.cardBody" }],
      tryLabel: "try.testCard"
    },
    "Video backgrounds and theme intros": {
      try: ["omarchy-menu", "summon", "appearance.background"],
      tryLabel: "try.background",
      signal: "video-background"
    },
    "Jade Horse joins the default themes": {
      try: ["omarchy-theme-set", "Jade Horse"],
      tryLabel: "try.jadeHorse",
      signal: "new-themes"
    },
    "Liftoff is the new default background": {
      try: ["omarchy-menu", "summon", "appearance.background"],
      tryLabel: "try.background"
    },
    "Changed hotkeys": {
      try: ["omarchy-menu-keybindings"],
      tryLabel: "try.keybindings"
    },

    // Headings of the v4.5.0-rc3 notes, used when omarchy.org can't be read.
    "Some shortcuts moved": {
      try: ["omarchy-menu-keybindings"],
      tryLabel: "try.keybindings"
    },
    "Notification shortcuts changed": {
      try: ["omarchy-notification-send", "-g", "󰎔", { t: "try.keysTitle" }, { t: "try.keysBody" }],
      tryLabel: "try.testCard"
    },
    "A few keys work differently": {
      try: ["omarchy-menu-keybindings"],
      tryLabel: "try.keybindings"
    },
    "Add Omarchy in 50 languages": {
      try: ["omarchy-menu", "summon", "setup.language"],
      tryLabel: "try.language",
      signal: "language"
    },
    "Add floating workspaces with a dock": {
      try: ["omarchy-menu", "summon", "appearance.workspace-layout"],
      tryLabel: "try.workspaceLayouts",
      signal: "floating"
    },
    "Add new, enhanced notifications": {
      try: ["omarchy-notification-send", "-g", "󰎔", { t: "try.cardTitle" }, { t: "try.cardBody" }],
      tryLabel: "try.testCard"
    },
    "Add an Appearance menu for how the desktop looks": {
      try: ["omarchy-menu", "summon", "appearance"],
      tryLabel: "try.appearance"
    },
    "Add video wallpapers and theme intros": {
      try: ["omarchy-menu", "summon", "appearance.background"],
      tryLabel: "try.background",
      signal: "video-background"
    },
    "Speed up theme switching, menus, panels, and the bash prompt": {
      try: ["omarchy-menu", "summon", "theme"],
      tryLabel: "try.themes"
    },
    "Add Hype, Signed, Disktree, and Monologue as default apps": {
      try: ["uwsm-app", "--", "hype.desktop"],
      tryLabel: "try.hype",
      signal: "new-apps"
    },
    "Add Elsewhen, a built-in world clock": {
      try: ["omarchy-shell", "shell", "toggle", "omarchy.elsewhen"],
      tryLabel: "try.elsewhen",
      signal: "elsewhen"
    },
    "Add a Quake-style terminal console": {
      try: ["hyprctl", "dispatch", "hl.dsp.workspace.toggle_special(\"qconsole\")"],
      tryLabel: "try.console",
      signal: "quake"
    },
    "Add Starship and Jade Horse as default themes": {
      try: ["omarchy-menu", "summon", "theme"],
      tryLabel: "try.themes",
      signal: "new-themes"
    }
  }
}

// Signal names bin/newmarchy-detect may print. Anything else in its output
// is ignored.
var APPS = ["hype", "signed", "disktree", "monologue", "gliff"]
var SIGNALS = ["language", "floating", "quake", "elsewhen", "video-background", "new-apps", "new-themes"]
  .concat(APPS, APPS.map(function (app) { return "has-" + app }))

function releaseKey(tag) {
  var match = /^v?(\d+(?:\.\d+){1,3})$/.exec(String(tag || ""))
  return match ? match[1] : ""
}

function featureFor(tag, title) {
  var release = FEATURES[releaseKey(tag)]
  if (!release || !release.hasOwnProperty(title)) return null
  return release[title]
}

// The argv a feature's Try runs, with each { t: "key" } argument replaced by
// translate(key), so a test card reads in the user's language.
function tryArgv(feature, translate) {
  var argv = [];
  for (var i = 0; i < feature.try.length; i++) {
    var arg = feature.try[i];
    argv.push(typeof arg === "string" ? arg : String(translate(arg.t)));
  }
  return argv;
}

function parseSignals(raw) {
  var found = []
  var words = String(raw || "").split(/\s+/)
  for (var i = 0; i < words.length && i < 64; i++)
    if (SIGNALS.indexOf(words[i]) >= 0 && found.indexOf(words[i]) < 0) found.push(words[i])
  return found
}

// Whether a feature's Try can run here: one that names an app it needs
// ("has-hype") shows its button only once detection has found that app.
function canTry(feature, signals) {
  return !!(feature && feature.try && (!feature.needs || signals.indexOf(feature.needs) >= 0))
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
