/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

add_task(async function test_Owned_Tab_Inside_Folder() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.folders.owned-tabs-in-folder", true]],
  });
  const selectedTab = gBrowser.selectedTab;
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const folder = await gZenFolders.createFolder([tab], {
    renameFolder: false,
  });
  gBrowser.selectedTab = tab;
  const triggeringPrincipal =
    Services.scriptSecurityManager.getSystemPrincipal();
  gBrowser.addTab("https://example.com", {
    tabIndex: undefined,
    relatedToCurrent: true,
    ownerTab: tab,
    triggeringPrincipal,
  });

  Assert.equal(
    folder.tabs.length,
    3,
    "Folder contains the original tab and the two duplicated tabs"
  );

  /* eslint-disable mozilla/no-arbitrary-setTimeout */
  await new Promise(resolve => setTimeout(resolve, 100));

  for (const t of folder.tabs) {
    ok(t.pinned, "All tabs in the folder should be pinned");
  }

  gBrowser.selectedTab = selectedTab;
  await removeFolder(folder);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_Owned_Tab_Inside_Folder_Unpinned() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.folders.owned-tabs-in-folder", false]],
  });
  const selectedTab = gBrowser.selectedTab;
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const folder = await gZenFolders.createFolder([tab], {
    renameFolder: false,
  });
  gBrowser.selectedTab = tab;
  const triggeringPrincipal =
    Services.scriptSecurityManager.getSystemPrincipal();
  let newTab = gBrowser.addTab("https://example.com", {
    tabIndex: undefined,
    relatedToCurrent: true,
    ownerTab: tab,
    triggeringPrincipal,
  });

  Assert.equal(
    folder.tabs.length,
    2,
    "Folder contains the original tab and the two duplicated tabs"
  );

  ok(!newTab.group, "New tab should not be grouped");

  gBrowser.selectedTab = selectedTab;
  BrowserTestUtils.removeTab(newTab);
  await removeFolder(folder);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_Duplicate_Tab_Inside_Folder_Pref_Enabled() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.folders.owned-tabs-in-folder", true]],
  });
  const selectedTab = gBrowser.selectedTab;
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const folder = await gZenFolders.createFolder([tab], {
    renameFolder: false,
  });
  gBrowser.selectedTab = tab;

  const newTab = gBrowser.duplicateTab(tab);
  await BrowserTestUtils.waitForEvent(newTab, "SSTabRestored");

  Assert.equal(
    folder.tabs.length,
    3,
    "Folder contains its empty tab, original tab, and duplicated tab"
  );
  Assert.equal(newTab.group, folder, "Duplicated tab remains in the folder");

  gBrowser.selectedTab = selectedTab;
  await removeFolder(folder);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_Duplicate_Tab_Inside_Folder_Pref_Disabled() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.folders.owned-tabs-in-folder", false]],
  });
  const selectedTab = gBrowser.selectedTab;
  const tab = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const folder = await gZenFolders.createFolder([tab], {
    renameFolder: false,
  });
  gBrowser.selectedTab = tab;

  const newTab = gBrowser.duplicateTab(tab);
  await BrowserTestUtils.waitForEvent(newTab, "SSTabRestored");

  Assert.equal(
    folder.tabs.length,
    2,
    "Folder contains its empty tab and original tab"
  );
  ok(!newTab.group, "Duplicated tab remains outside the folder");

  gBrowser.selectedTab = selectedTab;
  BrowserTestUtils.removeTab(newTab);
  await removeFolder(folder);
  await SpecialPowers.popPrefEnv();
});

add_task(async function test_Owned_Tabs_Go_Under_Their_Opener() {
  await SpecialPowers.pushPrefEnv({
    set: [["zen.folders.owned-tabs-in-folder", true]],
  });
  const selectedTab = gBrowser.selectedTab;
  const opener = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const last = BrowserTestUtils.addTab(gBrowser, "about:blank");
  const folder = await gZenFolders.createFolder([opener, last], {
    renameFolder: false,
  });
  gBrowser.selectedTab = opener;
  const triggeringPrincipal =
    Services.scriptSecurityManager.getSystemPrincipal();
  const openTab = () =>
    gBrowser.addTab("https://example.com", {
      relatedToCurrent: true,
      inBackground: true,
      triggeringPrincipal,
    });
  const first = openTab();
  const second = openTab();

  Assert.deepEqual(
    folder.tabs.filter(tab => !tab.hasAttribute("zen-empty-tab")),
    [opener, first, second, last],
    "Opened tabs are right under their opener, in the order they opened"
  );

  gBrowser.selectedTab = selectedTab;
  await removeFolder(folder);
  await SpecialPowers.popPrefEnv();
});
