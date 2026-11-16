// Regression: with singleExpanded off, collapsing a group is just a collapse.
//
// The bug: every expanded→collapsed transition was treated as a click on the
// expanded group's header. With several groups open, collapsing any of them
// ran the configured action: `noaction` re-expanded it (it could never be
// collapsed) and `collapse` yanked focus to the default group.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  settings: { singleExpanded: false, expandedGroupHeaderClick: "noaction" },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: false },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: true, lastAccessed: 900, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: false, lastAccessed: 300, url: "https://example.com/alpha" },
  ],
});
const { chrome, calls, findGroup, findTab } = env;

await import("../src/background.js");
await sleep(200);

test("noaction: a collapsed non-active group stays collapsed", async () => {
  calls.sequence.length = 0;
  findGroup(300).collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(findGroup(300)));
  await sleep(400);

  assert.equal(findGroup(300).collapsed, true);
  assert.equal(findTab(1).active, true, "focus did not move");
  assert.deepEqual(calls.sequence, []);
});

test("collapse: collapsing a group does not pull focus to the default group", async () => {
  await chrome.storage.sync.set({
    settings: { ...env.settings, expandedGroupHeaderClick: "collapse" },
  });
  // Alpha open and active, default group open too.
  findGroup(300).collapsed = false;
  chrome.tabGroups.onUpdated.fire(clone(findGroup(300)));
  await chrome.tabs.update(4, { active: true });
  await sleep(200);
  calls.sequence.length = 0;

  findGroup(100).collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(findGroup(100)));
  await sleep(400);

  assert.equal(findGroup(100).collapsed, true);
  assert.equal(findTab(4).active, true);
  assert.deepEqual(calls.sequence, []);
});
