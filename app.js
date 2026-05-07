/* ====================================================================
   DarziMate — Tailoring Production Manager
   Phase 1+2+3: Auth, drill-downs, daily production tracking,
   piece-rate earnings, payments. Multi-role: admin / contractor / worker.

   Storage: localStorage cache (always) + Supabase (when configured).
   ==================================================================== */

(() => {
'use strict';

/* ─── Supabase client (optional) ──────────────────────────── */
const cfg = window.DARZIMATE_SUPABASE || { URL: '', KEY: '', SCHEMA: 'public', SOFTWARE_ADMIN_MOBILE: '' };
const SCHEMA = cfg.SCHEMA || 'public';
const SOFTWARE_ADMIN_MOBILE = (cfg.SOFTWARE_ADMIN_MOBILE || '').trim();
let sb = null;
const REMOTE_ENABLED = !!(cfg.URL && cfg.KEY && window.supabase && window.supabase.createClient);
if (REMOTE_ENABLED) {
  try {
    const opts = {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 5 } }
    };
    if (SCHEMA && SCHEMA !== 'public') opts.db = { schema: SCHEMA };
    sb = window.supabase.createClient(cfg.URL, cfg.KEY, opts);
  } catch (e) { console.warn('Supabase init failed', e); }
}

/* ─── Tiny utilities ──────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const uid = (prefix = 'id') => prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0,10); };
const fmtDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtRelDate = (s) => {
  if (!s) return '—';
  const d = new Date(s);
  const t = new Date();
  const diff = Math.floor((t - d) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return diff + ' days ago';
  return fmtDate(s);
};

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

async function hashPassword(pw) {
  const enc = new TextEncoder().encode('karkhana-v1::' + pw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ─── Theme + photo helpers ──────────────────────────────── */
const THEMES = [
  { key: 'default',  label: 'Light · indigo', preview: '#3730A3' },
  { key: 'midnight', label: 'Midnight (dark)', preview: '#0F172A' },
  { key: 'forest',   label: 'Forest',          preview: '#059669' },
  { key: 'cream',    label: 'Cream',           preview: '#92400E' }
];

function applyTheme(name) {
  const valid = THEMES.find(t => t.key === name);
  const k = valid ? valid.key : 'default';
  document.body.className = k === 'default' ? '' : 'theme-' + k;
  try { localStorage.setItem('darzimate-theme', k); } catch {}
}

function getTheme() {
  try { return localStorage.getItem('darzimate-theme') || 'default'; }
  catch { return 'default'; }
}

// Resize an image File down to maxSize px (longest edge), JPEG-encode, return base64.
function resizeImage(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else       { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/* ─── Toast & Modal ───────────────────────────────────────── */
function toast(msg, type = '') {
  const host = $('#toastHost');
  if (!host) return;
  const t = el('div', { class: 'toast ' + type }, msg);
  host.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.2s'; }, 2400);
  setTimeout(() => t.remove(), 2700);
}

function openModal(content) {
  const modal = $('#modal');
  const body = $('#modalBody');
  body.innerHTML = '';
  body.appendChild(typeof content === 'string' ? el('div', { html: content }) : content);
  modal.hidden = false;
  // Autofocus first input
  setTimeout(() => {
    const first = body.querySelector('input,select,textarea,button.btn');
    if (first && first.tagName !== 'BUTTON') first.focus();
  }, 50);
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) closeModal();
});

/* ─── Store ───────────────────────────────────────────────── */
const Store = {
  KEY: 'darzimate-v1',
  data: null,
  remoteReady: false,

  loadFromCache() {
    try { this.data = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { this.data = null; }
    if (!this.data) this.data = seed();
    this.migrate();
  },
  migrate() {
    // Ensure all collections exist on older caches
    const d = this.data;
    ['users','designs','piece_types','orders','lots','worker_assignments',
     'production_entries','payments','notifications','holidays',
     'admin_contractors'].forEach(k => { if (!d[k]) d[k] = []; });
    // v2 migration: contractors used to have parent_user_id pointing at one admin.
    // Promote those into the admin_contractors junction so it's many-to-many.
    if (d.admin_contractors.length === 0) {
      d.users.filter(u => u.role === 'contractor' && u.parent_user_id).forEach(c => {
        const admin = d.users.find(x => x.id === c.parent_user_id);
        if (!admin || admin.role !== 'admin') return;
        d.admin_contractors.push({
          id: 'ac_' + c.id + '_' + admin.id,
          admin_id: admin.id, contractor_id: c.id,
          status: 'active', since: today(), notes: null,
          created_at: new Date().toISOString()
        });
      });
    }
  },
  saveCache() { try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch {} },

  // Pull every accessible table from Supabase. RLS does the per-role filtering.
  async loadFromRemote() {
    if (!sb) return false;
    try {
      const { data: sess } = await sb.auth.getSession();
      if (!sess?.session) return false;

      const results = await Promise.all(TABLES.map(t => sb.from(t).select('*')));
      const data = this.data || seed();
      TABLES.forEach((t, i) => {
        const r = results[i];
        if (r.error) { console.warn('load ' + t + ':', r.error.message); return; }
        data[t] = r.data || [];
      });

      // Find own user row → set session + active shop.
      const me = data.users.find(u => u.id === sess.session.user.id);
      if (me) {
        const shopId = me.shop_id || (data.shops[0] && data.shops[0].id) || null;
        data.shop = data.shops.find(s => s.id === shopId) || data.shops[0] || seed().shop;
        data.session = { userId: me.id, role: me.role, shopId };
      } else {
        // Authenticated but no profile row yet — first run mid-signup or lost row.
        data.session = null;
      }

      this.data = data;
      this.saveCache();
      this.remoteReady = true;
      return true;
    } catch (e) { console.warn('Remote load failed', e); return false; }
  },

  async load() {
    this.loadFromCache();
    if (REMOTE_ENABLED) await this.loadFromRemote();
  },

  // Brute-force sync: upsert every row in every table back to Supabase.
  // RLS enforces per-row authorization; conflicts resolve on primary-key id.
  // For karkhana scale (low hundreds of rows total) this is plenty fast.
  async upsertAll() {
    if (!sb || !this.data || !this.data.session) return;
    for (const t of TABLES) {
      const rows = this.data[t] || [];
      if (rows.length === 0) continue;
      try {
        const { error } = await sb.from(t).upsert(rows, { onConflict: 'id' });
        if (error) console.warn('sync ' + t + ':', error.message);
      } catch (e) { console.warn('sync ' + t + ':', e.message); }
    }
  },

  save() {
    this.saveCache();
    if (this._syncTimer) clearTimeout(this._syncTimer);
    if (REMOTE_ENABLED) {
      this._syncTimer = setTimeout(() => this.upsertAll(), 350);
    }
  },

  // Realtime: re-pull a changed table when any row event fires.
  subscribeRealtime() {
    if (!sb || !this.data || !this.data.session) return;
    if (this._channel) return; // already subscribed
    this._channel = sb.channel('karkhana');
    TABLES.forEach(t => {
      this._channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, async () => {
        try {
          const { data, error } = await sb.from(t).select('*');
          if (!error && data) {
            this.data[t] = data;
            // Re-bind App.user to the fresh row from this update so that
            // status flips (pending → rejected/active) propagate to the UI
            // instead of pinning the rendered screen to the stale object.
            if (t === 'users' && App && App.user) {
              const fresh = data.find(u => u.id === App.user.id);
              if (fresh) App.user = fresh;
            }
            this.saveCache();
            try { render(); } catch {}
          }
        } catch {}
      });
    });
    this._channel.subscribe();
  },

  unsubscribeRealtime() {
    if (this._channel) { try { sb.removeChannel(this._channel); } catch {} this._channel = null; }
  }
};

/* ─── Empty bootstrap state ───────────────────────────────── */
function seed() {
  return {
    session: null,
    shop: { id: '', name: '', owner_user_id: '' },
    shops: [],
    users: [],
    admin_contractors: [],
    designs: [],
    piece_types: [],
    orders: [],
    lots: [],
    worker_assignments: [],
    production_entries: [],
    payments: [],
    notifications: [],
    holidays: []
  };
}

const TABLES = ['shops','users','admin_contractors','designs','piece_types',
  'orders','lots','worker_assignments','production_entries','payments',
  'notifications','holidays'];

/* ─── Domain ──────────────────────────────────────────────── */
const Domain = {
  /* Designs / piece types */
  designs() { return Store.data.designs; },
  designById(id) { return this.designs().find(d => d.id === id); },
  pieceTypesForDesign(designId) {
    return Store.data.piece_types.filter(p => p.design_id === designId)
      .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  },
  pieceTypeById(id) { return Store.data.piece_types.find(p => p.id === id); },
  addDesign({ name, sku, default_rate, piece_types }) {
    const d = {
      id: uid('d'), shop_id: Store.data.shop.id,
      name: name.trim(), sku: (sku || '').trim() || null, photo: null,
      default_rate: Number(default_rate) || 0, active: true,
      created_at: new Date().toISOString()
    };
    Store.data.designs.push(d);
    (piece_types || []).forEach((pt, i) => {
      if (!pt.name || !pt.name.trim()) return;
      Store.data.piece_types.push({
        id: uid('pt'), shop_id: d.shop_id, design_id: d.id,
        name: pt.name.trim(), default_rate: Number(pt.rate) || 0, sort_order: i + 1
      });
    });
    Store.save();
    return d;
  },

  /* Orders / lots */
  orders() { return Store.data.orders; },
  orderById(id) { return this.orders().find(o => o.id === id); },
  lotsForOrder(orderId) {
    return Store.data.lots.filter(l => l.order_id === orderId)
      .sort((a, b) => a.lot_no - b.lot_no);
  },
  lotById(id) { return Store.data.lots.find(l => l.id === id); },
  addOrder({ design_id, total_qty, deadline, notes }) {
    const o = {
      id: uid('o'), shop_id: Store.data.shop.id,
      design_id, total_qty: Number(total_qty),
      deadline: deadline || null, notes: (notes || '').trim() || null,
      status: 'open', created_by: App.user?.id || null,
      created_at: new Date().toISOString()
    };
    Store.data.orders.push(o);
    Store.save();
    return o;
  },
  splitOrderIntoLots(orderId, lotCount, qtyPerLot) {
    const order = this.orderById(orderId);
    if (!order) return;
    const startNo = this.lotsForOrder(orderId).length + 1;
    for (let i = 0; i < lotCount; i++) {
      Store.data.lots.push({
        id: uid('l'), shop_id: order.shop_id, order_id: orderId,
        lot_no: startNo + i, qty: Number(qtyPerLot),
        contractor_id: null, status: 'unassigned', assigned_at: null,
        created_at: new Date().toISOString()
      });
    }
    Store.save();
  },
  assignLotToContractor(lotId, contractorId) {
    const l = this.lotById(lotId);
    if (!l) return;
    l.contractor_id = contractorId;
    l.status = 'assigned';
    l.assigned_at = new Date().toISOString();
    Store.save();
  },

  /* Worker assignments */
  assignmentsForLot(lotId) {
    return Store.data.worker_assignments.filter(a => a.lot_id === lotId);
  },
  assignmentsForWorker(workerId) {
    return Store.data.worker_assignments.filter(a => a.worker_id === workerId);
  },
  assignmentsForContractor(contractorId) {
    return Store.data.worker_assignments.filter(a => a.contractor_id === contractorId);
  },
  assignmentById(id) { return Store.data.worker_assignments.find(a => a.id === id); },
  addAssignment({ lot_id, worker_id, contractor_id, piece_type_id, qty_assigned, rate }) {
    const lot = this.lotById(lot_id);
    if (!lot) return null;
    const a = {
      id: uid('a'), shop_id: lot.shop_id,
      lot_id, worker_id, contractor_id, piece_type_id,
      qty_assigned: Number(qty_assigned), rate: Number(rate),
      status: 'open', assigned_at: new Date().toISOString()
    };
    Store.data.worker_assignments.push(a);
    Store.save();
    return a;
  },

  /* Production */
  entriesForAssignment(assignmentId) {
    return Store.data.production_entries.filter(e => e.assignment_id === assignmentId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  entriesForWorker(workerId, fromDate, toDate) {
    return Store.data.production_entries.filter(e =>
      e.worker_id === workerId &&
      (!fromDate || e.date >= fromDate) &&
      (!toDate || e.date <= toDate)
    );
  },
  entriesForContractor(contractorId, fromDate, toDate) {
    return Store.data.production_entries.filter(e =>
      e.contractor_id === contractorId &&
      (!fromDate || e.date >= fromDate) &&
      (!toDate || e.date <= toDate)
    );
  },
  addProductionEntry({ assignment_id, pieces_done, date, notes }) {
    const a = this.assignmentById(assignment_id);
    if (!a) throw new Error('Assignment not found');
    const e = {
      id: uid('pe'), shop_id: a.shop_id,
      assignment_id, worker_id: a.worker_id, contractor_id: a.contractor_id,
      date: date || today(), pieces_done: Number(pieces_done),
      notes: (notes || '').trim() || null, photo: null,
      created_at: new Date().toISOString()
    };
    Store.data.production_entries.push(e);

    // Auto-bump statuses
    const done = this.assignmentPiecesDone(assignment_id);
    if (done >= a.qty_assigned) a.status = 'completed';
    else if (a.status === 'open') a.status = 'in_progress';

    const lot = this.lotById(a.lot_id);
    if (lot && lot.status === 'assigned') lot.status = 'in_progress';

    // If all assignments for the lot are completed → mark lot completed
    if (lot) {
      const allAssigns = this.assignmentsForLot(lot.id);
      if (allAssigns.length > 0 && allAssigns.every(x => x.status === 'completed')) {
        lot.status = 'completed';
      }
    }

    // Order: in_progress when any production exists
    const order = this.orderById(lot.order_id);
    if (order && order.status === 'open') order.status = 'in_progress';
    if (order) {
      const allLots = this.lotsForOrder(order.id);
      if (allLots.length > 0 && allLots.every(x => x.status === 'completed')) {
        order.status = 'completed';
      }
    }

    Store.save();
    return e;
  },
  assignmentPiecesDone(assignmentId) {
    return this.entriesForAssignment(assignmentId)
      .reduce((s, e) => s + (Number(e.pieces_done) || 0), 0);
  },
  assignmentEarned(assignmentId) {
    const a = this.assignmentById(assignmentId);
    if (!a) return 0;
    return this.assignmentPiecesDone(assignmentId) * Number(a.rate);
  },
  lotProgress(lotId) {
    const assigns = this.assignmentsForLot(lotId);
    const total = assigns.reduce((s, a) => s + Number(a.qty_assigned), 0);
    const done = assigns.reduce((s, a) => s + this.assignmentPiecesDone(a.id), 0);
    return { done, total, percent: total > 0 ? Math.round(done * 100 / total) : 0 };
  },
  orderProgress(orderId) {
    const order = this.orderById(orderId);
    if (!order) return { done: 0, total: 0, percent: 0 };
    const lots = this.lotsForOrder(orderId);
    const totalLotQty = lots.reduce((s, l) => s + l.qty, 0);
    const totalDoneFraction = lots.reduce((s, l) => s + (this.lotProgress(l.id).percent / 100) * l.qty, 0);
    return {
      done: Math.round(totalDoneFraction),
      total: order.total_qty,
      assigned: totalLotQty,
      percent: order.total_qty > 0 ? Math.round(totalDoneFraction * 100 / order.total_qty) : 0
    };
  },

  /* Users */
  userById(id) { return Store.data.users.find(u => u.id === id); },
  admins() { return Store.data.users.filter(u => u.role === 'admin'); },
  approvedAdmins() { return Store.data.users.filter(u => u.role === 'admin' && u.status === 'active'); },
  pendingAdmins() { return Store.data.users.filter(u => u.role === 'admin' && u.status === 'pending'); },
  rejectedAdmins() { return Store.data.users.filter(u => u.role === 'admin' && u.status === 'rejected'); },
  isSoftwareAdmin(u) { return (u || App.user)?.role === 'software_admin'; },
  isPending(u) {
    const usr = u || App.user;
    return usr?.role === 'admin' && usr?.status === 'pending';
  },
  async approveAdmin(adminId) {
    if (sb) {
      // .select() so we can detect RLS blocking the write (returns 0 rows
      // without erroring) — otherwise the optimistic local update gets
      // clobbered by the next realtime fetch and the user re-appears in
      // the pending list.
      const { data, error } = await sb.from('users')
        .update({ status: 'active' }).eq('id', adminId).select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("Couldn't approve — your account isn't allowed to update this user.");
      }
      const fresh = data[0];
      const i = Store.data.users.findIndex(u => u.id === adminId);
      if (i >= 0) Store.data.users[i] = fresh; else Store.data.users.push(fresh);
    } else {
      const u = this.userById(adminId);
      if (!u) throw new Error('Admin not found');
      u.status = 'active';
    }
    Store.saveCache();
  },
  async rejectAdmin(adminId, reason) {
    if (sb) {
      const { data, error } = await sb.from('users')
        .update({ status: 'rejected' }).eq('id', adminId).select();
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) {
        throw new Error("Couldn't reject — your account isn't allowed to update this user.");
      }
      const fresh = data[0];
      const i = Store.data.users.findIndex(u => u.id === adminId);
      if (i >= 0) Store.data.users[i] = fresh; else Store.data.users.push(fresh);
    } else {
      const u = this.userById(adminId);
      if (!u) throw new Error('Admin not found');
      u.status = 'rejected';
    }
    Store.saveCache();
  },
  // Hard-delete an admin + their entire shop including all production data.
  // Postgres ON DELETE CASCADE on FKs to shops handles most of the chain;
  // we delete the shop, then the admin_contractors links, then the user row.
  async deleteAdminAndData(adminId) {
    const u = this.userById(adminId);
    if (!u) throw new Error('Admin not found');
    const shopId = u.shop_id;

    if (sb) {
      if (shopId) {
        const { error: e1 } = await sb.from('shops').delete().eq('id', shopId);
        if (e1) throw new Error('Could not delete shop: ' + e1.message);
      }
      // Junction rows: delete ones referencing this admin (cascade also fires
      // when we delete the user row, but doing it explicitly is clearer).
      await sb.from('admin_contractors').delete().eq('admin_id', adminId);
      const { error: e2 } = await sb.from('users').delete().eq('id', adminId);
      if (e2) throw new Error('Could not delete user: ' + e2.message);
    }

    // Local cache: cascade by hand so the UI updates instantly without a remote round-trip.
    if (shopId) {
      const drop = (key, field) => {
        Store.data[key] = (Store.data[key] || []).filter(r => r[field] !== shopId);
      };
      drop('orders', 'shop_id');
      drop('lots', 'shop_id');
      drop('worker_assignments', 'shop_id');
      drop('production_entries', 'shop_id');
      drop('payments', 'shop_id');
      drop('designs', 'shop_id');
      drop('piece_types', 'shop_id');
      drop('notifications', 'shop_id');
      drop('holidays', 'shop_id');
      Store.data.shops = (Store.data.shops || []).filter(s => s.id !== shopId);
    }
    Store.data.admin_contractors = (Store.data.admin_contractors || []).filter(ac => ac.admin_id !== adminId);
    Store.data.users = Store.data.users.filter(x => x.id !== adminId);
    Store.saveCache();
  },
  allContractors() { return Store.data.users.filter(u => u.role === 'contractor'); },
  workers() { return Store.data.users.filter(u => u.role === 'worker'); },
  workersForContractor(contractorId) {
    return Store.data.users.filter(u => u.role === 'worker' && u.parent_user_id === contractorId);
  },
  lotsForContractor(contractorId) {
    return Store.data.lots.filter(l => l.contractor_id === contractorId);
  },

  /* Admin ↔ Contractor (many-to-many) */
  adminContractorLinks() { return Store.data.admin_contractors || []; },
  contractorsForAdmin(adminId) {
    const ids = new Set(this.adminContractorLinks()
      .filter(ac => ac.admin_id === adminId && ac.status !== 'ended')
      .map(ac => ac.contractor_id));
    return this.allContractors().filter(c => ids.has(c.id));
  },
  adminsForContractor(contractorId) {
    const ids = new Set(this.adminContractorLinks()
      .filter(ac => ac.contractor_id === contractorId && ac.status !== 'ended')
      .map(ac => ac.admin_id));
    return this.admins().filter(a => ids.has(a.id));
  },
  // Used in admin's flow: "+ Add contractor" — they pick an existing one to link.
  contractorsAvailableToLink(adminId) {
    const linked = new Set(this.contractorsForAdmin(adminId).map(c => c.id));
    return this.allContractors().filter(c => !linked.has(c.id));
  },
  linkAdminContractor(adminId, contractorId, notes) {
    if (this.adminContractorLinks().some(ac =>
      ac.admin_id === adminId && ac.contractor_id === contractorId && ac.status !== 'ended')) {
      throw new Error('Already linked');
    }
    Store.data.admin_contractors.push({
      id: uid('ac'), admin_id: adminId, contractor_id: contractorId,
      status: 'active', since: today(),
      notes: (notes || '').trim() || null,
      created_at: new Date().toISOString()
    });
    Store.save();
  },
  unlinkAdminContractor(adminId, contractorId) {
    const link = this.adminContractorLinks().find(ac =>
      ac.admin_id === adminId && ac.contractor_id === contractorId && ac.status !== 'ended');
    if (link) { link.status = 'ended'; Store.save(); }
  },
  // Lots assigned by a specific admin to a specific contractor
  lotsForAdminContractor(adminId, contractorId) {
    return Store.data.lots.filter(l => l.contractor_id === contractorId && l.shop_id === this.adminShopId(adminId));
  },
  lotsForShop(shopId) {
    return Store.data.lots.filter(l => l.shop_id === shopId);
  },
  // Workers under contractors that this admin is engaged with.
  workersForAdmin(adminId) {
    const cIds = new Set(this.contractorsForAdmin(adminId).map(c => c.id));
    return this.workers().filter(w => cIds.has(w.parent_user_id));
  },
  // Production entries against lots in this admin's shop.
  entriesForAdmin(adminId, fromDate, toDate) {
    const shopId = this.adminShopId(adminId);
    return Store.data.production_entries.filter(e => {
      const a = this.assignmentById(e.assignment_id);
      const lot = a ? this.lotById(a.lot_id) : null;
      if (!lot || lot.shop_id !== shopId) return false;
      return (!fromDate || e.date >= fromDate) && (!toDate || e.date <= toDate);
    });
  },
  ordersForAdmin(adminId) {
    const shopId = this.adminShopId(adminId);
    return this.orders().filter(o => o.shop_id === shopId);
  },
  adminShopId(adminId) {
    const a = this.userById(adminId);
    return a?.shop_id || null;
  },
  shopById(id) {
    return (Store.data.shops || []).find(s => s.id === id);
  },
  // Resolve the "current shop" for any role: owners by direct shop_id,
  // contractors via any lot they hold, workers via their parent contractor.
  shopForUser(u) {
    if (!u) return null;
    const shops = Store.data.shops || [];
    if (u.shop_id) return shops.find(s => s.id === u.shop_id) || null;
    if (u.role === 'contractor') {
      const lot = (Store.data.lots || []).find(l => l.contractor_id === u.id);
      return lot ? shops.find(s => s.id === lot.shop_id) || null : null;
    }
    if (u.role === 'worker') {
      const wa = (Store.data.worker_assignments || []).find(a => a.worker_id === u.id);
      const lot = wa ? (Store.data.lots || []).find(l => l.id === wa.lot_id) : null;
      return lot ? shops.find(s => s.id === lot.shop_id) || null : null;
    }
    return null;
  },

  async addUser({ name, mobile, role, parent_user_id, password }) {
    if (Store.data.users.some(u => u.mobile === mobile)) throw new Error('Mobile already registered');
    const u = {
      id: uid('u'), shop_id: role === 'admin' ? Store.data.shop.id : null,
      mobile: mobile.trim(), name: name.trim(), role,
      password_hash: await hashPassword(password || '1234'),
      parent_user_id: parent_user_id || null, photo: null,
      status: 'active', created_at: new Date().toISOString()
    };
    Store.data.users.push(u);
    Store.save();
    return u;
  },
  // Used by admin: create a new contractor AND link them in one go.
  async addContractorForAdmin({ name, mobile, password, adminId, notes }) {
    const c = await this.addUser({ name, mobile, role: 'contractor', password });
    this.linkAdminContractor(adminId, c.id, notes);
    return c;
  },
  // Used by admin: link an existing contractor by mobile.
  linkContractorByMobile(adminId, mobile, notes) {
    const c = Store.data.users.find(u => u.role === 'contractor' && u.mobile === mobile.trim());
    if (!c) throw new Error('No contractor found with that mobile');
    this.linkAdminContractor(adminId, c.id, notes);
    return c;
  },

  /* Payments */
  paymentsByPayee(payeeId) {
    return Store.data.payments.filter(p => p.payee_id === payeeId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  paymentsByPayer(payerId) {
    return Store.data.payments.filter(p => p.payer_id === payerId)
      .sort((a, b) => b.date.localeCompare(a.date));
  },
  addPayment({ payer_id, payee_id, amount, type, method, date, note }) {
    const p = {
      id: uid('p'), shop_id: Store.data.shop.id,
      payer_id, payee_id,
      amount: Number(amount), type, method: method || 'cash',
      date: date || today(), note: (note || '').trim() || null,
      against_assignment_id: null, against_lot_id: null,
      created_at: new Date().toISOString()
    };
    Store.data.payments.push(p);
    Store.save();
    return p;
  },
  workerEarned(workerId) {
    return this.assignmentsForWorker(workerId)
      .reduce((s, a) => s + this.assignmentEarned(a.id), 0);
  },
  workerPaid(workerId) {
    return Store.data.payments
      .filter(p => p.payee_id === workerId && ['settlement','advance','bonus'].includes(p.type))
      .reduce((s, p) => s + Number(p.amount), 0);
  },
  workerBalance(workerId) {
    return this.workerEarned(workerId) - this.workerPaid(workerId);
  },
  contractorBalanceToPay(contractorId) {
    // sum of (earned - paid) across this contractor's workers
    return this.workersForContractor(contractorId)
      .reduce((s, w) => s + Math.max(0, this.workerBalance(w.id)), 0);
  },

  /* Time helpers */
  weekStart() { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().slice(0,10); }
};

/* ─── Auth ────────────────────────────────────────────────── */
function prettyAuthError(error) {
  const msg = (error && error.message) || 'Unknown error';
  if (/already registered|already exists/i.test(msg)) return 'This mobile is already registered. Try signing in.';
  if (/invalid login credentials/i.test(msg)) return 'Wrong mobile or password.';
  if (/email rate limit/i.test(msg)) return 'Too many attempts. Wait a minute and try again.';
  return msg;
}

const Auth = {
  // Mobile is the public identity; Supabase Auth wants an email format,
  // so we map mobile → fake email. The fake domain never sends real mail.
  mobileToEmail(m) { return String(m || '').trim() + '@karkhana.local'; },

  current() {
    const s = Store.data && Store.data.session;
    if (!s) return null;
    return Store.data.users.find(u => u.id === s.userId) || null;
  },

  async signIn(mobile, password) {
    if (!sb) throw new Error('Supabase not configured');
    const email = this.mobileToEmail(mobile);
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(prettyAuthError(error));

    // Pull profile + populate Store
    await Store.loadFromRemote();
    const me = Store.data.users.find(u => u.id === data.user.id);
    if (!me) throw new Error('Profile row missing. Please sign up again or contact support.');
    return me;
  },

  async signUpAdmin({ name, mobile, password, shop_name }) {
    if (!sb) throw new Error('Supabase not configured');
    const cleanMobile = String(mobile).trim();
    const cleanName = String(name).trim();
    const isPlatformAdmin = SOFTWARE_ADMIN_MOBILE && cleanMobile === SOFTWARE_ADMIN_MOBILE;

    const email = this.mobileToEmail(cleanMobile);
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(prettyAuthError(error));
    if (!data.session) {
      throw new Error('Email confirmation is enabled. Disable it in Supabase Auth settings, then try again.');
    }
    const userId = data.user.id;

    if (isPlatformAdmin) {
      // Platform / software admin: no shop of their own, sees every karkhana.
      const { error: e } = await sb.from('users').insert({
        id: userId, shop_id: null, mobile: cleanMobile, name: cleanName,
        role: 'software_admin', status: 'active'
      });
      if (e) throw new Error('Could not create profile: ' + e.message);
      await Store.loadFromRemote();
      return { userId, role: 'software_admin' };
    }

    // Regular Owner: create shop + user row, status='pending' until approved.
    const shopId = uid('shop');
    {
      const { error: e1 } = await sb.from('shops').insert({
        id: shopId, name: shop_name || (cleanName + "'s Workshop"),
        owner_user_id: userId
      });
      if (e1) throw new Error('Could not create shop: ' + e1.message);
    }
    {
      const { error: e2 } = await sb.from('users').insert({
        id: userId, shop_id: shopId, mobile: cleanMobile, name: cleanName,
        role: 'admin', status: 'pending'
      });
      if (e2) throw new Error('Could not create profile: ' + e2.message);
    }

    await Store.loadFromRemote();
    return { userId, shopId, role: 'admin', status: 'pending' };
  },

  async signUpContractor({ name, mobile, password, admin_mobile }) {
    if (!sb) throw new Error('Supabase not configured');

    const adminMobile = String(admin_mobile).trim();
    const { data: admin, error: ae } = await sb.from('users')
      .select('id, role, name')
      .eq('mobile', adminMobile)
      .eq('role', 'admin')
      .maybeSingle();
    if (ae) throw new Error('Admin lookup: ' + ae.message);
    if (!admin) throw new Error('No Owner registered with that mobile yet — ask them to sign up first.');

    const email = this.mobileToEmail(mobile);
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(prettyAuthError(error));
    if (!data.session) throw new Error('Email confirmation is enabled. Disable it in Supabase Auth settings, then try again.');
    const userId = data.user.id;

    {
      const { error: e1 } = await sb.from('users').insert({
        id: userId, shop_id: null, mobile: String(mobile).trim(),
        name: String(name).trim(), role: 'contractor', status: 'active'
      });
      if (e1) throw new Error('Could not create profile: ' + e1.message);
    }
    {
      const { error: e2 } = await sb.from('admin_contractors').insert({
        id: uid('ac'), admin_id: admin.id, contractor_id: userId,
        status: 'active', since: today()
      });
      if (e2) throw new Error('Could not link to admin: ' + e2.message);
    }

    await Store.loadFromRemote();
    return { userId };
  },

  async signUpWorker({ name, mobile, password, contractor_mobile }) {
    if (!sb) throw new Error('Supabase not configured');

    const cMobile = String(contractor_mobile).trim();
    const { data: contractor, error: ce } = await sb.from('users')
      .select('id, role, name')
      .eq('mobile', cMobile)
      .eq('role', 'contractor')
      .maybeSingle();
    if (ce) throw new Error('Contractor lookup: ' + ce.message);
    if (!contractor) throw new Error('No Contractor registered with that mobile yet — ask them to sign up first.');

    const email = this.mobileToEmail(mobile);
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(prettyAuthError(error));
    if (!data.session) throw new Error('Email confirmation is enabled. Disable it in Supabase Auth settings, then try again.');
    const userId = data.user.id;

    const { error: e1 } = await sb.from('users').insert({
      id: userId, shop_id: null, mobile: String(mobile).trim(),
      name: String(name).trim(), role: 'worker',
      parent_user_id: contractor.id, status: 'active'
    });
    if (e1) throw new Error('Could not create profile: ' + e1.message);

    await Store.loadFromRemote();
    return { userId };
  },

  async signOut() {
    Store.unsubscribeRealtime();
    if (sb) await sb.auth.signOut().catch(() => {});
    Store.data = seed();
    Store.saveCache();
  }
};

/* ─── App state + router ──────────────────────────────────── */
const App = {
  route: null,           // 'login' | 'admin' | 'contractor' | 'worker'
  user: null,
  tab: 'home',
  detail: null           // { type: 'order'|'lot'|'worker'|'contractor', id: '...' }
};

function navigate(opts = {}) {
  if (opts.tab !== undefined) { App.tab = opts.tab; App.detail = null; }
  if (opts.detail !== undefined) App.detail = opts.detail;
  render();
}
function goTab(tab) {
  App.tab = tab; App.detail = null; render();
  // Software admin's Pending tab is the most time-sensitive view: a brand
  // new owner signup must show up the moment the admin lands here, even if
  // realtime is asleep or the local cache is stale. Fire-and-forget pull
  // so the UI updates as soon as data arrives.
  if (App.user && App.user.role === 'software_admin' && tab === 'pending' && REMOTE_ENABLED) {
    Store.loadFromRemote().then(ok => { if (ok) render(); }).catch(() => {});
  }
}
function goDetail(type, id) { App.detail = { type, id }; render(); }
function goBack() { App.detail = null; render(); }

function render() {
  const view = $('#view');
  const tabbar = $('#tabbar');
  view.innerHTML = '';
  tabbar.innerHTML = '';

  // Keep Store.data.shop in sync with the current user. Owners get their own
  // shop; software_admin / contractor / worker fall back to the first shop
  // their user row references via lots/assignments, else a safe stub.
  Store.data.shop = Domain.shopForUser(App.user) ||
    { id: '', name: '', owner_user_id: '' };

  if (!App.user) {
    document.getElementById('app').classList.add('no-tab');
    tabbar.hidden = true;
    view.appendChild(viewLogin());
    return;
  }
  document.getElementById('app').classList.remove('no-tab');

  // Pending Owner: locked out until software admin approves.
  if (Domain.isPending(App.user)) {
    document.getElementById('app').classList.add('no-tab');
    tabbar.hidden = true;
    view.appendChild(viewPendingApproval());
    return;
  }

  // Rejected: show a message + sign-out only.
  if (App.user.status === 'rejected') {
    document.getElementById('app').classList.add('no-tab');
    tabbar.hidden = true;
    view.appendChild(viewRejected());
    return;
  }

  if (App.user.role === 'software_admin') view.appendChild(viewSoftwareAdmin());
  else if (App.user.role === 'admin')      view.appendChild(viewAdmin());
  else if (App.user.role === 'contractor') view.appendChild(viewContractor());
  else if (App.user.role === 'worker')     view.appendChild(viewWorker());
  else view.appendChild(el('div', { class: 'empty' }, 'Unknown role.'));

  const tabs = roleTabs(App.user.role);
  if (tabs.length > 1) {
    tabbar.hidden = false;
    for (const t of tabs) {
      tabbar.appendChild(el('button', {
        class: 'tab' + (App.tab === t.key && !App.detail ? ' active' : ''),
        onclick: () => goTab(t.key)
      },
        el('div', { class: 'ico' }, t.ico),
        el('div', null, t.label)
      ));
    }
  } else {
    tabbar.hidden = true;
  }
}

function roleTabs(role) {
  if (role === 'software_admin') return [
    { key: 'home',       ico: '🏠', label: 'Home' },
    { key: 'pending',    ico: '⏳', label: 'Pending' },
    { key: 'karkhanas',  ico: '🏭', label: 'Workshops' },
    { key: 'reports',    ico: '📊', label: 'Reports' }
  ];
  if (role === 'admin') return [
    { key: 'home',        ico: '🏠', label: 'Home' },
    { key: 'orders',      ico: '📋', label: 'Orders' },
    { key: 'contractors', ico: '👥', label: 'Contractors' },
    { key: 'designs',     ico: '🎨', label: 'Designs' },
    { key: 'reports',     ico: '📊', label: 'Reports' }
  ];
  if (role === 'contractor') return [
    { key: 'home',     ico: '🏠', label: 'Home' },
    { key: 'lots',     ico: '📦', label: 'Lots' },
    { key: 'workers',  ico: '👷', label: 'Workers' },
    { key: 'admins',   ico: '🏢', label: 'Owners' },
    { key: 'payments', ico: '💸', label: 'Payments' }
  ];
  if (role === 'worker') return [
    { key: 'home',     ico: '✂️', label: 'Today' },
    { key: 'work',     ico: '📋', label: 'My Work' },
    { key: 'earnings', ico: '💰', label: 'Earnings' }
  ];
  return [];
}

/* ─── Login view ──────────────────────────────────────────── */
function viewLogin() {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'login-hero' },
    el('div', { class: 'logo' }, '✂️'),
    el('h1', null, 'DarziMate'),
    el('div', { class: 'tagline' }, 'Tailoring production manager')
  ));

  let mode = App._loginMode || 'signin';   // 'signin' | 'signup'
  let signupRole = App._signupRole || 'admin';  // 'admin' | 'contractor' | 'worker'

  const tabs = el('div', { class: 'seg' });
  tabs.appendChild(el('button', {
    type: 'button',
    class: 'seg-btn' + (mode === 'signin' ? ' active' : ''),
    onclick: () => { App._loginMode = 'signin'; render(); }
  }, 'Sign in'));
  tabs.appendChild(el('button', {
    type: 'button',
    class: 'seg-btn' + (mode === 'signup' ? ' active' : ''),
    onclick: () => { App._loginMode = 'signup'; render(); }
  }, 'Sign up'));
  wrap.appendChild(tabs);

  if (mode === 'signin') {
    wrap.appendChild(viewSignInForm());
  } else {
    wrap.appendChild(viewSignUpForm(signupRole));
  }

  if (!REMOTE_ENABLED) {
    wrap.appendChild(el('div', { class: 'card', style: 'background: var(--c-warning-50)' },
      el('div', { style: 'font-weight:700;color:var(--c-warning)' }, 'Supabase not configured'),
      el('div', { class: 'muted' }, 'Edit supabase-config.js with your project URL + anon key.')
    ));
  }
  return wrap;
}

function viewSignInForm() {
  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const mobile = form.querySelector('[name=mobile]').value.trim();
      const password = form.querySelector('[name=password]').value;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        const u = await Auth.signIn(mobile, password);
        App.user = u; App.route = u.role; App.tab = 'home'; App.detail = null;
        Store.subscribeRealtime();
        toast('Welcome, ' + u.name, 'success');
        render();
      } catch (err) {
        toast(err.message || 'Login failed', 'error');
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    }
  });
  form.appendChild(el('div', { class: 'field' },
    el('label', null, 'Mobile number'),
    el('input', { type: 'tel', name: 'mobile', required: true,
      placeholder: '10-digit mobile', maxlength: 10, inputmode: 'numeric', autocomplete: 'tel' })
  ));
  form.appendChild(el('div', { class: 'field' },
    el('label', null, 'Password'),
    el('input', { type: 'password', name: 'password', required: true, placeholder: 'Your password',
      autocomplete: 'current-password' })
  ));
  form.appendChild(el('button', { type: 'submit', class: 'btn full lg' }, 'Sign in'));
  return form;
}

function viewSignUpForm(role) {
  const wrap = el('div');

  // Role picker
  const rolePicker = el('div', { class: 'card role-picker-card' },
    el('div', { class: 'role-picker-label' }, 'I am a…'),
    el('div', { class: 'role-picker' },
      roleBtn('admin',      'Owner',   '👔', role),
      roleBtn('contractor', 'Contractor', '🧑‍🔧', role),
      roleBtn('worker',     'Worker',      '✂️', role)
    )
  );
  wrap.appendChild(rolePicker);

  if (role === 'admin')        wrap.appendChild(signupAdminForm());
  else if (role === 'contractor') wrap.appendChild(signupContractorForm());
  else if (role === 'worker')     wrap.appendChild(signupWorkerForm());
  return wrap;
}

function roleBtn(roleKey, label, ico, current) {
  return el('button', {
    type: 'button',
    class: 'role-btn' + (current === roleKey ? ' active' : ''),
    onclick: () => { App._signupRole = roleKey; render(); }
  },
    el('div', { class: 'role-btn-ico' }, ico),
    el('div', { class: 'role-btn-label' }, label)
  );
}

function signupAdminForm() {
  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await Auth.signUpAdmin({
          name: fd.get('name'), mobile: fd.get('mobile'),
          password: fd.get('password'), shop_name: fd.get('shop_name')
        });
        const me = Auth.current();
        App.user = me; App.route = me.role; App.tab = 'home'; App.detail = null;
        Store.subscribeRealtime();
        toast('Workshop created — welcome, ' + me.name, 'success');
        render();
      } catch (err) {
        toast(err.message || 'Sign up failed', 'error');
        btn.disabled = false; btn.textContent = 'Create workshop';
      }
    }
  });
  form.appendChild(el('h3', null, 'Create your workshop'));
  form.appendChild(field('Your name', input('name', { required: true, placeholder: 'Full name' })));
  form.appendChild(field('Workshop name', input('shop_name', { required: true, placeholder: 'e.g. Sharma Garments' })));
  form.appendChild(field('Your mobile', input('mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: '10-digit', autocomplete: 'tel' })));
  form.appendChild(field('Password', input('password', { required: true, type: 'password', minlength: 6, placeholder: '6+ characters', autocomplete: 'new-password' })));
  form.appendChild(el('button', { type: 'submit', class: 'btn full lg' }, 'Create workshop'));
  return form;
}

function signupContractorForm() {
  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await Auth.signUpContractor({
          name: fd.get('name'), mobile: fd.get('mobile'),
          password: fd.get('password'), admin_mobile: fd.get('admin_mobile')
        });
        const me = Auth.current();
        App.user = me; App.route = me.role; App.tab = 'home'; App.detail = null;
        Store.subscribeRealtime();
        toast('Welcome, ' + me.name, 'success');
        render();
      } catch (err) {
        toast(err.message || 'Sign up failed', 'error');
        btn.disabled = false; btn.textContent = 'Sign up as Contractor';
      }
    }
  });
  form.appendChild(el('h3', null, 'Sign up as Contractor'));
  form.appendChild(field('Your name', input('name', { required: true, placeholder: 'Full name' })));
  form.appendChild(field('Your mobile', input('mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: '10-digit', autocomplete: 'tel' })));
  form.appendChild(field('Password', input('password', { required: true, type: 'password', minlength: 6, placeholder: '6+ characters', autocomplete: 'new-password' })));
  form.appendChild(field('Owner\'s mobile', input('admin_mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: 'Admin\'s 10-digit mobile' }),
    'They must already be signed up.'));
  form.appendChild(el('button', { type: 'submit', class: 'btn full lg' }, 'Sign up as Contractor'));
  return form;
}

function signupWorkerForm() {
  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true; btn.textContent = 'Creating…';
      try {
        await Auth.signUpWorker({
          name: fd.get('name'), mobile: fd.get('mobile'),
          password: fd.get('password'), contractor_mobile: fd.get('contractor_mobile')
        });
        const me = Auth.current();
        App.user = me; App.route = me.role; App.tab = 'home'; App.detail = null;
        Store.subscribeRealtime();
        toast('Welcome, ' + me.name, 'success');
        render();
      } catch (err) {
        toast(err.message || 'Sign up failed', 'error');
        btn.disabled = false; btn.textContent = 'Sign up as Worker';
      }
    }
  });
  form.appendChild(el('h3', null, 'Sign up as Worker'));
  form.appendChild(field('Your name', input('name', { required: true, placeholder: 'Full name' })));
  form.appendChild(field('Your mobile', input('mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: '10-digit', autocomplete: 'tel' })));
  form.appendChild(field('Password', input('password', { required: true, type: 'password', minlength: 6, placeholder: '6+ characters', autocomplete: 'new-password' })));
  form.appendChild(field('Contractor\'s mobile', input('contractor_mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: 'Contractor\'s 10-digit mobile' }),
    'They must already be signed up.'));
  form.appendChild(el('button', { type: 'submit', class: 'btn full lg' }, 'Sign up as Worker'));
  return form;
}

/* ─── Topbar / detail topbar ──────────────────────────────── */
async function refreshApp() {
  const btn = document.querySelector('.topbar .refresh-btn');
  if (btn) { btn.textContent = '⏳'; btn.style.pointerEvents = 'none'; }
  try {
    // Drop the realtime channel before re-pulling — re-subscribe right after
    // so a dropped or stale connection (Wi-Fi flap, tab backgrounded) is rebuilt.
    Store.unsubscribeRealtime();
    const ok = await Store.loadFromRemote();
    if (App.user) {
      const me = Store.data.users.find(u => u.id === App.user.id);
      if (me) App.user = me;
    }
    if (ok) Store.subscribeRealtime();
    render();
    if (ok) {
      // Surface counts so the user can see exactly what came back from the
      // server — "Refreshed" alone hides whether RLS filtered anything out.
      const shops = (Store.data.shops || []).length;
      const pending = (Store.data.users || []).filter(u => u.role === 'admin' && u.status === 'pending').length;
      toast('Refreshed · ' + shops + ' workshop' + (shops === 1 ? '' : 's') +
            ' · ' + pending + ' pending', 'success');
    } else {
      toast('No connection — local data only', '');
    }
  } catch (e) {
    toast('Refresh failed: ' + (e.message || 'unknown error'), 'error');
    if (btn) { btn.textContent = '⟳'; btn.style.pointerEvents = ''; }
  }
}

function topbar(title, subtitle, opts = {}) {
  const left = opts.back
    ? el('button', {
        class: 'icon-btn', title: 'Back', 'aria-label': 'Back',
        onclick: () => goBack()
      }, '←')
    : null;

  const refreshBtn = el('button', {
    class: 'icon-btn refresh-btn', title: 'Refresh', 'aria-label': 'Refresh',
    onclick: () => refreshApp()
  }, '⟳');

  // Avatar/settings button — shows user photo if available, else gear icon.
  const settingsBtn = el('button', {
    class: 'icon-btn settings-btn' + (App.user?.photo ? ' has-photo' : ''),
    title: 'Settings', 'aria-label': 'Settings',
    style: App.user?.photo ? `background-image: url(${App.user.photo})` : '',
    onclick: () => openModal(settingsModal())
  }, App.user?.photo ? '' : '⚙');

  const right = opts.action || settingsBtn;
  return el('div', { class: 'topbar' },
    left,
    el('div', { style: 'flex:1' },
      el('h2', null, title),
      subtitle ? el('div', { class: 'sub' }, subtitle) : null
    ),
    refreshBtn,
    right
  );
}

/* ─── Reusable UI fragments ───────────────────────────────── */
function stat(label, value, variant = '', onClick) {
  const node = el('div', { class: 'stat ' + variant + (onClick ? ' clickable' : '') },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value))
  );
  if (onClick) {
    node.style.cursor = 'pointer';
    node.addEventListener('click', onClick);
  }
  return node;
}
function sectionH(title, action) {
  return el('div', { class: 'section-h' },
    el('h2', null, title),
    action || null
  );
}
function emptyState(ico, text, actionLabel, onAction) {
  return el('div', { class: 'empty' },
    el('div', { class: 'ico' }, ico),
    el('div', { class: 'muted', style: 'margin-bottom:12px' }, text),
    onAction ? el('button', { class: 'btn', onclick: onAction }, actionLabel) : null
  );
}
function progressBar(percent) {
  const p = Math.max(0, Math.min(100, percent || 0));
  return el('div', { class: 'progress' },
    el('div', { class: 'progress-fill', style: { width: p + '%' } })
  );
}
function chip(label, variant = '') {
  return el('span', { class: 'chip ' + variant }, label);
}

/* ============================================================
   REJECTED — locked screen for rejected applications
   ============================================================ */
function viewRejected() {
  const wrap = el('div');
  wrap.appendChild(topbar('Application rejected', App.user.name));

  wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;padding:32px 16px' },
    el('div', { style: 'font-size:64px;margin-bottom:8px' }, '🚫'),
    el('h2', null, 'Application rejected'),
    el('p', { class: 'muted', style: 'margin-bottom:16px' },
      'Your application was not approved. Please contact the software admin if you think this is a mistake.'),
    el('button', {
      class: 'btn full',
      onclick: async () => {
        await Auth.signOut();
        App.user = null; App.route = 'login'; App.detail = null;
        render();
      }
    }, 'Sign out')
  ));
  return wrap;
}

/* ============================================================
   PENDING APPROVAL — locked screen for new Owner signups
   ============================================================ */
function viewPendingApproval() {
  const wrap = el('div');
  wrap.appendChild(topbar('Application submitted', App.user.name));

  const myShop = Store.data.shops.find(s => s.id === App.user.shop_id);

  wrap.appendChild(el('div', { class: 'card', style: 'text-align:center;padding:32px 16px' },
    el('div', { style: 'font-size:64px;margin-bottom:8px' }, '⏳'),
    el('h2', null, 'Waiting for software admin approval'),
    el('p', { class: 'muted', style: 'margin-bottom:16px' },
      'Your application has been received. Once the software admin approves, you can start using DarziMate.'),
    el('div', { class: 'card', style: 'background: var(--c-primary-50);border-color:transparent;text-align:left' },
      el('div', { class: 'muted', style: 'font-size:12px;margin-bottom:4px' }, 'Workshop'),
      el('div', { style: 'font-weight:700' }, myShop?.name || '—'),
      el('div', { class: 'muted', style: 'font-size:12px;margin-top:8px' }, 'Mobile'),
      el('div', null, App.user.mobile)
    ),
    el('button', {
      class: 'btn full mt-12',
      onclick: async () => {
        await Store.loadFromRemote();
        const me = Store.data.users.find(u => u.id === App.user.id);
        if (!me) {
          toast('Profile not found. Please sign in again.', 'error');
          await Auth.signOut();
          App.user = null; App.route = 'login'; App.detail = null;
          render();
          return;
        }
        App.user = me;
        if (me.status === 'active')      toast('Approved! Welcome aboard.', 'success');
        else if (me.status === 'rejected') toast('Your application was rejected.', 'error');
        else                              toast('Still waiting…', '');
        App.tab = 'home';
        render();
      }
    }, 'Refresh status')
  ));
  return wrap;
}

/* ============================================================
   SOFTWARE ADMIN VIEWS — sees every karkhana, approves new ones
   ============================================================ */
function viewSoftwareAdmin() {
  const wrap = el('div');
  if (App.detail) return renderSoftwareAdminDetail(wrap);

  const titles = {
    home:       'Software Admin',
    pending:    'Pending applications',
    karkhanas:  'All workshops',
    reports:    'Reports'
  };
  wrap.appendChild(topbar('DarziMate', titles[App.tab] || ''));

  if (App.tab === 'home')           softwareAdminHome(wrap);
  else if (App.tab === 'pending')   softwareAdminPending(wrap);
  else if (App.tab === 'karkhanas') softwareAdminKarkhanas(wrap);
  else if (App.tab === 'reports')   softwareAdminReports(wrap);
  return wrap;
}

function renderSoftwareAdminDetail(wrap) {
  if (App.detail.type === 'karkhana')   return softwareAdminKarkhanaDetail(wrap);
  if (App.detail.type === 'contractor') return adminContractorDetail(wrap);
  if (App.detail.type === 'worker')     return workerDetailView(wrap, 'admin');
  return wrap;
}

function softwareAdminHome(wrap) {
  const allShops = Store.data.shops;
  const allAdmins = Domain.approvedAdmins();
  const pendingCount = Domain.pendingAdmins().length;
  const allWorkers = Domain.workers();
  const allContractors = Domain.allContractors();
  const totalProduction = Store.data.production_entries.reduce((s, e) => s + e.pieces_done, 0);
  const totalPaid = Store.data.payments
    .filter(p => ['settlement','advance','bonus'].includes(p.type))
    .reduce((s, p) => s + Number(p.amount), 0);

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Workshops', allShops.length, 'primary', () => goTab('karkhanas')),
    stat('Pending', pendingCount, pendingCount > 0 ? 'accent' : '', () => goTab('pending')),
    stat('Contractors', allContractors.length),
    stat('Workers', allWorkers.length, 'success'),
    stat('Pieces produced', totalProduction),
    stat('Total paid out', fmtINR(totalPaid), 'accent')
  ));

  if (pendingCount > 0) {
    wrap.appendChild(el('div', { class: 'card',
      style: 'background:var(--c-warning-50);border-color:transparent;cursor:pointer',
      onclick: () => goTab('pending') },
      el('div', { class: 'row gap-12' },
        el('div', { style: 'font-size:24px' }, '⏳'),
        el('div', { style: 'flex:1' },
          el('div', { style: 'font-weight:700;color:var(--c-warning)' },
            pendingCount + ' application' + (pendingCount === 1 ? '' : 's') + ' waiting'),
          el('div', { class: 'muted' }, 'Tap to review and approve.')
        ),
        el('div', null, '›')
      )
    ));
  }

  // Only show shops whose owner is active — pending/rejected applications
  // belong on the Pending tab, not mixed in with live workshops. Matches
  // MilkMate's "Approved owners" pattern.
  const activeShops = allShops.filter(s => {
    const owner = Store.data.users.find(u => u.id === s.owner_user_id);
    return owner && owner.status === 'active';
  });
  wrap.appendChild(sectionH('Approved workshops (' + activeShops.length + ')'));
  const recent = activeShops.slice().reverse().slice(0, 5);
  if (recent.length === 0) wrap.appendChild(emptyState('🏭', 'No active workshops yet'));
  else recent.forEach(s => wrap.appendChild(karkhanaListItem(s)));
}

function softwareAdminPending(wrap) {
  const list = Domain.pendingAdmins();
  wrap.appendChild(sectionH('Pending applications (' + list.length + ')'));
  if (list.length === 0) {
    wrap.appendChild(emptyState('✅', 'No pending applications'));
    return;
  }
  list.forEach(a => {
    const shop = Store.data.shops.find(s => s.id === a.shop_id);
    const card = el('div', { class: 'card' },
      el('div', { class: 'row between' },
        el('div', { style: 'flex:1;min-width:0' },
          el('div', { style: 'font-weight:700' }, a.name),
          el('div', { class: 'muted', style: 'font-size:13px' },
            (shop?.name || '—') + ' · ' + a.mobile + ' · applied ' + fmtRelDate(a.created_at)
          )
        ),
        chip('pending', 'open')
      ),
      el('div', { class: 'row gap-12 mt-12' },
        el('button', {
          class: 'btn', style: 'flex:2',
          onclick: async () => {
            try {
              await Domain.approveAdmin(a.id);
              toast(a.name + ' approved', 'success');
              render();
            } catch (e) { toast(e.message, 'error'); }
          }
        }, '✓ Approve'),
        el('button', {
          class: 'btn secondary danger', style: 'flex:1',
          onclick: async () => {
            if (!confirm('Reject ' + a.name + '?')) return;
            try {
              await Domain.rejectAdmin(a.id);
              toast(a.name + ' rejected', '');
              render();
            } catch (e) { toast(e.message, 'error'); }
          }
        }, '✗ Reject')
      )
    );
    wrap.appendChild(card);
  });
}

function softwareAdminKarkhanas(wrap) {
  const list = Store.data.shops;
  if (list.length === 0) {
    wrap.appendChild(emptyState('🏭', 'No workshops yet'));
    return;
  }
  list.forEach(s => wrap.appendChild(karkhanaListItem(s)));
}

function karkhanaListItem(shop) {
  const owner = Store.data.users.find(u => u.id === shop.owner_user_id);
  const orders = Store.data.orders.filter(o => o.shop_id === shop.id);
  const lots = Store.data.lots.filter(l => l.shop_id === shop.id);
  const pieces = Store.data.production_entries.filter(e => {
    const a = Store.data.worker_assignments.find(x => x.id === e.assignment_id);
    const lot = a ? Store.data.lots.find(l => l.id === a.lot_id) : null;
    return lot?.shop_id === shop.id;
  }).reduce((s, e) => s + e.pieces_done, 0);

  const statusChip = owner?.status === 'pending'
    ? chip('pending', 'open')
    : owner?.status === 'rejected'
      ? chip('rejected', 'cancelled')
      : chip('active', 'completed');

  return el('div', { class: 'list-item', onclick: () => goDetail('karkhana', shop.id) },
    el('div', { class: 'avatar' }, '🏭'),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, shop.name),
      el('div', { class: 'sub' },
        (owner?.name || '—') + ' · ' + orders.length + ' orders · ' + lots.length + ' lots · ' + pieces + ' pcs'
      )
    ),
    el('div', { class: 'end' }, statusChip)
  );
}

function softwareAdminKarkhanaDetail(wrap) {
  const shop = Store.data.shops.find(s => s.id === App.detail.id);
  if (!shop) { wrap.appendChild(emptyState('❓', 'Workshop not found', 'Back', goBack)); return wrap; }
  const owner = Store.data.users.find(u => u.id === shop.owner_user_id);
  const orders = Store.data.orders.filter(o => o.shop_id === shop.id);
  const lots = Store.data.lots.filter(l => l.shop_id === shop.id);
  const contractors = Domain.allContractors().filter(c =>
    Store.data.admin_contractors.some(ac => ac.contractor_id === c.id && ac.admin_id === shop.owner_user_id)
  );
  const workers = contractors.flatMap(c => Domain.workersForContractor(c.id));

  wrap.appendChild(topbar(shop.name, owner?.name + ' · ' + (owner?.mobile || ''), { back: true }));

  if (owner?.status === 'pending') {
    wrap.appendChild(el('div', { class: 'card', style: 'background:var(--c-warning-50);border-color:transparent' },
      el('div', { style: 'font-weight:700;color:var(--c-warning);margin-bottom:8px' }, 'Pending approval'),
      el('div', { class: 'row gap-12' },
        el('button', { class: 'btn', style: 'flex:2', onclick: async () => {
          try { await Domain.approveAdmin(owner.id); toast('Approved', 'success'); render(); }
          catch (e) { toast(e.message, 'error'); }
        } }, '✓ Approve'),
        el('button', { class: 'btn secondary danger', style: 'flex:1', onclick: async () => {
          if (!confirm('Reject?')) return;
          try { await Domain.rejectAdmin(owner.id); toast('Rejected', ''); render(); }
          catch (e) { toast(e.message, 'error'); }
        } }, '✗ Reject')
      )
    ));
  }

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Orders', orders.length, 'primary'),
    stat('Lots', lots.length),
    stat('Contractors', contractors.length, 'accent'),
    stat('Workers', workers.length, 'success')
  ));

  wrap.appendChild(sectionH('Contractors'));
  if (contractors.length === 0) wrap.appendChild(emptyState('👥', 'No contractors linked'));
  else contractors.forEach(c => wrap.appendChild(contractorListItem(c)));

  wrap.appendChild(sectionH('Recent orders'));
  if (orders.length === 0) wrap.appendChild(emptyState('📋', 'No orders yet'));
  else orders.slice().reverse().slice(0, 10).forEach(o => wrap.appendChild(orderListItem(o)));

  // ─── Danger zone: hard-delete this workshop + every row attached to it ───
  wrap.appendChild(el('div', {
    class: 'card',
    style: 'background:var(--c-danger-50);border-color:transparent;margin-top:24px'
  },
    el('div', { style: 'font-weight:700;color:var(--c-danger);margin-bottom:6px' }, '⚠️ Danger zone'),
    el('div', { class: 'muted', style: 'font-size:13px;margin-bottom:12px' },
      'Permanently delete ' + (shop?.name || 'this workshop') + ' along with every order, lot, ' +
      'worker assignment, production entry and payment recorded against it. Cannot be undone.'),
    el('button', {
      class: 'btn full danger',
      onclick: async () => {
        if (!confirm('Permanently delete "' + shop.name + '" and ALL its data? This cannot be undone.')) return;
        const t = prompt('Type DELETE in capitals to confirm:');
        if (t !== 'DELETE') { toast('Not confirmed — cancelled', ''); return; }
        try {
          await Domain.deleteAdminAndData(owner.id);
          toast('Workshop deleted', 'success');
          goBack();
        } catch (e) { toast(e.message, 'error'); }
      }
    }, '🗑️ Delete this workshop')
  ));

  return wrap;
}

function softwareAdminReports(wrap) {
  const from = Domain.weekStart();
  const all = Store.data.production_entries.filter(e => e.date >= from);
  const totalPieces = all.reduce((s, e) => s + e.pieces_done, 0);
  const earned = all.reduce((s, e) => {
    const a = Domain.assignmentById(e.assignment_id);
    return s + (a ? e.pieces_done * a.rate : 0);
  }, 0);

  wrap.appendChild(sectionH('Last 7 days · all workshops'));
  wrap.appendChild(el('div', { class: 'stats' },
    stat('Pieces', totalPieces, 'primary'),
    stat('Production value', fmtINR(earned), 'accent'),
    stat('Active workers', new Set(all.map(e => e.worker_id)).size, 'success'),
    stat('Active workshops', new Set(all.map(e => {
      const a = Domain.assignmentById(e.assignment_id);
      const lot = a ? Domain.lotById(a.lot_id) : null;
      return lot?.shop_id;
    }).filter(Boolean)).size)
  ));

  wrap.appendChild(sectionH('By workshop (7 days)'));
  const byShop = {};
  all.forEach(e => {
    const a = Domain.assignmentById(e.assignment_id);
    const lot = a ? Domain.lotById(a.lot_id) : null;
    if (!lot) return;
    byShop[lot.shop_id] = (byShop[lot.shop_id] || 0) + e.pieces_done;
  });
  const rows = Object.entries(byShop).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) wrap.appendChild(emptyState('📊', 'No production this week'));
  else rows.forEach(([sid, pieces]) => {
    const shop = Store.data.shops.find(s => s.id === sid);
    wrap.appendChild(el('div', { class: 'list-item', onclick: () => goDetail('karkhana', sid) },
      el('div', { class: 'avatar' }, '🏭'),
      el('div', { class: 'meta' },
        el('div', { class: 'name' }, shop?.name || 'Unknown'),
        el('div', { class: 'sub' }, pieces + ' pieces this week')
      ),
      el('div', { class: 'end' }, '›')
    ));
  });
}

/* ============================================================
   ADMIN VIEWS
   ============================================================ */
function viewAdmin() {
  const wrap = el('div');
  if (App.detail) return renderAdminDetail(wrap);

  const titles = {
    home:        Store.data.shop?.name ? 'Owner · ' + Store.data.shop.name : 'Owner',
    orders:      'Bulk orders',
    contractors: 'Contractors',
    designs:     'Designs & rates',
    reports:     'Reports'
  };
  wrap.appendChild(topbar('DarziMate', titles[App.tab] || ''));

  if (App.tab === 'home')        adminHome(wrap);
  else if (App.tab === 'orders')      adminOrders(wrap);
  else if (App.tab === 'contractors') adminContractors(wrap);
  else if (App.tab === 'designs')     adminDesigns(wrap);
  else if (App.tab === 'reports')     adminReports(wrap);
  return wrap;
}

function renderAdminDetail(wrap) {
  if (App.detail.type === 'order')      return adminOrderDetail(wrap);
  if (App.detail.type === 'contractor') return adminContractorDetail(wrap);
  if (App.detail.type === 'worker')     return workerDetailView(wrap, 'admin');
  return wrap;
}

function adminHome(wrap) {
  const orders = Domain.ordersForAdmin(App.user.id);
  const inProgress = orders.filter(o => o.status === 'in_progress').length;
  const myLots = Domain.lotsForShop(Domain.adminShopId(App.user.id));
  const totalLotQty = myLots.reduce((s, l) => s + l.qty, 0);
  const myEntries = Domain.entriesForAdmin(App.user.id);
  const totalDone = myEntries.reduce((s, e) => s + e.pieces_done, 0);
  const contractors = Domain.contractorsForAdmin(App.user.id);
  const workers = Domain.workersForAdmin(App.user.id);
  // payments admin tracks: by contractors I work with, to their workers
  const cIds = new Set(contractors.map(c => c.id));
  const totalPaid = Store.data.payments
    .filter(p => cIds.has(p.payer_id) && ['settlement','advance','bonus'].includes(p.type))
    .reduce((s, p) => s + Number(p.amount), 0);

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Orders', orders.length, 'primary', () => goTab('orders')),
    stat('In progress', inProgress, ''),
    stat('Pieces done', totalDone, 'success'),
    stat('Pieces in lots', totalLotQty),
    stat('Contractors', contractors.length, 'accent', () => goTab('contractors')),
    stat('Workers', workers.length, 'success'),
    stat('Total paid', fmtINR(totalPaid), 'accent')
  ));

  wrap.appendChild(sectionH('Quick actions'));
  wrap.appendChild(el('div', { class: 'card' },
    el('div', { class: 'col' },
      el('button', { class: 'btn full', onclick: () => openModal(addOrderForm()) }, '+ New bulk order'),
      el('button', { class: 'btn secondary full', onclick: () => openModal(addContractorForAdminForm()) }, '+ Add contractor'),
      el('button', { class: 'btn secondary full', onclick: () => openModal(addDesignForm()) }, '+ Add design')
    )
  ));

  if (orders.length > 0) {
    wrap.appendChild(sectionH('Recent orders'));
    orders.slice(-5).reverse().forEach(o => wrap.appendChild(orderListItem(o)));
  }
}

function adminOrders(wrap) {
  wrap.appendChild(sectionH('Bulk orders',
    el('button', { class: 'btn sm', onclick: () => openModal(addOrderForm()) }, '+ New')
  ));
  const orders = Domain.ordersForAdmin(App.user.id).slice().reverse();
  if (orders.length === 0) {
    wrap.appendChild(emptyState('📋', 'No orders yet', '+ Create first order',
      () => openModal(addOrderForm())));
    return;
  }
  orders.forEach(o => wrap.appendChild(orderListItem(o)));
}

function orderListItem(o) {
  const design = Domain.designById(o.design_id);
  const prog = Domain.orderProgress(o.id);
  return el('div', { class: 'list-item', onclick: () => goDetail('order', o.id) },
    el('div', { class: 'avatar' }, '📦'),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, (design?.name || 'Unknown') + ' × ' + o.total_qty),
      el('div', { class: 'sub' },
        chip(o.status.replace('_', ' '), o.status), ' ',
        o.deadline ? ' · due ' + fmtDate(o.deadline) : '',
        ' · ' + prog.percent + '% done'
      )
    ),
    el('div', { class: 'end' }, '›')
  );
}

function adminOrderDetail(wrap) {
  const o = Domain.orderById(App.detail.id);
  if (!o) { wrap.appendChild(emptyState('❓', 'Order not found', 'Back', goBack)); return wrap; }
  const design = Domain.designById(o.design_id);
  const prog = Domain.orderProgress(o.id);
  const lots = Domain.lotsForOrder(o.id);

  wrap.appendChild(topbar(design?.name || 'Order', '× ' + o.total_qty + ' · ' + chipText(o.status), { back: true }));

  wrap.appendChild(el('div', { class: 'card' },
    el('div', { class: 'row between' },
      el('div', null,
        el('div', { class: 'muted', style: 'font-size:12px' }, 'Progress'),
        el('div', { style: 'font-size:22px;font-weight:800' }, prog.percent + '%'),
        el('div', { class: 'muted' }, prog.done + ' / ' + prog.total + ' pieces')
      ),
      el('div', { style: 'text-align:right' },
        el('div', { class: 'muted', style: 'font-size:12px' }, 'Deadline'),
        el('div', { style: 'font-weight:600' }, o.deadline ? fmtDate(o.deadline) : '—')
      )
    ),
    progressBar(prog.percent),
    o.notes ? el('div', { class: 'muted', style: 'margin-top:8px' }, o.notes) : null
  ));

  wrap.appendChild(sectionH('Lots',
    el('button', { class: 'btn sm', onclick: () => openModal(splitOrderForm(o.id)) }, '+ Split into lots')
  ));
  if (lots.length === 0) {
    wrap.appendChild(emptyState('📦', 'No lots yet — split this order into lots first',
      '+ Split into lots', () => openModal(splitOrderForm(o.id))));
  } else {
    lots.forEach(l => wrap.appendChild(lotListItem(l)));
  }
  return wrap;
}

function lotListItem(l) {
  const prog = Domain.lotProgress(l.id);
  const contractor = l.contractor_id ? Domain.userById(l.contractor_id) : null;
  return el('div', { class: 'list-item', onclick: () => goDetail('lot', l.id) },
    el('div', { class: 'avatar' }, 'L' + l.lot_no),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, 'Lot #' + l.lot_no + ' · ' + l.qty + ' pcs'),
      el('div', { class: 'sub' },
        chip(l.status.replace('_', ' '), l.status), ' ',
        contractor ? ' · ' + contractor.name : ' · unassigned',
        ' · ' + prog.percent + '%'
      )
    ),
    el('div', { class: 'end' }, '›')
  );
}

function adminContractors(wrap) {
  wrap.appendChild(sectionH('My contractors',
    el('button', { class: 'btn sm', onclick: () => openModal(addContractorForAdminForm()) }, '+ Add')
  ));
  const list = Domain.contractorsForAdmin(App.user.id);
  if (list.length === 0) {
    wrap.appendChild(emptyState('👥', 'No contractors linked yet', '+ Add contractor',
      () => openModal(addContractorForAdminForm())));
    return;
  }
  list.forEach(c => wrap.appendChild(contractorListItem(c)));
}

function contractorListItem(c) {
  // For admin viewer, scope lots to the admin's shop only.
  const lots = App.user.role === 'admin'
    ? Domain.lotsForAdminContractor(App.user.id, c.id)
    : Domain.lotsForContractor(c.id);
  const workers = Domain.workersForContractor(c.id);
  const balance = Domain.contractorBalanceToPay(c.id);
  return el('div', { class: 'list-item', onclick: () => goDetail('contractor', c.id) },
    el('div', { class: 'avatar' }, c.name.slice(0,1)),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, c.name),
      el('div', { class: 'sub' },
        lots.length + ' lots · ' + workers.length + ' workers · pay ' + fmtINR(balance)
      )
    ),
    el('div', { class: 'end' }, '›')
  );
}

function adminContractorDetail(wrap) {
  const c = Domain.userById(App.detail.id);
  if (!c) { wrap.appendChild(emptyState('❓', 'Contractor not found', 'Back', goBack)); return wrap; }
  // Scope to lots from THIS admin's shop only.
  const lots = Domain.lotsForAdminContractor(App.user.id, c.id);
  const workers = Domain.workersForContractor(c.id);
  const myShopId = Domain.adminShopId(App.user.id);
  const totalDone = Domain.assignmentsForContractor(c.id)
    .filter(a => Domain.lotById(a.lot_id)?.shop_id === myShopId)
    .reduce((s, a) => s + Domain.assignmentPiecesDone(a.id), 0);
  const totalEarnedByWorkers = workers.reduce((s, w) => s + Domain.workerEarned(w.id), 0);
  const balance = Domain.contractorBalanceToPay(c.id);

  // Other admins this contractor also works for
  const otherAdmins = Domain.adminsForContractor(c.id).filter(a => a.id !== App.user.id);

  wrap.appendChild(topbar(c.name, c.mobile, { back: true,
    action: el('button', {
      class: 'icon-btn', title: 'Unlink',
      onclick: () => {
        if (!confirm('Unlink ' + c.name + ' from your shop? Their lots stay; future ones won\'t list them.')) return;
        Domain.unlinkAdminContractor(App.user.id, c.id);
        toast('Unlinked', 'success');
        goBack();
      }
    }, '⊘')
  }));

  if (otherAdmins.length > 0) {
    wrap.appendChild(el('div', { class: 'card', style: 'background: var(--c-primary-50); border-color: transparent;' },
      el('div', { class: 'muted', style: 'font-size:12px' }, 'Also works for'),
      el('div', null, otherAdmins.map(a => a.name).join(' · '))
    ));
  }

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Lots', lots.length, 'primary'),
    stat('Workers', workers.length, 'success'),
    stat('Pieces done', totalDone),
    stat('Workers earned', fmtINR(totalEarnedByWorkers)),
    stat('Pending pay-out', fmtINR(balance), 'accent')
  ));

  wrap.appendChild(sectionH('Lots'));
  if (lots.length === 0) wrap.appendChild(emptyState('📦', 'No lots assigned'));
  else lots.forEach(l => wrap.appendChild(lotListItem(l)));

  wrap.appendChild(sectionH('Workers'));
  if (workers.length === 0) wrap.appendChild(emptyState('👷', 'No workers under this contractor'));
  else workers.forEach(w => wrap.appendChild(workerListItem(w, 'admin')));

  return wrap;
}

function adminDesigns(wrap) {
  wrap.appendChild(sectionH('Designs & rates',
    el('button', { class: 'btn sm', onclick: () => openModal(addDesignForm()) }, '+ Add')
  ));
  const list = Domain.designs();
  if (list.length === 0) {
    wrap.appendChild(emptyState('🎨', 'No designs yet', '+ Add design', () => openModal(addDesignForm())));
    return;
  }
  list.forEach(d => wrap.appendChild(designListItem(d)));
}

function designListItem(d) {
  const pts = Domain.pieceTypesForDesign(d.id);
  const totalRate = pts.reduce((s, p) => s + Number(p.default_rate), 0);
  return el('div', { class: 'card' },
    el('div', { class: 'row between' },
      el('div', null,
        el('div', { style: 'font-weight:700' }, d.name),
        el('div', { class: 'muted' }, d.sku || '—')
      ),
      el('div', { style: 'text-align:right' },
        el('div', { style: 'font-weight:700' }, fmtINR(totalRate)),
        el('div', { class: 'muted', style: 'font-size:12px' }, 'all-in / piece')
      )
    ),
    el('div', { class: 'muted', style: 'margin-top:8px;font-size:12px' },
      pts.map(p => p.name + ' ₹' + p.default_rate).join(' · ')
    )
  );
}

function adminReports(wrap) {
  // Last-7-days aggregate, scoped to this admin's shop
  const from = Domain.weekStart();
  const all = Domain.entriesForAdmin(App.user.id, from);
  const totalPieces = all.reduce((s, e) => s + e.pieces_done, 0);
  const earned = all.reduce((s, e) => {
    const a = Domain.assignmentById(e.assignment_id);
    return s + (a ? e.pieces_done * a.rate : 0);
  }, 0);

  wrap.appendChild(sectionH('Last 7 days'));
  wrap.appendChild(el('div', { class: 'stats' },
    stat('Pieces', totalPieces, 'primary'),
    stat('Production value', fmtINR(earned), 'accent'),
    stat('Active workers', new Set(all.map(e => e.worker_id)).size, 'success'),
    stat('Entries', all.length)
  ));

  // Per-contractor breakdown
  wrap.appendChild(sectionH('By contractor (7 days)'));
  const byContractor = {};
  all.forEach(e => {
    byContractor[e.contractor_id] = (byContractor[e.contractor_id] || 0) + e.pieces_done;
  });
  const rows = Object.entries(byContractor).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) wrap.appendChild(emptyState('📊', 'No production this week'));
  else rows.forEach(([cid, pieces]) => {
    const c = Domain.userById(cid);
    wrap.appendChild(el('div', { class: 'list-item', onclick: () => goDetail('contractor', cid) },
      el('div', { class: 'avatar' }, (c?.name || '?').slice(0,1)),
      el('div', { class: 'meta' },
        el('div', { class: 'name' }, c?.name || 'Unknown'),
        el('div', { class: 'sub' }, pieces + ' pieces this week')
      ),
      el('div', { class: 'end' }, '›')
    ));
  });
}

/* ============================================================
   CONTRACTOR VIEWS
   ============================================================ */
function viewContractor() {
  const wrap = el('div');
  if (App.detail) return renderContractorDetail(wrap);

  const titles = {
    home: 'Contractor · ' + App.user.name,
    lots: 'My Lots',
    workers: 'Workers',
    admins: 'Owners',
    payments: 'Payments'
  };
  wrap.appendChild(topbar('DarziMate', titles[App.tab] || ''));

  if (App.tab === 'home')          contractorHome(wrap);
  else if (App.tab === 'lots')     contractorLots(wrap);
  else if (App.tab === 'workers')  contractorWorkers(wrap);
  else if (App.tab === 'admins')   contractorAdmins(wrap);
  else if (App.tab === 'payments') contractorPayments(wrap);
  return wrap;
}

function contractorAdmins(wrap) {
  const admins = Domain.adminsForContractor(App.user.id);
  if (admins.length === 0) {
    wrap.appendChild(emptyState('🏢', 'No Owners linked. They can find you by your mobile number.'));
    return;
  }
  admins.forEach(a => {
    const lots = Domain.lotsForAdminContractor(a.id, App.user.id);
    const totalQty = lots.reduce((s, l) => s + l.qty, 0);
    const inProgress = lots.filter(l => l.status === 'in_progress' || l.status === 'assigned').length;
    const shop = Domain.shopById(a.shop_id);
    wrap.appendChild(el('div', { class: 'list-item' },
      el('div', { class: 'avatar' }, a.name.slice(0,1)),
      el('div', { class: 'meta' },
        el('div', { class: 'name' }, a.name),
        el('div', { class: 'sub' },
          (shop?.name || 'Shop') + ' · ' + lots.length + ' lots · ' + totalQty + ' pcs · ' + inProgress + ' active'
        )
      )
    ));
  });
}

function renderContractorDetail(wrap) {
  if (App.detail.type === 'lot')    return contractorLotDetail(wrap);
  if (App.detail.type === 'worker') return workerDetailView(wrap, 'contractor');
  return wrap;
}

function contractorHome(wrap) {
  const lots = Domain.lotsForContractor(App.user.id);
  const workers = Domain.workersForContractor(App.user.id);
  const admins = Domain.adminsForContractor(App.user.id);
  const todayEntries = Store.data.production_entries.filter(e => e.contractor_id === App.user.id && e.date === today());
  const piecesToday = todayEntries.reduce((s, e) => s + e.pieces_done, 0);
  const balance = Domain.contractorBalanceToPay(App.user.id);

  wrap.appendChild(el('div', { class: 'stats' },
    stat('My lots', lots.length, 'primary', () => goTab('lots')),
    stat('Workers', workers.length, 'success', () => goTab('workers')),
    stat('Owners', admins.length, 'accent', () => goTab('admins')),
    stat('Pieces today', piecesToday),
    stat('To pay workers', fmtINR(balance), 'accent')
  ));

  wrap.appendChild(sectionH('Quick actions'));
  wrap.appendChild(el('div', { class: 'card' },
    el('div', { class: 'col' },
      el('button', { class: 'btn full',
        onclick: () => openModal(addUserForm({ role: 'worker', parent_user_id: App.user.id })) }, '+ Add worker'),
      el('button', { class: 'btn secondary full',
        onclick: () => {
          if (lots.length === 0) { toast('No lots assigned to you yet', ''); return; }
          openModal(assignWorkerForm(lots[0].id));
        } }, '+ Assign work to worker')
    )
  ));

  if (todayEntries.length > 0) {
    wrap.appendChild(sectionH("Today's entries"));
    todayEntries.slice().reverse().forEach(e => wrap.appendChild(productionEntryItem(e)));
  }
}

function contractorLots(wrap) {
  const lots = Domain.lotsForContractor(App.user.id);
  if (lots.length === 0) {
    wrap.appendChild(emptyState('📦', 'No lots assigned yet — admin needs to assign lots to you'));
    return;
  }
  lots.forEach(l => wrap.appendChild(lotListItem(l)));
}

function contractorLotDetail(wrap) {
  const l = Domain.lotById(App.detail.id);
  if (!l) { wrap.appendChild(emptyState('❓', 'Lot not found', 'Back', goBack)); return wrap; }
  const order = Domain.orderById(l.order_id);
  const design = order ? Domain.designById(order.design_id) : null;
  const prog = Domain.lotProgress(l.id);
  const assigns = Domain.assignmentsForLot(l.id);

  wrap.appendChild(topbar('Lot #' + l.lot_no, (design?.name || '') + ' · ' + l.qty + ' pcs', { back: true }));

  wrap.appendChild(el('div', { class: 'card' },
    el('div', { class: 'row between' },
      el('div', null,
        el('div', { class: 'muted', style: 'font-size:12px' }, 'Progress'),
        el('div', { style: 'font-size:22px;font-weight:800' }, prog.percent + '%'),
        el('div', { class: 'muted' }, prog.done + ' / ' + prog.total + ' pcs assigned')
      ),
      chip(l.status.replace('_', ' '), l.status)
    ),
    progressBar(prog.percent)
  ));

  wrap.appendChild(sectionH('Worker assignments',
    App.user.role !== 'admin'
      ? el('button', { class: 'btn sm', onclick: () => openModal(assignWorkerForm(l.id)) }, '+ Assign')
      : null
  ));
  if (assigns.length === 0) {
    wrap.appendChild(emptyState('👷', 'No work assigned yet',
      App.user.role !== 'admin' ? '+ Assign worker' : null,
      App.user.role !== 'admin' ? () => openModal(assignWorkerForm(l.id)) : null));
  } else {
    assigns.forEach(a => wrap.appendChild(assignmentListItem(a)));
  }
  return wrap;
}

function assignmentListItem(a) {
  const worker = Domain.userById(a.worker_id);
  const pt = Domain.pieceTypeById(a.piece_type_id);
  const done = Domain.assignmentPiecesDone(a.id);
  const earned = Domain.assignmentEarned(a.id);
  const percent = a.qty_assigned > 0 ? Math.round(done * 100 / a.qty_assigned) : 0;

  const item = el('div', { class: 'card' },
    el('div', { class: 'row between' },
      el('div', { style: 'flex:1; min-width:0' },
        el('div', { style: 'font-weight:700' }, (worker?.name || 'Worker') + ' · ' + (pt?.name || 'Piece type')),
        el('div', { class: 'muted', style: 'font-size:13px' },
          done + ' / ' + a.qty_assigned + ' pcs · ₹' + a.rate + '/pc · earned ' + fmtINR(earned)
        )
      ),
      chip(a.status.replace('_', ' '), a.status)
    ),
    progressBar(percent)
  );

  // Add log-production button for worker themselves OR contractor
  if (App.user.role === 'worker' && a.worker_id === App.user.id && a.status !== 'completed') {
    item.appendChild(el('button', {
      class: 'btn sm full mt-12',
      onclick: () => openModal(logProductionForm(a.id))
    }, '+ Log pieces done'));
  } else if (App.user.role === 'contractor' && a.contractor_id === App.user.id) {
    item.appendChild(el('button', {
      class: 'btn sm secondary full mt-12',
      onclick: () => openModal(logProductionForm(a.id, { onBehalfOf: a.worker_id }))
    }, 'Log on behalf of worker'));
  }
  return item;
}

function contractorWorkers(wrap) {
  const ws = Domain.workersForContractor(App.user.id);
  wrap.appendChild(sectionH('Workers',
    el('button', { class: 'btn sm', onclick: () => openModal(addUserForm({ role: 'worker', parent_user_id: App.user.id })) }, '+ Add')
  ));
  if (ws.length === 0) {
    wrap.appendChild(emptyState('👷', 'No workers yet', '+ Add worker',
      () => openModal(addUserForm({ role: 'worker', parent_user_id: App.user.id }))));
    return;
  }
  ws.forEach(w => wrap.appendChild(workerListItem(w, 'contractor')));
}

function workerListItem(w, viewerRole) {
  const earned = Domain.workerEarned(w.id);
  const paid = Domain.workerPaid(w.id);
  const balance = earned - paid;
  return el('div', { class: 'list-item', onclick: () => goDetail('worker', w.id) },
    el('div', { class: 'avatar' }, w.name.slice(0,1)),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, w.name),
      el('div', { class: 'sub' }, 'earned ' + fmtINR(earned) + ' · paid ' + fmtINR(paid) + ' · pending ' + fmtINR(balance))
    ),
    el('div', { class: 'end' }, '›')
  );
}

function contractorPayments(wrap) {
  const myPayments = Domain.paymentsByPayer(App.user.id);
  wrap.appendChild(sectionH('Payments to workers'));
  if (myPayments.length === 0) {
    wrap.appendChild(emptyState('💸', 'No payments recorded yet'));
    return;
  }
  myPayments.forEach(p => wrap.appendChild(paymentListItem(p)));
}

function paymentListItem(p) {
  const payee = Domain.userById(p.payee_id);
  return el('div', { class: 'list-item' },
    el('div', { class: 'avatar' }, '💸'),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, fmtINR(p.amount) + ' → ' + (payee?.name || 'Worker')),
      el('div', { class: 'sub' }, p.type + ' · ' + p.method + ' · ' + fmtRelDate(p.date) + (p.note ? ' · ' + p.note : ''))
    )
  );
}

/* Worker detail (used by both admin and contractor viewers) */
function workerDetailView(wrap, viewerRole) {
  const w = Domain.userById(App.detail.id);
  if (!w) { wrap.appendChild(emptyState('❓', 'Worker not found', 'Back', goBack)); return wrap; }
  const earned = Domain.workerEarned(w.id);
  const paid = Domain.workerPaid(w.id);
  const balance = earned - paid;
  const assigns = Domain.assignmentsForWorker(w.id);
  const recent = Domain.entriesForWorker(w.id, daysAgo(30)).slice(0, 20);

  const action = viewerRole === 'contractor'
    ? el('button', { class: 'icon-btn', title: 'Pay',
        onclick: () => openModal(paymentForm({ payer_id: App.user.id, payee_id: w.id })) }, '💸')
    : null;

  wrap.appendChild(topbar(w.name, w.mobile, { back: true, action }));

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Earned', fmtINR(earned), 'primary'),
    stat('Paid', fmtINR(paid), 'success'),
    stat('Balance', fmtINR(balance), balance > 0 ? 'accent' : ''),
    stat('Assignments', assigns.length)
  ));

  wrap.appendChild(sectionH('Assignments'));
  if (assigns.length === 0) wrap.appendChild(emptyState('📋', 'No assignments yet'));
  else assigns.forEach(a => wrap.appendChild(assignmentListItem(a)));

  wrap.appendChild(sectionH('Recent production (30 days)'));
  if (recent.length === 0) wrap.appendChild(emptyState('✂️', 'No production entries'));
  else recent.forEach(e => wrap.appendChild(productionEntryItem(e)));

  wrap.appendChild(sectionH('Payment history'));
  const pays = Domain.paymentsByPayee(w.id);
  if (pays.length === 0) wrap.appendChild(emptyState('💸', 'No payments yet'));
  else pays.forEach(p => wrap.appendChild(paymentListItem(p)));

  return wrap;
}

function productionEntryItem(e) {
  const a = Domain.assignmentById(e.assignment_id);
  const pt = a ? Domain.pieceTypeById(a.piece_type_id) : null;
  const earned = a ? e.pieces_done * a.rate : 0;
  return el('div', { class: 'list-item' },
    el('div', { class: 'avatar' }, '✂️'),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, e.pieces_done + ' pcs · ' + (pt?.name || 'Piece')),
      el('div', { class: 'sub' }, fmtRelDate(e.date) + ' · earned ' + fmtINR(earned) + (e.notes ? ' · ' + e.notes : ''))
    )
  );
}

/* ============================================================
   WORKER VIEWS
   ============================================================ */
function viewWorker() {
  const wrap = el('div');
  const titles = { home: "Today's work", work: 'My Work', earnings: 'My Earnings' };
  wrap.appendChild(topbar('DarziMate', titles[App.tab] || App.user.name));

  if (App.tab === 'home')          workerHome(wrap);
  else if (App.tab === 'work')     workerWork(wrap);
  else if (App.tab === 'earnings') workerEarnings(wrap);
  return wrap;
}

function workerHome(wrap) {
  const myAssigns = Domain.assignmentsForWorker(App.user.id);
  const activeAssigns = myAssigns.filter(a => a.status !== 'completed' && a.status !== 'cancelled');
  const todayEntries = Domain.entriesForWorker(App.user.id, today(), today());
  const piecesToday = todayEntries.reduce((s, e) => s + e.pieces_done, 0);
  const earnedToday = todayEntries.reduce((s, e) => {
    const a = Domain.assignmentById(e.assignment_id);
    return s + (a ? e.pieces_done * a.rate : 0);
  }, 0);
  const weekEntries = Domain.entriesForWorker(App.user.id, Domain.weekStart());
  const piecesWeek = weekEntries.reduce((s, e) => s + e.pieces_done, 0);
  const earned = Domain.workerEarned(App.user.id);
  const paid = Domain.workerPaid(App.user.id);
  const balance = earned - paid;

  wrap.appendChild(el('button', {
    class: 'big-tap',
    onclick: () => {
      if (activeAssigns.length === 0) {
        toast('No active work assigned. Ask your contractor.', '');
        return;
      }
      openModal(logProductionForm(null, { workerId: App.user.id, defaultAssignmentId: activeAssigns[0].id }));
    }
  }, '+ Pieces done today'));

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Today', piecesToday + ' pcs', 'primary'),
    stat('Earned today', fmtINR(earnedToday), 'accent'),
    stat('This week', piecesWeek + ' pcs', 'success'),
    stat('Balance to receive', fmtINR(balance), balance > 0 ? 'accent' : '')
  ));

  if (todayEntries.length > 0) {
    wrap.appendChild(sectionH("Today's entries"));
    todayEntries.slice().reverse().forEach(e => wrap.appendChild(productionEntryItem(e)));
  }

  if (activeAssigns.length > 0) {
    wrap.appendChild(sectionH('Active work'));
    activeAssigns.forEach(a => wrap.appendChild(assignmentListItem(a)));
  }
}

function workerWork(wrap) {
  const myAssigns = Domain.assignmentsForWorker(App.user.id);
  if (myAssigns.length === 0) {
    wrap.appendChild(emptyState('📋', 'No work assigned yet'));
    return;
  }
  myAssigns.forEach(a => wrap.appendChild(assignmentListItem(a)));
}

function workerEarnings(wrap) {
  const earned = Domain.workerEarned(App.user.id);
  const paid = Domain.workerPaid(App.user.id);
  const balance = earned - paid;
  const weekEntries = Domain.entriesForWorker(App.user.id, Domain.weekStart());
  const weekEarned = weekEntries.reduce((s, e) => {
    const a = Domain.assignmentById(e.assignment_id);
    return s + (a ? e.pieces_done * a.rate : 0);
  }, 0);

  wrap.appendChild(el('div', { class: 'stats' },
    stat('Total earned', fmtINR(earned), 'primary'),
    stat('Paid', fmtINR(paid), 'success'),
    stat('Balance', fmtINR(balance), balance > 0 ? 'accent' : ''),
    stat('This week', fmtINR(weekEarned))
  ));

  wrap.appendChild(sectionH('Recent production (30 days)'));
  const recent = Domain.entriesForWorker(App.user.id, daysAgo(30)).slice(0, 30);
  if (recent.length === 0) wrap.appendChild(emptyState('✂️', 'No production entries yet'));
  else recent.forEach(e => wrap.appendChild(productionEntryItem(e)));

  wrap.appendChild(sectionH('Payments received'));
  const pays = Domain.paymentsByPayee(App.user.id);
  if (pays.length === 0) wrap.appendChild(emptyState('💸', 'No payments yet'));
  else pays.forEach(p => wrap.appendChild(paymentListItem(p)));
}

/* ============================================================
   MODALS / FORMS
   ============================================================ */

function modalShell(title, children) {
  const wrap = el('div');
  wrap.appendChild(el('h2', null, title));
  children.forEach(c => {
    if (c == null || c === false) return;
    wrap.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return wrap;
}

function field(label, input, hint) {
  return el('div', { class: 'field' },
    el('label', null, label),
    input,
    hint ? el('div', { class: 'hint' }, hint) : null
  );
}

function input(name, opts = {}) {
  return el('input', Object.assign({ name, type: 'text' }, opts));
}

function selectField(name, options, opts = {}) {
  const sel = el('select', Object.assign({ name }, opts));
  options.forEach(o => sel.appendChild(el('option', { value: o.value, selected: o.selected ? true : null }, o.label)));
  return sel;
}

function submitButtons(submitLabel = 'Save') {
  return el('div', { class: 'row gap-12 mt-12' },
    el('button', { type: 'button', class: 'btn secondary', 'data-close': true, style: 'flex:1' }, 'Cancel'),
    el('button', { type: 'submit', class: 'btn', style: 'flex:2' }, submitLabel)
  );
}

/* — Add design — */
function addDesignForm() {
  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const piece_types = [];
      for (let i = 0; i < 5; i++) {
        const n = fd.get('pt_name_' + i);
        const r = fd.get('pt_rate_' + i);
        if (n) piece_types.push({ name: n, rate: r });
      }
      try {
        Domain.addDesign({
          name: fd.get('name'), sku: fd.get('sku'),
          default_rate: fd.get('default_rate'), piece_types
        });
        toast('Design added', 'success');
        closeModal(); render();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
  const ptRows = [];
  for (let i = 0; i < 5; i++) {
    ptRows.push(el('div', { class: 'row gap-12' },
      input('pt_name_' + i, { placeholder: i === 0 ? 'e.g. Cutting' : 'Piece type', style: 'flex:2' }),
      input('pt_rate_' + i, { type: 'number', placeholder: 'Rate ₹', step: '0.5', min: '0', style: 'flex:1' })
    ));
  }
  form.appendChild(modalShell('Add design', [
    field('Design name', input('name', { required: true, placeholder: 'e.g. Formal Shirt' })),
    field('SKU (optional)', input('sku', { placeholder: 'e.g. SH-001' })),
    field('All-in rate (optional)', input('default_rate', { type: 'number', placeholder: 'auto from piece-types', step: '0.5', min: '0' })),
    el('div', { style: 'font-weight:600;margin:8px 0 4px' }, 'Piece-type rates (per piece)'),
    ...ptRows,
    submitButtons('Save design')
  ]));
  return form;
}

/* — Admin: add or link contractor — */
function addContractorForAdminForm() {
  const available = Domain.contractorsAvailableToLink(App.user.id);

  const wrap = el('div');
  wrap.appendChild(el('h2', null, 'Add contractor'));

  // Tab toggle: "Link existing" vs "Create new"
  let mode = available.length > 0 ? 'link' : 'new';
  const tabs = el('div', { class: 'row gap-12 mb-12', style: 'border-bottom:1px solid var(--c-border);padding-bottom:8px' });
  const tabLink = el('button', {
    type: 'button', class: 'btn ghost sm', onclick: () => { mode = 'link'; render(); }
  }, 'Link existing');
  const tabNew = el('button', {
    type: 'button', class: 'btn ghost sm', onclick: () => { mode = 'new'; render(); }
  }, 'Create new');
  tabs.appendChild(tabLink); tabs.appendChild(tabNew);
  wrap.appendChild(tabs);

  const content = el('div');
  wrap.appendChild(content);

  function render() {
    content.innerHTML = '';
    tabLink.className = 'btn sm ' + (mode === 'link' ? '' : 'ghost');
    tabNew.className = 'btn sm ' + (mode === 'new' ? '' : 'ghost');

    if (mode === 'link') {
      content.appendChild(el('div', { class: 'muted', style: 'margin-bottom:8px' },
        'Pick a contractor already in the system, or enter their mobile.'));
      if (available.length > 0) {
        content.appendChild(el('div', { style: 'margin-bottom:8px' },
          ...available.map(c => el('div', { class: 'list-item', onclick: () => {
            try {
              Domain.linkAdminContractor(App.user.id, c.id);
              toast('Linked ' + c.name, 'success');
              closeModal(); window.DarziMate.render();
            } catch (e) { toast(e.message, 'error'); }
          }},
            el('div', { class: 'avatar' }, c.name.slice(0,1)),
            el('div', { class: 'meta' },
              el('div', { class: 'name' }, c.name),
              el('div', { class: 'sub' }, c.mobile)
            ),
            el('div', { class: 'end' }, '+ Link')
          ))
        ));
      }
      // Or by mobile
      const f = el('form', {
        onsubmit: (e) => {
          e.preventDefault();
          const m = f.querySelector('input[name=mobile]').value.trim();
          try {
            const c = Domain.linkContractorByMobile(App.user.id, m);
            toast('Linked ' + c.name, 'success');
            closeModal(); window.DarziMate.render();
          } catch (err) { toast(err.message, 'error'); }
        }
      });
      f.appendChild(el('div', { style: 'font-weight:600;margin:8px 0 4px' }, 'Or by mobile'));
      f.appendChild(field('Contractor mobile', input('mobile', { type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: '10-digit' })));
      f.appendChild(el('button', { type: 'submit', class: 'btn full' }, 'Link by mobile'));
      content.appendChild(f);
    } else {
      const f = el('form', {
        onsubmit: async (e) => {
          e.preventDefault();
          const fd = new FormData(f);
          try {
            await Domain.addContractorForAdmin({
              name: fd.get('name'), mobile: fd.get('mobile'),
              password: fd.get('password') || '1234',
              adminId: App.user.id, notes: fd.get('notes')
            });
            toast('Contractor created and linked', 'success');
            closeModal(); window.DarziMate.render();
          } catch (err) { toast(err.message, 'error'); }
        }
      });
      f.appendChild(field('Name', input('name', { required: true, placeholder: 'Full name' })));
      f.appendChild(field('Mobile', input('mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: '10-digit' })));
      f.appendChild(field('Password', input('password', { type: 'text', value: '1234' }),
        'They use this to log in.'));
      f.appendChild(field('Note (optional)', el('textarea', { name: 'notes', rows: 2 })));
      f.appendChild(submitButtons('Create + link'));
      content.appendChild(f);
    }
  }
  render();
  return wrap;
}

/* — Add user (contractor or worker) — */
function addUserForm({ role, parent_user_id }) {
  const form = el('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        await Domain.addUser({
          name: fd.get('name'), mobile: fd.get('mobile'), role,
          parent_user_id: parent_user_id || null,
          password: fd.get('password') || '1234'
        });
        toast(role === 'contractor' ? 'Contractor added' : 'Worker added', 'success');
        closeModal(); render();
      } catch (err) { toast(err.message, 'error'); }
    }
  });
  form.appendChild(modalShell('Add ' + role, [
    field('Name', input('name', { required: true, placeholder: 'Full name' })),
    field('Mobile', input('mobile', { required: true, type: 'tel', maxlength: 10, inputmode: 'numeric', placeholder: '10-digit' })),
    field('Password', input('password', { type: 'text', placeholder: 'default 1234', value: '1234' }),
      'They use this to log in. They can change it later.'),
    submitButtons('Add ' + role)
  ]));
  return form;
}

/* — Add bulk order — */
function addOrderForm() {
  const designs = Domain.designs();
  if (designs.length === 0) {
    return modalShell('Add an order', [
      el('div', { class: 'muted' }, 'Add a design first.'),
      el('button', { class: 'btn full mt-12', onclick: () => { closeModal(); openModal(addDesignForm()); } }, '+ Add design')
    ]);
  }
  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const order = Domain.addOrder({
        design_id: fd.get('design_id'),
        total_qty: fd.get('total_qty'),
        deadline: fd.get('deadline') || null,
        notes: fd.get('notes')
      });
      toast('Order created — split into lots next', 'success');
      closeModal();
      goDetail('order', order.id);
    }
  });
  form.appendChild(modalShell('New bulk order', [
    field('Design', selectField('design_id', designs.map(d => ({ value: d.id, label: d.name })), { required: true })),
    field('Total quantity', input('total_qty', { type: 'number', required: true, min: 1, placeholder: 'e.g. 1000' })),
    field('Deadline', input('deadline', { type: 'date' })),
    field('Notes', el('textarea', { name: 'notes', rows: 2, placeholder: 'Wholesale customer, fabric ready, etc.' })),
    submitButtons('Create order')
  ]));
  return form;
}

/* — Split order into lots — */
function splitOrderForm(orderId) {
  const order = Domain.orderById(orderId);
  const existing = Domain.lotsForOrder(orderId);
  const used = existing.reduce((s, l) => s + l.qty, 0);
  const remaining = order.total_qty - used;

  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const count = Number(fd.get('count'));
      const qty = Number(fd.get('qty'));
      if (count * qty > remaining) { toast('Exceeds remaining quantity', 'error'); return; }
      Domain.splitOrderIntoLots(orderId, count, qty);
      toast(count + ' lots created', 'success');
      closeModal(); render();
    }
  });
  form.appendChild(modalShell('Split into lots', [
    el('div', { class: 'muted', style: 'margin-bottom:8px' },
      'Total ' + order.total_qty + ' · already in lots: ' + used + ' · remaining: ' + remaining),
    field('Number of lots', input('count', { type: 'number', required: true, min: 1, value: 1 })),
    field('Pieces per lot', input('qty', { type: 'number', required: true, min: 1, value: Math.min(100, remaining) })),
    submitButtons('Create lots')
  ]));

  // Add per-lot contractor assignment for existing unassigned lots
  if (existing.some(l => !l.contractor_id)) {
    form.appendChild(el('div', { style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--c-border)' },
      el('div', { style: 'font-weight:600;margin-bottom:8px' }, 'Assign existing lots to contractors'),
      ...existing.filter(l => !l.contractor_id).map(l => assignLotInline(l))
    ));
  }
  return form;
}

function assignLotInline(lot) {
  // Only show contractors linked to the current admin
  const contractors = Domain.contractorsForAdmin(App.user.id);
  const sel = selectField('lot_' + lot.id, [{ value: '', label: '— pick contractor —' }]
    .concat(contractors.map(c => ({ value: c.id, label: c.name }))));
  sel.addEventListener('change', () => {
    if (sel.value) {
      Domain.assignLotToContractor(lot.id, sel.value);
      toast('Lot ' + lot.lot_no + ' assigned', 'success');
      closeModal(); render();
    }
  });
  return el('div', { class: 'row gap-12 mb-12' },
    el('div', { style: 'flex:1' }, 'Lot #' + lot.lot_no + ' (' + lot.qty + ')'),
    el('div', { style: 'flex:2' }, sel)
  );
}

/* — Assign work to a worker — */
function assignWorkerForm(lotId) {
  const lot = Domain.lotById(lotId);
  const order = Domain.orderById(lot.order_id);
  const design = Domain.designById(order.design_id);
  const pieceTypes = Domain.pieceTypesForDesign(design.id);
  const workers = App.user.role === 'contractor'
    ? Domain.workersForContractor(App.user.id)
    : Domain.workers();

  if (workers.length === 0) {
    return modalShell('Assign work', [
      el('div', { class: 'muted' }, 'You need to add a worker first.'),
      el('button', {
        class: 'btn full mt-12',
        onclick: () => {
          closeModal();
          openModal(addUserForm({ role: 'worker', parent_user_id: App.user.id }));
        }
      }, '+ Add worker')
    ]);
  }
  if (pieceTypes.length === 0) {
    return modalShell('Assign work', [
      el('div', { class: 'muted' }, 'This design has no piece types defined.')
    ]);
  }

  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const pt = Domain.pieceTypeById(fd.get('piece_type_id'));
      Domain.addAssignment({
        lot_id: lotId,
        worker_id: fd.get('worker_id'),
        contractor_id: lot.contractor_id || App.user.id,
        piece_type_id: fd.get('piece_type_id'),
        qty_assigned: fd.get('qty_assigned'),
        rate: fd.get('rate') || pt.default_rate
      });
      toast('Work assigned', 'success');
      closeModal(); render();
    }
  });

  // Update rate when piece type changes
  const ptSelect = selectField('piece_type_id',
    pieceTypes.map(p => ({ value: p.id, label: p.name + ' (₹' + p.default_rate + ')' })),
    { required: true });

  const rateInput = input('rate', { type: 'number', step: '0.5', min: '0', value: pieceTypes[0].default_rate });
  ptSelect.addEventListener('change', () => {
    const pt = Domain.pieceTypeById(ptSelect.value);
    if (pt) rateInput.value = pt.default_rate;
  });

  form.appendChild(modalShell('Assign work · Lot #' + lot.lot_no, [
    el('div', { class: 'muted', style: 'margin-bottom:8px' }, design.name + ' · ' + lot.qty + ' pcs in this lot'),
    field('Worker', selectField('worker_id', workers.map(w => ({ value: w.id, label: w.name })), { required: true })),
    field('Piece type', ptSelect),
    field('Quantity', input('qty_assigned', { type: 'number', required: true, min: 1, value: lot.qty })),
    field('Rate per piece (₹)', rateInput),
    submitButtons('Assign')
  ]));
  return form;
}

/* — Log production (daily entry) — */
function logProductionForm(assignmentId, opts = {}) {
  const myAssigns = opts.workerId
    ? Domain.assignmentsForWorker(opts.workerId).filter(a => a.status !== 'completed' && a.status !== 'cancelled')
    : null;

  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      try {
        Domain.addProductionEntry({
          assignment_id: assignmentId || fd.get('assignment_id'),
          pieces_done: fd.get('pieces_done'),
          date: fd.get('date'),
          notes: fd.get('notes')
        });
        toast('Production logged', 'success');
        closeModal(); render();
      } catch (err) { toast(err.message, 'error'); }
    }
  });

  let assignmentField = null;
  if (!assignmentId && myAssigns && myAssigns.length > 0) {
    assignmentField = field('Which work?', selectField('assignment_id',
      myAssigns.map(a => {
        const pt = Domain.pieceTypeById(a.piece_type_id);
        const lot = Domain.lotById(a.lot_id);
        return { value: a.id, label: (pt?.name || '?') + ' · Lot #' + (lot?.lot_no || '?') + ' · ' + a.qty_assigned + ' pcs',
          selected: a.id === opts.defaultAssignmentId };
      }),
      { required: true }
    ));
  }

  let context = null;
  if (assignmentId) {
    const a = Domain.assignmentById(assignmentId);
    const pt = Domain.pieceTypeById(a.piece_type_id);
    const lot = Domain.lotById(a.lot_id);
    const done = Domain.assignmentPiecesDone(assignmentId);
    context = el('div', { class: 'muted', style: 'margin-bottom:8px' },
      (pt?.name || '?') + ' · Lot #' + (lot?.lot_no || '?') + ' · ' +
      done + ' / ' + a.qty_assigned + ' done · ₹' + a.rate + '/pc');
  }

  form.appendChild(modalShell('Log production', [
    context,
    assignmentField,
    field('Pieces done', input('pieces_done', { type: 'number', required: true, min: 1, placeholder: 'How many today' })),
    field('Date', input('date', { type: 'date', value: today() })),
    field('Notes (optional)', el('textarea', { name: 'notes', rows: 2 })),
    submitButtons('Log pieces')
  ]));
  return form;
}

/* — Pay worker — */
function paymentForm({ payer_id, payee_id }) {
  const payee = Domain.userById(payee_id);
  const balance = Domain.workerBalance(payee_id);

  const form = el('form', {
    onsubmit: (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      Domain.addPayment({
        payer_id, payee_id,
        amount: fd.get('amount'),
        type: fd.get('type'),
        method: fd.get('method'),
        date: fd.get('date'),
        note: fd.get('note')
      });
      toast('Payment recorded', 'success');
      closeModal(); render();
    }
  });
  form.appendChild(modalShell('Pay ' + (payee?.name || 'worker'), [
    el('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Pending balance: ' + fmtINR(balance)),
    field('Amount (₹)', input('amount', { type: 'number', required: true, min: 1, step: '1',
      value: Math.max(0, Math.round(balance)) })),
    field('Type', selectField('type', [
      { value: 'settlement', label: 'Settlement (against work done)' },
      { value: 'advance', label: 'Advance' },
      { value: 'bonus', label: 'Bonus' },
      { value: 'adjustment', label: 'Adjustment' }
    ], { required: true })),
    field('Method', selectField('method', [
      { value: 'cash', label: 'Cash' },
      { value: 'upi', label: 'UPI' },
      { value: 'bank', label: 'Bank transfer' },
      { value: 'other', label: 'Other' }
    ])),
    field('Date', input('date', { type: 'date', value: today() })),
    field('Note', el('textarea', { name: 'note', rows: 2, placeholder: 'Optional' })),
    submitButtons('Record payment')
  ]));
  return form;
}

/* helpers */
function chipText(s) { return (s || '').replace('_', ' '); }

/* ─── Settings modal ──────────────────────────────────────── */
function settingsModal() {
  const wrap = el('div');
  wrap.appendChild(el('h2', null, 'Settings'));

  const u = App.user;
  if (!u) {
    wrap.appendChild(el('div', { class: 'muted' }, 'Sign in first.'));
    return wrap;
  }

  // ── Profile ──
  const fileInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const photo = await resizeImage(file, 256);
      const me = Domain.userById(u.id);
      if (me) me.photo = photo;
      App.user.photo = photo;
      Store.save();
      // Also push immediately so the new photo lands across devices fast
      if (sb) {
        try { await sb.from('users').update({ photo }).eq('id', u.id); } catch {}
      }
      toast('Photo updated', 'success');
      // Re-open to show it
      closeModal();
      openModal(settingsModal());
    } catch (err) {
      toast(err.message || 'Could not save photo', 'error');
    }
  });

  const photoEl = el('div', {
    class: 'avatar' + (u.photo ? ' has-photo' : ''),
    style: 'width:80px;height:80px;font-size:34px;cursor:pointer;flex-shrink:0' +
           (u.photo ? `;background-image:url(${u.photo})` : ''),
    onclick: () => fileInput.click()
  }, u.photo ? '' : (u.name?.[0] || '?').toUpperCase());

  const profileCard = el('div', { class: 'card' },
    el('div', { class: 'muted', style: 'font-size:12px;letter-spacing:.04em;margin-bottom:8px' }, 'PROFILE'),
    el('div', { class: 'row gap-12', style: 'align-items:center' },
      photoEl,
      el('div', { style: 'flex:1;min-width:0' },
        el('div', { style: 'font-weight:700;font-size:16px' }, u.name || '—'),
        el('div', { class: 'muted' }, u.mobile || ''),
        el('div', { class: 'muted', style: 'font-size:12px' }, 'Role: ' + (u.role || 'user').replace('_', ' ')),
        el('button', {
          class: 'btn ghost sm', style: 'padding:4px 0',
          onclick: () => fileInput.click()
        }, '📷  Change photo')
      )
    ),
    fileInput
  );
  wrap.appendChild(profileCard);

  // ── Theme picker ──
  const current = getTheme();
  const themeCard = el('div', { class: 'card' },
    el('div', { class: 'muted', style: 'font-size:12px;letter-spacing:.04em;margin-bottom:8px' }, 'THEME'),
    el('div', { class: 'col' },
      ...THEMES.map(t => el('button', {
        type: 'button',
        class: 'list-item' + (current === t.key ? '' : ''),
        style: 'cursor:pointer' + (current === t.key ? ';border-color:var(--c-primary);background:var(--c-primary-50)' : ''),
        onclick: () => {
          applyTheme(t.key);
          closeModal();
          openModal(settingsModal());
          toast('Theme: ' + t.label, 'success');
        }
      },
        el('div', {
          class: 'avatar',
          style: 'background:' + t.preview + ';color:#fff'
        }, current === t.key ? '✓' : ''),
        el('div', { class: 'meta' },
          el('div', { class: 'name' }, t.label)
        )
      ))
    )
  );
  wrap.appendChild(themeCard);

  // ── Sign out ──
  wrap.appendChild(el('button', {
    class: 'btn full danger mt-12',
    onclick: async () => {
      if (!confirm('Sign out?')) return;
      await Auth.signOut();
      App.user = null; App.route = 'login'; App.detail = null;
      closeModal();
      render();
    }
  }, 'Sign out'));

  // ── About ──
  wrap.appendChild(el('div', { class: 'muted', style: 'text-align:center;font-size:12px;margin-top:16px' },
    'DarziMate · v1'));
  return wrap;
}

/* ─── Pull-to-refresh ─────────────────────────────────────── */
function setupPullToRefresh() {
  const THRESHOLD = 90;        // px of effective pull to trigger refresh
  const MAX = 140;             // max pull distance shown
  const REST_Y = 56;           // px below top edge when at rest (= ready spot)
  let startY = 0, currentY = 0, pulling = false, refreshing = false, ready = false;

  const indicator = el('div', { class: 'ptr-indicator', id: 'ptrIndicator' },
    el('span', { class: 'arrow' }, '↓')
  );
  document.body.appendChild(indicator);

  function setPull(y) {
    const clamped = Math.min(Math.max(y, 0), MAX);
    // Slide the indicator down from -60 (hidden) to REST_Y (anchored)
    const ty = -60 + Math.min(clamped, REST_Y + 16);
    indicator.style.transform = `translateX(-50%) translateY(${ty}px)`;
    indicator.style.opacity = clamped > 8 ? '1' : '0';
    const wasReady = ready;
    ready = clamped >= THRESHOLD;
    if (ready !== wasReady) indicator.classList.toggle('ready', ready);
  }

  function reset() {
    indicator.style.transition = 'transform 0.22s ease, opacity 0.22s ease';
    indicator.style.transform = 'translateX(-50%) translateY(-60px)';
    indicator.style.opacity = '0';
    indicator.classList.remove('ready', 'spinning');
    ready = false;
    setTimeout(() => { indicator.style.transition = ''; }, 260);
  }

  document.addEventListener('touchstart', (e) => {
    if (refreshing) return;
    if (window.scrollY > 0) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    pulling = true;
    indicator.style.transition = '';
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling || refreshing) return;
    currentY = e.touches[0].clientY;
    const dy = currentY - startY;
    if (dy <= 0) { pulling = false; setPull(0); return; }
    // Rubber-band damping so it feels heavier the further you pull
    setPull(dy * 0.55);
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!pulling || refreshing) { pulling = false; return; }
    pulling = false;
    const dy = (currentY - startY) * 0.55;
    if (dy >= THRESHOLD) {
      refreshing = true;
      indicator.classList.add('spinning');
      indicator.classList.remove('ready');
      indicator.style.transition = 'transform 0.22s ease';
      indicator.style.transform = `translateX(-50%) translateY(${-60 + REST_Y}px)`;
      indicator.style.opacity = '1';
      try { await refreshApp(); } finally {
        setTimeout(() => { refreshing = false; reset(); }, 350);
      }
    } else {
      reset();
    }
  });
}

/* ─── Bootstrap ───────────────────────────────────────────── */
async function bootstrap() {
  applyTheme(getTheme());
  setupPullToRefresh();
  await Store.load();   // cache → remote (if session)

  // If Supabase is configured and there's a stale local session without a
  // matching Supabase Auth session, clear it (e.g. coming from old demo mode).
  if (REMOTE_ENABLED && Store.data.session) {
    try {
      const { data: sess } = await sb.auth.getSession();
      if (!sess?.session) {
        Store.data = seed();
        Store.saveCache();
      }
    } catch {}
  }

  App.user = Auth.current();
  App.route = App.user ? App.user.role : 'login';
  App.tab = 'home';
  App.detail = null;
  render();
  if (App.user) Store.subscribeRealtime();
}
document.addEventListener('DOMContentLoaded', bootstrap);

window.DarziMate = { Store, Auth, Domain, App, navigate, render, goTab, goDetail, goBack,
  openModal, closeModal, logProductionForm, addOrderForm, addDesignForm, addUserForm,
  splitOrderForm, assignWorkerForm, paymentForm };

})();
