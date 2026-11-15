import test from "node:test";
import assert from "node:assert/strict";

import { choosePinnedRestore, isPinnedTitle } from "../src/lib/pinned.js";

const PINNED = [
  { title: "A", color: "blue" },
  { title: "B", color: "grey" },
];

test("isPinnedTitle matches exactly and never on a missing title", () => {
  assert.equal(isPinnedTitle(PINNED, "A"), true);
  assert.equal(isPinnedTitle(PINNED, "B"), true);
  assert.equal(isPinnedTitle(PINNED, "a"), false);
  assert.equal(isPinnedTitle(PINNED, " A"), false);
  assert.equal(isPinnedTitle(PINNED, ""), false);
  assert.equal(isPinnedTitle(PINNED, undefined), false);
  assert.equal(isPinnedTitle([], "A"), false);
});

test("choosePinnedRestore skips when the window is closing", () => {
  const snapshot = { windowId: 1, tabIds: [10, 11] };
  assert.deepEqual(
    choosePinnedRestore({
      aliveTabs: [{ id: 10, windowId: 1, groupId: -1 }],
      snapshot,
      closing: true,
      movedToOtherWindow: false,
    }),
    { mode: "skip", tabIds: [] },
  );
});

test("choosePinnedRestore skips when the group moved to another window", () => {
  const snapshot = { windowId: 1, tabIds: [10] };
  assert.deepEqual(
    choosePinnedRestore({
      aliveTabs: [{ id: 10, windowId: 1, groupId: -1 }],
      snapshot,
      closing: false,
      movedToOtherWindow: true,
    }),
    { mode: "skip", tabIds: [] },
  );
});

test("choosePinnedRestore regroups surviving ungrouped tabs in place", () => {
  const snapshot = { windowId: 1, tabIds: [10, 11, 12] };
  assert.deepEqual(
    choosePinnedRestore({
      aliveTabs: [
        { id: 10, windowId: 1, groupId: -1 },
        { id: 11, windowId: 1, groupId: 5 },
        { id: 12, windowId: 2, groupId: -1 },
      ],
      snapshot,
      closing: false,
      movedToOtherWindow: false,
    }),
    { mode: "regroup", tabIds: [10] },
  );
});

test("choosePinnedRestore creates a blank tab when nothing alive remains", () => {
  const snapshot = { windowId: 1, tabIds: [10, 11] };
  assert.deepEqual(
    choosePinnedRestore({
      aliveTabs: [],
      snapshot,
      closing: false,
      movedToOtherWindow: false,
    }),
    { mode: "blank", tabIds: [] },
  );
});

test("choosePinnedRestore does not steal tabs that belong to other groups", () => {
  const snapshot = { windowId: 1, tabIds: [10, 11] };
  assert.deepEqual(
    choosePinnedRestore({
      aliveTabs: [
        { id: 10, windowId: 1, groupId: 4 },
        { id: 11, windowId: 1, groupId: 5 },
      ],
      snapshot,
      closing: false,
      movedToOtherWindow: false,
    }),
    { mode: "blank", tabIds: [] },
  );
});
