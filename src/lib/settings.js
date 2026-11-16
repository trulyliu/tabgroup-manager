// Settings: single key in chrome.storage.sync, validated on read and write.

export const GROUP_COLORS = Object.freeze([
  "grey",
  "blue",
  "red",
  "yellow",
  "green",
  "pink",
  "purple",
  "cyan",
  "orange",
]);

const COLOR_SET = new Set(GROUP_COLORS);
const MAX_TITLE_LENGTH = 30;
const MAX_PINNED_GROUPS = 50;
// The default group title follows the browser UI language (_locales/*/
// messages.json "defaultGroupTitle"); outside Chrome, or if the message is
// missing, it is the default_locale (en) value.
const FALLBACK_DEFAULT_TITLE = "Other";
/** The only default title before the UI was localized (<= 0.3.x). */
const LEGACY_DEFAULT_TITLE = "\u5176\u4ed6";

export const HEADER_CLICK_ACTIONS = Object.freeze(["newtab", "collapse", "noaction"]);

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  groupsFirst: true,
  defaultGroup: true,
  singleExpanded: true,
  keepLastWhenPinned: true,
  externalNewTabInActiveGroup: true,
  expandHeaderClick: true,
  expandedGroupHeaderClick: "collapse",
  defaultGroupTitle: FALLBACK_DEFAULT_TITLE,
  defaultGroupColor: "grey",
  pinnedGroups: [],
});

function clampTitle(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.slice(0, MAX_TITLE_LENGTH);
}

function normalizeColor(value) {
  return COLOR_SET.has(value) ? value : "grey";
}

function sanitizePinnedGroups(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const entry of value) {
    if (result.length >= MAX_PINNED_GROUPS) break;
    const title = clampTitle(entry?.title);
    const color = normalizeColor(entry?.color);
    if (!title) continue;
    const key = `${title}\u0000${color}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ title, color });
  }
  return result;
}

/** Merge stored values over defaults, coercing every field to a valid shape. */
export function normalizeSettings(stored) {
  const raw = stored && typeof stored === "object" ? stored : {};
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  return {
    enabled: Boolean(merged.enabled),
    groupsFirst: Boolean(merged.groupsFirst),
    defaultGroup: Boolean(merged.defaultGroup),
    singleExpanded: Boolean(merged.singleExpanded),
    keepLastWhenPinned: Boolean(merged.keepLastWhenPinned),
    externalNewTabInActiveGroup: Boolean(merged.externalNewTabInActiveGroup),
    expandHeaderClick: Boolean(merged.expandHeaderClick),
    expandedGroupHeaderClick: HEADER_CLICK_ACTIONS.includes(raw.expandedGroupHeaderClick)
      ? raw.expandedGroupHeaderClick
      : raw.collapseExpandedOnHeaderClick === false
        ? "noaction"
        : "collapse",
    defaultGroupTitle: clampTitle(raw.defaultGroupTitle) || localizedDefaultTitle(),
    defaultGroupColor: normalizeColor(merged.defaultGroupColor),
    pinnedGroups: sanitizePinnedGroups(merged.pinnedGroups),
  };
}

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return normalizeSettings(settings);
}

/** Read-modify-write; returns both sides so callers can react to renames. */
export async function saveSettings(patch) {
  const { settings: stored } = await chrome.storage.sync.get("settings");
  const oldSettings = normalizeSettings(stored);
  const newSettings = normalizeSettings({ ...oldSettings, ...(patch || {}) });
  await chrome.storage.sync.set({ settings: newSettings });
  return { oldSettings, newSettings };
}

/** Default group title for the current browser UI language. */
export function localizedDefaultTitle() {
  try {
    const title = clampTitle(globalThis.chrome?.i18n?.getMessage?.("defaultGroupTitle"));
    if (title) return title;
  } catch {
    // Not running inside an extension context.
  }
  return FALLBACK_DEFAULT_TITLE;
}

export { FALLBACK_DEFAULT_TITLE, LEGACY_DEFAULT_TITLE, MAX_TITLE_LENGTH, MAX_PINNED_GROUPS };
