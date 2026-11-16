// Regression: the event that revives an idle MV3 worker must not be dropped.
//
// The bug: listeners ran before boot() finished, saw `ready === false` and
// returned. After ~30s idle, Ctrl+T therefore skipped the new-tab fast path and
// the post-boot normalization swept the tab into the default group instead of
// the expanded group.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  storageDelayMs: 5,
  session: {
    bootReady: true,
    runtimeState: { collapsed: { 100: true, 300: false }, lastActive: { 1: 300 } },
  },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: false, lastAccessed: 900, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: false, lastAccessed: 300, url: "https://example.com/alpha" },
    // Ctrl+T: Chrome already created the tab; its onCreated wakes the worker.
    { id: 50, windowId: 1, index: 2, groupId: -1, pinned: false, active: true, lastAccessed: 1000, url: "", pendingUrl: "chrome://newtab/" },
  ],
});

await import("../src/background.js");
env.chrome.tabs.onCreated.fire(clone(env.findTab(50)));
await sleep(500);

test("a Ctrl+T tab that wakes the worker joins the expanded group", () => {
  assert.equal(env.findTab(50).groupId, 300);
});
