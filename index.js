/* ============================================================
   FOLIUM / DUDE — Cloud Functions (Cashfree Payments v3)
   ------------------------------------------------------------
   This is the MISSING SERVER HALF of the Cashfree integration.
   The storefront (script.js) calls:
     - createOrder    → creates a Cashfree order, returns payment_session_id
     - verifyPayment  → fetches order status from Cashfree, marks order paid
     - cashfreeWebhook→ (optional) Cashfree → server payment confirmation

   Credentials are read from environment first:
     firebase functions:config:set cashfree.app_id="..." cashfree.secret_key="..." cashfree.env="sandbox"
   Fallback: Firestore settings/site → payment.{cashfreeAppId,cashfreeSecretKey,cashfreeEnv}
   (admin.js already saves them there).
   ============================================================ */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

try { admin.initializeApp(); } catch (e) { /* already initialised */ }
const db = admin.firestore();

const CF_BASE = {
  sandbox: 'https://sandbox.cashfree.com/pg',
  production: 'https://api.cashfree.com/pg'
};
const CF_API_VERSION = '2023-08-01';

/* ---------- helpers ---------- */

async function getCashfreeCreds() {
  let appId = '', secret = '', env = 'sandbox';
  try {
    const cfg = functions.config().cashfree || {};
    appId = cfg.app_id || '';
    secret = cfg.secret_key || '';
    env = cfg.env || 'sandbox';
  } catch (e) { /* runtime config not set — fall back to Firestore */ }

  if (!appId || !secret) {
    // Preferred: admin-only doc written by admin.js
    try {
      const priv = await db.collection('settingsPrivate').doc('payment').get();
      if (priv.exists) {
        const p = priv.data() || {};
        appId = appId || p.cashfreeAppId || '';
        secret = secret || p.cashfreeSecretKey || '';
        if (p.cashfreeEnv) env = p.cashfreeEnv;
      }
    } catch (e) { console.warn('settingsPrivate read failed:', e.message); }
  }
  if (!appId || !secret) {
    // Legacy fallback: older admin builds stored keys in settings/site.payment
    const snap = await db.collection('settings').doc('site').get();
    const pay = (snap.exists && snap.data().payment) || {};
    appId = appId || pay.cashfreeAppId || '';
    secret = secret || pay.cashfreeSecretKey || '';
    env = cfg_env_safe(env, pay);
  }
  if (!appId || !secret) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Cashfree credentials not configured. Set them in Admin → Settings → Payments (or via firebase functions:config:set cashfree.app_id / cashfree.secret_key).'
    );
  }
  env = env === 'production' ? 'production' : 'sandbox';
  return { appId, secret, env };
}

function cfg_env_safe(current, pay) {
  if (current && (current === 'sandbox' || current === 'production')) return current;
  return pay.cashfreeEnv || (pay.cashfreeLiveMode ? 'production' : 'sandbox');
}

async function cfRequest(creds, method, path, body) {
  const url = `${CF_BASE[creds.env]}${path}`;
  const resp = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': creds.appId,
      'x-client-secret': creds.secret,
      'x-api-version': CF_API_VERSION
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.error('Cashfree API error', resp.status, data);
    throw new functions.https.HttpsError(
      'internal',
      `Cashfree ${method} ${path} failed (${resp.status}): ${data.message || JSON.stringify(data)}`
    );
  }
  return data;
}

/* CORS — reflect origin, handle preflight */
const ALLOWED_ORIGINS = null; // null = reflect any origin (tighten later, e.g. ['https://yourapp.web.app'])
function setCors(req, res) {
  const origin = req.headers.origin || '*';
  const allowed = !ALLOWED_ORIGINS || ALLOWED_ORIGINS.includes(origin);
  res.set('Access-Control-Allow-Origin', allowed ? origin : 'null');
  res.set('Vary', 'Origin');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Max-Age', '3600');
  return allowed;
}

function isAuthed(context) {
  return !!(context && context.auth && context.auth.uid);
}

/* ---------- callable: createOrder ----------
   data: { orderId, templateId, gateway: 'cashfree' }
   returns: { cashfree_order_id, payment_session_id, order_amount, order_currency, mode }
*/
exports.createOrder = functions.https.onCall(async (data, context) => {
  if (!isAuthed(context)) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to start a payment.');
  }
  const orderId = String(data.orderId || '').trim();
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');

  // Load the storefront order and verify ownership
  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.');
  const order = orderSnap.data();
  if (order.userId && order.userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'This order does not belong to you.');
  }

  // Determine amount from the template (server-side — never trust the client)
  const templateId = order.templateId || data.templateId;
  if (!templateId) throw new functions.https.HttpsError('invalid-argument', 'templateId missing.');
  const tplSnap = await db.collection('templates').doc(String(templateId)).get();
  if (!tplSnap.exists || tplSnap.data().isActive === false) {
    throw new functions.https.HttpsError('failed-precondition', 'Template unavailable.');
  }
  const tpl = tplSnap.data();
  const amount = Number(
    tpl.discountPrice && tpl.discountPrice < tpl.price ? tpl.discountPrice : tpl.price
  );
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Invalid template price — set a price in the admin panel.');
  }

  const creds = await getCashfreeCreds();

  // Reuse an existing open Cashfree order for idempotency
  if (order.cashfreeOrderId && order.cashfreePaymentSessionId && order.status !== 'paid') {
    try {
      const existing = await cfRequest(creds, 'GET', `/orders/${order.cashfreeOrderId}`);
      if (existing && existing.order_status === 'ACTIVE' && existing.payment_session_id) {
        return {
          cashfree_order_id: existing.order_id,
          payment_session_id: existing.payment_session_id,
          order_amount: existing.order_amount,
          order_currency: existing.order_currency || 'INR',
          mode: creds.env
        };
      }
    } catch (e) { console.warn('Existing Cashfree order not reusable:', e.message); }
  }

  const cfOrderId = `folium_${orderId}_${Date.now()}`.slice(0, 45);
  const customer = {
    customer_id: String(context.auth.uid).replace(/[^a-zA-Z0-9_-]/g, '_'),
    customer_name: (order.userEmail || 'Customer').split('@')[0].slice(0, 60) || 'Customer',
    customer_email: order.userEmail || context.auth.token.email || 'customer@example.com',
    customer_phone: '9999999999' // Cashfree requires a phone; storefront has none — override via order.customer if present
  };
  if (order.customer && order.customer.phone && /^[0-9]{10}$/.test(order.customer.phone)) {
    customer.customer_phone = order.customer.phone;
  }

  const payload = {
    order_id: cfOrderId,
    order_amount: amount,
    order_currency: 'INR',
    customer_details: customer,
    order_meta: {
      return_url: `https://${process.env.GCLOUD_PROJECT}.web.app/#/orders?cf_order_id={order_id}`
    },
    order_note: `Folium template order ${orderId}`
  };

  const created = await cfRequest(creds, 'POST', '/orders', payload);

  await orderRef.set({
    paymentMethod: 'cashfree',
    cashfreeOrderId: created.order_id,
    cashfreePaymentSessionId: created.payment_session_id,
    amount,
    currency: 'INR',
    status: 'payment_pending',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return {
    cashfree_order_id: created.order_id,
    payment_session_id: created.payment_session_id,
    order_amount: created.order_amount,
    order_currency: created.order_currency || 'INR',
    mode: creds.env
  };
});

/* ---------- callable: verifyPayment ----------
   data: { orderId, cashfree_order_id, gateway: 'cashfree' }
   Marks the Firestore order paid when Cashfree confirms it.
*/
exports.verifyPayment = functions.https.onCall(async (data, context) => {
  if (!isAuthed(context)) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to verify payment.');
  }
  const orderId = String(data.orderId || '').trim();
  const cfOrderId = String(data.cashfree_order_id || '').trim();
  if (!orderId || !cfOrderId) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId and cashfree_order_id are required.');
  }

  const orderRef = db.collection('orders').doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.');
  const order = orderSnap.data();
  if (order.userId && order.userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'This order does not belong to you.');
  }
  if (order.cashfreeOrderId && order.cashfreeOrderId !== cfOrderId) {
    throw new functions.https.HttpsError('failed-precondition', 'Order reference mismatch.');
  }

  const creds = await getCashfreeCreds();
  const cfOrder = await cfRequest(creds, 'GET', `/orders/${cfOrderId}`);

  if (cfOrder.order_status === 'PAID') {
    // Try to grab the payment id from the payments list (best-effort)
    let paymentId = null;
    try {
      const pays = await cfRequest(creds, 'GET', `/orders/${cfOrderId}/payments`);
      const list = (pays && (pays.payments || pays)) || [];
      const ok = list.find(p => p.payment_status === 'SUCCESS') || list[0];
      paymentId = ok && (ok.cf_payment_id || ok.payment_id) ? String(ok.cf_payment_id || ok.payment_id) : null;
    } catch (e) { /* non-fatal */ }

    await orderRef.set({
      status: 'paid',
      paymentMethod: 'cashfree',
      cashfreePaymentId: paymentId,
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return { ok: true, status: 'PAID', cashfree_payment_id: paymentId };
  }

  // Not paid — sync status for transparency
  const mapped = cfOrder.order_status === 'ACTIVE' ? 'payment_pending' : 'failed';
  await orderRef.set({ status: mapped, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  return { ok: false, status: cfOrder.order_status };
});

/* ---------- webhook: cashfreeWebhook (optional but recommended) ----------
   Add this URL in Cashfree Dashboard → Developers → Webhooks:
     https://<region>-<project>.cloudfunctions.net/cashfreeWebhook
   Verifies the signature and marks orders paid even if the customer closes
   the checkout modal before verifyPayment runs.
*/
exports.cashfreeWebhook = functions.https.onRequest(async (req, res) => {
  if (!setCors(req, res)) return res.status(403).send('Origin not allowed');
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  try {
    const creds = await getCashfreeCreds();
    const crypto = require('crypto');
    const signature = req.headers['x-webhook-signature'] || '';
    const timestamp = req.headers['x-webhook-timestamp'] || '';
    const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
    const expected = crypto
      .createHmac('sha256', creds.secret)
      .update(timestamp + rawBody)
      .digest('base64');
    if (!signature || signature !== expected) {
      console.warn('Webhook signature mismatch');
      return res.status(401).send('Invalid signature');
    }

    const event = req.body || {};
    const cfOrderId = event.data && event.data.order && event.data.order.order_id;
    const status = event.data && event.data.payment && event.data.payment.payment_status;
    if (!cfOrderId) return res.status(200).send('ignored');

    const snap = await db.collection('orders').where('cashfreeOrderId', '==', cfOrderId).limit(1).get();
    if (snap.empty) return res.status(200).send('no matching order');

    const ref = snap.docs[0].ref;
    if (status === 'SUCCESS') {
      const paymentId = event.data.payment.cf_payment_id ? String(event.data.payment.cf_payment_id) : null;
      await ref.set({
        status: 'paid',
        paymentMethod: 'cashfree',
        cashfreePaymentId: paymentId,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        paymentVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else if (['FAILED', 'USER_DROPPED', 'CANCELLED'].includes(status)) {
      await ref.set({ status: 'failed', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
    return res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error:', err);
    return res.status(500).send('error');
  }
});
