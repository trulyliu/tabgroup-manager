import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_SETTINGS,
  HEADER_CLICK_ACTIONS,
  normalizeSettings,
} from "../src/lib/settings.js";

test("defaults to the collapse header action", () => {
  assert.equal(DEFAULT_SETTINGS.expandedGroupHeaderClick, "collapse");
  assert.equal(normalizeSettings(null).expandedGroupHeaderClick, "collapse");
});

test("keeps every supported header action", () => {
  for (const action of HEADER_CLICK_ACTIONS) {
    assert.equal(
      normalizeSettings({ expandedGroupHeaderClick: action }).expandedGroupHeaderClick,
      action,
    );
  }
  assert.deepEqual([...HEADER_CLICK_ACTIONS], ["newtab", "collapse", "noaction"]);
});

test("unknown header actions fall back to collapse", () => {
  assert.equal(
    normalizeSettings({ expandedGroupHeaderClick: "bogus" }).expandedGroupHeaderClick,
    "collapse",
  );
});

test("migrates the previous boolean header setting", () => {
  assert.equal(
    normalizeSettings({ collapseExpandedOnHeaderClick: false }).expandedGroupHeaderClick,
    "noaction",
  );
  assert.equal(
    normalizeSettings({ collapseExpandedOnHeaderClick: true }).expandedGroupHeaderClick,
    "collapse",
  );
});

test("drops the removed placeholder and boolean keys", () => {
  const settings = normalizeSettings({
    suppressCollapseNewTab: false,
    collapseExpandedOnHeaderClick: false,
  });
  assert.equal("suppressCollapseNewTab" in settings, false);
  assert.equal("collapseExpandedOnHeaderClick" in settings, false);
});

test("pinned groups are deduplicated by title and color, not title alone", () => {
  const pinned = normalizeSettings({
    pinnedGroups: [
      { title: "Default", color: "red" },
      { title: "Default", color: "blue" },
      { title: "Default", color: "red" },
    ],
  }).pinnedGroups;
  assert.deepEqual(pinned, [
    { title: "Default", color: "red" },
    { title: "Default", color: "blue" },
  ]);
});
