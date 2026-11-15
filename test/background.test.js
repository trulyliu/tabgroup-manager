// Regression: unpinning a tab must re-enter the default group.
//
// The bug: `tabs.onUpdated` only scheduled normalization for `groupId`
// changes, so a pinned tab that became unpinned (`pinned: false`, still
// `groupId: -1`) stayed ungrouped until some unrelated event happened.
//
// This test drives the real background module against a minimal fake
// `chrome` API and asserts the default-group pass runs on the pinned change.

import test from "node:test";
import assert from "node:assert/strict";

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
    removeListener(listener) {
      const at = listeners.indexOf(listener);
      if (at !== -1) listeners.splice(at, 1);
    },
    fire(...args) {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const windows = [{ id: 1, type: "normal", focused: true }];
const groups = [
  { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: false },
  { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
];
const tabs = [
  {
    id: 1,
    windowId: 1,
    index: 0,
    groupId: 100,
    pinned: false,
    active: true,
    lastAccessed: 100,
    url: "https://example.com/a",
  },
  {
    id: 2,
    windowId: 1,
    index: 1,
    groupId: -1,
    pinned: true,
    active: false,
    lastAccessed: 200,
    url: "https://example.com/b",
  },
  {
    id: 4,
    windowId: 1,
    index: 2,
    groupId: 300,
    pinned: false,
    active: false,
    lastAccessed: 300,
    url: "https://example.com/alpha-a",
  },
  {
    id: 5,
    windowId: 1,
    index: 3,
    groupId: 300,
    pinned: false,
    active: false,
    lastAccessed: 310,
    url: "https://example.com/alpha-b",
  },
];
const calls = { group: [], create: [], move: [], remove: [] };
let nextTabId = 10;
let nextGroupId = 200;

const settings = {
  enabled: true,
  groupsFirst: true,
  defaultGroup: true,
  singleExpanded: true,
  keepLastWhenPinned: true,
  externalNewTabInActiveGroup: true,
  expandHeaderClick: false,
  expandedGroupHeaderClick: "collapse",
  defaultGroupTitle: "其他",
  defaultGroupColor: "grey",
  pinnedGroups: [],
};

function filterTabs(query = {}) {
  return tabs.filter(
    (tab) =>
      (query.windowId == null || tab.windowId === query.windowId) &&
      (query.active == null || tab.active === query.active) &&
      (query.groupId == null || tab.groupId === query.groupId),
  );
}

function findTab(tabId) {
  const tab = tabs.find((entry) => entry.id === tabId);
  if (!tab) throw new Error(`No tab with id ${tabId}`);
  return tab;
}

function findGroup(groupId) {
  const group = groups.find((entry) => entry.id === groupId);
  if (!group) throw new Error(`No tab group with id ${groupId}`);
  return group;
}

function groupTabs({ tabIds, groupId, createProperties }) {
  calls.group.push(clone({ tabIds, groupId, createProperties }));
  let resolvedId = groupId;
  if (resolvedId == null) {
    resolvedId = nextGroupId++;
    groups.push({
      id: resolvedId,
      windowId: createProperties?.windowId ?? 1,
      title: "",
      color: "grey",
      collapsed: false,
    });
  }
  for (const tabId of tabIds) findTab(tabId).groupId = resolvedId;
  return resolvedId;
}

const chrome = {
  runtime: {
    id: "test-extension-id",
    onStartup: makeEvent(),
    onInstalled: makeEvent(),
    onMessage: makeEvent(),
  },
  storage: {
    sync: {
      async get(key) {
        return key === "settings" ? { settings: clone(settings) } : {};
      },
      async set(values) {
        if (!values.settings) return;
        const oldValue = clone(settings);
        Object.assign(settings, clone(values.settings));
        chrome.storage.onChanged.fire(
          { settings: { oldValue, newValue: clone(settings) } },
          "sync",
        );
      },
    },
    session: {
      async get(key) {
        if (key === "bootReady") return { bootReady: true };
        return {};
      },
      async set() {},
    },
    onChanged: makeEvent(),
  },
  windows: {
    getAll: async () => clone(windows),
    async get(windowId) {
      const win = windows.find((entry) => entry.id === windowId);
      if (!win) throw new Error(`No window with id ${windowId}`);
      return clone(win);
    },
    onCreated: makeEvent(),
    onRemoved: makeEvent(),
  },
  tabs: {
    onCreated: makeEvent(),
    onActivated: makeEvent(),
    onUpdated: makeEvent(),
    onRemoved: makeEvent(),
    onMoved: makeEvent(),
    onAttached: makeEvent(),
    onDetached: makeEvent(),
    onReplaced: makeEvent(),
    query: async (query) => clone(filterTabs(query)),
    async get(tabId) {
      return clone(findTab(tabId));
    },
    async group(args) {
      return groupTabs(args);
    },
    async ungroup(tabIds) {
      for (const tabId of tabIds) findTab(tabId).groupId = -1;
    },
    async update(tabId, properties) {
      if (properties.active === true) {
        for (const entry of tabs) entry.active = false;
      }
      Object.assign(findTab(tabId), properties);
      return clone(findTab(tabId));
    },
    async create({ windowId, url, active = false }) {
      calls.create.push({ windowId, url, active });
      if (active) {
        for (const entry of tabs) entry.active = false;
      }
      const tab = {
        id: nextTabId++,
        windowId,
        index: tabs.length,
        groupId: -1,
        pinned: false,
        active,
        lastAccessed: Date.now(),
        url,
      };
      tabs.push(tab);
      return clone(tab);
    },
    async remove(tabId) {
      calls.remove.push(tabId);
      const at = tabs.findIndex((entry) => entry.id === tabId);
      if (at !== -1) tabs.splice(at, 1);
    },
    async move(tabId, { index }) {
      const tab = findTab(tabId);
      tabs.splice(tabs.indexOf(tab), 1);
      tabs.splice(index, 0, tab);
      tabs.forEach((entry, i) => {
        entry.index = i;
      });
    },
  },
  tabGroups: {
    onCreated: makeEvent(),
    onUpdated: makeEvent(),
    onMoved: makeEvent(),
    onRemoved: makeEvent(),
    query: async (query = {}) =>
      clone(
        groups.filter(
          (group) => query.windowId == null || group.windowId === query.windowId,
        ),
      ),
    async get(groupId) {
      return clone(findGroup(groupId));
    },
    async update(groupId, properties) {
      Object.assign(findGroup(groupId), properties);
      return clone(findGroup(groupId));
    },
    async move(groupId, { index, windowId }) {
      calls.move.push({ groupId, index, windowId });
      const group = findGroup(groupId);
      if (windowId != null) group.windowId = windowId;
      return clone(group);
    },
  },
};

globalThis.chrome = chrome;
await import("../src/background.js");
await sleep(120);

test("unpinning a tab runs the default-group pass", async () => {
  const pinnedTab = findTab(2);
  pinnedTab.pinned = false;
  calls.group.length = 0;

  chrome.tabs.onUpdated.fire(2, { pinned: false }, clone(pinnedTab));
  await sleep(250);

  const defaultGroupCall = calls.group.find((call) => call.tabIds.includes(2));
  assert.ok(
    defaultGroupCall,
    "tabs.group should be called for the newly unpinned tab",
  );
  assert.equal(defaultGroupCall.groupId, 100);
  assert.deepEqual(defaultGroupCall.tabIds, [2]);
  assert.equal(findTab(2).groupId, 100);
});

test("closing the throwaway tab Chrome creates on group collapse", async () => {
  // Reset: Alpha expanded, active tab is its first tab.
  const alpha = findGroup(300);
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(60);

  // Chrome creates a blank tab outside the group, then collapses it.
  const replacement = {
    id: 6,
    windowId: 1,
    index: tabs.length,
    groupId: -1,
    pinned: false,
    active: true,
    lastAccessed: Date.now(),
    openerTabId: 4,
    url: "chrome://newtab/",
    pendingUrl: "chrome://newtab/",
  };
  tabs.push(replacement);
  findTab(4).active = false;
  calls.remove.length = 0;

  chrome.tabs.onCreated.fire(clone(replacement));
  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(150);

  assert.deepEqual(calls.remove, [6]);
  assert.equal(tabs.some((entry) => entry.id === 6), false);
});

test("collapsing the expanded group while a pinned tab is active expands another group", async () => {
  const alpha = findGroup(300);
  const defaultGroup = findGroup(100);
  defaultGroup.collapsed = true;
  alpha.collapsed = false;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(40);

  // Use Alpha, then activate a pinned tab: keepLastWhenPinned keeps Alpha open.
  findTab(2).pinned = true;
  findTab(2).groupId = -1;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(250);
  for (const entry of tabs) entry.active = false;
  findTab(2).active = true;
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 2 });
  await sleep(250);
  assert.equal(findGroup(300).collapsed, false);

  // Clicking Alpha's header must collapse it, not re-expand it because the
  // active tab is pinned. Another group takes the expanded slot.
  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(300);

  assert.equal(findGroup(300).collapsed, true);
  assert.equal(findGroup(100).collapsed, false);
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 100);
  assert.equal(findTab(2).active, false);
});

test("the same fallback is used without a pinned tab", async () => {
  const alpha = findGroup(300);
  findTab(2).pinned = false;
  findTab(2).groupId = -1;
  findGroup(100).collapsed = true;
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(300);

  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(300);

  assert.equal(findGroup(300).collapsed, true);
  assert.equal(findGroup(100).collapsed, false);
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 100);
});

test("an external tab with an opener still honors the active-group setting", async () => {
  const alpha = findGroup(300);
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(250);
  assert.equal(findGroup(300).collapsed, false);

  // Chrome 157 gives externally launched tabs the previously active tab as
  // opener; that must not make them look like link tabs.
  const external = {
    id: 7,
    windowId: 1,
    index: tabs.length,
    groupId: -1,
    pinned: false,
    active: true,
    lastAccessed: Date.now(),
    openerTabId: 4,
    url: "https://www.baidu.com/",
    pendingUrl: "https://www.baidu.com/",
  };
  for (const entry of tabs) entry.active = false;
  tabs.push(external);
  calls.group.length = 0;

  chrome.tabs.onCreated.fire(clone(external));
  await sleep(300);

  const call = calls.group.find((entry) => entry.tabIds.includes(7));
  assert.ok(call, "external tab should be grouped");
  assert.equal(call.groupId, 300);
  assert.equal(findTab(7).groupId, 300);
});

test("header click can keep the expanded group open", async () => {
  const alpha = findGroup(300);
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(250);

  findTab(2).pinned = true;
  findTab(2).groupId = -1;
  for (const entry of tabs) entry.active = false;
  findTab(2).active = true;
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 2 });
  await sleep(200);

  await chrome.storage.sync.set({
    settings: { ...settings, expandedGroupHeaderClick: "noaction" },
  });
  await sleep(300);

  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(500);

  assert.equal(findGroup(300).collapsed, false, "Alpha stays expanded");
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 300);
});

test("with no fallback group the clicked group stays expanded, pinned or not", async () => {
  const alpha = findGroup(300);
  findTab(1).groupId = 300; // default group becomes empty and is no longer a candidate
  findTab(2).pinned = true;
  findTab(2).groupId = -1;
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(2).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 2 });
  await sleep(250);

  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(400);
  assert.equal(findGroup(300).collapsed, false);
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 300);

  // Same outcome with no pinned tab.
  findTab(2).pinned = false;
  findTab(2).groupId = -1;
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(250);

  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(400);
  assert.equal(findGroup(300).collapsed, false);
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 300);
});

test("header newtab action creates a tab inside the clicked group", async () => {
  const alpha = findGroup(300);
  await chrome.storage.sync.set({
    settings: { ...settings, expandedGroupHeaderClick: "newtab" },
  });
  await sleep(300);

  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(250);

  const before = tabs.length;
  calls.create.length = 0;
  alpha.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  await sleep(500);

  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].url, "chrome://newtab/");
  assert.equal(tabs.length, before + 1);
  const created = tabs[tabs.length - 1];
  assert.equal(created.groupId, 300);
  assert.equal(tabs.find((entry) => entry.active)?.id, created.id);
  assert.equal(findGroup(300).collapsed, false);
});

test("collapse action does nothing when the default group is clicked", async () => {
  const defaultGroup = findGroup(100);
  const alpha = findGroup(300);
  findTab(1).groupId = 100;
  await chrome.storage.sync.set({
    settings: { ...settings, expandedGroupHeaderClick: "collapse" },
  });
  await sleep(300);

  defaultGroup.collapsed = false;
  alpha.collapsed = true;
  for (const entry of tabs) entry.active = false;
  findTab(1).active = true;
  chrome.tabGroups.onUpdated.fire(clone(defaultGroup));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 1 });
  await sleep(250);

  const before = tabs.length;
  defaultGroup.collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(defaultGroup));
  await sleep(400);

  assert.equal(tabs.length, before);
  assert.equal(findGroup(100).collapsed, false);
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 100);
});

test("restoring an expanded pinned group hands focus back to the default group", async () => {
  const defaultGroup = findGroup(100);
  defaultGroup.collapsed = true;
  groups.push({ id: 400, windowId: 1, title: "Beta", color: "red", collapsed: true });
  tabs.push({
    id: 8,
    windowId: 1,
    index: 4,
    groupId: 400,
    pinned: false,
    active: false,
    lastAccessed: 50,
    url: "https://example.com/beta",
  });
  await chrome.storage.sync.set({
    settings: {
      ...settings,
      pinnedGroups: [
        { title: "Alpha", color: "blue" },
        { title: "Beta", color: "red" },
      ],
    },
  });
  await sleep(350);

  const alpha = findGroup(300);
  alpha.collapsed = false;
  for (const entry of tabs) entry.active = false;
  findTab(4).active = true;
  chrome.tabGroups.onUpdated.fire(clone(alpha));
  chrome.tabs.onActivated.fire({ windowId: 1, tabId: 4 });
  await sleep(250);

  // Close Alpha's last tab: Chrome chooses Beta or the pinned tab, but the
  // recreation must focus the default group instead.
  tabs.splice(tabs.indexOf(findTab(4)), 1);
  groups.splice(groups.indexOf(alpha), 1);
  chrome.tabGroups.onRemoved.fire({
    id: 300,
    windowId: 1,
    title: "Alpha",
    color: "blue",
    collapsed: false,
  });
  await sleep(1000);

  const recreated = groups.find((entry) => entry.title === "Alpha");
  assert.ok(recreated);
  assert.equal(recreated.collapsed, true);
  assert.equal(tabs.filter((entry) => entry.groupId === recreated.id).length, 1);
  assert.equal(findGroup(100).collapsed, false);
  assert.equal(tabs.find((entry) => entry.active)?.groupId, 100);
});
