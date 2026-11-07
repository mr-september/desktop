// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

const VIEW_KEY = "zen-essential-view";
const MODES = Object.freeze(["tab", "popup", "split"]);
const DEFAULT_VIEW = Object.freeze({
  mode: "tab",
  popupWidth: 0.8,
  popupHeight: 0.85,
  // Offset of the pop-up's centre from the view's, as a share of its size.
  popupX: 0,
  popupY: 0,
  splitShare: 0.5,
  locked: false,
  keepOpen: false,
});
const MIN_POPUP_SIZE = 0.3;
const MIN_SPLIT_SHARE = 0.2;
const TOGGLE_PREF = "zen.tabs.essentials.toggle-on-click";
// Room the move handle needs above the pop-up, in pixels.
const GRABBER_MARGIN = 16;

/**
 * One axis of a resize from the pop-up's corner. The pop-up grows and
 * shrinks around its centre, but a side that reaches the edge of the view
 * stays there while the other side keeps going.
 *
 * @param {number} viewStart - Where the view starts on this axis, in pixels.
 * @param {number} viewSize - The view's size on this axis, in pixels.
 * @param {number} center - The pop-up's centre when the drag started.
 * @param {number} pointer - Where the corner is dragged to.
 * @returns {{size: number, offset: number}} The pop-up's size, and its
 *   centre's offset from the view's, as shares of the view.
 */
function resizeAxis(viewStart, viewSize, center, pointer) {
  const viewEnd = viewStart + viewSize;
  const minSize = MIN_POPUP_SIZE * viewSize;
  const half = Math.max(pointer - center, minSize / 2);
  let start = Math.max(viewStart, center - half);
  let end = Math.min(viewEnd, center + half);
  if (end - start < minSize) {
    // Held at an edge while shrinking: keep the smallest size.
    if (start === viewStart) {
      end = Math.min(viewEnd, start + minSize);
    } else {
      start = Math.max(viewStart, end - minSize);
    }
  }
  return {
    size: (end - start) / viewSize,
    offset: ((start + end) / 2 - (viewStart + viewSize / 2)) / viewSize,
  };
}

/**
 * Lets an essential open as a pop-up floating over the current view, or in
 * a split with the current tab, instead of replacing the view. The essential
 * stays one live tab throughout.
 *
 * Each essential's settings are stored with the tab (SessionStore custom
 * value) and synced between windows by ZenWindowSync. What is shown right now
 * is runtime state here, and never rewrites the settings.
 */
class nsZenEssentialViews extends nsZenDOMOperatedFeature {
  /** The open pop-up: `{ tab, anchor }`, or null. */
  #popup = null;
  /** The panel shown under the selected pop-up, or null. */
  #background = null;
  /** Temporary splits by essential: `{ split, anchor }`. */
  #splits = new Map();
  /** Set while this class itself changes the selected tab. */
  #selecting = false;
  /** The tab each essential was opened from, to return to on a click. */
  #returnTo = new WeakMap();
  /** The essential that was already selected when the mouse went down. */
  #pressedSelectedEssential = null;

  init() {
    // Capturing, so the view is set up before split view reacts to the
    // selection.
    window.addEventListener("TabSelect", this, { capture: true });
    window.addEventListener("TabClose", this);
    window.addEventListener("TabRemovedFromEssentials", this);
    window.addEventListener("TabBrowserDiscarded", this);
    window.addEventListener("ZenEssentialViewChanged", this);
    window.addEventListener("ZenTemporarySplitRemoved", this);
    // Essentials live outside the tab strip. Capturing, to see the press
    // before the pressed tab gets selected.
    window.addEventListener("mousedown", this, { capture: true });
    window.addEventListener("click", this, { capture: true });
  }

  handleEvent(event) {
    switch (event.type) {
      case "TabSelect":
        this.#onTabSelect(event.target, event.detail?.previousTab);
        break;
      case "TabClose":
        this.#onTabClose(event.target);
        break;
      case "TabRemovedFromEssentials":
        this.close(event.target);
        break;
      case "TabBrowserDiscarded":
        this.#onTabDiscarded(event.target);
        break;
      case "ZenEssentialViewChanged":
        this.refresh(event.target);
        break;
      case "ZenTemporarySplitRemoved":
        for (const [tab, { split }] of this.#splits) {
          if (split === event.detail.split) {
            this.#splits.delete(tab);
          }
        }
        break;
      case "mousedown":
        this.#pressedSelectedEssential = this.#clickedEssential(event, true);
        break;
      case "click": {
        const tab = this.#clickedEssential(event, false);
        if (tab && tab === this.#pressedSelectedEssential) {
          this.#toggleBack(tab);
        }
        this.#pressedSelectedEssential = null;
        break;
      }
    }
  }

  /* Mark: clicking an open essential */

  /**
   * @param {MouseEvent} event
   * @param {boolean} mustBeSelected - Only count an essential that is
   *   already selected.
   * @returns {Tab|null} The essential a plain left click landed on.
   */
  #clickedEssential(event, mustBeSelected) {
    if (
      event.button !== 0 ||
      // The second click of a double-click would undo the first.
      event.detail > 1 ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      !Services.prefs.getBoolPref(TOGGLE_PREF, true) ||
      event.target.closest?.(
        ".tab-close-button, .tab-icon-overlay, .tab-audio-button"
      )
    ) {
      return null;
    }
    const tab = event.target.closest?.(".tabbrowser-tab");
    if (!tab?.hasAttribute("zen-essential")) {
      return null;
    }
    return !mustBeSelected || tab.selected ? tab : null;
  }

  /**
   * Clicking the essential that is open goes back to where it was opened
   * from, in every mode.
   *
   * @param {Tab} tab - The selected essential.
   */
  #toggleBack(tab) {
    if (this.#popup?.tab === tab || this.#splits.has(tab)) {
      this.close(tab, { selectAnchor: true });
      return;
    }
    const target = this.#returnTo.get(tab);
    if (target?.isConnected && !target.closing && target !== tab) {
      gBrowser.selectedTab = target;
    }
  }

  /* Mark: settings */

  /**
   * @param {Tab} tab
   * @returns {object} The essential's view settings, with defaults filled in.
   */
  getSettings(tab) {
    let stored = {};
    try {
      stored = JSON.parse(
        SessionStore.getCustomTabValue(tab, VIEW_KEY) || "{}"
      );
    } catch {}
    const settings = { ...DEFAULT_VIEW, ...stored };
    if (!MODES.includes(settings.mode)) {
      settings.mode = DEFAULT_VIEW.mode;
    }
    return settings;
  }

  /**
   * @param {Tab} tab - An essential.
   * @param {object} changes - Settings to change.
   */
  setSettings(tab, changes) {
    if (!tab?.hasAttribute("zen-essential")) {
      return;
    }
    const settings = { ...this.getSettings(tab), ...changes };
    SessionStore.setCustomTabValue(tab, VIEW_KEY, JSON.stringify(settings));
    tab.dispatchEvent(
      new CustomEvent("ZenEssentialViewChanged", { bubbles: true })
    );
  }

  /**
   * Applies changed settings to an essential that is open. Also called by
   * window sync after copying settings from another window.
   *
   * @param {Tab} tab
   */
  refresh(tab) {
    const settings = this.getSettings(tab);
    if (this.#popup?.tab === tab) {
      const anchor = this.#popup.anchor;
      if (settings.mode === "tab") {
        this.close(tab);
      } else if (settings.mode === "split" && this.#canSplitWith(anchor)) {
        this.#openSplit(tab, anchor, settings);
      } else {
        // Also the fallback when split mode can't split with the anchor.
        this.#applyPopupState();
      }
    }
    const temporary = this.#splits.get(tab);
    if (temporary) {
      if (settings.mode !== "split") {
        this.close(tab);
      } else {
        temporary.split.locked = settings.locked;
        if (
          gZenViewSplitter.getSplitForTab(gBrowser.selectedTab) ===
          temporary.split
        ) {
          this.#lockSplitters(settings.locked);
        }
      }
    }
  }

  /* Mark: selection */

  /**
   * @param {Tab} tab
   * @returns {boolean} Whether the tab is being shown as a pop-up.
   */
  isPopup(tab) {
    return !!tab && this.#popup?.tab === tab;
  }

  /**
   * Escape pressed in a page. Closes the pop-up showing it, unless the
   * key was meant for a focused field.
   *
   * @param {Tab} tab - The tab whose page got the key.
   * @param {boolean} fieldFocused - Whether an element in the page has focus.
   * @returns {boolean} Whether the key closed a pop-up.
   */
  closeOnEscape(tab, fieldFocused) {
    if (
      !tab ||
      this.#popup?.tab !== tab ||
      gBrowser.selectedTab !== tab ||
      fieldFocused
    ) {
      return false;
    }
    this.close(tab, { selectAnchor: true });
    return true;
  }

  /**
   * @param {Tab} tab
   * @returns {object|null} The temporary split showing this essential.
   */
  getTemporarySplit(tab) {
    return this.#splits.get(tab)?.split ?? null;
  }

  #onTabSelect(tab, previousTab) {
    if (this.#selecting) {
      return;
    }
    this.#leaveViews(tab);
    if (
      tab.hasAttribute("zen-essential") &&
      this.#isValidAnchor(previousTab, tab) &&
      !previousTab.hasAttribute("zen-essential")
    ) {
      this.#returnTo.set(tab, previousTab);
    }

    const settings = tab.hasAttribute("zen-essential")
      ? this.getSettings(tab)
      : DEFAULT_VIEW;
    if (settings.mode === "tab" || !this.#isValidAnchor(previousTab, tab)) {
      return;
    }
    const split = gZenViewSplitter.getSplitForTab(tab);
    if (split && !split.temporary) {
      // A saved split the essential is part of wins over its mode.
      return;
    }
    if (this.#popup?.tab === tab || this.#splits.has(tab)) {
      // Showing it again over the view it was opened from, or over the tab
      // that is current now if it was kept open.
      this.#reopen(tab, previousTab, settings);
      return;
    }
    if (settings.mode === "split" && this.#canSplitWith(previousTab)) {
      this.#openSplit(tab, previousTab, settings);
    } else {
      this.#openPopup(tab, previousTab);
    }
  }

  /**
   * Closes what the newly selected tab leaves behind: navigation elsewhere
   * closes views that aren't kept open.
   *
   * @param {Tab} selected - The tab being selected.
   */
  #leaveViews(selected) {
    // A glance opened from inside a view belongs to that view.
    const target = gZenGlanceManager.getTabOrGlanceParent(selected);
    const popup = this.#popup;
    if (popup && popup.tab !== target) {
      const settings = this.getSettings(popup.tab);
      const visibleHere = this.#isVisibleInCurrentSpace(popup.tab);
      if (settings.keepOpen && visibleHere) {
        if (this.#isValidAnchor(target, popup.tab)) {
          popup.anchor = target;
        }
        this.#applyPopupState();
      } else {
        this.close(popup.tab);
      }
    }
    for (const [tab, { split }] of this.#splits) {
      if (split.tabs.includes(target)) {
        continue;
      }
      this.#rememberSplitShare(tab, split);
      if (!this.getSettings(tab).keepOpen) {
        this.close(tab);
      }
    }
  }

  #reopen(tab, previousTab, settings) {
    if (this.#popup?.tab === tab) {
      if (this.#popup.anchor !== previousTab) {
        this.#popup.anchor = previousTab;
      }
      this.#applyPopupState();
      return;
    }
    const { split } = this.#splits.get(tab);
    if (!gZenViewSplitter._data.includes(split)) {
      // Unsplit by other means meanwhile.
      this.#splits.delete(tab);
      this.#onTabSelect(tab, previousTab);
      return;
    }
    if (!split.tabs.includes(previousTab)) {
      // Kept open from another tab: show it with the current one instead.
      this.close(tab);
      this.#onTabSelect(tab, previousTab);
      return;
    }
    split.locked = settings.locked;
    gZenViewSplitter.activateSplitView(split);
  }

  #isValidAnchor(anchor, tab) {
    return (
      !!anchor &&
      anchor !== tab &&
      !anchor.closing &&
      !anchor.hasAttribute("zen-empty-tab") &&
      !anchor.hasAttribute("zen-glance-tab") &&
      // Not the tab of the space being left.
      this.#isVisibleInCurrentSpace(anchor)
    );
  }

  #canSplitWith(anchor) {
    return (
      !anchor.hasAttribute("zen-essential") &&
      !gZenViewSplitter.getSplitForTab(anchor)
    );
  }

  #isVisibleInCurrentSpace(tab) {
    if (!gZenWorkspaces.workspaceEnabled) {
      return true;
    }
    const space = gZenWorkspaces.getActiveWorkspaceFromCache();
    return (
      !space ||
      gZenWorkspaces._shouldShowTab(
        tab,
        space.uuid,
        space.containerTabId,
        gZenWorkspaces.getWorkspaces()
      )
    );
  }

  #onTabClose(tab) {
    if (this.#popup?.tab === tab || this.#splits.has(tab)) {
      this.close(tab);
      return;
    }
    if (this.#popup?.anchor === tab) {
      // Nothing left to float over.
      this.close(this.#popup.tab);
    }
    for (const [essential, { anchor }] of this.#splits) {
      if (anchor === tab) {
        this.close(essential);
      }
    }
  }

  #onTabDiscarded(tab) {
    if (this.#popup?.tab === tab || this.#popup?.anchor === tab) {
      this.close(this.#popup.tab);
    }
    for (const [essential, { anchor }] of this.#splits) {
      if (essential === tab || anchor === tab) {
        this.close(essential);
      }
    }
  }

  /**
   * Stops showing an essential as a pop-up or split. It stays selected if it
   * was, now as a normal tab.
   *
   * @param {Tab} tab - The essential.
   * @param {object} [options]
   * @param {boolean} [options.selectAnchor] - Select the tab it was opened
   *   over, if the essential is selected.
   */
  close(tab, { selectAnchor = false } = {}) {
    const popup = this.#popup?.tab === tab ? this.#popup : null;
    const temporary = this.#splits.get(tab);
    if (!popup && !temporary) {
      return;
    }
    const anchor = popup?.anchor ?? temporary.anchor;
    if (
      selectAnchor &&
      anchor?.isConnected &&
      !anchor.closing &&
      gBrowser.selectedTab === tab
    ) {
      // Before tearing down, so the anchor never stops rendering.
      this.#select(anchor);
    }
    if (popup) {
      this.#popup = null;
      this.#removePopupElements(tab);
    }
    if (temporary) {
      this.#rememberSplitShare(tab, temporary.split);
      this.#splits.delete(tab);
      gZenViewSplitter.removeSplit(temporary.split);
    }
    const selected = gBrowser.selectedTab;
    if (selected && !selected.closing) {
      // Brings split view in step with what is selected now, e.g. when a
      // pop-up floated over a split.
      gZenViewSplitter.onLocationChange(selected.linkedBrowser);
    }
  }

  #select(tab) {
    this.#selecting = true;
    try {
      gBrowser.selectedTab = tab;
    } finally {
      this.#selecting = false;
    }
  }

  /* Mark: pop-up */

  #openPopup(tab, anchor) {
    if (this.#popup) {
      this.close(this.#popup.tab);
    }
    this.#popup = { tab, anchor };
    this.#applyPopupState();
  }

  /**
   * Keeps the pop-up and the view under it visible and live. Run after every
   * selection change while a pop-up is open.
   */
  #applyPopupState() {
    const { tab, anchor } = this.#popup;
    const settings = this.getSettings(tab);
    const container = this.#containerOf(tab);
    if (!container.querySelector(".zen-essential-popup-controls")) {
      // First shown, or its panel was rebuilt (e.g. after unloading).
      container.setAttribute("zen-essential-popup", "true");
      this.#addPopupElements(tab);
    }
    container.style.setProperty(
      "--zen-essential-popup-width",
      `${settings.popupWidth * 100}%`
    );
    container.style.setProperty(
      "--zen-essential-popup-height",
      `${settings.popupHeight * 100}%`
    );
    container.style.setProperty("--zen-essential-popup-x", settings.popupX);
    container.style.setProperty("--zen-essential-popup-y", settings.popupY);
    container.toggleAttribute("locked", settings.locked);
    container.toggleAttribute("keep-open", settings.keepOpen);
    // Shown by its own attribute rather than as the selected panel, and kept
    // rendering while another tab is selected.
    tab.linkedBrowser.zenModeActive = true;
    tab.linkedBrowser.docShellIsActive = true;

    // The view underneath is shown only while the pop-up is selected;
    // otherwise the selected tab is the view.
    const background =
      gBrowser.selectedTab === tab ? this.#containerOf(anchor) : null;
    if (this.#background && this.#background !== background) {
      this.#releaseBackground();
    }
    if (background && this.#background !== background) {
      this.#background = background;
      background.setAttribute("zen-essential-popup-background", "true");
      anchor.linkedBrowser.zenModeActive = true;
      anchor.linkedBrowser.docShellIsActive = true;
      background.addEventListener("mousedown", this.#onBackgroundClick, {
        capture: true,
      });
    }
    this.#updatePopupButtons();
    this.#placeGrabber(container);
  }

  /**
   * Keeps the move handle where it can be grabbed: above the pop-up when
   * there is room, inside its top edge when the pop-up is at the top of the
   * view, where the toolbars would cover a handle above it.
   *
   * @param {Element} container - The pop-up's panel.
   */
  #placeGrabber(container) {
    const grabber = container.querySelector(".zen-essential-popup-grabber");
    if (!grabber) {
      return;
    }
    container.removeAttribute("grabber-inside");
    const view = container.getBoundingClientRect();
    const handle = grabber.getBoundingClientRect();
    const x = handle.left + handle.width / 2;
    const y = handle.top + handle.height / 2;
    const covered =
      handle.top < view.top + GRABBER_MARGIN ||
      !grabber.contains(document.elementFromPoint(x, y));
    container.toggleAttribute("grabber-inside", covered);
  }

  #onBackgroundClick = () => {
    const popup = this.#popup;
    if (popup && gBrowser.selectedTab === popup.tab) {
      gBrowser.selectedTab = popup.anchor;
    }
  };

  #releaseBackground() {
    const container = this.#background;
    this.#background = null;
    container.removeAttribute("zen-essential-popup-background");
    container.removeEventListener("mousedown", this.#onBackgroundClick, {
      capture: true,
    });
    const tab = gBrowser.getTabForBrowser(container.querySelector("browser"));
    if (!tab) {
      return;
    }
    tab.linkedBrowser.zenModeActive = false;
    if (gBrowser.selectedTab !== tab && !tab.splitView) {
      tab.linkedBrowser.docShellIsActive = false;
    }
  }

  #removePopupElements(tab) {
    const container = this.#containerOf(tab);
    if (container) {
      container.removeAttribute("zen-essential-popup");
      container.removeAttribute("locked");
      container.removeAttribute("keep-open");
      for (const element of container.querySelectorAll(
        ".zen-essential-popup-controls, .zen-essential-popup-resizer, .zen-essential-popup-grabber"
      )) {
        element.remove();
      }
      tab.linkedBrowser.zenModeActive = false;
      if (gBrowser.selectedTab !== tab) {
        tab.linkedBrowser.docShellIsActive = false;
      }
    }
    if (this.#background) {
      this.#releaseBackground();
    }
  }

  /**
   * Adds the buttons, the move handle and the resize corner. They go in the
   * pop-up itself, so they sit beside it wherever it is.
   *
   * @param {Tab} tab
   */
  #addPopupElements(tab) {
    const fragment = window.MozXULElement.parseXULToFragment(`
      <vbox class="zen-glance-sidebar-container zen-essential-popup-controls">
        <toolbarbutton class="no-squircles zen-glance-sidebar-close toolbarbutton-1"
                       data-action="close"
                       data-l10n-id="zen-essential-popup-close"/>
        <toolbarbutton class="no-squircles zen-glance-sidebar-open toolbarbutton-1"
                       data-action="expand"
                       data-l10n-id="zen-essential-popup-expand"/>
        <toolbarbutton class="no-squircles zen-glance-sidebar-split toolbarbutton-1"
                       data-action="split"
                       data-l10n-id="zen-essential-popup-split"/>
        <toolbarbutton class="no-squircles zen-essential-keep-open toolbarbutton-1"
                       data-action="keep-open"
                       type="checkbox"/>
        <toolbarbutton class="no-squircles zen-essential-lock toolbarbutton-1"
                       data-action="lock"
                       type="checkbox"/>
      </vbox>
    `);
    const controls = fragment.firstElementChild;
    controls.addEventListener("command", event => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      this.#onPopupAction(tab, action);
    });

    const browserContainer =
      this.#containerOf(tab).querySelector(".browserContainer");
    browserContainer.append(controls);
    const resizer = document.createElement("div");
    resizer.className = "zen-essential-popup-resizer";
    resizer.addEventListener("pointerdown", event =>
      this.#startPopupResize(tab, event)
    );
    const grabber = document.createElement("div");
    grabber.className = "zen-essential-popup-grabber";
    grabber.addEventListener("pointerdown", event =>
      this.#startPopupMove(tab, event)
    );
    browserContainer.append(resizer, grabber);
  }

  #updatePopupButtons() {
    const { tab } = this.#popup;
    const settings = this.getSettings(tab);
    const controls = this.#containerOf(tab).querySelector(
      ".zen-essential-popup-controls"
    );
    const keepOpen = controls.querySelector('[data-action="keep-open"]');
    keepOpen.checked = settings.keepOpen;
    document.l10n.setAttributes(keepOpen, "zen-essential-popup-keep-open", {
      on: settings.keepOpen ? "true" : "false",
    });
    const lock = controls.querySelector('[data-action="lock"]');
    lock.checked = settings.locked;
    document.l10n.setAttributes(lock, "zen-essential-popup-lock", {
      on: settings.locked ? "true" : "false",
    });
    controls
      .querySelector('[data-action="split"]')
      .toggleAttribute("disabled", settings.locked);
  }

  #onPopupAction(tab, action) {
    const settings = this.getSettings(tab);
    switch (action) {
      case "close":
        this.close(tab, { selectAnchor: true });
        break;
      case "expand":
        this.close(tab);
        break;
      case "split": {
        if (settings.locked) {
          break;
        }
        // Opens the split, or stays a pop-up if the view can't be split.
        this.setSettings(tab, { mode: "split" });
        break;
      }
      case "keep-open":
        this.setSettings(tab, { keepOpen: !settings.keepOpen });
        break;
      case "lock":
        this.setSettings(tab, { locked: !settings.locked });
        break;
    }
  }

  /**
   * Tracks a pointer drag on one of the pop-up's handles.
   *
   * @param {PointerEvent} event - The pointerdown on the handle.
   * @param {Function} onMove - Called with each pointermove.
   * @param {Function} onDone - Called once the pointer is released.
   */
  #trackDrag(event, onMove, onDone) {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const ends = ["pointerup", "pointercancel", "lostpointercapture"];
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      for (const type of ends) {
        handle.removeEventListener(type, onUp);
      }
      onDone();
    };
    handle.addEventListener("pointermove", onMove);
    for (const type of ends) {
      handle.addEventListener(type, onUp);
    }
  }

  #startPopupMove(tab, event) {
    const settings = this.getSettings(tab);
    if (settings.locked || event.button !== 0) {
      return;
    }
    const container = this.#containerOf(tab);
    const area = container.getBoundingClientRect();
    // The centre only goes as far as keeps the whole pop-up in the view.
    const maxX = (1 - settings.popupWidth) / 2;
    const maxY = (1 - settings.popupHeight) / 2;
    const clamp = (value, max) => Math.min(max, Math.max(-max, value));
    let x = settings.popupX;
    let y = settings.popupY;
    this.#trackDrag(
      event,
      moveEvent => {
        x = clamp(
          settings.popupX + (moveEvent.clientX - event.clientX) / area.width,
          maxX
        );
        y = clamp(
          settings.popupY + (moveEvent.clientY - event.clientY) / area.height,
          maxY
        );
        container.style.setProperty("--zen-essential-popup-x", x);
        container.style.setProperty("--zen-essential-popup-y", y);
        this.#placeGrabber(container);
      },
      () => this.setSettings(tab, { popupX: x, popupY: y })
    );
  }

  #startPopupResize(tab, event) {
    const settings = this.getSettings(tab);
    if (settings.locked || event.button !== 0) {
      return;
    }
    const container = this.#containerOf(tab);
    const area = container.getBoundingClientRect();
    const centerX = area.left + area.width * (0.5 + settings.popupX);
    const centerY = area.top + area.height * (0.5 + settings.popupY);
    let horizontal = null;
    let vertical = null;

    const onMove = moveEvent => {
      horizontal = resizeAxis(
        area.left,
        area.width,
        centerX,
        moveEvent.clientX
      );
      vertical = resizeAxis(area.top, area.height, centerY, moveEvent.clientY);
      container.style.setProperty(
        "--zen-essential-popup-width",
        `${horizontal.size * 100}%`
      );
      container.style.setProperty(
        "--zen-essential-popup-height",
        `${vertical.size * 100}%`
      );
      container.style.setProperty("--zen-essential-popup-x", horizontal.offset);
      container.style.setProperty("--zen-essential-popup-y", vertical.offset);
      this.#placeGrabber(container);
    };
    this.#trackDrag(event, onMove, () => {
      if (horizontal && vertical) {
        this.setSettings(tab, {
          popupWidth: horizontal.size,
          popupHeight: vertical.size,
          popupX: horizontal.offset,
          popupY: vertical.offset,
        });
      }
    });
  }

  /* Mark: split */

  #openSplit(tab, anchor, settings) {
    if (this.#popup?.tab === tab) {
      this.#popup = null;
      this.#removePopupElements(tab, anchor);
    }
    const split = gZenViewSplitter.showTemporarySplit(
      [tab, anchor],
      settings.splitShare,
      { locked: settings.locked }
    );
    this.#splits.set(tab, { split, anchor });
  }

  #lockSplitters(locked) {
    for (const splitter of gZenViewSplitter.overlay.querySelectorAll(
      ".zen-split-view-splitter"
    )) {
      splitter.toggleAttribute("locked", locked);
    }
  }

  #rememberSplitShare(tab, split) {
    const settings = this.getSettings(tab);
    if (settings.locked) {
      return;
    }
    const leaf = split.layoutTree?.children?.find(child => child.tab === tab);
    if (!leaf) {
      return;
    }
    const share = Math.min(
      1 - MIN_SPLIT_SHARE,
      Math.max(MIN_SPLIT_SHARE, leaf.sizeInParent / 100)
    );
    if (Math.abs(share - settings.splitShare) > 0.005) {
      this.setSettings(tab, { splitShare: share });
    }
  }

  /* Mark: context menu */

  #ensureContextMenu() {
    if (document.getElementById("context_zen-essential-behavior")) {
      return;
    }
    const fragment = window.MozXULElement.parseXULToFragment(`
      <menu id="context_zen-essential-behavior"
            data-l10n-id="tab-context-zen-essential-behavior"
            hidden="true">
        <menupopup id="context_zen-essential-behavior-popup">
          <menuitem type="radio" name="zen-essential-mode" data-mode="tab"
                    data-l10n-id="tab-context-zen-essential-open-as-tab"/>
          <menuitem type="radio" name="zen-essential-mode" data-mode="popup"
                    data-l10n-id="tab-context-zen-essential-open-as-popup"/>
          <menuitem type="radio" name="zen-essential-mode" data-mode="split"
                    data-l10n-id="tab-context-zen-essential-open-as-split"/>
          <menuseparator/>
          <menuitem type="checkbox" data-option="keepOpen"
                    data-l10n-id="tab-context-zen-essential-keep-open"/>
          <menuitem type="checkbox" data-option="locked"
                    data-l10n-id="tab-context-zen-essential-lock"/>
        </menupopup>
      </menu>
    `);
    const menu = fragment.firstElementChild;
    menu.addEventListener("command", event => {
      const tab = TabContextMenu.contextTab;
      const item = event.target;
      if (item.dataset.mode) {
        this.setSettings(tab, { mode: item.dataset.mode });
      } else if (item.dataset.option) {
        this.setSettings(tab, {
          [item.dataset.option]: item.hasAttribute("checked"),
        });
      }
    });
    // With the other settings of a pinned page, after "Edit Essential URL".
    const anchor =
      document.getElementById("context_zen-edit-pinned-page") ??
      document.getElementById("context_zen-pinned-tab-separator");
    if (anchor) {
      anchor.after(menu);
    } else {
      document.getElementById("tabContextMenu").append(menu);
    }
  }

  /**
   * Called with the other pinned-tab menu items, once the context tab is
   * known (ZenPinnedTabManager.updatePinnedTabContextMenu).
   *
   * @param {Tab} tab - The tab the menu is for.
   */
  updateContextMenu(tab) {
    this.#ensureContextMenu();
    const menu = document.getElementById("context_zen-essential-behavior");
    const isEssential =
      !!tab?.hasAttribute("zen-essential") && !tab.multiselected;
    menu.hidden = !isEssential;
    if (!isEssential) {
      return;
    }
    const settings = this.getSettings(tab);
    for (const item of menu.querySelectorAll("[data-mode]")) {
      item.toggleAttribute("checked", item.dataset.mode === settings.mode);
      item.toggleAttribute("disabled", settings.locked);
    }
    const keepOpen = menu.querySelector('[data-option="keepOpen"]');
    keepOpen.toggleAttribute("checked", settings.keepOpen);
    keepOpen.toggleAttribute("disabled", settings.mode === "tab");
    menu
      .querySelector('[data-option="locked"]')
      .toggleAttribute("checked", settings.locked);
  }

  /* Mark: helpers */

  #containerOf(tab) {
    return tab?.linkedBrowser?.closest(".browserSidebarContainer") ?? null;
  }
}

window.gZenEssentialViews = new nsZenEssentialViews();
