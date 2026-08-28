/* ============================================================
   FOLIUM — Admin (Premium Edition — Payment System v3)
   NEW: Payment gateway toggle (Manual UPI / Razorpay),
        UPI ID management, live preview, payments module upgrade,
        UTR verification workflow.
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
try { firebase.initializeApp(firebaseConfig); } catch (e) { console.warn("Firebase already initialized", e); }
const auth = firebase.auth();
const db = firebase.firestore();
// Optional services — guarded so the admin panel works on the free Spark plan.
let storage = null;
try { storage = firebase.storage(); } catch (e) { console.warn('Storage unavailable:', e); }
let functions = null;
try { functions = firebase.functions(); } catch (e) { console.warn('Functions unavailable:', e); }

// ==== SECTION: UTIL ====
const $ = (s, c = document) => c.querySelector(s);
const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
const fmtINR = n => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0);
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
};
const toast = (msg, type = 'info') => {
  const stack = $('#toast-stack');
  if (!stack) return;
  const t = el('div', { class: `toast ${type}`, role: type === 'error' ? 'alert' : 'status' }, msg);
  stack.appendChild(t);
  setTimeout(() => t.remove(), 3800);
};
const confirmDialog = msg => new Promise(res => res(window.confirm(msg)));
const dateFmt = ts => ts?.toDate ? ts.toDate().toLocaleString() : '—';
const dateOnly = ts => ts?.toDate ? ts.toDate().toLocaleDateString() : '—';
const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const safeUrl = (raw, fallback = '') => {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const u = new URL(raw.trim(), window.location.origin);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return u.href;
  } catch { return fallback; }
};

const friendlyError = e => {
  const m = (e && e.message) || String(e || '');
  if (/index/i.test(m)) return 'A database index is still building. Try again shortly.';
  if (/permission|insufficient/i.test(m)) return 'Permission denied. Confirm this account is in the admins collection.';
  if (/offline|network|unavailable/i.test(m)) return 'Network problem. Check your connection and try again.';
  return 'Please try again in a moment.';
};

const showViewError = (viewEl, err, retryFn) => {
  if (!viewEl) return;
  const box = el('div', { class: 'error-state', role: 'alert' },
    el('h3', {}, 'Could not load this section'),
    el('p', {}, friendlyError(err)));
  if (typeof retryFn === 'function') {
    const b = el('button', { type: 'button', class: 'btn btn-primary' }, 'Try again');
    b.addEventListener('click', () => { box.remove(); retryFn(); });
    box.appendChild(b);
  }
  viewEl.querySelector('.error-state')?.remove();
  viewEl.prepend(box);
};

// ==== SECTION: UPLOADS — 100% FREE, no Firebase Storage required ====
// Strategy (in priority order):
//   1. Cloudinary UNSIGNED upload — free tier 25GB storage + 25GB bandwidth/mo.
//      Admin sets cloud name + upload preset once in Settings → Uploads.
//   2. Base64 data-URL embedded in Firestore — small images only (≤700KB).
//   3. Catbox.moe — free anonymous host (200MB), CORS-open, no signup.
//      Automatic fallback for videos / large images / ZIPs / PDFs / docs.
// uploadFile(file, folder, {forceDataUrl}) -> Promise<{url, path?, dataUrl?, via, name, size, type}>
const fileToDataUrl = file => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result || ''));
  r.onerror = () => rej(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

const cloudinaryCfg = () => (S.settings && S.settings.uploads) || {};
const cloudinaryReady = () => {
  const c = cloudinaryCfg();
  return !!(c.cloudName && c.uploadPreset);
};

const uploadToCloudinary = async (file, resourceType) => {
  const c = cloudinaryCfg();
  const endpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloudName)}/${resourceType}/upload`;
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', c.uploadPreset);
  const res = await fetch(endpoint, { method: 'POST', body: fd });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.secure_url) {
    throw new Error(json.error?.message || `Cloudinary upload failed (HTTP ${res.status}). Check cloud name & upload preset.`);
  }
  return { url: json.secure_url, path: json.public_id || '', via: 'cloudinary', name: file.name, size: file.size || 0, type: file.type || '' };
};

const uploadToCatbox = async file => {
  const fd = new FormData();
  fd.append('reqtype', 'fileupload');
  fd.append('fileToUpload', file);
  const res = await fetch('https://catbox.moe/user/api.php', { method: 'POST', body: fd });
  const text = (await res.text()).trim();
  if (!res.ok || !/^https?:\/\//.test(text)) {
    throw new Error(text && text.length < 120 ? `Catbox rejected the file: ${text}` : 'Free host (Catbox) upload failed. Try a smaller file or configure Cloudinary in Settings → Uploads.');
  }
  return { url: text, path: '', via: 'catbox', name: file.name, size: file.size || 0, type: file.type || '' };
};

const uploadFile = async (file, folder, { forceDataUrl = false, maxDataUrlBytes = 700 * 1024 } = {}) => {
  if (!file) throw new Error('No file selected.');
  const isImage = /^image\//.test(file.type || '');
  const isVideo = /^video\//.test(file.type || '');
  const isDoc = /pdf|zip|x-7z|x-rar|word|text|json|octet-stream/.test(file.type || '') || /\.(zip|rar|7z|pdf|docx?|txt|md)$/i.test(file.name || '');
  const size = file.size || 0;

  if (!isImage && !isVideo && !isDoc) throw new Error('Unsupported file type. Upload images, videos, PDFs or ZIP/doc archives.');
  if (size > 200 * 1024 * 1024) throw new Error('Files must be under 200 MB.');

  // Forced Base64 (kept for tests / tiny inline icons).
  if (forceDataUrl) {
    if (!isImage) throw new Error('Only small images can be embedded inline.');
    if (size > maxDataUrlBytes) throw new Error(`"${file.name}" is too large to embed inline (max ~700 KB).`);
    const dataUrl = await fileToDataUrl(file);
    return { url: dataUrl, dataUrl, via: 'dataUrl', name: file.name, size, type: file.type };
  }

  // 1) Cloudinary — images & videos (free tier blocks ZIP/EXE delivery, so
  //    documents always use the Catbox path below).
  if (cloudinaryReady() && (isImage || isVideo)) {
    try {
      return await uploadToCloudinary(file, isVideo ? 'video' : 'image');
    } catch (err) {
      console.warn('Cloudinary failed, falling back:', err);
      toast(`Cloudinary failed (${err.message}) — using free fallback.`, 'info');
      if (isImage && size <= maxDataUrlBytes) {
        const dataUrl = await fileToDataUrl(file);
        return { url: dataUrl, dataUrl, via: 'dataUrl', name: file.name, size, type: file.type };
      }
      return await uploadToCatbox(file);
    }
  }

  // 2) No Cloudinary configured → free fallbacks.
  if (isImage && size <= maxDataUrlBytes) {
    // Small images embed straight into Firestore — zero external dependency.
    const dataUrl = await fileToDataUrl(file);
    return { url: dataUrl, dataUrl, via: 'dataUrl', name: file.name, size, type: file.type };
  }
  // Videos, big images, ZIPs, PDFs, docs → Catbox (free, anonymous, CORS-open).
  return await uploadToCatbox(file);
};

// --- Drawer ---
let drawerLastFocus = null;
const openDrawer = content => {
  drawerLastFocus = document.activeElement;
  const body = $('#drawer-body');
  body.innerHTML = '';
  body.appendChild(content);
  const d = $('#drawer');
  d.hidden = false;
  d.setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  document.body.style.overflow = 'hidden';
  const first = body.querySelector('input, select, textarea, button:not([disabled])') || $('#drawer-x');
  if (first) first.focus();
};
const closeDrawer = () => {
  const d = $('#drawer');
  d.setAttribute('aria-hidden', 'true');
  d.hidden = true;
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
  if (drawerLastFocus && document.contains(drawerLastFocus)) { try { drawerLastFocus.focus(); } catch {} }
  drawerLastFocus = null;
};
$('#drawer-x').addEventListener('click', closeDrawer);
$('#scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').hidden) closeDrawer(); });

// ==== SECTION: STATE ====
const S = { user: null, categories: [], settings: null, currentView: null };
const listeners = new Set();
const registerListener = unsub => { if (typeof unsub === 'function') listeners.add(unsub); return unsub; };
const cleanupListeners = () => { listeners.forEach(u => { try { u(); } catch {} }); listeners.clear(); };

// ==== SECTION: AUTH ====
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const status = $('#login-status');
  status.className = 'form-note';
  status.textContent = 'Signing in…';
  const fd = new FormData(e.target);
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  try {
    await auth.signInWithEmailAndPassword(String(fd.get('email') || '').trim(), String(fd.get('password') || ''));
  } catch (err) {
    console.error('Admin sign-in failed:', err);
    const code = String(err && err.code || '');
    let msg = String(err && err.message || 'Sign-in failed').replace('Firebase: ', '');
    if (/invalid-credential|wrong-password|user-not-found/.test(code)) msg = 'Invalid email or password.';
    else if (/too-many-requests/.test(code)) msg = 'Too many attempts. Please wait a minute and try again.';
    else if (/network-request-failed/.test(code)) msg = 'Network problem. Check your connection and try again.';
    status.className = 'form-note err';
    status.textContent = msg;
  } finally {
    btn.disabled = false;
  }
});

$('#sign-out').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(async user => {
  try {
    if (!user) {
      cleanupListeners();
      S.user = null;
      $('#app-shell').hidden = true;
      $('#login-screen').hidden = false;
      const st = $('#login-status');
      if (st && !st.textContent) { st.className = 'form-note'; st.textContent = ''; }
      return;
    }
    const status = $('#login-status');
    status.className = 'form-note';
    status.textContent = 'Verifying admin access…';

    let adminDoc = null;
    try {
      adminDoc = await db.collection('admins').doc(user.uid).get();
    } catch (permErr) {
      console.error('Admin authorization check failed:', permErr);
      status.className = 'form-note err';
      status.textContent = friendlyError(permErr);
      toast('Could not verify admin access.', 'error');
      try { await auth.signOut(); } catch {}
      return;
    }

    if (!adminDoc || !adminDoc.exists) {
      status.className = 'form-note err';
      status.textContent = 'This account is not an administrator.';
      try { await auth.signOut(); } catch {}
      return;
    }

    S.user = user;
    $('#admin-email').textContent = user.email || user.uid;
    status.textContent = '';

    try { await loadSettings(); } catch (e) { S.settings = {}; toast(`Settings unavailable: ${friendlyError(e)}`, 'error'); }
    try { await loadCategories(); } catch (e) { S.categories = []; toast(`Categories unavailable: ${friendlyError(e)}`, 'error'); }

    $('#login-screen').hidden = true;
    $('#app-shell').hidden = false;

    try { Messages.wireLiveBadge(); } catch (e) { console.warn('Messages badge init failed:', e); }
    try { Payments.wireLiveBadge(); } catch (e) { console.warn('Payments badge init failed:', e); }

    switchView('dashboard');
  } catch (err) {
    console.error('Admin auth flow error:', err);
    $('#app-shell').hidden = true;
    $('#login-screen').hidden = false;
    const st = $('#login-status');
    st.className = 'form-note err';
    st.textContent = `Initialization failed. ${friendlyError(err)}`;
  }
});

// ==== SECTION: NAV ====
const viewMap = {
  dashboard: 'v-dashboard', templates: 'v-templates', categories: 'v-categories',
  orders: 'v-orders', customers: 'v-customers', messages: 'v-messages', reviews: 'v-reviews',
  payments: 'v-payments', forms: 'v-forms', analytics: 'v-analytics', settings: 'v-settings'
};
const viewTitles = {
  dashboard: 'Dashboard', templates: 'Templates', categories: 'Categories',
  orders: 'Orders', customers: 'Customers', messages: 'Contact Messages', reviews: 'Reviews',
  payments: 'Payments', forms: 'Custom Form Builder', analytics: 'Analytics', settings: 'Settings'
};
const switchView = name => {
  if (!viewMap[name]) name = 'dashboard';
  cleanupListeners();

  Object.values(viewMap).forEach(id => { const n = $(`#${id}`); if (n) n.hidden = true; });
  const target = $(`#${viewMap[name]}`);
  if (target) target.hidden = false;

  $$('.sidebar nav button').forEach(b => {
    const on = b.dataset.view === name;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#view-title').textContent = viewTitles[name] || 'Admin';
  $('#sidebar').classList.remove('open');
  $('#side-toggle')?.setAttribute('aria-expanded', 'false');
  S.currentView = name;

  const loaders = {
    dashboard: () => Dashboard.load(),
    templates: () => Templates.load(),
    categories: () => Categories.load(),
    orders: () => Orders.load(),
    customers: () => Customers.load(),
    messages: () => Messages.load(),
    reviews: () => Reviews.load(),
    payments: () => Payments.load(),
    forms: () => Forms.load(),
    analytics: () => Analytics.load(),
    settings: () => Settings.load()
  };
  try {
    const p = loaders[name] && loaders[name]();
    if (p && typeof p.catch === 'function') {
      p.catch(e => {
        console.error(`View "${name}" load failed:`, e);
        showViewError(target, e, () => switchView(name));
        toast(`Could not load ${viewTitles[name]}.`, 'error');
      });
    }
  } catch (e) {
    console.error(`View "${name}" crashed:`, e);
    showViewError(target, e, () => switchView(name));
  }
};

$$('.sidebar nav button').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
$('#side-toggle').addEventListener('click', () => {
  const sb = $('#sidebar');
  sb.classList.toggle('open');
  $('#side-toggle').setAttribute('aria-expanded', sb.classList.contains('open') ? 'true' : 'false');
});

// ==== SECTION: SHARED DATA ====
const loadCategories = async () => {
  const snap = await db.collection('categories').orderBy('order').get();
  S.categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const opts = ['#tpl-cat-filter', '#ord-cat', '#form-scope'];
  opts.forEach(sel => {
    const node = $(sel);
    if (!node) return;
    const first = sel === '#form-scope' ? '<option value="all">Applies to: all categories</option>' : node.children[0].outerHTML;
    node.innerHTML = first;
    S.categories.forEach(c => node.appendChild(el('option', { value: c.id }, sel === '#form-scope' ? `Only: ${c.name}` : c.name)));
  });
};

const loadSettings = async () => {
  const snap = await db.collection('settings').doc('site').get();
  S.settings = snap.exists ? snap.data() : {};
};

// ==== SECTION: DASHBOARD ====
const Dashboard = (() => {
  let revChart = null, catChart = null;
  const PAID_STATUSES = ['paid', 'processing', 'completed', 'delivered'];
  const PENDING_STATUSES = ['draft', 'payment_created', 'payment_pending', 'awaiting_verification'];

  const load = async () => {
    const view = $('#v-dashboard');
    try {
      const [ordSnap, custSnap, tplSnap] = await Promise.all([
        db.collection('orders').orderBy('createdAt', 'desc').limit(500).get(),
        db.collection('users').limit(1000).get(),
        db.collection('templates').get()
      ]);
      const orders = ordSnap.docs.map(d => d.data());
      const totalOrders = orders.length;
      const revenue = orders.filter(o => PAID_STATUSES.includes(o.status)).reduce((s, o) => s + (o.amount || 0), 0);
      const pending = orders.filter(o => PENDING_STATUSES.includes(o.status)).length;
      const completed = orders.filter(o => ['completed', 'delivered'].includes(o.status)).length;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const todaySales = orders.filter(o => o.createdAt?.toDate && o.createdAt.toDate() >= today && PAID_STATUSES.includes(o.status)).reduce((s, o) => s + (o.amount || 0), 0);

      $('#s-orders').textContent = totalOrders;
      $('#s-revenue').textContent = fmtINR(revenue);
      $('#s-customers').textContent = custSnap.size;
      $('#s-templates').textContent = tplSnap.size;
      $('#s-pending').textContent = pending;
      $('#s-completed').textContent = completed;
      $('#s-today').textContent = fmtINR(todaySales);

      const now = Date.now();
      const day = 24 * 3600 * 1000;
      const revWindow = (from, to) => orders.filter(o => {
        const t = o.createdAt?.toDate?.().getTime();
        return t && t >= from && t < to && PAID_STATUSES.includes(o.status);
      }).reduce((s, o) => s + (o.amount || 0), 0);
      const last14 = revWindow(now - 14 * day, now);
      const prev14 = revWindow(now - 28 * day, now - 14 * day);
      const trend = prev14 > 0 ? ((last14 - prev14) / prev14) * 100 : 0;
      const trendEl = $('#s-revenue-trend');
      trendEl.textContent = `${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend).toFixed(1)}% vs prev 14d`;
      trendEl.className = trend >= 0 ? 'up' : 'down';
      const ordersTrend = orders.filter(o => o.createdAt?.toDate && o.createdAt.toDate().getTime() >= now - 14 * day).length;
      $('#s-orders-trend').textContent = `${ordersTrend} in last 14d`;

      const labels = [];
      const revData = [];
      for (let i = 13; i >= 0; i--) {
        const start = now - i * day; const bs = new Date(start); bs.setHours(0, 0, 0, 0);
        const be = new Date(bs); be.setDate(be.getDate() + 1);
        labels.push(bs.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }));
        revData.push(revWindow(bs.getTime(), be.getTime()));
      }
      if (revChart) { revChart.destroy(); revChart = null; }
      if (typeof Chart !== 'undefined') {
        revChart = new Chart($('#rev-chart'), {
          type: 'line',
          data: { labels, datasets: [{ label: 'Revenue ₹', data: revData, borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,.2)', tension: .35, fill: true, pointRadius: 3 }] },
          options: chartOpts()
        });
      }

      const catCounts = {};
      orders.forEach(o => { catCounts[o.categoryId] = (catCounts[o.categoryId] || 0) + 1; });
      const catLabels = S.categories.map(c => c.name);
      const catData = S.categories.map(c => catCounts[c.id] || 0);
      if (catChart) { catChart.destroy(); catChart = null; }
      if (typeof Chart !== 'undefined') {
        catChart = new Chart($('#cat-chart'), {
          type: 'doughnut',
          data: { labels: catLabels, datasets: [{ data: catData, backgroundColor: ['#2F5CFF', '#8B5CF6', '#38BDF8', '#10B981', '#F59E0B', '#EC4899', '#14B8A6'] }] },
          options: { ...chartOpts(), cutout: '60%' }
        });
      }

      registerListener(db.collection('orders').orderBy('updatedAt', 'desc').limit(6).onSnapshot(snap => {
        const box = $('#recent-orders');
        if (!box) return;
        box.innerHTML = '';
        if (!snap.docs.length) {
          box.appendChild(el('p', { class: 'muted' }, 'No orders yet.'));
          return;
        }
        const tbl = el('table');
        tbl.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'Order'), el('th', {}, 'Amount'), el('th', {}, 'Status'), el('th', {}, 'Updated'))));
        const tb = el('tbody');
        snap.docs.forEach(d => {
          const o = d.data();
          tb.appendChild(el('tr', {},
            el('td', {}, `#${d.id.slice(0, 8)}`),
            el('td', {}, o.amount != null ? fmtINR(o.amount) : '—'),
            el('td', {}, el('span', { class: `status-pill status-${o.status || 'draft'}` }, String(o.status || 'draft').replace(/_/g, ' '))),
            el('td', {}, dateFmt(o.updatedAt))
          ));
        });
        tbl.appendChild(tb);
        box.appendChild(tbl);
      }, err => {
        console.error('Recent orders listener error:', err);
        const box = $('#recent-orders');
        if (box) { box.innerHTML = ''; box.appendChild(el('p', { class: 'muted' }, friendlyError(err))); }
      }));
    } catch (e) {
      console.error('Dashboard load failed:', e);
      showViewError(view, e, () => Dashboard.load());
      throw e;
    }
  };

  return { load };
})();

const chartOpts = () => ({
  responsive: true, maintainAspectRatio: false, resizeDelay: 120, animation: { duration: 300 },
  plugins: {
    legend: { labels: { color: '#94A3B8', font: { family: 'Inter' } } },
    tooltip: { backgroundColor: '#121826', borderColor: 'rgba(255,255,255,.1)', borderWidth: 1, titleColor: '#F8FAFC', bodyColor: '#94A3B8' }
  },
  scales: {
    x: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,.05)' } },
    y: { ticks: { color: '#94A3B8' }, grid: { color: 'rgba(255,255,255,.05)' } }
  }
});

// ==== SECTION: TEMPLATES ====
const Templates = (() => {
  let templates = [];

  const load = async () => {
    const snap = await db.collection('templates').orderBy('name').get();
    templates = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  };

  const render = () => {
    const q = $('#tpl-search').value.trim().toLowerCase();
    const cat = $('#tpl-cat-filter').value;
    const tbody = $('#tpl-table tbody');
    tbody.innerHTML = '';
    templates.filter(t =>
      (!q || (t.name || '').toLowerCase().includes(q)) &&
      (!cat || t.categoryId === cat)
    ).forEach(t => {
      const catName = S.categories.find(c => c.id === t.categoryId)?.name || '—';
      const tr = el('tr', {},
        el('td', {}, t.name || '(untitled)'),
        el('td', {}, catName),
        el('td', {}, fmtINR(t.discountPrice && t.discountPrice < t.price ? t.discountPrice : (t.price || 0))),
        el('td', {}, `★ ${(t.rating?.average || 0).toFixed(1)} (${t.rating?.count || 0})`),
        el('td', {}, t.isFeatured ? '✓' : ''),
        el('td', {}, t.isActive ? '✓' : ''),
        el('td', {},
          el('div', { class: 'row-actions' },
            el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => editOrCreate(t.id).catch(e => { console.error(e); toast(friendlyError(e), 'error'); }) }, 'Edit'),
            el('button', { type: 'button', class: 'btn btn-danger', onclick: () => remove(t.id) }, 'Delete')
          )
        )
      );
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) tbody.appendChild(el('tr', {}, el('td', { colspan: 7, style: 'text-align:center;color:var(--text-muted);padding:32px' }, 'No templates found.')));
  };

  const remove = async id => {
    if (!await confirmDialog('Delete this template? This cannot be undone.')) return;
    try {
      await db.collection('templates').doc(id).delete();
      toast('Template deleted.', 'success');
      load();
    } catch (e) {
      console.error('Template delete failed:', e);
      toast(friendlyError(e), 'error');
    }
  };

  const numOr = (raw, fallback, { min = -Infinity, max = Infinity } = {}) => {
    const s = String(raw ?? '').trim();
    if (s === '') return fallback;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n < min || n > max) return null;
    return n;
  };

  const editOrCreate = async id => {
    let t = { name: '', slug: '', categoryId: S.categories[0]?.id || '', shortDescription: '', longDescription: '', price: 0, discountPrice: 0, currency: 'INR', rating: { average: 0, count: 0 }, technology: [], pagesIncluded: [], deliveryTimeDays: 3, supportDurationDays: 30, customizationLevel: 'standard', sourceCodeIncluded: true, isResponsive: true, isSeoReady: true, images: [], thumbnailUrl: '', videoUrl: '', demoUrl: '', isFeatured: false, isActive: true };
    if (id) {
      const snap = await db.collection('templates').doc(id).get();
      if (snap.exists) t = { ...t, ...snap.data(), id };
    }

    const form = el('form', { class: 'stacked', novalidate: true });
    form.appendChild(el('h2', {}, id ? 'Edit template' : 'New template'));

    form.appendChild(el('label', {}, 'Name', el('input', { name: 'name', value: t.name, required: true, maxlength: 120, oninput: e => { if (!id) form.querySelector('[name=slug]').value = slug(e.target.value); } })));

    const gridA = el('div', { class: 'split' });
    gridA.appendChild(el('label', {}, 'Slug', el('input', { name: 'slug', value: t.slug || '', maxlength: 120 })));
    const catSel = el('select', { name: 'categoryId' });
    S.categories.forEach(c => catSel.appendChild(el('option', { value: c.id, ...(c.id === t.categoryId ? { selected: true } : {}) }, c.name)));
    gridA.appendChild(el('label', {}, 'Category', catSel));
    form.appendChild(gridA);

    form.appendChild(el('label', {}, 'Short description', el('input', { name: 'shortDescription', value: t.shortDescription, maxlength: 200 })));
    form.appendChild(el('label', {}, 'Long description', el('textarea', { name: 'longDescription', rows: 4 }, t.longDescription)));

    const gridB = el('div', { class: 'split-3' });
    gridB.appendChild(el('label', {}, 'Price (INR)', el('input', { name: 'price', type: 'number', min: 0, step: 1, value: t.price })));
    gridB.appendChild(el('label', {}, 'Discount price', el('input', { name: 'discountPrice', type: 'number', min: 0, step: 1, value: t.discountPrice || 0 })));
    gridB.appendChild(el('label', {}, 'Delivery (days)', el('input', { name: 'deliveryTimeDays', type: 'number', min: 1, step: 1, value: t.deliveryTimeDays })));
    form.appendChild(gridB);

    const gridC = el('div', { class: 'split-3' });
    gridC.appendChild(el('label', {}, 'Support (days)', el('input', { name: 'supportDurationDays', type: 'number', min: 0, step: 1, value: t.supportDurationDays })));
    const custSel = el('select', { name: 'customizationLevel' });
    ['basic', 'standard', 'full'].forEach(v => custSel.appendChild(el('option', { value: v, ...(v === t.customizationLevel ? { selected: true } : {}) }, v)));
    gridC.appendChild(el('label', {}, 'Customization', custSel));
    gridC.appendChild(el('label', {}, 'Demo URL', el('input', { name: 'demoUrl', type: 'url', value: t.demoUrl })));
    form.appendChild(gridC);

    form.appendChild(el('label', {}, 'Technology (comma separated)', el('input', { name: 'technology', value: (t.technology || []).join(', ') })));
    form.appendChild(el('label', {}, 'Pages included (comma separated)', el('input', { name: 'pagesIncluded', value: (t.pagesIncluded || []).join(', ') })));

    // ---- Video: upload OR external URL (YouTube / Vimeo / direct mp4) ----
    let videoUrl = safeUrl(t.videoUrl) || (String(t.videoUrl || '').startsWith('data:') ? t.videoUrl : '');
    const videoBlock = el('div', { class: 'media-upload-block' });
    videoBlock.appendChild(el('div', { class: 'img-url-label' }, 'Video (optional)'));
    videoBlock.appendChild(el('p', { class: 'img-url-hint' }, 'Upload an mp4/webm clip or paste a YouTube / Vimeo / direct link. Shown on the template page.'));
    const videoRow = el('div', { class: 'img-url-row' });
    const videoInput = el('input', { type: 'url', class: 'img-url-input', placeholder: 'https://youtube.com/watch?v=… or https://…/clip.mp4', value: videoUrl });
    videoInput.addEventListener('input', () => { videoUrl = videoInput.value.trim(); paintVideoPreview(); });
    const videoUploadBtn = el('button', { type: 'button', class: 'btn btn-primary img-url-add' }, '⬆ Upload video');
    const videoFile = el('input', { type: 'file', accept: 'video/*', style: 'display:none' });
    videoRow.appendChild(videoInput);
    videoRow.appendChild(videoUploadBtn);
    videoBlock.appendChild(videoRow);
    videoBlock.appendChild(videoFile);
    const videoErr = el('div', { class: 'img-url-error', style: 'display:none' }, '');
    videoBlock.appendChild(videoErr);
    const videoPreview = el('div', { class: 'video-preview-wrap' });
    videoBlock.appendChild(videoPreview);
    const showVideoErr = msg => { videoErr.style.display = msg ? 'block' : 'none'; videoErr.textContent = msg || ''; };
    const paintVideoPreview = () => {
      videoPreview.innerHTML = '';
      if (!videoUrl) return;
      const isUpload = /^data:|firebasestorage|googleapis/.test(videoUrl) || /\.(mp4|webm|mov|ogg)(\?|$)/i.test(videoUrl);
      if (isUpload) {
        videoPreview.appendChild(el('video', { src: videoUrl, controls: true, muted: true, playsinline: true, class: 'video-preview' }));
      } else {
        videoPreview.appendChild(el('div', { class: 'video-preview-link' }, '🔗 External video set — ', el('a', { href: videoUrl, target: '_blank', rel: 'noopener' }, 'open')));
      }
      videoPreview.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', style: 'margin-top:6px', onclick: () => { videoUrl = ''; videoInput.value = ''; paintVideoPreview(); } }, 'Remove video'));
    };
    paintVideoPreview();
    videoUploadBtn.addEventListener('click', () => videoFile.click());
    videoFile.addEventListener('change', async () => {
      const f = videoFile.files && videoFile.files[0];
      videoFile.value = '';
      if (!f) return;
      showVideoErr('');
      videoUploadBtn.disabled = true;
      videoUploadBtn.textContent = 'Uploading…';
      try {
        const up = await uploadFile(f, 'templates/videos');
        videoUrl = up.url;
        videoInput.value = up.url;
        paintVideoPreview();
        toast(up.via === 'cloudinary' ? 'Video uploaded to Cloudinary CDN.' : up.via === 'catbox' ? 'Video uploaded via free host.' : 'Video embedded.', 'success');
      } catch (err) {
        showVideoErr(err.message || friendlyError(err));
      } finally {
        videoUploadBtn.disabled = false;
        videoUploadBtn.textContent = '⬆ Upload video';
      }
    });
    form.appendChild(videoBlock);

    const flags = el('div', { class: 'split-3' });
    const flagCheckbox = (name, label, checked) => el('label', { style: 'flex-direction:row;align-items:center;gap:8px' },
      el('input', { type: 'checkbox', name, ...(checked ? { checked: true } : {}) }), document.createTextNode(label));
    flags.appendChild(flagCheckbox('isResponsive', 'Responsive', t.isResponsive));
    flags.appendChild(flagCheckbox('isSeoReady', 'SEO-Ready', t.isSeoReady));
    flags.appendChild(flagCheckbox('sourceCodeIncluded', 'Source included', t.sourceCodeIncluded));
    form.appendChild(flags);
    const flags2 = el('div', { class: 'split' });
    flags2.appendChild(flagCheckbox('isFeatured', 'Featured', t.isFeatured));
    flags2.appendChild(flagCheckbox('isActive', 'Active', t.isActive));
    form.appendChild(flags2);

    const keepUrl = u => (String(u || '').startsWith('data:image/') ? u : safeUrl(u));
    let images = [...(t.images || [])].map(keepUrl).filter(Boolean);
    let thumbnailUrl = keepUrl(t.thumbnailUrl) || (images[0] || '');
    const imgWrap = el('div', { class: 'img-url-block media-upload-block' });
    imgWrap.appendChild(el('div', { class: 'img-url-label' }, 'Images'));
    imgWrap.appendChild(el('p', { class: 'img-url-hint' }, 'Upload images or paste URLs. Click a thumbnail to make it the cover.'));

    const urlRow = el('div', { class: 'img-url-row' });
    const urlInput = el('input', { type: 'url', class: 'img-url-input', placeholder: 'https://example.com/image.jpg' });
    const addBtn = el('button', { type: 'button', class: 'btn btn-primary img-url-add' }, '+ Add URL');
    const uploadBtn = el('button', { type: 'button', class: 'btn btn-primary img-url-add' }, '⬆ Upload');
    const imgFile = el('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
    urlRow.appendChild(urlInput);
    urlRow.appendChild(addBtn);
    urlRow.appendChild(uploadBtn);
    imgWrap.appendChild(urlRow);
    imgWrap.appendChild(imgFile);

    const errLine = el('div', { class: 'img-url-error', style: 'display:none' }, '');
    imgWrap.appendChild(errLine);
    const preview = el('div', { class: 'image-preview' });
    imgWrap.appendChild(preview);

    const showErr = (msg) => {
      if (!msg) { errLine.style.display = 'none'; errLine.textContent = ''; return; }
      errLine.textContent = msg;
      errLine.style.display = 'block';
    };

    const paintPreview = () => {
      preview.innerHTML = '';
      images.forEach((src, idx) => {
        const imgEl = el('img', { src, alt: `Image ${idx + 1}`, loading: 'lazy' });
        imgEl.addEventListener('error', () => imgEl.style.display = 'none');
        const item = el('div', { class: 'item' }, imgEl,
          el('button', {
            type: 'button', class: 'img-remove-btn',
            onclick: (ev) => { ev.stopPropagation(); images.splice(idx, 1); if (thumbnailUrl === src) thumbnailUrl = images[0] || ''; paintPreview(); }
          }, '✕'),
          (src === thumbnailUrl ? el('span', { class: 'img-cover-badge' }, 'Cover') : null)
        );
        if (src === thumbnailUrl) item.classList.add('is-cover');
        item.addEventListener('click', e => { if (e.target.tagName === 'BUTTON') return; thumbnailUrl = src; paintPreview(); });
        preview.appendChild(item);
      });
    };
    paintPreview();

    const addUrl = () => {
      const raw = (urlInput.value || '').trim();
      if (!raw) { showErr('Please paste an image URL first.'); return; }
      const clean = safeUrl(raw);
      if (!clean) { showErr('Not a valid http(s) URL.'); return; }
      if (images.includes(clean)) { showErr('Already in the list.'); return; }
      if (images.length >= 10) { showErr('Maximum of 10 images.'); return; }
      images.push(clean);
      if (!thumbnailUrl) thumbnailUrl = clean;
      urlInput.value = ''; showErr(''); paintPreview();
    };

    addBtn.addEventListener('click', addUrl);
    urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });

    // Upload one or more images — Storage first, Base64 fallback for small files.
    uploadBtn.addEventListener('click', () => imgFile.click());
    imgFile.addEventListener('change', async () => {
      const files = Array.from(imgFile.files || []);
      imgFile.value = '';
      if (!files.length) return;
      showErr('');
      uploadBtn.disabled = true;
      let done = 0;
      for (const f of files) {
        uploadBtn.textContent = `Uploading ${done + 1}/${files.length}…`;
        try {
          if (images.length >= 10) { showErr('Maximum of 10 images.'); break; }
          const up = await uploadFile(f, 'templates/images');
          if (!images.includes(up.url)) {
            // Guard Firestore's 1 MiB doc limit for inline (Base64) images.
            if (up.via === 'dataUrl') {
              const current = images.filter(u => String(u).startsWith('data:')).reduce((s, u) => s + u.length, 0);
              if (current + up.url.length > 950000) {
                showErr(`"${f.name}" would exceed Firestore's inline limit. Configure Cloudinary (Settings → Uploads) for unlimited images, or use a smaller file.`);
                continue;
              }
            }
            images.push(up.url);
            if (!thumbnailUrl) thumbnailUrl = up.url;
          }
          done++;
        } catch (err) {
          showErr(err.message || friendlyError(err));
        }
      }
      uploadBtn.disabled = false;
      uploadBtn.textContent = '⬆ Upload';
      paintPreview();
      if (done) toast(`${done} image${done > 1 ? 's' : ''} added (free hosting — no Storage needed).`, 'success');
    });

    form.appendChild(imgWrap);

    const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, id ? 'Save template' : 'Create template');
    form.appendChild(submit);

    const ensureUniqueSlug = async (base, selfId) => {
      let candidate = base;
      for (let n = 2; n <= 50; n++) {
        const snap = await db.collection('templates').where('slug', '==', candidate).limit(1).get();
        if (snap.empty || snap.docs[0].id === selfId) return candidate;
        candidate = `${base}-${n}`;
      }
      throw new Error('Could not find a unique slug.');
    };

    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        if (!name) { toast('Name is required.', 'error'); return; }
        if (!S.categories.length) { toast('Create a category first.', 'error'); return; }
        let tplSlug = slug(String(fd.get('slug') || '')) || slug(name);
        if (!tplSlug) { toast('Slug is invalid.', 'error'); return; }

        const price = numOr(fd.get('price'), null, { min: 0, max: 10000000 });
        if (price === null) { toast('Price must be a number ≥ 0.', 'error'); return; }
        const discountPrice = numOr(fd.get('discountPrice'), 0, { min: 0, max: 10000000 });
        if (discountPrice === null) { toast('Discount price invalid.', 'error'); return; }
        if (discountPrice && discountPrice >= price) { toast('Discount price must be lower than price.', 'error'); return; }

        const deliveryTimeDays = numOr(fd.get('deliveryTimeDays'), 3, { min: 1, max: 365 });
        const supportDurationDays = numOr(fd.get('supportDurationDays'), 30, { min: 0, max: 3650 });

        tplSlug = await ensureUniqueSlug(tplSlug, id || null);

        const data = {
          name, slug: tplSlug,
          categoryId: fd.get('categoryId'),
          shortDescription: String(fd.get('shortDescription') || '').trim().slice(0, 200),
          longDescription: String(fd.get('longDescription') || '').trim().slice(0, 5000),
          price, discountPrice, currency: 'INR',
          deliveryTimeDays, supportDurationDays,
          customizationLevel: ['basic', 'standard', 'full'].includes(fd.get('customizationLevel')) ? fd.get('customizationLevel') : 'standard',
          demoUrl: String(fd.get('demoUrl') || '').trim(),
          videoUrl: String(videoUrl || '').trim().slice(0, 200000),
          technology: String(fd.get('technology') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 12),
          pagesIncluded: String(fd.get('pagesIncluded') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20),
          isResponsive: !!fd.get('isResponsive'),
          isSeoReady: !!fd.get('isSeoReady'),
          sourceCodeIncluded: !!fd.get('sourceCodeIncluded'),
          isFeatured: !!fd.get('isFeatured'),
          isActive: !!fd.get('isActive'),
          images: images.slice(0, 10), thumbnailUrl,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: S.user.uid
        };

        // Firestore document hard limit: 1 MiB. Embedded Base64 images live
        // INSIDE the template doc, so enforce a safe payload budget (~950KB
        // total for all inline images) with a clear, actionable error.
        const inlineBytes = data.images
          .filter(u => String(u).startsWith('data:'))
          .reduce((sum, u) => sum + u.length, 0) + (String(thumbnailUrl).startsWith('data:') ? thumbnailUrl.length : 0);
        if (inlineBytes > 950000) {
          toast('Inline images exceed Firestore\'s 1 MB document limit. Configure Cloudinary in Settings → Uploads (free, 2 min), or use fewer / smaller images.', 'error');
          return;
        }

        if (id) {
          await db.collection('templates').doc(id).update(data);
        } else {
          data.rating = { average: 0, count: 0 };
          data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
          await db.collection('templates').add(data);
        }
        toast('Template saved.', 'success');
        closeDrawer();
        load();
      } catch (err) {
        console.error('Template save failed:', err);
        toast(friendlyError(err), 'error');
      } finally {
        submit.disabled = false;
      }
    });

    openDrawer(form);
  };

  $('#tpl-new').addEventListener('click', () => editOrCreate(null).catch(e => toast(friendlyError(e), 'error')));
  $('#tpl-search').addEventListener('input', render);
  $('#tpl-cat-filter').addEventListener('change', render);

  return { load };
})();

// ==== SECTION: CATEGORIES ====
const Categories = (() => {
  let categories = [];

  const load = async () => {
    const snap = await db.collection('categories').orderBy('order').get();
    categories = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  };

  const render = () => {
    const tbody = $('#cat-table tbody');
    tbody.innerHTML = '';
    categories.forEach(c => {
      tbody.appendChild(el('tr', {},
        el('td', {}, c.name || '(unnamed)'),
        el('td', {}, c.slug || '—'),
        el('td', {}, String(c.order ?? 0)),
        el('td', {}, c.isActive !== false ? '✓' : '✕'),
        el('td', {}, el('div', { class: 'row-actions' },
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => toggleActive(c) }, c.isActive !== false ? 'Deactivate' : 'Activate'),
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => editOrCreate(c.id) }, 'Edit'),
          el('button', { type: 'button', class: 'btn btn-danger', onclick: () => remove(c) }, 'Delete')
        ))
      ));
    });
    if (!tbody.children.length) tbody.appendChild(el('tr', {}, el('td', { colspan: 5, style: 'text-align:center;color:var(--text-muted);padding:32px' }, 'No categories yet.')));
  };

  const toggleActive = async c => {
    try {
      await db.collection('categories').doc(c.id).update({
        isActive: c.isActive === false,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      toast(`Category ${c.isActive === false ? 'activated' : 'deactivated'}.`, 'success');
      await loadCategories();
      load();
    } catch (e) { toast(friendlyError(e), 'error'); }
  };

  const remove = async c => {
    try {
      const used = await db.collection('templates').where('categoryId', '==', c.id).limit(1).get();
      if (!used.empty) { toast(`"${c.name}" still has templates.`, 'error'); return; }
    } catch (e) { toast(friendlyError(e), 'error'); return; }
    if (!await confirmDialog(`Delete category "${c.name}"?`)) return;
    try {
      await db.collection('categories').doc(c.id).delete();
      toast('Category deleted.', 'success');
      await loadCategories();
      load();
    } catch (e) { toast(friendlyError(e), 'error'); }
  };

  const editOrCreate = async id => {
    let c = { name: '', slug: '', order: (categories.length + 1) * 10, isActive: true, priceFrom: 0, featureHighlights: [], hero: { headline: '', subtext: '', ctaText: 'Browse templates', priceFrom: 0, gradientFrom: '#2F5CFF', gradientTo: '#8B5CF6' } };
    if (id) {
      const snap = await db.collection('categories').doc(id).get();
      if (snap.exists) c = { ...c, ...snap.data(), id, hero: { ...c.hero, ...(snap.data().hero || {}) } };
    }

    const form = el('form', { class: 'stacked', novalidate: true });
    form.appendChild(el('h2', {}, id ? 'Edit category' : 'New category'));
    form.appendChild(el('label', {}, 'Name', el('input', { name: 'name', value: c.name, required: true, maxlength: 80, oninput: e => { if (!id) form.querySelector('[name=slug]').value = slug(e.target.value); } })));

    const gA = el('div', { class: 'split' });
    gA.appendChild(el('label', {}, 'Slug', el('input', { name: 'slug', value: c.slug || '', maxlength: 80 })));
    gA.appendChild(el('label', {}, 'Order', el('input', { name: 'order', type: 'number', min: 0, step: 1, value: c.order })));
    form.appendChild(gA);

    form.appendChild(el('label', {}, 'Price from (INR)', el('input', { name: 'priceFrom', type: 'number', min: 0, step: 1, value: c.priceFrom || 0 })));
    form.appendChild(el('label', {}, 'Feature highlights (one per line)', el('textarea', { name: 'featureHighlights', rows: 3 }, (c.featureHighlights || []).join('\n'))));

    form.appendChild(el('label', {}, 'Headline', el('input', { name: 'headline', value: c.hero.headline || '', maxlength: 120 })));
    form.appendChild(el('label', {}, 'Subtext', el('input', { name: 'subtext', value: c.hero.subtext || '', maxlength: 240 })));
    const gB = el('div', { class: 'split' });
    gB.appendChild(el('label', {}, 'CTA text', el('input', { name: 'ctaText', value: c.hero.ctaText || 'Browse templates' })));
    gB.appendChild(el('label', {}, 'Hero price from', el('input', { name: 'heroPriceFrom', type: 'number', min: 0, step: 1, value: c.hero.priceFrom || 0 })));
    form.appendChild(gB);
    const gC = el('div', { class: 'split' });
    gC.appendChild(el('label', {}, 'Gradient from', el('input', { name: 'gradientFrom', type: 'color', value: c.hero.gradientFrom || '#2F5CFF' })));
    gC.appendChild(el('label', {}, 'Gradient to', el('input', { name: 'gradientTo', type: 'color', value: c.hero.gradientTo || '#8B5CF6' })));
    form.appendChild(gC);

    form.appendChild(el('label', { style: 'flex-direction:row;align-items:center;gap:8px' },
      el('input', { type: 'checkbox', name: 'isActive', ...(c.isActive !== false ? { checked: true } : {}) }), document.createTextNode(' Active')));

    const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, id ? 'Save category' : 'Create category');
    form.appendChild(submit);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        if (!name) { toast('Name is required.', 'error'); return; }
        const catSlug = slug(String(fd.get('slug') || '')) || slug(name);
        const order = Number(fd.get('order')) || 0;

        let finalSlug = catSlug;
        for (let n = 2; n <= 50; n++) {
          const dup = await db.collection('categories').where('slug', '==', finalSlug).limit(1).get();
          if (dup.empty || dup.docs[0].id === id) break;
          finalSlug = `${catSlug}-${n}`;
        }

        const data = {
          name, slug: finalSlug, order: Math.round(order),
          priceFrom: Number(fd.get('priceFrom')) || 0,
          isActive: !!fd.get('isActive'),
          featureHighlights: String(fd.get('featureHighlights') || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 10),
          hero: {
            headline: String(fd.get('headline') || '').trim(),
            subtext: String(fd.get('subtext') || '').trim(),
            ctaText: String(fd.get('ctaText') || 'Browse templates').trim(),
            priceFrom: Number(fd.get('heroPriceFrom')) || 0,
            gradientFrom: fd.get('gradientFrom') || '#2F5CFF',
            gradientTo: fd.get('gradientTo') || '#8B5CF6'
          },
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        if (id) await db.collection('categories').doc(id).update(data);
        else { data.createdAt = firebase.firestore.FieldValue.serverTimestamp(); await db.collection('categories').add(data); }
        toast('Category saved.', 'success');
        closeDrawer();
        await loadCategories();
        load();
      } catch (err) {
        toast(friendlyError(err), 'error');
      } finally { submit.disabled = false; }
    });

    openDrawer(form);
  };

  $('#cat-new').addEventListener('click', () => editOrCreate(null).catch(e => toast(friendlyError(e), 'error')));

  return { load };
})();

// ==== SECTION: ORDERS ====
const Orders = (() => {
  let orders = [];
  const STATUS_FLOW = {
    draft:                  ['cancelled'],
    payment_created:        ['cancelled'],
    payment_pending:        ['cancelled'],
    awaiting_verification:  ['paid', 'failed', 'cancelled'],
    paid:                   ['processing', 'cancelled'],
    processing:             ['completed', 'cancelled'],
    completed:              ['delivered'],
    delivered:              [],
    cancelled:              [],
    failed:                 ['cancelled'],
    abandoned:              [],
    expired:                []
  };

  const load = async () => {
    const snap = await db.collection('orders').orderBy('updatedAt', 'desc').limit(200).get();
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  };

  const filters = () => ({
    status: $('#ord-status').value,
    cat: $('#ord-cat').value,
    from: $('#ord-from').value ? new Date(`${$('#ord-from').value}T00:00:00`) : null,
    to: $('#ord-to').value ? new Date(`${$('#ord-to').value}T23:59:59`) : null,
    q: ($('#ord-search')?.value || '').trim().toLowerCase()
  });

  const methodLabel = m => m === 'manual_upi' ? '📱 UPI' : m === 'razorpay' ? '⚡ Razorpay' : '—';

  const render = () => {
    const f = filters();
    const tbody = $('#ord-table tbody');
    tbody.innerHTML = '';
    const filtered = orders.filter(o => {
      if (f.status && o.status !== f.status) return false;
      if (f.cat && o.categoryId !== f.cat) return false;
      const t = o.updatedAt?.toDate?.() || o.createdAt?.toDate?.() || null;
      if (f.from && (!t || t < f.from)) return false;
      if (f.to && (!t || t > f.to)) return false;
      if (f.q) {
        const hay = `${o.id} ${o.userEmail || ''} ${o.customer?.email || ''} ${o.templateName || ''} ${o.template?.name || ''} ${o.utr || ''} ${o.razorpayPaymentId || ''}`.toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
    const cnt = $('#ord-count'); if (cnt) cnt.textContent = `${filtered.length} of ${orders.length}`;
    filtered.forEach(o => {
      tbody.appendChild(el('tr', {},
        el('td', {}, `#${o.id.slice(0, 8)}`),
        el('td', {}, (o.customer && o.customer.email) || o.userEmail || (o.userId ? `${o.userId.slice(0, 10)}…` : '—')),
        el('td', {}, (o.template && o.template.name) || o.templateName || o.templateId || '—'),
        el('td', {}, o.amount != null ? fmtINR(o.amount) : '—'),
        el('td', {}, methodLabel(o.paymentMethod)),
        el('td', {}, el('span', { class: `status-pill status-${o.status || 'draft'}` }, String(o.status || 'draft').replace(/_/g, ' '))),
        el('td', {}, dateOnly(o.updatedAt)),
        el('td', {}, el('div', { class: 'row-actions' },
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => showDetail(o.id) }, 'View')
        ))
      ));
    });
    if (!tbody.children.length) tbody.appendChild(el('tr', {}, el('td', { colspan: 8, style: 'text-align:center;color:var(--text-muted);padding:32px' }, 'No orders match.')));
  };

  const kv = (k, v) => [el('dt', {}, k), el('dd', {}, v == null || v === '' ? '—' : String(v))];

  const showDetail = async id => {
    try {
      const snap = await db.collection('orders').doc(id).get();
      if (!snap.exists) { toast('Order not found.', 'error'); return; }
      const o = { id: snap.id, ...snap.data() };

      const wrap = el('div', { class: 'stacked' });
      wrap.appendChild(el('h2', {}, `Order #${o.id.slice(0, 8)}`));

      const dl = el('dl', { class: 'detail-kv' });
      [
        ...kv('Status', String(o.status || 'draft').replace(/_/g, ' ')),
        ...kv('Customer', (o.customer && o.customer.email) || o.userEmail || o.userId || '—'),
        ...kv('Template', (o.template && o.template.name) || o.templateName || o.templateId || '—'),
        ...kv('Amount', o.amount != null ? `${fmtINR(o.amount)} (${o.currency || 'INR'})` : '—'),
        ...kv('Payment method', methodLabel(o.paymentMethod)),
        ...kv('UTR / Reference', o.utr || o.razorpayPaymentId || '—'),
        ...kv('UPI VPA used', o.upiVpaUsed || '—'),
        ...kv('Razorpay order', o.razorpayOrderId || '—'),
        ...kv('Created', dateFmt(o.createdAt)),
        ...kv('Updated', dateFmt(o.updatedAt))
      ].forEach(n => dl.appendChild(n));
      wrap.appendChild(dl);

      // UTR / screenshot review block for manual UPI
      if (o.paymentMethod === 'manual_upi' && (o.utr || o.paymentScreenshotPath)) {
        wrap.appendChild(el('h3', { style: 'font-size:15px;margin:0' }, '🔎 Manual payment proof'));
        const proof = el('div', { class: 'proof-box' });
        if (o.utr) proof.appendChild(el('div', {}, el('strong', {}, 'UTR: '), o.utr));
        if (o.utrSubmittedAt) proof.appendChild(el('div', {}, el('strong', {}, 'Submitted: '), dateFmt(o.utrSubmittedAt)));
        if (o.paymentNote) proof.appendChild(el('div', {}, el('strong', {}, 'Customer note: '), o.paymentNote));
        if (o.paymentScreenshotData || o.paymentScreenshotPath) {
          const link = el('a', { href: '#', target: '_blank', rel: 'noopener', download: 'payment-screenshot.jpg' }, '📎 View screenshot');
          proof.appendChild(link);
          if (o.paymentScreenshotData) {
            link.href = o.paymentScreenshotData; // embedded data URL — no Storage needed
          } else if (storage) {
            storage.ref().child(String(o.paymentScreenshotPath)).getDownloadURL()
              .then(url => { link.href = url; })
              .catch(() => { link.textContent = 'Screenshot unavailable'; });
          } else {
            link.textContent = 'Screenshot unavailable';
          }
        }
        wrap.appendChild(proof);
      }

      if (o.formResponses && Object.keys(o.formResponses).length) {
        wrap.appendChild(el('h3', { style: 'font-size:15px;margin:0' }, 'Customer brief'));
        const fr = el('dl', { class: 'form-responses' });
        Object.entries(o.formResponses).forEach(([k, v]) => {
          const row = el('div', {});
          row.appendChild(el('dt', {}, k));
          row.appendChild(el('dd', {}, Array.isArray(v) ? v.join(', ') : String(v || '—')));
          fr.appendChild(row);
        });
        wrap.appendChild(fr);
      }

      const files = Object.entries(o.uploadedFiles || {});
      if (files.length) {
        wrap.appendChild(el('h3', { style: 'font-size:15px;margin:0' }, 'Uploaded files'));
        const ul = el('ul', { class: 'file-list' });
        wrap.appendChild(ul);
        files.forEach(([fieldId, val]) => {
          const li = el('li');
          ul.appendChild(li);
          // New format: file embedded in Firestore as a data URL (no Storage needed)
          if (val && typeof val === 'object' && val.dataUrl) {
            li.appendChild(el('a', {
              href: val.dataUrl, target: '_blank', rel: 'noopener noreferrer',
              download: val.name || fieldId
            }, `📎 ${val.name || fieldId}`));
            return;
          }
          // Legacy format: a Firebase Storage path
          if (!storage) { li.textContent = `${fieldId}: file unavailable`; return; }
          li.textContent = `Loading link for ${fieldId}…`;
          storage.ref().child(String(val)).getDownloadURL()
            .then(url => {
              li.textContent = '';
              li.appendChild(el('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, `📎 ${fieldId}`));
            })
            .catch(() => { li.textContent = `${fieldId}: file unavailable`; });
        });
      }

      const allowed = STATUS_FLOW[o.status] || [];
      if (allowed.length) {
        const gRow = el('div', { class: 'split' });
        const sel = el('select', { 'aria-label': 'New order status' });
        allowed.forEach(s => sel.appendChild(el('option', { value: s }, s)));
        gRow.appendChild(el('label', {}, 'Move to status', sel));
        const moveBtn = el('button', { type: 'button', class: 'btn btn-primary', style: 'align-self:end' }, 'Update status');
        gRow.appendChild(moveBtn);
        wrap.appendChild(gRow);
        moveBtn.addEventListener('click', async () => {
          moveBtn.disabled = true;
          try {
            const patch = {
              status: sel.value,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedBy: S.user.uid
            };
            if (sel.value === 'paid') {
              patch.paymentVerifiedAt = firebase.firestore.FieldValue.serverTimestamp();
              patch.paymentVerifiedBy = S.user.uid;
            }
            await db.collection('orders').doc(o.id).update(patch);
            toast(`Order moved to ${sel.value}.`, 'success');
            closeDrawer();
            load();
          } catch (err) {
            toast(friendlyError(err), 'error');
          } finally { moveBtn.disabled = false; }
        });
      } else {
        wrap.appendChild(el('p', { class: 'muted' }, `No status transitions from "${o.status}".`));
      }

      const notesArea = el('textarea', { name: 'adminNotes', rows: 3, maxlength: 2000 }, o.adminNotes || '');
      wrap.appendChild(el('label', {}, 'Admin notes', notesArea));
      const saveNotes = el('button', { type: 'button', class: 'btn btn-ghost' }, 'Save notes');
      wrap.appendChild(saveNotes);
      saveNotes.addEventListener('click', async () => {
        saveNotes.disabled = true;
        try {
          await db.collection('orders').doc(o.id).update({
            adminNotes: String(notesArea.value || '').slice(0, 2000),
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          toast('Notes saved.', 'success');
        } catch (err) { toast(friendlyError(err), 'error'); }
        finally { saveNotes.disabled = false; }
      });

      // ---- Delivery & live status (visible to the customer on their order) ----
      const canDeliver = ['paid', 'processing', 'completed', 'delivered'].includes(o.status);
      if (canDeliver) {
        wrap.appendChild(el('h3', { style: 'font-size:15px;margin:0' }, '🚀 Delivery & live status'));
        const liveSel = el('select', { name: 'liveStatus' });
        ['building', 'deployed', 'live', 'maintenance'].forEach(v =>
          liveSel.appendChild(el('option', { value: v, ...(v === (o.liveStatus || '') ? { selected: true } : {}) },
            ({ building: '🔨 Building', deployed: '📦 Deployed (staging)', live: '🟢 Live', maintenance: '🛠 Maintenance' })[v])));
        if (!o.liveStatus) liveSel.insertBefore(el('option', { value: '', selected: true }, '— not set —'), liveSel.firstChild);
        wrap.appendChild(el('label', {}, 'Portfolio live status', liveSel));

        const urlInput = el('input', { name: 'deliveryUrl', type: 'url', placeholder: 'https://customer-portfolio.vercel.app', value: o.deliveryUrl || '' });
        wrap.appendChild(el('label', {}, 'Live portfolio URL', urlInput));

        const noteInput = el('textarea', { name: 'deliveryNote', rows: 2, maxlength: 600, placeholder: 'e.g. Your portfolio is live! DNS may take up to 24h to propagate.' }, o.deliveryNote || '');
        wrap.appendChild(el('label', {}, 'Delivery note (shown to customer)', noteInput));

        // Deliverable file (source code ZIP / doc)
        const fileBlock = el('div', { class: 'media-upload-block' });
        fileBlock.appendChild(el('div', { class: 'img-url-label' }, 'Deliverable file (source code / docs)'));
        const fileInfo = el('div', { class: 'delivery-file-info' });
        const paintFile = () => {
          fileInfo.innerHTML = '';
          if (o.deliveryFile && o.deliveryFile.url) {
            fileInfo.appendChild(el('div', { class: 'delivery-file-current' },
              el('a', { href: o.deliveryFile.url, target: '_blank', rel: 'noopener' }, `📦 ${o.deliveryFile.name || 'Download deliverable'}`),
              el('button', { type: 'button', class: 'btn btn-ghost', onclick: async (ev) => {
                ev.preventDefault();
                if (!await confirmDialog('Remove the current deliverable file?')) return;
                try {
                  await db.collection('orders').doc(o.id).update({ deliveryFile: null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
                  o.deliveryFile = null;
                  paintFile();
                  toast('Deliverable removed.', 'success');
                } catch (err) { toast(friendlyError(err), 'error'); }
              } }, '✕ Remove')));
          } else {
            fileInfo.appendChild(el('p', { class: 'muted', style: 'margin:0' }, 'No deliverable uploaded yet.'));
          }
        };
        paintFile();
        const fileBtn = el('button', { type: 'button', class: 'btn btn-primary' }, '⬆ Upload deliverable (ZIP / PDF / doc)');
        const filePick = el('input', { type: 'file', accept: '.zip,.rar,.7z,.pdf,.doc,.docx,.txt,.md,application/zip,application/pdf', style: 'display:none' });
        const fileErr = el('div', { class: 'img-url-error', style: 'display:none' }, '');
        fileBlock.appendChild(fileInfo);
        fileBlock.appendChild(fileBtn);
        fileBlock.appendChild(filePick);
        fileBlock.appendChild(fileErr);
        // …or paste an external link (Google Drive / Dropbox / Mega)
        const linkRow = el('div', { class: 'img-url-row', style: 'margin-top:10px' });
        const linkInput = el('input', { type: 'url', class: 'img-url-input', placeholder: '…or paste a Google Drive / Dropbox / Mega link' });
        const linkBtn = el('button', { type: 'button', class: 'btn btn-ghost img-url-add' }, '🔗 Use link');
        linkRow.appendChild(linkInput);
        linkRow.appendChild(linkBtn);
        fileBlock.appendChild(linkRow);
        fileBtn.addEventListener('click', () => filePick.click());
        filePick.addEventListener('change', async () => {
          const f = filePick.files && filePick.files[0];
          filePick.value = '';
          if (!f) return;
          fileErr.style.display = 'none';
          fileBtn.disabled = true;
          fileBtn.textContent = 'Uploading…';
          try {
            const up = await uploadFile(f, `orders/${o.id}/delivery`);
            o.deliveryFile = { name: up.name, url: up.url, path: up.path || '', size: up.size || 0, type: up.type || '' };
            await db.collection('orders').doc(o.id).update({ deliveryFile: o.deliveryFile, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            paintFile();
            toast(`Deliverable live via ${up.via === 'catbox' ? 'free host' : up.via} — customer can download it now.`, 'success');
          } catch (err) {
            fileErr.textContent = err.message || friendlyError(err);
            fileErr.style.display = 'block';
          } finally {
            fileBtn.disabled = false;
            fileBtn.textContent = '⬆ Upload deliverable (ZIP / PDF / doc)';
          }
        });
        linkBtn.addEventListener('click', async () => {
          const raw = String(linkInput.value || '').trim();
          const clean = safeUrl(raw);
          if (!clean) { fileErr.textContent = 'Paste a valid http(s) link.'; fileErr.style.display = 'block'; return; }
          fileErr.style.display = 'none';
          linkBtn.disabled = true;
          try {
            o.deliveryFile = { name: 'External deliverable link', url: clean, path: '', size: 0, type: 'link' };
            await db.collection('orders').doc(o.id).update({ deliveryFile: o.deliveryFile, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
            paintFile();
            toast('External deliverable link published.', 'success');
          } catch (err) { fileErr.textContent = friendlyError(err); fileErr.style.display = 'block'; }
          finally { linkBtn.disabled = false; }
        });
        wrap.appendChild(fileBlock);

        const saveDelivery = el('button', { type: 'button', class: 'btn btn-primary' }, '💾 Save delivery & publish to customer');
        wrap.appendChild(saveDelivery);
        saveDelivery.addEventListener('click', async () => {
          const url = String(urlInput.value || '').trim();
          if (url && !safeUrl(url)) { toast('Live portfolio URL is not a valid http(s) link.', 'error'); return; }
          saveDelivery.disabled = true;
          try {
            const patch = {
              liveStatus: liveSel.value || null,
              deliveryUrl: url,
              deliveryNote: String(noteInput.value || '').slice(0, 600),
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
              updatedBy: S.user.uid
            };
            // Publishing a live URL implies the order is delivered.
            if (url && ['paid', 'processing', 'completed'].includes(o.status)) {
              patch.status = 'delivered';
              patch.deliveredAt = firebase.firestore.FieldValue.serverTimestamp();
            }
            await db.collection('orders').doc(o.id).update(patch);
            o.liveStatus = liveSel.value;
            o.deliveryUrl = url;
            o.deliveryNote = patch.deliveryNote;
            toast('Delivery published to the customer.', 'success');
            load();
          } catch (err) { toast(friendlyError(err), 'error'); }
          finally { saveDelivery.disabled = false; }
        });
      }

      openDrawer(wrap);
    } catch (e) {
      toast(friendlyError(e), 'error');
    }
  };

  // NEW: CSV export of the current filtered orders set
  const exportCsv = () => {
    const f = filters();
    const rows = orders.filter(o => {
      if (f.status && o.status !== f.status) return false;
      if (f.cat && o.categoryId !== f.cat) return false;
      const t = o.updatedAt?.toDate?.() || o.createdAt?.toDate?.() || null;
      if (f.from && (!t || t < f.from)) return false;
      if (f.to && (!t || t > f.to)) return false;
      if (f.q) {
        const hay = `${o.id} ${o.userEmail || ''} ${o.templateName || ''}`.toLowerCase();
        if (!hay.includes(f.q)) return false;
      }
      return true;
    });
    if (!rows.length) { toast('Nothing to export.', 'info'); return; }
    const header = ['order_id','customer','template','amount','currency','method','status','utr','razorpay_id','created_at','updated_at'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    rows.forEach(o => lines.push([
      o.id,
      o.customer?.email || o.userEmail || o.userId || '',
      o.template?.name || o.templateName || '',
      o.amount || 0,
      o.currency || 'INR',
      o.paymentMethod || '',
      o.status || '',
      o.utr || '',
      o.razorpayPaymentId || '',
      o.createdAt?.toDate?.().toISOString() || '',
      o.updatedAt?.toDate?.().toISOString() || ''
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`Exported ${rows.length} orders.`, 'success');
  };

  $('#ord-apply').addEventListener('click', render);
  ['#ord-status', '#ord-cat'].forEach(sel => $(sel).addEventListener('change', render));
  ['#ord-from', '#ord-to'].forEach(sel => $(sel).addEventListener('change', render));
  $('#ord-search')?.addEventListener('input', () => { clearTimeout(window.__ordSearchT); window.__ordSearchT = setTimeout(render, 200); });
  $('#ord-export')?.addEventListener('click', exportCsv);

  return { load, exportCsv };
})();

// ==== SECTION: CUSTOMERS (upgraded — search, CSV, detail drawer) ====
// deleteUserCascade — removes EVERY piece of data tied to a uid:
//   users/{uid} profile, all their orders (incl. embedded files & payment
//   screenshots stored in Firestore), their reviews, and their contact
//   messages. Firebase Auth account deletion requires the Admin SDK — the
//   client marks the uid in `deletedUsers` so your backend/scheduled function
//   (or manual Console action) can finish the auth-side removal.
const deleteUserCascade = async uid => {
  const result = { orders: 0, reviews: 0, messages: 0 };

  // 1) Orders (each may carry uploadedFiles / paymentScreenshotData embedded
  //    in Firestore — deleting the doc removes those bytes too).
  const ordSnap = await db.collection('orders').where('userId', '==', uid).limit(1000).get().catch(() => ({ docs: [] }));
  for (const d of ordSnap.docs) { await db.collection('orders').doc(d.id).delete(); }
  result.orders = ordSnap.docs.length;

  // 2) Reviews authored by the user
  const revSnap = await db.collection('reviews').where('userId', '==', uid).limit(1000).get().catch(() => ({ docs: [] }));
  for (const d of revSnap.docs) { await db.collection('reviews').doc(d.id).delete(); }
  result.reviews = revSnap.docs.length;

  // 3) Contact messages linked to the user (or matching their email)
  const msgByUid = await db.collection('contactMessages').where('userId', '==', uid).limit(1000).get().catch(() => ({ docs: [] }));
  const seen = new Set();
  for (const d of msgByUid.docs) { seen.add(d.id); await db.collection('contactMessages').doc(d.id).delete(); }
  result.messages = seen.size;

  // 4) The profile doc itself
  await db.collection('users').doc(uid).delete();

  // 5) Tombstone for the auth account (backend / manual cleanup hook).
  //    Client SDKs cannot delete Firebase Auth users — a scheduled function
  //    or manual Console action consumes this collection.
  try {
    await db.collection('deletedUsers').doc(uid).set({
      uid,
      deletedAt: firebase.firestore.FieldValue.serverTimestamp(),
      deletedBy: S.user.uid,
      reason: 'admin_cascade_delete'
    });
  } catch (e) { console.warn('deletedUsers tombstone failed (non-fatal):', e); }

  return result;
};

const Customers = (() => {
  let allUsers = [];

  const load = async () => {
    let snap;
    try { snap = await db.collection('users').orderBy('createdAt', 'desc').limit(500).get(); }
    catch (e) { snap = await db.collection('users').limit(500).get(); }
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    render();
  };

  const render = () => {
    const q = ($('#cus-search')?.value || '').trim().toLowerCase();
    const tbody = $('#cus-table tbody');
    tbody.innerHTML = '';
    const rows = allUsers.filter(u => !q ||
      (u.name || '').toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.phone || '').toLowerCase().includes(q));
    const cnt = $('#cus-count'); if (cnt) cnt.textContent = `${rows.length} of ${allUsers.length}`;
    rows.forEach(u => {
      const tr = el('tr', {},
        el('td', {}, u.name || '(no name)'),
        el('td', {}, u.email || '—'),
        el('td', {}, u.phone || '—'),
        el('td', {}, u.createdAt?.toDate ? u.createdAt.toDate().toLocaleDateString() : '—'),
        el('td', {}, el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => showDetail(u.id) }, 'View'))
      );
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) tbody.appendChild(el('tr', {}, el('td', { colspan: 5, style: 'text-align:center;color:var(--text-muted);padding:32px' }, 'No customers found.')));
  };

  const showDetail = async uid => {
    try {
      const [uSnap, oSnap] = await Promise.all([
        db.collection('users').doc(uid).get(),
        db.collection('orders').where('userId', '==', uid).limit(200).get().catch(() => ({ docs: [] }))
      ]);
      if (!uSnap.exists) { toast('Customer not found.', 'error'); return; }
      const u = { id: uSnap.id, ...uSnap.data() };
      const orders = oSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      const PAID = ['paid', 'processing', 'completed', 'delivered'];
      const spend = orders.filter(o => PAID.includes(o.status)).reduce((s, o) => s + (o.amount || 0), 0);

      const wrap = el('div', { class: 'stacked' });
      wrap.appendChild(el('h2', {}, u.name || '(no name)'));
      const dl = el('dl', { class: 'detail-kv' });
      const kv2 = (k, v) => { dl.appendChild(el('dt', {}, k)); dl.appendChild(el('dd', {}, v == null || v === '' ? '—' : String(v))); };
      kv2('UID', u.id);
      kv2('Email', u.email);
      kv2('Phone', u.phone);
      kv2('Joined', dateFmt(u.createdAt));
      kv2('Last login', dateFmt(u.lastLoginAt));
      kv2('Total orders', orders.length);
      kv2('Lifetime spend', fmtINR(spend));
      wrap.appendChild(dl);

      if (orders.length) {
        wrap.appendChild(el('h3', { style: 'font-size:15px;margin:12px 0 4px' }, 'Recent orders'));
        const tbl = el('table', { class: 'mini-table' });
        tbl.appendChild(el('thead', {}, el('tr', {}, el('th', {}, 'Order'), el('th', {}, 'Template'), el('th', {}, 'Amount'), el('th', {}, 'Status'))));
        const tb = el('tbody');
        orders.slice(0, 20).forEach(o => tb.appendChild(el('tr', {},
          el('td', {}, `#${o.id.slice(0, 8)}`),
          el('td', {}, o.template?.name || o.templateName || '—'),
          el('td', {}, o.amount != null ? fmtINR(o.amount) : '—'),
          el('td', {}, el('span', { class: `status-pill status-${o.status || 'draft'}` }, String(o.status || 'draft').replace(/_/g, ' ')))
        )));
        tbl.appendChild(tb);
        wrap.appendChild(tbl);
      }

      // ---- Danger zone: full account + data deletion ----
      const danger = el('div', { class: 'danger-zone' });
      danger.appendChild(el('h3', { style: 'font-size:15px;margin:0;color:#F87171' }, '⚠️ Danger zone'));
      danger.appendChild(el('p', { class: 'muted', style: 'margin:0;font-size:13px' },
        'Deletes EVERYTHING stored for this customer: profile, all orders, reviews, contact messages, uploaded files and payment screenshots. This cannot be undone.'));
      const delBtn = el('button', { type: 'button', class: 'btn btn-danger' }, `🗑 Delete account & all data`);
      danger.appendChild(delBtn);
      delBtn.addEventListener('click', async () => {
        const label = u.email || u.name || u.id;
        if (!await confirmDialog(`DELETE ${label}?\n\nThis permanently removes their profile, ${orders.length} order(s), reviews, messages and uploaded files. There is no undo.`)) return;
        delBtn.disabled = true;
        delBtn.textContent = 'Deleting…';
        try {
          const result = await deleteUserCascade(u.id);
          toast(`Deleted ${label}: profile + ${result.orders} orders, ${result.reviews} reviews, ${result.messages} messages removed.`, 'success');
          closeDrawer();
          load();
        } catch (err) {
          console.error('User cascade delete failed:', err);
          toast(friendlyError(err), 'error');
          delBtn.disabled = false;
          delBtn.textContent = '🗑 Delete account & all data';
        }
      });
      wrap.appendChild(danger);
      openDrawer(wrap);
    } catch (e) { toast(friendlyError(e), 'error'); }
  };

  const exportCsv = () => {
    if (!allUsers.length) { toast('Nothing to export.', 'info'); return; }
    const header = ['uid', 'name', 'email', 'phone', 'created_at', 'last_login_at'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    allUsers.forEach(u => lines.push([
      u.id, u.name || '', u.email || '', u.phone || '',
      u.createdAt?.toDate?.().toISOString() || '',
      u.lastLoginAt?.toDate?.().toISOString() || ''
    ].map(esc).join(',')));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`Exported ${allUsers.length} customers.`, 'success');
  };

  $('#cus-search')?.addEventListener('input', () => { clearTimeout(window.__cusSearchT); window.__cusSearchT = setTimeout(render, 200); });
  $('#cus-export')?.addEventListener('click', exportCsv);

  return { load, exportCsv };
})();

// ==== SECTION: MESSAGES ====
const Messages = (() => {
  let all = [];

  const waLink = raw => {
    const digits = String(raw || '').replace(/[^0-9]/g, '');
    return digits.length >= 7 ? `https://wa.me/${digits}` : '';
  };
  const waLinkWithText = (raw, name) => {
    const base = waLink(raw);
    if (!base) return '';
    const greet = `Hi ${name || 'there'}, this is ${(S.settings?.brandName || 'Folium')} support.`;
    return `${base}?text=${encodeURIComponent(greet)}`;
  };

  const load = async () => {
    try {
      let snap;
      try { snap = await db.collection('contactMessages').orderBy('createdAt', 'desc').limit(500).get(); }
      catch (e) { snap = await db.collection('contactMessages').limit(500).get(); }
      all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      all.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
      render();
      refreshBadge();
    } catch (e) {
      showViewError($('#v-messages'), e, () => Messages.load());
      throw e;
    }
  };

  const render = () => {
    const statusFilter = ($('#msg-status')?.value || '').trim();
    const q = ($('#msg-search')?.value || '').trim().toLowerCase();
    const list = $('#msg-list');
    if (!list) return;
    list.innerHTML = '';
    const filtered = all.filter(m => {
      const s = m.status || 'new';
      if (statusFilter && s !== statusFilter) return false;
      if (!q) return true;
      return (m.name || '').toLowerCase().includes(q) ||
        (m.email || '').toLowerCase().includes(q) ||
        (m.message || '').toLowerCase().includes(q);
    });
    const cnt = $('#msg-count');
    if (cnt) cnt.textContent = `${filtered.length} of ${all.length}`;
    if (!filtered.length) {
      list.appendChild(el('p', { class: 'muted', style: 'text-align:center;padding:40px' }, 'No messages.'));
      return;
    }
    filtered.forEach(m => list.appendChild(cardFor(m)));
  };

  const cardFor = m => {
    const status = m.status || 'new';
    const card = el('article', { class: `msg-card msg-status-${status}` });
    const head = el('header', { class: 'msg-head' });
    const identity = el('div', { class: 'msg-identity' });
    identity.appendChild(el('strong', { class: 'msg-name' }, m.name || '(no name)'));
    identity.appendChild(el('span', { class: `status-pill status-${status}` }, status));
    head.appendChild(identity);
    head.appendChild(el('span', { class: 'msg-date' }, dateFmt(m.createdAt)));
    card.appendChild(head);

    const meta = el('div', { class: 'msg-meta' });
    if (m.email) meta.appendChild(el('a', { class: 'msg-chip', href: `mailto:${m.email}` }, `✉ ${m.email}`));
    const waDisplay = m.whatsappRaw || m.whatsapp || '';
    if (waDisplay) {
      const waHref = waLinkWithText(m.whatsapp || waDisplay, m.name);
      if (waHref) meta.appendChild(el('a', { class: 'msg-chip msg-chip-wa', href: waHref, target: '_blank', rel: 'noopener' }, `💬 ${waDisplay}`));
    }
    card.appendChild(meta);
    card.appendChild(el('div', { class: 'msg-body' }, m.message || '(empty)'));

    const actions = el('div', { class: 'msg-actions' });
    const setStatus = async newStatus => {
      try {
        await db.collection('contactMessages').doc(m.id).set({ status: newStatus }, { merge: true });
        m.status = newStatus;
        render();
        refreshBadge();
      } catch (e) { toast(friendlyError(e), 'error'); }
    };
    if (status !== 'read') actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => setStatus('read') }, 'Mark read'));
    if (status !== 'replied') actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => setStatus('replied') }, 'Mark replied'));
    if (status !== 'archived') actions.appendChild(el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => setStatus('archived') }, 'Archive'));
    card.appendChild(actions);
    return card;
  };

  const refreshBadge = () => {
    const unread = all.filter(m => (m.status || 'new') === 'new').length;
    const b = $('#msg-badge');
    if (!b) return;
    if (unread > 0) { b.textContent = String(unread); b.hidden = false; } else b.hidden = true;
  };

  const wireLiveBadge = () => {
    registerListener(db.collection('contactMessages').where('status', '==', 'new').onSnapshot(snap => {
      const b = $('#msg-badge');
      if (!b) return;
      if (snap.size > 0) { b.textContent = String(snap.size); b.hidden = false; } else b.hidden = true;
    }, () => {}));
  };

  $('#msg-apply')?.addEventListener('click', render);
  $('#msg-refresh')?.addEventListener('click', load);
  $('#msg-status')?.addEventListener('change', render);
  $('#msg-search')?.addEventListener('input', render);

  return { load, wireLiveBadge };
})();

// ==== SECTION: REVIEWS ====
const Reviews = (() => {
  let all = [];
  const load = async () => {
    let snap;
    try { snap = await db.collection('reviews').orderBy('createdAt', 'desc').limit(300).get(); }
    catch (e) { snap = await db.collection('reviews').limit(300).get(); }
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  };
  const render = () => {
    const statusFilter = $('#rev-status').value;
    const list = $('#rev-list');
    list.innerHTML = '';
    const rows = all.filter(r => !statusFilter || (r.status || 'pending') === statusFilter);
    if (!rows.length) { list.appendChild(el('p', { class: 'muted', style: 'padding:40px;text-align:center' }, 'No reviews.')); return; }
    rows.forEach(r => {
      const card = el('article', { class: 'msg-card' });
      card.appendChild(el('header', { class: 'msg-head' },
        el('strong', {}, `${'★'.repeat(r.rating || 0)} · ${r.userName || 'Anonymous'}`),
        el('span', { class: `status-pill status-${r.status || 'pending'}` }, r.status || 'pending')
      ));
      card.appendChild(el('div', { class: 'msg-body' }, r.comment || ''));
      const actions = el('div', { class: 'msg-actions' });
      if (r.status !== 'approved') actions.appendChild(el('button', { class: 'btn btn-primary', type: 'button', onclick: () => setStatus(r.id, 'approved') }, '✓ Approve'));
      if (r.status !== 'hidden') actions.appendChild(el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => setStatus(r.id, 'hidden') }, 'Hide'));
      card.appendChild(actions);
      list.appendChild(card);
    });
  };
  const setStatus = async (id, status) => {
    try {
      await db.collection('reviews').doc(id).update({ status });
      toast('Review updated.', 'success');
      load();
    } catch (e) { toast(friendlyError(e), 'error'); }
  };
  $('#rev-apply').addEventListener('click', render);
  $('#rev-status').addEventListener('change', render);
  return { load };
})();

// ==== SECTION: PAYMENTS (UPGRADED with UTR verification) ====
const Payments = (() => {
  let all = [];
  const PAID_STATUSES = ['paid', 'processing', 'completed', 'delivered'];

  const load = async () => {
    // FIX: 'in' + orderBy needs a composite index that most fresh Firestore
    // projects lack. Try the ideal query, then progressively fall back.
    const wanted = ['payment_created', 'payment_pending', 'awaiting_verification', 'paid', 'processing', 'completed', 'delivered', 'failed'];
    let snap = null;
    try {
      snap = await db.collection('orders')
        .where('status', 'in', wanted)
        .orderBy('updatedAt', 'desc').limit(300).get();
    } catch (e1) {
      console.warn('Payments primary query failed, falling back to unordered:', e1);
      try {
        snap = await db.collection('orders').where('status', 'in', wanted).limit(300).get();
      } catch (e2) {
        console.warn('Payments in-query failed, falling back to full scan:', e2);
        try {
          snap = await db.collection('orders').orderBy('updatedAt', 'desc').limit(300).get();
        } catch (e3) {
          snap = await db.collection('orders').limit(300).get();
        }
      }
    }
    all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(o => !o.status || wanted.includes(o.status))
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0));
    render();
    refreshBadge();
  };

  const methodLabel = m => m === 'manual_upi' ? '📱 Manual UPI' : m === 'razorpay' ? '⚡ Razorpay' : '—';

  const render = () => {
    const sFilter = $('#pay-status')?.value || '';
    const mFilter = $('#pay-method')?.value || '';
    const tbody = $('#pay-table tbody');
    tbody.innerHTML = '';
    const rows = all.filter(o => {
      if (sFilter && o.status !== sFilter) return false;
      if (mFilter && o.paymentMethod !== mFilter) return false;
      return true;
    });
    rows.forEach(o => {
      const tr = el('tr', {},
        el('td', {}, o.razorpayPaymentId || o.utr || '—'),
        el('td', {}, `#${o.id.slice(0, 8)}`),
        el('td', {}, methodLabel(o.paymentMethod)),
        el('td', {}, o.utr || o.razorpayPaymentId || '—'),
        el('td', {}, o.amount != null ? `${fmtINR(o.amount)}` : '—'),
        el('td', {}, el('span', { class: `status-pill status-${o.status}` }, String(o.status).replace(/_/g, ' '))),
        el('td', {}, PAID_STATUSES.includes(o.status)
          ? `✓ ${o.paymentVerifiedAt?.toDate ? o.paymentVerifiedAt.toDate().toLocaleDateString() : 'verified'}`
          : (o.status === 'awaiting_verification' ? '🔎 needs review' : '—')),
        el('td', {}, el('div', { class: 'row-actions' },
          (o.status === 'awaiting_verification'
            ? el('button', { type: 'button', class: 'btn btn-primary', onclick: () => verify(o.id, true) }, '✓ Verify')
            : null),
          (o.status === 'awaiting_verification'
            ? el('button', { type: 'button', class: 'btn btn-danger', onclick: () => verify(o.id, false) }, '✖ Reject')
            : null),
          el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => showProof(o.id) }, 'View')
        ))
      );
      tbody.appendChild(tr);
    });
    if (!tbody.children.length) tbody.appendChild(el('tr', {}, el('td', { colspan: 8, style: 'text-align:center;color:var(--text-muted);padding:32px' }, 'No payments match.')));
  };

  const showProof = async id => {
    const snap = await db.collection('orders').doc(id).get();
    if (!snap.exists) { toast('Order not found.', 'error'); return; }
    const o = { id: snap.id, ...snap.data() };
    const wrap = el('div', { class: 'stacked' });
    wrap.appendChild(el('h2', {}, `Payment #${o.id.slice(0, 8)}`));
    const dl = el('dl', { class: 'detail-kv' });
    [
      ['Method', methodLabel(o.paymentMethod)],
      ['Amount', o.amount != null ? fmtINR(o.amount) : '—'],
      ['UTR', o.utr || '—'],
      ['Razorpay payment id', o.razorpayPaymentId || '—'],
      ['UPI VPA used', o.upiVpaUsed || '—'],
      ['Customer note', o.paymentNote || '—'],
      ['Submitted', dateFmt(o.utrSubmittedAt)],
      ['Verified', dateFmt(o.paymentVerifiedAt)],
      ['Status', o.status]
    ].forEach(([k, v]) => { dl.appendChild(el('dt', {}, k)); dl.appendChild(el('dd', {}, String(v || '—'))); });
    wrap.appendChild(dl);

    if (o.paymentScreenshotData || o.paymentScreenshotPath) {
      const img = el('img', { alt: 'Payment screenshot', style: 'max-width:100%;border-radius:12px;border:1px solid var(--border);margin-top:8px' });
      wrap.appendChild(img);
      if (o.paymentScreenshotData) {
        img.src = o.paymentScreenshotData; // embedded data URL — no Storage needed
      } else if (storage) {
        storage.ref().child(String(o.paymentScreenshotPath)).getDownloadURL()
          .then(url => { img.src = url; })
          .catch(() => { img.replaceWith(el('p', { class: 'muted' }, 'Screenshot unavailable.')); });
      } else {
        img.replaceWith(el('p', { class: 'muted' }, 'Screenshot unavailable.'));
      }
    }

    if (o.status === 'awaiting_verification') {
      const btnRow = el('div', { class: 'split' });
      btnRow.appendChild(el('button', { type: 'button', class: 'btn btn-primary btn-lg', onclick: () => { closeDrawer(); verify(o.id, true); } }, '✓ Verify & mark paid'));
      btnRow.appendChild(el('button', { type: 'button', class: 'btn btn-danger btn-lg', onclick: () => { closeDrawer(); verify(o.id, false); } }, '✖ Reject payment'));
      wrap.appendChild(btnRow);
    }

    openDrawer(wrap);
  };

  const verify = async (id, approve) => {
    if (approve && !await confirmDialog('Mark this manual payment as VERIFIED / PAID?')) return;
    if (!approve && !await confirmDialog('Reject this payment (mark as failed)?')) return;
    try {
      const patch = {
        status: approve ? 'paid' : 'failed',
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: S.user.uid
      };
      if (approve) {
        patch.paymentVerifiedAt = firebase.firestore.FieldValue.serverTimestamp();
        patch.paymentVerifiedBy = S.user.uid;
      } else {
        patch.paymentRejectedAt = firebase.firestore.FieldValue.serverTimestamp();
      }
      await db.collection('orders').doc(id).update(patch);
      toast(approve ? 'Payment verified.' : 'Payment rejected.', approve ? 'success' : 'info');
      load();
    } catch (e) { toast(friendlyError(e), 'error'); }
  };

  const refreshBadge = () => {
    const cnt = all.filter(o => o.status === 'awaiting_verification').length;
    const b = $('#pay-badge');
    if (!b) return;
    if (cnt > 0) { b.textContent = String(cnt); b.hidden = false; } else b.hidden = true;
  };

  const wireLiveBadge = () => {
    try {
      registerListener(db.collection('orders').where('status', '==', 'awaiting_verification').onSnapshot(snap => {
        const b = $('#pay-badge');
        if (!b) return;
        if (snap.size > 0) { b.textContent = String(snap.size); b.hidden = false; } else b.hidden = true;
      }, err => console.warn('Payments badge listener error:', err)));
    } catch (e) { console.warn('Payments badge wire failed:', e); }
  };

  // NEW: CSV export of the current filtered payment set
  const exportCsv = () => {
    const sFilter = $('#pay-status')?.value || '';
    const mFilter = $('#pay-method')?.value || '';
    const rows = all.filter(o => (!sFilter || o.status === sFilter) && (!mFilter || o.paymentMethod === mFilter));
    if (!rows.length) { toast('Nothing to export.', 'info'); return; }
    const header = ['order_id', 'method', 'utr_or_pay_id', 'amount', 'currency', 'status', 'verified_at', 'created_at'];
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    rows.forEach(o => {
      lines.push([
        o.id,
        o.paymentMethod || '',
        o.utr || o.razorpayPaymentId || '',
        o.amount || 0,
        o.currency || 'INR',
        o.status || '',
        o.paymentVerifiedAt?.toDate?.().toISOString() || '',
        o.createdAt?.toDate?.().toISOString() || ''
      ].map(esc).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    toast(`Exported ${rows.length} payments.`, 'success');
  };

  $('#pay-apply')?.addEventListener('click', render);
  $('#pay-status')?.addEventListener('change', render);
  $('#pay-method')?.addEventListener('change', render);
  $('#pay-export')?.addEventListener('click', exportCsv);

  return { load, wireLiveBadge, exportCsv };
})();

// ==== SECTION: FORMS ====
const Forms = (() => {
  let fields = [];

  const load = async () => {
    const snap = await db.collection('customForms').orderBy('order').get();
    fields = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  };

  const render = () => {
    const scope = $('#form-scope').value;
    const list = $('#fields-list');
    list.innerHTML = '';
    const filtered = fields.filter(f => scope === 'all' ? true : f.appliesTo === scope || f.appliesTo === 'all');
    if (!filtered.length) { list.appendChild(el('p', { class: 'muted', style: 'text-align:center;padding:32px' }, 'No fields yet.')); return; }
    filtered.forEach(f => list.appendChild(rowFor(f)));
  };

  const rowFor = f => {
    const row = el('div', { class: 'field-row' + (f.enabled ? '' : ' disabled') });
    row.appendChild(el('div', { class: 'grip' }, '⋮⋮'));
    row.appendChild(el('div', {},
      el('div', { class: 'fr-label' }, f.label),
      el('div', { class: 'fr-meta' }, `${f.type}${f.required ? ' · required' : ''}`)
    ));
    row.appendChild(el('div', { class: 'fr-meta' }, f.appliesTo === 'all' ? 'All categories' : (S.categories.find(c => c.id === f.appliesTo)?.name || f.appliesTo)));
    row.appendChild(el('div', { class: 'fr-actions' },
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => toggle(f.id, !f.enabled) }, f.enabled ? 'Disable' : 'Enable'),
      el('button', { type: 'button', class: 'btn btn-ghost', onclick: () => editOrCreate(f.id) }, 'Edit'),
      el('button', { type: 'button', class: 'btn btn-danger', onclick: () => remove(f.id) }, '✕')
    ));
    return row;
  };

  const toggle = async (id, enabled) => { try { await db.collection('customForms').doc(id).update({ enabled }); load(); } catch (e) { toast(friendlyError(e), 'error'); } };
  const remove = async id => {
    if (!await confirmDialog('Delete this field?')) return;
    try { await db.collection('customForms').doc(id).delete(); load(); }
    catch (e) { toast(friendlyError(e), 'error'); }
  };

  const editOrCreate = async id => {
    let f = { label: '', type: 'text', placeholder: '', required: false, options: [], order: (fields.length + 1) * 10, enabled: true, appliesTo: 'all' };
    if (id) {
      const snap = await db.collection('customForms').doc(id).get();
      if (snap.exists) f = { ...f, ...snap.data(), id };
    }
    const form = el('form', { class: 'stacked' });
    form.appendChild(el('h2', {}, id ? 'Edit field' : 'New field'));
    form.appendChild(el('label', {}, 'Label', el('input', { name: 'label', value: f.label, required: true })));
    const typeSel = el('select', { name: 'type' });
    ['text', 'email', 'phone', 'textarea', 'select', 'checkbox', 'radio', 'file', 'image', 'date', 'url'].forEach(t =>
      typeSel.appendChild(el('option', { value: t, ...(t === f.type ? { selected: true } : {}) }, t)));
    const scopeSel = el('select', { name: 'appliesTo' });
    scopeSel.appendChild(el('option', { value: 'all', ...(f.appliesTo === 'all' ? { selected: true } : {}) }, 'All categories'));
    S.categories.forEach(c => scopeSel.appendChild(el('option', { value: c.id, ...(c.id === f.appliesTo ? { selected: true } : {}) }, c.name)));

    const gA = el('div', { class: 'split' });
    gA.appendChild(el('label', {}, 'Type', typeSel));
    gA.appendChild(el('label', {}, 'Applies to', scopeSel));
    form.appendChild(gA);
    form.appendChild(el('label', {}, 'Placeholder', el('input', { name: 'placeholder', value: f.placeholder })));
    form.appendChild(el('label', {}, 'Options (one per line)', el('textarea', { name: 'options', rows: 3 }, (f.options || []).join('\n'))));
    const gB = el('div', { class: 'split' });
    gB.appendChild(el('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, el('input', { type: 'checkbox', name: 'required', ...(f.required ? { checked: true } : {}) }), document.createTextNode(' Required')));
    gB.appendChild(el('label', { style: 'flex-direction:row;align-items:center;gap:8px' }, el('input', { type: 'checkbox', name: 'enabled', ...(f.enabled ? { checked: true } : {}) }), document.createTextNode(' Enabled')));
    form.appendChild(gB);
    form.appendChild(el('label', {}, 'Order', el('input', { name: 'order', type: 'number', value: f.order })));
    const submit = el('button', { type: 'submit', class: 'btn btn-primary btn-lg' }, id ? 'Save' : 'Create');
    form.appendChild(submit);

    form.addEventListener('submit', async e => {
      e.preventDefault();
      submit.disabled = true;
      try {
        const fd = new FormData(form);
        const data = {
          label: String(fd.get('label') || '').trim(),
          type: fd.get('type'),
          placeholder: String(fd.get('placeholder') || ''),
          options: String(fd.get('options') || '').split('\n').map(s => s.trim()).filter(Boolean),
          required: !!fd.get('required'),
          enabled: !!fd.get('enabled'),
          order: Number(fd.get('order')) || 0,
          appliesTo: fd.get('appliesTo')
        };
        if (id) await db.collection('customForms').doc(id).update(data);
        else await db.collection('customForms').add(data);
        toast('Field saved.', 'success');
        closeDrawer();
        load();
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { submit.disabled = false; }
    });

    openDrawer(form);
  };

  $('#field-new').addEventListener('click', () => editOrCreate(null).catch(e => toast(friendlyError(e), 'error')));
  $('#form-scope').addEventListener('change', render);

  return { load };
})();

// ==== SECTION: ANALYTICS (FIXED — with client-side rollup fallback) ====
const Analytics = (() => {
  let charts = [];
  const PAID = ['paid', 'processing', 'completed', 'delivered'];

  const destroyAll = () => { charts.forEach(c => { try { c.destroy(); } catch {} }); charts = []; };

  // FIX: analyticsDaily is Cloud-Function-only. On the free plan / fresh install
  // it's ALWAYS empty — the analytics page showed blank. Now we compute a live
  // 30-day rollup from the orders + users collections client-side.
  const computeFromLive = async () => {
    const day = 24 * 3600 * 1000;
    const now = Date.now();
    const start = now - 30 * day;
    const [ordSnap, custSnap] = await Promise.all([
      db.collection('orders').orderBy('createdAt', 'desc').limit(2000).get().catch(() => ({ docs: [] })),
      db.collection('users').orderBy('createdAt', 'desc').limit(2000).get().catch(() => ({ docs: [] }))
    ]);
    const buckets = {};
    const key = t => {
      const d = new Date(t); d.setHours(0, 0, 0, 0);
      return d.toISOString().slice(0, 10);
    };
    // seed 30 empty days
    for (let i = 29; i >= 0; i--) buckets[key(now - i * day)] = { revenue: 0, orders: 0, newCustomers: 0 };

    ordSnap.docs.forEach(d => {
      const o = d.data();
      const t = o.createdAt?.toDate?.().getTime();
      if (!t || t < start) return;
      const k = key(t);
      if (!buckets[k]) return;
      buckets[k].orders += 1;
      if (PAID.includes(o.status)) buckets[k].revenue += (o.amount || 0);
    });
    custSnap.docs.forEach(d => {
      const u = d.data();
      const t = u.createdAt?.toDate?.().getTime();
      if (!t || t < start) return;
      const k = key(t);
      if (buckets[k]) buckets[k].newCustomers += 1;
    });
    return Object.entries(buckets).map(([id, v]) => ({ id, ...v }));
  };

  const load = async () => {
    destroyAll();
    let rows = [];
    try {
      const snap = await db.collection('analyticsDaily').orderBy(firebase.firestore.FieldPath.documentId(), 'desc').limit(30).get();
      rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    } catch (e) {
      console.warn('analyticsDaily unreachable, computing live rollup:', e);
    }
    if (!rows.length) {
      try { rows = await computeFromLive(); }
      catch (e) {
        console.error('Live analytics rollup failed:', e);
        const view = $('#v-analytics');
        if (view) showViewError(view, e, () => Analytics.load());
        return;
      }
    }
    if (!rows.length) {
      const view = $('#v-analytics');
      if (view) {
        view.querySelector('.empty-analytics')?.remove();
        view.prepend(el('div', { class: 'empty-analytics chart-card', style: 'text-align:center;padding:32px' },
          el('h3', {}, 'No analytics data yet'),
          el('p', { class: 'muted' }, 'Orders and customers will start populating this view automatically.')));
      }
      return;
    }
    const labels = rows.map(r => r.id.slice(5));
    const revenue = rows.map(r => r.revenue || 0);
    const orders = rows.map(r => r.orders || 0);
    const customers = rows.map(r => r.newCustomers || 0);
    if (typeof Chart === 'undefined') {
      toast('Chart library not loaded — refresh the page.', 'error');
      return;
    }
    charts.push(new Chart($('#a-rev'), { type: 'line', data: { labels, datasets: [{ label: 'Revenue ₹', data: revenue, borderColor: '#8B5CF6', backgroundColor: 'rgba(139,92,246,.2)', fill: true, tension: .35 }] }, options: chartOpts() }));
    charts.push(new Chart($('#a-cust'), { type: 'bar', data: { labels, datasets: [{ label: 'New customers', data: customers, backgroundColor: '#2F5CFF' }] }, options: chartOpts() }));
    charts.push(new Chart($('#a-ord'), { type: 'bar', data: { labels, datasets: [{ label: 'Orders', data: orders, backgroundColor: '#38BDF8' }] }, options: chartOpts() }));
  };
  return { load };
})();

// ==== SECTION: SETTINGS (with NEW payment gateway config) ====
const Settings = (() => {
  const load = async () => {
    await loadSettings();
    const s = S.settings || {};
    const fill = (form, obj) => Object.entries(obj || {}).forEach(([k, v]) => { const n = form.elements[k]; if (n) { if (n.type === 'checkbox') n.checked = !!v; else n.value = v || ''; } });
    fill($('#s-brand'), { brandName: s.brandName, logoUrl: s.logoUrl, accentColor: /^#[0-9a-fA-F]{6}$/.test(s.accentColor || '') ? s.accentColor : '#8B5CF6' });
    fill($('#s-contact'), s.contact || {});
    fill($('#s-social'), s.socialLinks || {});
    $('#s-terms').elements.terms.value = s.legal?.terms || '';
    $('#s-privacy').elements.privacy.value = s.legal?.privacy || '';
    $('#s-about').elements.about.value = s.legal?.about || '';

    // Payment settings
    const pay = s.payment || {};
    const mode = pay.mode || 'manual_upi';
    const payForm = $('#s-payment');
    if (payForm) {
      const radios = payForm.querySelectorAll('input[name="paymentMode"]');
      radios.forEach(r => { r.checked = (r.value === mode); });
      payForm.elements.upiId.value = pay.upiId || '';
      payForm.elements.upiPayeeName.value = pay.upiPayeeName || (s.brandName || '');
      payForm.elements.upiPhone.value = pay.upiPhone || '';
      payForm.elements.upiInstructions.value = pay.upiInstructions || '';
      payForm.elements.upiAutoOrderNote.checked = pay.upiAutoOrderNote !== false;
      payForm.elements.upiRequireScreenshot.checked = !!pay.upiRequireScreenshot;
      payForm.elements.razorpayKeyId.value = pay.razorpayKeyId || '';
      payForm.elements.razorpayLiveMode.checked = !!pay.razorpayLiveMode;
      payForm.elements.razorpayTheme.value = pay.razorpayTheme || '#2F5CFF';
      applyPaymentModeUI(mode);
      refreshUpiPreview();
    }

    // Media & file upload settings (Cloudinary unsigned preset — free tier)
    const upForm = $('#s-uploads');
    if (upForm) {
      const up = s.uploads || {};
      upForm.elements.cloudName.value = up.cloudName || '';
      upForm.elements.uploadPreset.value = up.uploadPreset || '';
    }
    loadAdmins();
  };

  const applyPaymentModeUI = mode => {
    const card = $('#payment-settings');
    if (!card) return;
    card.classList.toggle('mode-manual', mode === 'manual_upi');
    card.classList.toggle('mode-razorpay', mode === 'razorpay');
    const manual = $('#pg-block-manual');
    const rzp = $('#pg-block-razorpay');
    if (manual) manual.classList.toggle('active', mode === 'manual_upi');
    if (rzp) rzp.classList.toggle('active', mode === 'razorpay');
    $$('.pg-mode-option').forEach(opt => {
      const r = opt.querySelector('input[type=radio]');
      opt.classList.toggle('selected', r && r.checked);
    });
  };

  const setQrDiag = (msg, isErr) => {
    const d = $('#upi-preview-qr-diag');
    if (!d) return;
    d.textContent = msg || '';
    d.className = 'qr-diag' + (isErr ? ' err' : ' ok');
    d.style.display = msg ? 'block' : 'none';
  };

  const refreshUpiPreview = () => {
    const form = $('#s-payment');
    if (!form) return;
    const vpa = (form.elements.upiId.value || '').trim();
    const name = (form.elements.upiPayeeName.value || '').trim();
    const previewVpa = $('#upi-preview-vpa');
    const previewName = $('#upi-preview-name');
    if (previewVpa) previewVpa.textContent = vpa || '—';
    if (previewName) previewName.textContent = name || '—';
    // Auto-generated QR preview from the UPI ID — matches what the customer sees.
    const canvas = $('#upi-preview-qr');
    if (!canvas) return;
    if (!vpa) { canvas.style.display = 'none'; setQrDiag('Enter a UPI ID to generate the QR.', false); return; }
    if (!window.QRCode || typeof window.QRCode.toCanvas !== 'function') {
      canvas.style.display = 'none';
      setQrDiag('QR library failed to load. Check your internet connection and hard-refresh (Ctrl+Shift+R).', true);
      return;
    }
    const upiUrl = `upi://pay?pa=${encodeURIComponent(vpa)}&pn=${encodeURIComponent(name || 'Merchant')}&cu=INR`;
    try {
      window.QRCode.toCanvas(canvas, upiUrl, { width: 132, margin: 1, color: { dark: '#0A0E1A', light: '#FFFFFF' } }, err => {
        if (err) {
          canvas.style.display = 'none';
          setQrDiag('QR generation error: ' + (err.message || String(err)), true);
        } else {
          canvas.style.display = '';
          setQrDiag('✓ QR live — this is exactly what customers scan.', false);
        }
      });
    } catch (e) {
      canvas.style.display = 'none';
      setQrDiag('QR generation crashed: ' + (e.message || String(e)), true);
    }
  };

  const save = async patch => {
    await db.collection('settings').doc('site').set(patch, { merge: true });
    toast('Settings saved.', 'success');
    await loadSettings();
  };

  const bindForm = (sel, transform) => {
    $(sel).addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const fd = new FormData(e.target);
        await save(transform(fd));
      } catch (err) { toast(friendlyError(err), 'error'); }
      finally { if (btn) btn.disabled = false; }
    });
  };

  bindForm('#s-brand', fd => {
    const logoUrl = String(fd.get('logoUrl') || '').trim();
    if (logoUrl && !safeUrl(logoUrl)) throw new Error('Logo URL invalid.');
    return { brandName: String(fd.get('brandName') || 'Folium').slice(0, 60), logoUrl, accentColor: fd.get('accentColor') || '#8B5CF6' };
  });
  bindForm('#s-contact', fd => ({ contact: { email: String(fd.get('email') || ''), phone: String(fd.get('phone') || ''), address: String(fd.get('address') || '') } }));
  bindForm('#s-social', fd => {
    const out = {};
    ['twitter', 'github', 'linkedin'].forEach(k => { const v = String(fd.get(k) || '').trim(); if (v && !safeUrl(v)) throw new Error(`${k} URL invalid.`); out[k] = v; });
    return { socialLinks: out };
  });
  bindForm('#s-terms', fd => ({ legal: { ...(S.settings?.legal || {}), terms: String(fd.get('terms') || '') } }));
  bindForm('#s-privacy', fd => ({ legal: { ...(S.settings?.legal || {}), privacy: String(fd.get('privacy') || '') } }));
  bindForm('#s-about', fd => ({ legal: { ...(S.settings?.legal || {}), about: String(fd.get('about') || '') } }));

  // Uploads — Cloudinary unsigned preset (free tier). Validation is soft:
  // both fields may be left blank to run purely on the free fallbacks.
  const uploadsForm = $('#s-uploads');
  if (uploadsForm) {
    uploadsForm.addEventListener('submit', async e => {
      e.preventDefault();
      const status = $('#s-uploads-status');
      const btn = uploadsForm.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        const fd = new FormData(uploadsForm);
        const cloudName = String(fd.get('cloudName') || '').trim();
        const uploadPreset = String(fd.get('uploadPreset') || '').trim();
        if (cloudName && !/^[a-z0-9][a-z0-9_-]{1,60}$/i.test(cloudName)) throw new Error('Cloud name looks invalid (letters, numbers, dashes only).');
        if ((cloudName && !uploadPreset) || (!cloudName && uploadPreset)) throw new Error('Fill BOTH Cloudinary fields, or leave both empty to use the free fallbacks.');
        await save({ uploads: { cloudName, uploadPreset } });
        if (status) {
          status.className = 'form-note ok';
          status.textContent = cloudName
            ? '✅ Cloudinary connected — images & videos upload to your CDN.'
            : '✅ Saved — using automatic free fallbacks (Base64 + Catbox).';
        }
      } catch (err) {
        if (status) { status.className = 'form-note err'; status.textContent = err.message || friendlyError(err); }
        else toast(err.message || friendlyError(err), 'error');
      } finally { if (btn) btn.disabled = false; }
    });
  }

  // NEW: Payment settings form
  const payForm = $('#s-payment');
  if (payForm) {
    payForm.querySelectorAll('input[name="paymentMode"]').forEach(r => {
      r.addEventListener('change', () => applyPaymentModeUI(r.value));
    });
    ['upiId', 'upiPayeeName'].forEach(k => {
      payForm.elements[k]?.addEventListener('input', refreshUpiPreview);
    });
    // Manual "Test QR" — forces a fresh render and shows the diagnostic.
    const testQrBtn = $('#upi-test-qr');
    if (testQrBtn) {
      testQrBtn.addEventListener('click', () => {
        const canvas = $('#upi-preview-qr');
        if (canvas && canvas.getContext) { try { canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height); } catch (e) {} }
        refreshUpiPreview();
        toast('QR re-rendered — check the preview and the diagnostic line below it.', 'info');
      });
    }

    payForm.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      const status = $('#s-payment-status');
      if (status) { status.className = 'form-note'; status.textContent = 'Saving…'; }
      btn.disabled = true;
      try {
        const fd = new FormData(payForm);
        const mode = fd.get('paymentMode') || 'manual_upi';
        const upiId = String(fd.get('upiId') || '').trim();
        const upiPayeeName = String(fd.get('upiPayeeName') || '').trim();
        const razorpayKeyId = String(fd.get('razorpayKeyId') || '').trim();

        if (mode === 'manual_upi') {
          if (!upiId || !/^[a-zA-Z0-9._-]+@[a-zA-Z0-9]+$/.test(upiId)) throw new Error('Enter a valid UPI ID (e.g. name@okhdfcbank).');
          if (!upiPayeeName) throw new Error('Enter the merchant / payee name.');
        }
        if (mode === 'razorpay') {
          if (!razorpayKeyId || !/^rzp_(live|test)_[A-Za-z0-9]+$/.test(razorpayKeyId)) throw new Error('Enter a valid Razorpay Key ID.');
        }

        const payment = {
          mode,
          upiId,
          upiPayeeName,
          upiPhone: String(fd.get('upiPhone') || '').trim(),
          upiQrUrl: '', // QR is auto-generated client-side from the UPI ID
          upiInstructions: String(fd.get('upiInstructions') || '').slice(0, 800),
          upiAutoOrderNote: !!fd.get('upiAutoOrderNote'),
          upiRequireScreenshot: !!fd.get('upiRequireScreenshot'),
          razorpayKeyId,
          razorpayLiveMode: !!fd.get('razorpayLiveMode'),
          razorpayTheme: fd.get('razorpayTheme') || '#2F5CFF',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: S.user?.uid || null
        };
        await save({ payment });
        if (status) { status.className = 'form-note ok'; status.textContent = `✅ Payment mode set to ${mode === 'manual_upi' ? 'Manual UPI' : 'Razorpay'}. Live on storefront.`; }
        toast('Payment settings saved.', 'success');
      } catch (err) {
        console.error('Payment save failed:', err);
        if (status) { status.className = 'form-note err'; status.textContent = err.message || 'Save failed.'; }
        toast(err.message || 'Save failed.', 'error');
      } finally { btn.disabled = false; }
    });
  }

  const loadAdmins = async () => {
    try {
      const snap = await db.collection('admins').get();
      const list = $('#admins-list');
      list.innerHTML = '';
      if (!snap.docs.length) { list.appendChild(el('li', {}, 'No admin documents.')); return; }
      snap.docs.forEach(d => {
        const li = el('li', {}, d.id.slice(0, 12) + '…',
          el('button', { type: 'button', onclick: async () => {
              if (d.id === S.user.uid) return toast('Cannot remove yourself.', 'error');
              if (!await confirmDialog('Remove this admin?')) return;
              try { await db.collection('admins').doc(d.id).delete(); loadAdmins(); }
              catch (e) { toast(friendlyError(e), 'error'); }
            } }, '✕'));
        list.appendChild(li);
      });
    } catch (e) { toast(friendlyError(e), 'error'); }
  };

  $('#s-admins').addEventListener('submit', async e => {
    e.preventDefault();
    const uid = String(new FormData(e.target).get('uid') || '').trim();
    if (!uid) return toast('Enter a UID.', 'error');
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await db.collection('admins').doc(uid).set({ addedBy: S.user.uid, addedAt: firebase.firestore.FieldValue.serverTimestamp() });
      toast('Admin added.', 'success');
      e.target.reset();
      loadAdmins();
    } catch (err) { toast(friendlyError(err), 'error'); }
    finally { btn.disabled = false; }
  });

  return { load };
})();

/* ---- one-shot loose-button type stamping (outside <form> only) ---- */
(function stampLooseButtons(){
  try {
    document.querySelectorAll('button:not([type])').forEach(b => {
      if (b.closest('form')) return;
      b.setAttribute('type', 'button');
    });
  } catch (_) {}
})();
