<!--
   - This Source Code Form is subject to the terms of the Mozilla Public
   - License, v. 2.0. If a copy of the MPL was not distributed with this
   - file, You can obtain one at http://mozilla.org/MPL/2.0/.
   -->

# Zen Browser (unofficial fork)

[Zen Browser](https://github.com/zen-browser/desktop) with a few extra features. This is a personal fork, not affiliated with or supported by the Zen project; please report issues with these changes here, not upstream.

## Additions

- **Sidebar media video:** the playing video is shown in the sidebar media card, and moves to Picture-in-Picture when the window is hidden.
- **Essentials as a pop-up:** an essential can open as a pop-up over the current tab, as a live tab rather than a duplicate.
- **Essentials in a split view:** an essential can be split with other tabs without being duplicated.
- **One essential view at a time:** opening another essential as a pop-up or split replaces the one that is open, over the same tab; clicking the icon of an essential that is shown as a pop-up or split closes it.
- **Tabs opened from a folder stay in it:** a tab opened from a tab in a folder (or subfolder) goes right under that tab, after the tabs it opened before.
- **Closing a tab follows what it opened:** closing the selected tab goes to the oldest tab it opened, then to the tabs opened after it by the same tab, then to that tab; otherwise to the most recently created tab. Toggle in Settings > Tabs.

The branch `custom/daily` carries all of these on top of upstream `dev`. The first three also live on their own `feat/*` branches.

## Building

No binaries are published. Build from this fork by following Zen's [building guide](https://docs.zen-browser.app/guides/building) with this repository and the `custom/daily` branch checked out, rather than upstream.

## License

[MPL 2.0](./LICENSE), as upstream.
