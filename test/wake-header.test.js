// Regression: a header click that wakes the worker must still run its action.
//
// The bug: collapsedStates lived only in memory, so after a restart the
// collapse event had no "previous: expanded" state and the configured
// expanded-header action (here: collapse → focus the default group) was lost.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  storageDelayMs: 5,
  settings: { expandedGroupHeaderClick: "collapse" },
  session: {
    bootReady: true,
    runtimeState: { collapsed: { 100: true, 300: false }, lastActive: { 1: 300 } },
  },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
    // Chrome already collapsed Alpha in response to the header click...
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: true },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: -1, pinned: true, active: true, lastAccessed: 1000, url: "https://example.com/pinned" },
    { id: 2, windowId: 1, index: 1, groupId: 100, pinned: false, active: false, lastAccessed: 500, url: "https://example.com/other" },
    // ...and moved focus to the pinned tab.
    { id: 4, windowId: 1, index: 2, groupId: 300, pinned: false, active: false, lastAccessed: 900, url: "https://example.com/alpha" },
  ],
});

await import("../src/background.js");
env.chrome.tabGroups.onUpdated.fire(clone(env.findGroup(300)));
await sleep(500);

test("a header click that wakes the worker still focuses the default group", () => {
  assert.equal(env.findTab(2).active, true, "default group's MRU tab is active");
  assert.equal(env.findGroup(300).collapsed, true, "Alpha stays collapsed");
  assert.equal(env.findGroup(100).collapsed, false, "default group is expanded");
});
