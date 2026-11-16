// Regression: pinned-group protection must survive a worker restart.
//
// The bug: closing the last tab of a pinned group after the worker went idle
// woke it with tabs.onRemoved / tabGroups.onRemoved; both were dropped, and the
// snapshots were rebuilt from live groups after the group was already gone, so
// the group was never recreated.

import test from "node:test";
import assert from "node:assert/strict";

import { closeTab, installFakeChrome, removeGroup, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  storageDelayMs: 5,
  settings: { pinnedGroups: [{ title: "Alpha", color: "blue" }] },
  session: {
    bootReady: true,
    runtimeState: { collapsed: { 100: false, 300: true }, lastActive: { 1: 100 } },
    pinnedSnapshots: {
      300: { windowId: 1, title: "Alpha", color: "blue", collapsed: true, tabIds: [4], updatedAt: 1 },
    },
  },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: false },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: true },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: true, lastAccessed: 900, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: false, lastAccessed: 300, url: "https://example.com/alpha" },
  ],
});

await import("../src/background.js");
// The user closes Alpha's only tab while the worker is asleep.
closeTab(env, 4);
removeGroup(env, 300);
await sleep(1200);

test("a pinned group emptied while the worker slept is recreated", () => {
  const alpha = env.groups.filter((group) => group.title === "Alpha" && group.color === "blue");
  assert.equal(alpha.length, 1, "exactly one Alpha group after restore");
  const members = env.tabs.filter((tab) => tab.groupId === alpha[0].id);
  assert.equal(members.length, 1);
  assert.equal(members[0].url, "chrome://newtab/");
  assert.equal(members[0].active, false);
});
