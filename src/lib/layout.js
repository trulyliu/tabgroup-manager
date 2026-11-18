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

/**
 * The remembered id wins only while it still looks like the default group:
 * same title, or still untitled because we created it a moment ago and the
 * title update has not landed yet. A group the user renamed is theirs now.
 */
export function findDefaultGroup(groups, { title, rememberedId } = {}) {
  const list = Array.isArray(groups) ? groups : [];
  if (rememberedId != null) {
    const remembered = list.find((group) => group.id === rememberedId);
    if (remembered && (remembered.title === title || !remembered.title)) return remembered;
  }
  return list.find((group) => group.title === title) ?? null;
}

function groupStats(tabs, groupId) {
  const stats = { first: Infinity, recent: -Infinity, tabIds: [] };
  const own = [];
  for (const tab of tabs ?? []) {
    if (tab?.groupId !== groupId || tab.id == null) continue;
    own.push(tab);
    if (Number.isFinite(tab.index)) stats.first = Math.min(stats.first, tab.index);
    if (Number.isFinite(tab.lastAccessed)) {
      stats.recent = Math.max(stats.recent, tab.lastAccessed);
    }
  }
  own.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  stats.tabIds = own.map((tab) => tab.id);
  return stats;
}

/**
 * A crash restore can leave two groups with the same identity: the restored
 * one and one the extension created before Chrome finished restoring. Pick one
 * canonical group and report every other group's tabs so the caller can merge
 * them in place. `color` narrows the match for pinned groups; omit it for the
 * title-only default-group repair.
 */
export function planGroupMerge({
  tabs = [],
  groups = [],
  title,
  color = null,
  rememberedId = null,
} = {}) {
  if (typeof title !== "string" || title === "") return null;
  const stats = new Map();
  const live = [];
  for (const group of groups ?? []) {
    if (group?.title !== title) continue;
    if (color != null && group.color !== color) continue;
    const entry = groupStats(tabs, group.id);
    stats.set(group.id, entry);
    if (entry.tabIds.length > 0) live.push(group);
  }
  if (live.length < 2) return null;

  const rank = (group) => stats.get(group.id);
  const ranked = live.slice().sort(
    (a, b) =>
      rank(b).tabIds.length - rank(a).tabIds.length ||
      rank(b).recent - rank(a).recent ||
      rank(a).first - rank(b).first ||
      a.id - b.id,
  );
  const canonical = live.find((group) => group.id === rememberedId) ?? ranked[0];
  const sources = live
    .filter((group) => group.id !== canonical.id)
    .map((group) => ({ groupId: group.id, tabIds: rank(group).tabIds }));
  if (sources.length === 0) return null;
  return { canonicalId: canonical.id, sources };
}

export function planDefaultGroupMerge(args = {}) {
  return planGroupMerge(args);
}

/** Group with the freshest tab; survives service-worker restarts. */
export function mostRecentlyUsedGroupId(tabs, groups) {
  const known = new Set((groups ?? []).map((group) => group.id));
  let bestId = null;
  let bestAt = -Infinity;
  for (const tab of tabs ?? []) {
    if (!known.has(tab.groupId)) continue;
    const at = Number.isFinite(tab.lastAccessed) ? tab.lastAccessed : 0;
    if (at > bestAt) {
      bestAt = at;
      bestId = tab.groupId;
    }
  }
  return bestId;
}

/**
 * Group to keep expanded when the active tab is not in a known group.
 * `keepLastWhenPinned` only governs a *pinned* active tab. An ungrouped,
 * unpinned active tab (typically a brand-new Ctrl+T tab that is still being
 * classified) keeps the remembered group; with keepLast off there is no MRU
 * guess, so "pinned tab activated" (which clears the memory) still yields
 * null and routes new tabs to the default group.
 */
function fallbackGroupId({ tabs, groups, activeTab, rememberedGroupId, keepLastWhenPinned }) {
  if (activeTab?.pinned && !keepLastWhenPinned) return null;
  const known = new Set((groups ?? []).map((group) => group.id));
  if (rememberedGroupId != null && known.has(rememberedGroupId)) {
    return rememberedGroupId;
  }
  if (!keepLastWhenPinned) return null;
  return mostRecentlyUsedGroupId(tabs, groups);
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
      activeTab,
      rememberedGroupId,
      keepLastWhenPinned,
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
      if (group.title === pinned.title && group.color === pinned.color) {
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

/** Most recently used tab of a group (index as tie-breaker). */
export function pickGroupTab(tabs, groupId) {
  const candidates = (tabs ?? []).filter((tab) => tab.groupId === groupId);
  if (candidates.length === 0) return null;
  candidates.sort(
    (a, b) =>
      (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0) || (a.index ?? 0) - (b.index ?? 0),
  );
  return candidates[0];
}

/** Where a newly created tab should go, or null to use the default group. */
export function planNewTabTarget({
  tabs,
  groups,
  activeTab,
  rememberedGroupId = null,
  keepLastWhenPinned = true,
}) {
  const known = new Set((groups ?? []).map((group) => group.id));
  if (activeTab && known.has(activeTab.groupId)) return activeTab.groupId;
  return fallbackGroupId({ tabs, groups, activeTab, rememberedGroupId, keepLastWhenPinned });
}
