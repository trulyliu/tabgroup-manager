// Regression: keepLastWhenPinned=false must only affect a *pinned* active tab.
//
// The bug: a fresh Ctrl+T tab is itself the active tab (unpinned, ungrouped)
// while it is classified, and the fallback bailed out whenever keepLast was
// off, so every Ctrl+T tab landed in the default group and all groups briefly
// collapsed.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  settings: { keepLastWhenPinned: false },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: -1, pinned: true, active: false, lastAccessed: 100, url: "https://example.com/pinned" },
    { id: 2, windowId: 1, index: 1, groupId: 100, pinned: false, active: false, lastAccessed: 200, url: "https://example.com/other" },
    { id: 4, windowId: 1, index: 2, groupId: 300, pinned: false, active: true, lastAccessed: 300, url: "https://example.com/alpha" },
  ],
});
const { chrome, findTab, findGroup } = env;

await import("../src/background.js");
await sleep(150);

async function pressCtrlT() {
  const tab = await chrome.tabs.create({ windowId: 1, url: "chrome://newtab/", active: true });
  chrome.tabs.onCreated.fire(tab);
  chrome.tabs.onActivated.fire({ tabId: tab.id, windowId: 1 });
  await sleep(100);
  return tab.id;
}

test("Ctrl+T from a grouped tab joins that group and keeps it expanded", async () => {
  chrome.tabs.onActivated.fire({ tabId: 4, windowId: 1 });
  await sleep(120);

  const id = await pressCtrlT();
  // Mid-classification the expanded group must not collapse.
  assert.equal(findGroup(300).collapsed, false, "Alpha stays expanded while classifying");
  await sleep(400);
  assert.equal(findTab(id).groupId, 300);
  assert.equal(findGroup(300).collapsed, false);
});

test("Ctrl+T from a pinned tab still goes to the default group", async () => {
  await chrome.tabs.update(1, { active: true });
  chrome.tabs.onActivated.fire({ tabId: 1, windowId: 1 });
  await sleep(150);
  assert.equal(findGroup(300).collapsed, true, "pinned tab active: every group collapsed");

  const id = await pressCtrlT();
  await sleep(400);
  assert.equal(findTab(id).groupId, 100);
});
