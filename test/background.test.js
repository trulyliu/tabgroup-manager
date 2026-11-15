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
  suppressCollapseNewTab: true,
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
        if (values.settings) Object.assign(settings, clone(values.settings));
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
      Object.assign(findTab(tabId), properties);
      return clone(findTab(tabId));
    },
    async create({ windowId, url, active = false }) {
      calls.create.push({ windowId, url, active });
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
