# Tab Group Manager

[English](README.en.md) | [中文](README.md)

<img src="icons/icon128.png" alt="Extension icon" width="96" align="right" />

A lightweight Chrome MV3 extension that turns your tab bar into a tidy, structured workspace: **groups first, only one expanded group, and new tabs in the active group**.

- **Groups first**: Grouped tabs sit before ungrouped tabs; pinned groups stay at the very front in your custom order.
- **Default group**: Loose ungrouped tabs automatically join a synthetic default group (default grey `Other` / `其他`).
- **One expanded group**: Only one group stays expanded per window (the active tab's group). Activating a pinned tab keeps the last active group expanded.
- **New tab targeting**: `Ctrl+T` / `+` / address-bar new tabs join the currently expanded group; external app links can do the same.
- **Pinned group protection**: Pinned groups are never lost. When the last tab in a pinned group closes, it is automatically restored with an inactive blank page.
- **Session restore friendly**: Fully respects Chrome's "Continue where you left off" session restore before applying grouping rules.

Zero build steps, zero third-party runtime dependencies, zero analytics, zero network requests, and zero host permissions.

## Installation

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this repository folder.
3. (Optional) Pin the extension to your toolbar to access the popup and options page.

Requires **Chrome 124** or higher.

## How It Works

### Groups First

Pinned groups are placed first according to your configured order, followed by other groups in their existing relative order, with ungrouped tabs at the very end. Pinned tabs always remain on the far left of the tab strip (as enforced by Chrome).

### Default Group

Ungrouped tabs in each window are collected into a standard Chrome group (default title `Other` in English or `其他` in Chinese, color grey). Tabs unpinned by the user will also be swept into the default group (when `defaultGroup` is enabled).

If session restore leaves multiple groups with the default title, normalization automatically detects duplicates and merges their tabs into a single canonical group. Empty groups cleaned up by this merge will not trigger pinned group resurrection.

### Only One Expanded Group

Activating any tab inside a group expands that group and collapses all others. When `expandHeaderClick` is enabled, clicking a collapsed group's header switches to its most recently used tab, expanding it and collapsing the rest.

Clicking an **already expanded** group header triggers the configured `expandedGroupHeaderClick` action (not affected by pinned tabs; when `singleExpanded` is off, collapsing an inactive group is a normal collapse while collapsing the active group triggers the action):

- `newtab`: Opens a new tab within the clicked group and keeps it expanded. Reuses Chrome's placeholder tab if one was created during the click.
- `collapse`: Collapses the clicked group, expands the default group, and focuses its most recently used tab (clicking the default group itself keeps it expanded).
- `noaction`: Keeps the clicked group expanded and refocuses its most recently used tab.

When activating a pinned tab:
- `keepLastWhenPinned: true` (default): The previously expanded group stays expanded.
- `keepLastWhenPinned: false`: All groups collapse.

### New Tab Placement

| Source | Behavior |
| --- | --- |
| `Ctrl+T`, `+`, Address bar new tab | Joins the currently expanded group (at the end of the group) |
| In-page links (`Ctrl+Click`, middle click, `target="_blank"`) | Keeps Chrome's default behavior (joins opener's group) |
| Chrome native "Open in new tab group" / "Open new tab to the right" | Keeps Chrome's default behavior |
| External programs (terminal, mail client, etc.) | If `externalNewTabInActiveGroup` is enabled, joins the expanded group; otherwise joins the default group |
| Extension pages (settings, etc.) | Bypasses the new-tab fast path, then swept into default group |

### Pinned Groups

Configure pinned groups in the options page. Pinned group identity is defined by **title + color** (case-sensitive exact match):

- The list order in options is the tab strip order.
- Closing the last tab or deleting the group automatically recreates a group with the same title and color containing one inactive `chrome://newtab/` page. Real closed tabs are not reopened.
- Moving a pinned group to another window or closing the entire window does not trigger empty placeholder recreation.
- Renaming or changing the color of a group removes its pinned status until re-pinned or updated in options.

### Startup & Session Restore

The extension does not record, manage, or store tab URLs. When Chrome restores tabs upon launch, the extension enters a quiet gate until tabs finish loading, then normalizes order and collapsed states smoothly.

## Settings

| Key | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Master switch. When disabled, all layout and protection actions stop |
| `groupsFirst` | `true` | Grouped tabs sit before ungrouped tabs |
| `defaultGroup` | `true` | Ungrouped tabs automatically join the default group |
| `singleExpanded` | `true` | Only one group stays expanded at a time |
| `keepLastWhenPinned` | `true` | Keep the last active group expanded when switching to a pinned tab |
| `externalNewTabInActiveGroup` | `true` | Tabs opened by external applications join the currently expanded group |
| `expandHeaderClick` | `true` | Clicking a collapsed group header switches to its last used tab |
| `expandedGroupHeaderClick` | `collapse` | Action when clicking an expanded group header (`newtab`, `collapse`, `noaction`) |
| `defaultGroupTitle` | `Other` / `其他` | Default group title (localized on first launch, max 30 chars) |
| `defaultGroupColor` | `grey` | Default group color (one of Chrome's 9 group colors) |
| `pinnedGroups` | `[]` | Ordered list of `{title, color}` pairs defining pinned groups |

Settings are synchronized across devices using `chrome.storage.sync`.

### Keyboard Shortcut

- `Alt+W`: Switch to the default group in the current window and focus its most recently used tab.
- Can be customized anytime in `chrome://extensions/shortcuts`.

## Privacy & Security

- **No telemetry, no tracking, no remote server calls, no external analytics.**
- **No host permissions requested.**
- `tabs` permission is used strictly in local memory to classify tab URLs (e.g. distinguishing `chrome://newtab` from external URLs). URLs are never stored, logged, or transmitted anywhere.
- Transient tab snapshots in `chrome.storage.session` contain only IDs, titles, colors, and layout states—never URLs.

## Known Limitations

- Chrome does not permit extensions to pin tab group headers directly to the tab strip or position groups to the left of pinned tabs.
- Chrome does not have an API to veto group deletion; pinned groups are preserved via automatic resurrection with a placeholder blank tab.
- Modifying shortcuts requires visiting Chrome's shortcut configuration page (`chrome://extensions/shortcuts`).

## Development

Run unit and integration tests:

```bash
npm test
```

Tests use Node's built-in test runner (`node:test`) with zero third-party dependencies.

### Directory Structure

```
_locales/              Localization files (en, zh_CN, zh_TW)
manifest.json          MV3 extension manifest
icons/                 Extension icons (SVG source + 16/32/48/128 PNG)
src/background.js      Service worker: events, normalization, pinned protection
src/i18n.js            UI localization helper
src/lib/layout.js      Pure functions: group ordering, collapse planning, new tab targets
src/lib/pinned.js      Pure functions: pinned group identification and restore decisions
src/lib/settings.js    Settings defaults, validation, and storage
src/options.*          Options page UI & logic
src/popup.*            Toolbar popup UI & logic
test/*.test.js         Pure logic unit tests & fake-chrome integration tests
test/fake-chrome.js    Shared fake chrome API for testing
```

## License

MIT License.
