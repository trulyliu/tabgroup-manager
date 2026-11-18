// Closing a pinned group must reuse a live group with the same title+color
// instead of creating a blank duplicate. Chrome's saved-group restore can leave
// exactly that second group alive.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const groups = [
  { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
  { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
];
const tabs = [
  {
    id: 1,
    windowId: 1,
    index: 0,
    groupId: 100,
    pinned: false,
    active: false,
    lastAccessed: 100,
    url: "https://example.com/default",
  },
  {
    id: 4,
    windowId: 1,
    index: 1,
    groupId: 300,
    pinned: false,
    active: true,
    lastAccessed: 300,
    url: "https://example.com/alpha",
  },
];

const env = installFakeChrome({
  groups,
  tabs,
  settings: { pinnedGroups: [{ title: "Alpha", color: "blue" }] },
});
const { chrome, calls, findTab, findGroup } = env;

await import("../src/background.js");
await sleep(300);

test("closing a pinned group reuses a live same-title/color group", async () => {
  // Chrome reopened the saved group next to the pinned one.
  groups.push({ id: 400, windowId: 1, title: "Alpha", color: "blue", collapsed: true });
  tabs.push({
    id: 8,
    windowId: 1,
    index: 2,
    groupId: 400,
    pinned: false,
    active: false,
    lastAccessed: 400,
    url: "https://example.com/saved",
  });

  // Close the pinned group; its tab survives ungrouped.
  findTab(4).groupId = -1;
  groups.splice(groups.indexOf(findGroup(300)), 1);
  calls.create.length = 0;

  chrome.tabGroups.onRemoved.fire({
    id: 300,
    windowId: 1,
    title: "Alpha",
    color: "blue",
    collapsed: false,
  });
  await sleep(1200);

  assert.equal(calls.create.length, 0, "no blank group is created");
  assert.equal(
    groups.filter((group) => group.title === "Alpha").length,
    1,
    "only the saved group remains",
  );
  assert.equal(findTab(4).groupId, 400, "surviving tab joins the saved group");
  assert.equal(findTab(8).active, true, "saved group gets focus");
  assert.equal(findGroup(400).collapsed, false, "saved group is expanded");
});
