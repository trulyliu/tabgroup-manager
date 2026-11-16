// Regression: a drag-blocked pinned-group restore must not leak blank tabs.
//
// The bug: in blank mode the first attempt created a placeholder tab, grouping
// it failed with "user may be dragging", and the retry created a second blank
// tab; the first one stayed behind and was swept into the default group.

import test from "node:test";
import assert from "node:assert/strict";

import { DRAG_MESSAGE, closeTab, installFakeChrome, removeGroup, sleep } from "./fake-chrome.js";

const env = installFakeChrome({
  settings: {
    pinnedGroups: [
      { title: "Alpha", color: "blue" },
      { title: "Beta", color: "red" },
    ],
  },
  groups: [
    { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: false },
    { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: true },
    { id: 400, windowId: 1, title: "Beta", color: "red", collapsed: true },
  ],
  tabs: [
    { id: 1, windowId: 1, index: 0, groupId: 100, pinned: false, active: true, lastAccessed: 900, url: "https://example.com/a" },
    { id: 4, windowId: 1, index: 1, groupId: 300, pinned: false, active: false, lastAccessed: 300, url: "https://example.com/alpha" },
    { id: 5, windowId: 1, index: 2, groupId: 400, pinned: false, active: false, lastAccessed: 300, url: "https://example.com/beta" },
  ],
});
const { calls, failures } = env;

await import("../src/background.js");
await sleep(300);

const isBlankGroupCreate = (args) =>
  args.groupId == null &&
  args.tabIds.length === 1 &&
  env.tabs.find((tab) => tab.id === args.tabIds[0])?.url === "chrome://newtab/";

test("one drag failure: the retry reuses the first blank tab", async () => {
  failures.group.push({ match: isBlankGroupCreate, message: DRAG_MESSAGE });
  calls.create.length = 0;

  closeTab(env, 4);
  removeGroup(env, 300);
  await sleep(2000);

  assert.equal(calls.create.length, 1, "exactly one blank tab created");
  const alpha = env.groups.find((group) => group.title === "Alpha");
  assert.ok(alpha, "Alpha recreated");
  const blanks = env.tabs.filter((tab) => tab.url === "chrome://newtab/");
  assert.equal(blanks.length, 1);
  assert.equal(blanks[0].groupId, alpha.id);
});

test("persistent drag failure: no orphan blank tab is left behind", async () => {
  failures.group.push({ match: isBlankGroupCreate, message: DRAG_MESSAGE });
  failures.group.push({ match: isBlankGroupCreate, message: DRAG_MESSAGE });
  calls.create.length = 0;
  calls.remove.length = 0;

  closeTab(env, 5);
  removeGroup(env, 400);
  await sleep(2000);

  assert.equal(calls.create.length, 1, "the retry did not create a second tab");
  assert.equal(calls.remove.length, 1, "the ungroupable placeholder was closed");
  const defaultMembers = env.tabs.filter((tab) => tab.groupId === 100);
  assert.deepEqual(defaultMembers.map((tab) => tab.id), [1], "nothing leaked into the default group");
});
