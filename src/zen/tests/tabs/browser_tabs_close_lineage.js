/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Closing the selected tab goes through the tabs it opened, then the tabs
// its opener opened after it, then back to the opener.

function openFrom(opener, n) {
  gBrowser.selectedTab = opener;
  return BrowserTestUtils.addTab(gBrowser, `data:text/plain,${n}`, {
    relatedToCurrent: true,
    inBackground: true,
  });
}

function closeSelected() {
  gBrowser.removeTab(gBrowser.selectedTab);
  return gBrowser.selectedTab;
}

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.tabs.select-by-opener-on-close", true]],
  });
});

add_task(async function test_closing_the_opener_goes_to_its_oldest_tab() {
  const parent = BrowserTestUtils.addTab(gBrowser, "data:text/plain,parent");
  const [first, second, third] = [1, 2, 3].map(n => openFrom(parent, n));
  // Used most recently, which must not matter.
  gBrowser.selectedTab = third;
  gBrowser.selectedTab = parent;

  Assert.equal(closeSelected(), first, "Closing the opener: its oldest tab");
  Assert.equal(closeSelected(), second, "Then the next one it opened");
  Assert.equal(closeSelected(), third, "Then the next one");
  BrowserTestUtils.removeTab(third);
});

add_task(async function test_tree_order_and_back_to_the_opener() {
  const parent = BrowserTestUtils.addTab(gBrowser, "data:text/plain,parent");
  const first = openFrom(parent, 1);
  const second = openFrom(parent, 2);
  const grandchild = openFrom(first, "1.1");

  gBrowser.selectedTab = grandchild;
  Assert.equal(closeSelected(), first, "Back to the opener that is open");
  Assert.equal(closeSelected(), second, "Then the tab opened after it");
  Assert.equal(closeSelected(), parent, "Then their opener");
  BrowserTestUtils.removeTab(parent);
});

add_task(async function test_tabs_of_a_closed_opener_stay_siblings() {
  const parent = BrowserTestUtils.addTab(gBrowser, "data:text/plain,parent");
  const first = openFrom(parent, 1);
  const second = openFrom(parent, 2);
  const grandchild = openFrom(first, "1.1");
  gBrowser.selectedTab = first;

  Assert.equal(closeSelected(), grandchild, "The tab it opened");
  BrowserTestUtils.removeTab(parent);
  gBrowser.selectedTab = grandchild;
  Assert.equal(
    closeSelected(),
    second,
    "Past its closed opener, to the tab opened after that"
  );
  BrowserTestUtils.removeTab(second);
});

add_task(async function test_unrelated_tab_goes_to_the_newest() {
  const older = BrowserTestUtils.addTab(gBrowser, "data:text/plain,older");
  const closing = BrowserTestUtils.addTab(gBrowser, "data:text/plain,closing");
  const newest = BrowserTestUtils.addTab(gBrowser, "data:text/plain,newest");
  gBrowser.selectedTab = newest;
  gBrowser.selectedTab = older;
  gBrowser.selectedTab = closing;

  Assert.equal(closeSelected(), newest, "The most recently created tab");
  BrowserTestUtils.removeTab(older);
  BrowserTestUtils.removeTab(newest);
});
