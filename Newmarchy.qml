import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
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
  readonly property string notesIcon: "󰏌"
  readonly property string tryIcon: "󰐊"

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
  readonly property color dim: Qt.darker(foreground, 1.55)
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
  property bool cursorActive: false
  // The checklist split by section, for the section headers; each item keeps
  // its position in the flat list as `index`.
  property var groups: []
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
    var groups = [];
    for (var j = 0; j < list.length; j++) {
      list[j].index = j;
      if (groups.length === 0 || groups[groups.length - 1].title !== list[j].section)
        groups.push({
          title: list[j].section,
          items: []
        });
      groups[groups.length - 1].items.push(list[j]);
    }
    root.items = list;
    root.groups = groups;
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

  // The first arrow key only shows the cursor, as in the built-in panels.
  function moveCursor(delta) {
    if (root.items.length === 0)
      return;
    if (!root.cursorActive) {
      root.cursorActive = true;
      return;
    }
    root.cursor = Math.max(0, Math.min(root.items.length - 1, root.cursor + delta));
    root.scrollCursorIntoView();
  }

  function cursorItem() {
    return root.cursorActive ? root.items[root.cursor] : null;
  }

  function scrollCursorIntoView() {
    Qt.callLater(function () {
      var row = rowFor(root.cursor);
      if (!row || !panelFlick)
        return;
      var margin = Style.space(6);
      var top = row.mapToItem(panelFlick.contentItem, 0, 0).y;
      var bottom = top + row.height;
      var maxY = Math.max(0, panelFlick.contentHeight - panelFlick.height);
      if (top < panelFlick.contentY + margin)
        panelFlick.contentY = Math.max(0, top - margin);
      else if (bottom > panelFlick.contentY + panelFlick.height - margin)
        panelFlick.contentY = Math.min(maxY, bottom + margin - panelFlick.height);
    });
  }

  function rowFor(index) {
    for (var g = 0; g < groupRepeater.count; g++) {
      var group = groupRepeater.itemAt(g);
      for (var r = 0; group && r < group.rows.count; r++) {
        var row = group.rows.itemAt(r);
        if (row && row.item.index === index)
          return row;
      }
    }
    return null;
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
    root.cursorActive = false;
    root.cursor = 0;
    if (panelFlick)
      panelFlick.contentY = 0;
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
    contentWidth: popout.fittedContentWidth(Style.space(380))
    contentHeight: popout.fittedContentHeight(column.implicitHeight, Style.space(560))

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
        root.toggleExpanded(root.cursorItem());
      }
      onActivateRequested: {
        if (root.returnPending)
          root.returnPending = false;
        else
          root.toggleSeen(root.cursorItem());
      }
      onTextKey: function (text) {
        if (text === "t")
          root.tryItem(root.cursorItem());
        else if (text === "a")
          root.toggleAll();
      }

      Flickable {
        id: panelFlick

        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar {
          policy: ScrollBar.AsNeeded
        }

        Column {
          id: column

          width: panelFlick.width
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: root.notes ? strings.t("hero.title").arg(String(root.notes.tag).replace(/^v/, "")) : strings.t("hero.titleLoading")
            meta: !root.notes ? strings.t("hero.metaLoading") : root.unseen === 0 && root.counts.total > 0 ? strings.t("hero.allSeen") : strings.t("hero.meta").arg(Commons.I18n.formatNumber(root.counts.done)).arg(Commons.I18n.formatNumber(root.counts.total))
            foreground: root.foreground
            fontFamily: root.fontFamily

            // A progress ring: how much of this release you've seen.
            iconComponent: Component {
              Canvas {
                id: ring

                readonly property var owner: popout.owner
                readonly property real fraction: owner.counts.total > 0 ? owner.counts.done / owner.counts.total : 0
                readonly property color track: Qt.rgba(owner.foreground.r, owner.foreground.g, owner.foreground.b, 0.18)
                readonly property color fill: Commons.Color.accent

                implicitWidth: Style.font.displayLarge
                implicitHeight: implicitWidth
                onFractionChanged: requestPaint()
                onFillChanged: requestPaint()
                onTrackChanged: requestPaint()

                onPaint: {
                  const ctx = getContext("2d")
                  const line = Math.max(2, Math.round(width / 9))
                  const r = (Math.min(width, height) - line) / 2
                  ctx.reset()
                  ctx.lineWidth = line
                  ctx.lineCap = "round"
                  ctx.strokeStyle = track
                  ctx.beginPath()
                  ctx.arc(width / 2, height / 2, r, 0, 2 * Math.PI)
                  ctx.stroke()
                  if (fraction > 0) {
                    ctx.strokeStyle = fill
                    ctx.beginPath()
                    ctx.arc(width / 2, height / 2, r, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * fraction)
                    ctx.stroke()
                  }
                }

                Text {
                  anchors.centerIn: parent
                  visible: ring.fraction >= 1
                  text: "✓"
                  textFormat: Text.PlainText
                  color: ring.fill
                  font.family: ring.owner.fontFamily
                  font.pixelSize: Style.font.title
                  font.bold: true
                }
              }
            }

            // PanelHero resolves `root` to itself inside this component, so
            // the panel's state is reached through `popout.owner`.
            // One accent-tinted square, like the Agents panel's hero buttons.
            // Mark all / clear stays on the `a` key.
            trailingControl: Component {
              Rectangle {
                id: notesButton

                readonly property var owner: popout.owner
                readonly property color accent: Commons.Color.accent

                implicitWidth: Style.space(34)
                implicitHeight: implicitWidth
                radius: Style.cornerRadius
                color: Qt.rgba(accent.r, accent.g, accent.b, notesMouse.containsMouse ? 0.3 : 0.12)
                border.width: notesMouse.containsMouse ? Math.max(1, Style.hoverBorderWidth) : 0
                border.color: accent

                Text {
                  anchors.centerIn: parent
                  text: notesButton.owner.notesIcon
                  textFormat: Text.PlainText
                  color: notesButton.accent
                  font.family: notesButton.owner.fontFamily
                  font.pixelSize: Style.font.heading
                }

                MouseArea {
                  id: notesMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: notesButton.owner.openNotes()
                }

                PanelToolTip {
                  visible: notesMouse.containsMouse
                  text: notesButton.owner.notes && notesButton.owner.notes.sourceTag !== notesButton.owner.notes.tag ? strings.t("hero.notesFrom").arg(notesButton.owner.notes.sourceTag) : strings.t("hero.notes")
                }
              }
            }
          }

          Text {
            width: parent.width
            visible: root.items.length === 0
            text: root.errorText !== "" ? root.errorText : root.fetching || !root.notes ? strings.t("empty.loading") : strings.t("empty.noNotes")
            textFormat: Text.PlainText
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Repeater {
            id: groupRepeater

            model: root.groups

            Column {
              id: group

              required property var modelData
              property alias rows: rowRepeater

              width: column.width
              spacing: Style.space(10)

              PanelSeparator {
                width: parent.width
                foreground: root.foreground
              }

              PanelSectionHeader {
                text: String(group.modelData.title).toUpperCase()
                foreground: root.foreground
                fontFamily: root.fontFamily
              }

              Column {
                width: parent.width
                spacing: Style.space(4)

                Repeater {
                  id: rowRepeater

                  model: group.modelData.items

                  ItemRow {
                    required property var modelData

                    width: group.width
                    item: modelData
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // One checklist item, built like the rows of the built-in panels: shared
  // cursor chrome, a checkbox like MultiSelect's, a title over a dim caption,
  // and an icon action on the trailing edge.
  component ItemRow: CursorSurface {
    id: itemRow

    property var item: ({})
    readonly property bool canTry: String(item.tryLabel || "") !== ""

    hasCursor: root.cursorActive && root.cursor === item.index
    foreground: root.foreground
    implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: {
        root.cursorActive = true;
        root.cursor = itemRow.item.index;
      }
      onClicked: root.toggleExpanded(itemRow.item)
    }

    RowLayout {
      id: rowContent

      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      spacing: Style.space(8)

      BorderSurface {
        id: checkbox

        Layout.alignment: Qt.AlignTop
        Layout.topMargin: Style.space(2)
        width: Style.space(16)
        height: Style.space(16)
        radius: Math.max(2, Style.cornerRadius / 2)
        color: itemRow.item.seen ? Style.selectedFillFor(root.foreground, root.accent) : "transparent"
        borderSpec: itemRow.item.seen ? Border.controlSpec("selected", root.foreground, root.accent) : Border.controlSpec("normal", root.foreground, root.accent)

        Text {
          anchors.centerIn: parent
          visible: !!itemRow.item.seen
          text: "✓"
          textFormat: Text.PlainText
          color: Style.selectedStateColor(root.foreground, root.accent)
          font.family: root.fontFamily
          font.pixelSize: Math.round(checkbox.height * 0.85)
          font.bold: true
        }

        MouseArea {
          anchors.fill: parent
          anchors.margins: -Style.space(6)
          cursorShape: Qt.PointingHandCursor
          onClicked: root.toggleSeen(itemRow.item)
        }
      }

      ColumnLayout {
        Layout.fillWidth: true
        spacing: Style.space(1)

        Text {
          Layout.fillWidth: true
          text: String(itemRow.item.title || "")
          textFormat: Text.PlainText
          color: itemRow.item.seen ? root.dim : root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
          maximumLineCount: itemRow.item.expanded ? 6 : 2
          elide: Text.ElideRight
        }

        // Collapsed: the first line of the detail, or why it was ticked.
        // Expanded: the whole detail.
        Text {
          Layout.fillWidth: true
          visible: text !== ""
          text: itemRow.item.expanded ? String(itemRow.item.detail || "") : itemRow.item.used ? strings.t("item.used") : String(itemRow.item.detail || "").split("\n")[0].replace(/^\s*•\s*/, "")
          textFormat: Text.PlainText
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          wrapMode: itemRow.item.expanded ? Text.WordWrap : Text.NoWrap
          elide: Text.ElideRight
          lineHeight: itemRow.item.expanded ? 1.15 : 1
        }
      }

      PanelActionButton {
        Layout.alignment: Qt.AlignTop
        visible: itemRow.canTry
        iconText: root.tryIcon
        tooltipText: String(itemRow.item.tryLabel || "")
        foreground: root.foreground
        fontFamily: root.fontFamily
        hasCursor: itemRow.hasCursor
        onClicked: root.tryItem(itemRow.item)
      }
    }
  }
}
