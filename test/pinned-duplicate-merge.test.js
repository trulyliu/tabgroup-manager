// If a saved group is opened after the extension already recreated a pinned
// group, the two live groups must be merged and the emptied one must not be
// protected back into existence.

import test from "node:test";
import assert from "node:assert/strict";

import { clone, installFakeChrome, sleep } from "./fake-chrome.js";

const groups = [
  { id: 100, windowId: 1, title: "其他", color: "grey", collapsed: true },
  { id: 300, windowId: 1, title: "Alpha", color: "blue", collapsed: false },
  { id: 400, windowId: 1, title: "Alpha", color: "blue", collapsed: true },
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
    active: false,
    lastAccessed: 300,
    url: "https://example.com/recreated-blank",
  },
  {
    id: 8,
    windowId: 1,
    index: 2,
    groupId: 400,
    pinned: false,
    active: true,
    lastAccessed: 800,
    url: "https://example.com/saved-a",
  },
  {
    id: 9,
    windowId: 1,
    index: 3,
    groupId: 400,
    pinned: false,
    active: false,
    lastAccessed: 900,
    url: "https://example.com/saved-b",
  },
];

const env = installFakeChrome({
  groups,
  tabs,
  settings: { pinnedGroups: [{ title: "Alpha", color: "blue" }] },
});
const { chrome, calls, findGroup } = env;

await import("../src/background.js");
await sleep(600);

test("duplicate pinned groups merge into the group with more tabs", async () => {
  const alphaTabs = tabs.filter((tab) =>
    groups.some((group) => group.title === "Alpha" && group.id === tab.groupId),
  );
  assert.equal(new Set(alphaTabs.map((tab) => tab.groupId)).size, 1);
  assert.equal(alphaTabs.length, 3);
  assert.equal(alphaTabs.every((tab) => tab.groupId === 400), true, "saved group wins");

  const emptied = groups.find(
    (group) => group.title === "Alpha" && !tabs.some((tab) => tab.groupId === group.id),
  );
  assert.ok(emptied, "the recreated group was emptied by the merge");

  calls.create.length = 0;
  const before = groups.length;
  groups.splice(groups.indexOf(findGroup(emptied.id)), 1);
  chrome.tabGroups.onRemoved.fire(clone(emptied));
  await sleep(800);

  assert.equal(calls.create.length, 0, "pinned protection does not recreate it");
  assert.equal(groups.length, before - 1);
  assert.equal(groups.filter((group) => group.title === "Alpha").length, 1);
});
