/* ============================================================
   FOLIUM — Customer site (FIXED)
   All critical errors resolved:
   - Robust routing with proper initial view painting
   - Graceful degradation on missing/invalid data
   - Category selection & tab switching fixed
   - Order status timeline aligned with admin flow
   - Reviews, checkout, auth flow hardened
   - Safe URL handling, no XSS via DB content
   - Fallbacks for missing Firestore composite indexes
   ============================================================ */

// ==== SECTION: FIREBASE INIT ====
const firebaseConfig = {
  apiKey: "AIzaSyAGP9EXBU1HOK9Hm5q5SetXYqG2DjRdBr4",
  authDomain: "realtimedatabase-98181.firebaseapp.com",
  databaseURL: "https://realtimedatabase-98181-default-rtdb.firebaseio.com",
  projectId: "realtimedatabase-98181",
  storageBucket: "realtimedatabase-98181.appspot.com",
  messagingSenderId: "169892823409",
  appId: "1:169892823409:web:0a8052a7a1d57c4c4676d0",
  measurementId: "G-F8RVHR3C6Q"
};
try { firebase.initializeApp(firebaseConfig); } catch (e) { console.warn('Firebase already initialized', e); }
const auth = firebase.auth();
const db = firebase.firestore();
// OPTIONAL services — guarded so the app runs cleanly on the free Spark plan
// (no Cloud Storage bucket, no deployed Cloud Functions).
let storage = null;
try { storage = firebase.storage(); } catch (e) { console.warn('Storage unavailable (OK on free plan):', e); }
let functions = null;
try { functions = firebase.functions(); } catch (e) { console.warn('Functions unavailable (OK on free plan):', e); }

// ==== SECTION: UTILITIES ====
const Util = (() => {
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  const fmtINR = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(n) || 0);
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const safeUrl = (raw, fallback = '') => {
    if (!raw || typeof raw !== 'string') return fallback;
    try {
      const u = new URL(raw.trim(), window.location.origin);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
      return u.href;
    } catch { return fallback; }
  };
  const hostOf = (raw, fallback = 'preview.dude.dev') => {
    const u = safeUrl(raw);
    if (!u) return fallback;
    try { return new URL(u).host; } catch { return fallback; }
  };

  const toast = (msg, type = 'info') => {
    const stack = $('#toast-stack');
    if (!stack) return;
    const t = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
    stack.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; }, 3400);
    setTimeout(() => t.remove(), 3800);
  };
  const stars = (n) => {
    const r = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
    return '★★★★★☆☆☆☆☆'.slice(5 - r, 10 - r);
  };

  const friendlyError = e => {
    const m = (e && e.message) || String(e || '');
    if (/invalid.?credential|wrong-password|user-not-found/i.test(m)) return 'Invalid email or password.';
    if (/email-already-in-use/i.test(m)) return 'This email is already registered — try signing in.';
    if (/storage\/unauthorized|storage\/unauthenticated/i.test(m)) return 'File upload is unavailable right now. Please try again.';
    if (/index/i.test(m)) return 'A database index is still being built. Please try again shortly.';
    if (/permission|insufficient/i.test(m)) return 'You do not have permission to do that. Try signing in again.';
    if (/offline|network|unavailable|failed to get/i.test(m)) return 'Network problem. Check your connection and try again.';
    if (/not-found/i.test(m)) return 'The requested item was not found.';
    return 'Please try again in a moment.';
  };

  const errorBox = ({ title = 'Something went wrong', message = 'Please try again.', retryLabel = 'Try again', onRetry = null } = {}) => {
    const box = el('div', { class: 'error-state', role: 'alert' });
    box.appendChild(el('h3', {}, title));
    box.appendChild(el('p', {}, message));
    if (typeof onRetry === 'function') {
      const b = el('button', { type: 'button', class: 'btn btn-primary' }, retryLabel);
      b.addEventListener('click', onRetry);
      box.appendChild(b);
    }
    return box;
  };
  const showError = (container, opts, { replace = true } = {}) => {
    if (!container) return;
    const box = errorBox(opts);
    if (replace) { container.innerHTML = ''; container.appendChild(box); }
    else { container.querySelector('.error-state')?.remove(); container.prepend(box); }
  };

  // Read a File/Blob as a base64 data URL (Firestore-safe storage — no bucket needed).
  const fileToDataUrl = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

  // Downscale + re-encode an image to JPEG so it fits inside a Firestore document.
  const compressImage = (file, maxDim, quality) => new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.onerror = reject;
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas 2D context unavailable'));
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(blob => {
          if (!blob) return reject(new Error('Image compression failed (toBlob returned null)'));
          resolve(new File([blob], String(file.name || 'image').replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      } catch (err) { reject(err); }
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });

  return { $, $$, el, fmtINR, debounce, slug, safeUrl, hostOf, toast, stars, friendlyError, errorBox, showError, fileToDataUrl, compressImage };
})();

// ==== SECTION: STATE ====
const State = {
  user: null,
  isAdmin: false,
  categories: [],
  activeCategoryId: null,
  currentSort: 'featured',
  page: 0,
  pageSize: 12,
  currentTemplate: null,
  settings: null,
  customForm: [],
  bootDone: false
};

// ==== SECTION: DATA LAYER ====
const Data = (() => {
  const DEFAULT_SETTINGS = {
    brandName: 'DUDE',
    logoUrl: '',
    accentColor: '#8B5CF6',
    contact: { email: 'hello@dude.dev', phone: '+91 00000 00000', address: 'Bengaluru, India' },
    socialLinks: { twitter: '', github: '', linkedin: '' },
    legal: { terms: '', privacy: '', about: '' }
  };

  const loadSettings = async () => {
    try {
      const snap = await db.collection('settings').doc('site').get();
      State.settings = snap.exists ? { ...DEFAULT_SETTINGS, ...snap.data() } : { ...DEFAULT_SETTINGS };
    } catch (e) {
      console.error('Settings load failed, using defaults:', e);
      State.settings = { ...DEFAULT_SETTINGS };
    }
    return State.settings;
  };

  const loadCategories = async () => {
    try {
      // Try with orderBy first, fall back to unordered if index/field missing.
      let snap;
      try {
        snap = await db.collection('categories').where('isActive', '==', true).orderBy('order').get();
      } catch (idxErr) {
        console.warn('Ordered categories query failed, retrying unfiltered:', idxErr);
        snap = await db.collection('categories').get();
      }
      State.categories = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.isActive !== false)
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    } catch (e) {
      console.error('Categories load failed:', e);
      State.categories = [];
    }
    return State.categories;
  };

  // Build query with graceful fallbacks. Composite indexes may not exist yet
  // in fresh Firestore projects — we degrade to simpler queries rather than 500.
  const buildTemplatesQuery = (categoryId, sort) => {
    let q = db.collection('templates').where('isActive', '==', true).where('categoryId', '==', categoryId);
    switch (sort) {
      case 'price_asc':    q = q.orderBy('price', 'asc'); break;
      case 'price_desc':   q = q.orderBy('price', 'desc'); break;
      case 'rating_desc':  q = q.orderBy('rating.average', 'desc'); break;
      case 'featured':
      default:             q = q.orderBy('name', 'asc'); // simpler than isFeatured+name (avoids double index)
    }
    return q.limit(State.pageSize);
  };

  const loadTemplatesPage = async (categoryId, sort, cursor) => {
    if (!categoryId) return { items: [], cursor: null, end: true };
    try {
      let q = buildTemplatesQuery(categoryId, sort);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Client-side featured boost (avoids composite index requirement).
      if (sort === 'featured') {
        items = items.slice().sort((a, b) => (b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0));
      }
      return {
        items,
        cursor: snap.docs[snap.docs.length - 1] || null,
        end: snap.docs.length < State.pageSize
      };
    } catch (e) {
      // Final fallback: fetch by category only, sort in memory.
      console.warn('Template query failed, falling back to unsorted:', e);
      try {
        const snap = await db.collection('templates')
          .where('isActive', '==', true)
          .where('categoryId', '==', categoryId)
          .limit(50).get();
        let items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (sort === 'price_asc') items.sort((a, b) => (a.price || 0) - (b.price || 0));
        else if (sort === 'price_desc') items.sort((a, b) => (b.price || 0) - (a.price || 0));
        else if (sort === 'rating_desc') items.sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0));
        else items.sort((a, b) => ((b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0)) || String(a.name || '').localeCompare(String(b.name || '')));
        return { items: items.slice(0, State.pageSize), cursor: null, end: true };
      } catch (err2) {
        throw err2;
      }
    }
  };

  const getTemplate = async id => {
    if (!id) return null;
    const snap = await db.collection('templates').doc(id).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  };

  const getTemplatesBatch = async (ids = []) => {
    const unique = [...new Set(ids.filter(Boolean))];
    const result = {};
    if (!unique.length) return result;
    try {
      if (typeof db.getAll === 'function') {
        const snaps = await db.getAll(...unique.map(id => db.collection('templates').doc(id)));
        snaps.forEach(s => { if (s.exists) result[s.id] = { id: s.id, ...s.data() }; });
      } else {
        const snaps = await Promise.all(unique.map(id => db.collection('templates').doc(id).get().catch(() => null)));
        snaps.forEach(s => { if (s && s.exists) result[s.id] = { id: s.id, ...s.data() }; });
      }
    } catch (e) {
      console.error('Batch template lookup failed:', e);
    }
    return result;
  };

  const loadFormFields = async categoryId => {
    try {
      let snap;
      try {
        snap = await db.collection('customForms').where('enabled', '==', true).orderBy('order').get();
      } catch (idxErr) {
        console.warn('Ordered customForms failed, falling back:', idxErr);
        snap = await db.collection('customForms').get();
      }
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(f => f.enabled !== false && (f.appliesTo === 'all' || f.appliesTo === categoryId))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    } catch (e) {
      console.error('Form fields load failed:', e);
      return [];
    }
  };

  const loadReviewsFor = async (templateId, cap = 20) => {
    try {
      const snap = await db.collection('reviews')
        .where('templateId', '==', templateId)
        .where('status', '==', 'approved')
        .orderBy('createdAt', 'desc').limit(cap).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (idxErr) {
      console.warn('Reviews ordered query failed, falling back:', idxErr);
      try {
        const snap = await db.collection('reviews')
          .where('templateId', '==', templateId)
          .where('status', '==', 'approved')
          .limit(cap).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      } catch (e) {
        console.error('Reviews fallback failed:', e);
        return [];
      }
    }
  };

  const loadRecentReviews = async (cap = 6) => {
    try {
      const snap = await db.collection('reviews')
        .where('status', '==', 'approved')
        .orderBy('createdAt', 'desc').limit(cap).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    } catch (idxErr) {
      console.warn('Recent reviews ordered query failed:', idxErr);
      try {
        const snap = await db.collection('reviews').where('status', '==', 'approved').limit(cap * 2).get();
        return snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
          .slice(0, cap);
      } catch (e) {
        console.error('Recent reviews fallback failed:', e);
        return [];
      }
    }
  };

  const listenUserOrders = (uid, cb, errCb) => {
    try {
      return db.collection('orders').where('userId', '==', uid).orderBy('updatedAt', 'desc')
        .onSnapshot(
          snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
          err => {
            console.warn('Orders listener error, falling back to one-shot:', err);
            // Fallback: one-shot without orderBy
            db.collection('orders').where('userId', '==', uid).limit(50).get()
              .then(s => {
                const items = s.docs.map(d => ({ id: d.id, ...d.data() }))
                  .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
                cb(items);
              })
              .catch(e => { if (typeof errCb === 'function') errCb(e); });
          }
        );
    } catch (e) {
      if (typeof errCb === 'function') errCb(e);
      return () => {};
    }
  };

  const submitReview = async (templateId, rating, comment) => {
    const u = State.user;
    if (!u) throw new Error('Sign in to leave a review');
    await db.collection('reviews').add({
      templateId,
      userId: u.uid,
      userName: u.displayName || (u.email || '').split('@')[0] || 'Anonymous',
      rating: Math.max(1, Math.min(5, Math.round(Number(rating) || 0))),
      comment: String(comment || '').slice(0, 1200),
      status: 'pending',
      adminReply: '',
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  };

  const ensureUserDoc = async user => {
    if (!user || !user.uid) return;
    const ref = db.collection('users').doc(user.uid);
    const base = {
      name: user.displayName || '',
      email: user.email || '',
      phone: user.phoneNumber || '',
      photoURL: user.photoURL || ''
    };
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        await ref.set({
          ...base,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastLoginAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      } else {
        await ref.set({ ...base, lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
      }
    } catch (e) {
      console.error('ensureUserDoc failed (session continues):', e);
    }
  };

  const isAdmin = async uid => {
    if (!uid) return false;
    try {
      const snap = await db.collection('admins').doc(uid).get();
      return snap.exists;
    } catch (e) {
      console.error('Admin check failed (treated as non-admin):', e);
      return false;
    }
  };

  return {
    loadSettings, loadCategories, loadTemplatesPage, getTemplate, getTemplatesBatch,
    loadFormFields, loadReviewsFor, loadRecentReviews,
    listenUserOrders, submitReview, ensureUserDoc, isAdmin
  };
})();

// ==== SECTION: AUTH ====
const Auth = (() => {
  let authTab = 'signin';
  let lastFocus = null;

  const openModal = () => {
    lastFocus = document.activeElement;
    const m = Util.$('#auth-modal');
    const scrim = Util.$('#modal-scrim');
    if (!m || !scrim) return;
    m.hidden = false;
    scrim.hidden = false;
    const email = Util.$('#auth-modal input[name=email]');
    if (email) setTimeout(() => email.focus(), 50);
    document.body.style.overflow = 'hidden';
  };
  const closeAllModals = () => {
    Util.$$('.modal').forEach(m => m.hidden = true);
    const scrim = Util.$('#modal-scrim');
    if (scrim) scrim.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch {} }
    lastFocus = null;
  };

  const setTab = t => {
    authTab = t;
    Util.$$('.auth-tabs .tab-btn').forEach(b => {
      const on = b.dataset.authTab === t;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    Util.$$('[data-signup-only]').forEach(n => n.hidden = t !== 'signup');
    const submit = Util.$('#auth-submit');
    if (submit) submit.textContent = t === 'signup' ? 'Create account' : 'Sign in';
    const status = Util.$('#auth-status');
    if (status) status.textContent = '';
  };

  /* ============================================================
     Account menu — robust show/hide toggle (FIX)
     Click the account icon: if hidden → show, if visible → hide.
     Click outside the account area OR press Escape → hide.
     ============================================================ */
  const isMenuOpen = () => {
    const menu = Util.$('#account-menu');
    return !!(menu && !menu.hidden);
  };
  const openAccountMenu = () => {
    const menu = Util.$('#account-menu');
    if (!menu) return;
    // Single, reliable mechanism: toggle the [hidden] attribute. CSS rule
    // `.account-menu[hidden]{display:none!important}` is the single source of truth.
    menu.removeAttribute('hidden');
    Util.$('#auth-btn')?.setAttribute('aria-expanded', 'true');
  };
  const closeAccountMenu = () => {
    const menu = Util.$('#account-menu');
    if (!menu) return;
    menu.setAttribute('hidden', '');
    Util.$('#auth-btn')?.setAttribute('aria-expanded', 'false');
  };
  const toggleAccountMenu = () => {
    if (isMenuOpen()) closeAccountMenu();
    else openAccountMenu();
  };
  const paintAccount = () => {
    const u = State.user;
    const label = Util.$('#auth-btn .auth-label');
    const idBox = Util.$('#account-id');
    const btn = Util.$('#auth-btn');
    if (u) {
      const name = u.displayName || (u.email || '').split('@')[0] || 'Account';
      if (label) { label.textContent = name; label.hidden = false; }
      if (idBox) idBox.textContent = u.email || u.uid;
      btn?.setAttribute('aria-label', `Account — ${name}`);
      btn?.classList.add('is-authed');
    } else {
      if (label) { label.textContent = ''; label.hidden = true; }
      if (idBox) idBox.textContent = '';
      btn?.setAttribute('aria-label', 'Sign in');
      btn?.classList.remove('is-authed');
    }
    closeAccountMenu();
  };

  const wire = () => {
    /* Auth button click — toggle menu (if signed in) or open sign-in modal.
       stopPropagation prevents the document click handler from closing it right after opening. */
    Util.$('#auth-btn')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (State.user) {
        toggleAccountMenu();
      } else {
        closeAccountMenu();
        // Guaranteed modal open: clear any stuck [hidden]/inline display on the
        // auth modal + scrim before asking openModal() to show it.
        try {
          const m = Util.$('#auth-modal'), sc = Util.$('#modal-scrim');
          if (m) { m.hidden = false; m.removeAttribute('hidden'); m.style.removeProperty('display'); }
          if (sc) { sc.hidden = false; sc.removeAttribute('hidden'); }
        } catch (_) {}
        openModal();
        document.body.style.overflow = 'hidden';
      }
    });
    /* NOTE: the menu container deliberately does NOT stopPropagation.
       Doing so (older builds) starved the document-level delegated handlers
       below, so clicks on "My orders" / "Sign out" never reached them.
       The outside-click closer ignores clicks inside .account-area, so
       bubbling is safe. */

    /* ---- My Orders + Sign out (v6 FINAL — direct binding + flag-guarded
       delegated fallback) ----
       Root causes fixed across all previous builds:
       1. stopPropagation on the menu container blocked document delegation.
       2. Direct + capture-phase double handlers fired on the same click and
          tore the menu down mid-navigation (cancelled the hash commit).
       3. `hidden` property vs attribute toggles raced with
          .account-menu[hidden]{display:none!important}.
       Fix: bind directly to the two static menu items; keep a delegated
       document fallback; guard against double-fire with a synchronous
       event-object flag (no timers, no dataset races). */
    const forceOrdersRender = () => {
      try { UI.showRoute(); } catch (e) { console.error('Orders route render failed:', e); }
      // Guarantee the list paints even if the auth listener has not fired yet.
      try { Orders.load(); } catch (e) { console.error('Orders load failed:', e); }
    };

    const goToOrders = () => {
      closeAccountMenu();
      if (location.hash === '#/orders') {
        forceOrdersRender();
      } else {
        // Commit the route synchronously — the hashchange listener will render.
        location.hash = '#/orders';
        // Safety net: if hashchange didn't paint (edge browsers), force it.
        setTimeout(() => {
          const ov = Util.$('#orders-view');
          if (ov && ov.hidden) forceOrdersRender();
        }, 150);
      }
    };

    const doSignOut = async () => {
      closeAccountMenu();
      try {
        await auth.signOut();
        Util.toast('Signed out.', 'info');
        if (/^#\/(orders|checkout|payment)/.test(location.hash)) location.hash = '#/';
      } catch (err) {
        console.error('Sign-out failed:', err);
        Util.toast('Could not sign out. Please try again.', 'error');
      }
    };

    const onOrdersClick = e => {
      if (e.__dudeOrdersHandled) return;   // synchronous double-fire guard
      e.__dudeOrdersHandled = true;
      e.preventDefault();
      goToOrders();
    };
    // Primary: direct binding (the anchor is static markup, never re-rendered).
    Util.$('#account-orders-link')?.addEventListener('click', onOrdersClick);
    // Fallback: delegated, in case the anchor is ever detached/re-created.
    document.addEventListener('click', e => {
      const link = e.target && e.target.closest && e.target.closest('#account-orders-link');
      if (link) onOrdersClick(e);
    });

    const onSignoutClick = e => {
      if (e.__dudeSignoutHandled) return;  // synchronous double-fire guard
      e.__dudeSignoutHandled = true;
      e.preventDefault();
      doSignOut();
    };
    Util.$('#account-signout')?.addEventListener('click', onSignoutClick);
    document.addEventListener('click', e => {
      const btn = e.target && e.target.closest && e.target.closest('#account-signout');
      if (btn) onSignoutClick(e);
    });
    /* CLICK-FIX v10: CAPTURE-phase safety net for the two account-menu
       actions. Runs BEFORE any bubbling handler, so even if some overlay
       or future script stops propagation, 'My orders' / 'Sign out' still
       fire. Also handles touch taps on devices that synthesize odd clicks. */
    const menuActionFallback = e => {
      const t = e.target;
      if (!t || !t.closest) return;
      const orders = t.closest('#account-orders-link');
      const signout = t.closest('#account-signout');
      if (orders && !e.__dudeOrdersHandled) { e.__dudeOrdersHandled = true; e.preventDefault(); goToOrders(); }
      else if (signout && !e.__dudeSignoutHandled) { e.__dudeSignoutHandled = true; e.preventDefault(); doSignOut(); }
    };
    document.addEventListener('click', menuActionFallback, true);
    document.addEventListener('touchend', e => {
      const t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#account-orders-link') || t.closest('#account-signout')) menuActionFallback(e);
    }, { capture: true, passive: false });
    /* Outside click — hide the menu. Uses closest('.account-area') so
       clicks on the button or inside the menu do NOT close it here. */
    document.addEventListener('click', e => {
      // Only close on an actual outside click — never steal the click from
      // buttons inside the menu (sign out / my orders) and never interfere
      // with the auth button's own toggle (it calls stopPropagation anyway).
      if (!e.target.closest('.account-area')) closeAccountMenu();
    }, { passive: true });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { closeAccountMenu(); closeAllModals(); }
    });

    Util.$$('[data-close-modal]').forEach(b => b.addEventListener('click', closeAllModals));
    Util.$('#modal-scrim')?.addEventListener('click', closeAllModals);

    Util.$$('.auth-tabs .tab-btn').forEach(b => b.addEventListener('click', () => setTab(b.dataset.authTab)));

    Util.$('#auth-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');
      const name = String(fd.get('name') || '').trim();
      const status = Util.$('#auth-status');
      if (!email || !password) {
        if (status) { status.className = 'form-note err'; status.textContent = 'Email and password are required.'; }
        return;
      }
      if (status) { status.className = 'form-note'; status.textContent = 'Working…'; }
      const submitBtn = e.target.querySelector('button[type=submit]');
      if (submitBtn) submitBtn.disabled = true;
      try {
        if (authTab === 'signup') {
          const cred = await auth.createUserWithEmailAndPassword(email, password);
          if (name && cred.user) await cred.user.updateProfile({ displayName: name });
          await Data.ensureUserDoc(cred.user);
        } else {
          await auth.signInWithEmailAndPassword(email, password);
        }
        if (status) status.textContent = '';
        closeAllModals();
        Util.toast('Signed in.', 'success');
      } catch (err) {
        console.error('Auth error:', err);
        const code = String(err && err.code || '');
        let msg = String(err && err.message || 'Sign-in failed').replace('Firebase: ', '');
        if (/invalid-credential|wrong-password|user-not-found/.test(code)) msg = 'Invalid email or password.';
        else if (/email-already-in-use/.test(code)) msg = 'This email is already registered — try signing in.';
        else if (/weak-password/.test(code)) msg = 'Password must be at least 6 characters.';
        else if (/invalid-email/.test(code)) msg = 'Enter a valid email address.';
        else if (/too-many-requests/.test(code)) msg = 'Too many attempts. Please wait a minute and try again.';
        else if (/network-request-failed/.test(code)) msg = 'Network problem. Check your connection and try again.';
        if (status) {
          status.className = 'form-note err';
          status.textContent = msg;
        }
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    });

    Util.$('#google-signin')?.addEventListener('click', async () => {
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        const cred = await auth.signInWithPopup(provider);
        await Data.ensureUserDoc(cred.user);
        closeAllModals();
        Util.toast('Signed in with Google.', 'success');
      } catch (err) {
        console.error('Google sign-in error:', err);
        const code = String(err && err.code || '');
        if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return; // user just closed the popup
        Util.toast(String(err && err.message || 'Sign-in failed').replace('Firebase: ', ''), 'error');
      }
    });

    auth.onAuthStateChanged(async user => {
      try {
        State.user = user;
        State.bootDone = true;
        if (user) {
          State.isAdmin = await Data.isAdmin(user.uid);
          await Data.ensureUserDoc(user);
          const rf = Util.$('#review-form');
          if (rf) rf.hidden = false;
          Orders.startListening();
          // If the user is already on the orders route when auth resolves
          // (e.g. hard refresh on #/orders), repaint immediately so the
          // signed-out empty state doesn't linger.
          if (location.hash === '#/orders') {
            try { Orders.load(); } catch (e) { console.warn('Orders repaint on auth failed:', e); }
          }
        } else {
          State.isAdmin = false;
          const rf = Util.$('#review-form');
          if (rf) rf.hidden = true;
          Orders.stopListening();
        }
        paintAccount();
      } catch (err) {
        console.error('Auth state handler error:', err);
        paintAccount();
      }
    });
  };

  return { wire, openModal, closeAllModals };
})();

// ==== SECTION: RENDER — HOME / HERO / CATEGORIES / PRICING ====
const Home = (() => {
  const applyHero = cat => {
    const eyebrow = Util.$('#hero-eyebrow');
    const headline = Util.$('#hero-headline');
    const sub = Util.$('#hero-sub');
    const cta = Util.$('#hero-cta');
    const urlEl = Util.$('#hero-url');
    const ul = Util.$('#hero-highlights');
    const heroEl = Util.$('.hero');

    if (!cat) {
      if (eyebrow) eyebrow.textContent = 'Curated collection';
      if (headline) headline.textContent = 'Portfolio websites that ship in a weekend.';
      if (sub) sub.textContent = 'Handcrafted, developer-grade templates you can own, customize, and deploy.';
      if (cta) cta.textContent = 'Browse templates';
      if (urlEl) urlEl.textContent = 'yourname.dude.dev';
      if (ul) ul.innerHTML = '';
      if (heroEl) heroEl.style.background = '';
      return;
    }
    const h = cat.hero || {};
    if (eyebrow) eyebrow.textContent = cat.name || 'Curated collection';
    if (headline) headline.textContent = h.headline || 'Portfolio websites that ship in a weekend.';
    if (sub) sub.textContent = h.subtext || 'Handcrafted, developer-grade templates you can own, customize, and deploy.';
    if (cta) cta.textContent = h.ctaText || 'Browse templates';
    if (urlEl) urlEl.textContent = `${(cat.slug || 'dude')}.dude.dev`;
    if (ul) {
      ul.innerHTML = '';
      (cat.featureHighlights || []).forEach(f => ul.appendChild(Util.el('li', {}, f)));
    }
    if (heroEl) {
      if (h.gradientFrom && h.gradientTo) {
        heroEl.style.background =
          `radial-gradient(800px 400px at 80% 0%, ${h.gradientFrom}22, transparent 60%), radial-gradient(700px 400px at 0% 40%, ${h.gradientTo}22, transparent 60%)`;
      } else {
        heroEl.style.background = '';
      }
    }
  };

  const renderTabs = () => {
    const tabs = Util.$('#tier-tabs');
    if (!tabs) return;
    tabs.innerHTML = '';
    if (!State.categories.length) {
      tabs.appendChild(Util.el('p', { class: 'muted', style: 'padding:8px 0' }, 'No categories available yet.'));
      return;
    }
    State.categories.forEach(cat => {
      const btn = Util.el('button', {
        type: 'button',
        class: 'tier-tab' + (cat.id === State.activeCategoryId ? ' active' : ''),
        role: 'tab',
        'aria-selected': cat.id === State.activeCategoryId ? 'true' : 'false',
        dataset: { id: cat.id }
      }, cat.name || 'Category');
      tabs.appendChild(btn);
    });
    tabs.onclick = e => {
      const btn = e.target.closest('.tier-tab');
      if (!btn) return;
      setActiveCategory(btn.dataset.id);
    };
  };

  const renderPricing = () => {
    const grid = Util.$('#pricing-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!State.categories.length) {
      grid.appendChild(Util.el('div', { class: 'empty-state' }, 'Pricing tiers will appear once categories are configured.'));
      return;
    }
    const featureIdx = Math.floor(State.categories.length / 2);
    State.categories.forEach((cat, i) => {
      const price = cat.hero?.priceFrom || cat.priceFrom || null;
      const feats = cat.featureHighlights || [];
      const card = Util.el('div', { class: 'price-card' + (i === featureIdx ? ' featured' : '') });
      if (i === featureIdx) card.appendChild(Util.el('span', { class: 'badge-featured' }, 'Popular'));
      card.appendChild(Util.el('div', { class: 'price-name' }, cat.name || 'Tier'));
      card.appendChild(Util.el('div', { class: 'price-tag' },
        price ? Util.fmtINR(price) : 'Custom',
        Util.el('small', {}, price ? ' onwards' : '')));
      const ul = Util.el('ul', { class: 'price-features' });
      feats.forEach(f => ul.appendChild(Util.el('li', {}, f)));
      card.appendChild(ul);
      const btn = Util.el('button', { type: 'button', class: 'btn btn-primary' }, `Browse ${cat.name || 'templates'}`);
      btn.addEventListener('click', () => {
        setActiveCategory(cat.id);
        location.hash = '#/templates';
      });
      card.appendChild(btn);
      grid.appendChild(card);
    });
  };

  // ---- helpers for premium avatar circles ----
  const _initialOf = (name) => {
    const s = String(name || '').trim();
    if (!s) return 'A';
    // First alphanumeric character
    const m = s.match(/[\p{L}\p{N}]/u);
    return (m ? m[0] : s[0]).toUpperCase();
  };
  const _toneFor = (name) => {
    // Deterministic hash → 8 gradient tones (a..h)
    const s = String(name || 'Anonymous');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    const tones = ['a','b','c','d','e','f','g','h'];
    return tones[Math.abs(h) % tones.length];
  };

  // Build a single premium review card (used for both home marquee & detail page)
  const _buildReviewCard = (r) => {
    const card = Util.el('div', { class: 'review-card', role: 'listitem' });
    card.appendChild(Util.el('div', { class: 'review-stars', 'aria-label': `${r.rating || 5} out of 5 stars` }, Util.stars(r.rating)));
    const cleanText = String(r.comment || '').replace(/^[\u201C\u201D"']+|[\u201C\u201D"']+$/g, '').trim();
    card.appendChild(Util.el('p', { class: 'review-text' }, cleanText));
    const author = Util.el('div', { class: 'review-author' });
    // Premium avatar circle with user's first letter
    const displayName = r.userName || 'Anonymous';
    const avatar = Util.el('div', {
      class: 'review-avatar',
      'aria-hidden': 'true',
      dataset: { tone: _toneFor(displayName) },
      title: displayName
    }, _initialOf(displayName));
    author.appendChild(avatar);
    const nameBlock = Util.el('div', { class: 'review-author-name' });
    nameBlock.appendChild(document.createTextNode(displayName));
    const roleText = r.userRole || r.templateName || 'Verified buyer';
    nameBlock.appendChild(Util.el('span', { class: 'review-author-role' }, roleText));
    author.appendChild(nameBlock);
    author.appendChild(Util.el('span', { class: 'verified-badge', title: 'Verified purchase' }, '✓ Verified'));
    card.appendChild(author);
    if (r.adminReply) {
      const reply = Util.el('div', { class: 'review-reply' });
      reply.appendChild(Util.el('strong', {}, `Response from ${State.settings?.brandName || 'DUDE'}`));
      reply.appendChild(document.createTextNode(String(r.adminReply)));
      card.appendChild(reply);
    }
    return card;
  };

  const renderReviewsStrip = async () => {
    const box = Util.$('#reviews-carousel');
    if (!box) return;
    box.innerHTML = '';
    try {
      // Pull a larger pool so the marquee has enough content for a smooth loop
      const reviews = await Data.loadRecentReviews(12);
      if (!reviews.length) {
        box.appendChild(Util.el('p', { class: 'empty-state' }, 'Reviews coming soon.'));
        return;
      }

      // Detect reduced-motion — fall back to a static grid if user prefers it
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Split into two rows for a dual-lane marquee (top → left, bottom → right)
      const half = Math.ceil(reviews.length / 2);
      const rowA = reviews.slice(0, half);
      const rowB = reviews.slice(half).length ? reviews.slice(half) : rowA.slice().reverse();

      // Wrapper holding both marquee rows
      const rows = Util.el('div', { class: 'reviews-rows' });

      const buildTrack = (list, reverse) => {
        const track = Util.el('div', {
          class: 'reviews-marquee' + (reverse ? ' reverse' : ''),
          role: 'list'
        });
        // Duplicate the list once so translateX(-50%) yields a seamless loop
        const source = list.length < 4 ? [...list, ...list, ...list, ...list] : list;
        const doubled = [...source, ...source];
        doubled.forEach((r, i) => {
          const c = _buildReviewCard(r);
          if (i >= source.length) c.setAttribute('aria-hidden', 'true');
          track.appendChild(c);
        });
        return track;
      };

      if (reduceMotion) {
        // Static grid fallback
        reviews.forEach(r => box.appendChild(_buildReviewCard(r)));
      } else {
        rows.appendChild(buildTrack(rowA, false));
        if (rowB.length) rows.appendChild(buildTrack(rowB, true));
        box.appendChild(rows);

        // PERF: pause marquee animations while the strip is off-screen.
        // This stops the GPU compositing cost of two infinite 50s+ loops from
        // janking the scroll long before the user ever reaches the section.
        if ('IntersectionObserver' in window) {
          const tracks = rows.querySelectorAll('.reviews-marquee');
          const io = new IntersectionObserver((entries) => {
            entries.forEach(en => {
              tracks.forEach(t => { t.style.animationPlayState = en.isIntersecting ? '' : 'paused'; });
            });
          }, { rootMargin: '150px 0px' });
          io.observe(box);
        }
      }
    } catch (e) {
      console.error('Reviews strip failed:', e);
      box.innerHTML = '';
      box.appendChild(Util.el('p', { class: 'empty-state' }, 'Reviews unavailable right now.'));
    }
  };

  const renderContact = () => {
    const c = State.settings?.contact || {};
    const list = Util.$('#contact-list');
    if (!list) return;
    list.innerHTML = '';
    if (c.email)   list.appendChild(Util.el('li', {}, `📧 ${c.email}`));
    if (c.phone)   list.appendChild(Util.el('li', {}, `📞 ${c.phone}`));
    if (c.address) list.appendChild(Util.el('li', {}, `📍 ${c.address}`));
    if (!list.children.length) list.appendChild(Util.el('li', { class: 'muted' }, 'Contact details coming soon.'));
  };

  const setActiveCategory = catId => {
    if (!catId) return;
    if (catId === State.activeCategoryId) return;
    const cat = State.categories.find(c => c.id === catId);
    if (!cat) return;
    State.activeCategoryId = catId;
    applyHero(cat);
    renderTabs();
    Templates.reset();
    Templates.load();
    try {
      const url = new URL(location.href);
      url.searchParams.set('category', cat.slug || catId);
      history.replaceState({}, '', url);
    } catch {}
  };

  return { applyHero, renderTabs, renderPricing, renderReviewsStrip, renderContact, setActiveCategory };
})();

// ==== SECTION: RENDER — TEMPLATE GRID ====
const Templates = (() => {
  let cursor = null;
  let ended = false;
  let currentPage = 0;
  const pagesLoaded = [];

  const reset = () => {
    cursor = null; ended = false; currentPage = 0; pagesLoaded.length = 0;
    const grid = Util.$('#template-grid');
    const pager = Util.$('#pager');
    if (grid) grid.innerHTML = '';
    if (pager) pager.innerHTML = '';
    const lm = Util.$('#load-more');
    if (lm) { lm.disabled = false; lm.textContent = 'Load more'; }
  };

  const skeleton = () => {
    const grid = Util.$('#template-grid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 6; i++) {
      const card = Util.el('div', { class: 'tpl-card skel' });
      const bf = Util.el('div', { class: 'browser-frame' });
      const bar = Util.el('div', { class: 'bf-bar' },
        Util.el('span', { class: 'dot d1' }), Util.el('span', { class: 'dot d2' }), Util.el('span', { class: 'dot d3' }),
        Util.el('span', { class: 'url-pill' }, '…'));
      const body = Util.el('div', { class: 'bf-body skeleton' });
      bf.appendChild(bar); bf.appendChild(body);
      card.appendChild(bf);
      const body2 = Util.el('div', { class: 'tpl-body' },
        Util.el('div', { class: 'skeleton sk-line' }),
        Util.el('div', { class: 'skeleton sk-line short' }),
        Util.el('div', { class: 'skeleton sk-line' })
      );
      card.appendChild(body2);
      grid.appendChild(card);
    }
  };

  const cardFor = t => {
    const demoHost = t.demoUrl ? Util.hostOf(t.demoUrl, 'demo.dude.dev') : `${t.slug || 'template'}.dude.dev`;
    const card = Util.el('article', { class: 'tpl-card', role: 'listitem', dataset: { id: t.id } });

    const bf = Util.el('div', { class: 'browser-frame' });
    bf.appendChild(Util.el('div', { class: 'bf-bar' },
      Util.el('span', { class: 'dot d1' }), Util.el('span', { class: 'dot d2' }), Util.el('span', { class: 'dot d3' }),
      Util.el('span', { class: 'url-pill' }, demoHost)));
    const bfBody = Util.el('div', { class: 'bf-body' });
    const thumb = Util.safeUrl(t.thumbnailUrl) || Util.safeUrl(t.images && t.images[0]);
    if (thumb) {
      const img = Util.el('img', { src: thumb, alt: `${t.name || 'Template'} preview`, loading: 'lazy', decoding: 'async' });
      img.addEventListener('error', () => img.remove());
      bfBody.appendChild(img);
    }
    bf.appendChild(bfBody);
    card.appendChild(bf);

    const body = Util.el('div', { class: 'tpl-body' });
    body.appendChild(Util.el('h3', { class: 'tpl-title' }, t.name || 'Untitled'));
    body.appendChild(Util.el('p', { class: 'tpl-desc' }, t.shortDescription || ''));
    const chips = Util.el('div', { class: 'tpl-chips' });
    (t.technology || []).slice(0, 3).forEach(tech => chips.appendChild(Util.el('span', { class: 'chip' }, tech)));
    body.appendChild(chips);

    const foot = Util.el('div', { class: 'tpl-foot' });
    const price = Util.el('div', { class: 'tpl-price' });
    if (t.discountPrice && t.discountPrice < t.price) {
      price.appendChild(Util.el('span', {}, Util.fmtINR(t.discountPrice)));
      price.appendChild(Util.el('span', { class: 'strike' }, Util.fmtINR(t.price)));
    } else {
      price.appendChild(Util.el('span', {}, Util.fmtINR(t.price || 0)));
    }
    foot.appendChild(price);
    if (t.rating && t.rating.count) {
      foot.appendChild(Util.el('div', { class: 'tpl-rating' }, `★ ${(t.rating.average || 0).toFixed(1)} (${t.rating.count})`));
    }
    body.appendChild(foot);

    const actions = Util.el('div', { class: 'tpl-actions' });
    const detailBtn = Util.el('button', { type: 'button', class: 'btn btn-ghost', dataset: { action: 'view', id: t.id } }, 'View Details');
    const buyBtn = Util.el('button', { type: 'button', class: 'btn btn-primary', dataset: { action: 'buy', id: t.id } }, 'Buy Now');
    actions.appendChild(detailBtn); actions.appendChild(buyBtn);
    body.appendChild(actions);

    card.appendChild(body);
    return card;
  };

  const renderPager = () => {
    const p = Util.$('#pager');
    if (!p) return;
    p.innerHTML = '';
    pagesLoaded.forEach((_, i) => {
      const b = Util.el('button', { type: 'button', class: i === currentPage ? 'active' : '', dataset: { page: i }, 'aria-label': `Page ${i + 1}` }, String(i + 1));
      p.appendChild(b);
    });
    p.onclick = e => {
      const btn = e.target.closest('button[data-page]');
      if (!btn) return;
      currentPage = Number(btn.dataset.page);
      paint();
    };
  };

  const paint = () => {
    const grid = Util.$('#template-grid');
    if (!grid) return;
    grid.classList.add('fading');
    setTimeout(() => {
      grid.innerHTML = '';
      const page = pagesLoaded[currentPage] || [];
      if (!page.length) {
        grid.appendChild(Util.el('div', { class: 'empty-state' }, 'No templates in this category yet.'));
      } else {
        page.forEach(t => grid.appendChild(cardFor(t)));
      }
      grid.classList.remove('fading');
      renderPager();
      const lm = Util.$('#load-more');
      if (lm) {
        lm.disabled = ended;
        lm.textContent = ended ? 'No more' : 'Load more';
      }
    }, 120);
  };

  const load = async ({ append = false } = {}) => {
    if (!State.activeCategoryId) {
      const grid = Util.$('#template-grid');
      if (grid) {
        grid.innerHTML = '';
        grid.appendChild(Util.el('div', { class: 'empty-state' }, 'Select a category to view templates.'));
      }
      return;
    }
    if (!append) skeleton();
    try {
      const { items, cursor: c, end } = await Data.loadTemplatesPage(State.activeCategoryId, State.currentSort, cursor);
      cursor = c; ended = end;
      pagesLoaded.push(items);
      currentPage = pagesLoaded.length - 1;
      paint();
    } catch (e) {
      console.error('Template grid load failed:', e);
      Util.showError(Util.$('#template-grid'), {
        title: 'Could not load templates',
        message: Util.friendlyError(e),
        onRetry: () => { reset(); load(); }
      });
    }
  };

  const wire = () => {
    Util.$('#template-grid')?.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      if (btn.dataset.action === 'view') location.hash = `#/template/${id}`;
      else if (btn.dataset.action === 'buy') location.hash = `#/checkout/${id}`;
    });
    Util.$('#load-more')?.addEventListener('click', () => { if (!ended) load({ append: true }); });
    // NOTE: legacy sort dropdown removed — replaced by the decorative emoji showcase box.
  };

  return { reset, load, wire };
})();

// ==== SECTION: RENDER — TEMPLATE DETAIL ====
const Detail = (() => {
  let activeImgIndex = 0;

  const setBadges = t => {
    const box = Util.$('#detail-badges');
    if (!box) return;
    box.innerHTML = '';
    const badges = [];
    if (t.isResponsive) badges.push('Responsive');
    if (t.isSeoReady) badges.push('SEO-Ready');
    if (t.sourceCodeIncluded) badges.push('Source Included');
    badges.push('Fast Loading');
    badges.forEach(b => box.appendChild(Util.el('span', { class: 'badge' }, b)));
  };

  const setSpecs = t => {
    const list = Util.$('#detail-specs');
    if (!list) return;
    list.innerHTML = '';
    const row = (k, v) => list.appendChild(Util.el('li', {}, Util.el('strong', {}, k), document.createTextNode(String(v))));
    row('Delivery', `${t.deliveryTimeDays ?? 3} days`);
    row('Support', (t.supportDurationDays ?? 30) === 0 ? 'Not included' : `${t.supportDurationDays ?? 30} days`);
    row('Customization', ({ basic: 'Basic', standard: 'Standard', full: 'Full' })[t.customizationLevel] || 'Standard');
    row('Pages', String((t.pagesIncluded || []).length || 1));
  };

  const setGallery = t => {
    const raw = (t.images && t.images.length) ? t.images : (t.thumbnailUrl ? [t.thumbnailUrl] : []);
    const images = raw.map(u => Util.safeUrl(u)).filter(Boolean);
    const primary = Util.$('#detail-primary');
    if (!primary) return;
    primary.innerHTML = '';
    if (images[0]) {
      const img = Util.el('img', { src: images[activeImgIndex] || images[0], alt: `${t.name || 'Template'} preview` });
      img.addEventListener('error', () => {
        primary.innerHTML = '';
        primary.appendChild(Util.el('div', { class: 'empty-state' }, 'Preview unavailable.'));
      });
      primary.appendChild(img);
    } else {
      primary.appendChild(Util.el('div', { class: 'empty-state' }, 'No preview available.'));
    }
    primary.onclick = () => {
      if (!images[0]) return;
      const zoomImg = Util.$('#zoom-image');
      const zoomModal = Util.$('#zoom-modal');
      const scrim = Util.$('#modal-scrim');
      if (!zoomImg || !zoomModal || !scrim) return;
      zoomImg.src = images[activeImgIndex] || images[0];
      zoomImg.alt = `${t.name || 'Template'} — full preview`;
      zoomModal.hidden = false;
      scrim.hidden = false;
      document.body.style.overflow = 'hidden';
    };
    const strip = Util.$('#thumb-strip');
    if (!strip) return;
    strip.innerHTML = '';
    images.forEach((src, i) => {
      const th = Util.el('button', {
        type: 'button', class: 'thumb' + (i === activeImgIndex ? ' active' : ''),
        'aria-label': `Preview image ${i + 1}`, role: 'tab', 'aria-selected': i === activeImgIndex ? 'true' : 'false'
      }, Util.el('img', { src, alt: '', loading: 'lazy' }));
      th.addEventListener('click', () => {
        activeImgIndex = i;
        setGallery(t);
      });
      strip.appendChild(th);
    });
  };

  const setReviews = async t => {
    const box = Util.$('#detail-reviews');
    if (!box) return;
    box.innerHTML = '';
    try {
      const reviews = await Data.loadReviewsFor(t.id);
      if (!reviews.length) {
        box.appendChild(Util.el('p', { class: 'muted' }, 'No reviews yet. Be the first to review this template.'));
        return;
      }
      reviews.forEach(r => {
        // Premium avatar circle with initial + tone (same as home marquee)
        const nm = r.userName || 'Anonymous';
        const initial = (String(nm).trim().match(/[\p{L}\p{N}]/u) || ['A'])[0].toUpperCase();
        let h = 0; for (let i = 0; i < nm.length; i++) h = ((h << 5) - h + nm.charCodeAt(i)) | 0;
        const tone = ['a','b','c','d','e','f','g','h'][Math.abs(h) % 8];

        const c = Util.el('div', { class: 'review-card' });
        c.appendChild(Util.el('div', { class: 'review-stars', 'aria-label': `${r.rating || 5} out of 5 stars` }, Util.stars(r.rating)));
        const cleanText = String(r.comment || '').replace(/^[\u201C\u201D"']+|[\u201C\u201D"']+$/g, '').trim();
        c.appendChild(Util.el('p', { class: 'review-text' }, cleanText));
        const author = Util.el('div', { class: 'review-author' });
        const avatar = Util.el('div', {
          class: 'review-avatar',
          'aria-hidden': 'true',
          dataset: { tone },
          title: nm
        }, initial);
        author.appendChild(avatar);
        const nameBlock = Util.el('div', { class: 'review-author-name' });
        nameBlock.appendChild(document.createTextNode(nm));
        nameBlock.appendChild(Util.el('span', { class: 'review-author-role' }, r.userRole || 'Verified buyer'));
        author.appendChild(nameBlock);
        author.appendChild(Util.el('span', { class: 'verified-badge', title: 'Verified purchase' }, '✓ Verified'));
        c.appendChild(author);
        if (r.adminReply) {
          const reply = Util.el('div', { class: 'review-reply' });
          reply.appendChild(Util.el('strong', {}, `Response from ${State.settings?.brandName || 'DUDE'}`));
          reply.appendChild(document.createTextNode(String(r.adminReply)));
          c.appendChild(reply);
        }
        box.appendChild(c);
      });
    } catch (e) {
      console.error('Review load failed:', e);
      box.innerHTML = '';
      box.appendChild(Util.el('p', { class: 'muted' }, 'Reviews could not be loaded right now.'));
    }
  };

  const updateSEO = t => {
    const brand = State.settings?.brandName || 'DUDE';
    document.title = `${t.name || 'Template'} — ${brand}`;
    const setMeta = (sel, val) => { const n = document.querySelector(sel); if (n) n.setAttribute('content', val); };
    setMeta('meta[name=description]', (t.shortDescription || '').slice(0, 155));
    setMeta('#og-title', `${t.name || 'Template'} — ${brand}`);
    setMeta('#og-desc', t.shortDescription || '');
    setMeta('#og-image', Util.safeUrl(t.thumbnailUrl) || Util.safeUrl(t.images && t.images[0]) || '');

    const existing = document.getElementById('ld-template'); if (existing) existing.remove();
    const ld = document.createElement('script');
    ld.type = 'application/ld+json';
    ld.id = 'ld-template';
    ld.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: t.name || 'Template',
      description: t.shortDescription || '',
      image: (t.images || []).map(u => Util.safeUrl(u)).filter(Boolean),
      brand: { '@type': 'Brand', name: brand },
      offers: {
        '@type': 'Offer',
        priceCurrency: t.currency || 'INR',
        price: (t.discountPrice && t.discountPrice < t.price) ? t.discountPrice : (t.price || 0),
        availability: 'https://schema.org/InStock'
      },
      aggregateRating: (t.rating && t.rating.count) ? {
        '@type': 'AggregateRating', ratingValue: t.rating.average, reviewCount: t.rating.count
      } : undefined
    });
    document.head.appendChild(ld);
  };

  const resetSEO = () => {
    const brand = State.settings?.brandName || 'DUDE';
    document.title = `${brand} — Portfolio Websites for People Who Build the Web`;
    const setMeta = (sel, val) => { const n = document.querySelector(sel); if (n) n.setAttribute('content', val); };
    setMeta('meta[name=description]', `${brand} — a curated marketplace of ready-made student portfolio websites.`);
    setMeta('#og-title', `${brand} — Portfolio Websites`);
    setMeta('#og-desc', 'Ready-made student portfolio websites you can own in minutes.');
    setMeta('#og-image', '');
    document.getElementById('ld-template')?.remove();
  };

  const render = async id => {
    activeImgIndex = 0;
    if (!id) { location.hash = '#/templates'; return; }
    try {
      const t = await Data.getTemplate(id);
      if (!t || t.isActive === false) {
        Util.toast(t ? 'This template is no longer available.' : 'Template not found.', 'error');
        location.hash = '#/templates';
        return;
      }
      State.currentTemplate = t;
      const view = Util.$('#detail-view');
      if (view) view.querySelector('.error-state')?.remove();
      const cat = State.categories.find(c => c.id === t.categoryId);
      const setText = (sel, txt) => { const n = Util.$(sel); if (n) n.textContent = txt; };
      setText('#detail-tier', cat ? cat.name : '');
      setText('#detail-name', t.name || 'Untitled');
      setText('#detail-short', t.shortDescription || '');
      setText('#detail-url', t.demoUrl ? Util.hostOf(t.demoUrl) : `${t.slug || 'preview'}.dude.dev`);
      const longBox = Util.$('#detail-long');
      if (longBox) {
        longBox.innerHTML = '';
        longBox.appendChild(Util.el('p', {}, t.longDescription || t.shortDescription || ''));
      }

      const pagesUL = Util.$('#detail-pages');
      if (pagesUL) {
        pagesUL.innerHTML = '';
        (t.pagesIncluded || []).forEach(p => pagesUL.appendChild(Util.el('li', {}, p)));
      }
      const techUL = Util.$('#detail-tech');
      if (techUL) {
        techUL.innerHTML = '';
        (t.technology || []).forEach(p => techUL.appendChild(Util.el('li', {}, p)));
      }

      const rr = Util.$('#detail-rating');
      if (rr) {
        rr.innerHTML = '';
        rr.appendChild(Util.el('span', { class: 'stars' }, Util.stars(t.rating?.average)));
        rr.appendChild(Util.el('span', {}, `${(t.rating?.average || 0).toFixed(1)} · ${(t.rating?.count || 0)} reviews`));
      }

      const pr = Util.$('#detail-price');
      if (pr) {
        pr.innerHTML = '';
        if (t.discountPrice && t.discountPrice < t.price) {
          pr.appendChild(Util.el('span', {}, Util.fmtINR(t.discountPrice)));
          pr.appendChild(Util.el('span', { class: 'strike' }, Util.fmtINR(t.price)));
          const pct = Math.round(((t.price - t.discountPrice) / t.price) * 100);
          pr.appendChild(Util.el('span', { class: 'save' }, `Save ${pct}%`));
        } else {
          pr.appendChild(Util.el('span', {}, Util.fmtINR(t.price || 0)));
        }
      }

      setBadges(t);
      setSpecs(t);
      setGallery(t);
      setReviews(t);
      updateSEO(t);

      const demo = Util.$('#live-demo');
      const demoHref = Util.safeUrl(t.demoUrl);
      if (demo) {
        if (demoHref) { demo.href = demoHref; demo.style.display = ''; demo.removeAttribute('aria-disabled'); }
        else { demo.removeAttribute('href'); demo.style.display = 'none'; }
      }
      const buyBtn = Util.$('#buy-now');
      if (buyBtn) buyBtn.onclick = () => location.hash = `#/checkout/${t.id}`;

      // Review form — only visible for signed-in users.
      const rf = Util.$('#review-form');
      if (rf) rf.hidden = !State.user;
      const starBox = Util.$('#star-input');
      if (starBox) {
        starBox.innerHTML = '';
        let selected = 5;
        for (let i = 1; i <= 5; i++) {
          const b = Util.el('button', {
            type: 'button', role: 'radio',
            'aria-checked': i === selected ? 'true' : 'false',
            'aria-label': `${i} star${i > 1 ? 's' : ''}`,
            dataset: { val: i }
          }, '★');
          if (i <= selected) b.classList.add('on');
          b.addEventListener('click', () => {
            selected = Number(b.dataset.val);
            Util.$$('#star-input button').forEach(x => {
              const on = Number(x.dataset.val) <= selected;
              x.classList.toggle('on', on);
              x.setAttribute('aria-checked', Number(x.dataset.val) === selected ? 'true' : 'false');
            });
          });
          starBox.appendChild(b);
        }
        if (rf) {
          rf.onsubmit = async e => {
            e.preventDefault();
            const comment = String(new FormData(rf).get('comment') || '').trim();
            if (!comment) return Util.toast('Please write a review.', 'error');
            if (!State.user) { Auth.openModal(); return; }
            const submitBtn = rf.querySelector('button[type=submit]');
            if (submitBtn) submitBtn.disabled = true;
            try {
              await Data.submitReview(t.id, selected, comment);
              rf.reset();
              Util.toast('Review submitted — pending approval.', 'success');
            } catch (err) {
              console.error('Review submit failed:', err);
              Util.toast(String(err.message || 'Could not submit review.'), 'error');
            } finally {
              if (submitBtn) submitBtn.disabled = false;
            }
          };
        }
      }
    } catch (e) {
      console.error('Detail render failed:', e);
      Util.showError(Util.$('#detail-view'), {
        title: 'Could not open this template',
        message: Util.friendlyError(e),
        onRetry: () => Detail.render(id)
      }, { replace: false });
    }
  };

  return { render, resetSEO };
})();

// ==== SECTION: RENDER — CHECKOUT ====
const Checkout = (() => {
  let currentTemplate = null;
  let fields = [];
  let uploads = {};
  let pendingOrderId = null;

  const FILE_RULES = {
    image: { accept: 'image/*', maxSize: 5 * 1024 * 1024, maxCount: 3, types: /^image\//, hint: 'PNG/JPG/WebP up to 5 MB (auto-compressed)' },
    file:  { accept: '.pdf,.doc,.docx,.zip,image/*', maxSize: 700 * 1024, maxCount: 2, types: /^(image\/|application\/(pdf|zip|x-zip-compressed|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))/, hint: 'PDF, DOC/DOCX, ZIP or image up to 700 KB (images are auto-compressed)' }
  };

  const describe = f => f.required ? `${f.label} *` : f.label;

  const inputFor = (f) => {
    const isGroup = ['checkbox', 'radio', 'file', 'image'].includes(f.type);
    const wrap = Util.el('div', { class: 'field' + (['textarea', 'file', 'image', 'checkbox', 'radio'].includes(f.type) ? ' field-full' : '') });
    const errId = `err_${f.id}`;
    const label = isGroup
      ? Util.el('span', { class: 'field-caption', id: `cap_${f.id}` })
      : Util.el('label', { for: `f_${f.id}` });
    label.appendChild(document.createTextNode(describe(f)));
    wrap.appendChild(label);

    let control;
    switch (f.type) {
      case 'textarea':
        control = Util.el('textarea', { id: `f_${f.id}`, name: f.id, rows: 4, placeholder: f.placeholder || '', 'aria-describedby': errId });
        break;
      case 'select':
        control = Util.el('select', { id: `f_${f.id}`, name: f.id, 'aria-describedby': errId });
        control.appendChild(Util.el('option', { value: '' }, 'Select…'));
        (f.options || []).forEach(o => control.appendChild(Util.el('option', { value: o }, o)));
        break;
      case 'checkbox': {
        control = Util.el('fieldset', { class: 'checkbox-row', role: 'group', 'aria-labelledby': `cap_${f.id}`, 'aria-describedby': errId });
        (f.options && f.options.length ? f.options : [f.label]).forEach((o, i) => {
          const inputId = `f_${f.id}_${i}`;
          const row = Util.el('label', { for: inputId },
            Util.el('input', { type: 'checkbox', id: inputId, name: f.id, value: o, dataset: { fid: f.id } }),
            document.createTextNode(' ' + o));
          control.appendChild(row);
        });
        break;
      }
      case 'radio': {
        control = Util.el('fieldset', { class: 'radio-row', role: 'radiogroup', 'aria-labelledby': `cap_${f.id}`, 'aria-describedby': errId });
        (f.options || []).forEach((o, i) => {
          const inputId = `f_${f.id}_${i}`;
          const row = Util.el('label', { for: inputId },
            Util.el('input', { type: 'radio', id: inputId, name: f.id, value: o, dataset: { fid: f.id } }),
            document.createTextNode(' ' + o));
          control.appendChild(row);
        });
        break;
      }
      case 'file':
      case 'image': {
        const rules = FILE_RULES[f.type] || FILE_RULES.file;
        control = Util.el('div', {
          class: 'file-drop', tabindex: 0, role: 'button', dataset: { fid: f.id },
          'aria-label': `Upload ${f.label}. ${rules.hint}`, 'aria-labelledby': `cap_${f.id}`, 'aria-describedby': errId
        },
          Util.el('div', {}, `Click or drop your ${f.type === 'image' ? 'image' : 'file'} here (${rules.hint})`),
          Util.el('div', { class: 'file-name', dataset: { name: f.id } }, ''));
        const fileInput = Util.el('input', {
          type: 'file', id: `f_${f.id}`, name: f.id, accept: rules.accept, style: 'display:none',
          'aria-hidden': 'true', tabindex: '-1'
        });
        control.appendChild(fileInput);
        const setErr = msg => {
          const errBox = Util.$(`[data-err="${f.id}"]`);
          if (errBox) errBox.textContent = msg || '';
        };
        const accept = (file) => {
          if (!file) return;
          if (!rules.types.test(file.type)) {
            setErr(`Invalid file type. Allowed: ${rules.hint}.`);
            wrap.classList.add('error');
            return;
          }
          if (file.size > rules.maxSize) {
            setErr(`File is too large (max ${Math.round(rules.maxSize / 1024 / 1024)} MB).`);
            wrap.classList.add('error');
            return;
          }
          uploads[f.id] = file;
          setErr('');
          wrap.classList.remove('error');
          control.classList.add('has-file');
          const nameLabel = control.querySelector('.file-name');
          if (nameLabel) nameLabel.textContent = `${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
        };
        control.addEventListener('click', () => fileInput.click());
        control.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } });
        control.addEventListener('dragover', e => { e.preventDefault(); control.classList.add('dragging'); });
        control.addEventListener('dragleave', () => control.classList.remove('dragging'));
        control.addEventListener('drop', e => {
          e.preventDefault(); control.classList.remove('dragging');
          const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
          accept(file);
        });
        fileInput.addEventListener('change', () => accept(fileInput.files[0]));
        break;
      }
      case 'date':
        control = Util.el('input', { type: 'date', id: `f_${f.id}`, name: f.id, 'aria-describedby': errId });
        break;
      case 'email':
        control = Util.el('input', { type: 'email', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || '', autocomplete: 'email', 'aria-describedby': errId });
        break;
      case 'phone':
        control = Util.el('input', { type: 'tel', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || '', autocomplete: 'tel', 'aria-describedby': errId });
        break;
      case 'url':
        control = Util.el('input', { type: 'url', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || 'https://…', 'aria-describedby': errId });
        break;
      default:
        control = Util.el('input', { type: 'text', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || '', 'aria-describedby': errId });
    }
    if (f.required && control.tagName !== 'FIELDSET' && control.tagName !== 'DIV') {
      control.setAttribute('required', 'true');
    }
    wrap.appendChild(control);
    wrap.appendChild(Util.el('div', { class: 'field-error', id: errId, role: 'alert', dataset: { err: f.id } }, ''));
    return wrap;
  };

  const validate = () => {
    let ok = true;
    const mark = (f, msg) => {
      ok = false;
      const errBox = Util.$(`[data-err="${f.id}"]`);
      if (errBox) errBox.textContent = msg;
      const anchor = Util.$(`#f_${f.id}`) || Util.$(`[data-fid="${f.id}"]`);
      const wrap = anchor && anchor.closest('.field');
      if (wrap) wrap.classList.add('error');
    };
    fields.forEach(f => {
      const errBox = Util.$(`[data-err="${f.id}"]`);
      if (errBox) errBox.textContent = '';
      const anchor = Util.$(`#f_${f.id}`) || Util.$(`[data-fid="${f.id}"]`);
      anchor?.closest('.field')?.classList.remove('error');

      let val = '';
      if (f.type === 'checkbox') {
        val = Util.$$(`input[name="${f.id}"]:checked`, Util.$('#checkout-form')).length ? 'ok' : '';
      } else if (f.type === 'radio') {
        val = Util.$(`input[name="${f.id}"]:checked`, Util.$('#checkout-form')) ? 'ok' : '';
      } else if (f.type === 'file' || f.type === 'image') {
        if (f.required && !uploads[f.id]) mark(f, `Please upload ${f.label}.`);
        return;
      } else {
        const n = Util.$(`#f_${f.id}`);
        val = n ? String(n.value || '').trim() : '';
      }

      if (f.required && !val) { mark(f, `${f.label} is required.`); return; }
      if (!val) return;
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) mark(f, 'Enter a valid email address.');
      else if (f.type === 'url' && !Util.safeUrl(val)) mark(f, 'Enter a valid URL (including https://).');
      else if (f.type === 'phone' && !/^[0-9+\-\s()]{7,}$/.test(val)) mark(f, 'Enter a valid phone number.');
    });
    return ok;
  };

  const collect = () => {
    const out = {};
    fields.forEach(f => {
      if (f.type === 'checkbox') {
        out[f.id] = Util.$$(`input[name="${f.id}"]:checked`, Util.$('#checkout-form')).map(n => n.value);
      } else if (f.type === 'radio') {
        const n = Util.$(`input[name="${f.id}"]:checked`, Util.$('#checkout-form'));
        out[f.id] = n ? n.value : '';
      } else if (f.type === 'file' || f.type === 'image') {
        out[f.id] = uploads[f.id]?.name || '';
      } else {
        const n = Util.$(`#f_${f.id}`);
        out[f.id] = n ? String(n.value || '').slice(0, 2000) : '';
      }
    });
    return out;
  };

  const renderSummary = t => {
    const box = Util.$('#order-summary');
    if (!box) return;
    box.innerHTML = '';
    const price = (t.discountPrice && t.discountPrice < t.price) ? t.discountPrice : (t.price || 0);
    box.appendChild(Util.el('h3', {}, 'Order summary'));
    box.appendChild(Util.el('div', { class: 'summary-line' },
      Util.el('span', {}, t.name || 'Template'),
      Util.el('span', {}, Util.fmtINR(price))));
    if (t.discountPrice && t.discountPrice < t.price) {
      box.appendChild(Util.el('div', { class: 'summary-line' },
        Util.el('span', {}, 'You save'),
        Util.el('span', { style: 'color:var(--success)' }, `− ${Util.fmtINR(t.price - t.discountPrice)}`)));
    }
    box.appendChild(Util.el('div', { class: 'summary-line' },
      Util.el('span', {}, 'Taxes'),
      Util.el('span', {}, 'Included')));
    box.appendChild(Util.el('div', { class: 'summary-line total' },
      Util.el('span', {}, 'Total'),
      Util.el('span', {}, Util.fmtINR(price))));
    box.appendChild(Util.el('p', { class: 'field-hint' }, 'Final amount is confirmed securely on the payment screen.'));

    const btn = Util.el('button', { class: 'btn btn-primary btn-lg', id: 'proceed-pay', type: 'button' }, 'Proceed to pay');
    box.appendChild(btn);
    btn.addEventListener('click', submit);
  };

  // Files are stored INSIDE Firestore as base64 data URLs — no Firebase Storage
  // bucket required (works on the free Spark plan). Images are downscaled first.
  const uploadFiles = async () => {
    const out = {};
    for (const [fid, file] of Object.entries(uploads)) {
      let f = file;
      if (file.type && file.type.startsWith('image/')) {
        try { f = await Util.compressImage(file, 1200, 0.72); }
        catch (e) { console.warn('Compression failed; using original:', e); f = file; }
      }
      const dataUrl = await Util.fileToDataUrl(f);
      if (dataUrl.length > 950000) {
        throw new Error(`"${file.name}" is too large to attach (database limit). Please upload a smaller file.`);
      }
      out[fid] = {
        name: String(file.name || 'file').slice(0, 120),
        type: file.type || 'application/octet-stream',
        size: file.size || 0,
        dataUrl
      };
    }
    return out;
  };

  const abandonPending = async () => {
    if (!pendingOrderId) return;
    const oid = pendingOrderId;
    pendingOrderId = null;
    try {
      const snap = await db.collection('orders').doc(oid).get();
      if (!snap.exists) return;
      const o = snap.data();
      if (!['draft', 'payment_created', 'payment_pending'].includes(o.status)) return;
      await db.collection('orders').doc(oid).update({
        status: 'abandoned',
        uploadedFiles: {},
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) { console.warn('Abandon cleanup failed:', e); }
  };

  const restorePayBtn = (label = 'Proceed to pay') => {
    const btn = Util.$('#proceed-pay');
    if (btn) { btn.disabled = false; btn.textContent = label; }
  };

  const submit = async () => {
    if (!State.user) { Auth.openModal(); return; }
    if (!validate()) { Util.toast('Please fix the highlighted fields.', 'error'); return; }
    const t = currentTemplate;
    if (!t) return;
    const btn = Util.$('#proceed-pay');
    if (!btn) return;
    btn.disabled = true; btn.textContent = 'Preparing…';

    try {
      const orderRef = await db.collection('orders').add({
        userId: State.user.uid,
        userEmail: State.user.email || '',
        templateId: t.id,
        templateName: t.name || '',
        categoryId: t.categoryId,
        formResponses: collect(),
        uploadedFiles: {},
        status: 'draft',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      pendingOrderId = orderRef.id;

      btn.textContent = 'Uploading files…';
      const paths = await uploadFiles();
      if (Object.keys(paths).length) {
        await orderRef.update({
          uploadedFiles: paths,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      }

      // Honour the gateway the ADMIN selected — fresh read so toggles apply instantly.
      btn.textContent = 'Opening payment…';
      try { await Data.loadSettings(); } catch (e) { console.warn('Settings refresh failed:', e); }
      const payCfg = (State.settings && State.settings.payment) || {};
      const gatewayMode = payCfg.mode || 'manual_upi';

      if (gatewayMode !== 'razorpay') {
        // ---- Manual UPI flow (default): no Cloud Functions, no Storage needed ----
        await orderRef.update({
          status: 'payment_pending',
          paymentMethod: 'manual_upi',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        pendingOrderId = null;
        Util.toast('Order created — complete your UPI payment to confirm.', 'success');
        location.hash = `#/payment/${orderRef.id}`;
        restorePayBtn();
        return;
      }

      // ---- Razorpay flow (requires deployed createOrder/verifyPayment Cloud Functions) ----
      if (!functions) throw new Error('Online payments are not configured yet. Please ask the store to enable UPI payments.');
      let res;
      try {
        const createOrder = functions.httpsCallable('createOrder');
        res = await createOrder({ orderId: orderRef.id, templateId: t.id });
      } catch (fnErr) {
        console.error('createOrder callable failed:', fnErr);
        throw new Error('Online payment could not be initialised. Ask the store to enable UPI payments, or try again later.');
      }
      const { razorpay_order_id, key_id, amount, currency } = res.data || {};
      if (!razorpay_order_id || !key_id || !amount) throw new Error('Payment could not be initialized.');
      pendingOrderId = null;

      if (typeof Razorpay === 'undefined') {
        throw new Error('Payment gateway unavailable. Please refresh and try again.');
      }

      const rzp = new Razorpay({
        key: key_id,
        amount, currency: currency || 'INR',
        name: State.settings?.brandName || 'DUDE',
        description: t.name || 'Template order',
        order_id: razorpay_order_id,
        prefill: {
          name: State.user.displayName || '',
          email: State.user.email || '',
          contact: State.user.phoneNumber || ''
        },
        theme: { color: payCfg.razorpayTheme || '#2F5CFF' },
        handler: async (resp) => {
          try {
            const verify = functions.httpsCallable('verifyPayment');
            await verify({
              orderId: orderRef.id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature
            });
            Util.toast('Payment verified. Order confirmed.', 'success');
            location.hash = '#/orders';
          } catch (err) {
            console.error('verifyPayment failed:', err);
            Util.toast('Payment verification failed. If you were charged, contact support with your order id.', 'error');
            location.hash = '#/orders';
          }
        },
        modal: {
          ondismiss: () => {
            Util.toast('Payment window closed. You can retry from your orders page.', 'info');
            restorePayBtn();
          }
        }
      });
      rzp.on('payment.failed', (resp) => {
        console.error('Razorpay payment failed:', resp && resp.error);
        Util.toast('Payment failed. No money was captured — please try again.', 'error');
        restorePayBtn();
      });
      rzp.open();
      restorePayBtn();
    } catch (err) {
      console.error('Checkout failed:', err);
      Util.toast(err.message || Util.friendlyError(err), 'error');
      await abandonPending();
      restorePayBtn();
    }
  };

  const render = async templateId => {
    try {
      if (!templateId) { location.hash = '#/templates'; return; }
      if (!State.user) {
        Util.toast('Sign in to check out.', 'info');
        Auth.openModal();
        location.hash = `#/template/${templateId}`;
        return;
      }
      const t = await Data.getTemplate(templateId);
      if (!t || t.isActive === false) {
        Util.toast(t ? 'This template is no longer available.' : 'Template not found.', 'error');
        location.hash = '#/templates';
        return;
      }
      currentTemplate = t;
      uploads = {};
      pendingOrderId = null;

      fields = await Data.loadFormFields(t.categoryId);
      State.customForm = fields;

      const view = Util.$('#checkout-view');
      if (view) view.querySelector('.error-state')?.remove();
      const form = Util.$('#checkout-form');
      if (form) {
        form.innerHTML = '';
        if (!fields.length) {
          form.appendChild(Util.el('p', { class: 'empty-state' }, 'This category has no checkout fields configured yet. You can still proceed — we will collect your brief after purchase.'));
        } else {
          fields.forEach(f => form.appendChild(inputFor(f)));
        }
      }
      renderSummary(t);
    } catch (e) {
      console.error('Checkout render failed:', e);
      Util.showError(Util.$('#checkout-view'), {
        title: 'Could not open checkout',
        message: Util.friendlyError(e),
        onRetry: () => Checkout.render(templateId)
      }, { replace: false });
    }
  };

  return { render };
})();

// ==== SECTION: ORDERS ====
const Orders = (() => {
  let unsub = null;
  let templateCache = {};
  let lastOrders = [];

  // Aligned with admin's STATUS_FLOW timeline stages.
  const TIMELINE_STAGES = ['paid', 'processing', 'completed', 'delivered'];
  const TIMELINE_INDEX = { paid: 1, processing: 2, completed: 3, delivered: 4 };
  const HIDE_TIMELINE = ['draft', 'payment_created', 'payment_pending', 'failed', 'cancelled', 'abandoned', 'expired'];

  const startListening = () => {
    if (!State.user) return;
    stopListening();
    unsub = Data.listenUserOrders(State.user.uid,
      orders => {
        lastOrders = orders;
        const view = Util.$('#orders-view');
        if (view && !view.hidden) paint(orders);
      },
      err => {
        console.error('Orders listener error:', err);
        const view = Util.$('#orders-view');
        if (view && !view.hidden) {
          Util.showError(Util.$('#orders-list'), {
            title: 'Could not load your orders',
            message: Util.friendlyError(err),
            onRetry: () => Orders.load()
          });
        }
      });
  };
  const stopListening = () => { if (unsub) { try { unsub(); } catch {} unsub = null; } };

  const timelineFor = o => {
    const idx = TIMELINE_INDEX[o.status] || 0;
    const tl = Util.el('div', { class: `timeline p-${idx}` });
    TIMELINE_STAGES.forEach((s, i) => {
      const step = Util.el('div', { class: 'step' + (i < idx ? ' done' : '') });
      step.appendChild(Util.el('span', {}, s.charAt(0).toUpperCase() + s.slice(1)));
      tl.appendChild(step);
    });
    return tl;
  };

  const paint = async orders => {
    const box = Util.$('#orders-list');
    if (!box) return;
    box.innerHTML = '';
    if (!orders.length) {
      const empty = Util.el('div', { class: 'empty-state orders-empty' });
      empty.appendChild(Util.el('div', { class: 'empty-icon' }, '🛍️'));
      empty.appendChild(Util.el('h3', {}, 'No orders yet'));
      empty.appendChild(Util.el('p', {}, 'When you grab a template, its download link and progress will show up right here.'));
      const cta = Util.el('a', { class: 'btn btn-primary btn-lg', href: '#/templates', style: 'max-width:280px;margin:8px auto 0' }, 'Browse templates');
      empty.appendChild(cta);
      box.appendChild(empty);
      return;
    }
    try {
      const missing = orders.map(o => o.templateId).filter(id => id && !templateCache[id]);
      if (missing.length) Object.assign(templateCache, await Data.getTemplatesBatch(missing));
    } catch (e) { console.error('Template batch lookup failed:', e); }

    for (const o of orders) {
      const t = o.templateId ? templateCache[o.templateId] : null;
      const title = (o.template && o.template.name) || o.templateName || (t && t.name) || 'Template order';
      const card = Util.el('div', { class: 'order-card' });
      const head = Util.el('div', { class: 'order-head' });
      head.appendChild(Util.el('h3', {}, title));
      head.appendChild(Util.el('span', { class: `status-pill status-${o.status || 'draft'}` }, String(o.status || 'draft').replace(/_/g, ' ')));
      card.appendChild(head);

      if (!HIDE_TIMELINE.includes(o.status)) {
        card.appendChild(timelineFor(o));
      } else if (['payment_created', 'payment_pending'].includes(o.status)) {
        card.appendChild(Util.el('p', { class: 'field-hint' }, 'Awaiting payment confirmation. Unpaid orders expire automatically.'));
      } else if (o.status === 'draft') {
        card.appendChild(Util.el('p', { class: 'field-hint' }, 'Draft order — payment not initiated.'));
      }

      const meta = Util.el('div', { class: 'order-meta' });
      meta.appendChild(Util.el('span', {}, `Order #${o.id.slice(0, 8)}`));
      if (o.amount != null) meta.appendChild(Util.el('span', {}, `${Util.fmtINR(o.amount)} · ${o.currency || 'INR'}`));
      if (o.updatedAt?.toDate) meta.appendChild(Util.el('span', {}, `Updated ${o.updatedAt.toDate().toLocaleDateString()}`));
      card.appendChild(meta);

      if (o.adminNotes) {
        const note = Util.el('p', { style: 'margin-top:12px;color:var(--text-muted)' });
        note.appendChild(Util.el('strong', {}, 'Note from support: '));
        note.appendChild(document.createTextNode(String(o.adminNotes)));
        card.appendChild(note);
      }

      const hasResponses = o.formResponses && Object.keys(o.formResponses).length;
      if (hasResponses) {
        const toggle = Util.el('button', { type: 'button', class: 'btn btn-ghost order-toggle', 'aria-expanded': 'false' }, 'Show details');
        const panel = Util.el('div', { class: 'order-details', hidden: true });
        Object.entries(o.formResponses).forEach(([k, v]) => {
          const row = Util.el('div', {});
          row.appendChild(Util.el('strong', {}, `${k}: `));
          row.appendChild(document.createTextNode(Array.isArray(v) ? v.join(', ') : String(v || '—')));
          panel.appendChild(row);
        });
        toggle.addEventListener('click', () => {
          const open = panel.hidden;
          panel.hidden = !open;
          toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
          toggle.textContent = open ? 'Hide details' : 'Show details';
        });
        card.appendChild(toggle);
        card.appendChild(panel);
      }
      box.appendChild(card);
    }
  };

  const loadingState = box => {
    box.innerHTML = '';
    const sk = Util.el('div', { class: 'orders-skeleton', 'aria-hidden': 'true' });
    for (let i = 0; i < 2; i++) {
      const c = Util.el('div', { class: 'order-card skeleton-card' });
      c.appendChild(Util.el('div', { class: 'sk-line sk-60' }));
      c.appendChild(Util.el('div', { class: 'sk-line sk-90' }));
      c.appendChild(Util.el('div', { class: 'sk-line sk-40' }));
      sk.appendChild(c);
    }
    box.appendChild(sk);
  };

  const load = async () => {
    const box = Util.$('#orders-list');
    if (!box) return;
    if (!State.user) {
      box.innerHTML = '';
      const wrap = Util.el('div', { class: 'empty-state orders-empty' });
      wrap.appendChild(Util.el('div', { class: 'empty-icon' }, '📦'));
      wrap.appendChild(Util.el('h3', {}, 'Hey — sign in to see your orders'));
      wrap.appendChild(Util.el('p', {}, 'Your portfolio purchases, download links and progress all live here.'));
      const btn = Util.el('button', { type: 'button', class: 'btn btn-primary btn-lg', style: 'max-width:280px;margin:8px auto 0' }, 'Sign in');
      btn.addEventListener('click', () => Auth.openModal());
      wrap.appendChild(btn);
      box.appendChild(wrap);
      return;
    }
    // If listener already has data, use it — else one-shot fetch.
    if (lastOrders && lastOrders.length) { await paint(lastOrders); return; }
    loadingState(box);
    try {
      let snap = null;
      try {
        snap = await db.collection('orders').where('userId', '==', State.user.uid).orderBy('updatedAt', 'desc').limit(50).get();
      } catch (idxErr) {
        console.warn('Orders orderBy failed, falling back:', idxErr);
      }
      if (!snap) {
        try {
          snap = await db.collection('orders').where('userId', '==', State.user.uid).limit(50).get();
        } catch (e2) {
          console.warn('Orders unordered query failed too:', e2);
          snap = { docs: [] };
        }
      }
      const items = (snap.docs || []).map(d => ({ id: d.id, ...(d.data ? d.data() : {}) }))
        .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
      lastOrders = items;
      await paint(items);
    } catch (e) {
      console.error('Orders load failed:', e);
      Util.showError(box, {
        title: 'Could not load your orders',
        message: Util.friendlyError(e),
        onRetry: () => Orders.load()
      });
    }
  };

  return { startListening, stopListening, load };
})();

// ==== SECTION: PAYMENT (customer gateway page, mirrors admin config) ====
const Payment = (() => {
  let currentOrder = null;

  const pay = () => (State.settings && State.settings.payment) || {};
  const mode = () => pay().mode || 'manual_upi';

  // Amount to display/collect: prefer the server-confirmed amount, else derive
  // it from the template price (manual-UPI drafts don't carry an amount field).
  const amountOf = (o, t) => {
    if (o && o.amount != null) return o.amount;
    if (t) return (t.discountPrice && t.discountPrice < t.price) ? t.discountPrice : (t.price || 0);
    return null;
  };

  const setBlock = id => {
    ['pg-block-manual', 'pg-block-razorpay', 'pg-block-done'].forEach(b => {
      const n = Util.$('#' + b);
      if (n) n.classList.toggle('active', b === id);
    });
  };

  const paintOrderCard = (o, t) => {
    const card = Util.$('#pay-order-card');
    if (!card) return;
    card.innerHTML = '';
    card.appendChild(Util.el('h3', {}, 'Order summary'));
    const title = (o.template && o.template.name) || o.templateName || (t && t.name) || 'Template order';
    card.appendChild(Util.el('div', { class: 'summary-line' }, Util.el('span', {}, title), Util.el('span', {}, `#${String(o.id).slice(0, 8)}`)));
    const amt = amountOf(o, t);
    if (amt != null) {
      card.appendChild(Util.el('div', { class: 'summary-line total' }, Util.el('span', {}, 'Total'), Util.el('span', {}, Util.fmtINR(amt))));
    }
    card.appendChild(Util.el('p', { class: 'field-hint' }, 'Your files & brief are saved. Complete payment to confirm the order.'));
  };

  const startRazorpay = async o => {
    const btn = Util.$('#rzp-pay-btn');
    const status = Util.$('#rzp-status');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
    const done = (msg, ok) => { if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; } if (status && msg) { status.className = 'form-note ' + (ok ? 'ok' : 'err'); status.textContent = msg; } };
    try {
      if (!functions) throw new Error('Online payments are not configured yet. Please ask the store to enable UPI.');
      const res = await functions.httpsCallable('createOrder')({ orderId: o.id, templateId: o.templateId });
      const { razorpay_order_id, key_id, amount, currency } = res.data || {};
      if (!razorpay_order_id || !key_id || !amount) throw new Error('Payment could not be initialized.');
      if (typeof Razorpay === 'undefined') throw new Error('Payment gateway unavailable. Please refresh and try again.');
      const rzp = new Razorpay({
        key: key_id, amount, currency: currency || 'INR',
        name: State.settings?.brandName || 'DUDE',
        description: (o.template && o.template.name) || o.templateName || 'Template order',
        order_id: razorpay_order_id,
        prefill: { name: State.user?.displayName || '', email: State.user?.email || '', contact: State.user?.phoneNumber || '' },
        theme: { color: pay().razorpayTheme || '#2F5CFF' },
        handler: async resp => {
          try {
            await functions.httpsCallable('verifyPayment')({
              orderId: o.id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature
            });
            Util.toast('Payment verified. Order confirmed.', 'success');
            location.hash = '#/orders';
          } catch (err) {
            console.error('verifyPayment failed:', err);
            Util.toast('Payment verification failed. If charged, contact support with your order id.', 'error');
            location.hash = '#/orders';
          }
        },
        modal: { ondismiss: () => done('Payment window closed. You can retry anytime.', false) }
      });
      rzp.on('payment.failed', resp => { console.error('Razorpay failed:', resp && resp.error); done('Payment failed. No money was captured — please try again.', false); });
      rzp.open();
      done('');
    } catch (err) {
      console.error('Razorpay start failed:', err);
      done(err.message || Util.friendlyError(err), false);
    }
  };

  const bindManual = (o, t) => {
    const p = pay();
    const vpa = p.upiId || '';
    const name = p.upiPayeeName || State.settings?.brandName || '';
    const amt = amountOf(o, t);
    const set = (id, txt) => { const n = Util.$(id); if (n) n.textContent = txt; };
    set('#upi-pay-vpa', vpa || '—');
    set('#upi-pay-name', name ? 'Payee: ' + name : '');
    set('#upi-pay-amount', amt != null ? 'Amount: ' + Util.fmtINR(amt) : '');
    set('#upi-instructions', p.upiInstructions || 'Pay the exact amount, then paste your UTR / transaction reference below.');

    // UPI deep link — opens GPay / PhonePe / Paytm with everything prefilled.
    const note = (p.upiAutoOrderNote !== false)
      ? `Order ${String(o.id).slice(0, 8)}`
      : (State.settings?.brandName || 'Order');
    const upiUrl = vpa
      ? `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name || 'Merchant')}${amt != null ? `&am=${encodeURIComponent(amt)}&cu=INR` : ''}&tn=${encodeURIComponent(note)}`
      : '';
    const payAppBtn = Util.$('#upi-pay-app');
    if (payAppBtn) {
      if (upiUrl) { payAppBtn.href = upiUrl; payAppBtn.hidden = false; }
      else payAppBtn.hidden = true;
    }

    // UPI app chips (GPay / PhonePe / Paytm) — all reuse the same prefilled deep link.
    const appsRow = Util.$('#upi-apps');
    Util.$$('.upi-app-chip', document).forEach(chip => {
      if (upiUrl) {
        chip.onclick = () => { try { location.href = upiUrl; } catch {} };
        chip.classList.remove('is-disabled');
      } else {
        chip.onclick = () => Util.toast('UPI ID not configured yet.', 'info');
        chip.classList.add('is-disabled');
      }
    });
    if (appsRow) appsRow.hidden = !upiUrl;

    // QR: use the admin-uploaded image if set, otherwise generate one locally
    // from the UPI deep link (no external service involved).
    const qrWrap = Util.$('#upi-qr-wrap');
    const qrUrl = Util.safeUrl(p.upiQrUrl);
    const qrImg = Util.$('#upi-qr-img');
    const qrCanvas = Util.$('#upi-qr-canvas');
    if (qrWrap) {
      if (qrUrl) {
        if (qrImg) { qrImg.src = qrUrl; qrImg.hidden = false; }
        if (qrCanvas) qrCanvas.hidden = true;
        qrWrap.hidden = false;
      } else if (upiUrl && window.QRCode && typeof window.QRCode.toCanvas === 'function' && qrCanvas) {
        qrCanvas.hidden = false;
        if (qrImg) qrImg.hidden = true;
        window.QRCode.toCanvas(qrCanvas, upiUrl, { width: 200, margin: 1, color: { dark: '#0A0E1A', light: '#FFFFFF' } }, err => {
          if (err) { console.warn('QR render failed:', err); qrWrap.hidden = true; }
          else qrWrap.hidden = false;
        });
      } else {
        qrWrap.hidden = true;
      }
    }

    const shotWrap = Util.$('#utr-shot-wrap');
    if (shotWrap) shotWrap.hidden = !p.upiRequireScreenshot;

    // Screenshot preview UI
    const shotInput = Util.$('#utr-shot');
    const shotPreview = Util.$('#utr-shot-preview');
    const shotPreviewImg = Util.$('#utr-shot-preview-img');
    const shotRemove = Util.$('#utr-shot-remove');
    const shotDrop = Util.$('.shot-drop');
    const renderShotPreview = file => {
      if (!shotPreview || !shotPreviewImg) return;
      if (!file) { shotPreview.hidden = true; if (shotDrop) shotDrop.hidden = false; shotPreviewImg.removeAttribute('src'); return; }
      try {
        const url = URL.createObjectURL(file);
        shotPreviewImg.src = url;
        shotPreview.hidden = false;
        if (shotDrop) shotDrop.hidden = true;
      } catch (e) { console.warn('Screenshot preview failed:', e); }
    };
    if (shotInput) {
      shotInput.addEventListener('change', () => renderShotPreview(shotInput.files && shotInput.files[0]));
    }
    if (shotRemove) {
      shotRemove.addEventListener('click', () => {
        if (shotInput) { shotInput.value = ''; }
        renderShotPreview(null);
      });
    }

    const copyBtn = Util.$('#upi-copy-vpa');
    if (copyBtn) copyBtn.onclick = async () => {
      try { await navigator.clipboard.writeText(vpa); Util.toast('UPI ID copied.', 'success'); }
      catch { Util.toast('Could not copy. Long-press to copy: ' + vpa, 'info'); }
    };

    const form = Util.$('#utr-form');
    if (form && !form.dataset.bound) {
      form.dataset.bound = '1';
      form.addEventListener('submit', async e => {
        e.preventDefault();
        if (!currentOrder) return;
        const status = Util.$('#utr-status');
        const btn = Util.$('#utr-submit');
        const utr = String(Util.$('#utr-input').value || '').trim();
        const note = String(Util.$('#utr-note').value || '').trim();
        const shotInput = Util.$('#utr-shot');
        const shotFile = shotInput && shotInput.files ? shotInput.files[0] : null;
        const fail = m => { if (status) { status.className = 'form-note err'; status.textContent = m; } };
        if (!/^[A-Za-z0-9]{8,22}$/.test(utr)) return fail('Enter a valid UTR / transaction reference (8–22 letters or digits).');
        if (pay().upiRequireScreenshot && !shotFile) return fail('Please attach your payment screenshot.');
        if (btn) btn.disabled = true;
        if (status) { status.className = 'form-note'; status.textContent = 'Submitting…'; }
        try {
          let shotData = '';
          if (shotFile) {
            // Compress and embed the screenshot as a data URL — no Storage bucket needed.
            let f = shotFile;
            if (shotFile.type && shotFile.type.startsWith('image/')) {
              try { f = await Util.compressImage(shotFile, 1000, 0.7); }
              catch (e) { console.warn('Screenshot compression failed; using original:', e); f = shotFile; }
            }
            shotData = await Util.fileToDataUrl(f);
            if (shotData.length > 950000) return fail('Screenshot is too large. Please crop it or take a smaller capture and retry.');
          }
          const patch = {
            utr,
            status: 'awaiting_verification',
            paymentMethod: 'manual_upi',
            upiVpaUsed: vpa,
            utrSubmittedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          if (note) patch.paymentNote = note;
          if (shotData) patch.paymentScreenshotData = shotData;
          await db.collection('orders').doc(currentOrder.id).update(patch);
          Util.toast('Payment proof submitted. We will verify shortly.', 'success');
          showDone('awaiting_verification');
        } catch (err) {
          console.error('UTR submit failed:', err);
          fail(Util.friendlyError(err));
        } finally { if (btn) btn.disabled = false; }
      });
    }
  };

  const showDone = status => {
    setBlock('pg-block-done');
    const title = Util.$('#pay-done-title');
    const text = Util.$('#pay-done-text');
    if (status === 'awaiting_verification') {
      if (title) title.textContent = '✅ Payment proof submitted';
      if (text) text.textContent = 'Thanks! We are verifying your payment. Your order moves to “processing” as soon as it is confirmed.';
    } else {
      if (title) title.textContent = '✅ Payment received';
      if (text) text.textContent = 'This order is already paid. You can track its progress from your orders page.';
    }
  };

  const render = async orderId => {
    if (!orderId) { location.hash = '#/orders'; return; }
    if (!State.user) {
      Util.toast('Sign in to complete payment.', 'info');
      Auth.openModal();
      location.hash = '#/orders';
      return;
    }
    try { await Data.loadSettings(); } catch (e) { /* non-fatal */ }
    try {
      const snap = await db.collection('orders').doc(orderId).get();
      if (!snap.exists) { Util.toast('Order not found.', 'error'); location.hash = '#/orders'; return; }
      const o = { id: snap.id, ...snap.data() };
      if (o.userId && State.user && o.userId !== State.user.uid) {
        Util.toast('That order does not belong to this account.', 'error');
        location.hash = '#/orders';
        return;
      }
      currentOrder = o;
      let tpl = null;
      if (o.templateId) { try { tpl = await Data.getTemplate(o.templateId); } catch (e) { console.warn('Template lookup for payment failed:', e); } }
      paintOrderCard(o, tpl);
      const sub = Util.$('#pay-gateway-sub');

      // Already handled states
      if (['paid', 'processing', 'completed', 'delivered'].includes(o.status)) { showDone('paid'); return; }
      if (o.status === 'awaiting_verification') { showDone('awaiting_verification'); return; }

      const m = mode();
      if (sub) sub.textContent = m === 'razorpay'
        ? 'Complete your purchase securely via Razorpay.'
        : 'Pay via UPI and submit your reference below.';
      if (m === 'razorpay') {
        setBlock('pg-block-razorpay');
        const btn = Util.$('#rzp-pay-btn');
        if (btn) btn.onclick = () => startRazorpay(o);
      } else {
        setBlock('pg-block-manual');
        bindManual(o, tpl);
      }
    } catch (e) {
      console.error('Payment render failed:', e);
      Util.showError(Util.$('#payment-view'), {
        title: 'Could not open payment',
        message: Util.friendlyError(e),
        onRetry: () => Payment.render(orderId)
      });
    }
  };

  return { render };
})();

// ==== SECTION: ROUTER + UI ====
const UI = (() => {
  const views = {
    home:      ['#hero', '.tier-switch', '#templates', '#pricing', '#reviews', '#contact'],
    templates: ['.tier-switch', '#templates'],
    pricing:   ['#pricing'],
    reviews:   ['#reviews'],
    contact:   ['#contact'],
    detail:    ['#detail-view'],
    checkout:  ['#checkout-view'],
    orders:    ['#orders-view'],
    payment:   ['#payment-view'],
    legal:     ['#legal-view']
  };
  const allSelectors = Array.from(new Set(Object.values(views).flat()));

  const showView = name => {
    if (!views[name]) name = 'home';
    allSelectors.forEach(s => { const n = Util.$(s); if (n) n.hidden = true; });
    (views[name] || views.home).forEach(s => { const n = Util.$(s); if (n) n.hidden = false; });
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); }
    Util.$$('.primary-nav a, .drawer-inner a').forEach(a => {
      a.classList.toggle('active', a.dataset.route === name);
    });
    if (name !== 'detail' && typeof Detail.resetSEO === 'function') Detail.resetSEO();
  };

  const parseHash = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const parts = h.split('/').filter(Boolean);
    return { root: parts[0] || 'home', param: parts[1] || '', sub: parts[2] || '' };
  };

  const showRoute = target => {
    if (target && target !== location.hash) { location.hash = target; return; }
    const { root, param } = parseHash();
    try {
      switch (root) {
        case '':
        case 'home':      showView('home'); break;
        case 'templates': showView('templates'); break;
        case 'pricing':   showView('pricing'); break;
        case 'reviews':   showView('reviews'); break;
        case 'contact':   showView('contact'); break;
        case 'template':  showView('detail'); Detail.render(param); break;
        case 'checkout':  showView('checkout'); Checkout.render(param); break;
        case 'orders':    showView('orders'); Orders.load(); break;
        case 'payment':   showView('payment'); Payment.render(param); break;
        case 'legal':     showView('legal'); Legal.render(param || 'about'); break;
        default:          showView('home');
      }
    } catch (e) {
      console.error('Route failed:', e);
      showView('home');
      Util.toast('That page could not be loaded.', 'error');
    }
  };

  const wireDrawer = () => {
    let lastFocus = null;
    const drawer = Util.$('#mobile-drawer');
    if (!drawer) return;
    const openDrawer = () => {
      lastFocus = document.activeElement;
      drawer.hidden = false;
      drawer.setAttribute('aria-hidden', 'false');
      const scrim = Util.$('#drawer-scrim');
      if (scrim) scrim.hidden = false;
      Util.$('#menu-toggle')?.setAttribute('aria-expanded', 'true');
      Util.$('#drawer-close')?.focus();
      document.body.style.overflow = 'hidden';
    };
    const closeDrawer = () => {
      drawer.setAttribute('aria-hidden', 'true');
      drawer.hidden = true;
      const scrim = Util.$('#drawer-scrim');
      if (scrim) scrim.hidden = true;
      Util.$('#menu-toggle')?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      if (lastFocus && document.contains(lastFocus)) { try { lastFocus.focus(); } catch {} }
      lastFocus = null;
    };
    Util.$('#menu-toggle')?.addEventListener('click', openDrawer);
    Util.$('#drawer-close')?.addEventListener('click', closeDrawer);
    Util.$('#drawer-scrim')?.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
    });
    Util.$$('.drawer-inner a').forEach(a => a.addEventListener('click', closeDrawer));
  };

  /* ================================================================
     v3 — CINEMATIC SCROLL ANIMATION ENGINE
     Single live IntersectionObserver + MutationObserver, so cards
     rendered async (templates, pricing, reviews) animate too.
     Staggered grids · directional slide-ins · blur-in headings ·
     hero load choreography · subtle pointer parallax.
     ================================================================ */
  const wireReveal = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---- Hero load choreography (fires immediately, staggered) ---- */
    const heroSeq = ['#hero-eyebrow', '#hero-headline', '#hero-sub', '.hero-cta', '.hero-highlights'];
    heroSeq.forEach((sel, i) => {
      const el = Util.$(sel);
      if (!el) return;
      if (reduced) return;
      el.classList.add('fx-hero');
      el.style.setProperty('--fx-delay', (120 + i * 130) + 'ms');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('fx-hero-in')));
    });
    const heroVisual = Util.$('.hero-visual');
    if (heroVisual && !reduced) {
      heroVisual.classList.add('fx-hero-scale');
      heroVisual.style.setProperty('--fx-delay', '380ms');
      requestAnimationFrame(() => requestAnimationFrame(() => heroVisual.classList.add('fx-hero-in')));
    }

    if (reduced || !('IntersectionObserver' in window)) {
      // Reduced motion / no IO: force-show anything pre-hidden, done.
      return;
    }

    /* ---- Live reveal observer ---- */
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('fx-visible', 'visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

    // Grids whose children should cascade in with a stagger
    const GRID_SEL = '#template-grid, #pricing-grid, .reviews-carousel, #hero-highlights, #detail-specs, #detail-pages, #detail-tech, .footer-grid';
    const CARD_SEL = '.tpl-card, .price-card, .review-card, .buy-box, .contact-form';

    const scan = () => {
      // 1) Grid children → staggered reveal
      Util.$$(GRID_SEL).forEach(grid => {
        if (!grid.children.length) return;
        Array.from(grid.children).forEach((child, i) => {
          if (child.dataset.fx) return;
          child.dataset.fx = '1';
          child.classList.add('fx-reveal');
          child.style.setProperty('--fx-delay', Math.min(i * 90, 540) + 'ms');
          io.observe(child);
        });
      });
      // 2) Standalone cards not inside a tagged grid
      Util.$$(CARD_SEL).forEach(el => {
        if (el.dataset.fx) return;
        el.dataset.fx = '1';
        el.classList.add('fx-reveal');
        io.observe(el);
      });
      // 3) Section headings → blur-in + tracking settle
      Util.$$('section h2, .section-head h2, .detail-body h2').forEach(h => {
        if (h.dataset.fx) return;
        h.dataset.fx = '1';
        h.classList.add('fx-heading');
        io.observe(h);
      });
      // 4) Directional slide-ins for paired layouts
      const lefts  = Util.$$('.contact-inner > div, .detail-media');
      const rights = Util.$$('.contact-form');
      lefts.forEach(el => {
        if (el.dataset.fx) return;
        el.dataset.fx = '1'; el.classList.add('fx-reveal', 'fx-left'); io.observe(el);
      });
      rights.forEach(el => {
        if (el.dataset.fx) return;
        el.dataset.fx = '1'; el.classList.add('fx-reveal', 'fx-right'); io.observe(el);
      });
      // 5) Section intros / subtitles → soft zoom
      Util.$$('.section-sub, .reviews-sub, .reviews-eyebrow, .tier-tabs').forEach(el => {
        if (el.dataset.fx) return;
        el.dataset.fx = '1'; el.classList.add('fx-reveal', 'fx-zoom'); io.observe(el);
      });
    };

    scan();
    // Re-scan whenever Firestore renders new DOM (templates/pricing/reviews)
    const mo = new MutationObserver(() => scan());
    const main = Util.$('#main');
    if (main) mo.observe(main, { childList: true, subtree: true });

    /* ---- Subtle pointer parallax on the hero visual ---- */
    if (heroVisual && !Util.$('.hero')?.dataset.fxPar) {
      const hero = Util.$('.hero');
      hero.dataset.fxPar = '1';
      let raf = null;
      hero.addEventListener('pointermove', (e) => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          const r = hero.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - .5;
          const y = (e.clientY - r.top) / r.height - .5;
          heroVisual.style.transform = `translate3d(${x * 14}px, ${y * 10}px, 0)`;
          raf = null;
        });
      }, { passive: true });
      hero.addEventListener('pointerleave', () => { heroVisual.style.transform = ''; }, { passive: true });
    }
  };

  // v2: magnetic-cursor spotlight for template cards + pricing cards
  const wireCardSpotlight = () => {
    const attach = (el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        el.style.setProperty('--my', ((e.clientY - r.top)  / r.height * 100) + '%');
      }, { passive: true });
      el.addEventListener('pointerleave', () => {
        el.style.setProperty('--mx', '50%');
        el.style.setProperty('--my', '-20%');
      });
    };
    // Delegate — re-scan on DOM changes
    const scan = () => {
      Util.$$('.tpl-card:not([data-spot]), .price-card:not([data-spot])').forEach(el => {
        el.setAttribute('data-spot', '1');
        attach(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });
  };

  const wireRipple = () => {
    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty('--rx', `${e.clientX - rect.left}px`);
      btn.style.setProperty('--ry', `${e.clientY - rect.top}px`);
    });
    document.addEventListener('pointermove', e => {
      const btn = e.target.closest('.btn-primary, .btn-ghost');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty('--rx', `${e.clientX - rect.left}px`);
      btn.style.setProperty('--ry', `${e.clientY - rect.top}px`);
    }, { passive: true });
  };

  const applyBrand = () => {
    const brand = State.settings?.brandName || 'DUDE';
    Util.$$('[data-brand]').forEach(n => n.textContent = brand);
    if (State.settings?.accentColor && /^#[0-9a-fA-F]{6}$/.test(State.settings.accentColor)) {
      document.documentElement.style.setProperty('--accent', State.settings.accentColor);
    }
    const logoUrl = Util.safeUrl(State.settings?.logoUrl);
    if (logoUrl) {
      const orgLD = document.getElementById('ld-org');
      if (orgLD) orgLD.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: brand, logo: logoUrl });
    }
    const blurb = Util.$('#footer-blurb');
    if (blurb) blurb.textContent = `${brand} — a curated marketplace of student portfolio websites, built with care by the people who ship the web.`;
    const yr = Util.$('#footer-year');
    if (yr) yr.textContent = new Date().getFullYear();

    const social = Util.$('#footer-social');
    if (social) {
      social.innerHTML = '';
      const s = State.settings?.socialLinks || {};
      Object.entries(s).forEach(([k, v]) => {
        const href = Util.safeUrl(v);
        if (!href) return;
        const a = Util.el('a', { href, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${brand} on ${k}` });
        a.textContent = k.charAt(0).toUpperCase();
        social.appendChild(a);
      });
    }
  };

  return { showRoute, showView, wireDrawer, wireReveal, wireRipple, wireCardSpotlight, applyBrand };
})();

// ==== SECTION: LEGAL ====
const Legal = (() => {
  const titles = { terms: 'Terms of Service', privacy: 'Privacy Policy' };
  const render = which => {
    try {
      const body = Util.$('#legal-body');
      if (!body) return;
      body.innerHTML = '';
      const brand = State.settings?.brandName || 'DUDE';
      const title = which === 'about' ? `About ${brand}` : (titles[which] || 'Legal');
      const content = (State.settings?.legal || {})[which] || defaultLegal(which);
      body.appendChild(Util.el('h1', { id: 'legal-title' }, title));
      String(content).split(/\n{2,}/).forEach(para => body.appendChild(Util.el('p', {}, para)));
    } catch (e) {
      console.error('Legal render failed:', e);
      Util.showError(Util.$('#legal-body'), {
        title: 'This page could not be displayed',
        message: Util.friendlyError(e),
        onRetry: () => Legal.render(which)
      });
    }
  };
  const defaultLegal = w => {
    const brand = State.settings?.brandName || 'DUDE';
    return ({
      terms: `By purchasing a template on ${brand} you receive a non-exclusive, non-transferable license to use, modify and deploy the code for a single portfolio.\n\nSource code, images and copy remain the intellectual property of ${brand} and its designers. Reselling templates as-is is prohibited.\n\nRefunds are considered case-by-case within seven days of purchase, provided the template has not been substantially customized or deployed.`,
      privacy: `We collect the personal information you submit at checkout (name, email, phone, résumé and any custom-form responses) solely to deliver your order and provide support.\n\nPayments are processed via UPI or Razorpay; we never store your card details. Files you upload are stored securely in our database and are accessible only to you and our support team.\n\nYou may request deletion of your data at any time by contacting support.`,
      about: `${brand} is a portfolio-website marketplace built by developers for students entering the industry.\n\nEvery template is hand-coded, accessible, responsive, and shipped with source. No page-builder lock-in. No ad-supported free tier. Just clean websites you own.`
    })[w] || 'Content coming soon.';
  };
  return { render };
})();

// ==== SECTION: CONTACT FORM ====
const Contact = (() => {
  // Normalise to E.164-ish digits so admin can build a clean wa.me link.
  const normaliseWhatsApp = raw => {
    const s = String(raw || '').trim();
    if (!s) return '';
    // Keep leading +, strip everything else non-digit.
    const hasPlus = s.startsWith('+');
    const digits = s.replace(/[^0-9]/g, '');
    return hasPlus ? `+${digits}` : digits;
  };

  const wire = () => {
    const form = Util.$('#contact-form');
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const status = Util.$('#contact-status');
      if (status) status.className = 'form-note';
      const name = String(fd.get('name') || '').trim();
      const email = String(fd.get('email') || '').trim();
      const whatsappRaw = String(fd.get('whatsapp') || '').trim();
      const whatsapp = normaliseWhatsApp(whatsappRaw);
      const message = String(fd.get('message') || '').trim();

      // Validate: name, email, message required; WhatsApp must contain 7-15 digits.
      const waDigits = whatsapp.replace(/[^0-9]/g, '');
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message || waDigits.length < 7 || waDigits.length > 15) {
        if (status) {
          status.className = 'form-note err';
          status.textContent = !whatsapp || waDigits.length < 7
            ? 'Please enter a valid WhatsApp number with country code.'
            : 'Please fill all fields with a valid email.';
        }
        return;
      }
      const btn = e.target.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        await db.collection('contactMessages').add({
          name, email, whatsapp, whatsappRaw, message,
          userId: State.user?.uid || null,
          status: 'new',
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        e.target.reset();
        if (status) {
          status.className = 'form-note ok';
          status.textContent = 'Thanks — we\'ll be in touch on WhatsApp within one business day.';
        }
      } catch (err) {
        console.error('Contact form failed:', err);
        if (status) {
          status.className = 'form-note err';
          status.textContent = 'Could not send. Please try again in a moment.';
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  };
  return { wire };
})();

// ==== SECTION: BOOTSTRAP ====
(async function boot() {
  /* CLICK-FIX v10: force every overlay into a truly hidden state at boot.
     Some browsers/extensions restore form/attr state on reload; the CSS
     [hidden]{display:none!important} now guards this too, but belt-and-braces. */
  try {
    ['modal-scrim','auth-modal','zoom-modal','drawer-scrim','mobile-drawer','account-menu','dude-bot-panel']
      .forEach(id => { const n = document.getElementById(id); if (n) n.setAttribute('hidden', ''); });
    document.body.style.overflow = '';
  } catch (_) {}
  try {
    await Data.loadSettings();
    UI.applyBrand();
    await Data.loadCategories();

    // Initial active category — from URL param if valid, else the first
    let urlCat = null;
    try { urlCat = new URLSearchParams(location.search).get('category'); } catch {}
    const match = State.categories.find(c => c.slug === urlCat || c.id === urlCat);
    State.activeCategoryId = (match || State.categories[0])?.id || null;

    if (State.categories.length) {
      const cat = State.categories.find(c => c.id === State.activeCategoryId);
      Home.applyHero(cat);
      Home.renderTabs();
      Home.renderPricing();
    } else {
      Home.applyHero(null);
      const grid = Util.$('#template-grid');
      const pgrid = Util.$('#pricing-grid');
      if (grid) grid.appendChild(Util.el('div', { class: 'empty-state' }, 'No templates are published yet. Check back soon.'));
      if (pgrid) pgrid.appendChild(Util.el('div', { class: 'empty-state' }, 'Pricing will appear here once tiers are configured.'));
    }

    Home.renderReviewsStrip();
    Home.renderContact();

    Auth.wire();
    Templates.wire();
    Contact.wire();
    UI.wireDrawer();
    UI.wireRipple();
    UI.wireCardSpotlight();

    if (State.activeCategoryId) {
      await Templates.load();
    }

    UI.wireReveal();

    window.addEventListener('hashchange', () => UI.showRoute());
    // CLICK-FIX v10: navigation safety net. If a hash change ever gets
    // coalesced/dropped (mobile browsers under load), re-render the route
    // shortly after the tap so no navigation click ever appears "dead".
    let lastHash = location.hash;
    document.addEventListener('click', e => {
      const a = e.target && e.target.closest ? e.target.closest('a[href^="#/"]') : null;
      if (!a) return;
      const href = a.getAttribute('href');
      if (!href || href === '#/') return;
      setTimeout(() => {
        try {
          if (location.hash === href && location.hash !== lastHash) UI.showRoute();
          lastHash = location.hash;
        } catch (_) {}
      }, 250);
    }, true);
    // Paint the initial route BEFORE marking boot done — ensures hidden state is correct.
    UI.showRoute();
    State.bootDone = true;
  } catch (err) {
    console.error('Boot failed:', err);
    Util.showError(Util.$('#main'), {
      title: 'DUDE could not load',
      message: Util.friendlyError(err),
      retryLabel: 'Reload',
      onRetry: () => location.reload()
    });
    Util.toast('Could not load. Please refresh.', 'error');
  }
})();

/* ============================================================
   DUDE-BOT — Chatbot Widget (funny, animated, sassy)
   Self-contained module. Depends only on Util.$ (optional).
   ============================================================ */
(() => {
  const $ = (s, c = document) => c.querySelector(s);

  const fab      = $('#dude-bot-fab');
  const panel    = $('#dude-bot-panel');
  const closeBtn = $('#dude-bot-close');
  const msgs     = $('#dude-bot-messages');
  const form     = $('#dude-bot-form');
  const input    = $('#dude-bot-input');
  const quick    = $('#dude-bot-quick');
  const badge    = $('#dude-bot-badge');

  if (!fab || !panel || !msgs || !form || !input) return; // widget not on page

  // ---- Personality: emoji reactions + funny sign-offs ----
  const HYPE = ['🚀','✨','🔥','💯','⚡','😎','🤙','🫡','💅','🥳','🧠','👀'];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // ---- Knowledge base (services / FAQ) — matched by keyword ----
  const KB = [
    {
      keys: ['hi','hello','hey','yo','sup','hola','namaste','hii','helloo'],
      reply: () => `Yooo! 👋 Welcome to <b>DUDE</b> — I'm DUDE-Bot, your slightly-too-caffeinated portfolio hype-man ${rand(HYPE)}<br><br>Ask me anything: <i>pricing</i>, <i>templates</i>, <i>delivery time</i>, <i>refunds</i>, or just say "surprise me" 😏`
    },
    {
      keys: ['what is dude','who are you','about','what do you do','what is this','company'],
      reply: () => `We're <b>DUDE</b> 💙 — a curated marketplace of ready-made <b>portfolio websites</b> handcrafted for students, freelancers & indie devs.<br><br>Basically: you pick 🖱️ → we deliver 📦 → you flex 💅. That's the whole vibe. ${rand(HYPE)}`
    },
    {
      keys: ['price','pricing','cost','how much','charge','fees','budget','₹','rupees','rate'],
      reply: () => `Money talk, respect. 💸<br><br>We've got <b>3 tiers</b>:<br>🟢 <b>Starter</b> — for the "I just need a link in my bio" crowd<br>🟣 <b>Pro</b> — animations, dark mode, projects grid, the works<br>🔥 <b>Ultimate</b> — full-blown cinematic portfolio, custom domain-ready<br><br>Hit the <b>Pricing</b> page for exact numbers 👉 <a href="#/pricing">See pricing</a>`
    },
    {
      keys: ['template','templates','designs','themes','portfolio','samples','preview','demo'],
      reply: () => `Ohh you wanna window-shop? 👀 Say less.<br><br>We've got templates for <b>devs, designers, students, creators & photographers</b> — each one editable, source-code included, no page-builder nonsense.<br><br>Peek here 👉 <a href="#/templates">Browse templates</a> ${rand(HYPE)}`
    },
    {
      keys: ['delivery','deliver','how long','time','when','fast','quick','eta','duration'],
      reply: () => `Speedrun mode: 🏁<br>• <b>Instant</b> — most templates ship right after payment 📥<br>• <b>Custom tweaks</b> — usually <b>24–48 hrs</b><br>• <b>Full custom builds</b> — 3–7 days depending on chaos level 🌀<br><br>Basically faster than your Wi-Fi on a rainy day. ${rand(HYPE)}`
    },
    {
      keys: ['payment','pay','razorpay','upi','card','gpay','phonepe','method','checkout'],
      reply: () => `We accept <b>UPI</b> (GPay / PhonePe / Paytm — scan & pay, then drop your UTR) and, when the store enables it, <b>Razorpay</b> for cards & netbanking ✅💳📱<br><br>Zero sketchy links. Zero "brother send OTP". Just clean checkout. 🫡`
    },
    {
      keys: ['refund','return','money back','cancel','not happy','issue'],
      reply: () => `We got you 🤝 — if a template has a bug we can't fix within the support window, you get a refund, no drama.<br><br>Digital goods so we can't just take it back like a t-shirt 😅 but genuine issues = genuine fix or refund. Promise. 💯`
    },
    {
      keys: ['custom','customize','change','edit','modify','personal','tailor','tweak'],
      reply: () => `Absolutely. 🛠️ Every template ships with <b>source code</b>, so you can:<br>• Change colors 🎨<br>• Swap fonts ✍️<br>• Add sections 🧩<br>• Break stuff and blame me 😌<br><br>Or we can customize it for you — mention it on the <a href="#/contact">Contact form</a>.`
    },
    {
      keys: ['support','help','contact','reach','email','whatsapp','phone'],
      reply: () => `I'm right here dude 😎 — but for humans:<br>📧 Contact form: <a href="#/contact">Say hi</a><br>💬 WhatsApp available after checkout<br>⏱ Reply time: within <b>1 business day</b> (IST hours)`
    },
    {
      keys: ['tech','stack','html','css','js','react','next','framework','built with','technology'],
      reply: () => `Depends on the template, but mostly:<br>⚡ <b>HTML + CSS + Vanilla JS</b> (super fast, easy to host)<br>⚛️ Some templates ship in <b>React / Next.js</b><br>🎨 All responsive, dark-mode-friendly, accessibility respected 🫡`
    },
    {
      keys: ['host','deploy','vercel','netlify','github','domain','upload','put online'],
      reply: () => `Deploy anywhere 🌍 — <b>Vercel, Netlify, GitHub Pages, Cloudflare Pages</b>, or your own server. Templates are static-first so hosting is basically free 💸`
    },
    {
      keys: ['discount','coupon','offer','deal','sale','student'],
      reply: () => `Sneaky lil' bargain hunter 😏 — check the <b>Pricing</b> page for current offers. Student discounts drop randomly, so keep an eye on the site (or bribe me with cookies 🍪).`
    },
    {
      keys: ['review','reviews','rating','testimonial','feedback'],
      reply: () => `Real students shipped real portfolios and dropped ⭐⭐⭐⭐⭐ — peek at real ones here 👉 <a href="#/reviews">Reviews</a><br><br>Zero paid reviews. Zero bots. Just vibes. 🫶`
    },
    {
      keys: ['bug','error','broken','not working','issue','glitch','problem'],
      reply: () => `Yikes 🫥 — sorry about that. Ping us via <a href="#/contact">Contact</a> with a screenshot and we'll squish that bug faster than my patience for slow Wi-Fi 🐛🔨`
    },
    {
      keys: ['thank','thanks','ty','thx','appreciate','love'],
      reply: () => `Awwwww 🥹💙 Go build something dangerously beautiful, okay? ${rand(HYPE)}`
    },
    {
      keys: ['bye','goodbye','see you','later','peace','ttyl'],
      reply: () => `Peace out ✌️ Come back when you need a portfolio that slaps. ${rand(HYPE)}`
    },
    {
      keys: ['joke','funny','make me laugh','bored'],
      reply: () => {
        const jokes = [
          "Why do devs prefer dark mode? Because light attracts bugs 🪲💡",
          "A CSS selector walks into a bar. Doesn't find a match. 😔",
          "There are 10 kinds of people: those who understand binary, and those who don't. 🧠",
          "My portfolio is like my ex — beautiful but unresponsive. That's why you should buy one from DUDE. 😎"
        ];
        return rand(jokes);
      }
    },
    {
      keys: ['surprise me','random','something cool','fun fact'],
      reply: () => `Fun fact 🤓: the first website ever made is <i>still online</i> — <a href="http://info.cern.ch/" target="_blank" rel="noopener">info.cern.ch</a>. Yours will look 1000x cooler with DUDE. 🚀`
    }
  ];

  const fallback = () => {
    const options = [
      `Hmm 🤔 didn't fully catch that. Try asking about <b>pricing</b>, <b>templates</b>, <b>delivery</b>, <b>refunds</b>, or <b>support</b> ${rand(HYPE)}`,
      `My tiny bot brain 🧠 short-circuited on that one. Wanna try: "what do you do?", "show templates", or "how much?"`,
      `Bruh I need more context 😅 — or hit <a href="#/contact">Contact</a> to talk to an actual human ${rand(HYPE)}`
    ];
    return rand(options);
  };

  const findReply = (text) => {
    const t = (text || '').toLowerCase().trim();
    if (!t) return fallback();
    // exact word/keyword match first
    for (const entry of KB) {
      if (entry.keys.some(k => t.includes(k))) return entry.reply();
    }
    return fallback();
  };

  // ---- Message rendering with typing animation ----
  const scrollBottom = () => { msgs.scrollTop = msgs.scrollHeight; };

  const addUserMsg = (text) => {
    const wrap = document.createElement('div');
    wrap.className = 'dude-bot-msg dude-bot-msg-user';
    wrap.innerHTML = `<div class="dude-bot-bubble">${escapeHtml(text)}</div>`;
    msgs.appendChild(wrap);
    scrollBottom();
  };

  const addBotTyping = () => {
    const wrap = document.createElement('div');
    wrap.className = 'dude-bot-msg dude-bot-msg-bot dude-bot-typing';
    wrap.innerHTML = `
      <div class="dude-bot-avatar-mini">🤖</div>
      <div class="dude-bot-bubble dude-bot-bubble-bot">
        <span class="dude-bot-dot"></span>
        <span class="dude-bot-dot"></span>
        <span class="dude-bot-dot"></span>
      </div>`;
    msgs.appendChild(wrap);
    scrollBottom();
    return wrap;
  };

  const addBotMsg = (html) => {
    const wrap = document.createElement('div');
    wrap.className = 'dude-bot-msg dude-bot-msg-bot';
    wrap.innerHTML = `
      <div class="dude-bot-avatar-mini">🤖</div>
      <div class="dude-bot-bubble dude-bot-bubble-bot"></div>`;
    const bubble = wrap.querySelector('.dude-bot-bubble-bot');
    msgs.appendChild(wrap);
    typeInto(bubble, html);
    scrollBottom();
  };

  // Char-by-char typing that supports HTML (streams safe HTML)
  const typeInto = (el, html) => {
    el.innerHTML = '';
    let i = 0;
    let inTag = false;
    let buffer = '';
    const speed = 12; // ms per char
    const step = () => {
      if (i >= html.length) { scrollBottom(); return; }
      const ch = html[i];
      if (ch === '<') inTag = true;
      buffer += ch;
      if (ch === '>') inTag = false;
      i++;
      el.innerHTML = buffer + (inTag ? '' : '<span class="dude-bot-caret"></span>');
      scrollBottom();
      setTimeout(step, inTag ? 0 : speed);
    };
    step();
    // remove caret at end
    setTimeout(() => { el.innerHTML = html; scrollBottom(); }, html.length * speed + 200);
  };

  const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));

  // ---- Handle send ----
  const respond = (userText) => {
    const typing = addBotTyping();
    const delay = 600 + Math.random() * 500;
    setTimeout(() => {
      typing.remove();
      addBotMsg(findReply(userText));
    }, delay);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addUserMsg(text);
    input.value = '';
    respond(text);
  });

  // ---- Quick chip buttons ----
  const QUICK = [
    { label: '💰 Pricing', q: 'pricing' },
    { label: '🎨 Templates', q: 'show templates' },
    { label: '⏱️ Delivery time', q: 'delivery' },
    { label: '↩️ Refunds', q: 'refund' },
    { label: '😂 Tell me a joke', q: 'joke' },
    { label: '📞 Contact', q: 'contact' }
  ];

  QUICK.forEach(({ label, q }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dude-bot-chip';
    b.textContent = label;
    b.addEventListener('click', () => {
      addUserMsg(label);
      respond(q);
    });
    quick.appendChild(b);
  });

  // ---- Open / close ----
  let opened = false;
  const openBot = () => {
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('is-open'));
    fab.setAttribute('aria-expanded', 'true');
    fab.classList.add('is-open');
    if (badge) badge.hidden = true;
    setTimeout(() => input.focus(), 350);
    if (!opened) {
      opened = true;
      // greeting
      setTimeout(() => addBotMsg(`Ayyyy 👋 Welcome to <b>DUDE</b>! I'm <b>DUDE-Bot</b> 🤖 — your 24/7 hype-man for portfolios ✨<br><br>Pick a quick option below 👇 or just <b>type</b> whatever's on your mind 💬`), 250);
    }
  };
  const closeBot = () => {
    panel.classList.remove('is-open');
    fab.classList.remove('is-open');
    fab.setAttribute('aria-expanded', 'false');
    setTimeout(() => { panel.hidden = true; }, 260);
  };

  fab.addEventListener('click', () => panel.hidden ? openBot() : closeBot());
  closeBtn.addEventListener('click', closeBot);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden) closeBot();
  });

  // Bubble hint auto-hide after a while
  setTimeout(() => { fab.classList.add('hint-fade'); }, 8000);
})();

/* ---- one-shot: give free-floating buttons outside <form> an explicit type.
   Never touches buttons inside forms (browser default = submit, correct). ---- */
(function stampLooseButtons(){
  try {
    document.querySelectorAll('button:not([type])').forEach(b => {
      if (b.closest('form')) return;               // leave form buttons alone
      b.setAttribute('type', 'button');
    });
  } catch (_) {}
})();
