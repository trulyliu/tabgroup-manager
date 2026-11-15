import test from "node:test";
import assert from "node:assert/strict";

import { choosePinnedRestore, isPinnedGroup } from "../src/lib/pinned.js";

const PINNED = [
  { title: "A", color: "blue" },
  { title: "B", color: "grey" },
];

test("isPinnedGroup requires both exact title and color", () => {
  assert.equal(isPinnedGroup(PINNED, "A", "blue"), true);
  assert.equal(isPinnedGroup(PINNED, "B", "grey"), true);
  assert.equal(isPinnedGroup(PINNED, "A", "red"), false);
  assert.equal(isPinnedGroup(PINNED, "B", "blue"), false);
  assert.equal(isPinnedGroup(PINNED, "a", "blue"), false);
  assert.equal(isPinnedGroup(PINNED, " A", "blue"), false);
  assert.equal(isPinnedGroup(PINNED, "", "blue"), false);
  assert.equal(isPinnedGroup(PINNED, undefined, "blue"), false);
  assert.equal(isPinnedGroup([], "A", "blue"), false);
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
