// New-tab fast path edge cases.
//
// - Two quick Ctrl+T presses (< 300ms) used to count as a session-restore
//   burst, so both tabs were demoted to the default group.
// - The "did Chrome group it meanwhile?" check after the final query looked at
//   a stale copy of the tab, so a tab Chrome grouped during that await was
//   moved out of its group.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeChrome, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: false, lastAccessed: 100, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: true, lastAccessed: 900, url: "https://example.com/alpha" },
  ],
});
const { chrome, findTab } = env;

await import("../src/background.js");
await sleep(150);
chrome.tabs.onActivated.fire({ tabId: 4, windowId: 1 });
await sleep(150);

test("two quick Ctrl+T presses both land in the expanded group", async () => {
  const first = await chrome.tabs.create({ windowId: 1, url: "chrome://newtab/", active: true });
  chrome.tabs.onCreated.fire(first);
  await sleep(40);
  const second = await chrome.tabs.create({ windowId: 1, url: "chrome://newtab/", active: true });
  chrome.tabs.onCreated.fire(second);
  await sleep(500);

  assert.equal(findTab(first.id).groupId, 300);
  assert.equal(findTab(second.id).groupId, 300);
});

test("a real-URL burst is still left alone", async () => {
  const opened = [];
  for (const url of ["https://example.com/r1", "https://example.com/r2", "https://example.com/r3"]) {
    const tab = await chrome.tabs.create({ windowId: 1, url, active: false });
    chrome.tabs.onCreated.fire(tab);
    opened.push(tab.id);
  }
  await sleep(500);
  // Not routed to the expanded group by the fast path; normalization files
  // them into the default group instead.
  for (const id of opened) assert.equal(findTab(id).groupId, 100);
});

test("a tab Chrome groups during classification is not stolen", async () => {
  // Let the previous test's burst suppression (2s) expire.
  await sleep(2100);
  // Alpha is expanded and active, so the fast path would target Alpha (300).
  await chrome.tabs.update(4, { active: true });
  chrome.tabs.onActivated.fire({ tabId: 4, windowId: 1 });
  await sleep(150);
  const tab = await chrome.tabs.create({ windowId: 1, url: "chrome://newtab/", active: false });
  const realGet = chrome.tabs.get;
  chrome.tabs.get = async (tabId) => {
    const result = await realGet(tabId);
    // Right after our read, Chrome puts the tab into the default group.
    if (tabId === tab.id) findTab(tab.id).groupId = 100;
    return result;
  };
  chrome.tabs.onCreated.fire(tab);
  await sleep(500);
  chrome.tabs.get = realGet;

  assert.equal(findTab(tab.id).groupId, 100);
});
