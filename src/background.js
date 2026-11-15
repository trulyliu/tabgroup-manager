// Tab Group Manager service worker.
//
// Invariants, re-applied to every normal window after every relevant event:
//   1. group chips sit before ungrouped tabs (pinned groups first, in order);
//   2. every ungrouped tab joins the synthetic default group;
//   3. exactly one group is expanded (the active tab's, or the last active one);
//   4. new tabs open in the expanded group, except Chrome-owned link tabs;
//   5. pinned groups are never left empty.
//
// URLs are read only to classify brand-new tabs and are never stored or logged.

import {
  TAB_GROUP_ID_NONE,
  findCollapseReplacement,
  findDefaultGroup,
  isNewTabUrl,
  isUngroupedTab,
  pickGroupTab,
  planCollapse,
  planGroupOrder,
  planNewTabTarget,
} from "./lib/layout.js";
import { choosePinnedRestore, isPinnedTitle } from "./lib/pinned.js";
import { loadSettings, normalizeSettings, saveSettings } from "./lib/settings.js";

const QUIET_MS = 1500;
const MAX_BOOT_MS = 30000;
const WARMUP_MS = 3000;
const SCHEDULE_MS = 60;
const SNAPSHOT_DEBOUNCE_MS = 100;
const CREATED_WAIT_MS = 150;
const CREATED_BURST_MS = 300;
const CREATED_BURST_SUPPRESS_MS = 2000;
const RESTORE_SETTLE_MS = 500;
const MOVE_EVENT_SUPPRESS_MS = 500;
const PENDING_PINNED_TTL_MS = 5000;
const IGNORE_CREATED_TTL_MS = 10000;
const SELF_UPDATE_TTL_MS = 2000;
const CLOSING_WINDOW_TTL_MS = 5000;
const RETRY_LIMIT = 3;
const DRAG_ERROR = /dragging|not editable/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const errorText = (err) => String(err?.message ?? err ?? "");
const sortTabs = (tabs) =>
  tabs.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

let ready = false;
let bootPromise = null;
let warmupUntil = 0;
let currentSettings = normalizeSettings(null);

const lastActiveGroupByWindow = new Map();
const defaultGroupByWindow = new Map();
const windowChains = new Map();
const scheduleTimers = new Map();
const retryCounts = new Map();
const closingWindows = new Map();

const ignoreCreatedTabs = new Map();
const pendingCreatedChecks = new Map();
const recentCreations = new Map();
const burstSuppressUntil = new Map();

const pendingPinnedTabs = new Map();
const pendingCreatedTabs = new Map();
const recentTabCreations = new Map();
const restoreLocks = new Set();
const recentGroupCreations = new Map();
const collapsedStates = new Map();
const headerActivationUntil = new Map();

const pinnedSnapshots = new Map();
let snapshotTimer = null;
let snapshotWrites = Promise.resolve();

let lastTabMoveAt = 0;

// ---------------------------------------------------------------- utilities

function markIgnoredCreated(tabId) {
  if (tabId == null) return;
  ignoreCreatedTabs.set(tabId, Date.now() + IGNORE_CREATED_TTL_MS);
}

function isIgnoredCreated(tabId) {
  const at = ignoreCreatedTabs.get(tabId);
  if (at == null) return false;
  ignoreCreatedTabs.delete(tabId);
  return true;
}

/** Tabs recently removed from a pinned group; excluded from default grouping. */
function claimPendingPinned(tabId, originGroupId = null) {
  pendingPinnedTabs.set(tabId, {
    expiresAt: Date.now() + PENDING_PINNED_TTL_MS,
    origin: originGroupId,
  });
}

function pendingPinnedInfo(tabId) {
  const entry = pendingPinnedTabs.get(tabId);
  if (entry == null) return null;
  if (entry.expiresAt < Date.now()) {
    pendingPinnedTabs.delete(tabId);
    return null;
  }
  return entry;
}

function isPendingPinned(tabId) {
  return pendingPinnedInfo(tabId) != null;
}

function releasePendingPinned(tabId) {
  pendingPinnedTabs.delete(tabId);
}

/** New tabs awaiting classification must not be swept into the default group. */
function claimPendingCreated(tabId) {
  pendingCreatedTabs.set(tabId, Date.now() + PENDING_PINNED_TTL_MS);
}

function isPendingCreated(tabId) {
  const at = pendingCreatedTabs.get(tabId);
  if (at == null) return false;
  if (at < Date.now()) {
    pendingCreatedTabs.delete(tabId);
    return false;
  }
  return true;
}

function releasePendingCreated(tabId) {
  pendingCreatedTabs.delete(tabId);
}

function isClosingWindow(windowId) {
  const at = closingWindows.get(windowId);
  if (at == null) return false;
  if (at < Date.now()) {
    closingWindows.delete(windowId);
    return false;
  }
  return true;
}

function noteRecentCreation(windowId) {
  const now = Date.now();
  const list = (recentCreations.get(windowId) ?? []).filter((at) => now - at < CREATED_BURST_MS);
  list.push(now);
  recentCreations.set(windowId, list);
  return list.length;
}

function recentCreationCount(windowId) {
  const now = Date.now();
  const list = (recentCreations.get(windowId) ?? []).filter((at) => now - at < CREATED_BURST_MS);
  if (list.length) recentCreations.set(windowId, list);
  else recentCreations.delete(windowId);
  return list.length;
}

function rememberCollapsed(group) {
  collapsedStates.set(group.id, Boolean(group.collapsed));
}

async function updateCollapsed(groupId, collapsed) {
  collapsedStates.set(groupId, collapsed);
  await chrome.tabGroups.update(groupId, { collapsed });
}

async function updateGroupPresentation(groupId, properties) {
  if (typeof properties.collapsed === "boolean") {
    collapsedStates.set(groupId, properties.collapsed);
  }
  await chrome.tabGroups.update(groupId, properties);
}

function isNormalWindowType(win) {
  return win != null && win.type === "normal";
}

// ------------------------------------------------------------- normalization

function schedule(windowId) {
  if (!ready || windowId == null) return;
  clearTimeout(scheduleTimers.get(windowId));
  scheduleTimers.set(
    windowId,
    setTimeout(() => {
      scheduleTimers.delete(windowId);
      enqueue(windowId);
    }, SCHEDULE_MS),
  );
}

function requestRetry(windowId) {
  if (!ready || windowId == null) return;
  const attempts = retryCounts.get(windowId) ?? 0;
  if (attempts >= RETRY_LIMIT) return;
  retryCounts.set(windowId, attempts + 1);
  setTimeout(() => schedule(windowId), 200);
}

function enqueue(windowId) {
  if (!ready || windowId == null) return Promise.resolve();
  const previous = windowChains.get(windowId) ?? Promise.resolve();
  const next = previous
    .then(() => normalizeWindow(windowId))
    .catch((err) => {
      console.warn("[gtm] normalize failed", windowId, errorText(err));
    });
  windowChains.set(windowId, next);
  void next.then(() => {
    if (windowChains.get(windowId) === next) windowChains.delete(windowId);
  });
  return next;
}

async function normalizeAllWindows() {
  let windows = [];
  try {
    windows = await chrome.windows.getAll();
  } catch (err) {
    console.warn("[gtm] windows.getAll failed", errorText(err));
    return;
  }
  await Promise.all(
    windows.filter(isNormalWindowType).map((win) => enqueue(win.id)),
  );
}

async function normalizeWindow(windowId) {
  if (!ready) return;
  const settings = currentSettings;
  if (!settings.enabled) return;
  let win = null;
  try {
    win = await chrome.windows.get(windowId);
  } catch {
    return;
  }
  if (!isNormalWindowType(win)) return;

  let retry = false;
  if (settings.defaultGroup) {
    retry = (await ensureDefaultGroup(windowId, settings)) || retry;
  }
  if (settings.groupsFirst || settings.pinnedGroups.length > 0) {
    retry = (await applyGroupOrder(windowId, settings)) || retry;
  }
  if (settings.singleExpanded) {
    retry = (await applySingleExpanded(windowId, settings)) || retry;
  }

  if (retry) requestRetry(windowId);
  else retryCounts.delete(windowId);
}

async function addTabsToGroup(tabIds, groupId) {
  if (tabIds.length === 0) return false;
  try {
    await chrome.tabs.group({ tabIds, groupId });
    return false;
  } catch (err) {
    if (DRAG_ERROR.test(errorText(err))) return true;
  }
  let retry = false;
  let added = 0;
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
      added += 1;
    } catch (err) {
      if (DRAG_ERROR.test(errorText(err))) retry = true;
    }
  }
  return retry || added === 0;
}

async function ensureDefaultGroup(windowId, settings) {
  const [rawTabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  const tabIds = sortTabs(rawTabs)
    .filter(isUngroupedTab)
    .filter((tab) => !isPendingPinned(tab.id) && !isPendingCreated(tab.id))
    .map((tab) => tab.id);
  if (tabIds.length === 0) return false;

  const rememberedId = defaultGroupByWindow.get(windowId) ?? null;
  const existing = findDefaultGroup(groups, {
    title: settings.defaultGroupTitle,
    rememberedId,
  });

  if (existing) {
    defaultGroupByWindow.set(windowId, existing.id);
    return addTabsToGroup(tabIds, existing.id);
  }

  let groupId = null;
  try {
    groupId = await chrome.tabs.group({
      tabIds,
      createProperties: { windowId },
    });
  } catch (err) {
    if (DRAG_ERROR.test(errorText(err))) return true;
    console.warn("[gtm] default group creation failed", errorText(err));
    return false;
  }
  if (groupId == null) return false;
  defaultGroupByWindow.set(windowId, groupId);
  try {
    await updateGroupPresentation(groupId, {
      title: settings.defaultGroupTitle,
      color: settings.defaultGroupColor,
    });
    await chrome.tabGroups.move(groupId, { index: -1 });
  } catch {
    // Position/title are cosmetic; normalization already did the important part.
  }
  return false;
}

async function applyGroupOrder(windowId, settings) {
  const [rawTabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  const moves = planGroupOrder({
    tabs: sortTabs(rawTabs),
    groups,
    pinnedGroups: settings.pinnedGroups,
  });
  for (const move of moves) {
    try {
      await chrome.tabGroups.move(move.groupId, { index: move.index });
    } catch (err) {
      if (DRAG_ERROR.test(errorText(err))) return true;
    }
  }
  return false;
}

async function applySingleExpanded(windowId, settings) {
  const [rawTabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  const tabs = sortTabs(rawTabs);
  const activeTab = tabs.find((tab) => tab.active) ?? null;
  const groupIds = new Set(groups.map((group) => group.id));
  if (activeTab && groupIds.has(activeTab.groupId)) {
    lastActiveGroupByWindow.set(windowId, activeTab.groupId);
  }

  const plan = planCollapse({
    tabs,
    groups,
    activeTab,
    rememberedGroupId: lastActiveGroupByWindow.get(windowId) ?? null,
    keepLastWhenPinned: settings.keepLastWhenPinned,
  });
  const byId = new Map(groups.map((group) => [group.id, group]));
  let retry = false;

  const expandTarget = plan.find((entry) => entry.collapsed === false);
  if (activeTab && activeTab.groupId === TAB_GROUP_ID_NONE) {
    if (expandTarget) lastActiveGroupByWindow.set(windowId, expandTarget.groupId);
    else lastActiveGroupByWindow.delete(windowId);
  }
  if (expandTarget) {
    headerActivationUntil.delete(expandTarget.groupId);
    const group = byId.get(expandTarget.groupId);
    if (group && group.collapsed) {
      try {
        await updateCollapsed(group.id, false);
      } catch (err) {
        if (DRAG_ERROR.test(errorText(err))) retry = true;
      }
    }
  }
  for (const entry of plan) {
    if (entry.collapsed !== true) continue;
    const group = byId.get(entry.groupId);
    if (!group || group.collapsed) continue;
    // A header-click activation is in flight; collapsing now would abort it.
    if ((headerActivationUntil.get(entry.groupId) ?? 0) > Date.now()) continue;
    try {
      await updateCollapsed(group.id, true);
    } catch (err) {
      if (DRAG_ERROR.test(errorText(err))) retry = true;
    }
  }
  for (const [groupId, until] of headerActivationUntil) {
    if (until <= Date.now()) headerActivationUntil.delete(groupId);
  }
  return retry;
}

// ------------------------------------------------------- pinned group snapshots

function refreshPinnedSnapshots() {
  if (!ready) return;
  clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void doRefreshPinnedSnapshots();
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function doRefreshPinnedSnapshots() {
  const settings = currentSettings;
  const pinnedTitles = new Set(settings.pinnedGroups.map((pinned) => pinned.title));
  let groups = [];
  let tabs = [];
  try {
    [groups, tabs] = await Promise.all([
      chrome.tabGroups.query({}),
      chrome.tabs.query({}),
    ]);
  } catch (err) {
    console.warn("[gtm] snapshot query failed", errorText(err));
    return;
  }

  for (const [tabId, entry] of pendingPinnedTabs) {
    if (entry.expiresAt < Date.now()) pendingPinnedTabs.delete(tabId);
  }
  for (const [tabId, expiresAt] of pendingCreatedTabs) {
    if (expiresAt < Date.now()) pendingCreatedTabs.delete(tabId);
  }

  const next = new Map();
  const tabsById = new Map(tabs.map((tab) => [tab.id, tab]));
  if (settings.enabled) {
    for (const group of groups) {
      if (!pinnedTitles.has(group.title)) continue;
      next.set(group.id, {
        windowId: group.windowId,
        title: group.title,
        color: group.color,
        collapsed: group.collapsed,
        tabIds: sortTabs(tabs.filter((tab) => tab.groupId === group.id)).map((tab) => tab.id),
        updatedAt: Date.now(),
      });
    }
    // Tabs that left a still-live pinned group stay in its snapshot while the
    // removal is being resolved, so an Ungroup can regroup them.
    for (const [tabId, entry] of pendingPinnedTabs) {
      if (entry.expiresAt < Date.now() || entry.origin == null) continue;
      const snapshot = next.get(entry.origin);
      const tab = tabsById.get(tabId);
      if (!snapshot || !tab) continue;
      if (tab.groupId !== TAB_GROUP_ID_NONE || tab.windowId !== snapshot.windowId) continue;
      if (!snapshot.tabIds.includes(tabId)) snapshot.tabIds.push(tabId);
    }
    // A group that just vanished but still has pending tabs keeps a ghost entry
    // so tabs.onRemoved / tabGroups.onRemoved can regroup them instead of
    // falling through to the blank-tab path.
    for (const [groupId, previous] of pinnedSnapshots) {
      if (next.has(groupId) || !pinnedTitles.has(previous.title)) continue;
      const pending = [];
      for (const [tabId, entry] of pendingPinnedTabs) {
        if (entry.expiresAt < Date.now()) continue;
        if (entry.origin === groupId || previous.tabIds.includes(tabId)) pending.push(tabId);
      }
      if (pending.length > 0) next.set(groupId, { ...previous, tabIds: pending });
    }
  }

  pinnedSnapshots.clear();
  for (const [groupId, snapshot] of next) pinnedSnapshots.set(groupId, snapshot);
  await persistPinnedSnapshots();
}

function persistPinnedSnapshots() {
  const plain = {};
  for (const [groupId, snapshot] of pinnedSnapshots) {
    plain[groupId] = {
      windowId: snapshot.windowId,
      title: snapshot.title,
      color: snapshot.color,
      collapsed: snapshot.collapsed,
      tabIds: snapshot.tabIds.slice(),
      updatedAt: snapshot.updatedAt,
    };
  }
  snapshotWrites = snapshotWrites
    .then(() => chrome.storage.session.set({ pinnedSnapshots: plain }))
    .catch((err) => console.warn("[gtm] snapshot persist failed", errorText(err)));
  return snapshotWrites;
}

async function seedCollapsedStates() {
  try {
    const groups = await chrome.tabGroups.query({});
    const live = new Set(groups.map((group) => group.id));
    for (const groupId of collapsedStates.keys()) {
      if (!live.has(groupId)) collapsedStates.delete(groupId);
    }
    for (const group of groups) rememberCollapsed(group);
  } catch {
    // Best effort: the map fills in as events arrive.
  }
}

// ------------------------------------------------------ pinned group protection

function handleGroupRemoved(group) {
  const known = pinnedSnapshots.get(group.id) ?? null;
  pinnedSnapshots.delete(group.id);
  collapsedStates.delete(group.id);
  headerActivationUntil.delete(group.id);
  recentGroupCreations.delete(group.id);

  if (!ready || !currentSettings.enabled) return;
  if (!isPinnedTitle(currentSettings.pinnedGroups, group.title)) return;
  if (!isNormalGroupTitle(group.title)) return;

  const tabIds = Array.isArray(known?.tabIds) ? known.tabIds.slice() : [];
  for (const [tabId, entry] of pendingPinnedTabs) {
    if (entry.expiresAt < Date.now()) continue;
    if (entry.origin !== group.id) continue;
    if (!tabIds.includes(tabId)) tabIds.push(tabId);
  }
  const snapshot = {
    windowId: group.windowId,
    title: group.title,
    color: group.color,
    collapsed: group.collapsed,
    tabIds,
  };
  const lockKey = `${group.windowId}:${group.id}`;
  if (restoreLocks.has(lockKey)) return;
  void restorePinnedGroup(group, snapshot, lockKey, 0).catch((err) => {
    console.warn("[gtm] pinned restore failed", errorText(err));
  });
}

function isNormalGroupTitle(title) {
  return typeof title === "string" && title !== "";
}

async function restorePinnedGroup(group, snapshot, lockKey, attempt) {
  restoreLocks.add(lockKey);
  const claimed = [];
  for (const tabId of snapshot.tabIds) {
    if (isPendingPinned(tabId)) continue;
    claimPendingPinned(tabId, group.id);
    claimed.push(tabId);
  }

  let outcome = "done";
  try {
    try {
      outcome = await attemptPinnedRestore(snapshot, attempt);
    } catch (err) {
      const message = errorText(err);
      if (attempt === 0 && DRAG_ERROR.test(message)) {
        outcome = "retry";
      } else {
        console.warn("[gtm] pinned restore failed", message);
      }
    }
    if (outcome === "retry" && attempt === 0) {
      // Keep the pending claims alive across the retry so normalization cannot
      // sweep the surviving tabs into the default group.
      await sleep(300);
      await restorePinnedGroup(group, snapshot, lockKey, 1);
    }
  } finally {
    for (const tabId of claimed) releasePendingPinned(tabId);
    restoreLocks.delete(lockKey);
    pinnedSnapshots.delete(group.id);
    refreshPinnedSnapshots();
    schedule(snapshot.windowId);
  }
}

async function attemptPinnedRestore(snapshot, attempt) {
  await sleep(RESTORE_SETTLE_MS);

  if (isClosingWindow(snapshot.windowId)) return "done";
  let win = null;
  try {
    win = await chrome.windows.get(snapshot.windowId);
  } catch {
    return "done";
  }
  if (!isNormalWindowType(win)) return "done";

  const alive = [];
  for (const tabId of snapshot.tabIds) {
    try {
      alive.push(await chrome.tabs.get(tabId));
    } catch {
      // Tab is gone.
    }
  }

  let groups = [];
  try {
    groups = await chrome.tabGroups.query({});
  } catch {
    // Fall through with the snapshot data only.
  }
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const movedToOtherWindow = alive.some((tab) => {
    const group = groupsById.get(tab.groupId);
    return (
      group != null &&
      group.title === snapshot.title &&
      group.windowId !== snapshot.windowId
    );
  });

  let recentMoveWindowId = null;
  if (!movedToOtherWindow && alive.length === 0) {
    const now = Date.now();
    for (const [groupId, record] of recentGroupCreations) {
      if (now - record.at > 2000) {
        recentGroupCreations.delete(groupId);
        continue;
      }
      if (record.title !== snapshot.title) continue;
      if (record.windowId === snapshot.windowId) continue;
      recentMoveWindowId = record.windowId;
      break;
    }
  }

  const decision = choosePinnedRestore({
    aliveTabs: alive,
    snapshot,
    closing: false,
    movedToOtherWindow: movedToOtherWindow || recentMoveWindowId != null,
  });
  if (decision.mode === "skip") {
    for (const tab of alive) schedule(tab.windowId);
    if (recentMoveWindowId != null) schedule(recentMoveWindowId);
    return "done";
  }

  let groupId = null;
  if (decision.mode === "regroup") {
    try {
      groupId = await chrome.tabs.group({
        tabIds: decision.tabIds,
        createProperties: { windowId: snapshot.windowId },
      });
    } catch (err) {
      if (attempt === 0 && DRAG_ERROR.test(errorText(err))) return "retry";
      throw err;
    }
  } else {
    const blankTabId = await createBlankTab(snapshot.windowId);
    if (blankTabId == null) return "done";
    try {
      groupId = await chrome.tabs.group({
        tabIds: [blankTabId],
        createProperties: { windowId: snapshot.windowId },
      });
    } catch (err) {
      if (attempt === 0 && DRAG_ERROR.test(errorText(err))) return "retry";
      throw err;
    }
  }
  if (groupId == null) return "done";

  defaultGroupByWindow.delete(snapshot.windowId);
  collapsedStates.set(groupId, false);
  await updateGroupPresentation(groupId, {
    title: snapshot.title,
    color: snapshot.color,
  });

  if (snapshot.collapsed) {
    try {
      const groupTabs = await chrome.tabs.query({ windowId: snapshot.windowId, groupId });
      if (!groupTabs.some((tab) => tab.active)) {
        await updateCollapsed(groupId, true);
      }
    } catch {
      // Chrome refuses to collapse the active group; normalize will settle it.
    }
  }
  return "done";
}

async function createBlankTab(windowId) {
  let tab = null;
  try {
    tab = await chrome.tabs.create({
      url: "chrome://newtab/",
      windowId,
      active: false,
    });
  } catch {
    try {
      tab = await chrome.tabs.create({ url: "about:blank", windowId, active: false });
    } catch (err) {
      console.warn("[gtm] blank tab creation failed", errorText(err));
      return null;
    }
  }
  if (tab?.id == null) return null;
  markIgnoredCreated(tab.id);
  return tab.id;
}

// ------------------------------------------------------------------ new tabs

async function handleCreated(tab) {
  if (!ready || !currentSettings.enabled) return;
  if (tab?.id == null || tab.windowId == null || tab.pinned) return;
  if (isIgnoredCreated(tab.id)) return;
  claimPendingCreated(tab.id);
  try {
    await classifyNewTab(tab);
  } finally {
    releasePendingCreated(tab.id);
  }
}

async function classifyNewTab(tab) {
  let win = null;
  try {
    win = await chrome.windows.get(tab.windowId);
  } catch {
    return;
  }
  if (!isNormalWindowType(win)) return;

  const windowId = tab.windowId;
  const now = Date.now();
  const burst = noteRecentCreation(windowId);
  if (burst >= 2) {
    burstSuppressUntil.set(windowId, now + CREATED_BURST_SUPPRESS_MS);
    return;
  }
  if ((burstSuppressUntil.get(windowId) ?? 0) > now) return;

  const check = { cancelled: false };
  pendingCreatedChecks.set(tab.id, check);
  await sleep(CREATED_WAIT_MS);
  if (recentCreationCount(windowId) >= 2) {
    pendingCreatedChecks.delete(tab.id);
    return;
  }

  let fresh = null;
  try {
    fresh = await chrome.tabs.get(tab.id);
  } catch {
    pendingCreatedChecks.delete(tab.id);
    return;
  }
  pendingCreatedChecks.delete(tab.id);

  if (isIgnoredCreated(tab.id)) return;
  if (check.cancelled || fresh.pinned || fresh.groupId !== TAB_GROUP_ID_NONE) return;

  const url = fresh.pendingUrl || fresh.url || "";
  if (url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return;

  const blank = url === "" || isNewTabUrl(url);
  if (!blank) {
    // Chrome groups link tabs and "new tab in group" before this point. An
    // externally launched tab can still carry an openerTabId (Chrome 157 sets
    // it to the previously active tab), so opener presence must not override
    // the external-tab setting.
    if (!currentSettings.externalNewTabInActiveGroup) return;
  }

  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  if (fresh.groupId !== TAB_GROUP_ID_NONE) return;
  const activeTab = tabs.find((entry) => entry.active) ?? null;
  const target = planNewTabTarget({
    tabs,
    groups,
    activeTab,
    rememberedGroupId: lastActiveGroupByWindow.get(windowId) ?? null,
    keepLastWhenPinned: currentSettings.keepLastWhenPinned,
  });

  if (target != null) {
    await moveTabIntoTarget(fresh.id, target);
    schedule(windowId);
    return;
  }
  if (!currentSettings.defaultGroup) {
    schedule(windowId);
    return;
  }

  const existing = findDefaultGroup(groups, {
    title: currentSettings.defaultGroupTitle,
    rememberedId: defaultGroupByWindow.get(windowId) ?? null,
  });
  if (existing) {
    defaultGroupByWindow.set(windowId, existing.id);
    await moveTabIntoTarget(fresh.id, existing.id);
  } else {
    await createDefaultGroupWithTab(fresh, windowId);
  }
  schedule(windowId);
}

async function moveTabIntoTarget(tabId, groupId) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(200);
    try {
      await chrome.tabs.group({ tabIds: [tabId], groupId });
      return true;
    } catch (err) {
      if (attempt === 1) {
        console.warn("[gtm] new tab grouping failed", errorText(err));
      }
    }
  }
  return false;
}

async function createDefaultGroupWithTab(tab, windowId) {
  let groupId = null;
  try {
    groupId = await chrome.tabs.group({
      tabIds: [tab.id],
      createProperties: { windowId },
    });
  } catch (err) {
    console.warn("[gtm] default group creation failed", errorText(err));
    return false;
  }
  if (groupId == null) return false;
  defaultGroupByWindow.set(windowId, groupId);
  collapsedStates.set(groupId, false);
  try {
    await updateGroupPresentation(groupId, {
      title: currentSettings.defaultGroupTitle,
      color: currentSettings.defaultGroupColor,
    });
  } catch {
    // Title/color are cosmetic.
  }
  return true;
}

// -------------------------------------------------------- header click handling

async function activateTabWithRetry(tabId, attempt = 0) {
  try {
    await chrome.tabs.update(tabId, { active: true });
  } catch (err) {
    if (attempt === 0 && DRAG_ERROR.test(errorText(err))) {
      setTimeout(() => void activateTabWithRetry(tabId, 1), 200);
    }
  }
}

/**
 * Chrome opens a throwaway blank tab when the user collapses the active group
 * and nothing outside it can take focus (no pinned tab, no other expanded
 * group). Close that tab; normalization then picks the next group to expand.
 */
async function suppressCollapseReplacement(group) {
  let tabs = [];
  let groups = [];
  try {
    [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId: group.windowId }),
      chrome.tabGroups.query({ windowId: group.windowId }),
    ]);
  } catch {
    return;
  }
  const live = groups.find((entry) => entry.id === group.id);
  if (!live || !live.collapsed) return;
  const replacementId = findCollapseReplacement({
    tabs,
    creations: recentTabCreations,
    groupId: group.id,
    now: Date.now(),
  });
  if (replacementId == null) return;
  try {
    await chrome.tabs.remove(replacementId);
  } catch {
    return;
  }
  recentTabCreations.delete(replacementId);
  schedule(group.windowId);
}

async function headerNewTab(group) {
  await suppressCollapseReplacement(group);

  let live = null;
  try {
    live = await chrome.tabGroups.get(group.id);
  } catch {
    return;
  }
  if (!live) return;

  let tab = null;
  try {
    tab = await chrome.tabs.create({
      url: "chrome://newtab/",
      windowId: group.windowId,
      active: true,
    });
  } catch {
    try {
      tab = await chrome.tabs.create({
        url: "about:blank",
        windowId: group.windowId,
        active: true,
      });
    } catch {
      return;
    }
  }
  if (tab?.id == null) return;

  markIgnoredCreated(tab.id);
  claimPendingCreated(tab.id);
  await moveTabIntoTarget(tab.id, group.id);
  lastActiveGroupByWindow.set(group.windowId, group.id);
  try {
    const current = await chrome.tabGroups.get(group.id);
    if (current.collapsed) await updateCollapsed(group.id, false);
  } catch {
    // Group vanished; the normal default-group pass handles the orphan tab.
  }
  schedule(group.windowId);
}

async function headerCollapseToDefault(group) {
  await suppressCollapseReplacement(group);

  let tabs = [];
  let groups = [];
  try {
    [tabs, groups] = await Promise.all([
      chrome.tabs.query({ windowId: group.windowId }),
      chrome.tabGroups.query({ windowId: group.windowId }),
    ]);
  } catch {
    return;
  }
  const live = groups.find((entry) => entry.id === group.id);
  if (!live || !live.collapsed) return;

  if (live.title === currentSettings.defaultGroupTitle) {
    await keepGroupExpandedAfterCollapse(group);
    return;
  }

  const starts = new Map(groups.map((entry) => [entry.id, Number.MAX_SAFE_INTEGER]));
  for (const tab of tabs) {
    const current = starts.get(tab.groupId);
    if (current != null && tab.index < current) starts.set(tab.groupId, tab.index);
  }
  const defaultGroup = groups
    .filter(
      (entry) =>
        entry.id !== group.id &&
        entry.title === currentSettings.defaultGroupTitle &&
        starts.get(entry.id) !== Number.MAX_SAFE_INTEGER,
    )
    .sort((a, b) => starts.get(a.id) - starts.get(b.id))[0];
  if (!defaultGroup) {
    await keepGroupExpandedAfterCollapse(group);
    return;
  }
  const pick = pickGroupTab(tabs, defaultGroup.id);
  if (!pick) {
    await keepGroupExpandedAfterCollapse(group);
    return;
  }

  lastActiveGroupByWindow.set(group.windowId, defaultGroup.id);
  try {
    await chrome.tabs.update(pick.id, { active: true });
  } catch {
    return;
  }
  schedule(group.windowId);
}

async function keepGroupExpandedAfterCollapse(group) {
  await suppressCollapseReplacement(group);

  let live = null;
  try {
    live = await chrome.tabGroups.get(group.id);
  } catch {
    return;
  }
  if (!live || !live.collapsed) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId: group.windowId });
  } catch {
    return;
  }
  const pick = pickGroupTab(tabs, group.id);
  if (!pick) return;

  lastActiveGroupByWindow.set(group.windowId, group.id);
  try {
    await chrome.tabs.update(pick.id, { active: true });
  } catch {
    return;
  }
  try {
    const current = await chrome.tabGroups.get(group.id);
    if (current.collapsed) await updateCollapsed(group.id, false);
  } catch {
    // Group vanished or Chrome already expanded it by activating its tab.
  }
  schedule(group.windowId);
}

async function handleGroupUpdated(group) {
  refreshPinnedSnapshots();
  schedule(group.windowId);

  const previous = collapsedStates.get(group.id);
  rememberCollapsed(group);
  if (!ready || !currentSettings.enabled) return;

  if (previous === false && group.collapsed === true && Date.now() >= warmupUntil) {
    const action = currentSettings.expandedGroupHeaderClick;
    if (action === "newtab") {
      void headerNewTab(group).catch((err) =>
        console.warn("[gtm] header new-tab failed", errorText(err)),
      );
    } else if (action === "collapse") {
      void headerCollapseToDefault(group).catch((err) =>
        console.warn("[gtm] header collapse failed", errorText(err)),
      );
    } else {
      void keepGroupExpandedAfterCollapse(group).catch((err) =>
        console.warn("[gtm] keep-expanded failed", errorText(err)),
      );
    }
  }

  if (!currentSettings.singleExpanded) return;
  if (previous !== true || group.collapsed !== false) return;
  if (Date.now() < warmupUntil) return;

  let active = null;
  try {
    active = (await chrome.tabs.query({ windowId: group.windowId, active: true }))[0] ?? null;
  } catch {
    return;
  }
  if (active && active.groupId === group.id) return; // Chrome expanded the active group itself.
  if (!currentSettings.expandHeaderClick) return;
  if (Date.now() - lastTabMoveAt < MOVE_EVENT_SUPPRESS_MS) return;

  let tabs = [];
  try {
    tabs = await chrome.tabs.query({ windowId: group.windowId });
  } catch {
    return;
  }
  const pick = pickGroupTab(tabs, group.id);
  if (!pick) return;

  headerActivationUntil.set(group.id, Date.now() + 1000);
  await sleep(120);
  try {
    const current = await chrome.tabGroups.get(group.id);
    if (current.collapsed) return; // Clicked again before we switched.
  } catch {
    return;
  }
  await activateTabWithRetry(pick.id);
}

// ------------------------------------------------------------- event wiring

chrome.tabs.onCreated.addListener((tab) => {
  if (tab?.id != null) {
    const url = tab.pendingUrl || tab.url || "";
    const now = Date.now();
    recentTabCreations.set(tab.id, {
      createdAt: now,
      windowId: tab.windowId,
      openerTabId: tab.openerTabId ?? null,
      blank: url === "" || isNewTabUrl(url),
    });
    for (const [createdId, entry] of recentTabCreations) {
      if (now - entry.createdAt > 5000) recentTabCreations.delete(createdId);
    }
  }
  void handleCreated(tab)
    .catch((err) => console.warn("[gtm] onCreated failed", errorText(err)))
    .finally(() => {
      refreshPinnedSnapshots();
      schedule(tab?.windowId);
    });
});

chrome.tabs.onActivated.addListener((info) => {
  schedule(info.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const groupChanged = Object.hasOwn(changeInfo, "groupId");
  const pinnedChanged = Object.hasOwn(changeInfo, "pinned");
  if (!groupChanged && !pinnedChanged) return;

  if (groupChanged) {
    const check = pendingCreatedChecks.get(tabId);
    if (check) check.cancelled = true;
    syncSnapshotMembership(tabId, changeInfo.groupId);
  }
  if (pinnedChanged) {
    // Pinning always leaves a group, and unpinning yields an ungrouped tab:
    // drop transient protection claims so normalization assigns it afresh
    // (the default-group pass picks it up).
    releasePendingPinned(tabId);
    removeTabFromSnapshots(tabId);
  }
  refreshPinnedSnapshots();
  schedule(tab?.windowId);
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  if (removeInfo?.isWindowClosing) {
    closingWindows.set(removeInfo.windowId, Date.now() + CLOSING_WINDOW_TTL_MS);
  }
  for (const snapshot of pinnedSnapshots.values()) {
    const at = snapshot.tabIds.indexOf(tabId);
    if (at !== -1) snapshot.tabIds.splice(at, 1);
  }
  releasePendingPinned(tabId);
  releasePendingCreated(tabId);
  recentTabCreations.delete(tabId);
  pendingCreatedChecks.delete(tabId);
  ignoreCreatedTabs.delete(tabId);
  refreshPinnedSnapshots();
  schedule(removeInfo?.windowId);
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  lastTabMoveAt = Date.now();
  refreshPinnedSnapshots();
  schedule(moveInfo?.windowId);
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  lastTabMoveAt = Date.now();
  refreshPinnedSnapshots();
  schedule(attachInfo?.newWindowId);
});

chrome.tabs.onDetached.addListener((tabId, detachInfo) => {
  lastTabMoveAt = Date.now();
  refreshPinnedSnapshots();
  schedule(detachInfo?.oldWindowId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  lastTabMoveAt = Date.now();
  releasePendingPinned(removedTabId);
  pendingCreatedChecks.delete(removedTabId);
  refreshPinnedSnapshots();
  void chrome.tabs
    .get(addedTabId)
    .then((tab) => schedule(tab.windowId))
    .catch(() => {});
});

chrome.tabGroups.onCreated.addListener((group) => {
  rememberCollapsed(group);
  recentGroupCreations.set(group.id, {
    title: group.title,
    windowId: group.windowId,
    at: Date.now(),
  });
  refreshPinnedSnapshots();
  schedule(group.windowId);
});

chrome.tabGroups.onUpdated.addListener((group) => {
  void handleGroupUpdated(group).catch((err) =>
    console.warn("[gtm] onUpdated failed", errorText(err)),
  );
});

chrome.tabGroups.onMoved.addListener((group) => {
  refreshPinnedSnapshots();
  schedule(group.windowId);
});

chrome.tabGroups.onRemoved.addListener((group) => {
  handleGroupRemoved(group);
});

chrome.windows.onCreated.addListener((win) => {
  schedule(win.id);
});

chrome.windows.onRemoved.addListener((windowId) => {
  lastActiveGroupByWindow.delete(windowId);
  defaultGroupByWindow.delete(windowId);
  retryCounts.delete(windowId);
  closingWindows.delete(windowId);
  recentCreations.delete(windowId);
  burstSuppressUntil.delete(windowId);
  clearTimeout(scheduleTimers.get(windowId));
  scheduleTimers.delete(windowId);
  windowChains.delete(windowId);
  for (const [groupId, snapshot] of [...pinnedSnapshots]) {
    if (snapshot.windowId === windowId) pinnedSnapshots.delete(groupId);
  }
});

function removeTabFromSnapshots(tabId) {
  for (const snapshot of pinnedSnapshots.values()) {
    const at = snapshot.tabIds.indexOf(tabId);
    if (at !== -1) snapshot.tabIds.splice(at, 1);
  }
}

function syncSnapshotMembership(tabId, newGroupId) {
  let origin = null;
  for (const [groupId, snapshot] of pinnedSnapshots) {
    const at = snapshot.tabIds.indexOf(tabId);
    if (at !== -1) {
      if (origin == null) origin = groupId;
      snapshot.tabIds.splice(at, 1);
    }
  }
  if (newGroupId === TAB_GROUP_ID_NONE) {
    if (origin != null) claimPendingPinned(tabId, origin);
    return;
  }
  releasePendingPinned(tabId);
  const target = pinnedSnapshots.get(newGroupId);
  if (target && !target.tabIds.includes(tabId)) target.tabIds.push(tabId);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "sync" || !changes.settings) return;
  currentSettings = normalizeSettings(changes.settings.newValue);
  refreshPinnedSnapshots();
  void normalizeAllWindows();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "normalize-all-windows") {
    void (async () => {
      try {
        await boot();
        await normalizeAllWindows();
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: errorText(err) });
      }
    })();
    return true;
  }
  if (message?.type === "save-settings") {
    void (async () => {
      try {
        await boot();
        const settings = await applySettingsPatch(message.patch ?? {});
        sendResponse({ ok: true, settings });
      } catch (err) {
        sendResponse({ ok: false, error: errorText(err) });
      }
    })();
    return true;
  }
  return false;
});

async function applySettingsPatch(patch) {
  const oldSettings = currentSettings;
  const preview = normalizeSettings({ ...oldSettings, ...patch });
  const presentationChanged =
    preview.defaultGroupTitle !== oldSettings.defaultGroupTitle ||
    preview.defaultGroupColor !== oldSettings.defaultGroupColor;
  if (preview.enabled && presentationChanged) {
    await renameDefaultGroups(oldSettings, preview);
  }
  const { newSettings } = await saveSettings(patch);
  currentSettings = newSettings;
  refreshPinnedSnapshots();
  await normalizeAllWindows();
  return newSettings;
}

async function renameDefaultGroups(oldSettings, newSettings) {
  let windows = [];
  try {
    windows = await chrome.windows.getAll();
  } catch {
    return;
  }
  for (const win of windows) {
    if (!isNormalWindowType(win)) continue;
    let groups = [];
    try {
      groups = await chrome.tabGroups.query({ windowId: win.id });
    } catch {
      continue;
    }
    const target = findDefaultGroup(groups, {
      title: oldSettings.defaultGroupTitle,
      rememberedId: defaultGroupByWindow.get(win.id) ?? null,
    });
    if (!target) continue;
    try {
      await updateGroupPresentation(target.id, {
        title: newSettings.defaultGroupTitle,
        color: newSettings.defaultGroupColor,
      });
      defaultGroupByWindow.set(win.id, target.id);
    } catch {
      // Group vanished mid-rename.
    }
  }
}

// ------------------------------------------------------------------- lifecycle

function installBootBumpers() {
  let lastActivity = Date.now();
  const bump = () => {
    lastActivity = Date.now();
  };
  const events = [
    chrome.tabs.onCreated,
    chrome.tabs.onAttached,
    chrome.tabs.onMoved,
    chrome.tabGroups.onCreated,
    chrome.tabGroups.onUpdated,
    chrome.windows.onCreated,
  ];
  for (const event of events) event.addListener(bump);
  return {
    lastActivity: () => lastActivity,
    remove() {
      for (const event of events) event.removeListener(bump);
    },
  };
}

async function boot() {
  if (bootPromise) return bootPromise;
  bootPromise = (async () => {
    currentSettings = await loadSettings();
    const { bootReady } = await chrome.storage.session.get("bootReady");

    if (!bootReady) {
      const bumpers = installBootBumpers();
      const startedAt = Date.now();
      try {
        while (Date.now() - startedAt < MAX_BOOT_MS) {
          await sleep(250);
          if (Date.now() - bumpers.lastActivity() >= QUIET_MS) break;
        }
      } finally {
        bumpers.remove();
      }
      await chrome.storage.session.set({ bootReady: true });
      // Give Chrome's own session restore time to settle before a header click
      // is allowed to switch tabs. Worker wake-ups mid-session skip this.
      warmupUntil = Date.now() + WARMUP_MS;
    }

    ready = true;
    await doRefreshPinnedSnapshots();
    await seedCollapsedStates();
    void normalizeAllWindows();
  })();
  try {
    await bootPromise;
  } catch (err) {
    bootPromise = null;
    throw err;
  }
}

chrome.runtime.onStartup.addListener(() => {
  void boot().catch((err) => console.warn("[gtm] boot failed", errorText(err)));
});

chrome.runtime.onInstalled.addListener(() => {
  void boot().catch((err) => console.warn("[gtm] boot failed", errorText(err)));
});

void boot().catch((err) => console.warn("[gtm] boot failed", errorText(err)));
