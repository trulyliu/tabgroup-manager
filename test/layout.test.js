import test from "node:test";
import assert from "node:assert/strict";

import {
  TAB_GROUP_ID_NONE,
  isNewTabUrl,
  isUngroupedTab,
  findDefaultGroup,
  mostRecentlyUsedGroupId,
  planCollapse,
  planGroupOrder,
  planNewTabTarget,
} from "../src/lib/layout.js";

const group = (id, title) => ({ id, title, windowId: 1, collapsed: false });
const tab = (id, index, groupId, extra = {}) => ({
  id,
  index,
  groupId,
  windowId: 1,
  pinned: false,
  lastAccessed: 1000 + index,
  ...extra,
});

test("isUngroupedTab excludes pinned and dangling tabs", () => {
  assert.equal(isUngroupedTab(tab(1, 0, TAB_GROUP_ID_NONE)), true);
  assert.equal(isUngroupedTab(tab(1, 0, TAB_GROUP_ID_NONE, { pinned: true })), false);
  assert.equal(isUngroupedTab(tab(1, 0, 7)), false);
  assert.equal(isUngroupedTab({ index: 0, groupId: -1 }), false);
  assert.equal(isUngroupedTab(null), false);
});

test("planGroupOrder is a no-op when groups are already first and unpinned", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [tab(10, 0, 1), tab(11, 1, 1), tab(12, 2, 2)];
  assert.deepEqual(planGroupOrder({ tabs, groups, pinnedGroups: [] }), []);
});

test("planGroupOrder moves every group ahead of ungrouped tabs", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [tab(10, 0, -1), tab(11, 1, 1), tab(12, 2, 1), tab(13, 3, 2)];
  assert.deepEqual(planGroupOrder({ tabs, groups, pinnedGroups: [] }), [
    { groupId: 2, index: 0 },
    { groupId: 1, index: 0 },
  ]);
});

test("planGroupOrder applies configured pinned order ahead of the rest", () => {
  const groups = [group(1, "A"), group(2, "B"), group(3, "C")];
  const tabs = [tab(10, 0, 1), tab(11, 1, 2), tab(12, 2, 3)];
  assert.deepEqual(
    planGroupOrder({
      tabs,
      groups,
      pinnedGroups: [
        { title: "B", color: "blue" },
        { title: "A", color: "red" },
      ],
    }),
    [
      { groupId: 3, index: 0 },
      { groupId: 1, index: 0 },
      { groupId: 2, index: 0 },
    ],
  );
});

test("planGroupOrder skips pinned titles that are not open", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [tab(10, 0, 1), tab(11, 1, 2)];
  assert.deepEqual(
    planGroupOrder({
      tabs,
      groups,
      pinnedGroups: [
        { title: "Z", color: "grey" },
        { title: "A", color: "grey" },
        { title: "B", color: "grey" },
      ],
    }),
    [],
  );
});

test("planGroupOrder pins every group sharing a title together", () => {
  const groups = [group(1, "B"), group(2, "X"), group(3, "X")];
  const tabs = [tab(10, 0, 1), tab(11, 1, 2), tab(12, 2, 3)];
  assert.deepEqual(
    planGroupOrder({ tabs, groups, pinnedGroups: [{ title: "X", color: "grey" }] }),
    [
      { groupId: 1, index: 0 },
      { groupId: 3, index: 0 },
      { groupId: 2, index: 0 },
    ],
  );
});

test("planGroupOrder places groups after pinned tabs using pinnedCount", () => {
  const groups = [group(1, "A")];
  const tabs = [tab(10, 0, -1, { pinned: true }), tab(11, 1, -1), tab(12, 2, 1)];
  assert.deepEqual(planGroupOrder({ tabs, groups, pinnedGroups: [] }), [
    { groupId: 1, index: 1 },
  ]);
});

test("planGroupOrder returns [] for an empty group list", () => {
  assert.deepEqual(planGroupOrder({ tabs: [], groups: [], pinnedGroups: [] }), []);
});

test("findDefaultGroup prefers the remembered id, then exact title", () => {
  const groups = [group(1, "其他"), group(2, "其他"), group(3, "Work")];
  assert.equal(findDefaultGroup(groups, { title: "其他", rememberedId: 2 }).id, 2);
  assert.equal(findDefaultGroup(groups, { title: "其他", rememberedId: 99 }).id, 1);
  assert.equal(findDefaultGroup(groups, { title: "其他" }).id, 1);
  assert.equal(findDefaultGroup(groups, { title: "Nope" }), null);
  assert.equal(findDefaultGroup([], { title: "其他", rememberedId: 1 }), null);
});

test("mostRecentlyUsedGroupId uses the freshest grouped tab", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [
    tab(10, 0, 1, { lastAccessed: 500 }),
    tab(11, 1, 2, { lastAccessed: 900 }),
    tab(12, 2, -1, { lastAccessed: 1200 }),
  ];
  assert.equal(mostRecentlyUsedGroupId(tabs, groups), 2);
  assert.equal(mostRecentlyUsedGroupId([tab(10, 0, -1)], groups), null);
});

test("planCollapse expands only the active tab's group", () => {
  const groups = [group(1, "A"), group(2, "B"), group(3, "其他")];
  const tabs = [tab(10, 0, 1), tab(11, 1, 2), tab(12, 2, 3)];
  assert.deepEqual(
    planCollapse({ tabs, groups, activeTab: tabs[1], rememberedGroupId: 1 }),
    [
      { groupId: 1, collapsed: true },
      { groupId: 2, collapsed: false },
      { groupId: 3, collapsed: true },
    ],
  );
});

test("planCollapse collapses everything when the active tab is pinned and keepLast is off", () => {
  const groups = [group(1, "A")];
  const tabs = [tab(10, 0, -1, { pinned: true }), tab(11, 1, 1)];
  assert.deepEqual(
    planCollapse({
      tabs,
      groups,
      activeTab: tabs[0],
      rememberedGroupId: 1,
      keepLastWhenPinned: false,
    }),
    [{ groupId: 1, collapsed: true }],
  );
});

test("planCollapse keeps the remembered group expanded for a pinned active tab", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [tab(10, 0, -1, { pinned: true }), tab(11, 1, 1), tab(12, 2, 2)];
  assert.deepEqual(
    planCollapse({
      tabs,
      groups,
      activeTab: tabs[0],
      rememberedGroupId: 1,
      keepLastWhenPinned: true,
    }),
    [
      { groupId: 1, collapsed: false },
      { groupId: 2, collapsed: true },
    ],
  );
});

test("planCollapse falls back to the most recently used group", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [
    tab(10, 0, -1, { pinned: true }),
    tab(11, 1, 1, { lastAccessed: 100 }),
    tab(12, 2, 2, { lastAccessed: 800 }),
  ];
  assert.deepEqual(
    planCollapse({
      tabs,
      groups,
      activeTab: tabs[0],
      rememberedGroupId: null,
      keepLastWhenPinned: true,
    }),
    [
      { groupId: 1, collapsed: true },
      { groupId: 2, collapsed: false },
    ],
  );
});

test("planCollapse ignores a stale active group id", () => {
  const groups = [group(1, "A")];
  const tabs = [tab(10, 0, 9), tab(11, 1, 1)];
  assert.deepEqual(
    planCollapse({ tabs, groups, activeTab: tabs[0], rememberedGroupId: 1 }),
    [{ groupId: 1, collapsed: false }],
  );
  // No remembered id: falls back to the most recently used group.
  assert.deepEqual(planCollapse({ tabs, groups, activeTab: tabs[0], rememberedGroupId: null }), [
    { groupId: 1, collapsed: false },
  ]);
  assert.deepEqual(
    planCollapse({
      tabs,
      groups,
      activeTab: tabs[0],
      rememberedGroupId: null,
      keepLastWhenPinned: false,
    }),
    [{ groupId: 1, collapsed: true }],
  );
});

test("isNewTabUrl recognizes browser new-tab pages only", () => {
  for (const url of [
    "chrome://newtab",
    "chrome://newtab/",
    "chrome://newtab/?foo=1",
    "chrome://new-tab-page/",
    "chrome-search://local-ntp",
    "chrome-search://local-ntp/#x",
    "about:blank",
    "EDGE://NEWTAB",
  ]) {
    assert.equal(isNewTabUrl(url), true, url);
  }
  for (const url of ["https://example.com", "chrome://settings/", "", "about:blankx", null]) {
    assert.equal(isNewTabUrl(url), false, String(url));
  }
});

test("planNewTabTarget prefers the active group", () => {
  const groups = [group(1, "A"), group(2, "B")];
  const tabs = [tab(10, 0, 1), tab(11, 1, 2)];
  assert.equal(planNewTabTarget({ tabs, groups, activeTab: tabs[1] }), 2);
});

test("planNewTabTarget handles a pinned active tab", () => {
  const groups = [group(1, "A")];
  const tabs = [tab(10, 0, -1, { pinned: true }), tab(11, 1, 1, { lastAccessed: 700 })];
  assert.equal(
    planNewTabTarget({
      tabs,
      groups,
      activeTab: tabs[0],
      rememberedGroupId: null,
      keepLastWhenPinned: false,
    }),
    null,
  );
  assert.equal(
    planNewTabTarget({
      tabs,
      groups,
      activeTab: tabs[0],
      rememberedGroupId: 1,
      keepLastWhenPinned: true,
    }),
    1,
  );
});

test("planNewTabTarget returns null when no group exists", () => {
  const tabs = [tab(10, 0, -1)];
  assert.equal(
    planNewTabTarget({ tabs, groups: [], activeTab: tabs[0], keepLastWhenPinned: true }),
    null,
  );
});
