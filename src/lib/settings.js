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
const FALLBACK_DEFAULT_TITLE = "其他";

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  groupsFirst: true,
  defaultGroup: true,
  singleExpanded: true,
  keepLastWhenPinned: true,
  externalNewTabInActiveGroup: true,
  expandHeaderClick: true,
  suppressCollapseNewTab: true,
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
    if (!title || seen.has(title)) continue;
    seen.add(title);
    result.push({ title, color: normalizeColor(entry?.color) });
  }
  return result;
}

/** Merge stored values over defaults, coercing every field to a valid shape. */
export function normalizeSettings(stored) {
  const merged = { ...DEFAULT_SETTINGS, ...(stored && typeof stored === "object" ? stored : {}) };
  return {
    enabled: Boolean(merged.enabled),
    groupsFirst: Boolean(merged.groupsFirst),
    defaultGroup: Boolean(merged.defaultGroup),
    singleExpanded: Boolean(merged.singleExpanded),
    keepLastWhenPinned: Boolean(merged.keepLastWhenPinned),
    externalNewTabInActiveGroup: Boolean(merged.externalNewTabInActiveGroup),
    expandHeaderClick: Boolean(merged.expandHeaderClick),
    suppressCollapseNewTab: Boolean(merged.suppressCollapseNewTab),
    defaultGroupTitle: clampTitle(merged.defaultGroupTitle) || FALLBACK_DEFAULT_TITLE,
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

export { FALLBACK_DEFAULT_TITLE, MAX_TITLE_LENGTH, MAX_PINNED_GROUPS };
