/* Any copyright is dedicated to the Public Domain.
   https://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// An essential can be set to open as a pop-up over the current view, or in a
// split with the current tab, instead of replacing it.

async function addEssential(n, view) {
  const tab = await addTabTo(gBrowser, getUrlForNthTab(n));
  gZenPinnedTabManager.addToEssentials(tab);
  gZenEssentialViews.setSettings(tab, view);
  return tab;
}

function containerOf(tab) {
  return tab.linkedBrowser.closest(".browserSidebarContainer");
}

async function select(tab) {
  if (gBrowser.selectedTab === tab) {
    return;
  }
  await BrowserTestUtils.switchTab(gBrowser, tab);
}

async function cleanUp(tabs) {
  for (const tab of tabs) {
    if (tab.isConnected && !tab.closing) {
      gZenEssentialViews.close(tab);
      await BrowserTestUtils.removeTab(tab);
    }
  }
}

add_task(async function test_popup_floats_over_the_current_tab() {
  const essential = await addEssential(1, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  const innerWindowID = essential.linkedBrowser.innerWindowID;

  await select(essential);
  ok(gZenEssentialViews.isPopup(essential), "The essential opened as a pop-up");
  ok(
    containerOf(essential).hasAttribute("zen-essential-popup"),
    "Its panel floats"
  );
  ok(
    containerOf(anchor).hasAttribute("zen-essential-popup-background"),
    "The tab it was opened over stays visible"
  );
  Assert.equal(
    essential.linkedBrowser.innerWindowID,
    innerWindowID,
    "The essential kept its page"
  );

  await select(anchor);
  ok(!gZenEssentialViews.isPopup(essential), "Selecting elsewhere closes it");
  ok(
    !containerOf(essential).hasAttribute("zen-essential-popup"),
    "Its panel no longer floats"
  );
  ok(
    !containerOf(anchor).hasAttribute("zen-essential-popup-background"),
    "The tab it was opened over is a normal tab again"
  );

  await cleanUp([anchor, essential]);
});

add_task(async function test_selection_goes_where_the_user_asked() {
  const essential = await addEssential(1, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  const other = await addTabTo(gBrowser, getUrlForNthTab(3));
  await select(anchor);
  await select(essential);

  await select(other);
  Assert.equal(gBrowser.selectedTab, other, "The chosen tab is selected");
  ok(!gZenEssentialViews.isPopup(essential), "The pop-up closed");
  ok(
    !containerOf(anchor).hasAttribute("zen-essential-popup-background"),
    "The tab it was opened over is hidden again"
  );
  ok(!anchor.linkedBrowser.zenModeActive, "And no longer kept rendering");

  await cleanUp([anchor, other, essential]);
});

add_task(async function test_kept_open_popup_stays_while_using_other_tabs() {
  const essential = await addEssential(1, { mode: "popup", keepOpen: true });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  const other = await addTabTo(gBrowser, getUrlForNthTab(3));
  await select(anchor);
  await select(essential);

  await select(other);
  ok(gZenEssentialViews.isPopup(essential), "The pop-up stays open");
  ok(
    containerOf(essential).hasAttribute("zen-essential-popup"),
    "It is still shown over the selected tab"
  );
  for (const tab of [anchor, other]) {
    ok(
      !containerOf(tab).hasAttribute("zen-essential-popup-background"),
      "The selected tab is not dimmed as a background"
    );
  }
  Assert.equal(
    document.querySelectorAll("#tabbrowser-tabpanels > .deck-selected").length,
    1,
    "Only the selected tab is the selected panel"
  );

  // Back to the tab it was first opened over: not dimmed either.
  await select(anchor);
  ok(
    !containerOf(anchor).hasAttribute("zen-essential-popup-background"),
    "The selected anchor is not dimmed"
  );

  gZenEssentialViews.close(essential);
  ok(
    !containerOf(essential).hasAttribute("zen-essential-popup"),
    "Closing it hides it"
  );

  await cleanUp([anchor, other, essential]);
});

add_task(async function test_close_button_returns_to_the_anchor() {
  const essential = await addEssential(1, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);

  containerOf(essential)
    .querySelector('.zen-essential-popup-controls [data-action="close"]')
    .doCommand();
  Assert.equal(gBrowser.selectedTab, anchor, "The anchor is selected again");
  ok(!gZenEssentialViews.isPopup(essential), "The pop-up closed");

  await cleanUp([anchor, essential]);
});

add_task(async function test_split_mode_is_temporary_and_unsaved() {
  const essential = await addEssential(1, { mode: "split", splitShare: 0.4 });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  const other = await addTabTo(gBrowser, getUrlForNthTab(3));
  const tabCount = gBrowser.tabs.length;
  await select(anchor);

  await select(essential);
  const split = gZenEssentialViews.getTemporarySplit(essential);
  ok(split, "The essential opened in a split");
  Assert.deepEqual(split.tabs, [essential, anchor], "Essential on the left");
  Assert.equal(split.layoutTree.children[0].sizeInParent, 40, "At its width");
  Assert.equal(gBrowser.tabs.length, tabCount, "No tab was duplicated");
  ok(!anchor.group, "No tab group was created");
  ok(
    !gZenViewSplitter
      .storeDataForSessionStore()
      .some(entry => entry.tabs.includes(essential.id)),
    "The temporary split is not saved"
  );

  // Resizing is remembered when the split goes away.
  split.layoutTree.children[0].sizeInParent = 30;
  split.layoutTree.children[1].sizeInParent = 70;
  await select(other);
  ok(!gZenViewSplitter.getSplitForTab(essential), "Leaving dissolves it");
  Assert.equal(
    gZenEssentialViews.getSettings(essential).splitShare,
    0.3,
    "The new width is remembered"
  );

  await cleanUp([anchor, other, essential]);
});

add_task(async function test_locked_split_cant_be_resized() {
  const essential = await addEssential(1, { mode: "split", locked: true });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);

  const splitters = gZenViewSplitter.overlay.querySelectorAll(
    ".zen-split-view-splitter"
  );
  ok(splitters.length, "The split has a splitter");
  ok(
    [...splitters].every(splitter => splitter.hasAttribute("locked")),
    "Its splitters are locked"
  );

  await cleanUp([anchor, essential]);
});

add_task(async function test_split_mode_falls_back_to_popup_over_a_split() {
  const essential = await addEssential(1, { mode: "split" });
  const tabs = await Promise.all([
    addTabTo(gBrowser, getUrlForNthTab(2)),
    addTabTo(gBrowser, getUrlForNthTab(3)),
  ]);
  // Creating the split selects its first tab.
  await createSplitView(tabs, "vsep");
  Assert.equal(gBrowser.selectedTab, tabs[0], "The split is shown");

  await select(essential);
  ok(gZenEssentialViews.isPopup(essential), "It opened as a pop-up instead");
  Assert.equal(
    gZenViewSplitter.currentView,
    gZenViewSplitter._data.indexOf(gZenViewSplitter.getSplitForTab(tabs[0])),
    "The split underneath stays shown"
  );
  Assert.equal(
    gZenEssentialViews.getSettings(essential).mode,
    "split",
    "The fallback does not change its setting"
  );

  await cleanUp([...tabs, essential]);
});

add_task(async function test_behavior_menu_shows_for_essentials_only() {
  const essential = await addEssential(1, { mode: "popup" });
  const normal = await addTabTo(gBrowser, getUrlForNthTab(2));
  const menu = document.getElementById("tabContextMenu");

  async function openMenuOn(tab) {
    const shown = BrowserTestUtils.waitForPopupEvent(menu, "shown");
    // Opened on the tab directly: a tab can sit under the sidebar's other
    // content in the test window, where a synthesized click misses it.
    const event = new Event("");
    tab.dispatchEvent(event);
    menu.openPopup(tab, "end_after", 0, 0, true, false, event);
    await shown;
    return document.getElementById("context_zen-essential-behavior");
  }
  async function closeMenu() {
    const hidden = BrowserTestUtils.waitForPopupEvent(menu, "hidden");
    menu.hidePopup();
    await hidden;
  }

  let item = await openMenuOn(essential);
  ok(!item.hidden, "Shown for an essential");
  Assert.equal(
    item.previousElementSibling.id,
    "context_zen-edit-pinned-page",
    "Next to the other essential settings"
  );
  ok(
    item.querySelector('[data-mode="popup"]').hasAttribute("checked"),
    "Its current mode is checked"
  );
  await closeMenu();

  item = await openMenuOn(normal);
  ok(item.hidden, "Hidden for a normal tab");
  await closeMenu();

  await cleanUp([normal, essential]);
});

add_task(async function test_clicking_the_open_essential_goes_back() {
  const tabEssential = await addEssential(1, { mode: "tab" });
  const popupEssential = await addEssential(2, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(3));
  await select(anchor);

  // Clicking an essential that isn't selected just opens it.
  EventUtils.synthesizeMouseAtCenter(tabEssential, {});
  await TestUtils.waitForCondition(() => tabEssential.selected, "Opened");
  // Clicking it again goes back.
  EventUtils.synthesizeMouseAtCenter(tabEssential, {});
  await TestUtils.waitForCondition(() => anchor.selected, "Back to the tab");

  EventUtils.synthesizeMouseAtCenter(popupEssential, {});
  await TestUtils.waitForCondition(
    () => gZenEssentialViews.isPopup(popupEssential),
    "The pop-up opened"
  );
  EventUtils.synthesizeMouseAtCenter(popupEssential, {});
  await TestUtils.waitForCondition(
    () => anchor.selected && !gZenEssentialViews.isPopup(popupEssential),
    "The pop-up closed and the tab is selected again"
  );

  await cleanUp([anchor, popupEssential, tabEssential]);
});

add_task(async function test_another_popup_replaces_the_open_one() {
  // Kept open, so only replacement can close it.
  const first = await addEssential(1, { mode: "popup", keepOpen: true });
  const second = await addEssential(2, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(3));
  await select(anchor);
  await select(first);

  await select(second);
  ok(gZenEssentialViews.isPopup(second), "The second essential is a pop-up");
  ok(!gZenEssentialViews.isPopup(first), "The first one closed");
  ok(
    !containerOf(first).hasAttribute("zen-essential-popup"),
    "Its panel no longer floats"
  );
  ok(
    containerOf(anchor).hasAttribute("zen-essential-popup-background"),
    "It floats over the same tab, not over the first pop-up"
  );

  await select(first);
  ok(gZenEssentialViews.isPopup(first), "Switching back toggles again");
  ok(!gZenEssentialViews.isPopup(second), "The second one closed");
  ok(
    containerOf(anchor).hasAttribute("zen-essential-popup-background"),
    "Still over the same tab"
  );

  await cleanUp([anchor, first, second]);
});

add_task(async function test_clicking_a_shown_split_essential_closes_it() {
  const essential = await addEssential(1, { mode: "split" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);
  // Working in the other side of the split.
  await select(anchor);
  ok(gZenEssentialViews.getTemporarySplit(essential), "The split stays");

  EventUtils.synthesizeMouseAtCenter(essential, {});
  await TestUtils.waitForCondition(
    () => !gZenEssentialViews.getTemporarySplit(essential) && anchor.selected,
    "The split closed and the tab is selected"
  );

  await cleanUp([anchor, essential]);
});

add_task(async function test_clicking_a_kept_open_popup_closes_it() {
  const essential = await addEssential(1, { mode: "popup", keepOpen: true });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  const other = await addTabTo(gBrowser, getUrlForNthTab(3));
  await select(anchor);
  await select(essential);
  await select(other);
  ok(gZenEssentialViews.isPopup(essential), "Kept open over another tab");

  EventUtils.synthesizeMouseAtCenter(essential, {});
  await TestUtils.waitForCondition(
    () => !gZenEssentialViews.isPopup(essential) && other.selected,
    "The pop-up closed and the tab under it is selected"
  );

  await cleanUp([anchor, other, essential]);
});

add_task(async function test_remembered_popup_position_is_applied() {
  const essential = await addEssential(1, {
    mode: "popup",
    popupWidth: 0.5,
    popupX: 0.2,
    popupY: -0.1,
  });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);

  const container = containerOf(essential);
  Assert.equal(
    container.style.getPropertyValue("--zen-essential-popup-x"),
    "0.2",
    "The remembered horizontal offset is applied"
  );
  Assert.equal(
    container.style.getPropertyValue("--zen-essential-popup-y"),
    "-0.1",
    "The remembered vertical offset is applied"
  );
  const area = container.getBoundingClientRect();
  const popup = container
    .querySelector(".browserContainer")
    .getBoundingClientRect();
  Assert.lessOrEqual(popup.right, area.right + 1, "It fits in the view");
  ok(
    container.querySelector(".zen-essential-popup-grabber"),
    "It has a handle to move it"
  );

  await cleanUp([anchor, essential]);
});

add_task(async function test_unsplit_temporary_split_leaves_no_stale_layout() {
  const essential = await addEssential(1, { mode: "split" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  const other = await addTabTo(gBrowser, getUrlForNthTab(3));
  await select(anchor);
  await select(essential);
  ok(gZenEssentialViews.getTemporarySplit(essential), "Split open");

  // As the unsplit button on the pane does.
  gZenViewSplitter.removeTabFromGroup(essential);
  ok(!gZenEssentialViews.getTemporarySplit(essential), "It is forgotten");

  await select(anchor);
  await select(essential);
  ok(gZenEssentialViews.getTemporarySplit(essential), "It opens again");
  await select(other);
  ok(
    !gBrowser.tabpanels.hasAttribute("zen-split-view"),
    "Leaving it leaves no split layout behind"
  );

  await cleanUp([anchor, other, essential]);
});

add_task(async function test_expanding_a_popup_over_a_split_shows_it_alone() {
  const essential = await addEssential(1, { mode: "popup" });
  const tabs = await Promise.all([
    addTabTo(gBrowser, getUrlForNthTab(2)),
    addTabTo(gBrowser, getUrlForNthTab(3)),
  ]);
  await createSplitView(tabs, "vsep");
  await select(essential);
  ok(gZenEssentialViews.isPopup(essential), "Opened over the split");

  containerOf(essential)
    .querySelector('.zen-essential-popup-controls [data-action="expand"]')
    .doCommand();
  ok(!gZenEssentialViews.isPopup(essential), "No longer a pop-up");
  Assert.equal(gBrowser.selectedTab, essential, "Still selected");
  Assert.equal(gZenViewSplitter.currentView, -1, "The split is put away");
  ok(
    !gBrowser.tabpanels.hasAttribute("zen-split-view"),
    "The essential gets the whole view"
  );

  await cleanUp([...tabs, essential]);
});

add_task(async function test_double_click_does_not_bounce_back() {
  const essential = await addEssential(1, { mode: "tab" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);

  EventUtils.synthesizeMouseAtCenter(essential, { clickCount: 1 });
  EventUtils.synthesizeMouseAtCenter(essential, { clickCount: 2 });
  await TestUtils.waitForCondition(() => essential.selected, "Opened");
  await new Promise(r => setTimeout(r, 100));
  ok(essential.selected, "A double-click leaves it open");

  await cleanUp([anchor, essential]);
});

add_task(async function test_unloading_the_anchor_closes_the_popup() {
  const essential = await addEssential(1, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);

  await gBrowser.explicitUnloadTabs([anchor]);
  ok(!gZenEssentialViews.isPopup(essential), "The pop-up closed");
  ok(
    !containerOf(essential).hasAttribute("zen-essential-popup"),
    "The essential is shown as a normal tab"
  );

  await cleanUp([anchor, essential]);
});

add_task(async function test_escape_in_the_page_closes_the_popup() {
  const essential = await addEssential(1, { mode: "popup" });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);
  ok(gZenEssentialViews.isPopup(essential), "The pop-up opened");

  // A real key press in the page; the page itself has no focused field.
  essential.linkedBrowser.focus();
  await SpecialPowers.spawn(essential.linkedBrowser, [], async () => {
    await ContentTaskUtils.waitForCondition(
      () => content.document.hasFocus(),
      "The page has focus"
    );
  });
  EventUtils.synthesizeKey("KEY_Escape");
  await TestUtils.waitForCondition(
    () => !gZenEssentialViews.isPopup(essential),
    "Escape closed the pop-up"
  );
  Assert.equal(gBrowser.selectedTab, anchor, "Back to the tab behind");

  await cleanUp([anchor, essential]);
});

add_task(async function test_move_handle_stays_reachable_at_the_top() {
  // Pop-up pushed against the top of the view.
  const essential = await addEssential(1, {
    mode: "popup",
    popupHeight: 0.6,
    popupY: -0.2,
  });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);

  const container = containerOf(essential);
  ok(
    container.hasAttribute("grabber-inside"),
    "The handle moves inside the pop-up"
  );
  const grabber = container.querySelector(".zen-essential-popup-grabber");
  const rect = grabber.getBoundingClientRect();
  ok(
    grabber.contains(
      document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      )
    ),
    "Nothing covers the handle"
  );

  gZenEssentialViews.setSettings(essential, { popupY: 0 });
  ok(
    !container.hasAttribute("grabber-inside"),
    "With room above, it goes back above the pop-up"
  );

  await cleanUp([anchor, essential]);
});

add_task(async function test_resize_keeps_growing_past_a_held_edge() {
  // Pop-up whose left edge is at the left of the view.
  const essential = await addEssential(1, {
    mode: "popup",
    popupWidth: 0.4,
    popupHeight: 0.5,
    popupX: -0.3,
  });
  const anchor = await addTabTo(gBrowser, getUrlForNthTab(2));
  await select(anchor);
  await select(essential);

  const container = containerOf(essential);
  const view = container.getBoundingClientRect();
  const resizer = container.querySelector(".zen-essential-popup-resizer");
  const dx = view.width * 0.2;
  const box = resizer.getBoundingClientRect();
  EventUtils.synthesizeMouseAtCenter(resizer, { type: "mousedown" });
  EventUtils.synthesizeMouse(resizer, box.width / 2 + dx, box.height / 2, {
    type: "mousemove",
  });
  EventUtils.synthesizeMouse(resizer, box.width / 2 + dx, box.height / 2, {
    type: "mouseup",
  });

  const settings = gZenEssentialViews.getSettings(essential);
  Assert.greater(settings.popupWidth, 0.5, "It grew to the right");
  Assert.less(
    Math.abs(settings.popupX - (settings.popupWidth / 2 - 0.5)),
    0.01,
    "Its left edge stayed at the left of the view"
  );

  await cleanUp([anchor, essential]);
});
