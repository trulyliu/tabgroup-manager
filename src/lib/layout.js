// Pure layout planning. No chrome.* calls: every decision is unit-testable.

export const TAB_GROUP_ID_NONE = -1;

const NEW_TAB_URLS = new Set([
  "chrome://newtab",
  "chrome://new-tab-page",
  "chrome-search://local-ntp",
  "about:blank",
  "edge://newtab",
]);

export function isUngroupedTab(tab) {
  return tab != null && tab.id != null && !tab.pinned && tab.groupId === TAB_GROUP_ID_NONE;
}

/** True for the URLs Chrome uses for Ctrl+T, "+" and the built-in NTP. */
export function isNewTabUrl(url) {
  if (typeof url !== "string") return false;
  const bare = url
    .split(/[?#]/, 1)[0]
    .trim()
    .toLowerCase()
    .replace(/\/+$/, "");
  return NEW_TAB_URLS.has(bare);
}

export function findDefaultGroup(groups, { title, rememberedId } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  if (rememberedId != null) {
    const remembered = list.find((group) => group.id === rememberedId);
    if (remembered) return remembered;
  }
  return list.find((group) => group.title === title) ?? null;
}

/** Group with the freshest tab; optionally ignore one group. */
export function mostRecentlyUsedGroupId(tabs, groups, excludeGroupId = null) {
  const known = new Set((groups ?? []).map((group) => group.id));
  let bestId = null;
  let bestAt = -Infinity;
  for (const tab of tabs ?? []) {
    if (!known.has(tab.groupId)) continue;
    if (excludeGroupId != null && tab.groupId === excludeGroupId) continue;
    const at = Number.isFinite(tab.lastAccessed) ? tab.lastAccessed : 0;
    if (at > bestAt) {
      bestAt = at;
      bestId = tab.groupId;
    }
  }
  return bestId;
}

function fallbackGroupId({
  tabs,
  groups,
  rememberedGroupId,
  keepLastWhenPinned,
  avoidGroupId,
}) {
  if (!keepLastWhenPinned) return null;
  const known = new Set((groups ?? []).map((group) => group.id));
  if (
    rememberedGroupId != null &&
    rememberedGroupId !== avoidGroupId &&
    known.has(rememberedGroupId)
  ) {
    return rememberedGroupId;
  }
  return mostRecentlyUsedGroupId(tabs, groups, avoidGroupId);
}

/**
 * Exactly one group stays expanded: the active tab's group, else (when the
 * active tab is pinned/ungrouped) the remembered or most recently used group.
 */
export function planCollapse({
  tabs,
  groups,
  activeTab,
  rememberedGroupId = null,
  keepLastWhenPinned = true,
  avoidGroupId = null,
}) {
  const list = groups ?? [];
  const known = new Set(list.map((group) => group.id));
  let target = null;
  if (activeTab && known.has(activeTab.groupId)) {
    target = activeTab.groupId;
  } else {
    target = fallbackGroupId({
      tabs,
      groups: list,
      rememberedGroupId,
      keepLastWhenPinned,
      avoidGroupId,
    });
  }
  return list.map((group) => ({ groupId: group.id, collapsed: group.id !== target }));
}

function groupRanges(tabs, groups) {
  const ranges = new Map();
  (groups ?? []).forEach((group, i) => {
    ranges.set(group.id, { start: Number.MAX_SAFE_INTEGER, order: i });
  });
  for (const tab of tabs ?? []) {
    const range = ranges.get(tab.groupId);
    if (range && tab.index < range.start) range.start = tab.index;
  }
  return ranges;
}

function firstUngroupedIndex(tabs) {
  let first = Number.MAX_SAFE_INTEGER;
  for (const tab of tabs ?? []) {
    if (isUngroupedTab(tab) && tab.index < first) first = tab.index;
  }
  return first;
}

/**
 * Pinned groups first, in configured order, then remaining groups in their
 * current order. Every group is moved to `pinnedCount`, last one first, which
 * yields the desired order and leaves ungrouped tabs after all groups.
 */
export function planGroupOrder({ tabs, groups, pinnedGroups = [] }) {
  const list = groups ?? [];
  if (list.length === 0) return [];

  const ranges = groupRanges(tabs, list);
  const current = list
    .slice()
    .sort((a, b) => {
      const ra = ranges.get(a.id);
      const rb = ranges.get(b.id);
      return ra.start - rb.start || ra.order - rb.order;
    });

  const desired = [];
  const taken = new Set();
  for (const pinned of pinnedGroups ?? []) {
    for (const group of current) {
      if (taken.has(group.id)) continue;
      if (group.title === pinned.title) {
        desired.push(group);
        taken.add(group.id);
      }
    }
  }
  for (const group of current) {
    if (!taken.has(group.id)) desired.push(group);
  }

  const sameOrder =
    desired.length === current.length && desired.every((group, i) => group.id === current[i].id);
  const firstUngrouped = firstUngroupedIndex(tabs);
  const orderIsGroupedFirst =
    firstUngrouped === Number.MAX_SAFE_INTEGER ||
    desired.every((group) => ranges.get(group.id).start < firstUngrouped);

  if (sameOrder && orderIsGroupedFirst) return [];

  const pinnedCount = (tabs ?? []).filter((tab) => tab.pinned).length;
  return desired
    .slice()
    .reverse()
    .map((group) => ({ groupId: group.id, index: pinnedCount }));
}

/**
 * Chrome creates a throwaway blank tab when its active group is collapsed and
 * no expanded/pinned tab can take focus. Identify that tab so it can be closed
 * again: it is brand new, blank, active, and was opened from a tab inside the
 * collapsing group. Its group may already have been rewritten by the new-tab
 * fast path, so group membership is deliberately not part of the match.
 */
export function findCollapseReplacement({
  tabs,
  creations,
  groupId,
  now = Date.now(),
  maxAgeMs = 300,
}) {
  const groupTabIds = new Set(
    (tabs ?? []).filter((tab) => tab.groupId === groupId).map((tab) => tab.id),
  );
  let best = null;
  let bestAt = -Infinity;
  for (const tab of tabs ?? []) {
    const created = creations?.get?.(tab.id);
    if (!created) continue;
    if (now - created.createdAt > maxAgeMs || created.createdAt > now) continue;
    if (!created.blank) continue;
    if (tab.pinned || !tab.active) continue;
    if (created.windowId != null && created.windowId !== tab.windowId) continue;
    if (created.openerTabId == null || !groupTabIds.has(created.openerTabId)) continue;
    if (created.createdAt > bestAt) {
      bestAt = created.createdAt;
      best = tab;
    }
  }
  return best?.id ?? null;
}

/** Where a newly created tab should go, or null to use the default group. */
export function planNewTabTarget({
  tabs,
  groups,
  activeTab,
  rememberedGroupId = null,
  keepLastWhenPinned = true,
  avoidGroupId = null,
}) {
  const known = new Set((groups ?? []).map((group) => group.id));
  if (activeTab && known.has(activeTab.groupId)) return activeTab.groupId;
  return fallbackGroupId({
    tabs,
    groups,
    rememberedGroupId,
    keepLastWhenPinned,
    avoidGroupId,
  });
}
