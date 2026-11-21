// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import { nsZenDOMOperatedFeature } from "chrome://browser/content/zen-components/ZenCommonUtils.mjs";

const CREATED_KEY = "zen-tab-created";
const OPENER_KEY = "zen-tab-opener";

/**
 * Remembers the order tabs were created in and which tab opened which, so
 * closing a tab can go on through the tabs it opened.
 *
 * Each tab gets an id that is also its creation time, so ids sort in
 * creation order and a tab's opener always has a smaller id. Both are stored
 * with the tab (SessionStore custom values) and survive restarts. Closed tabs
 * keep their place in the tree for the rest of the session, so their
 * children are still siblings of each other.
 */
class nsZenTabLineage extends nsZenDOMOperatedFeature {
  #idByTab = new WeakMap();
  /** Open tabs by id. */
  #tabById = new Map();
  /** The opener's id of every tab seen in this window, closed ones included. */
  #openerById = new Map();
  /** Ids of the tabs each tab opened. */
  #childrenById = new Map();
  #lastId = 0;

  init() {
    window.addEventListener("TabOpen", this);
    window.addEventListener("SSTabRestoring", this);
    window.addEventListener("TabClose", this);
  }

  handleEvent(event) {
    const tab = event.target;
    switch (event.type) {
      case "TabOpen": {
        const openerTab = tab.openerTab;
        const openerId =
          openerTab && openerTab !== tab && !openerTab.closing
            ? this.idOf(openerTab)
            : undefined;
        this.#record(tab, this.#newId(), openerId);
        break;
      }
      case "SSTabRestoring":
        this.#onRestoring(tab);
        break;
      case "TabClose":
        if (this.#tabById.get(this.#idByTab.get(tab)) === tab) {
          this.#tabById.delete(this.#idByTab.get(tab));
        }
        break;
    }
  }

  /**
   * @param {Tab} tab
   * @returns {number} The tab's id, which is also when it was created.
   */
  idOf(tab) {
    let id = this.#idByTab.get(tab);
    if (id === undefined) {
      // A tab that was here before this window started tracking.
      id = this.#newId();
      this.#record(tab, id, undefined);
    }
    return id;
  }

  /**
   * The tab to select after closing the selected one: the first open tab
   * of the tree of tabs it opened, oldest first; then the same among the
   * tabs its opener opened after it; then its opener, and so on upwards;
   * otherwise the most recently created tab.
   *
   * @param {Tab} closedTab
   * @param {Tab[]} candidates - The tabs that can be selected.
   * @returns {Tab|null}
   */
  findTabToSelectOnClose(closedTab, candidates) {
    if (!candidates.length) {
      return null;
    }
    const openTabs = new Map(candidates.map(tab => [this.idOf(tab), tab]));
    const firstInTree = id => {
      for (const child of this.#childrenOf(id)) {
        const found = openTabs.get(child) ?? firstInTree(child);
        if (found) {
          return found;
        }
      }
      return null;
    };

    let node = this.idOf(closedTab);
    let found = firstInTree(node);
    while (!found && this.#openerById.has(node)) {
      const openerId = this.#openerById.get(node);
      for (const sibling of this.#childrenOf(openerId)) {
        if (sibling > node) {
          found = openTabs.get(sibling) ?? firstInTree(sibling);
          if (found) {
            break;
          }
        }
      }
      found ??= openTabs.get(openerId);
      node = openerId;
    }
    return (
      found ??
      candidates.reduce((newest, tab) =>
        this.idOf(tab) > this.idOf(newest) ? tab : newest
      )
    );
  }

  /**
   * @param {Tab} openerTab
   * @param {Function} [filter] - Which of its tabs to consider.
   * @returns {Tab|null} The open tab the given one most recently opened.
   */
  newestChild(openerTab, filter = () => true) {
    const children = this.#childrenOf(this.idOf(openerTab));
    for (let i = children.length - 1; i >= 0; i--) {
      const tab = this.#tabById.get(children[i]);
      if (tab && !tab.closing && filter(tab)) {
        return tab;
      }
    }
    return null;
  }

  #onRestoring(tab) {
    const storedId = Number(SessionStore.getCustomTabValue(tab, CREATED_KEY));
    const storedOpener = Number(
      SessionStore.getCustomTabValue(tab, OPENER_KEY)
    );
    const current = this.#idByTab.get(tab);
    const holder = this.#tabById.get(storedId);
    if (!storedId || (holder && holder !== tab)) {
      // Not tracked before, or a duplicate of an open tab, which counts as
      // opened by it.
      const id = current ?? this.#newId();
      this.#record(tab, id, storedId || this.#openerById.get(id));
      return;
    }
    if (current !== undefined && current !== storedId) {
      this.#forget(current);
      this.#tabById.delete(current);
    }
    this.#lastId = Math.max(this.#lastId, storedId);
    this.#record(tab, storedId, storedOpener || undefined);
  }

  #newId() {
    this.#lastId = Math.max(Date.now(), this.#lastId + 1);
    return this.#lastId;
  }

  #record(tab, id, openerId) {
    if (!(openerId < id)) {
      // Openers are always older; anything else would make a loop.
      openerId = undefined;
    }
    this.#forget(id);
    this.#idByTab.set(tab, id);
    this.#tabById.set(id, tab);
    if (openerId !== undefined) {
      this.#openerById.set(id, openerId);
      if (!this.#childrenById.has(openerId)) {
        this.#childrenById.set(openerId, new Set());
      }
      this.#childrenById.get(openerId).add(id);
    }
    SessionStore.setCustomTabValue(tab, CREATED_KEY, String(id));
    if (openerId !== undefined) {
      SessionStore.setCustomTabValue(tab, OPENER_KEY, String(openerId));
    } else {
      SessionStore.deleteCustomTabValue(tab, OPENER_KEY);
    }
  }

  /**
   * Drops the opener link of an id that is being given out again.
   *
   * @param {number} id - A tab id.
   */
  #forget(id) {
    const openerId = this.#openerById.get(id);
    if (openerId !== undefined) {
      this.#childrenById.get(openerId)?.delete(id);
      this.#openerById.delete(id);
    }
  }

  /**
   * @param {number} id - A tab id.
   * @returns {number[]} The ids of the tabs an id opened, oldest first.
   */
  #childrenOf(id) {
    return [...(this.#childrenById.get(id) ?? [])].sort((a, b) => a - b);
  }
}

window.gZenTabLineage = new nsZenTabLineage();
