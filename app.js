/* ====================================================================
   KarkhanaPro — Tailoring Production Manager
   Phase 1: foundation (Store, Auth, router, login, role dashboards).
   Storage: Supabase if supabase-config.js is filled in; otherwise
            localStorage-only demo mode with seeded users.
   ==================================================================== */

(() => {
'use strict';

/* ─── Supabase client (optional) ──────────────────────────── */
const cfg = window.KARKHANA_SUPABASE || { URL: '', KEY: '' };
let sb = null;
const REMOTE_ENABLED = !!(cfg.URL && cfg.KEY && window.supabase && window.supabase.createClient);
if (REMOTE_ENABLED) {
  try {
    sb = window.supabase.createClient(cfg.URL, cfg.KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
      realtime: { params: { eventsPerSecond: 5 } }
    });
  } catch (e) { console.warn('Supabase init failed', e); }
}

/* ─── Tiny utilities ──────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = (prefix = 'id') => prefix + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
const fmtINR = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Build a DOM element from {tag, attrs, children}
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

// Lightweight password hash (NOT cryptographically secure, fine for demo).
// For production with Supabase, switch to Supabase Auth.
async function hashPassword(pw) {
  const enc = new TextEncoder().encode('karkhana-v1::' + pw);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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

function openModal(content, opts = {}) {
  const modal = $('#modal');
  const body = $('#modalBody');
  body.innerHTML = '';
  body.appendChild(typeof content === 'string' ? el('div', { html: content }) : content);
  modal.hidden = false;
  if (opts.onOpen) opts.onOpen(body);
}
function closeModal() { $('#modal').hidden = true; $('#modalBody').innerHTML = ''; }
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-close]') || e.target.closest('[data-close]')) closeModal();
});

/* ─── Store: localStorage cache + (optional) Supabase ─────── */
const Store = {
  KEY: 'karkhanapro-v1',
  data: null,
  remoteReady: false,

  loadFromCache() {
    try {
      const raw = localStorage.getItem(this.KEY);
      this.data = raw ? JSON.parse(raw) : null;
    } catch { this.data = null; }
    if (!this.data) this.data = seed();
  },

  saveCache() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.data)); } catch {}
  },

  // Supabase load — wired up here, no-op until tables + RLS are in place
  // and a Supabase Auth session exists. Phase 2+ will use this fully.
  async loadFromRemote() {
    if (!sb) return false;
    try {
      const { data: session } = await sb.auth.getSession();
      if (!session?.session) return false;
      // Phase 2 will fill these in.
      this.remoteReady = true;
      return true;
    } catch (e) {
      console.warn('Remote load failed', e);
      return false;
    }
  },

  async load() {
    this.loadFromCache();
    if (REMOTE_ENABLED) await this.loadFromRemote();
  },

  save() {
    this.saveCache();
    // Remote save scheduled in Phase 2 (per-table upserts based on diff).
  }
};

/* ─── Seed data (demo mode) ───────────────────────────────── */
function seed() {
  const shopId  = 'shop_demo';
  const adminId = 'u_admin';
  const conId   = 'u_contractor1';
  const workerId = 'u_worker1';

  return {
    session: null, // { userId, role, shopId }
    shop: {
      id: shopId,
      name: 'Demo Karkhana',
      owner_user_id: adminId,
      address: '',
      phone: '',
      upi_id: '',
      upi_name: ''
    },
    users: [
      { id: adminId, shop_id: shopId, mobile: '9999999999', name: 'Bada Seth (Admin)',
        role: 'admin', password_hash: null, parent_user_id: null, photo: null, status: 'active' },
      { id: conId, shop_id: shopId, mobile: '8888888888', name: 'Chhota Seth (Contractor)',
        role: 'contractor', password_hash: null, parent_user_id: adminId, photo: null, status: 'active' },
      { id: workerId, shop_id: shopId, mobile: '7777777777', name: 'Darzi Ramesh (Worker)',
        role: 'worker', password_hash: null, parent_user_id: conId, photo: null, status: 'active' }
    ],
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

/* ─── Auth ────────────────────────────────────────────────── */
const Auth = {
  // Bootstrap demo passwords on first run: every seeded user starts with password "1234".
  async ensureSeedPasswords() {
    let touched = false;
    for (const u of Store.data.users) {
      if (!u.password_hash) {
        u.password_hash = await hashPassword('1234');
        touched = true;
      }
    }
    if (touched) Store.save();
  },

  current() {
    const s = Store.data && Store.data.session;
    if (!s) return null;
    return Store.data.users.find(u => u.id === s.userId) || null;
  },

  async login(mobile, password) {
    const m = String(mobile || '').trim();
    const u = Store.data.users.find(x => x.mobile === m && x.status !== 'disabled');
    if (!u) throw new Error('User not found');
    const h = await hashPassword(password);
    if (h !== u.password_hash) throw new Error('Wrong password');
    Store.data.session = { userId: u.id, role: u.role, shopId: u.shop_id };
    Store.save();
    return u;
  },

  logout() {
    Store.data.session = null;
    Store.save();
  }
};

/* ─── App state + router ──────────────────────────────────── */
const App = {
  route: null,         // 'login' | 'admin' | 'contractor' | 'worker'
  user: null,
  tab: 'home'          // current tab within a role dashboard
};

function navigate(route, opts = {}) {
  App.route = route;
  if (opts.tab) App.tab = opts.tab;
  render();
}

function render() {
  const view = $('#view');
  const tabbar = $('#tabbar');
  view.innerHTML = '';
  tabbar.innerHTML = '';

  if (!App.user) {
    document.getElementById('app').classList.add('no-tab');
    tabbar.hidden = true;
    view.appendChild(viewLogin());
    return;
  }

  document.getElementById('app').classList.remove('no-tab');

  if (App.user.role === 'admin')      view.appendChild(viewAdmin());
  else if (App.user.role === 'contractor') view.appendChild(viewContractor());
  else if (App.user.role === 'worker')      view.appendChild(viewWorker());
  else view.appendChild(el('div', { class: 'empty' }, 'Unknown role.'));

  // Build tabbar for the role
  const tabs = roleTabs(App.user.role);
  if (tabs.length > 1) {
    tabbar.hidden = false;
    for (const t of tabs) {
      tabbar.appendChild(el('button', {
        class: 'tab' + (App.tab === t.key ? ' active' : ''),
        onclick: () => { App.tab = t.key; render(); }
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
  if (role === 'admin') return [
    { key: 'home',        ico: '🏠', label: 'Home' },
    { key: 'orders',      ico: '📋', label: 'Orders' },
    { key: 'contractors', ico: '👥', label: 'Contractors' },
    { key: 'designs',     ico: '🎨', label: 'Designs' },
    { key: 'reports',     ico: '📊', label: 'Reports' }
  ];
  if (role === 'contractor') return [
    { key: 'home',     ico: '🏠', label: 'Home' },
    { key: 'lots',     ico: '📦', label: 'My Lots' },
    { key: 'workers',  ico: '👷', label: 'Workers' },
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
    el('h1', null, 'KarkhanaPro'),
    el('div', { class: 'tagline' }, 'Tailoring production manager')
  ));

  const form = el('form', {
    class: 'card',
    onsubmit: async (e) => {
      e.preventDefault();
      const mobile = form.querySelector('[name=mobile]').value.trim();
      const password = form.querySelector('[name=password]').value;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const u = await Auth.login(mobile, password);
        App.user = u;
        App.route = u.role;
        App.tab = 'home';
        toast('Welcome, ' + u.name, 'success');
        render();
      } catch (err) {
        toast(err.message || 'Login failed', 'error');
        btn.disabled = false;
        btn.textContent = 'Sign in';
      }
    }
  });

  form.appendChild(el('div', { class: 'field' },
    el('label', null, 'Mobile number'),
    el('input', { type: 'tel', name: 'mobile', required: true, autocomplete: 'tel',
      placeholder: '10-digit mobile', maxlength: 10, inputmode: 'numeric' })
  ));
  form.appendChild(el('div', { class: 'field' },
    el('label', null, 'Password'),
    el('input', { type: 'password', name: 'password', required: true, placeholder: 'Password' })
  ));
  form.appendChild(el('button', { type: 'submit', class: 'btn full lg' }, 'Sign in'));

  wrap.appendChild(form);

  // Demo helper
  wrap.appendChild(el('div', { class: 'card' },
    el('div', { class: 'muted', style: 'margin-bottom:8px' }, 'Demo accounts (password: 1234)'),
    demoUserRow('admin',      '9999999999', 'Bada Seth (Admin)'),
    demoUserRow('contractor', '8888888888', 'Chhota Seth (Contractor)'),
    demoUserRow('worker',     '7777777777', 'Darzi Ramesh (Worker)')
  ));

  return wrap;
}

function demoUserRow(role, mobile, name) {
  return el('div', { class: 'list-item', onclick: async () => {
    try {
      const u = await Auth.login(mobile, '1234');
      App.user = u; App.route = u.role; App.tab = 'home';
      toast('Welcome, ' + u.name, 'success');
      render();
    } catch (e) { toast(e.message, 'error'); }
  } },
    el('div', { class: 'avatar' }, name.slice(0, 1)),
    el('div', { class: 'meta' },
      el('div', { class: 'name' }, name),
      el('div', { class: 'sub' }, mobile)
    ),
    el('span', { class: 'role-pill ' + role }, role)
  );
}

/* ─── Topbar helper ───────────────────────────────────────── */
function topbar(title, subtitle) {
  return el('div', { class: 'topbar' },
    el('div', { style: 'flex:1' },
      el('h2', null, title),
      subtitle ? el('div', { class: 'sub' }, subtitle) : null
    ),
    el('button', {
      class: 'icon-btn', title: 'Logout', 'aria-label': 'Logout',
      onclick: () => {
        if (!confirm('Sign out?')) return;
        Auth.logout();
        App.user = null;
        App.route = 'login';
        render();
      }
    }, '⎋')
  );
}

/* ─── Admin dashboard ─────────────────────────────────────── */
function viewAdmin() {
  const wrap = el('div');
  wrap.appendChild(topbar('KarkhanaPro', 'Bada Seth · ' + Store.data.shop.name));

  if (App.tab === 'home') {
    const orders = Store.data.orders;
    const lots = Store.data.lots;
    const totalPieces = lots.reduce((s, l) => s + l.qty, 0);
    const contractors = Store.data.users.filter(u => u.role === 'contractor');
    const workers = Store.data.users.filter(u => u.role === 'worker');
    const totalPaid = Store.data.payments
      .filter(p => p.type === 'settlement' || p.type === 'advance' || p.type === 'bonus')
      .reduce((s, p) => s + Number(p.amount || 0), 0);

    wrap.appendChild(el('div', { class: 'stats' },
      stat('Orders', orders.length, 'primary'),
      stat('Pieces in lots', totalPieces),
      stat('Contractors', contractors.length, 'accent'),
      stat('Workers', workers.length, 'success'),
      stat('Total paid', fmtINR(totalPaid), 'accent')
    ));

    wrap.appendChild(sectionH('Quick actions'));
    wrap.appendChild(el('div', { class: 'card' },
      el('div', { class: 'col' },
        el('button', { class: 'btn full', onclick: () => phase2Toast() }, '+ New bulk order'),
        el('button', { class: 'btn secondary full', onclick: () => phase2Toast() }, '+ Add contractor'),
        el('button', { class: 'btn secondary full', onclick: () => phase2Toast() }, '+ Add design')
      )
    ));

    wrap.appendChild(phase2Banner('Phase 2 will add: orders, lots, contractor assignment, designs.'));
  }
  else if (App.tab === 'orders')      wrap.appendChild(comingSoon('Bulk orders', 'Phase 2'));
  else if (App.tab === 'contractors') wrap.appendChild(comingSoon('Contractors', 'Phase 2'));
  else if (App.tab === 'designs')     wrap.appendChild(comingSoon('Designs & rates', 'Phase 2'));
  else if (App.tab === 'reports')     wrap.appendChild(comingSoon('Reports', 'Phase 5'));

  return wrap;
}

/* ─── Contractor dashboard ────────────────────────────────── */
function viewContractor() {
  const wrap = el('div');
  wrap.appendChild(topbar('KarkhanaPro', 'Chhota Seth · ' + App.user.name));

  if (App.tab === 'home') {
    const myLots = Store.data.lots.filter(l => l.contractor_id === App.user.id);
    const myWorkers = Store.data.users.filter(u => u.parent_user_id === App.user.id);

    wrap.appendChild(el('div', { class: 'stats' },
      stat('My lots', myLots.length, 'primary'),
      stat('Workers', myWorkers.length, 'success'),
      stat('Pieces today', 0, 'accent'),
      stat('Balance to pay', fmtINR(0))
    ));

    wrap.appendChild(sectionH('Quick actions'));
    wrap.appendChild(el('div', { class: 'card' },
      el('div', { class: 'col' },
        el('button', { class: 'btn full', onclick: () => phase2Toast() }, '+ Add worker'),
        el('button', { class: 'btn secondary full', onclick: () => phase2Toast() }, '+ Assign work')
      )
    ));

    wrap.appendChild(phase2Banner('Phase 3 will add: assigning pieces to workers, daily progress.'));
  }
  else if (App.tab === 'lots')     wrap.appendChild(comingSoon('My Lots', 'Phase 2'));
  else if (App.tab === 'workers')  wrap.appendChild(comingSoon('My Workers', 'Phase 3'));
  else if (App.tab === 'payments') wrap.appendChild(comingSoon('Payments', 'Phase 4'));

  return wrap;
}

/* ─── Worker dashboard ────────────────────────────────────── */
function viewWorker() {
  const wrap = el('div');
  wrap.appendChild(topbar('KarkhanaPro', 'Darzi · ' + App.user.name));

  if (App.tab === 'home') {
    wrap.appendChild(el('button', {
      class: 'big-tap',
      onclick: () => phase2Toast()
    }, '+ Pieces done today'));

    wrap.appendChild(el('div', { class: 'stats' },
      stat('Today', 0, 'primary'),
      stat('This week', 0, 'accent'),
      stat('To earn', fmtINR(0)),
      stat('Paid', fmtINR(0), 'success')
    ));

    wrap.appendChild(phase2Banner('Phase 3 will add: assigned work, daily entry, earnings.'));
  }
  else if (App.tab === 'work')     wrap.appendChild(comingSoon('My Work', 'Phase 3'));
  else if (App.tab === 'earnings') wrap.appendChild(comingSoon('My Earnings', 'Phase 4'));

  return wrap;
}

/* ─── Reusable view fragments ─────────────────────────────── */
function stat(label, value, variant = '') {
  return el('div', { class: 'stat ' + variant },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, String(value))
  );
}
function sectionH(title, action) {
  return el('div', { class: 'section-h' },
    el('h2', null, title),
    action || null
  );
}
function comingSoon(title, phase) {
  return el('div', { class: 'empty' },
    el('div', { class: 'ico' }, '🚧'),
    el('h2', null, title),
    el('p', { class: 'muted' }, 'Coming in ' + phase + '.')
  );
}
function phase2Banner(text) {
  return el('div', { class: 'card', style: 'background: var(--c-primary-50); border-color: transparent;' },
    el('div', { class: 'row gap-12' },
      el('div', { style: 'font-size: 24px' }, '🛠️'),
      el('div', null,
        el('div', { style: 'font-weight:700;color:var(--c-primary)' }, 'Foundation ready'),
        el('div', { class: 'muted' }, text)
      )
    )
  );
}
function phase2Toast() {
  toast('Coming in the next phase.', '');
}

/* ─── Bootstrap ───────────────────────────────────────────── */
async function bootstrap() {
  await Store.load();
  await Auth.ensureSeedPasswords();
  App.user = Auth.current();
  App.route = App.user ? App.user.role : 'login';
  App.tab = 'home';
  render();
}

document.addEventListener('DOMContentLoaded', bootstrap);

// Expose for debugging in console
window.KarkhanaPro = { Store, Auth, App, navigate, render };

})();
