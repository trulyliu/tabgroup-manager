// Minimal fake `chrome` API shared by the background tests.
//
// Each test file runs in its own process (node --test), so a file installs one
// fake, imports src/background.js once, and drives events against it.

export const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function makeEvent() {
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

export const BASE_SETTINGS = Object.freeze({
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
});

/**
 * Install a fake chrome on globalThis. `session` seeds chrome.storage.session
 * (bootReady: true means "worker wake-up inside a running browser session").
 * `storageDelayMs` makes storage reads take real time, like Chrome's IPC.
 */
export function installFakeChrome({
  windows = [{ id: 1, type: "normal", focused: true }],
  groups = [],
  tabs = [],
  settings = {},
  session = { bootReady: true },
  storageDelayMs = 0,
  nextTabId = 10,
  nextGroupId = 200,
} = {}) {
  const state = {
    windows,
    groups,
    tabs,
    settings: { ...BASE_SETTINGS, ...settings },
    session: { ...session },
    calls: { group: [], create: [], move: [], remove: [], sequence: [], update: [] },
    failures: { group: [], update: [] },
  };
  const { calls } = state;
  const delay = () => (storageDelayMs > 0 ? sleep(storageDelayMs) : Promise.resolve());

  function filterTabs(query = {}) {
    return state.tabs.filter(
      (tab) =>
        (query.windowId == null || tab.windowId === query.windowId) &&
        (query.active == null || tab.active === query.active) &&
        (query.groupId == null || tab.groupId === query.groupId),
    );
  }

  function findTab(tabId) {
    const tab = state.tabs.find((entry) => entry.id === tabId);
    if (!tab) throw new Error(`No tab with id ${tabId}`);
    return tab;
  }

  function findGroup(groupId) {
    const group = state.groups.find((entry) => entry.id === groupId);
    if (!group) throw new Error(`No tab group with id ${groupId}`);
    return group;
  }

  /** Throw the first queued failure whose predicate matches the call args. */
  function maybeFail(kind, args) {
    const list = state.failures[kind];
    const at = list.findIndex((entry) => entry.match(args));
    if (at === -1) return;
    const [entry] = list.splice(at, 1);
    throw new Error(entry.message);
  }

  function groupTabs({ tabIds, groupId, createProperties }) {
    maybeFail("group", { tabIds, groupId, createProperties });
    calls.group.push(clone({ tabIds, groupId, createProperties }));
    let resolvedId = groupId;
    if (resolvedId == null) {
      resolvedId = nextGroupId++;
      state.groups.push({
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
    commands: {
      onCommand: makeEvent(),
      async getAll() {
        return [{ name: "switch-to-default-group", shortcut: "Alt+W" }];
      },
    },
    storage: {
      sync: {
        async get(key) {
          await delay();
          return key === "settings" ? { settings: clone(state.settings) } : {};
        },
        async set(values) {
          if (!values.settings) return;
          const oldValue = clone(state.settings);
          Object.assign(state.settings, clone(values.settings));
          chrome.storage.onChanged.fire(
            { settings: { oldValue, newValue: clone(state.settings) } },
            "sync",
          );
        },
      },
      session: {
        async get(keys) {
          await delay();
          const list = keys == null ? Object.keys(state.session) : [].concat(keys);
          const result = {};
          for (const key of list) {
            if (key in state.session) result[key] = clone(state.session[key]);
          }
          return result;
        },
        async set(values) {
          Object.assign(state.session, clone(values));
        },
      },
      onChanged: makeEvent(),
    },
    windows: {
      getAll: async () => clone(state.windows),
      async get(windowId) {
        const win = state.windows.find((entry) => entry.id === windowId);
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
          calls.sequence.push({ type: "activate", tabId });
          for (const entry of state.tabs) entry.active = false;
        }
        Object.assign(findTab(tabId), properties);
        return clone(findTab(tabId));
      },
      async create({ windowId, url, active = false }) {
        calls.create.push({ windowId, url, active });
        if (active) {
          for (const entry of state.tabs) entry.active = false;
        }
        const tab = {
          id: nextTabId++,
          windowId,
          index: state.tabs.length,
          groupId: -1,
          pinned: false,
          active,
          lastAccessed: Date.now(),
          url,
        };
        state.tabs.push(tab);
        return clone(tab);
      },
      async remove(tabId) {
        calls.sequence.push({ type: "remove", tabId });
        calls.remove.push(tabId);
        const at = state.tabs.findIndex((entry) => entry.id === tabId);
        if (at !== -1) state.tabs.splice(at, 1);
      },
      async move(tabId, { index }) {
        const tab = findTab(tabId);
        state.tabs.splice(state.tabs.indexOf(tab), 1);
        state.tabs.splice(index, 0, tab);
        state.tabs.forEach((entry, i) => {
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
          state.groups.filter(
            (group) => query.windowId == null || group.windowId === query.windowId,
          ),
        ),
      async get(groupId) {
        return clone(findGroup(groupId));
      },
      async update(groupId, properties) {
        maybeFail("update", { groupId, properties });
        calls.update.push({ groupId, properties: clone(properties) });
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
  return { chrome, ...state, findTab, findGroup };
}

/** Remove a tab the way Chrome does: drop it, then fire tabs.onRemoved. */
export function closeTab(env, tabId, { isWindowClosing = false } = {}) {
  const at = env.tabs.findIndex((entry) => entry.id === tabId);
  const [tab] = env.tabs.splice(at, 1);
  env.chrome.tabs.onRemoved.fire(tabId, { windowId: tab.windowId, isWindowClosing });
  return tab;
}

/** Remove a group the way Chrome does once it is empty. */
export function removeGroup(env, groupId) {
  const at = env.groups.findIndex((entry) => entry.id === groupId);
  const [group] = env.groups.splice(at, 1);
  env.chrome.tabGroups.onRemoved.fire(clone(group));
  return group;
}

export const DRAG_MESSAGE = "Tabs cannot be edited right now (user may be dragging a tab).";
