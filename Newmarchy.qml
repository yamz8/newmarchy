import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Newmarchy.js" as N
import "Features.js" as F

Panel {
  id: root

  moduleName: "yamz8.newmarchy"
  ipcTarget: "yamz8.newmarchy"
  manageIpc: false

  implicitWidth: barButton.implicitWidth
  implicitHeight: barButton.implicitHeight

  // A "new" box (U+F0394, Material Design Icons) from the configured Nerd
  // Font, so it stays monochrome and theme-tinted. No other widget uses it.
  readonly property string newIcon: "󰎔"
  readonly property string checkedIcon: "󰄲"
  readonly property string usedIcon: "󰗠"
  readonly property string uncheckedIcon: "󰄱"

  // Thirty releases of notes are about 300 kB. 4 MiB is headroom that still
  // stops a hostile or hijacked endpoint from growing the shell without bound.
  readonly property int maxResponseBytes: 4 * 1024 * 1024
  // GitHub allows 60 unauthenticated requests an hour; opening the panel
  // only refetches when the last good fetch is older than this.
  readonly property int refetchAfterMs: 10 * 60 * 1000
  readonly property string stateDir: Quickshell.env("HOME") + "/.local/state/newmarchy"
  readonly property string detectScript: String(Qt.resolvedUrl("bin/newmarchy-detect")).replace(/^file:\/\//, "")

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color accent: Color.accent
  readonly property color urgent: bar && bar.urgent.a > 0 ? bar.urgent : Color.accent
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  property string installedVersion: ""
  property var releases: []
  property double fetchedAt: 0
  property bool fetching: false
  property string errorText: ""

  // Always the release you are running.
  readonly property string tag: N.defaultTag(root.releases, root.installedVersion)
  property var notes: null
  property var seen: ({})
  property var expanded: ({})
  property var items: []
  property int cursor: 0
  property bool returnPending: false
  property var detectedSignals: []

  readonly property var counts: N.progress(root.notes, root.seen)
  readonly property int unseen: root.counts.total - root.counts.done

  Commons.Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  onTagChanged: {
    root.notes = root.tag !== "" ? N.notesFor(root.releases, root.tag) : null;
    root.expanded = ({});
    root.refreshItems();
    root.applyDetection();
  }
  onSeenChanged: refreshItems()

  function refreshItems() {
    var list = N.checklist(root.notes);
    for (var i = 0; i < list.length; i++) {
      var feature = F.featureFor(root.notes.tag, list[i].title);
      list[i].tryLabel = feature && feature.try ? feature.tryLabel : "";
      list[i].seen = N.isSeen(root.seen, root.notes.tag, list[i].id);
      list[i].used = list[i].seen && N.wasAutoTicked(root.seen, root.notes.tag, list[i].id);
      list[i].expanded = !!root.expanded[list[i].id];
    }
    root.items = list;
    root.cursor = Math.max(0, Math.min(root.cursor, list.length - 1));
  }

  function saveSeen(next) {
    root.seen = next;
    seenFile.setText(N.serializeSeen(next));
  }

  function setChecked(ids, value) {
    if (root.notes && ids.length > 0)
      root.saveSeen(N.setSeen(root.seen, root.notes.tag, ids, value));
  }

  function toggleSeen(item) {
    if (item)
      root.setChecked([item.id], !item.seen);
  }

  function toggleAll() {
    root.setChecked(root.items.map(function (item) {
      return item.id;
    }), root.unseen > 0);
  }

  function toggleExpanded(item) {
    if (!item)
      return;
    var next = {};
    for (var key in root.expanded)
      next[key] = root.expanded[key];
    next[item.id] = !item.expanded;
    root.expanded = next;
    root.refreshItems();
  }

  function moveCursor(delta) {
    if (root.items.length === 0)
      return;
    root.cursor = Math.max(0, Math.min(root.items.length - 1, root.cursor + delta));
    list.positionViewAtIndex(root.cursor, ListView.Contain);
  }

  // Opens the feature and ticks the item. The panel closes first so a menu
  // or panel the command opens is not hidden behind it.
  function tryItem(item) {
    var feature = item && root.notes ? F.featureFor(root.notes.tag, item.title) : null;
    if (!feature || !feature.try)
      return;
    root.setChecked([item.id], true);
    root.close();
    Quickshell.execDetached(feature.try);
  }

  // Ticks what bin/newmarchy-detect has seen you use, at most once per item
  // (see N.applyDetected), so an untick sticks.
  function applyDetection() {
    if (!root.notes || root.detectedSignals.length === 0)
      return;
    var result = N.applyDetected(root.seen, root.notes.tag, F.detectedIds(root.notes, root.detectedSignals));
    if (result.ticked.length > 0)
      root.saveSeen(result.seen);
  }

  function refreshLocal() {
    if (!versionProcess.running)
      versionProcess.running = true;
    if (!detectProcess.running)
      detectProcess.running = true;
  }

  function openNotes() {
    Quickshell.execDetached(["omarchy-launch-browser", root.notes ? root.notes.url : N.RELEASES_PAGE]);
    root.close();
  }

  // curl is capped twice over: --max-filesize stops a transfer at the limit
  // even without a Content-Length, and head -c holds the same bound on curl
  // builds that only honour a declared one. pipefail keeps curl's status.
  // The URL is a positional argument after --, never spliced into the script.
  function fetchReleases(force) {
    if (root.fetching || (!force && root.fetchedAt > 0 && Date.now() - root.fetchedAt < root.refetchAfterMs))
      return;
    root.fetching = true;
    root.errorText = "";
    fetchProcess.command = ["bash", "-c", "set -o pipefail; curl -fsSL --max-time 15 --connect-timeout 5 " + "--max-filesize " + root.maxResponseBytes + " -H 'Accept: application/vnd.github+json' " + "--user-agent newmarchy/1.0 -- \"$1\" | head -c " + root.maxResponseBytes, "newmarchy", N.RELEASES_URL];
    fetchProcess.running = true;
  }

  function applyReleases(raw) {
    root.fetching = false;
    if (raw.length >= root.maxResponseBytes) {
      root.errorText = strings.t("error.oversized");
      return;
    }
    try {
      root.releases = N.parseReleases(raw);
    } catch (error) {
      root.errorText = raw === "" || String(error.message).indexOf("JSON") >= 0 ? strings.t("error.unreadable") : strings.t("error.api").arg(String(error.message));
      return;
    }
    root.fetchedAt = Date.now();
    // A re-fetch can bring new notes for the same tag.
    root.notes = root.tag !== "" ? N.notesFor(root.releases, root.tag) : null;
    root.refreshItems();
    root.applyDetection();
  }

  function networkError(exitCode) {
    // 28 is curl's timeout; 63, 23 and 141 all mean the response outgrew the cap.
    if (exitCode === 28)
      return strings.t("error.timeout");
    if (exitCode === 63 || exitCode === 23 || exitCode === 141)
      return strings.t("error.oversized");
    return strings.t("error.network");
  }

  onOpenedChanged: {
    if (!root.opened)
      return;
    root.refreshLocal();
    root.fetchReleases(false);
    Qt.callLater(function () {
      keys.forceActiveFocus();
    });
  }

  Component.onCompleted: {
    Quickshell.execDetached(["mkdir", "-p", root.stateDir]);
    root.refreshLocal();
    root.fetchReleases(true);
  }

  IpcHandler {
    target: root.ipcTarget

    function open(): void {
      root.open();
    }
    function close(): void {
      root.close();
    }
    function show(): void {
      root.open();
    }
    function hide(): void {
      root.close();
    }
    function toggle(): void {
      root.toggle();
    }
    // omarchy-shell yamz8.newmarchy unseen  -> "17"
    function unseen(): string {
      return String(root.unseen);
    }
    // omarchy-shell yamz8.newmarchy refresh
    function refresh(): string {
      root.fetchReleases(true);
      return "ok";
    }
  }

  // The installed version and the detector are local and cheap. Re-reading
  // them hourly moves the badge to a new release after an update without a
  // shell restart.
  Timer {
    interval: 60 * 60 * 1000
    running: true
    repeat: true
    onTriggered: root.refreshLocal()
  }

  Process {
    id: versionProcess

    command: ["omarchy-version"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var version = String(text || "").trim();
        if (version !== "")
          root.installedVersion = version;
      }
    }
  }

  // Local and read-only; see bin/newmarchy-detect. Its output is a handful
  // of words, matched against a fixed list.
  Process {
    id: detectProcess

    command: ["bash", root.detectScript]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.detectedSignals = F.parseSignals(String(text || "").slice(0, 4096));
        root.applyDetection();
      }
    }
  }

  Process {
    id: fetchProcess

    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        if (root.fetching && root.errorText === "")
          root.applyReleases(text);
      }
    }
    stderr: StdioCollector {
      waitForEnd: true
    }
    onExited: function (exitCode) {
      if (exitCode !== 0) {
        root.fetching = false;
        root.errorText = root.networkError(exitCode);
      }
    }
  }

  FileView {
    id: seenFile

    path: root.stateDir + "/seen.json"
    watchChanges: true
    atomicWrites: true
    printErrors: false
    onLoaded: root.seen = N.parseSeen(text())
    onLoadFailed: root.seen = ({})
    onFileChanged: reload()
  }

  BarIconButton {
    id: barButton

    anchors.fill: parent
    bar: root.bar
    text: root.newIcon
    labelText: root.unseen > 0 ? Commons.I18n.formatNumber(root.unseen) : ""
    tooltipText: root.unseen > 0 ? strings.tn("bar.tooltipCount", root.unseen).arg(Commons.I18n.formatNumber(root.unseen)) : strings.t("bar.tooltip")

    onPressed: function (mouseButton) {
      if (mouseButton === Qt.RightButton)
        root.openNotes();
      else
        root.toggle();
    }
  }

  KeyboardPanel {
    id: popout

    anchorItem: barButton
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keys
    contentWidth: popout.fittedContentWidth(Style.space(420))
    contentHeight: popout.fittedContentHeight(content.implicitHeight, Style.space(820))

    PanelKeyCatcher {
      id: keys

      anchors.fill: parent
      focus: true
      onCloseRequested: root.close()
      onTabRequested: function (direction) {
        root.switchPanel(direction);
      }
      onMoveRequested: function (dx, dy) {
        if (dy !== 0)
          root.moveCursor(dy);
      }
      onReturnRequested: {
        root.returnPending = true;
        root.toggleExpanded(root.items[root.cursor]);
      }
      onActivateRequested: {
        if (root.returnPending)
          root.returnPending = false;
        else
          root.toggleSeen(root.items[root.cursor]);
      }
      onTextKey: function (text) {
        if (text === "t")
          root.tryItem(root.items[root.cursor]);
        else if (text === "a")
          root.toggleAll();
      }

      Column {
        id: content

        width: parent.width
        spacing: Style.space(6)

        // One compact line: the release and its progress, with two icon
        // actions on the right.
        Item {
          width: parent.width
          implicitHeight: Math.max(headerText.implicitHeight, markAll.implicitHeight)

          Text {
            id: headerText

            anchors.left: parent.left
            anchors.right: actions.left
            anchors.rightMargin: Style.space(8)
            anchors.verticalCenter: parent.verticalCenter
            text: root.newIcon + "  " + (!root.notes ? strings.t("hero.metaLoading") : root.unseen === 0 && root.counts.total > 0 ? strings.t("hero.allSeen").arg(root.notes.tag) : strings.t("hero.meta").arg(root.notes.tag).arg(Commons.I18n.formatNumber(root.counts.done)).arg(Commons.I18n.formatNumber(root.counts.total)))
            textFormat: Text.PlainText
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            elide: Text.ElideRight
          }

          Row {
            id: actions

            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.space(2)

            Button {
              id: markAll

              visible: root.items.length > 0
              iconText: root.unseen > 0 ? "󰸞" : "󰛌"
              tooltipText: root.unseen > 0 ? strings.t("action.markAll") : strings.t("action.clearAll")
              foreground: root.foreground
              fontFamily: root.fontFamily
              iconSize: Style.font.body
              onClicked: root.toggleAll()
            }

            Button {
              iconText: "󰏌"
              tooltipText: root.notes && root.notes.sourceTag !== root.notes.tag ? strings.t("hero.notesFrom").arg(root.notes.sourceTag) : strings.t("hero.notes")
              foreground: root.foreground
              fontFamily: root.fontFamily
              iconSize: Style.font.body
              onClicked: root.openNotes()
            }
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
        }

        ListView {
          id: list

          width: parent.width
          height: Math.min(contentHeight, Style.space(420))
          visible: root.items.length > 0
          clip: true
          model: root.items
          currentIndex: root.cursor
          boundsBehavior: Flickable.StopAtBounds

          delegate: Rectangle {
            id: row

            required property var modelData
            required property int index
            readonly property bool hot: index === root.cursor
            readonly property color ink: hot ? Color.menu.selectedText : root.foreground

            width: ListView.view.width
            height: Math.max(body.implicitHeight, tryButton.implicitHeight) + Style.space(8)
            radius: Style.cornerRadius / 2
            color: hot ? Color.menu.selectedBackground : "transparent"

            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onEntered: root.cursor = row.index
              onClicked: root.toggleExpanded(row.modelData)
            }

            Text {
              id: check

              anchors.left: parent.left
              anchors.leftMargin: Style.spacing.rowPaddingX
              anchors.top: body.top
              width: Style.space(22)
              text: row.modelData.used ? root.usedIcon : row.modelData.seen ? root.checkedIcon : root.uncheckedIcon
              textFormat: Text.PlainText
              color: row.hot ? row.ink : row.modelData.seen ? root.accent : row.modelData.breaking ? root.urgent : row.ink
              opacity: row.modelData.seen ? 0.9 : 0.65
              font.family: root.fontFamily
              font.pixelSize: Style.font.body

              MouseArea {
                anchors.fill: parent
                anchors.margins: -Style.space(6)
                cursorShape: Qt.PointingHandCursor
                onClicked: root.toggleSeen(row.modelData)
              }
            }

            Column {
              id: body

              anchors.left: check.right
              anchors.right: tryButton.visible ? tryButton.left : parent.right
              anchors.rightMargin: Style.spacing.rowPaddingX
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(4)

              Text {
                width: parent.width
                text: String(row.modelData.title || "")
                textFormat: Text.PlainText
                color: row.ink
                opacity: row.modelData.seen ? 0.55 : 1
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: !row.modelData.seen
                wrapMode: Text.WordWrap
                maximumLineCount: row.modelData.expanded ? 6 : 2
                elide: Text.ElideRight
              }

              Text {
                width: parent.width
                visible: !!row.modelData.expanded && text !== ""
                text: String(row.modelData.detail || "")
                textFormat: Text.PlainText
                color: row.ink
                opacity: 0.72
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                wrapMode: Text.WordWrap
                lineHeight: 1.15
              }
            }

            // Shown only on the row under the cursor or the mouse.
            Button {
              id: tryButton

              anchors.right: parent.right
              anchors.rightMargin: Style.spacing.rowPaddingX
              anchors.verticalCenter: parent.verticalCenter
              visible: row.hot && String(row.modelData.tryLabel || "") !== ""
              text: String(row.modelData.tryLabel || "")
              tooltipText: strings.t("action.tryTooltip")
              bordered: true
              foreground: row.ink
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: root.tryItem(row.modelData)
            }
          }
        }

        Column {
          width: parent.width
          visible: root.items.length === 0
          spacing: Style.space(6)

          Text {
            width: parent.width
            text: root.errorText !== "" ? root.errorText : root.fetching || !root.notes ? strings.t("empty.loading") : strings.t("empty.noNotes")
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.6
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
          }

          Button {
            anchors.horizontalCenter: parent.horizontalCenter
            visible: root.errorText !== ""
            text: strings.t("action.refresh")
            bordered: true
            foreground: root.foreground
            fontFamily: root.fontFamily
            fontSize: Style.font.caption
            onClicked: root.fetchReleases(true)
          }
        }
      }
    }
  }
}
