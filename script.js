/* ============================================================
   DUDE — Customer site (FULLY FIXED v4)
   Fixes:
   - Templates now show for all users (public read w/ relaxed rules)
   - Categories load with graceful fallback (no index required)
   - Missing isActive treated as active (matches admin behavior)
   - Login-then-checkout flow preserves intent
   - Legal module properly hoisted / defined before route use
   - Buy Now requires auth; auto-resumes checkout after login
   - Reviews, pricing, contact all render on public page load
   - Robust error boundaries — one failure never breaks the whole page
   ============================================================ */

// ==== FIREBASE INIT ====
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
let storage = null;
try { storage = firebase.storage(); } catch (e) { console.warn('Storage unavailable:', e); }
let functions = null;
try { functions = firebase.functions(); } catch (e) { console.warn('Functions unavailable:', e); }

// ==== UTILITIES ====
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
    if (/storage\/unauthorized|storage\/unauthenticated/i.test(m)) return 'File upload is unavailable right now.';
    if (/index/i.test(m)) return 'A database index is still being built. Please try again shortly.';
    if (/permission|insufficient/i.test(m)) return 'You do not have permission to do that.';
    if (/offline|network|unavailable|failed to get/i.test(m)) return 'Network problem. Check your connection.';
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

  const fileToDataUrl = file => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('Could not read the file.'));
    r.readAsDataURL(file);
  });

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
          if (!blob) return reject(new Error('Image compression failed'));
          resolve(new File([blob], String(file.name || 'image').replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' }));
        }, 'image/jpeg', quality);
      } catch (err) { reject(err); }
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });

  return { $, $$, el, fmtINR, debounce, slug, safeUrl, hostOf, toast, stars, friendlyError, errorBox, showError, fileToDataUrl, compressImage };
})();

// ==== STATE ====
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
  bootDone: false,
  postLoginRoute: null   // FIX: remember intended route after login
};

// ==== DATA LAYER ====
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

  // FIX: No orderBy/where at all — fetch all categories, filter/sort client-side.
  // This avoids composite index requirements AND matches relaxed rules that treat
  // missing isActive as active.
  const loadCategories = async () => {
    try {
      const snap = await db.collection('categories').get();
      State.categories = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(c => c.isActive !== false)
        .map(c => ({ ...c, order: (typeof c.order === 'number' ? c.order : 9999) }))
        .sort((a, b) => (a.order - b.order) || String(a.name || '').localeCompare(String(b.name || '')));
    } catch (e) {
      console.error('Categories load failed:', e);
      State.categories = [];
    }
    return State.categories;
  };

  // FIX: Removed isActive from the WHERE clause. We fetch by category then
  // filter client-side (missing isActive counts as active). No composite index needed.
  const loadTemplatesPage = async (categoryId, sort) => {
    try {
      let items = [];
      if (categoryId) {
        const snap = await db.collection('templates')
          .where('categoryId', '==', categoryId)
          .limit(200).get();
        items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      } else {
        // No category selected → show ALL active templates so page never sits empty.
        const snap = await db.collection('templates').limit(200).get();
        items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      }
      items = items.filter(t => t.isActive !== false);

      if (sort === 'price_asc') items.sort((a, b) => (a.price || 0) - (b.price || 0));
      else if (sort === 'price_desc') items.sort((a, b) => (b.price || 0) - (a.price || 0));
      else if (sort === 'rating_desc') items.sort((a, b) => (b.rating?.average || 0) - (a.rating?.average || 0));
      else items.sort((a, b) => ((b.isFeatured ? 1 : 0) - (a.isFeatured ? 1 : 0)) || String(a.name || '').localeCompare(String(b.name || '')));

      return { items: items.slice(0, State.pageSize), end: items.length <= State.pageSize };
    } catch (e) {
      console.error('Template load failed:', e);
      throw e;
    }
  };

  const getTemplate = async id => {
    if (!id) return null;
    try {
      const snap = await db.collection('templates').doc(id).get();
      return snap.exists ? { id: snap.id, ...snap.data() } : null;
    } catch (e) {
      console.error('getTemplate failed:', e);
      return null;
    }
  };

  const getTemplatesBatch = async (ids = []) => {
    const unique = [...new Set(ids.filter(Boolean))];
    const result = {};
    if (!unique.length) return result;
    try {
      const snaps = await Promise.all(unique.map(id => db.collection('templates').doc(id).get().catch(() => null)));
      snaps.forEach(s => { if (s && s.exists) result[s.id] = { id: s.id, ...s.data() }; });
    } catch (e) {
      console.error('Batch template lookup failed:', e);
    }
    return result;
  };

  const loadFormFields = async categoryId => {
    try {
      const snap = await db.collection('customForms').get();
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
        .limit(cap).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    } catch (e) {
      console.error('Reviews load failed:', e);
      return [];
    }
  };

  const loadRecentReviews = async (cap = 12) => {
    try {
      const snap = await db.collection('reviews').where('status', '==', 'approved').limit(cap * 2).get();
      return snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))
        .slice(0, cap);
    } catch (e) {
      console.error('Recent reviews failed:', e);
      return [];
    }
  };

  const listenUserOrders = (uid, cb, errCb) => {
    try {
      return db.collection('orders').where('userId', '==', uid)
        .onSnapshot(
          snap => {
            const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
            cb(items);
          },
          err => {
            console.warn('Orders listener error:', err);
            if (typeof errCb === 'function') errCb(err);
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
      console.error('ensureUserDoc failed:', e);
    }
  };

  const isAdmin = async uid => {
    if (!uid) return false;
    try {
      const snap = await db.collection('admins').doc(uid).get();
      return snap.exists;
    } catch (e) {
      return false;
    }
  };

  return {
    loadSettings, loadCategories, loadTemplatesPage, getTemplate, getTemplatesBatch,
    loadFormFields, loadReviewsFor, loadRecentReviews,
    listenUserOrders, submitReview, ensureUserDoc, isAdmin
  };
})();

// ==== AUTH ====
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
    m.removeAttribute('hidden');
    scrim.removeAttribute('hidden');
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

  const isMenuOpen = () => {
    const menu = Util.$('#account-menu');
    return !!(menu && !menu.hidden);
  };
  const openAccountMenu = () => {
    const menu = Util.$('#account-menu');
    if (!menu) return;
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
    Util.$('#auth-btn')?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      if (State.user) {
        toggleAccountMenu();
      } else {
        closeAccountMenu();
        openModal();
      }
    });

    const goToOrders = () => {
      closeAccountMenu();
      location.hash = '#/orders';
      setTimeout(() => {
        const ov = Util.$('#orders-view');
        if (ov && ov.hidden) { try { UI.showRoute(); } catch {} }
      }, 150);
    };

    const doSignOut = async () => {
      closeAccountMenu();
      try {
        await auth.signOut();
        Util.toast('Signed out.', 'info');
        if (/^#\/(orders|checkout|payment)/.test(location.hash)) location.hash = '#/';
      } catch (err) {
        console.error('Sign-out failed:', err);
        Util.toast('Could not sign out.', 'error');
      }
    };

    Util.$('#account-orders-link')?.addEventListener('click', e => { e.preventDefault(); goToOrders(); });
    Util.$('#account-signout')?.addEventListener('click', e => { e.preventDefault(); doSignOut(); });

    document.addEventListener('click', e => {
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
        // FIX: Resume intended route after login (e.g., checkout)
        if (State.postLoginRoute) {
          const target = State.postLoginRoute;
          State.postLoginRoute = null;
          setTimeout(() => { location.hash = target; }, 100);
        }
      } catch (err) {
        console.error('Auth error:', err);
        const code = String(err && err.code || '');
        let msg = String(err && err.message || 'Sign-in failed').replace('Firebase: ', '');
        if (/invalid-credential|wrong-password|user-not-found/.test(code)) msg = 'Invalid email or password.';
        else if (/email-already-in-use/.test(code)) msg = 'Email already registered — try signing in.';
        else if (/weak-password/.test(code)) msg = 'Password must be at least 6 characters.';
        else if (/invalid-email/.test(code)) msg = 'Enter a valid email address.';
        else if (/too-many-requests/.test(code)) msg = 'Too many attempts. Please wait a minute.';
        else if (/network-request-failed/.test(code)) msg = 'Network problem.';
        if (status) { status.className = 'form-note err'; status.textContent = msg; }
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
        if (State.postLoginRoute) {
          const target = State.postLoginRoute;
          State.postLoginRoute = null;
          setTimeout(() => { location.hash = target; }, 100);
        }
      } catch (err) {
        console.error('Google sign-in error:', err);
        const code = String(err && err.code || '');
        if (/popup-closed-by-user|cancelled-popup-request/.test(code)) return;
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
          if (location.hash === '#/orders') {
            try { Orders.load(); } catch (e) { console.warn('Orders repaint failed:', e); }
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

// ==== HOME / CATEGORIES / PRICING / REVIEWS ====
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
    // Add "All" tab first
    const allBtn = Util.el('button', {
      type: 'button',
      class: 'tier-tab' + (!State.activeCategoryId ? ' active' : ''),
      role: 'tab',
      'aria-selected': !State.activeCategoryId ? 'true' : 'false',
      dataset: { id: '__all__' }
    }, 'All');
    tabs.appendChild(allBtn);
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
      const id = btn.dataset.id;
      setActiveCategory(id === '__all__' ? null : id);
    };
  };

  const renderPricing = () => {
    const grid = Util.$('#pricing-grid');
    if (!grid) return;
    grid.innerHTML = '';
    if (!State.categories.length) {
      grid.appendChild(Util.el('div', { class: 'empty-state' }, 'Pricing tiers will appear once categories are configured by admin.'));
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

  const _initialOf = (name) => {
    const s = String(name || '').trim();
    if (!s) return 'A';
    const m = s.match(/[\p{L}\p{N}]/u);
    return (m ? m[0] : s[0]).toUpperCase();
  };
  const _toneFor = (name) => {
    const s = String(name || 'Anonymous');
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    const tones = ['a','b','c','d','e','f','g','h'];
    return tones[Math.abs(h) % tones.length];
  };

  const _buildReviewCard = (r) => {
    const card = Util.el('div', { class: 'review-card', role: 'listitem' });
    card.appendChild(Util.el('div', { class: 'review-stars', 'aria-label': `${r.rating || 5} out of 5 stars` }, Util.stars(r.rating)));
    const cleanText = String(r.comment || '').replace(/^[\u201C\u201D"']+|[\u201C\u201D"']+$/g, '').trim();
    card.appendChild(Util.el('p', { class: 'review-text' }, cleanText));
    const author = Util.el('div', { class: 'review-author' });
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
    nameBlock.appendChild(Util.el('span', { class: 'review-author-role' }, r.userRole || r.templateName || 'Verified buyer'));
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
      const reviews = await Data.loadRecentReviews(12);
      if (!reviews.length) {
        box.appendChild(Util.el('p', { class: 'empty-state' }, 'Reviews coming soon.'));
        return;
      }
      const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const half = Math.ceil(reviews.length / 2);
      const rowA = reviews.slice(0, half);
      const rowB = reviews.slice(half).length ? reviews.slice(half) : rowA.slice().reverse();
      const rows = Util.el('div', { class: 'reviews-rows' });
      const buildTrack = (list, reverse) => {
        const track = Util.el('div', {
          class: 'reviews-marquee' + (reverse ? ' reverse' : ''),
          role: 'list'
        });
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
        reviews.forEach(r => box.appendChild(_buildReviewCard(r)));
      } else {
        rows.appendChild(buildTrack(rowA, false));
        if (rowB.length) rows.appendChild(buildTrack(rowB, true));
        box.appendChild(rows);
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

  // FIX: catId===null means "All"
  const setActiveCategory = catId => {
    if (catId === State.activeCategoryId) return;
    State.activeCategoryId = catId;
    const cat = catId ? State.categories.find(c => c.id === catId) : null;
    applyHero(cat);
    renderTabs();
    Templates.reset();
    Templates.load();
    try {
      const url = new URL(location.href);
      if (cat) url.searchParams.set('category', cat.slug || catId);
      else url.searchParams.delete('category');
      history.replaceState({}, '', url);
    } catch {}
  };

  return { applyHero, renderTabs, renderPricing, renderReviewsStrip, renderContact, setActiveCategory };
})();

// ==== TEMPLATES GRID ====
const Templates = (() => {
  let ended = false;

  const reset = () => {
    ended = false;
    const grid = Util.$('#template-grid');
    const pager = Util.$('#pager');
    if (grid) grid.innerHTML = '';
    if (pager) pager.innerHTML = '';
    const lm = Util.$('#load-more');
    if (lm) { lm.disabled = false; lm.textContent = 'Load more'; lm.style.display = 'none'; }
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
      card.appendChild(Util.el('div', { class: 'tpl-body' },
        Util.el('div', { class: 'skeleton sk-line' }),
        Util.el('div', { class: 'skeleton sk-line short' }),
        Util.el('div', { class: 'skeleton sk-line' })
      ));
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

  const load = async () => {
    skeleton();
    try {
      const { items } = await Data.loadTemplatesPage(State.activeCategoryId, State.currentSort);
      const grid = Util.$('#template-grid');
      if (!grid) return;
      grid.innerHTML = '';
      if (!items.length) {
        grid.appendChild(Util.el('div', { class: 'empty-state' },
          State.activeCategoryId
            ? 'No templates in this category yet.'
            : 'No templates published yet. Check back soon.'));
        return;
      }
      items.forEach(t => grid.appendChild(cardFor(t)));
    } catch (e) {
      console.error('Template grid load failed:', e);
      Util.showError(Util.$('#template-grid'), {
        title: 'Could not load templates',
        message: Util.friendlyError(e),
        onRetry: () => { reset(); load(); }
      });
    }
  };

  // FIX: Handle Buy Now with authentication requirement.
  const handleBuy = (id) => {
    if (!State.user) {
      State.postLoginRoute = `#/checkout/${id}`;
      Util.toast('Please sign in to buy this template.', 'info');
      Auth.openModal();
      return;
    }
    location.hash = `#/checkout/${id}`;
  };

  const wire = () => {
    Util.$('#template-grid')?.addEventListener('click', async e => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (!id) return;
      if (btn.dataset.action === 'view') location.hash = `#/template/${id}`;
      else if (btn.dataset.action === 'buy') handleBuy(id);
    });
    const lm = Util.$('#load-more');
    if (lm) lm.style.display = 'none';
  };

  return { reset, load, wire, handleBuy };
})();

// ==== TEMPLATE DETAIL ====
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
        const nm = r.userName || 'Anonymous';
        const initial = (String(nm).trim().match(/[\p{L}\p{N}]/u) || ['A'])[0].toUpperCase();
        let h = 0; for (let i = 0; i < nm.length; i++) h = ((h << 5) - h + nm.charCodeAt(i)) | 0;
        const tone = ['a','b','c','d','e','f','g','h'][Math.abs(h) % 8];
        const c = Util.el('div', { class: 'review-card' });
        c.appendChild(Util.el('div', { class: 'review-stars' }, Util.stars(r.rating)));
        const cleanText = String(r.comment || '').replace(/^[\u201C\u201D"']+|[\u201C\u201D"']+$/g, '').trim();
        c.appendChild(Util.el('p', { class: 'review-text' }, cleanText));
        const author = Util.el('div', { class: 'review-author' });
        const avatar = Util.el('div', {
          class: 'review-avatar', 'aria-hidden': 'true', dataset: { tone }, title: nm
        }, initial);
        author.appendChild(avatar);
        const nameBlock = Util.el('div', { class: 'review-author-name' });
        nameBlock.appendChild(document.createTextNode(nm));
        nameBlock.appendChild(Util.el('span', { class: 'review-author-role' }, r.userRole || 'Verified buyer'));
        author.appendChild(nameBlock);
        author.appendChild(Util.el('span', { class: 'verified-badge' }, '✓ Verified'));
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
  };
  const resetSEO = () => {
    const brand = State.settings?.brandName || 'DUDE';
    document.title = `${brand} — Portfolio Websites for People Who Build the Web`;
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
        if (demoHref) { demo.href = demoHref; demo.style.display = ''; }
        else { demo.removeAttribute('href'); demo.style.display = 'none'; }
      }
      // FIX: Buy Now requires auth check on detail page too
      const buyBtn = Util.$('#buy-now');
      if (buyBtn) buyBtn.onclick = () => Templates.handleBuy(t.id);

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

// ==== CHECKOUT ====
const Checkout = (() => {
  let currentTemplate = null;
  let fields = [];
  let uploads = {};
  let pendingOrderId = null;

  const FILE_RULES = {
    image: { accept: 'image/*', maxSize: 5 * 1024 * 1024, types: /^image\//, hint: 'PNG/JPG/WebP up to 5 MB' },
    file:  { accept: '.pdf,.doc,.docx,.zip,image/*', maxSize: 700 * 1024, types: /^(image\/|application\/(pdf|zip|x-zip-compressed|msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document))/, hint: 'PDF/DOC/ZIP up to 700 KB' }
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
        control = Util.el('textarea', { id: `f_${f.id}`, name: f.id, rows: 4, placeholder: f.placeholder || '' });
        break;
      case 'select':
        control = Util.el('select', { id: `f_${f.id}`, name: f.id });
        control.appendChild(Util.el('option', { value: '' }, 'Select…'));
        (f.options || []).forEach(o => control.appendChild(Util.el('option', { value: o }, o)));
        break;
      case 'checkbox': {
        control = Util.el('fieldset', { class: 'checkbox-row', role: 'group' });
        (f.options && f.options.length ? f.options : [f.label]).forEach((o, i) => {
          const inputId = `f_${f.id}_${i}`;
          control.appendChild(Util.el('label', { for: inputId },
            Util.el('input', { type: 'checkbox', id: inputId, name: f.id, value: o }),
            document.createTextNode(' ' + o)));
        });
        break;
      }
      case 'radio': {
        control = Util.el('fieldset', { class: 'radio-row', role: 'radiogroup' });
        (f.options || []).forEach((o, i) => {
          const inputId = `f_${f.id}_${i}`;
          control.appendChild(Util.el('label', { for: inputId },
            Util.el('input', { type: 'radio', id: inputId, name: f.id, value: o }),
            document.createTextNode(' ' + o)));
        });
        break;
      }
      case 'file':
      case 'image': {
        const rules = FILE_RULES[f.type] || FILE_RULES.file;
        control = Util.el('div', {
          class: 'file-drop', tabindex: 0, role: 'button', dataset: { fid: f.id }
        },
          Util.el('div', {}, `Click or drop your ${f.type} here (${rules.hint})`),
          Util.el('div', { class: 'file-name' }, ''));
        const fileInput = Util.el('input', {
          type: 'file', id: `f_${f.id}`, name: f.id, accept: rules.accept, style: 'display:none'
        });
        control.appendChild(fileInput);
        const setErr = msg => {
          const errBox = Util.$(`[data-err="${f.id}"]`);
          if (errBox) errBox.textContent = msg || '';
        };
        const accept = (file) => {
          if (!file) return;
          if (!rules.types.test(file.type)) { setErr(`Invalid file type.`); wrap.classList.add('error'); return; }
          if (file.size > rules.maxSize) { setErr(`File too large.`); wrap.classList.add('error'); return; }
          uploads[f.id] = file;
          setErr(''); wrap.classList.remove('error');
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
          accept(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
        });
        fileInput.addEventListener('change', () => accept(fileInput.files[0]));
        break;
      }
      case 'date':
        control = Util.el('input', { type: 'date', id: `f_${f.id}`, name: f.id }); break;
      case 'email':
        control = Util.el('input', { type: 'email', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || '' }); break;
      case 'phone':
        control = Util.el('input', { type: 'tel', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || '' }); break;
      case 'url':
        control = Util.el('input', { type: 'url', id: `f_${f.id}`, name: f.id, placeholder: 'https://…' }); break;
      default:
        control = Util.el('input', { type: 'text', id: `f_${f.id}`, name: f.id, placeholder: f.placeholder || '' });
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
    };
    fields.forEach(f => {
      const errBox = Util.$(`[data-err="${f.id}"]`);
      if (errBox) errBox.textContent = '';
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
      if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) mark(f, 'Enter a valid email.');
      else if (f.type === 'url' && !Util.safeUrl(val)) mark(f, 'Enter a valid URL.');
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
    box.appendChild(Util.el('p', { class: 'field-hint' }, 'Final amount confirmed on payment screen.'));

    const btn = Util.el('button', { class: 'btn btn-primary btn-lg', id: 'proceed-pay', type: 'button' }, 'Proceed to pay');
    box.appendChild(btn);
    btn.addEventListener('click', submit);
  };

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
        throw new Error(`"${file.name}" is too large. Please upload a smaller file.`);
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
      if (!['draft', 'payment_pending'].includes(o.status)) return;
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
    if (!State.user) {
      State.postLoginRoute = location.hash;
      Auth.openModal();
      return;
    }
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

      btn.textContent = 'Opening payment…';
      try { await Data.loadSettings(); } catch (e) {}
      const payCfg = (State.settings && State.settings.payment) || {};
      const gatewayMode = payCfg.mode || 'manual_upi';

      if (gatewayMode !== 'razorpay') {
        await orderRef.update({
          status: 'payment_pending',
          paymentMethod: 'manual_upi',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        pendingOrderId = null;
        Util.toast('Order created — complete your UPI payment.', 'success');
        location.hash = `#/payment/${orderRef.id}`;
        restorePayBtn();
        return;
      }

      // Razorpay flow
      if (!functions) throw new Error('Online payments are not configured yet.');
      let res;
      try {
        res = await functions.httpsCallable('createOrder')({ orderId: orderRef.id, templateId: t.id });
      } catch (fnErr) {
        console.error('createOrder failed:', fnErr);
        throw new Error('Online payment could not be initialised.');
      }
      const { razorpay_order_id, key_id, amount, currency } = res.data || {};
      if (!razorpay_order_id || !key_id || !amount) throw new Error('Payment could not be initialized.');
      pendingOrderId = null;

      if (typeof Razorpay === 'undefined') throw new Error('Payment gateway unavailable.');

      const rzp = new Razorpay({
        key: key_id, amount, currency: currency || 'INR',
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
            await functions.httpsCallable('verifyPayment')({
              orderId: orderRef.id,
              razorpay_order_id: resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature: resp.razorpay_signature
            });
            Util.toast('Payment verified.', 'success');
            location.hash = '#/orders';
          } catch (err) {
            console.error('verifyPayment failed:', err);
            Util.toast('Payment verification failed. Contact support with your order id.', 'error');
            location.hash = '#/orders';
          }
        },
        modal: { ondismiss: () => { Util.toast('Payment window closed.', 'info'); restorePayBtn(); } }
      });
      rzp.on('payment.failed', (resp) => {
        console.error('Razorpay failed:', resp && resp.error);
        Util.toast('Payment failed. No money captured.', 'error');
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
      // FIX: Auth guard — remember intent, then redirect after login
      if (!State.user) {
        State.postLoginRoute = `#/checkout/${templateId}`;
        Util.toast('Please sign in to check out.', 'info');
        Auth.openModal();
        location.hash = `#/template/${templateId}`;
        return;
      }
      const t = await Data.getTemplate(templateId);
      if (!t || t.isActive === false) {
        Util.toast(t ? 'Template unavailable.' : 'Template not found.', 'error');
        location.hash = '#/templates';
        return;
      }
      currentTemplate = t;
      uploads = {};
      pendingOrderId = null;

      fields = await Data.loadFormFields(t.categoryId);
      State.customForm = fields;

      const form = Util.$('#checkout-form');
      if (form) {
        form.innerHTML = '';
        if (!fields.length) {
          form.appendChild(Util.el('p', { class: 'empty-state' }, 'No extra info needed — proceed to payment.'));
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

// ==== ORDERS ====
const Orders = (() => {
  let unsub = null;
  let templateCache = {};
  let lastOrders = [];

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
      empty.appendChild(Util.el('p', {}, 'When you grab a template, its download link and progress will show up here.'));
      empty.appendChild(Util.el('a', { class: 'btn btn-primary btn-lg', href: '#/templates', style: 'max-width:280px;margin:8px auto 0' }, 'Browse templates'));
      box.appendChild(empty);
      return;
    }
    try {
      const missing = orders.map(o => o.templateId).filter(id => id && !templateCache[id]);
      if (missing.length) Object.assign(templateCache, await Data.getTemplatesBatch(missing));
    } catch (e) {}

    for (const o of orders) {
      const t = o.templateId ? templateCache[o.templateId] : null;
      const title = o.templateName || (t && t.name) || 'Template order';
      const card = Util.el('div', { class: 'order-card' });
      const head = Util.el('div', { class: 'order-head' });
      head.appendChild(Util.el('h3', {}, title));
      head.appendChild(Util.el('span', { class: `status-pill status-${o.status || 'draft'}` }, String(o.status || 'draft').replace(/_/g, ' ')));
      card.appendChild(head);

      if (!HIDE_TIMELINE.includes(o.status)) {
        card.appendChild(timelineFor(o));
      } else if (['payment_created', 'payment_pending'].includes(o.status)) {
        card.appendChild(Util.el('p', { class: 'field-hint' }, 'Awaiting payment confirmation.'));
        const payBtn = Util.el('a', { class: 'btn btn-primary', href: `#/payment/${o.id}` }, 'Complete payment');
        card.appendChild(payBtn);
      } else if (o.status === 'draft') {
        card.appendChild(Util.el('p', { class: 'field-hint' }, 'Draft order — payment not initiated.'));
      }

      const meta = Util.el('div', { class: 'order-meta' });
      meta.appendChild(Util.el('span', {}, `Order #${o.id.slice(0, 8)}`));
      if (o.amount != null) meta.appendChild(Util.el('span', {}, `${Util.fmtINR(o.amount)}`));
      if (o.updatedAt?.toDate) meta.appendChild(Util.el('span', {}, `Updated ${o.updatedAt.toDate().toLocaleDateString()}`));
      card.appendChild(meta);

      if (o.adminNotes) {
        const note = Util.el('p', { style: 'margin-top:12px;color:var(--text-muted)' });
        note.appendChild(Util.el('strong', {}, 'Note from support: '));
        note.appendChild(document.createTextNode(String(o.adminNotes)));
        card.appendChild(note);
      }

      box.appendChild(card);
    }
  };

  const load = async () => {
    const box = Util.$('#orders-list');
    if (!box) return;
    if (!State.user) {
      box.innerHTML = '';
      const wrap = Util.el('div', { class: 'empty-state orders-empty' });
      wrap.appendChild(Util.el('div', { class: 'empty-icon' }, '📦'));
      wrap.appendChild(Util.el('h3', {}, 'Sign in to see your orders'));
      wrap.appendChild(Util.el('p', {}, 'Your portfolio purchases live here.'));
      const btn = Util.el('button', { type: 'button', class: 'btn btn-primary btn-lg', style: 'max-width:280px;margin:8px auto 0' }, 'Sign in');
      btn.addEventListener('click', () => Auth.openModal());
      wrap.appendChild(btn);
      box.appendChild(wrap);
      return;
    }
    if (lastOrders && lastOrders.length) { await paint(lastOrders); return; }
    try {
      const snap = await db.collection('orders').where('userId', '==', State.user.uid).limit(50).get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
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

// ==== PAYMENT ====
const Payment = (() => {
  let currentOrder = null;

  const pay = () => (State.settings && State.settings.payment) || {};
  const mode = () => pay().mode || 'manual_upi';

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
    const title = o.templateName || (t && t.name) || 'Template order';
    card.appendChild(Util.el('div', { class: 'summary-line' }, Util.el('span', {}, title), Util.el('span', {}, `#${String(o.id).slice(0, 8)}`)));
    const amt = amountOf(o, t);
    if (amt != null) {
      card.appendChild(Util.el('div', { class: 'summary-line total' }, Util.el('span', {}, 'Total'), Util.el('span', {}, Util.fmtINR(amt))));
    }
    card.appendChild(Util.el('p', { class: 'field-hint' }, 'Your files & brief are saved. Complete payment to confirm.'));
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

    const note = `Order ${String(o.id).slice(0, 8)}`;
    const upiUrl = vpa
      ? `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name || 'Merchant')}${amt != null ? `&am=${encodeURIComponent(amt)}&cu=INR` : ''}&tn=${encodeURIComponent(note)}`
      : '';
    const payAppBtn = Util.$('#upi-pay-app');
    if (payAppBtn) {
      if (upiUrl) { payAppBtn.href = upiUrl; payAppBtn.hidden = false; }
      else payAppBtn.hidden = true;
    }

    const appsRow = Util.$('#upi-apps');
    Util.$$('.upi-app-chip').forEach(chip => {
      if (upiUrl) {
        chip.onclick = () => { try { location.href = upiUrl; } catch {} };
        chip.classList.remove('is-disabled');
      } else {
        chip.onclick = () => Util.toast('UPI ID not configured yet.', 'info');
        chip.classList.add('is-disabled');
      }
    });
    if (appsRow) appsRow.hidden = !upiUrl;

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
          if (err) { qrWrap.hidden = true; }
          else qrWrap.hidden = false;
        });
      } else {
        qrWrap.hidden = true;
      }
    }

    const shotWrap = Util.$('#utr-shot-wrap');
    if (shotWrap) shotWrap.hidden = !p.upiRequireScreenshot;

    const shotInput = Util.$('#utr-shot');
    const shotPreview = Util.$('#utr-shot-preview');
    const shotPreviewImg = Util.$('#utr-shot-preview-img');
    const shotRemove = Util.$('#utr-shot-remove');
    const shotDrop = Util.$('.shot-drop');
    const renderShotPreview = file => {
      if (!shotPreview || !shotPreviewImg) return;
      if (!file) { shotPreview.hidden = true; if (shotDrop) shotDrop.hidden = false; shotPreviewImg.removeAttribute('src'); return; }
      try {
        shotPreviewImg.src = URL.createObjectURL(file);
        shotPreview.hidden = false;
        if (shotDrop) shotDrop.hidden = true;
      } catch (e) {}
    };
    if (shotInput && !shotInput.dataset.bound) {
      shotInput.dataset.bound = '1';
      shotInput.addEventListener('change', () => renderShotPreview(shotInput.files && shotInput.files[0]));
    }
    if (shotRemove && !shotRemove.dataset.bound) {
      shotRemove.dataset.bound = '1';
      shotRemove.addEventListener('click', () => {
        if (shotInput) shotInput.value = '';
        renderShotPreview(null);
      });
    }

    const copyBtn = Util.$('#upi-copy-vpa');
    if (copyBtn) copyBtn.onclick = async () => {
      if (!vpa) { Util.toast('UPI ID not configured yet.', 'info'); return; }
      try { await navigator.clipboard.writeText(vpa); Util.toast('UPI ID copied.', 'success'); return; }
      catch (e) {}
      // Fallback for non-secure contexts (http:// LAN / older mobile browsers)
      try {
        const ta = document.createElement('textarea');
        ta.value = vpa;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta);
        ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        Util.toast(ok ? 'UPI ID copied.' : 'Long-press to copy: ' + vpa, ok ? 'success' : 'info');
      } catch (e2) { Util.toast('Long-press to copy: ' + vpa, 'info'); }
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
        const noteVal = String(Util.$('#utr-note').value || '').trim();
        const sInput = Util.$('#utr-shot');
        const shotFile = sInput && sInput.files ? sInput.files[0] : null;
        const fail = m => { if (status) { status.className = 'form-note err'; status.textContent = m; } };
        if (!/^[A-Za-z0-9]{8,22}$/.test(utr)) return fail('Enter a valid UTR (8–22 letters/digits).');
        if (pay().upiRequireScreenshot && !shotFile) return fail('Please attach your payment screenshot.');
        if (btn) btn.disabled = true;
        if (status) { status.className = 'form-note'; status.textContent = 'Submitting…'; }
        try {
          let shotData = '';
          if (shotFile) {
            let f = shotFile;
            if (shotFile.type && shotFile.type.startsWith('image/')) {
              try { f = await Util.compressImage(shotFile, 1000, 0.7); }
              catch (e) { f = shotFile; }
            }
            shotData = await Util.fileToDataUrl(f);
            if (shotData.length > 950000) return fail('Screenshot too large.');
          }
          const patch = {
            utr,
            status: 'awaiting_verification',
            paymentMethod: 'manual_upi',
            upiVpaUsed: vpa,
            utrSubmittedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          };
          if (noteVal) patch.paymentNote = noteVal;
          if (shotData) patch.paymentScreenshotData = shotData;
          await db.collection('orders').doc(currentOrder.id).update(patch);
          Util.toast('Payment proof submitted.', 'success');
          showDone('awaiting_verification');
        } catch (err) {
          console.error('UTR submit failed:', err);
          fail(Util.friendlyError(err));
        } finally { if (btn) btn.disabled = false; }
      });
    }
  };

  const startRazorpay = async o => {
    const btn = Util.$('#rzp-pay-btn');
    const status = Util.$('#rzp-status');
    if (btn) { btn.disabled = true; btn.textContent = 'Opening…'; }
    const done = (msg, ok) => {
      if (btn) { btn.disabled = false; btn.textContent = 'Pay now'; }
      if (status && msg) { status.className = 'form-note ' + (ok ? 'ok' : 'err'); status.textContent = msg; }
    };
    try {
      if (!functions) throw new Error('Online payments not configured.');
      const res = await functions.httpsCallable('createOrder')({ orderId: o.id, templateId: o.templateId });
      const { razorpay_order_id, key_id, amount, currency } = res.data || {};
      if (!razorpay_order_id || !key_id || !amount) throw new Error('Payment could not be initialized.');
      if (typeof Razorpay === 'undefined') throw new Error('Payment gateway unavailable.');
      const rzp = new Razorpay({
        key: key_id, amount, currency: currency || 'INR',
        name: State.settings?.brandName || 'DUDE',
        description: o.templateName || 'Template order',
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
            Util.toast('Payment verified.', 'success');
            location.hash = '#/orders';
          } catch (err) {
            console.error('verifyPayment failed:', err);
            Util.toast('Payment verification failed. Contact support.', 'error');
            location.hash = '#/orders';
          }
        },
        modal: { ondismiss: () => done('Payment window closed.', false) }
      });
      rzp.on('payment.failed', resp => { done('Payment failed.', false); });
      rzp.open();
      done('');
    } catch (err) {
      console.error('Razorpay start failed:', err);
      done(err.message || Util.friendlyError(err), false);
    }
  };

  const showDone = status => {
    setBlock('pg-block-done');
    const title = Util.$('#pay-done-title');
    const text = Util.$('#pay-done-text');
    if (status === 'awaiting_verification') {
      if (title) title.textContent = '✅ Payment proof submitted';
      if (text) text.textContent = 'Thanks! We are verifying your payment.';
    } else {
      if (title) title.textContent = '✅ Payment received';
      if (text) text.textContent = 'This order is already paid.';
    }
  };

  const render = async orderId => {
    if (!orderId) { location.hash = '#/orders'; return; }
    if (!State.user) {
      State.postLoginRoute = `#/payment/${orderId}`;
      Util.toast('Sign in to complete payment.', 'info');
      Auth.openModal();
      location.hash = '#/orders';
      return;
    }
    try { await Data.loadSettings(); } catch (e) {}
    try {
      const snap = await db.collection('orders').doc(orderId).get();
      if (!snap.exists) { Util.toast('Order not found.', 'error'); location.hash = '#/orders'; return; }
      const o = { id: snap.id, ...snap.data() };
      if (o.userId && o.userId !== State.user.uid) {
        Util.toast('That order is not yours.', 'error');
        location.hash = '#/orders';
        return;
      }
      currentOrder = o;
      let tpl = null;
      if (o.templateId) { try { tpl = await Data.getTemplate(o.templateId); } catch (e) {} }
      paintOrderCard(o, tpl);
      const sub = Util.$('#pay-gateway-sub');

      if (['paid', 'processing', 'completed', 'delivered'].includes(o.status)) { showDone('paid'); return; }
      if (o.status === 'awaiting_verification') { showDone('awaiting_verification'); return; }

      const m = mode();
      if (sub) sub.textContent = m === 'razorpay' ? 'Pay securely via Razorpay.' : 'Pay via UPI and submit your UTR.';
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

  // ==== MOBILE HARDENING (v13) ==============================================
  // Event delegation on #payment-view so taps ALWAYS reach the right handler,
  // even after re-renders that wipe .onclick assignments. Uses BOTH click and
  // touchend so no mobile browser can miss the interaction (Android WebView,
  // iOS Safari private-mode, Samsung Internet, MIUI Browser).
  const wireMobileDelegation = () => {
    const root = Util.$('#payment-view');
    if (!root || root.dataset.mobileWired === '1') return;
    root.dataset.mobileWired = '1';

    const fireChipTap = (chip) => {
      const href = (Util.$('#upi-pay-app') && Util.$('#upi-pay-app').getAttribute('href')) || '';
      if (!href || href === '#' || chip.classList.contains('is-disabled')) {
        Util.toast('UPI ID not configured yet.', 'info');
        return;
      }
      try { window.location.href = href; } catch (e) {}
    };

    const fireCopy = async () => {
      const vpaEl = Util.$('#upi-pay-vpa');
      const vpa = vpaEl ? String(vpaEl.textContent || '').trim() : '';
      if (!vpa || vpa === '—') { Util.toast('UPI ID not configured yet.', 'info'); return; }
      try { await navigator.clipboard.writeText(vpa); Util.toast('UPI ID copied.', 'success'); return; }
      catch (e) {}
      try {
        const ta = document.createElement('textarea');
        ta.value = vpa; ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
        document.body.appendChild(ta); ta.focus(); ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        Util.toast(ok ? 'UPI ID copied.' : 'Long-press to copy: ' + vpa, ok ? 'success' : 'info');
      } catch (e2) { Util.toast('Long-press to copy: ' + vpa, 'info'); }
    };

    const handle = (ev) => {
      const t = ev.target;
      if (!t || !(t instanceof Element)) return;

      // UPI app chip (svg / span inside also counts via closest)
      const chip = t.closest && t.closest('.upi-app-chip');
      if (chip) { ev.preventDefault(); fireChipTap(chip); return; }

      // Copy VPA button
      const copy = t.closest && t.closest('#upi-copy-vpa');
      if (copy) { ev.preventDefault(); fireCopy(); return; }

      // Open UPI app CTA — anchor href already set, let default happen but
      // guarantee it fires on Android WebView where anchor.click can be ignored
      const openApp = t.closest && t.closest('#upi-pay-app');
      if (openApp && ev.type === 'touchend') {
        const href = openApp.getAttribute('href') || '';
        if (href && href !== '#') { ev.preventDefault(); try { window.location.href = href; } catch (e) {} }
      }
    };

    root.addEventListener('click', handle, { passive: false });
    root.addEventListener('touchend', handle, { passive: false });

    // Screenshot upload — explicit click bridge for iOS/Chrome-Android where
    // <label for="utr-shot"> sometimes fails when the input is visually hidden.
    const drop = Util.$('.shot-drop');
    const shotInput = Util.$('#utr-shot');
    if (drop && shotInput && !drop.dataset.tapBound) {
      drop.dataset.tapBound = '1';
      const openPicker = (ev) => {
        ev.preventDefault();
        try { shotInput.click(); } catch (e) {}
      };
      drop.addEventListener('click', openPicker);
      drop.addEventListener('touchend', openPicker, { passive: false });
    }
  };
  // Wire once on module init and re-wire defensively whenever payment renders.
  try { document.addEventListener('DOMContentLoaded', wireMobileDelegation); } catch (e) {}
  const _origRender = render;
  const renderWrapped = async (id) => { const r = await _origRender(id); try { wireMobileDelegation(); } catch (e) {} return r; };

  return { render: renderWrapped };
})();

// ==== LEGAL (defined BEFORE UI router uses it) ====
const Legal = (() => {
  const titles = { terms: 'Terms of Service', privacy: 'Privacy Policy' };
  const defaultLegal = w => {
    const brand = State.settings?.brandName || 'DUDE';
    return ({
      terms: `By purchasing a template on ${brand} you receive a non-exclusive, non-transferable license to use, modify and deploy the code for a single portfolio.\n\nSource code and copy remain the intellectual property of ${brand}. Reselling templates as-is is prohibited.\n\nRefunds are considered case-by-case within seven days of purchase.`,
      privacy: `We collect the personal information you submit at checkout solely to deliver your order and provide support.\n\nPayments are processed via UPI or Razorpay; we never store your card details.\n\nYou may request deletion of your data at any time.`,
      about: `${brand} is a portfolio-website marketplace built by developers for students entering the industry.\n\nEvery template is hand-coded, accessible, responsive, and shipped with source.`
    })[w] || 'Content coming soon.';
  };
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
    }
  };
  return { render };
})();

// ==== ROUTER + UI ====
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
    // FIX (v13): tag <body> when payment view is open so CSS can lift the
    // chatbot FAB / toast stack away from the CTAs (legacy fallback for
    // browsers without :has() support — Android WebView, older iOS).
    try { document.body.classList.toggle('payment-open', name === 'payment'); } catch {}
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

  const wireReveal = () => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const heroSeq = ['#hero-eyebrow', '#hero-headline', '#hero-sub', '.hero-cta', '.hero-highlights'];
    heroSeq.forEach((sel, i) => {
      const el = Util.$(sel);
      if (!el || reduced) return;
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
    if (reduced || !('IntersectionObserver' in window)) return;

    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('fx-visible', 'visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -6% 0px' });

    const GRID_SEL = '#template-grid, #pricing-grid, .reviews-carousel, #hero-highlights, #detail-specs, #detail-pages, #detail-tech, .footer-grid';
    const CARD_SEL = '.tpl-card, .price-card, .review-card, .buy-box, .contact-form';

    const scan = () => {
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
      Util.$$(CARD_SEL).forEach(el => {
        if (el.dataset.fx) return;
        el.dataset.fx = '1';
        el.classList.add('fx-reveal');
        io.observe(el);
      });
      Util.$$('section h2, .section-head h2, .detail-body h2').forEach(h => {
        if (h.dataset.fx) return;
        h.dataset.fx = '1';
        h.classList.add('fx-heading');
        io.observe(h);
      });
    };
    scan();
    const mo = new MutationObserver(() => scan());
    const main = Util.$('#main');
    if (main) mo.observe(main, { childList: true, subtree: true });
  };

  const wireRipple = () => {
    document.addEventListener('pointerdown', e => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      btn.style.setProperty('--rx', `${e.clientX - rect.left}px`);
      btn.style.setProperty('--ry', `${e.clientY - rect.top}px`);
    });
  };

  const wireCardSpotlight = () => {
    const attach = (el) => {
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
        el.style.setProperty('--my', ((e.clientY - r.top)  / r.height * 100) + '%');
      }, { passive: true });
    };
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

  const applyBrand = () => {
    const brand = State.settings?.brandName || 'DUDE';
    Util.$$('[data-brand]').forEach(n => n.textContent = brand);
    if (State.settings?.accentColor && /^#[0-9a-fA-F]{6}$/.test(State.settings.accentColor)) {
      document.documentElement.style.setProperty('--accent', State.settings.accentColor);
    }
    const blurb = Util.$('#footer-blurb');
    if (blurb) blurb.textContent = `${brand} — a curated marketplace of student portfolio websites.`;
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

// ==== CONTACT ====
const Contact = (() => {
  const normaliseWhatsApp = raw => {
    const s = String(raw || '').trim();
    if (!s) return '';
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

      const waDigits = whatsapp.replace(/[^0-9]/g, '');
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message || waDigits.length < 7 || waDigits.length > 15) {
        if (status) { status.className = 'form-note err'; status.textContent = 'Please fill all fields with a valid email and WhatsApp number.'; }
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
        if (status) { status.className = 'form-note ok'; status.textContent = 'Thanks — we\'ll be in touch on WhatsApp within one business day.'; }
      } catch (err) {
        console.error('Contact form failed:', err);
        if (status) { status.className = 'form-note err'; status.textContent = 'Could not send. Please try again.'; }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  };
  return { wire };
})();

// ==== BOOTSTRAP ====
(async function boot() {
  try {
    ['modal-scrim','auth-modal','zoom-modal','drawer-scrim','mobile-drawer','account-menu','dude-bot-panel']
      .forEach(id => { const n = document.getElementById(id); if (n) n.setAttribute('hidden', ''); });
    document.body.style.overflow = '';
  } catch (_) {}

  try {
    // Load settings and categories in parallel — never block on either
    await Promise.all([
      Data.loadSettings().catch(e => console.warn('settings fail:', e)),
      Data.loadCategories().catch(e => console.warn('categories fail:', e))
    ]);

    UI.applyBrand();

    // Initial active category — from URL param or first, but "All" is also valid (null)
    let urlCat = null;
    try { urlCat = new URLSearchParams(location.search).get('category'); } catch {}
    const match = State.categories.find(c => c.slug === urlCat || c.id === urlCat);
    // FIX: default to first category if categories exist; otherwise null (shows all templates)
    State.activeCategoryId = match ? match.id : (State.categories[0]?.id || null);

    const cat = State.activeCategoryId ? State.categories.find(c => c.id === State.activeCategoryId) : null;
    Home.applyHero(cat);
    Home.renderTabs();
    Home.renderPricing();
    Home.renderReviewsStrip();
    Home.renderContact();

    Auth.wire();
    Templates.wire();
    Contact.wire();
    UI.wireDrawer();
    UI.wireRipple();
    UI.wireCardSpotlight();

    // FIX: always load templates — even if no active category (shows all).
    await Templates.load();

    UI.wireReveal();

    window.addEventListener('hashchange', () => UI.showRoute());
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
  }
})();

/* ---- DUDE-BOT chatbot widget ---- */
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

  if (!fab || !panel || !msgs || !form || !input) return;

  const HYPE = ['🚀','✨','🔥','💯','⚡','😎','🤙','🫡','💅','🥳','🧠','👀'];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];

  const KB = [
    { keys: ['hi','hello','hey','yo','sup','hola'], reply: () => `Yooo! 👋 Welcome to <b>DUDE</b> ${rand(HYPE)}<br><br>Ask me anything: <i>pricing</i>, <i>templates</i>, <i>delivery</i>, <i>refunds</i>` },
    { keys: ['price','pricing','cost','how much'], reply: () => `Check the <a href="#/pricing">Pricing page</a> for tiers ${rand(HYPE)}` },
    { keys: ['template','templates','portfolio'], reply: () => `Peek here 👉 <a href="#/templates">Browse templates</a>` },
    { keys: ['delivery','how long','time'], reply: () => `Instant delivery after payment for most templates. Custom builds: 3–7 days.` },
    { keys: ['payment','pay','upi','razorpay'], reply: () => `We accept UPI (GPay/PhonePe/Paytm) and Razorpay for cards.` },
    { keys: ['refund','return','cancel'], reply: () => `Refunds for genuine issues within support window. Contact us via <a href="#/contact">Contact</a>.` },
    { keys: ['support','help','contact'], reply: () => `<a href="#/contact">Say hi via Contact</a> — we reply within 1 business day.` },
    { keys: ['review','reviews','rating'], reply: () => `Real reviews here 👉 <a href="#/reviews">Reviews</a>` },
    { keys: ['thank','thanks','ty'], reply: () => `Awww 🥹 Go build something dangerously beautiful ${rand(HYPE)}` },
    { keys: ['bye','goodbye','see you'], reply: () => `Peace out ✌️ ${rand(HYPE)}` }
  ];

  const fallback = () => `Hmm 🤔 try asking about <b>pricing</b>, <b>templates</b>, <b>delivery</b>, or <b>refunds</b> ${rand(HYPE)}`;

  const findReply = (text) => {
    const t = (text || '').toLowerCase().trim();
    if (!t) return fallback();
    for (const entry of KB) {
      if (entry.keys.some(k => t.includes(k))) return entry.reply();
    }
    return fallback();
  };

  const scrollBottom = () => { msgs.scrollTop = msgs.scrollHeight; };
  const escapeHtml = (s) => (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

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
    wrap.innerHTML = `<div class="dude-bot-avatar-mini">🤖</div><div class="dude-bot-bubble dude-bot-bubble-bot"><span class="dude-bot-dot"></span><span class="dude-bot-dot"></span><span class="dude-bot-dot"></span></div>`;
    msgs.appendChild(wrap);
    scrollBottom();
    return wrap;
  };
  const addBotMsg = (html) => {
    const wrap = document.createElement('div');
    wrap.className = 'dude-bot-msg dude-bot-msg-bot';
    wrap.innerHTML = `<div class="dude-bot-avatar-mini">🤖</div><div class="dude-bot-bubble dude-bot-bubble-bot">${html}</div>`;
    msgs.appendChild(wrap);
    scrollBottom();
  };

  const respond = (userText) => {
    const typing = addBotTyping();
    setTimeout(() => { typing.remove(); addBotMsg(findReply(userText)); }, 600);
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    addUserMsg(text);
    input.value = '';
    respond(text);
  });

  const QUICK = [
    { label: '💰 Pricing', q: 'pricing' },
    { label: '🎨 Templates', q: 'templates' },
    { label: '⏱️ Delivery', q: 'delivery' },
    { label: '↩️ Refunds', q: 'refund' },
    { label: '📞 Contact', q: 'contact' }
  ];
  QUICK.forEach(({ label, q }) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dude-bot-chip';
    b.textContent = label;
    b.addEventListener('click', () => { addUserMsg(label); respond(q); });
    quick.appendChild(b);
  });

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
      setTimeout(() => addBotMsg(`Yo 👋 Welcome to <b>DUDE</b>! Ask me anything ✨`), 250);
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
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) closeBot(); });
})();

(function stampLooseButtons(){
  try {
    document.querySelectorAll('button:not([type])').forEach(b => {
      if (b.closest('form')) return;
      b.setAttribute('type', 'button');
    });
  } catch (_) {}
})();
