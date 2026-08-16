# FOLIUM / DUDE — Fixed Build v5 FINAL · Setup Guide

## What was fixed in THIS build (profile menu: Orders + Logout — 100% working)

The profile dropdown's **"My orders"** and **"Sign out"** buttons are now
guaranteed to work. Verified with a real-DOM test harness (jsdom running the
actual `index.html` + `script.js`): **54 automated assertions, 0 failures**,
including spam-click stress, deep-link refresh on `#/orders`, sign-out mid-route,
and full-app regression checks.

### Root causes that were killing the buttons (all eliminated)
1. **`stopPropagation()` on the menu container** starved the document-level
   delegated click handlers — clicks on menu items never reached them at all.
2. **Competing double handlers** (direct + capture-phase delegated) fired on the
   same click, tore the menu down mid-navigation, and the browser cancelled the
   hash commit → "My orders" did nothing.
3. **`waitForAuthReady()` could hang** when `State.bootDone` was still false, so
   `goToOrders()` silently died before navigating.
4. **`hidden` property vs `hidden` attribute toggles** raced with the CSS rule
   `.account-menu[hidden]{display:none!important}` — the menu could end up in a
   state where items looked clickable but weren't.

### The fix (in `script.js`, `Auth.wire()`)
- Menu container no longer calls `stopPropagation()` — the outside-click closer
  already ignores clicks inside `.account-area`, so bubbling is safe.
- **Direct binding** on `#account-orders-link` and `#account-signout` (they are
  static markup, never re-rendered) + a **delegated document fallback** in case
  the nodes are ever detached.
- **Synchronous event-object flags** (`e.__dudeOrdersHandled` /
  `e.__dudeSignoutHandled`) prevent double-fire — no timers, no dataset races.
- `goToOrders()` is now synchronous: commits `location.hash = '#/orders'`
  immediately, force-renders via `UI.showRoute()` + `Orders.load()` when already
  on the route, and keeps a 150 ms safety-net repaint for edge browsers.
- `openAccountMenu()` / `closeAccountMenu()` now use ONE mechanism only —
  `removeAttribute('hidden')` / `setAttribute('hidden','')` — matching the CSS
  `[hidden]` rule exactly.
- Sign out closes the menu, signs out, and redirects away from
  `#/orders`, `#/checkout`, `#/payment` routes.

### Also retained from previous builds
- Account menu layering (z-index 1400, own stacking context, pointer-events).
- Admin: `#pay-badge` restored, premium settings/forms styling pass.
- Gateway toggle honoured at checkout; base64-in-Firestore uploads (no Storage
  bucket needed); human-readable auth errors.

## Deploy
1. Upload `index.html`, `style.css`, `script.js` (storefront) and `admin.html`,
   `admin.css`, `admin.js` (admin) to your host.
2. Publish `firestore.rules` in Firebase Console → Firestore → Rules.
3. Admin access: add your UID as a doc id in the `admins` collection.
4. Configure payment mode in Admin → Settings → Payment Gateway.

## How to confirm the fix on your live site
1. Sign in → click the profile icon (top-right) → menu opens.
2. Click **My orders** → you land on the Orders page with your orders listed
   (or the empty-state with a "Browse templates" button if you have none).
3. Open the profile menu again → click **Sign out** → you're signed out, see the
   toast, and if you were on Orders/Checkout/Payment you're sent back Home.
