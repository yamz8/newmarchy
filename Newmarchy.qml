import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "Newmarchy.js" as N

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
  readonly property string uncheckedIcon: "󰄱"
  readonly property string openIcon: "󰅀"
  readonly property string closedIcon: LayoutMirroring.enabled ? "󰅁" : "󰅂"

  // Thirty releases of notes are about 300 kB. 4 MiB is headroom that still
  // stops a hostile or hijacked endpoint from growing the shell without bound.
  readonly property int maxResponseBytes: 4 * 1024 * 1024
  // GitHub allows 60 unauthenticated requests an hour; opening the panel
  // only refetches when the last good fetch is older than this.
  readonly property int refetchAfterMs: 10 * 60 * 1000
  readonly property string stateDir: Quickshell.env("HOME") + "/.local/state/newmarchy"

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color accent: Color.accent
  readonly property color urgent: bar && bar.urgent.a > 0 ? bar.urgent : Color.accent
  readonly property color selectedBackground: Color.menu.selectedBackground
  readonly property color selectedText: Color.menu.selectedText
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  property string installedVersion: ""
  property var releases: []
  property double fetchedAt: 0
  property bool fetching: false
  property string errorText: ""

  // The release shown in the panel, and the one the badge is about.
  property string currentTag: ""
  readonly property string installedTag: N.defaultTag(root.releases, root.installedVersion)
  property var notes: null
  property var installedNotes: null

  property var seen: ({})
  property var collapsed: ({})
  property var expanded: ({})
  property var rows: []
  property int cursor: 0
  property bool returnPending: false

  readonly property int unseen: N.unseenCount(root.installedNotes, root.seen)
  // The header counts what the badge counts: breaking changes and highlights
  // when the release has them, everything otherwise. "Mark all seen" still
  // covers the whole release.
  readonly property var progress: N.keyProgress(root.notes, root.seen)
  readonly property int doneCount: root.progress.done
  readonly property int totalCount: root.progress.total
  readonly property bool allSeen: root.notes !== null && N.countItems(root.notes.sections) > 0 && root.countDone(root.notes) >= N.countItems(root.notes.sections)

  Commons.Translations {
    id: strings
    directory: Qt.resolvedUrl("i18n")
  }

  function countDone(notes) {
    var done = 0;
    for (var i = 0; i < notes.sections.length; i++)
      done += N.sectionProgress(notes.sections[i], root.seen, notes.tag);
    return done;
  }

  function rebuild() {
    root.installedNotes = root.installedTag !== "" ? N.notesFor(root.releases, root.installedTag) : null;
    if (root.currentTag === "" || !N.findRelease(root.releases, root.currentTag))
      root.currentTag = root.installedTag;
    root.notes = root.currentTag === root.installedTag ? root.installedNotes : N.notesFor(root.releases, root.currentTag);
    root.refreshRows();
  }

  function refreshRows() {
    root.rows = N.rows(root.notes, root.seen, root.collapsed, root.expanded);
    if (root.cursor >= root.rows.length)
      root.cursor = Math.max(0, root.rows.length - 1);
  }

  onSeenChanged: refreshRows()
  onInstalledTagChanged: rebuild()

  function showTag(tag) {
    if (tag === "" || tag === root.currentTag)
      return;
    root.currentTag = tag;
    root.collapsed = ({});
    root.expanded = ({});
    root.cursor = 0;
    root.rebuild();
    if (list)
      list.positionViewAtBeginning();
  }

  // Left is older, right is newer, along the list of final releases.
  function stepRelease(direction) {
    var tags = N.finalTags(root.releases);
    var at = tags.indexOf(root.currentTag);
    if (at < 0)
      return;
    var next = at - direction;
    if (next >= 0 && next < tags.length)
      root.showTag(tags[next]);
  }

  function canStep(direction) {
    var tags = N.finalTags(root.releases);
    var next = tags.indexOf(root.currentTag) - direction;
    return tags.indexOf(root.currentTag) >= 0 && next >= 0 && next < tags.length;
  }

  function saveSeen(next) {
    root.seen = next;
    seenFile.setText(N.serializeSeen(next));
  }

  function setChecked(ids, value) {
    if (!root.notes || ids.length === 0)
      return;
    root.saveSeen(N.setSeen(root.seen, root.notes.tag, ids, value));
  }

  function allIds() {
    var ids = [];
    if (!root.notes)
      return ids;
    for (var i = 0; i < root.notes.sections.length; i++)
      for (var j = 0; j < root.notes.sections[i].items.length; j++)
        ids.push(root.notes.sections[i].items[j].id);
    return ids;
  }

  function toggleRow(row) {
    if (!row)
      return;
    if (row.kind === "section") {
      root.toggleSection(row);
      return;
    }
    root.setChecked([row.id], !row.seen);
  }

  function toggleSection(row) {
    var next = {};
    for (var key in root.collapsed)
      next[key] = root.collapsed[key];
    next[row.title] = !row.collapsed;
    root.collapsed = next;
    root.refreshRows();
  }

  function toggleExpanded(row) {
    if (!row)
      return;
    if (row.kind === "section") {
      root.toggleSection(row);
      return;
    }
    var next = {};
    for (var key in root.expanded)
      next[key] = root.expanded[key];
    next[row.id] = !row.expanded;
    root.expanded = next;
    root.refreshRows();
  }

  function moveCursor(delta) {
    if (root.rows.length === 0)
      return;
    root.cursor = Math.max(0, Math.min(root.rows.length - 1, root.cursor + delta));
    list.positionViewAtIndex(root.cursor, ListView.Contain);
  }

  function openNotes() {
    var url = root.notes ? root.notes.url : N.RELEASES_PAGE;
    Quickshell.execDetached(["omarchy-launch-browser", url]);
    root.close();
  }

  // curl is capped twice over: --max-filesize stops a transfer at the limit
  // even without a Content-Length, and head -c holds the same bound on curl
  // builds that only honour a declared one. pipefail keeps curl's status.
  // The URL is a positional argument after --, never spliced into the script.
  function fetchReleases(force) {
    if (root.fetching)
      return;
    if (!force && root.fetchedAt > 0 && Date.now() - root.fetchedAt < root.refetchAfterMs)
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
    var parsed;
    try {
      parsed = N.parseReleases(raw);
    } catch (error) {
      root.errorText = String(error && error.message || "").indexOf("JSON") >= 0 || raw === "" ? strings.t("error.unreadable") : strings.t("error.api").arg(String(error.message));
      return;
    }
    root.releases = parsed;
    root.fetchedAt = Date.now();
    root.errorText = "";
    root.rebuild();
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
    versionProcess.running = true;
    root.fetchReleases(false);
    // Opening from the bar starts on the release you are running.
    if (root.installedTag !== "" && root.currentTag !== root.installedTag)
      root.showTag(root.installedTag);
    Qt.callLater(function () {
      keys.forceActiveFocus();
    });
  }

  Component.onCompleted: {
    Quickshell.execDetached(["mkdir", "-p", root.stateDir]);
    versionProcess.running = true;
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
    // omarchy-shell yamz8.newmarchy unseen  -> "4"
    function unseen(): string {
      return String(root.unseen);
    }
    // omarchy-shell yamz8.newmarchy refresh
    function refresh(): string {
      root.fetchReleases(true);
      return "ok";
    }
  }

  // The installed version is local (pacman), so it is cheap to re-read. An
  // update while the shell keeps running is picked up within the hour, and
  // the badge moves to the new release's list.
  Timer {
    interval: 60 * 60 * 1000
    running: true
    repeat: true
    onTriggered: versionProcess.running = true
  }

  Process {
    id: versionProcess

    command: ["omarchy-version"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var version = String(text || "").trim();
        if (version !== "" && version !== root.installedVersion)
          root.installedVersion = version;
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
    contentWidth: popout.fittedContentWidth(Style.space(640))
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
        else if (dx !== 0)
          root.stepRelease(dx);
      }
      onReturnRequested: {
        root.returnPending = true;
        root.toggleExpanded(root.rows[root.cursor]);
      }
      onActivateRequested: {
        if (root.returnPending) {
          root.returnPending = false;
          return;
        }
        root.toggleRow(root.rows[root.cursor]);
      }
      onTextKey: function (text) {
        if (text === "r")
          root.fetchReleases(true);
      }

      Column {
        id: content

        width: parent.width
        spacing: Style.space(12)

        PanelHero {
          width: parent.width
          title: "newmarchy"
          meta: !root.notes ? strings.t("hero.metaLoading") : root.notes.sourceTag !== root.notes.tag ? strings.t("hero.metaBorrowed").arg(root.notes.tag).arg(root.notes.sourceTag) : strings.t("hero.meta").arg(root.notes.tag)
          foreground: root.foreground
          fontFamily: root.fontFamily

          iconComponent: Component {
            Text {
              text: root.newIcon
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }

          trailingControl: Component {
            Button {
              text: strings.t("hero.notes")
              bordered: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: root.openNotes()
            }
          }
        }

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
        }

        // Release switcher and progress.
        Item {
          width: parent.width
          visible: root.notes !== null
          implicitHeight: visible ? Math.max(navRow.implicitHeight, actions.implicitHeight) : 0

          Row {
            id: navRow

            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.spacing.sm

            Button {
              text: LayoutMirroring.enabled ? "›" : "‹"
              tooltipText: strings.t("nav.older")
              bordered: true
              enabled: root.canStep(-1)
              opacity: enabled ? 1 : 0.35
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: root.stepRelease(-1)
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.notes ? root.notes.tag + (root.notes.published !== "" ? "  ·  " + new Date(root.notes.published + "T00:00:00").toLocaleDateString(Qt.locale(Commons.I18n.formatLocale), Locale.ShortFormat) : "") : ""
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              font.bold: true
            }

            Button {
              text: LayoutMirroring.enabled ? "‹" : "›"
              tooltipText: strings.t("nav.newer")
              bordered: true
              enabled: root.canStep(1)
              opacity: enabled ? 1 : 0.35
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: root.stepRelease(1)
            }

            Button {
              visible: root.currentTag !== root.installedTag && root.installedTag !== ""
              text: strings.t("nav.backToInstalled")
              bordered: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: root.showTag(root.installedTag)
            }
          }

          Row {
            id: actions

            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            spacing: Style.spacing.sm

            Text {
              anchors.verticalCenter: parent.verticalCenter
              text: root.doneCount >= root.totalCount && root.totalCount > 0 ? strings.t("progress.allSeen").arg(Commons.I18n.formatNumber(root.totalCount)) : strings.t("progress.seen").arg(Commons.I18n.formatNumber(root.doneCount)).arg(Commons.I18n.formatNumber(root.totalCount))
              textFormat: Text.PlainText
              color: root.foreground
              opacity: 0.6
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Button {
              text: root.allSeen ? strings.t("action.clearAll") : strings.t("action.markAll")
              bordered: true
              foreground: root.foreground
              fontFamily: root.fontFamily
              fontSize: Style.font.caption
              onClicked: root.setChecked(root.allIds(), !root.allSeen)
            }
          }
        }

        ListView {
          id: list

          width: parent.width
          height: Math.min(contentHeight, Style.space(600))
          visible: root.rows.length > 0
          clip: true
          model: root.rows
          currentIndex: root.cursor
          boundsBehavior: Flickable.StopAtBounds
          spacing: Style.space(2)

          delegate: Rectangle {
            id: rowItem

            required property var modelData
            required property int index
            readonly property bool isSection: modelData.kind === "section"
            readonly property bool hot: index === root.cursor
            readonly property color ink: hot ? root.selectedText : root.foreground

            width: ListView.view.width
            height: (isSection ? sectionBody.implicitHeight : itemBody.implicitHeight) + Style.space(isSection ? 14 : 16)
            radius: Style.cornerRadius / 2
            color: hot ? root.selectedBackground : "transparent"

            // Section header: chevron, name, progress, and a section-wide check.
            Item {
              id: sectionBody

              visible: rowItem.isSection
              anchors {
                left: parent.left
                right: parent.right
                verticalCenter: parent.verticalCenter
                leftMargin: Style.spacing.rowPaddingX
                rightMargin: Style.spacing.rowPaddingX
              }
              implicitHeight: Math.max(sectionTitle.implicitHeight, sectionCheck.implicitHeight)

              Text {
                id: chevron

                anchors.left: parent.left
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(18)
                text: rowItem.modelData.collapsed ? root.closedIcon : root.openIcon
                textFormat: Text.PlainText
                color: rowItem.ink
                opacity: 0.7
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
              }

              Text {
                id: sectionTitle

                anchors.left: chevron.right
                anchors.right: sectionCount.left
                anchors.rightMargin: Style.space(12)
                anchors.verticalCenter: parent.verticalCenter
                text: String(rowItem.modelData.title).toUpperCase()
                textFormat: Text.PlainText
                color: rowItem.modelData.breaking && !rowItem.hot ? root.urgent : rowItem.ink
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: 1
                elide: Text.ElideRight
              }

              Text {
                id: sectionCount

                anchors.right: sectionCheck.left
                anchors.rightMargin: Style.space(10)
                anchors.verticalCenter: parent.verticalCenter
                text: rowItem.isSection ? Commons.I18n.formatNumber(rowItem.modelData.done) + " / " + Commons.I18n.formatNumber(rowItem.modelData.total) : ""
                textFormat: Text.PlainText
                color: rowItem.ink
                opacity: 0.55
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
              }

              Text {
                id: sectionCheck

                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                text: rowItem.isSection && rowItem.modelData.done >= rowItem.modelData.total ? root.checkedIcon : root.uncheckedIcon
                textFormat: Text.PlainText
                color: rowItem.ink
                opacity: rowItem.isSection && rowItem.modelData.done >= rowItem.modelData.total ? 0.9 : 0.5
                font.family: root.fontFamily
                font.pixelSize: Style.font.subtitle

                MouseArea {
                  anchors.fill: parent
                  anchors.margins: -Style.space(6)
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    root.cursor = rowItem.index;
                    root.setChecked(rowItem.modelData.ids, rowItem.modelData.done < rowItem.modelData.total);
                  }
                }
              }
            }

            // Item: checkbox, title, and the detail when opened.
            Item {
              id: itemBody

              visible: !rowItem.isSection
              anchors {
                left: parent.left
                right: parent.right
                verticalCenter: parent.verticalCenter
                leftMargin: Style.spacing.rowPaddingX
                rightMargin: Style.spacing.rowPaddingX
              }
              implicitHeight: visible ? itemText.implicitHeight : 0

              Text {
                id: itemCheck

                anchors.left: parent.left
                anchors.top: parent.top
                width: Style.space(26)
                text: rowItem.modelData.seen ? root.checkedIcon : root.uncheckedIcon
                textFormat: Text.PlainText
                color: rowItem.modelData.seen ? (rowItem.hot ? rowItem.ink : root.accent) : rowItem.ink
                opacity: rowItem.modelData.seen ? 0.9 : 0.6
                font.family: root.fontFamily
                font.pixelSize: Style.font.subtitle

                MouseArea {
                  anchors.fill: parent
                  anchors.margins: -Style.space(6)
                  cursorShape: Qt.PointingHandCursor
                  onClicked: {
                    root.cursor = rowItem.index;
                    root.setChecked([rowItem.modelData.id], !rowItem.modelData.seen);
                  }
                }
              }

              Column {
                id: itemText

                anchors.left: itemCheck.right
                anchors.right: parent.right
                anchors.top: parent.top
                spacing: Style.space(4)

                Text {
                  width: parent.width
                  text: String(rowItem.modelData.title || "")
                  textFormat: Text.PlainText
                  color: rowItem.ink
                  opacity: rowItem.modelData.seen ? 0.55 : 1
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.body
                  font.bold: !rowItem.modelData.seen
                  wrapMode: Text.WordWrap
                  maximumLineCount: rowItem.modelData.expanded ? 6 : 2
                  elide: Text.ElideRight
                }

                Text {
                  width: parent.width
                  visible: !!rowItem.modelData.expanded && String(rowItem.modelData.detail || "") !== ""
                  text: String(rowItem.modelData.detail || "")
                  textFormat: Text.PlainText
                  color: rowItem.ink
                  opacity: 0.72
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  wrapMode: Text.WordWrap
                  lineHeight: 1.15
                }
              }
            }

            MouseArea {
              anchors.fill: parent
              z: -1
              hoverEnabled: true
              cursorShape: rowItem.isSection || String(rowItem.modelData.detail || "") !== "" ? Qt.PointingHandCursor : Qt.ArrowCursor
              onEntered: root.cursor = rowItem.index
              onClicked: {
                root.cursor = rowItem.index;
                root.toggleExpanded(rowItem.modelData);
              }
            }
          }
        }

        BorderSurface {
          width: parent.width
          visible: root.rows.length === 0
          implicitHeight: visible ? Style.space(96) : 0
          color: Style.controlFill(false, false, root.foreground, root.accent)
          borderSpec: Border.controlSpec("normal", root.foreground, root.accent)
          radius: Style.cornerRadius

          Column {
            width: parent.width - Style.space(40)
            anchors.centerIn: parent
            spacing: Style.space(5)

            Text {
              width: parent.width
              text: root.errorText !== "" ? strings.t("empty.errorTitle") : root.fetching || !root.notes ? strings.t("empty.loading") : strings.t("empty.noNotes")
              textFormat: Text.PlainText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.body
              font.bold: true
              horizontalAlignment: Text.AlignHCenter
            }

            Text {
              width: parent.width
              visible: text !== ""
              text: root.errorText !== "" ? root.errorText : root.notes && !root.fetching ? strings.t("empty.noNotesDetail") : ""
              textFormat: Text.PlainText
              color: root.foreground
              opacity: 0.5
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
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

        PanelSeparator {
          width: parent.width
          foreground: root.foreground
        }

        Item {
          width: parent.width
          implicitHeight: Math.max(sourceNote.implicitHeight, keyHints.implicitHeight)

          Text {
            id: sourceNote

            anchors.left: parent.left
            anchors.verticalCenter: parent.verticalCenter
            text: strings.t("footer.source")
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.42
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }

          Text {
            id: keyHints

            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: strings.t("footer.keys")
            textFormat: Text.PlainText
            color: root.foreground
            opacity: 0.32
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }
}
