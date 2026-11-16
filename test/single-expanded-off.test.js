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

test("collapse: clicking the active default group header keeps it expanded and discards placeholder tabs", async () => {
  // Focus the default group (tab 1) and expand it
  findGroup(100).collapsed = false;
  findGroup(300).collapsed = true;
  chrome.tabGroups.onUpdated.fire(clone(findGroup(100)));
  await chrome.tabs.update(1, { active: true });
  chrome.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  await sleep(200);

  // User clicks default group header to collapse it.
  // Chrome collapses the group and creates a placeholder tab because tab 1 was active:
  findGroup(100).collapsed = true;
  const placeholder = {
    id: 99,
    windowId: 1,
    index: env.tabs.length,
    groupId: -1,
    pinned: false,
    active: true,
    lastAccessed: Date.now(),
    url: "",
    pendingUrl: "chrome://newtab/",
    openerTabId: 1,
  };
  env.tabs.push(placeholder);
  findTab(1).active = false;

  chrome.tabGroups.onUpdated.fire(clone(findGroup(100)));
  chrome.tabs.onCreated.fire(clone(placeholder));
  chrome.tabs.onActivated.fire({ tabId: 99, windowId: 1 });

  await sleep(600);

  // Group 100 stays expanded with tab 1 active, and placeholder tab 99 is removed
  assert.equal(findGroup(100).collapsed, false, "default group remains expanded");
  assert.equal(findTab(1).active, true, "tab 1 restored as active");
  assert.equal(env.tabs.some((t) => t.id === 99), false, "placeholder tab was discarded");
});
