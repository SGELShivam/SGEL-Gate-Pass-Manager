/* ==========================================================================
   Factory Gate Pass Manager — pure HTML + Firebase edition
   ========================================================================== */
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc,
  addDoc, deleteDoc, query, where, onSnapshot, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ------------------------------------------------------------------ config */
const CFG = window.FIREBASE_CONFIG || {};
const DOMAIN = window.FIREBASE_EMAIL_DOMAIN || 'gatepass.local';
const root = document.getElementById('app');

if (!CFG.apiKey || CFG.apiKey === 'PASTE_HERE') {
  root.innerHTML = `<div class="cfgmiss">
    <h2>⚠️ Firebase not configured yet</h2>
    <p>This app needs your (free) Firebase project keys — a one-time 10-minute setup.
    Open <code>firebase-config.js</code> in this folder and paste your config where it says
    <code>PASTE_HERE</code>.</p>
    <p>Full picture guide: open <b>FIREBASE SETUP.html</b> in this folder.</p>
  </div>`;
  throw new Error('firebase config missing');
}

const app = initializeApp(CFG);
const auth = getAuth(app);
const db = getFirestore(app);
const C = {
  users: collection(db, 'users'),
  creds: collection(db, 'creds'),
  directory: collection(db, 'directory'),
  depts: collection(db, 'departments'),
  gp: collection(db, 'employee_passes'),
  vp: collection(db, 'visitor_passes'),
  settings: doc(db, 'settings', 'main'),
};

/* ------------------------------------------------------------------ utils */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowStr = () => { const d = new Date(); return `${todayStr()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtD = s => { if (!s) return '—'; const [y, m, d] = s.split('-'); return s.length >= 10 ? `${d}-${'JanFebMarAprMayJunJulAugSepOctNovDec'.slice((+m - 1) * 3, (+m - 1) * 3 + 3)}-${y}` : s; };
const fmtDT = s => { if (!s) return '—'; const [date, t] = s.split(' '); if (!t) return fmtD(date); let [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${fmtD(date)} ${h}:${pad(m)} ${ap}`; };
const minsBetween = (a, b) => { if (!a) return null; try { const e = b ? new Date(b.replace(' ', 'T')) : new Date(); return Math.max(0, Math.round((e - new Date(a.replace(' ', 'T'))) / 60000)); } catch (e) { return null; } };
const mailOf = id => id.trim().toLowerCase() + '@' + DOMAIN;

function toast(msg, type = 'ok') {
  let w = document.querySelector('.toast');
  if (!w) { w = document.createElement('div'); w.className = 'toast'; document.body.appendChild(w); }
  const f = document.createElement('div');
  f.className = `flash f-${type}`;
  f.textContent = msg;
  w.appendChild(f);
  setTimeout(() => f.remove(), 4200);
}

/* ============================================================================
   ★★★  EASY EDIT ZONE  ★★★
   APP NAME  → shown in the browser tab, sidebar, login page and notifications.
   YOUR NAME → shown at the bottom of every page ("Made by Shivam").
   To change or remove either one: edit the text between the quotes below
   and save this file. Example:  const MADE_BY = 'Made by Rakesh';
   (Removing:  const MADE_BY = '';  — an empty text hides it.)
   ============================================================================ */
const APP_NAME = 'Factory Gate Pass Manager';
const MADE_BY = 'Made by Shivam';
/* VERSION → shown on the login page + under the sidebar name.
   Bump it with every new ZIP (e.g. v26.08.27) so you can SEE the update live. */
const APP_VERSION = 'v26.08.27d';

const STATUS = {
  PENDING_HOD: ['Pending Dept Head', 'b-amber'], PENDING_HR: ['Pending HR', 'b-blue'],
  PENDING_BOTH: ['Pending Approvals', 'b-amber'],
  APPROVED: ['Approved - At Gate', 'b-green'], OUT: ['OUT Now', 'b-purple'],
  VISITING: ['Visitor Inside', 'b-purple'], CLOSED: ['Completed', 'b-gray'],
  REJECTED: ['Rejected', 'b-red'], CANCELLED: ['Cancelled', 'b-gray'], EXPIRED: ['Expired (not used)', 'b-gray'],
};
const ROLE_LABEL = { admin: 'Admin (Owner)', employee: 'Employee', dept_head: 'Dept Head', hr: 'HR', security: 'Security' };
const badge = st => `<span class="badge ${STATUS[st] ? STATUS[st][1] : 'b-gray'}">${STATUS[st] ? STATUS[st][0] : st}</span>`;
const PENDING = ['PENDING_HOD', 'PENDING_HR', 'PENDING_BOTH'];

/* ------------------------------------------------------------- state/settings */
let me = null;            // {uid, ...profile}
let SETTINGS = {
  company_name: APP_NAME, retention_days: 60, logo_b64: '',
  appr_hod: '1', appr_hr: '1',            // employee passes
  appr_hod_v: '1', appr_hr_v: '1',        // visitor passes
  appr_mode: 'sequence',                  // 'sequence' (HOD then HR) | 'parallel' (both at once)
  appr_hr_for_hod: '0',                   // '1' = HR may approve employee passes on behalf of the Dept Head
  appr_hr_for_hod_v: '0',                 // same, for visitor passes
  hr_add_users: '0',                      // '1' = HR may create users (new joiners)
  pre_reg_hr: '0',                        // '1' = HR may pre-register visitors (auto-approved)
  pre_reg_hod: '0',                       // '1' = Dept Head may pre-register visitors
  pre_reg_hod_hr_appr: '1',               // '1' = HOD-raised visitor passes need HR approval ('0' = auto-approved)
};
const hrCanBehalf = () => SETTINGS.appr_hr_for_hod === '1';
const hrCanBehalfV = () => SETTINGS.appr_hr_for_hod_v === '1';
const hrCanAddUsers = () => SETTINGS.hr_add_users === '1';
/* pre-register visitor: admin picks WHO may raise (HR / Dept Head), from Settings */
const preRegAllowed = role => role === 'admin' || (role === 'hr' && SETTINGS.pre_reg_hr === '1') || (role === 'dept_head' && SETTINGS.pre_reg_hod === '1');
/* ❌ Cancel a visitor pass: possible only BEFORE the visitor is marked IN
   (once VISITING / CLOSED the record can never be cancelled). Who: admin or
   HR — on ANY visitor pass — or the person who raised it (Dept Head / HR /
   security for its OWN walk-in entry only). SECURITY can never cancel passes
   raised by someone else. */
const canCancelVp = p => [...PENDING, 'APPROVED'].includes(p.status)
  && (['admin', 'hr'].includes(me.role) || p.created_by_uid === me.uid);
async function cancelVisitorPass(id, p) {
  if (!confirm(`Cancel this visitor pass?\n\n${p.pass_no} — ${p.visitor_name} · ${fmtD(p.pass_date)}\n\nIt will leave the gate list — security will NOT expect this visitor. (Can never be done after the visitor is marked IN.)`)) return false;
  const note = (prompt('Reason for cancelling? (optional — e.g. visitor cancelled the visit)') || '').trim();
  await updateDoc(doc(db, 'visitor_passes', id), {
    status: 'CANCELLED', cancelled_by: me.name, cancelled_by_uid: me.uid, cancelled_at: nowStr(), cancel_note: note,
  });
  toast(`Visitor pass ${p.pass_no} cancelled${note ? ' — ' + note : ''}.`);
  return true;
}
let DEPTS = [];           // [{id,name,workflow,hod_count,user_count}]
let unsubs = [];          // active snapshot listeners for current view

async function loadSettings() {
  const s = await getDoc(C.settings);
  if (s.exists()) SETTINGS = Object.assign({}, SETTINGS, s.data());
}
async function saveSettings(patch) { await setDoc(C.settings, patch, { merge: true }); await loadSettings(); }
async function loadDepts() {
  const s = await getDocs(C.depts);
  DEPTS = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.name.localeCompare(b.name));
}
const deptName = id => (DEPTS.find(d => d.id === id) || {}).name || '—';

/* ---------- approval workflow engine ----------
   Order of decision for a pass of `kind` ('gp' employee / 'vp' visitor) in a dept:
   1. Per-department override (set on the Users page)   — 'both' | 'hod' | 'hr' | ''
   2. Global per-kind setting (Settings page)
   3. Auto-fallback: if Dept Head is required but the dept has NO active Dept Head
      user, HR approves directly.  At least one approver is always returned. */
function needsFor(kind, deptId) {
  let h, r;
  const d = DEPTS.find(x => x.id === deptId);
  if (d && d.workflow === 'both') { h = true; r = true; }
  else if (d && d.workflow === 'hod') { h = true; r = false; }
  else if (d && d.workflow === 'hr') { h = false; r = true; }
  else if (kind === 'vp') { h = SETTINGS.appr_hod_v === '1'; r = SETTINGS.appr_hr_v === '1'; }
  else { h = SETTINGS.appr_hod === '1'; r = SETTINGS.appr_hr === '1'; }
  if (h && d && (d.hod_count || 0) === 0) { h = false; r = true; }   // no HOD -> HR
  if (!h && !r) r = true;
  return [h, r];
}
const isParallel = () => SETTINGS.appr_mode === 'parallel';
function pendingStatus(kind, deptId) {
  const [h] = needsFor(kind, deptId);
  return isParallel() ? 'PENDING_BOTH' : (h ? 'PENDING_HOD' : 'PENDING_HR');
}
function flowLabel(kind, deptId) {
  const [h, r] = needsFor(kind, deptId);
  const steps = h && r ? 'Dept Head & HR' : (h ? 'Dept Head' : 'HR');
  return h && r && isParallel() ? steps + ' (parallel — both, any order)' : (h && r ? 'Dept Head → HR' : steps);
}

function depose() {
  unsubs.forEach(u => { try { u(); } catch (e) { } });
  unsubs = []; document.body.onclick = null;
}
function listen(q, fn) { const u = onSnapshot(q, fn, err => console.error(err)); unsubs.push(u); }
function tick(ms, fn) { const t = setInterval(fn, ms); unsubs.push(() => clearInterval(t)); }

/* --------------------------------------------------------------- housekeeping */
async function housekeeping() {
  if (!me || !['admin', 'hr'].includes(me.role)) return;
  if ((SETTINGS.last_cleanup || '') === todayStr()) return;
  const cutoff = daysAgo(+(SETTINGS.retention_days || 60));
  for (const col of [C.gp, C.vp]) {
    const old = await getDocs(query(col, where('pass_date', '<', todayStr())));
    let batch = writeBatch(db), n = 0;
    const flush = async () => { if (n) { await batch.commit(); batch = writeBatch(db); n = 0; } };
    for (const d of old.docs) {
      const r = d.data();
      if (r.pass_date < cutoff) { batch.delete(d.ref); n++; }
      else if ([...PENDING, 'APPROVED'].includes(r.status)) { batch.update(d.ref, { status: 'EXPIRED' }); n++; }
      if (n >= 400) await flush();
    }
    await flush();
  }
  await setDoc(C.settings, { last_cleanup: todayStr(), last_cleanup_at: nowStr() }, { merge: true });
  console.log('[cleanup] done, cutoff', cutoff);
}

/* keep per-dept user/head counts fresh — drives the "no Dept Head → HR approves" rule */
async function syncDeptCounts() {
  try {
    const snap = await getDocs(C.users);
    const per = {};
    snap.forEach(d => {
      const u = d.data();
      if (!u.department_id) return;
      const e = per[u.department_id] = per[u.department_id] || { u: 0, h: 0 };
      e.u++; if (u.role === 'dept_head' && u.active !== false) e.h++;
    });
    for (const d of DEPTS) {
      const u = (per[d.id] || { u: 0 }).u, h = (per[d.id] || { h: 0 }).h;
      if ((d.user_count || 0) !== u || (d.hod_count || 0) !== h)
        await updateDoc(doc(db, 'departments', d.id), { user_count: u, hod_count: h });
    }
    await loadDepts();
  } catch (e) { console.error(e); }
}

/* ------------------------------------------------------------------- frame */
const NAVS = {
  employee: [['#/my', '📋 My Gate Passes'], ['#/pass-new', '➕ New Pass Request']],
  dept_head: [['#/approvals', '✅ Approvals', 'bc-hod'], ['#/dashboard', '📊 Dept Dashboard'], ['#/reports', '📑 Reports']],
  hr: [['#/dashboard', '📊 Dashboard'], ['#/approvals', '✅ HR Approvals', 'bc-hr'], ['#/reports', '📑 Reports & Excel']],
  security: [['#/gate', '🚪 Gate Console', 'bc-gate']],
  admin: [['#/dashboard', '📊 Dashboard'], ['#/admin-users', '👥 Users'], ['#/reports', '📑 Reports & Excel'], ['#/admin-settings', '⚙️ Settings']],
};

function frame(title) {
  document.title = `${APP_NAME} · ${SETTINGS.company_name}`;
  root.innerHTML = `
  <div class="layout">
    <aside class="side">
      <div class="brand">
        ${SETTINGS.logo_b64 ? `<img src="${SETTINGS.logo_b64}" alt="logo">` : `<div class="brand-ic">🏭</div>`}
        <div class="brand-c">${esc(SETTINGS.company_name)}</div>
        <div class="brand-t">Gate Pass Manager</div>
        <div style="font-size:10.5px;color:#5b7194;margin-top:2px;letter-spacing:.5px">${APP_VERSION}</div>
      </div>
      <nav class="nav" id="nav"></nav>
      <div class="side-foot">
        <a class="installbtn" style="display:none" onclick="installApp()">📱 Install App</a>
        <a onclick="location.hash='#/password'">🔑 Change Password</a>
        <a id="logout">↩️ Logout</a>
      </div>
    </aside>
    <main class="main">
      <header class="top">
        <div class="top-title">${title}</div>
        <div style="display:flex;align-items:center;gap:14px">
          ${['dept_head', 'hr', 'security', 'admin'].includes(me.role) ? `<button class="btn sm gray" id="bell" title="Get a pop-up + sound when something needs your action (keep this tab open)">🔔 Alerts</button>` : ''}
          <div class="top-user"><div><div class="top-name">${esc(me.name)}</div>
          <div class="top-role">${ROLE_LABEL[me.role]} · ${esc(me.user_id)}</div></div></div>
        </div>
      </header>
      <div class="content" id="content"></div>
      <footer class="foot">${esc(APP_NAME)} · data auto-deleted after ${SETTINGS.retention_days} days${MADE_BY ? ` <span class="footcredit">👤 ${esc(MADE_BY)}</span>` : ''}</footer>
    </main>
  </div>`;
  const nav = document.getElementById('nav');
  const h = location.hash.split('?')[0] || '#/';
  const navItems = (NAVS[me.role] || []).slice();
  if (me.role === 'hr' && hrCanAddUsers()) navItems.splice(2, 0, ['#/hr-users', '👥 Add Users']);
  if (preRegAllowed(me.role)) navItems.splice(1, 0, ['#/visit-new', '🧍 Pre-register Visitor']);
  for (const [link, label, pill] of navItems) {
    const a = document.createElement('a');
    a.textContent = label;
    if (h === link) a.className = 'on';
    a.onclick = () => location.hash = link;
    if (pill) { const s = document.createElement('span'); s.className = 'pill'; s.id = pill; s.style.display = 'none'; a.appendChild(s); }
    nav.appendChild(a);
  }
  document.getElementById('logout').onclick = async () => { await signOut(auth); location.hash = '#/login'; };
  paintInstallBtns();
  const bell = document.getElementById('bell');
  if (bell) { paintBell(); bell.onclick = async () => {
    if (!window.Notification) return;
    if (Notification.permission === 'default') { await Notification.requestPermission(); paintBell();
      if (Notification.permission === 'granted') toast('Alerts enabled on this device. Keep the app tab open.'); }
    else if (Notification.permission === 'denied') toast('Notifications are blocked in the browser — allow them in the site settings (🔒 icon in address bar).', 'err');
  }; }
  loadBadges();
  return document.getElementById('content');
}

async function loadBadges() {
  try {
    const set = (id, n) => { const e = document.getElementById(id); if (e) { e.textContent = n; e.style.display = n ? '' : 'none'; } };
    const wantsMe = (r, role) =>
      r.status === (role === 'dept_head' ? 'PENDING_HOD' : 'PENDING_HR') ||
      (r.status === 'PENDING_BOTH' && (role === 'dept_head' ? !r.hod_by : !r.hr_by));
    if (me.role === 'dept_head') {
      const a = await getDocs(query(C.gp, where('status', 'in', ['PENDING_HOD', 'PENDING_BOTH'])));
      const b = await getDocs(query(C.vp, where('status', 'in', ['PENDING_HOD', 'PENDING_BOTH'])));
      set('bc-hod', [...a.docs, ...b.docs].filter(d => wantsMe(d.data(), 'dept_head') && d.data().department_id === me.department_id).length);
    } else if (me.role === 'hr') {
      const bhGp = hrCanBehalf(), bhVp = hrCanBehalfV();
      const a = await getDocs(query(C.gp, where('status', 'in', bhGp ? ['PENDING_HR', 'PENDING_HOD', 'PENDING_BOTH'] : ['PENDING_HR', 'PENDING_BOTH'])));
      const b = await getDocs(query(C.vp, where('status', 'in', bhVp ? ['PENDING_HR', 'PENDING_HOD', 'PENDING_BOTH'] : ['PENDING_HR', 'PENDING_BOTH'])));
      const mineK = (r, bh) => r.status === 'PENDING_HR'
        || (bh && r.status === 'PENDING_HOD')                             // approve on behalf of Dept Head
        || (r.status === 'PENDING_BOTH' && (!r.hr_by || (bh && !r.hod_by)));
      set('bc-hr', a.docs.filter(d => mineK(d.data(), bhGp)).length + b.docs.filter(d => mineK(d.data(), bhVp)).length);
    } else if (me.role === 'security') {
      const t = todayStr(), a = await getDocs(C.gp), b = await getDocs(C.vp);
      let n = 0;
      a.forEach(d => { const r = d.data(); if ((r.status === 'APPROVED' && r.pass_date === t) || r.status === 'OUT') n++; });
      b.forEach(d => { const r = d.data(); if ((r.status === 'APPROVED' && r.pass_date === t) || r.status === 'VISITING') n++; });
      set('bc-gate', n);
    }
  } catch (e) { console.error(e); }
}

/* ------------------------------------------- alerts / push-style notify (#9) */
function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const ctx = beep.ctx || (beep.ctx = new AC());
    if (ctx.state === 'suspended') ctx.resume();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.07, ctx.currentTime);
    o.frequency.exponenalRampToValueAtTime(440, ctx.currentTime + 0.18);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    o.start(); o.stop(ctx.currentTime + 0.42);
    setTimeout(() => { try { const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.connect(g2); g2.connect(ctx.destination); o2.frequency.value = 1320; g2.gain.setValueAtTime(0.05, ctx.currentTime); g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25); o2.start(); o2.stop(ctx.currentTime + 0.27); } catch (e) { } }, 180);
  } catch (e) { }
}
function notify(msg) {
  toast(msg, 'warn'); beep();
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification('🏭 ' + APP_NAME, { body: msg }); } catch (e) { }
  }
}
function paintBell() {
  const b = document.getElementById('bell'); if (!b) return;
  if (!window.Notification) { b.style.display = 'none'; return; }
  const p = Notification.permission;
  b.innerHTML = p === 'granted' ? '🔔 Alerts ON' : p === 'denied' ? '🔕 Blocked' : '🔔 Alerts';
  b.className = 'btn sm ' + (p === 'granted' ? 'green' : 'gray');
}
function initAlerts() {   // arms live alerts for approvers + security (once per browser session)
  if (initAlerts.on) return; initAlerts.on = true;
  if (!['dept_head', 'hr', 'security', 'admin'].includes(me.role)) return;
  let seen = new Set(), warm = false;
  const mine = r =>
    (me.role === 'dept_head' && r.department_id === me.department_id &&
      (r.status === 'PENDING_HOD' || (r.status === 'PENDING_BOTH' && !r.hod_by))) ||
    (me.role === 'hr' && (r.status === 'PENDING_HR' || (r.status === 'PENDING_BOTH' && !r.hr_by))) ||
    (me.role === 'admin' && PENDING.includes(r.status)) ||
    (me.role === 'security' && r.status === 'APPROVED' && r.pass_date === todayStr());
  const watch = (colRef, label) => onSnapshot(colRef, snap => {
    snap.docChanges().forEach(ch => {
      if (ch.type !== 'added') return;
      const r = ch.doc.data();
      if (!mine(r)) return;
      const key = label + ch.doc.id;
      if (seen.has(key)) return; seen.add(key);
      if (!warm) return;   // skip the initial load burst
      notify(`🔔 New ${label} needs you: ${r.pass_no || ''} — ${r.employee_name || r.visitor_name || ''}`);
    });
    warm = true;
  }, err => console.error(err));
  watch(C.gp, 'gate pass'); watch(C.vp, 'visitor pass');
}
function showLogin(err) {
  depose();
  root.innerHTML = `
  <div class="loginwrap"><div class="logincard">
    ${SETTINGS.logo_b64 ? `<div style="text-align:center;margin-bottom:6px"><img src="${SETTINGS.logo_b64}" style="max-height:64px;max-width:220px"></div>` : `<div style="text-align:center;font-size:38px">🏭</div>`}
    <h1>${esc(APP_NAME)}</h1>
    <div class="sub">${esc(SETTINGS.company_name)}</div>
    ${err ? `<div class="flash f-err" style="margin:8px 0">${esc(err)}</div>` : ''}
    <form id="lf">
      <label class="fl">User ID</label>
      <input type="text" id="uid" placeholder="e.g. SGE001 / SEC001 / CON001" required autocomplete="username">
      <label class="fl">Password</label>
      <input type="password" id="pw" placeholder="Password" required autocomplete="current-password">
      <div style="height:16px"></div>
      <button class="btn" style="width:100%;padding:12px" type="submit" id="lbtn">Login →</button>
    </form>
    <button type="button" class="btn gray installbtn" style="display:none;width:100%;margin-top:12px" onclick="installApp()">📱 Install App on this phone / PC</button>
    <div class="demo">Login ID + password are created by your admin.<br>Forgot password? Ask the admin to reset it (Users page).</div>
    <a id="fgt" style="display:inline-block;margin-top:10px;font-size:12.5px;cursor:pointer;color:var(--blue,#2563eb)">🔐 Forgot the <b>ADMIN</b> password?</a>
    ${MADE_BY ? `<div class="footcredit" style="margin-top:14px;text-align:center">👤 ${esc(MADE_BY)}</div>` : ''}
    <div style="margin-top:8px;text-align:center;font-size:11.5px;color:var(--sub)">${APP_VERSION}</div>
  </div></div>`;
  document.getElementById('fgt').onclick = () => showAdminHelp();
  paintInstallBtns();
  document.getElementById('lf').onsubmit = async ev => {
    ev.preventDefault();
    const id = document.getElementById('uid').value.trim().toLowerCase();
    const pw = document.getElementById('pw').value;
    document.getElementById('lbtn').disabled = true;
    try {
      const dir = await getDoc(doc(db, 'directory', id));
      let email;
      if (dir.exists()) {
        if (dir.data().active === false) throw { code: 'disabled' };
        email = dir.data().email;
      } else {
        email = id + '@' + DOMAIN;   // first-time admin bootstrap: login id == auth email prefix
      }
      await signInWithEmailAndPassword(auth, email, pw);
      lastPw = pw;
      // onAuthStateChanged continues from here
    } catch (e) {
      document.getElementById('lbtn').disabled = false;
      const code = e.code || '';
      showLogin(code === 'disabled' ? 'This account is disabled. Contact admin.'
        : (code === 'nouser' || code.includes('invalid') || code.includes('wrong') || code.includes('credential')
          ? 'Invalid User ID or password.' : 'Login error: ' + code));
      return;
    }
  };
}

/* ---------------------- help page: forgot the ADMIN password ---------------------- */
function showAdminHelp() {
  depose();
  root.innerHTML = `
  <div class="loginwrap"><div class="logincard" style="max-width:560px;text-align:left">
    <div style="text-align:center;font-size:34px">🔐</div>
    <h1 style="font-size:21px;text-align:center">Forgot the ADMIN password?</h1>
    <p class="muted small" style="text-align:center;margin:4px 0 12px">Relax — your <b>data is safe</b> in the cloud. Only the key needs replacing.</p>
    <h3 style="margin:12px 0 4px">🚪 Reset it from the Google console (about 3 minutes)</h3>
    <ol class="small" style="line-height:1.85;padding-left:20px;margin:0">
      <li>Open <b>console.firebase.google.com</b> → your project → <b>Build → Authentication → Users</b>.</li>
      <li>Find <b>your admin email</b> (the Gmail used during setup) in the list.</li>
      <li>At the right end of that row: <b>⋮ → Reset password</b>.</li>
      <li>Google emails you a reset link → open it → set a <b>new password</b>.</li>
      <li>Back here: log in with User ID <b>admin</b> + the new password. ✅</li>
      <li>Then once inside: <b>🔑 Change Password</b> (left menu) to sync the app's own password note.</li>
    </ol>
    <h3 style="margin:14px 0 4px">🗝️ Have a backup ADMIN account?</h3>
    <p class="small" style="margin:0">Log in as that account → Users → ✏️ on the main admin → set a new password → Save.
    (No backup yet? Make one today: Users page → role <b>Admin (Owner)</b>.)</p>
    <h3 style="margin:14px 0 4px">🚪 Also forgot the Google login?</h3>
    <p class="small" style="margin:0">The Firebase project lives in the Gmail you used at <b>firebase.google.com</b>. Recover that Gmail first (Google's own "Forgot password"), then do the steps above.</p>
    <div style="height:16px"></div>
    <button class="btn" style="width:100%" id="backlogin">← Back to login</button>
  </div></div>`;
  document.getElementById('backlogin').onclick = () => showLogin();
}

/* ---------------------------------------------- first-time admin bootstrap */
let lastPw = '';
function showBootstrap(u) {
  depose();
  root.innerHTML = `
  <div class="loginwrap"><div class="logincard">
    <div style="text-align:center;font-size:38px">🎉</div>
    <h1>One-time admin setup</h1>
    <div class="sub">${esc(SETTINGS.company_name)}</div>
    <p class="muted small" style="text-align:left;margin:14px 0">
      This account (<b>${esc(u.email)}</b>) has no profile in the app yet.
      If this is the <b>owner's admin account</b>, press the button below — this happens only once.</p>
    <label class="fl">Your name</label>
    <input type="text" id="bname" placeholder="e.g. Ramesh Patel (Owner)">
    <div style="height:14px"></div>
    <button class="btn" id="bgo" style="width:100%;padding:12px">✅ Create my Admin profile</button>
    <div style="height:8px"></div>
    <button class="btn gray" id="bback" style="width:100%">← Back to login</button>
    <div id="bstat" style="margin-top:12px"></div>
  </div></div>`;
  document.getElementById('bback').onclick = async () => { await signOut(auth); showLogin(); };
  document.getElementById('bgo').onclick = async () => {
    const name = document.getElementById('bname').value.trim() || 'Owner';
    const btn = document.getElementById('bgo'); btn.disabled = true;
    const stat = document.getElementById('bstat');
    const line = (icon, txt) => { const d = document.createElement('div'); d.className = 'small'; d.style.margin = '4px 0'; d.innerHTML = `${icon} ${txt}`; stat.appendChild(d); };
    stat.innerHTML = '';
    // each write runs on its own so we can show EXACTLY which one failed
    const steps = [
      ['Admin profile (users)', () => setDoc(doc(db, 'users', u.uid), {
        user_id: 'ADMIN', name, role: 'admin', department_id: null, email: '',
        auth_email: u.email, mobile: '', active: true, created_at: nowStr(), created_by: 'bootstrap',
      })],
      ['Login directory (directory/admin)', () => setDoc(doc(db, 'directory', 'admin'), { email: u.email, active: true, uid: u.uid, user_id: 'ADMIN' })],
      ['Password record (creds)', () => (lastPw ? setDoc(doc(db, 'creds', u.uid), { pw: lastPw }) : Promise.resolve())],
      ['Setup finished flag (settings)', () => setDoc(doc(db, 'settings', 'bootstrapped'), { done: true, at: nowStr(), by: u.email })],
    ];
    for (const [label, fn] of steps) {
      try { await fn(); line('✅', esc(label) + ' — done'); }
      catch (e) {
        const code = e.code || e.message || 'unknown error';
        line('❌', `<b>${esc(label)} — FAILED</b> &nbsp;<code>${esc(code)}</code>`);
        if (String(code).includes('permission')) {
          const help = document.createElement('div');
          help.className = 'flash f-err'; help.style.marginTop = '10px'; help.style.textAlign = 'left';
          help.innerHTML = `<b>The Firebase security rules are not active yet.</b><br>Fix it (1 minute):<br>
            1. Open <b>Firebase Console</b> → your project<br>
            2. <b>Build → Firestore Database</b> → <b>Rules</b> tab<br>
            3. Delete everything there, paste the rules from <b>FIREBASE SETUP.html</b> step 4 (big copy button)<br>
            4. Press <b>Publish</b> (important!)<br>
            5. Come back and press "Create my Admin profile" again — it will continue from where it stopped.`;
          stat.appendChild(help);
        } else {
          line('ℹ️', 'Fix the error above, then press the button again — completed steps are skipped automatically.');
        }
        btn.disabled = false;
        return;
      }
    }
    toast('Admin profile created. Welcome!');
    me = { uid: u.uid, user_id: 'ADMIN', name, role: 'admin', active: true };
    await loadSettings(); await loadDepts();
    location.hash = '#/';
  };
}

/* ------------------------------------------------------------ pass helpers */
async function nextPassNo(colRef, prefix, date) {
  const s = await getDocs(query(colRef, where('pass_date', '==', date)));
  return `${prefix}-${date.replaceAll('-', '')}-${String(s.size + 1).padStart(3, '0')}`;
}

function gpTrail(p, kind) {
  const steps = [];
  steps.push(['done', kind === 'vp' ? 'Visitor registered at gate' : 'Request submitted',
    `${kind === 'vp' ? (p.created_by || '') : p.employee_name} · ${fmtDT(p.created_at)}`]);
  const hodWait = p.status === 'PENDING_HOD' || (p.status === 'PENDING_BOTH' && !p.hod_by);
  const hodCls = hodWait ? 'wait' : (p.status === 'REJECTED' && p.hod_by && !p.hr_by ? 'bad' : (p.hod_by ? 'done' : ''));
  steps.push([hodCls, 'Dept Head approval',
    p.hod_by ? `${p.hod_by} · ${fmtDT(p.hod_at)}${p.hod_remarks ? ' — “' + p.hod_remarks + '”' : ''}`
      : (hodWait ? 'Waiting…' : '—')]);
  const hrWait = p.status === 'PENDING_HR' || (p.status === 'PENDING_BOTH' && !p.hr_by);
  const hrCls = hrWait ? 'wait' : (p.status === 'REJECTED' && p.hr_by ? 'bad' : (p.hr_by ? 'done' : ''));
  steps.push([hrCls, 'HR approval',
    p.hr_by ? `${p.hr_by} · ${fmtDT(p.hr_at)}${p.hr_remarks ? ' — “' + p.hr_remarks + '”' : ''}`
      : (hrWait ? 'Waiting…' : '—')]);
  if (kind === 'gp') {
    steps.push([p.gate_out_at ? 'done' : (p.status === 'APPROVED' ? 'wait' : ''), 'Gate: OUT',
      p.gate_out_at ? fmtDT(p.gate_out_at) : (p.status === 'APPROVED' ? 'Waiting at gate…' : '—')]);
    if (p.pass_type === 'returnable')
      steps.push([p.gate_in_at ? 'done' : (p.status === 'OUT' ? 'wait' : ''), 'Gate: IN (return)',
        p.gate_in_at ? fmtDT(p.gate_in_at) : (p.status === 'OUT' ? 'Not returned yet' : '—')]);
  } else {
    steps.push([p.gate_in_at ? 'done' : (p.status === 'APPROVED' ? 'wait' : ''), 'Visitor entered (IN)',
      p.gate_in_at ? fmtDT(p.gate_in_at) : (p.status === 'APPROVED' ? 'Approved — waiting at gate' : '—')]);
    steps.push([p.gate_out_at ? 'done' : (p.status === 'VISITING' ? 'wait' : ''), 'Visitor left (OUT)',
      p.gate_out_at ? fmtDT(p.gate_out_at) : (p.status === 'VISITING' ? 'Inside premises' : '—')]);
  }
  return '<ul class="tl">' + steps.map(([c, t, s]) => `<li class="${c}"><div class="tt">${esc(t)}</div><div class="ts">${esc(s)}</div></li>`).join('') + '</ul>';
}

function printPass(kind, p) {
  const rows = kind === 'gp' ? [
    ['Pass No', `<b>${p.pass_no}</b>`], ['Employee', `${p.employee_name} (${p.employee_code})`],
    ['Department', p.department_name], ['Date', p.pass_date],
    ['Type / Purpose', `${p.pass_type === 'returnable' ? 'Returnable' : 'Early Exit'} / ${p.purpose}`],
    ['Out Time', p.out_time], ...(p.return_time ? [['Expected Return', p.return_time]] : []),
    ['Reason', p.reason], ['Dept Head', `${p.hod_by || ''} ${p.hod_at || ''}`], ['HR', `${p.hr_by || ''} ${p.hr_at || ''}`],
    ['Gate OUT / IN', `${p.gate_out_at || '—'} / ${p.gate_in_at || '—'}`],
  ] : [
    ['Pass No', `<b>${p.pass_no}</b>`], ['Visitor Name', p.visitor_name], ['From / Company', p.visitor_company || '—'],
    ['Mobile', p.visitor_mobile || '—'], ['Person to Visit', `${p.person_to_visit} (${p.department_name})`],
    ['Purpose', p.purpose], ['Persons / Vehicle', `${p.persons || 1} / ${p.vehicle_no || '—'}`], ['Date', p.pass_date],
    ['Dept Head', `${p.hod_by || ''} ${p.hod_at || ''}`], ['HR', `${p.hr_by || ''} ${p.hr_at || ''}`],
    ['Entry / Exit', `${p.gate_in_at || '—'} / ${p.gate_out_at || '—'}`],
  ];
  const stamp = ![...PENDING, 'REJECTED', 'CANCELLED', 'EXPIRED'].includes(p.status) ? 'APPROVED' : p.status.replace('_', ' ');
  const sigs = kind === 'gp' ? ['Employee Sign', 'Security Sign', 'HR Sign'] : ['Visitor Sign', 'Security Sign', 'Person Visited Sign'];
  let old = document.querySelector('.print-only'); if (old) old.remove();
  const div = document.createElement('div');
  div.className = 'print-only';
  div.innerHTML = `<div class="pbox">
    <div class="phd">${SETTINGS.logo_b64 ? `<img src="${SETTINGS.logo_b64}">` : ''}<b>${esc(SETTINGS.company_name)}</b><br>
    <span style="font-size:12px">${kind === 'gp' ? 'EMPLOYEE GATE PASS' : 'VISITOR PASS'}</span></div>
    ${rows.map(([k, v]) => `<div class="prow"><div class="pk">${k}</div><div class="pv">${v}</div></div>`).join('')}
    <div class="pstamp">${stamp}</div>
    <div class="psig">${sigs.map(s => `<div>${s}</div>`).join('')}</div></div>`;
  document.body.appendChild(div);
  setTimeout(() => window.print(), 100);
}

/* ============================================================ views: employee */
async function vMyPasses() {
  const c = frame('My Gate Passes');
  c.innerHTML = `<div class="section">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <h2 style="margin:0">My Requests</h2>
      <button class="btn green" onclick="location.hash='#/pass-new'">➕ Raise New Gate Pass</button>
    </div><div style="height:14px"></div><div id="mylist" class="twrap">Loading…</div></div>`;
  listen(query(C.gp, where('employee_uid', '==', me.uid)), snap => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.pass_date + b.id).localeCompare(a.pass_date + a.id));
    const el = document.getElementById('mylist');
    if (!el) return;
    if (!rows.length) { el.innerHTML = '<p class="muted">No gate pass yet. Click <b>Raise New Gate Pass</b>.</p>'; return; }
    el.innerHTML = `<table class="tbl"><tr><th>Pass No</th><th>Date</th><th>Type</th><th>Purpose</th><th>Out</th><th>Return</th><th>Reason</th><th>Status</th><th></th></tr>
      ${rows.map(p => `<tr>
        <td class="nowrap"><a href="#/pass/gp/${p.id}"><b>${esc(p.pass_no)}</b></a></td>
        <td class="nowrap">${fmtD(p.pass_date)}</td>
        <td>${p.pass_type === 'returnable' ? 'Returnable' : 'Early Exit'}</td>
        <td>${esc(p.purpose)}</td><td>${esc(p.out_time)}</td><td>${esc(p.return_time) || '—'}</td>
        <td>${esc((p.reason || '').slice(0, 60))}</td><td>${badge(p.status)}</td>
        <td class="nowrap"><a class="btn sm gray" href="#/pass/gp/${p.id}">View</a>
        ${PENDING.includes(p.status) ? `<button class="btn sm red" data-cancel="${p.id}">Cancel</button>` : ''}</td></tr>`).join('')}</table>`;
    el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
      if (!confirm('Cancel this gate pass?')) return;
      await updateDoc(doc(db, 'employee_passes', b.dataset.cancel), { status: 'CANCELLED' });
      toast('Pass cancelled.');
    });
  });
}

function vNewPass() {
  const c = frame('Raise New Gate Pass');
  c.innerHTML = `<div class="section formcard"><h2>Gate Pass Request</h2>
    <p class="muted small">Your request goes to <b>${flowLabel('gp', me.department_id)}</b>. After approval, show the pass at the security gate.</p>
    <form id="nf"><div class="frow c2">
      <div><label class="fl">Pass Type *</label>
        <select id="ptype"><option value="returnable">Returnable — out &amp; back same day</option>
        <option value="early_exit">Early Exit — leaving for the day</option></select></div>
      <div><label class="fl">Purpose *</label>
        <select id="purpose"><option value="personal">Personal</option><option value="official">Official</option></select></div></div>
    <div class="frow c3">
      <div><label class="fl">Date *</label><input type="date" id="pdate" min="${todayStr()}" value="${todayStr()}" required></div>
      <div><label class="fl">Out Time *</label><input type="time" id="out" required></div>
      <div id="retw"><label class="fl">Expected Return *</label><input type="time" id="ret"></div></div>
    <label class="fl">Reason *</label><textarea id="reason" rows="3" placeholder="e.g. Doctor appointment / vendor visit" required></textarea>
    <div style="height:16px"></div>
    <button class="btn" type="submit">Submit for Approval →</button>
    <a class="btn gray" href="#/my">Cancel</a></form></div>`;
  const tgl = () => { const ret = document.getElementById('ptype').value === 'returnable'; document.getElementById('retw').style.display = ret ? '' : 'none'; document.getElementById('ret').required = ret; };
  document.getElementById('ptype').onchange = tgl; tgl();
  // ⏰ time rules: for TODAY only now-or-later can be picked (stops back-dated slips)
  const pdateEl = document.getElementById('pdate'), outEl = document.getElementById('out'), retEl = document.getElementById('ret');
  const updTimeMin = () => { outEl.min = pdateEl.value === todayStr() ? nowStr().slice(11) : ''; };
  pdateEl.onchange = updTimeMin; updTimeMin();
  outEl.onchange = () => { retEl.min = outEl.value || ''; };   // return can only come after out
  document.getElementById('nf').onsubmit = async ev => {
    ev.preventDefault();
    const ptype = document.getElementById('ptype').value, purpose = document.getElementById('purpose').value;
    const date = document.getElementById('pdate').value, out = document.getElementById('out').value;
    let ret = document.getElementById('ret').value || null, reason = document.getElementById('reason').value.trim();
    if (date < todayStr()) return toast('Pass date cannot be in the past.', 'err');
    if (date === todayStr() && out < nowStr().slice(11)) return toast('Out time cannot be in the past (current time is ' + nowStr().slice(11) + '). Please choose now or a later time.', 'err');
    if (!reason) return toast('Reason is required.', 'err');
    if (ptype === 'returnable' && (!ret || ret <= out)) return toast('Return time must be after out time.', 'err');
    if (ptype === 'early_exit') ret = null;
    const pno = await nextPassNo(C.gp, 'GP', date);
    await addDoc(C.gp, {
      pass_no: pno, employee_uid: me.uid, employee_code: me.user_id, employee_name: me.name,
      department_id: me.department_id || null, department_name: deptName(me.department_id),
      pass_date: date, pass_type: ptype, purpose, out_time: out, return_time: ret, reason,
      status: pendingStatus('gp', me.department_id), created_at: nowStr(),
    });
    toast(`Gate pass ${pno} submitted.`);
    location.hash = '#/my';
  };
}

/* ===================================================== views: pass detail */
function vPassDetail(kind, id) {
  const c = frame('Pass Details');
  const ref = doc(db, kind === 'gp' ? 'employee_passes' : 'visitor_passes', id);
  listen(ref, snap => {
    if (!snap.exists()) { c.innerHTML = '<div class="section">Pass not found.</div>'; return; }
    const p = snap.data();
    if (me.role === 'employee' && p.employee_uid !== me.uid) { c.innerHTML = '<div class="section">⛔ Not your pass.</div>'; return; }
    if (me.role === 'dept_head' && p.department_id !== me.department_id && !(kind === 'vp' && p.created_by_uid === me.uid)) { c.innerHTML = '<div class="section">⛔ Different department.</div>'; return; }
    const isV = kind === 'vp';
    const mins = isV ? minsBetween(p.gate_in_at, p.gate_out_at) : minsBetween(p.gate_out_at, p.gate_in_at);
    const rows = isV ? [
      ['Pass No', `<b>${esc(p.pass_no)}</b>`], ['Visitor Name', esc(p.visitor_name)], ['Mobile', esc(p.visitor_mobile) || '—'],
      ['From / Company', esc(p.visitor_company) || '—'], ['Person to Visit', `${esc(p.person_to_visit)} (${esc(p.department_name)})`],
      ['Purpose', esc(p.purpose)], ['Persons', p.persons || 1], ['Vehicle No', esc(p.vehicle_no) || '—'],
      ['📦 Items carried / gate note', esc(p.gate_note) || '—'],
      ['Date', fmtD(p.pass_date)], ['Registered by', `${esc(p.created_by || '')} · ${fmtDT(p.created_at)}`],
      ...(p.status === 'CANCELLED' ? [['❌ Cancelled', `${fmtDT(p.cancelled_at) || ''} · by <b>${esc(p.cancelled_by || '—')}</b>${p.cancel_note ? ' · Reason: ' + esc(p.cancel_note) : ''}`]] : []),
      ...(p.gate_in_at ? [['Entered (IN)', `${fmtDT(p.gate_in_at)} by ${esc(p.gate_in_by || '')}`]] : []),
      ...(p.gate_out_at ? [['Left (OUT)', `${fmtDT(p.gate_out_at)} by ${esc(p.gate_out_by || '')}`]] : []),
      ...(mins != null ? [['Time Inside', `<b>${mins} min</b>${p.status === 'VISITING' ? ' (still inside)' : ''}`]] : []),
    ] : [
      ['Pass No', `<b>${esc(p.pass_no)}</b>`], ['Employee', `${esc(p.employee_name)} (${esc(p.employee_code)})`],
      ['Department', esc(p.department_name)], ['Date', fmtD(p.pass_date)],
      ['Type', p.pass_type === 'returnable' ? 'Returnable (same day)' : 'Early Exit (no return)'],
      ['Purpose', esc(p.purpose)], ['Planned Out', esc(p.out_time)],
      ...(p.return_time ? [['Expected Return', esc(p.return_time)]] : []), ['Reason', esc(p.reason)],
      ...(p.gate_out_at ? [['Actual Out', `${fmtDT(p.gate_out_at)} by ${esc(p.gate_out_by || '')}`]] : []),
      ...(p.gate_in_at ? [['Actual In', `${fmtDT(p.gate_in_at)} by ${esc(p.gate_in_by || '')}`]] : []),
      ...(mins != null ? [['Time Outside', `<b>${mins} min</b>${p.status === 'OUT' ? ' (still out)' : ''}`]] : []),
      ['Requested On', fmtDT(p.created_at)],
    ];
    let actions = `<button class="btn gray" id="prn">🖨️ Print Pass</button>`;
    if (me.role === 'employee' && p.employee_uid === me.uid && PENDING.includes(p.status))
      actions += ` <button class="btn red" id="cancel">Cancel Request</button>`;
    if (isV && canCancelVp(p))
      actions += ` <button class="btn red" id="vcancel" title="Visitor cancelled the visit? Removes it from the gate list — possible only before the visitor is marked IN">❌ Cancel Visitor Pass</button>`;
    const needHodNow = p.status === 'PENDING_HOD' || (p.status === 'PENDING_BOTH' && !p.hod_by);
    const needHrNow = p.status === 'PENDING_HR' || (p.status === 'PENDING_BOTH' && !p.hr_by);
    const canHOD = me.role === 'dept_head' && needHodNow && p.department_id === me.department_id;
    const canHR = me.role === 'hr' && needHrNow;
    let apprForm = '';
    if (canHOD || canHR) apprForm = `
      <div class="section"><h2>Your action</h2>
      <div class="btnrow"><input type="text" id="rmk" placeholder="Remarks (required only for rejection)" style="flex:1;min-width:220px">
      <button class="btn green" id="appr">✅ Approve</button>
      <button class="btn red" id="rej">❌ Reject</button></div></div>`;
    c.innerHTML = `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="section" style="margin:0">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <h2 style="margin:0">${isV ? 'Visitor Pass' : 'Pass'} Details</h2>${badge(p.status)}</div>
        <table class="tbl" style="margin-top:10px">${rows.map(([k, v]) => `<tr><th style="width:150px">${k}</th><td>${v}</td></tr>`).join('')}</table>
        <div style="height:14px"></div><div class="btnrow">${actions}</div>
      </div>
      <div class="section" style="margin:0"><h2>Approval Trail</h2>${gpTrail(p, kind)}</div></div>
      <div style="height:16px"></div>${apprForm}`;
    document.getElementById('prn').onclick = () => printPass(kind, p);
    const cb = document.getElementById('cancel');
    if (cb) cb.onclick = async () => { if (confirm('Cancel this pass?')) { await updateDoc(ref, { status: 'CANCELLED' }); toast('Cancelled.'); } };
    const vcx = document.getElementById('vcancel');
    if (vcx) vcx.onclick = () => cancelVisitorPass(id, p);
    const doAction = async ok => {
      const remarks = document.getElementById('rmk').value.trim();
      if (!ok && !remarks) return toast('Remarks are required when rejecting.', 'err');
      await decide(kind, id, ok, remarks, null);   // shared logic: sequence / parallel / dept rules
    };
    if (document.getElementById('appr')) {
      document.getElementById('appr').onclick = () => doAction(true);
      document.getElementById('rej').onclick = () => doAction(false);
    }
    // security notes items carried / id proof while checking the visitor at the gate
    if (isV && ['security', 'admin'].includes(me.role) && ['APPROVED', 'VISITING'].includes(p.status)) {
      const nb = document.createElement('div');
      nb.className = 'section'; nb.style.borderLeft = '6px solid var(--amber)';
      nb.innerHTML = `<h2>📦 Items carried / gate note</h2>
        <div class="btnrow"><input type="text" id="gnote" style="flex:1;min-width:220px" placeholder="e.g. laptop bag, 2 material boxes, ID: Aadhaar 1234" value="${esc(p.gate_note || '')}">
        <button class="btn" id="gnosave" type="button">💾 Save note</button></div>
        <div class="muted small" style="margin-top:6px">Written by security while checking the visitor at the gate. Saved on the pass record and visible in the gate list.</div>`;
      c.appendChild(nb);
      nb.querySelector('#gnosave').onclick = async () => { await updateDoc(ref, { gate_note: nb.querySelector('#gnote').value.trim() }); toast('Gate note saved.'); };
    }
    // security gate buttons on detail page
    if (['security', 'admin'].includes(me.role)) {
      const bar = document.createElement('div');
      bar.className = 'section'; bar.style.borderLeft = '6px solid var(--purple)';
      bar.innerHTML = `<h2>Gate action</h2><div class="btnrow" id="gb"></div>`;
      const gb = bar.querySelector('#gb');
      const today = todayStr();
      if (!isV) {
        if (p.status === 'APPROVED' && p.pass_date === today)
          gb.innerHTML = `<button class="btn big green" id="go">OUT →</button>`;
        if (p.status === 'OUT' && p.pass_type === 'returnable')
          gb.innerHTML = `<button class="btn xl" id="gi">← IN (return)</button>`;
      } else {
        if (p.status === 'APPROVED' && p.pass_date === today)
          gb.innerHTML = `<button class="btn big green" id="go">Visitor IN →</button>`;
        if (p.status === 'VISITING')
          gb.innerHTML = `<button class="btn xl" id="gi">← Visitor OUT</button>`;
      }
      if (gb.innerHTML) {
        c.appendChild(bar);
        const go = gb.querySelector('#go'), gi = gb.querySelector('#gi');
        if (go) go.onclick = async () => {
          const patch = isV ? { status: 'VISITING', gate_in_at: nowStr(), gate_in_by: me.name }
            : (p.pass_type === 'early_exit'
              ? { status: 'CLOSED', gate_out_at: nowStr(), gate_out_by: me.name }
              : { status: 'OUT', gate_out_at: nowStr(), gate_out_by: me.name });
          await updateDoc(ref, patch); toast('Marked.');
        };
        if (gi) gi.onclick = async () => {
          const patch = isV ? { status: 'CLOSED', gate_out_at: nowStr(), gate_out_by: me.name }
            : { status: 'CLOSED', gate_in_at: nowStr(), gate_in_by: me.name };
          await updateDoc(ref, patch); toast('Marked.');
        };
      }
    }
  });
}

/* ===================================================== views: approvals */
function approvalCard(p, kind) {
  const id = `${kind}/${p.id}`;
  const prog = p.status === 'PENDING_BOTH'
    ? `<div style="margin-top:6px;font-size:12.5px;font-weight:700">${p.hod_by ? '✅ Dept Head done' : '⏳ Dept Head waiting'} · ${p.hr_by ? '✅ HR done' : '⏳ HR waiting'}</div>` : '';
  /* HR acting on behalf of the Dept Head (per-kind switch in ⚙️ Settings) */
  const behalfOn = me && me.role === 'hr' && (kind === 'gp' ? hrCanBehalf() : hrCanBehalfV());
  const hodSideOpen = p.status === 'PENDING_HOD' || (p.status === 'PENDING_BOTH' && !p.hod_by);
  const hrSideOpen = p.status === 'PENDING_HR' || (p.status === 'PENDING_BOTH' && !p.hr_by);
  const approveBtns = (me && me.role === 'hr')
    ? `${hrSideOpen ? `<button class="btn green" data-a="1">✅ Approve${p.status === 'PENDING_BOTH' ? ' (as HR)' : ''}</button>` : ''}
       ${behalfOn && hodSideOpen ? `<button class="btn green" data-a="1" data-side="behalf" title="Approve on behalf of the Dept Head — your name is recorded">🤝 Approve as Dept Head</button>` : ''}`
    : `<button class="btn green" data-a="1">✅ Approve</button>`;
  const behalfNote = (behalfOn && hodSideOpen)
    ? `<div style="margin-top:6px"><span class="badge b-purple">🤝 Dept Head step — you can cover it</span></div>` : '';
  return `<div class="appr${kind === 'vp' ? ' v' : ''}"><div class="appr-head"><div>
    <div class="appr-who">${kind === 'gp' ? esc(p.employee_name) : esc(p.visitor_name)}
      <span class="muted">(${kind === 'gp' ? esc(p.employee_code) + ' · ' : ''}${esc(p.department_name)})</span></div>
    <div class="appr-meta"><b>${esc(p.pass_no)}</b> · ${fmtD(p.pass_date)} · ${kind === 'gp'
      ? `${p.pass_type === 'returnable' ? 'Returnable' : 'Early Exit'} / ${esc(p.purpose)} · Out <b>${esc(p.out_time)}</b>${p.return_time ? ' → back <b>' + esc(p.return_time) + '</b>' : ''}`
      : `to meet <b>${esc(p.person_to_visit)}</b>${p.vehicle_no ? ' · 🚗 ' + esc(p.vehicle_no) : ''}${p.persons > 1 ? ' · 👥 ' + p.persons : ''}`}
    </div><div>📝 ${esc(kind === 'gp' ? p.reason : p.purpose)}</div>${prog}${behalfNote}</div>
    <a class="btn sm gray" href="#/pass/${id}">View</a></div>
    <div class="btnrow" style="margin-top:10px">
      <input type="text" placeholder="Remarks (required only for rejection)" style="flex:1;min-width:220px" data-rmk>
      ${approveBtns}
      <button class="btn red" data-a="0">❌ Reject</button>
    </div></div>`;
}

async function decide(kind, id, ok, remarks, card, side) {
  const ref = doc(db, kind === 'gp' ? 'employee_passes' : 'visitor_passes', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return toast('Pass not found (maybe already handled).', 'err');
  const p = snap.data();
  const patch = {};
  const asBehalf = side === 'behalf';                         // HR covering the Dept Head step
  const actedHod = me.role === 'dept_head' || asBehalf;
  if (asBehalf) { patch.hod_by = me.name + ' (HR, on behalf of Dept Head)'; patch.hod_uid = me.uid; patch.hod_at = nowStr(); patch.hod_remarks = remarks; }
  else if (me.role === 'dept_head') { patch.hod_by = me.name; patch.hod_uid = me.uid; patch.hod_at = nowStr(); patch.hod_remarks = remarks; }
  else { patch.hr_by = me.name; patch.hr_uid = me.uid; patch.hr_at = nowStr(); patch.hr_remarks = remarks; }
  if (!ok) { patch.status = 'REJECTED'; }
  else if (p.status === 'PENDING_BOTH' || isParallel()) {         // parallel: approve when all required sides are in
    const [needH, needR] = needsFor(kind, p.department_id);
    const haveH = actedHod || !!p.hod_by;
    const haveR = (me.role === 'hr' && !asBehalf) || !!p.hr_by;
    patch.status = ((needH ? haveH : true) && (needR ? haveR : true)) ? 'APPROVED' : 'PENDING_BOTH';
  } else {                                                         // sequence
    const [, needR] = needsFor(kind, p.department_id);
    patch.status = actedHod ? (needR ? 'PENDING_HR' : 'APPROVED') : 'APPROVED';
  }
  await updateDoc(ref, patch);
  toast(!ok ? 'Rejected.' : (patch.status === 'APPROVED' ? 'Approved ✅ — sent to gate.'
    : asBehalf ? 'Approved on behalf of Dept Head ✅ ' + (patch.status === 'PENDING_HR' ? '— now it needs your HR approval.' : '— waiting for HR.')
    : 'Noted ✅ — waiting for the other approver.'));
  if (card) card.remove(); else if (['hr', 'dept_head'].includes(me.role)) location.hash = '#/approvals';
}

function vApprovals() {
  const c = frame(me.role === 'dept_head' ? 'Dept Head Approvals' : 'HR Approvals');
  const bhGp = me.role === 'hr' && hrCanBehalf(), bhVp = me.role === 'hr' && hrCanBehalfV();
  const bhFor = kind => kind === 'gp' ? bhGp : bhVp;                       // HR covering a missing/absent Dept Head
  const wantGp = me.role === 'dept_head' ? ['PENDING_HOD', 'PENDING_BOTH'] : (bhGp ? ['PENDING_HR', 'PENDING_HOD', 'PENDING_BOTH'] : ['PENDING_HR', 'PENDING_BOTH']);
  const wantVp = me.role === 'dept_head' ? ['PENDING_HOD', 'PENDING_BOTH'] : (bhVp ? ['PENDING_HR', 'PENDING_HOD', 'PENDING_BOTH'] : ['PENDING_HR', 'PENDING_BOTH']);
  const wantsMe = (r, kind) => me.role === 'dept_head'
    ? (r.status === 'PENDING_HOD' || (r.status === 'PENDING_BOTH' && !r.hod_by)) && r.department_id === me.department_id
    : r.status === 'PENDING_HR'
      || (bhFor(kind) && r.status === 'PENDING_HOD')                                    // cover a missing/absent Dept Head
      || (r.status === 'PENDING_BOTH' && (!r.hr_by || (bhFor(kind) && !r.hod_by)));
  c.innerHTML = `<div class="section"><h2>⏳ Employee passes waiting for you (<span id="n1">…</span>)</h2><div id="pe">Loading…</div></div>
    <div class="section" style="border-left:6px solid var(--amber)"><h2>🧍 Visitor passes waiting (<span id="n2">…</span>)</h2><div id="pv">Loading…</div></div>`;
  const wire = (el, kind) => el.querySelectorAll('.appr').forEach(card => {
    const id = card.dataset.id, kindq = card.dataset.kind;
    card.querySelectorAll('button[data-a]').forEach(btn => btn.onclick = async () => {
      const ok = btn.dataset.a === '1';
      const remarks = card.querySelector('[data-rmk]').value.trim();
      if (!ok && !remarks) return toast('Remarks are required when rejecting.', 'err');
      await decide(kindq, id, ok, remarks, card, btn.dataset.side);
    });
  });
  const render = (snap, elId, nId, kind) => {
    const el = document.getElementById(elId), n = document.getElementById(nId);
    if (!el) return;
    let rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => wantsMe(r, kind));
    rows.sort((a, b) => (a.pass_date + (a.out_time || '')).localeCompare(b.pass_date + (b.out_time || '')));
    n.textContent = rows.length;
    if (!rows.length) { el.innerHTML = `<p class="muted">Nothing pending. 🎉</p>`; return; }
    el.innerHTML = rows.map(p => approvalCard(p, kind).replace('class="appr', `class="appr" data-id="${p.id}" data-kind="${kind}"`)).join('');
    wire(el, kind);
  };
  listen(query(C.gp, where('status', 'in', wantGp)), s => render(s, 'pe', 'n1', 'gp'));
  listen(query(C.vp, where('status', 'in', wantVp)), s => render(s, 'pv', 'n2', 'vp'));
}

/* ------------------------------------------------- views: pre-register a visitor (Dept Head / HR) */
/* big friendly hint when NO departments exist yet (brand-new factory) — without it the
   Department dropdown is empty and the browser only shows a tiny bubble nobody reads */
const noDeptHint = () => DEPTS.length ? '' : `<div style="background:#fff7e6;border:1px solid #f1c40f77;border-left:6px solid var(--amber);padding:12px 16px;border-radius:12px;margin:12px 0;font-size:14.5px;line-height:1.55">⚠️ <b>No departments created yet — a pass cannot be made without one.</b><br>First create a department: <b>Admin</b> login → ⚙️ <b>Settings</b> → <b>Departments</b> → type the name → <b>Add</b>. Then come back &amp; refresh this page — the <b>Department</b> box below will show it.</div>`;
function vVisitNew() {
  const c = frame('🧍 Pre-register Visitor');
  c.innerHTML = `<div class="section formcard"><h2>Expected Visitor Pass</h2>
    <p class="muted small">Book an expected visitor <b>before</b> he arrives. Approvals run exactly like a normal visitor pass (visitor workflow + department rule). On the visit day it appears at the gate — security checks the details, notes items carried, and marks the visitor IN. <span class="badge b-amber">Security can still register walk-in visitors at the gate as before.</span></p>${noDeptHint()}
    <form id="pvf"><div class="frow c3">
      <div><label class="fl">Visitor Name *</label><input type="text" id="pvn" required></div>
      <div><label class="fl">Mobile</label><input type="text" id="pvm"></div>
      <div><label class="fl">From / Company</label><input type="text" id="pvc"></div>
      <div><label class="fl">Person to Visit *</label><input type="text" id="pvperson" required></div>
      <div><label class="fl">Department *</label><select id="pvdept" required><option value="">— select —</option>
        ${DEPTS.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Purpose *</label><input type="text" id="pvpurp" required></div>
      <div><label class="fl">Visit Date *</label><input type="date" id="pvdate" min="${todayStr()}" value="${todayStr()}" required></div>
      <div><label class="fl">Vehicle No.</label><input type="text" id="pvveh"></div>
      <div><label class="fl">No. of Persons</label><input type="number" id="pvper" value="1" min="1"></div>
    </div><div style="height:10px"></div>
    <button class="btn" type="submit">Create Visitor Pass</button></form></div>
  <div class="section"><h2>📋 My pre-registered visitors</h2><div id="mypre">Loading…</div></div>`;
  const renderMine = async () => {
    const el = document.getElementById('mypre'); if (!el) return;
    const snap = await getDocs(C.vp);
    const mine = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.created_by_uid === me.uid)
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 20);
    el.innerHTML = mine.length ? `<div class="twrap"><table class="tbl"><tr><th>Pass</th><th>Visitor</th><th>Visit date</th><th>To meet</th><th>Status</th><th></th></tr>
      ${mine.map(p => `<tr><td class="nowrap"><b>${esc(p.pass_no)}</b></td><td>${esc(p.visitor_name)}</td><td class="nowrap">${fmtD(p.pass_date)}</td><td>${esc(p.person_to_visit)}</td><td>${badge(p.status)}</td><td class="nowrap"><a class="btn sm gray" href="#/pass/vp/${p.id}">👁 View</a>${canCancelVp(p) ? ` <button class="btn sm red" data-vcx="${p.id}" title="Visitor cancelled the visit? (only possible before gate IN)">❌ Cancel</button>` : ''}</td></tr>`).join('')}</table></div>`
      : '<p class="muted">No pre-registered visitors yet — the passes you raise will show here with their live status.</p>';
    el.querySelectorAll('[data-vcx]').forEach(b => b.onclick = async () => {
      const p = mine.find(x => x.id === b.dataset.vcx);
      if (p && await cancelVisitorPass(b.dataset.vcx, p)) renderMine();
    });
  };
  renderMine();
  document.getElementById('pvf').onsubmit = async ev => {
    ev.preventDefault();
    const g = id => document.getElementById(id).value.trim();
    const dept = DEPTS.find(d => d.id === g('pvdept'));
    if (!dept) return toast('Select department.', 'err');
    const date = g('pvdate');
    if (date < todayStr()) return toast('Visit date cannot be in the past.', 'err');
    const no = await nextPassNo(C.vp, 'VP', date);
    // role decides the approval path: HR/admin-raised = auto-APPROVED (straight to the gate);
    // HOD-raised = HOD step auto (he IS the raiser); HR approval only if the Settings switch says so
    let status = 'APPROVED', extras = {};
    if (me.role === 'dept_head') {
      extras = { hod_by: me.name + ' (Dept Head, raised it)', hod_uid: me.uid, hod_at: nowStr() };
      if (SETTINGS.pre_reg_hod_hr_appr !== '0') status = SETTINGS.appr_mode === 'parallel' ? 'PENDING_BOTH' : 'PENDING_HR';
    }
    await addDoc(C.vp, {
      pass_no: no, visitor_name: g('pvn'), visitor_mobile: g('pvm'), visitor_company: g('pvc'),
      purpose: g('pvpurp'), person_to_visit: g('pvperson'), department_id: dept.id, department_name: dept.name,
      persons: Math.max(1, parseInt(g('pvper') || '1')), vehicle_no: g('pvveh').toUpperCase(),
      pass_date: date, ...extras, status, created_by: me.name + ' (pre-registered)', created_by_uid: me.uid, created_at: nowStr(),
    });
    toast(status === 'APPROVED'
      ? `Visitor pass ${no} created and APPROVED — it will appear at the gate on ${fmtD(date)}.`
      : `Visitor pass ${no} created — waiting for HR approval; it reaches the gate on ${fmtD(date)} after approval.`);
    ev.target.reset();
    renderMine();
  };
}

/* ============================================================ views: gate */
function vGate() {
  const c = frame('🚪 Security Gate Console');
  c.innerHTML = `
  <div class="gate-top">
    <div class="gchip ink"><div class="ic">✅</div><div><div class="n" id="c-ready">0</div><div class="t">Ready to go OUT</div></div></div>
    <div class="gchip purple"><div class="ic">🚶</div><div><div class="n" id="c-out">0</div><div class="t">Employees OUT now</div></div></div>
    <div class="gchip amber"><div class="ic">🧍</div><div><div class="n" id="c-vis">0</div><div class="t">Visitors inside</div></div></div>
    <div class="gchip ink"><div class="ic">⏳</div><div><div class="n" id="c-wait">0</div><div class="t">Waiting for approval</div></div></div>
    <div style="margin-left:auto;align-self:center"><span class="live">LIVE</span></div>
  </div>
  <div class="gsearch"><span>🔍</span><input type="text" id="gfilter" placeholder="Type name / pass no / dept / vehicle to filter the lists below…"></div>
  <div class="section" style="border-left:6px solid var(--amber);padding:12px 16px">
    <details id="regbox"><summary style="cursor:pointer;font-size:16.5px;font-weight:800">🧍 Register a VISITOR <span class="muted small">(tap to open)</span></summary>${noDeptHint()}
      <form id="vf" style="margin-top:12px"><div class="frow c3">
        <div><label class="fl">Visitor Name *</label><input type="text" id="vn" required></div>
        <div><label class="fl">Mobile</label><input type="text" id="vm"></div>
        <div><label class="fl">From / Company</label><input type="text" id="vc"></div>
        <div><label class="fl">Person to Visit *</label><input type="text" id="vperson" required></div>
        <div><label class="fl">Department *</label><select id="vdept" required><option value="">— select —</option>
          ${DEPTS.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
        <div><label class="fl">Purpose *</label><input type="text" id="vpurp" required></div>
        <div><label class="fl">Vehicle No.</label><input type="text" id="vveh"></div>
        <div><label class="fl">No. of Persons</label><input type="number" id="vper" value="1" min="1"></div>
      </div><div style="height:10px"></div>
      <button class="btn" type="submit">Create Visitor Pass → send for approval</button>
      <span class="muted small">Approval follows the <b>visitor workflow</b> (⚙️ Settings) + department rule.</span></form>
    </details></div>
  <div class="gatewrap">
    <div class="gcol" id="vcol"></div>
    <div class="gcol" id="ecol"></div>
  </div>`;

  document.getElementById('vf').onsubmit = async ev => {
    ev.preventDefault();
    const g = id => document.getElementById(id).value.trim();
    const dept = DEPTS.find(d => d.id === g('vdept'));
    if (!dept) return toast('Select department.', 'err');
    const no = await nextPassNo(C.vp, 'VP', todayStr());
    await addDoc(C.vp, {
      pass_no: no, visitor_name: g('vn'), visitor_mobile: g('vm'), visitor_company: g('vc'),
      purpose: g('vpurp'), person_to_visit: g('vperson'), department_id: dept.id, department_name: dept.name,
      persons: Math.max(1, parseInt(g('vper') || '1')), vehicle_no: g('vveh').toUpperCase(),
      pass_date: todayStr(), status: pendingStatus('vp', dept.id), created_by: me.name, created_by_uid: me.uid, created_at: nowStr(),
    });
    toast(`Visitor pass ${no} created — sent for approval (${flowLabel('vp', dept.id)}).`);
    ev.target.reset();
    document.getElementById('regbox').open = false;
  };

  const applyFilter = () => {
    const s = (document.getElementById('gfilter').value || '').toLowerCase();
    c.querySelectorAll('.gatecard, tr.vflt').forEach(x => x.style.display = x.textContent.toLowerCase().includes(s) ? '' : 'none');
  };
  document.getElementById('gfilter').oninput = applyFilter;

  const today = todayStr();
  const canDelete = p => PENDING.includes(p.status) && ['security', 'admin'].includes(me.role);
  const delBtn = (kind, p) => canDelete(p) ? ` <button class="btn sm red" data-g="${kind}-del" data-id="${p.id}" title="Delete this entry (possible only before approval)">🗑 Delete</button>` : '';
  const viewL = (kind, p) => `<a class="btn sm gray" href="#/pass/${kind}/${p.id}" title="See full details — who approved, remarks, timings">👁 View</a>`;
  const gateBtn = (kind, p) => {
    if (kind === 'gp') {
      if (p.status === 'APPROVED' && p.pass_date === today) return `<span class="gact">${viewL(kind, p)} <button class="btn big green" data-g="gp-out" data-id="${p.id}">OUT →</button></span>`;
      if (p.status === 'OUT' && p.pass_type === 'returnable') return `<span class="gact">${viewL(kind, p)} <button class="btn xl" data-g="gp-in" data-id="${p.id}">← IN</button></span>`;
      if (p.status === 'OUT') return `<span class="gact">${viewL(kind, p)} <span class="badge b-gray">Early exit — no return</span></span>`;
    } else {
      if (p.status === 'APPROVED' && p.pass_date === today) return `<span class="gact">${viewL(kind, p)} <button class="btn big green" data-g="vp-in" data-id="${p.id}">IN →</button>${canCancelVp(p) ? ` <button class="btn sm red" data-g="vp-cancel" data-id="${p.id}" title="Caller cancels / no-show — cancel this expected pass (security: only for entries YOU created; never possible after IN)">❌ Cancel</button>` : ''}</span>`;
      if (p.status === 'VISITING') return `<span class="gact">${viewL(kind, p)} <button class="btn xl" data-g="vp-out" data-id="${p.id}">← OUT</button></span>`;
    }
    return `<span class="gact">${delBtn(kind, p)}${viewL(kind, p)}</span>`;
  };

  document.body.onclick = async ev => {
    const b = ev.target.closest('[data-g]'); if (!b) return;
    if (b.dataset.g === 'gp-del' || b.dataset.g === 'vp-del') {
      if (!confirm('Delete this entry? This is only possible while it is waiting for approval.')) return;
      await deleteDoc(doc(db, b.dataset.g === 'gp-del' ? 'employee_passes' : 'visitor_passes', b.dataset.id));
      toast('Entry deleted.');
      return;
    }
    if (b.dataset.g === 'vp-cancel') {           // expected visitor cancelled / did not show up
      const s = await getDoc(doc(db, 'visitor_passes', b.dataset.id));
      if (s.exists() && canCancelVp(s.data())) await cancelVisitorPass(s.id, s.data());
      return;
    }
    const map = {
      'gp-out': ['employee_passes', p => p.pass_type === 'early_exit'
        ? { status: 'CLOSED', gate_out_at: nowStr(), gate_out_by: me.name }
        : { status: 'OUT', gate_out_at: nowStr(), gate_out_by: me.name }],
      'gp-in': ['employee_passes', () => ({ status: 'CLOSED', gate_in_at: nowStr(), gate_in_by: me.name })],
      'vp-in': ['visitor_passes', () => ({ status: 'VISITING', gate_in_at: nowStr(), gate_in_by: me.name })],
      'vp-out': ['visitor_passes', () => ({ status: 'CLOSED', gate_out_at: nowStr(), gate_out_by: me.name })],
    };
    const [col, make] = map[b.dataset.g] || [];
    if (!col) return;
    const ref = doc(db, col, b.dataset.id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    await updateDoc(ref, make(snap.data()));
    toast('Marked.');
  };

  let gpRows = null, vpRows = null;
  const vRow = (p, extra) => `<div class="gatecard"><div>
    <div class="gn">${esc(p.visitor_name)} <span class="muted">(${esc(p.visitor_company) || '—'})</span> ${extra || ''}</div>
    <div class="gm">${esc(p.pass_no)} · to meet <b>${esc(p.person_to_visit)}</b> (${esc(p.department_name)}) · ${esc(p.purpose)}
    ${p.vehicle_no ? ' · 🚗 ' + esc(p.vehicle_no) : ''}${p.persons > 1 ? ' · 👥 ' + p.persons : ''}${p.gate_note ? ' · 📦 ' + esc(p.gate_note) : ''}
    ${p.gate_in_at ? ' · entered <b>' + fmtDT(p.gate_in_at) + '</b> (' + (minsBetween(p.gate_in_at, null) || 0) + ' min)' : ''}</div></div>
    <div>${gateBtn('vp', p)}</div></div>`;

  const renderVp = () => {
    const t = todayStr();
    const wait = vpRows.filter(p => PENDING.includes(p.status) && p.pass_date === t);
    const ready = vpRows.filter(p => p.status === 'APPROVED' && p.pass_date === t);
    const inside = vpRows.filter(p => p.status === 'VISITING').sort((a, b) => (a.gate_in_at || '').localeCompare(b.gate_in_at || ''));
    const left = vpRows.filter(p => p.status === 'CLOSED' && p.pass_date === t).sort((a, b) => (b.gate_out_at || '').localeCompare(a.gate_out_at || ''));
    document.getElementById('c-vis').textContent = inside.length;
    document.getElementById('vcol').innerHTML = `
      <div class="section" style="border-left:6px solid var(--amber)">
        <div class="ghead"><h2>🧍 Visitors — waiting / expected</h2><span class="gcount">${wait.length + ready.length}</span></div>
        ${wait.map(p => vRow(p, badge(p.status))).join('')}${ready.map(p => vRow(p, '<span class="badge b-green">Approved</span>')).join('') || (!wait.length ? '<p class="gempty">No visitors waiting or expected.</p>' : '')}
        ${inside.length ? '<div class="ghead" style="margin-top:14px"><h2>🏢 Visitors inside now</h2><span class="gcount">' + inside.length + '</span></div>' + inside.map(p => vRow(p)).join('') : ''}
        ${left.length ? `<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:700">↩️ Left today (${left.length})</summary><table class="tbl" style="margin-top:8px"><tr><th>Pass</th><th>Visitor</th><th>Met</th><th>In</th><th>Out</th><th></th></tr>
          ${left.map(p => `<tr class="vflt"><td><b>${esc(p.pass_no)}</b></td><td>${esc(p.visitor_name)}</td><td>${esc(p.person_to_visit)}</td><td>${fmtDT(p.gate_in_at)}</td><td>${fmtDT(p.gate_out_at)}</td><td class="nowrap">${viewL('vp', p)}</td></tr>`).join('')}</table></details>` : ''}
      </div>`;
  };

  const renderGp = () => {
    const t = todayStr();
    const ready = gpRows.filter(p => p.status === 'APPROVED' && p.pass_date === t);
    const out = gpRows.filter(p => p.status === 'OUT').sort((a, b) => (a.gate_out_at || '').localeCompare(b.gate_out_at || ''));
    const closed = gpRows.filter(p => p.status === 'CLOSED' && p.pass_date === t);
    const waitp = gpRows.filter(p => PENDING.includes(p.status) && p.pass_date === t);
    document.getElementById('c-ready').textContent = ready.length;
    document.getElementById('c-out').textContent = out.length;
    document.getElementById('ecol').innerHTML = `
      <div class="section" style="border-left:6px solid var(--green)">
        <div class="ghead"><h2>✅ Ready to go OUT</h2><span class="gcount">${ready.length}</span></div>
        ${ready.length ? ready.map(p => `<div class="gatecard"><div>
          <div class="gn">${esc(p.employee_name)} <span class="muted">(${esc(p.employee_code)} · ${esc(p.department_name)})</span></div>
          <div class="gm">${esc(p.pass_no)} · ${p.pass_type === 'returnable' ? 'Returnable' : '⚠️ EARLY EXIT — not returning'} · planned <b>${esc(p.out_time)}</b>${p.return_time ? ' → ' + esc(p.return_time) : ''} · ${esc(p.reason)}</div></div>
          ${gateBtn('gp', p)}</div>`).join('') : '<p class="gempty">Nothing approved right now.</p>'}
      </div>
      <div class="section" style="border-left:6px solid var(--purple)">
        <div class="ghead"><h2>🚶 Employees OUTSIDE</h2><span class="gcount">${out.length}</span></div>
        ${out.length ? out.map(p => {
          const od = p.return_time && (t + ' ' + p.return_time) < nowStr();
          return `<div class="gatecard ${od ? 'od' : ''}"><div>
            <div class="gn">${esc(p.employee_name)} <span class="muted">(${esc(p.department_name)})</span>${od ? ' <span class="badge b-od">OVERDUE</span>' : ''}</div>
            <div class="gm">${esc(p.pass_no)} · out at <b>${fmtDT(p.gate_out_at)}</b>${p.return_time ? ' · expected back <b>' + esc(p.return_time) + '</b>' : ''} · ${esc(p.reason)}</div></div>
            ${gateBtn('gp', p)}</div>`;
        }).join('') : '<p class="gempty">Nobody outside.</p>'}
      </div>
      <div class="section">
        <details><summary style="cursor:pointer;font-weight:700">↩️ Completed today (${closed.length}) · ⏳ Pending (${waitp.length})</summary>
        ${closed.length ? `<table class="tbl" style="margin-top:8px"><tr><th>Pass</th><th>Employee</th><th>Dept</th><th>Out</th><th>In</th><th></th></tr>
          ${closed.map(p => `<tr class="vflt"><td><b>${esc(p.pass_no)}</b></td><td>${esc(p.employee_name)}</td><td>${esc(p.department_name)}</td><td>${fmtDT(p.gate_out_at)}</td><td>${fmtDT(p.gate_in_at) || '—'}</td><td class="nowrap">${viewL('gp', p)}</td></tr>`).join('')}</table>` : '<p class="gempty">None yet.</p>'}
        ${waitp.length ? `<table class="tbl" style="margin-top:8px"><tr><th>Pass</th><th>Employee</th><th>Status</th><th></th></tr>
          ${waitp.map(p => `<tr class="vflt"><td><b>${esc(p.pass_no)}</b></td><td>${esc(p.employee_name)}</td><td>${badge(p.status)}</td><td class="nowrap">${delBtn('gp', p)}<a class="btn sm gray" href="#/pass/gp/${p.id}">View</a></td></tr>`).join('')}</table>` : ''}
        </details>
      </div>`;
  };

  const renderAll = () => {
    if (vpRows) renderVp();
    if (gpRows) renderGp();
    const waitN = (vpRows || []).filter(p => PENDING.includes(p.status) && p.pass_date === todayStr()).length
      + (gpRows || []).filter(p => PENDING.includes(p.status) && p.pass_date === todayStr()).length;
    const w = document.getElementById('c-wait'); if (w) w.textContent = waitN;
    applyFilter();
  };
  listen(C.vp, snap => { vpRows = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); });
  listen(C.gp, snap => { gpRows = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderAll(); });
  tick(30000, renderAll);   // refresh "minutes inside/outside" + overdue flags live
}

/* ========================================================= views: dashboard */
async function vDashboard() {
  const c = frame('📊 Dashboard');
  c.innerHTML = 'Loading…';
  const scopeDept = me.role === 'dept_head' ? me.department_id : null;
  const redraw = (gpRows, vpRows) => {
    const t = todayStr();
    if (scopeDept) { gpRows = gpRows.filter(p => p.department_id === scopeDept); vpRows = vpRows.filter(p => p.department_id === scopeDept); }
    const out = gpRows.filter(p => p.status === 'OUT');
    const vis = vpRows.filter(p => p.status === 'VISITING');
    const overdue = out.filter(p => p.return_time && (t + ' ' + p.return_time) < nowStr()).length;
    const cards = [
      ['Passes raised today', gpRows.filter(p => p.pass_date === t).length, 'c-ink'],
      ['Pending Dept Head', gpRows.filter(p => p.status === 'PENDING_HOD' || (p.status === 'PENDING_BOTH' && !p.hod_by)).length, 'c-amber'],
      ['Pending HR', gpRows.filter(p => p.status === 'PENDING_HR' || (p.status === 'PENDING_BOTH' && !p.hr_by)).length, 'c-blue'],
      ['Approved (at gate)', gpRows.filter(p => p.status === 'APPROVED' && p.pass_date === t).length, 'c-green'],
      ['OUT right now', out.length, 'c-purple'],
      ['Overdue returns', overdue, 'c-red'],
      ['Completed today', gpRows.filter(p => p.status === 'CLOSED' && p.pass_date === t).length, 'c-ink'],
      ['Visitors inside now', vis.length, 'c-amber'],
      ['Visitors expected today', vpRows.filter(p => p.status === 'APPROVED' && p.pass_date === t).length, 'c-green'],
      ['Upcoming visitors (future)', vpRows.filter(p => p.status === 'APPROVED' && p.pass_date > t).length, 'c-blue'],
    ];
    const byDept = {};
    out.forEach(p => byDept[p.department_name] = (byDept[p.department_name] || 0) + 1);
    const maxOut = Math.max(1, ...Object.values(byDept));
    const recent = [...gpRows].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')).slice(0, 12);
    c.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:10px"><span class="live">LIVE — updates itself, no refresh needed</span></div>
    <div class="grid cards">${cards.map(([l, n, cls]) => `<div class="card kpi ${cls}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('')}</div>
    <div style="height:18px"></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(360px,1fr))">
      <div class="section" style="margin:0"><h2>🚶 Employees OUT now (${out.length})</h2>
        ${out.length ? `<table class="tbl"><tr><th>Employee</th><th>Dept</th><th>Out at</th><th>Expected</th><th>Outside</th></tr>
        ${out.map(p => `<tr><td><b>${esc(p.employee_name)}</b></td><td>${esc(p.department_name)}</td><td class="nowrap">${fmtDT(p.gate_out_at)}</td>
        <td>${esc(p.return_time) || '—'} ${p.return_time && (t + ' ' + p.return_time) < nowStr() ? '<span class="badge b-od">LATE</span>' : ''}</td>
        <td><b>${minsBetween(p.gate_out_at, null) || 0} min</b></td></tr>`).join('')}</table>` : '<p class="muted">✅ Nobody is outside.</p>'}</div>
      <div class="section" style="margin:0"><h2>🧍 Visitors inside now (${vis.length})</h2>
        ${vis.length ? `<table class="tbl"><tr><th>Visitor</th><th>To meet</th><th>Entered</th><th>Inside</th></tr>
        ${vis.map(p => `<tr><td><b>${esc(p.visitor_name)}</b><br><span class="muted small">${esc(p.visitor_company) || ''}</span></td>
        <td>${esc(p.person_to_visit)}</td><td class="nowrap">${fmtDT(p.gate_in_at)}</td><td><b>${minsBetween(p.gate_in_at, null) || 0} min</b></td></tr>`).join('')}</table>` : '<p class="muted">No visitors inside.</p>'}</div>
      <div class="section" style="margin:0"><h2>🏬 Employees OUT — department wise</h2>
        ${Object.keys(byDept).length ? Object.entries(byDept).sort((a, b) => b[1] - a[1]).map(([d, n]) =>
          `<div class="bar-row"><div class="bl">${esc(d)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(4, Math.round(n / maxOut * 100))}%"></div></div><div class="bar-val">${n}</div></div>`).join('')
        : '<p class="muted">No one is out — bars appear when employees go out.</p>'}</div>
    </div><div style="height:18px"></div>
    <div class="section"><h2>🕒 Latest activity</h2>
      <div class="twrap"><table class="tbl"><tr><th>Pass No</th><th>Employee</th><th>Dept</th><th>Date</th><th>Type</th><th>Status</th><th></th></tr>
      ${recent.map(p => `<tr><td class="nowrap"><b>${esc(p.pass_no)}</b></td><td>${esc(p.employee_name)}</td><td>${esc(p.department_name)}</td>
      <td class="nowrap">${fmtD(p.pass_date)}</td><td>${p.pass_type === 'returnable' ? 'Returnable' : 'Early Exit'}</td>
      <td>${badge(p.status)}</td><td><a class="btn sm gray" href="#/pass/gp/${p.id}">View</a></td></tr>`).join('')}</table></div></div>`;
  };
  let gp = null, vp = null;
  const redrawAll = () => { if (gp && vp) redraw(gp, vp); };
  listen(C.gp, s => { gp = s.docs.map(d => ({ id: d.id, ...d.data() })); redrawAll(); });
  listen(C.vp, s => { vp = s.docs.map(d => ({ id: d.id, ...d.data() })); redrawAll(); });
  tick(30000, redrawAll);   // keep minutes / overdue flags moving even without data changes
}

/* ========================================================== views: reports */
function vReports() {
  const q = new URLSearchParams(location.hash.split('?')[1] || '');
  const f = {
    kind: q.get('kind') === 'visitors' ? 'visitors' : 'employee',
    from: q.get('from') || daysAgo(30), to: q.get('to') || todayStr(),
    dept: q.get('dept') || (me.role === 'dept_head' ? me.department_id : ''),
    status: q.get('status') || '', ptype: q.get('ptype') || '', s: q.get('q') || '',
  };
  if (me.role === 'dept_head') f.dept = me.department_id;
  const c = frame('📑 Reports & Excel Export');
  const link = k => `#/reports?kind=${k}&from=${f.from}&to=${f.to}&dept=${f.dept}&status=${f.status}&ptype=${f.ptype}&q=${encodeURIComponent(f.s)}`;
  c.innerHTML = `<div class="section">
    <div class="btnrow" style="margin-bottom:14px">
      <a class="btn ${f.kind === 'employee' ? '' : 'gray'}" href="${link('employee')}">👷 Employee passes</a>
      <a class="btn ${f.kind === 'visitors' ? '' : 'gray'}" href="${link('visitors')}">🧍 Visitor passes</a></div>
    <div class="filters" id="ff">
      <div class="fg"><label>From</label><input type="date" id="from" value="${f.from}"></div>
      <div class="fg"><label>To</label><input type="date" id="to" value="${f.to}"></div>
      <div class="fg"><label>Department</label><select id="dept" ${me.role === 'dept_head' ? 'disabled' : ''}>
        <option value="">All</option>${DEPTS.map(d => `<option value="${d.id}" ${f.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></div>
      <div class="fg"><label>Status</label><select id="status"><option value="">All</option>
        ${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      ${f.kind === 'employee' ? `<div class="fg"><label>Type</label><select id="ptype"><option value="">All</option>
        <option value="returnable" ${f.ptype === 'returnable' ? 'selected' : ''}>Returnable</option>
        <option value="early_exit" ${f.ptype === 'early_exit' ? 'selected' : ''}>Early Exit</option></select></div>` : ''}
      <div class="fg"><label>Search</label><input type="text" id="s" value="${esc(f.s)}" placeholder="${f.kind === 'employee' ? 'ID or name' : 'visitor / person / company'}"></div>
      <button class="btn" id="apply">🔍 Apply</button>
      <button class="btn green" id="xl">⬇️ Download Excel</button>
    </div>
    <p class="muted small" id="cnt"></p><div class="twrap" id="rt">Loading…</div></div>`;

  let rows = [];
  const runQuery = async () => {
    const col = f.kind === 'visitors' ? C.vp : C.gp;
    const snap = await getDocs(query(col, where('pass_date', '>=', f.from), where('pass_date', '<=', f.to)));
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (f.dept) rows = rows.filter(r => r.department_id === f.dept);
    if (f.status) rows = rows.filter(r => r.status === f.status);
    if (f.ptype && f.kind === 'employee') rows = rows.filter(r => r.pass_type === f.ptype);
    if (f.s) { const s = f.s.toLowerCase(); rows = rows.filter(r => f.kind === 'employee'
      ? ((r.employee_name || '') + (r.employee_code || '')).toLowerCase().includes(s)
      : ((r.visitor_name || '') + (r.person_to_visit || '') + (r.visitor_company || '')).toLowerCase().includes(s)); }
    rows.sort((a, b) => (b.pass_date + (b.created_at || '')).localeCompare(a.pass_date + (a.created_at || '')));
    renderRows();
  };
  const renderRows = () => {
    const el = document.getElementById('rt'); document.getElementById('cnt').textContent = `${rows.length} record(s). Excel includes detail + department summary sheets.`;
    if (!rows.length) { el.innerHTML = '<p class="muted">No records for these filters.</p>'; return; }
    if (f.kind === 'employee') {
      el.innerHTML = `<table class="tbl"><tr><th>Pass No</th><th>Date</th><th>Emp</th><th>Dept</th><th>Type</th><th>Planned</th><th>Actual Out → In</th><th>Min</th><th>Status</th></tr>
      ${rows.map(p => `<tr><td class="nowrap"><a href="#/pass/gp/${p.id}"><b>${esc(p.pass_no)}</b></a></td><td class="nowrap">${fmtD(p.pass_date)}</td>
        <td>${esc(p.employee_name)}<br><span class="muted small">${esc(p.employee_code)}</span></td><td>${esc(p.department_name)}</td>
        <td>${p.pass_type === 'returnable' ? 'Returnable' : 'Early Exit'}</td><td class="nowrap">${esc(p.out_time)}${p.return_time ? '→' + esc(p.return_time) : ''}</td>
        <td class="nowrap">${fmtDT(p.gate_out_at)} → ${fmtDT(p.gate_in_at)}</td><td>${minsBetween(p.gate_out_at, p.gate_in_at) ?? '—'}</td><td>${badge(p.status)}</td></tr>`).join('')}</table>`;
    } else {
      el.innerHTML = `<table class="tbl"><tr><th>Pass No</th><th>Date</th><th>Visitor</th><th>From</th><th>To meet</th><th>Dept</th><th>Entry → Exit</th><th>Min</th><th>Status</th></tr>
      ${rows.map(p => `<tr><td class="nowrap"><a href="#/pass/vp/${p.id}"><b>${esc(p.pass_no)}</b></a></td><td class="nowrap">${fmtD(p.pass_date)}</td>
        <td>${esc(p.visitor_name)}</td><td>${esc(p.visitor_company) || '—'}</td><td>${esc(p.person_to_visit)}</td><td>${esc(p.department_name)}</td>
        <td class="nowrap">${fmtDT(p.gate_in_at)} → ${fmtDT(p.gate_out_at)}</td><td>${minsBetween(p.gate_in_at, p.gate_out_at) ?? '—'}</td><td>${badge(p.status)}</td></tr>`).join('')}</table>`;
    }
  };
  document.getElementById('apply').onclick = async () => {
    f.from = document.getElementById('from').value; f.to = document.getElementById('to').value;
    f.dept = document.getElementById('dept').value; f.status = document.getElementById('status').value;
    const pt = document.getElementById('ptype'); f.ptype = pt ? pt.value : '';
    f.s = document.getElementById('s').value.trim();
    history.replaceState(null, '', link(f.kind));
    await runQuery();
  };
  document.getElementById('xl').onclick = () => exportExcel(f, rows);
  runQuery();
}

async function exportExcel(f, rows) {
  if (!rows.length) return toast('Nothing to export.', 'warn');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(f.kind === 'employee' ? 'Gate Pass Detail' : 'Visitor Pass Detail');
  const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const cols = f.kind === 'employee'
    ? ['Pass No', 'Date', 'Emp ID', 'Employee', 'Department', 'Type', 'Purpose', 'Reason', 'Planned Out', 'Planned Return', 'HOD By', 'HOD At', 'HR By', 'HR At', 'Actual Out', 'Actual In', 'Min Out', 'Status']
    : ['Pass No', 'Date', 'Visitor', 'Mobile', 'From/Company', 'Purpose', 'Person to Visit', 'Department', 'Persons', 'Vehicle', 'HOD By', 'HR By', 'Entry(IN)', 'Exit(OUT)', 'Min Inside', 'Status'];
  ws.mergeCells(1, 1, 1, cols.length);
  const t = ws.getCell(1, 1); t.value = `${SETTINGS.company_name} — ${f.kind === 'employee' ? 'Gate Pass' : 'Visitor'} Report  (${f.from} → ${f.to})`;
  t.font = { bold: true, size: 14, color: { argb: 'FF1F3864' } };
  if (SETTINGS.logo_b64) {
    try {
      const imgId = wb.addImage({ base64: SETTINGS.logo_b64.split(',')[1], extension: 'png' });
      ws.addImage(imgId, { tl: { col: cols.length - 3, row: 0 }, ext: { width: 110, height: 42 } });
      ws.getRow(1).height = 36;
    } catch (e) { }
  }
  const hr = ws.getRow(3);
  cols.forEach((c, i) => { const cell = hr.getCell(i + 1); cell.value = c; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = headFill; cell.border = border; cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; ws.getColumn(i + 1).width = Math.max(12, c.length + 4); });
  ws.views = [{ state: 'frozen', ySplit: 3 }];
  const sLab = s => STATUS[s] ? STATUS[s][0] : s;
  rows.forEach(p => {
    const r = ws.addRow(f.kind === 'employee'
      ? [p.pass_no, p.pass_date, p.employee_code, p.employee_name, p.department_name, p.pass_type === 'returnable' ? 'Returnable' : 'Early Exit', p.purpose, p.reason, p.out_time, p.return_time || '—', p.hod_by || '—', p.hod_at || '—', p.hr_by || '—', p.hr_at || '—', p.gate_out_at || '—', p.gate_in_at || '—', minsBetween(p.gate_out_at, p.gate_in_at) ?? '—', sLab(p.status)]
      : [p.pass_no, p.pass_date, p.visitor_name, p.visitor_mobile || '—', p.visitor_company || '—', p.purpose, p.person_to_visit, p.department_name, p.persons || 1, p.vehicle_no || '—', p.hod_by || '—', p.hr_by || '—', p.gate_in_at || '—', p.gate_out_at || '—', minsBetween(p.gate_in_at, p.gate_out_at) ?? '—', sLab(p.status)]);
    r.eachCell(cell => cell.border = border);
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + rows.length, column: cols.length } };
  const ws2 = wb.addWorksheet('Department Summary');
  const agg = {};
  rows.forEach(p => { const d = p.department_name || '—'; agg[d] = agg[d] || { total: 0, trips: 0, mins: 0 }; agg[d].total++;
    const m = f.kind === 'employee' ? minsBetween(p.gate_out_at, p.gate_in_at) : minsBetween(p.gate_in_at, p.gate_out_at);
    if (['OUT', 'CLOSED', 'VISITING'].includes(p.status)) agg[d].trips++;
    if (m) agg[d].mins += m; });
  ws2.mergeCells(1, 1, 1, 4);
  ws2.getCell(1, 1).value = 'Department-wise Summary'; ws2.getCell(1, 1).font = { bold: true, size: 13, color: { argb: 'FF1F3864' } };
  const heads = ['Department', 'Total Passes', 'Trips/Entries Taken', 'Total Minutes'];
  const h2 = ws2.getRow(3);
  heads.forEach((h, i) => { const cell = h2.getCell(i + 1); cell.value = h; cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = headFill; cell.border = border; ws2.getColumn(i + 1).width = 22; });
  Object.keys(agg).sort().forEach(d => { const r = ws2.addRow([d, agg[d].total, agg[d].trips, agg[d].mins]); r.eachCell(c => c.border = border); });
  const tr = ws2.addRow(['ALL DEPARTMENTS', ...['total', 'trips', 'mins'].map(k => Object.values(agg).reduce((a, x) => a + x[k], 0))]);
  tr.font = { bold: true }; tr.eachCell(c => c.border = border);
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = `${f.kind === 'employee' ? 'gate_pass' : 'visitor_pass'}_report_${f.from}_to_${f.to}.xlsx`;
  a.click();
  toast('Excel downloaded.');
}

/* ====================================================== views: admin - users */
/* ================= bulk-upload helpers (tolerant reader for CSV *and* .xlsx) ================= */
function splitCsvLine(line, d) {          // quote-aware single-line split
  const out = []; let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') { q = !q; continue; }
    if (ch === d && !q) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}
async function readUserFile(file) {       // → array-of-arrays grid, header row first
  if (/\.xlsx$/i.test(file.name)) {
    if (!window.ExcelJS) throw new Error('Excel reader not loaded — needs internet once, then it is cached');
    const wb = new ExcelJS.Workbook();
    const buf = file.arrayBuffer ? await file.arrayBuffer()
      : await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsArrayBuffer(file); });
    await wb.xlsx.load(buf);
    const ws = (wb.worksheets || wb.sheets || [])[0];
    if (!ws) throw new Error('No sheet found in the Excel file');
    const grid = [];
    ws.eachRow(r => grid.push(r.values.slice(1).map(v => v == null ? '' : String(v).trim())));
    return grid.filter(g => g.some(x => x !== ''));
  }
  let text = await new Promise((res, rej) => {
    const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = () => rej(new Error('cannot read file')); r.readAsText(file);
  });
  text = text.replace(/^\uFEFF/, '').trim();
  if (!text) throw new Error('The file is empty');
  const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const delim = (rawLines[0].match(/;/g) || []).length > (rawLines[0].match(/,/g) || []).length ? ';' : ',';   // Excel in some regions saves with ;
  return rawLines.map(l => splitCsvLine(l, delim));
}
const HEAD_ALIASES = {                    // accepted column names (all lowercase, spaces not _ )
  user_id: ['user id', 'user_id', 'userid', 'id', 'emp id', 'empid', 'employee id', 'emp code', 'code', 'login id'],
  name: ['name', 'full name', 'employee name', 'user name'],
  password: ['password', 'pass', 'pwd'],
  role: ['role', 'type', 'designation'],
  department: ['department', 'dept', 'department name', 'dept name'],
  email: ['email', 'mail', 'e mail', 'email id'],
  mobile: ['mobile', 'mobile no', 'mobile number', 'phone', 'phone no', 'contact', 'contact no'],
};
const ROLE_NORM = s => {
  const k = (s || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  if (!k) return 'employee';                                                            // blank role → employee
  if (['employee', 'emp', 'worker', 'staff', 'operator', 'labour', 'labor'].includes(k)) return 'employee';
  if (['dept head', 'hod', 'department head', 'head', 'depthead', 'dh'].includes(k)) return 'dept_head';
  if (['hr', 'human resources', 'human resource'].includes(k)) return 'hr';
  if (['security', 'sec', 'guard', 'security guard', 'watchman'].includes(k)) return 'security';
  return null;                                                                          // unknown → row reported as bad
};

function vAdminUsers() {
  const hrMode = me.role === 'hr';        // HR gets an "add-only" version (enabled from ⚙️ Settings → Permissions)
  const roleOpts = hrMode ? ['employee', 'dept_head', 'security'] : Object.keys(ROLE_LABEL);
  const c = frame(hrMode ? '👥 Add Users (new joiners)' : '👥 User Management');
  c.innerHTML = `${hrMode ? `<div class="section" style="border-left:6px solid var(--green);padding:10px 16px">✅ You can add <b>employee / Dept Head / security</b> logins here. Editing, disabling &amp; deleting users is <b>admin-only</b>.</div>` : ''}
  <div class="section"><h2 id="formtitle">➕ Add new user</h2>
    <div id="uok" class="flash f-ok" style="display:none;margin-bottom:10px"></div>
    <div id="uerr" class="flash f-err" style="display:none;margin-bottom:10px"></div>
    <form id="uf"><div class="frow c3">
      <div id="fw-uid"><label class="fl">User ID (login) *</label><input type="text" id="fu_id" placeholder="SGE001 / SEC001 / CON001" required></div>
      <div><label class="fl">Full Name *</label><input type="text" id="fname" required></div>
      <div><label class="fl">Role *</label><select id="frole">${roleOpts.map(r => `<option value="${r}">${ROLE_LABEL[r]}</option>`).join('')}</select></div>
      <div><label class="fl">Department</label><select id="fdept"><option value="">— none —</option>
        ${DEPTS.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></div>
      <div><label class="fl">Email (contact)</label><input type="text" id="femail"></div>
      <div><label class="fl">Mobile *</label><input type="text" id="fmobile"></div>
      <div><label class="fl">Password *</label><input type="text" id="fpw" placeholder="e.g. welcome123" required></div>
    </div><div style="height:12px"></div>
    <button class="btn" type="submit" id="fub">➕ Create User</button>
    <button class="btn gray" type="button" id="fuc" style="display:none">Cancel Edit</button></form></div>
  <div class="section"><h2>📤 Bulk upload users (CSV or Excel)</h2>
    <p class="muted small">Columns: <b>user_id, name, password, role, department, email, mobile</b> · role = employee / <b>hod</b> / hr / security (short forms work: <i>emp, worker, guard…</i>) · blank/short password → welcome123.<br>
    You can upload the <b>.csv</b> file <i>or your <b>.xlsx</b> Excel file directly</i> — after upload you get a <b>row-by-row report</b> showing exactly what was added and why anything was skipped. <a id="tmpl">⬇️ Download template</a></p>
    <div class="btnrow"><input type="file" id="csv" accept=".csv,.xlsx" style="flex:1;min-width:220px">
    <button class="btn" id="upcsv">📤 Upload</button><span id="csvname" class="muted small"></span></div><p class="small" id="csvmsg"></p></div>
  <div class="section"><h2>All users</h2><div class="twrap" id="ulist">Loading…</div></div>
  ${hrMode ? '' : `<div class="section"><h2>🏬 Departments</h2>
    <div class="btnrow"><input type="text" id="dname" placeholder="New department name" style="max-width:280px">
    <button class="btn" id="dadd">Add</button></div>
    <p class="muted small">Each department can have its <b>own approval workflow</b> (or follow the global one from ⚙️ Settings).
    If a department has <b>no active Dept Head</b>, its passes automatically go straight to <b>HR</b>.</p>
    <div id="dlist" style="margin-top:10px" class="twrap"></div></div>`}`;

  let editUid = null;
  let usersCache = [];
  document.getElementById('tmpl').onclick = () => {
    const csv = 'user_id,name,password,role,department,email,mobile\nSGE001,Test Employee,welcome123,employee,Production,test@abc.com,9812345601\n';
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'users_template.csv'; a.click();
  };
  const resetForm = (keepMsg) => {
    editUid = null; document.getElementById('formtitle').textContent = '➕ Add new user';
    document.getElementById('fw-uid').style.display = ''; document.getElementById('fu_id').required = true; document.getElementById('fpw').required = true;
    document.getElementById('fub').textContent = '➕ Create User'; document.getElementById('fuc').style.display = 'none';
    document.getElementById('uf').reset();
    if (!keepMsg) { document.getElementById('uok').style.display = 'none'; document.getElementById('uerr').style.display = 'none'; }
  };
  document.getElementById('fuc').onclick = resetForm;

  document.getElementById('uf').onsubmit = async ev => {
    ev.preventDefault();
    const g = id => document.getElementById(id).value.trim();
    const name = g('fname'), role = g('frole'), dept = g('fdept') || null, email = g('femail'), mobile = g('fmobile'), pw = g('fpw');
    if (hrMode && (!hrCanAddUsers() || !['employee', 'dept_head', 'security'].includes(role)))
      return toast('HR can add only employee / Dept Head / security users (admin can switch this off in Settings).', 'err');
    if (['employee', 'dept_head'].includes(role) && !dept) return toast('Department required for employee / dept head.', 'err');
    document.getElementById('fub').disabled = true;
    try {
      if (editUid) {  // edit existing
        const patch = { name, role, department_id: dept, email, mobile };
        if (pw) { // admin is also resetting the password — do this FIRST, and be LOUD if it fails
          const errBox = document.getElementById('uerr');
          if (pw.length < 6) {
            errBox.style.display = ''; errBox.textContent = '⚠️ Password must be at least 6 characters. Nothing was saved — type a longer password and press Save again.';
            document.getElementById('fub').disabled = false; return;
          }
          try { await resetUserPw(editUid, pw); }
          catch (e) {
            errBox.style.display = ''; errBox.textContent = '⚠️ Password NOT changed: ' + (e.friendly || e.message) + ' — Profile details were also not saved. Fix this and press 💾 Save Changes again.';
            document.getElementById('fub').disabled = false; return;
          }
        }
        await updateDoc(doc(db, 'users', editUid), patch);
        syncDeptCounts().then(renderDepts);
        if (pw) {   // staying green confirmation — shows the new password so admin can note it down
          const who = document.getElementById('formtitle').textContent.replace('✏️ Edit user: ', '');
          resetForm(true);
          const okBox = document.getElementById('uok'); okBox.style.display = '';
          okBox.innerHTML = '✅ <b>Password changed for ' + esc(who) + ' — VERIFIED with a test login ✓</b><br>New login password: <b>' + esc(pw) + '</b> &nbsp;(note it down / tell the user in person — you cannot see it again).';
          toast('Password changed for ' + who + '.');
        } else { toast('User updated.'); resetForm(); }
      } else {
        const uidInput = g('fu_id').toUpperCase();
        if (!uidInput) { const eb = document.getElementById('uerr'); eb.style.display = ''; eb.textContent = '⚠️ User ID is required.'; return; }
        const dirRef = doc(db, 'directory', uidInput.toLowerCase());
        if ((await getDoc(dirRef)).exists()) {
          const eb = document.getElementById('uerr'); eb.style.display = '';
          eb.innerHTML = '⚠️ User ID <b>' + esc(uidInput) + ' already exists.</b> To reset his password, use the <b>✏️ pencil</b> on his row in the list below — do not create a new user.';
          toast(`User ID ${uidInput} already exists.`, 'err'); return;
        }
        await createUser({ user_id: uidInput, name, role, department_id: dept, email, mobile, pw });
        syncDeptCounts().then(renderDepts);
        renderUsers();                       // show the new user in the table immediately
        document.getElementById('uok').style.display = 'none'; document.getElementById('uerr').style.display = 'none';
        toast(`User ${uidInput} created.`);
        ev.target.reset();
      }
    } catch (e) {
      toast(e.code === 'ghost-account' ? e.message : 'Error: ' + (e.code || e.message), 'err');
      const eb = document.getElementById('uerr'); eb.style.display = '';
      eb.textContent = '⚠️ ' + (e.code === 'ghost-account' ? e.message : 'Save FAILED: ' + (e.friendly || e.code || e.message) + ' — nothing was saved. Fix this and press Save again.');
    } finally { document.getElementById('fub').disabled = false; }   // button can never get stuck
  };

  async function renderUsers() {
    const snap = await getDocs(C.users);
    const el = document.getElementById('ulist'); if (!el) return;
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.role + a.user_id).localeCompare(b.role + b.user_id));
    usersCache = rows;
    el.innerHTML = `${hrMode ? '' : `<div class="btnrow" style="margin-bottom:8px">
        <button class="btn sm red" id="bulkdel" disabled title="Delete all ticked users at once">🗑 Delete selected (0)</button>
        <span class="muted small">☑️ Tick the boxes to select many users → delete them in one click.</span></div>`}
      <table class="tbl"><tr>${hrMode ? '' : '<th style="width:34px"><input type="checkbox" id="selall" title="Select all" style="width:auto"></th>'}<th>User ID</th><th>Name</th><th>Role</th><th>Department</th><th>Mobile</th><th>Email</th><th>Status</th>${hrMode ? '' : '<th>Actions</th>'}</tr>
      ${rows.map(u => `<tr>
        ${hrMode ? '' : `<td><input type="checkbox" class="usel" data-sel="${u.id}" style="width:auto" ${u.user_id === 'ADMIN' ? 'disabled' : ''}></td>`}
        <td><b>${esc(u.user_id)}</b></td><td>${esc(u.name)}</td>
        <td><span class="badge ${u.role === 'dept_head' ? 'b-blue' : u.role === 'hr' ? 'b-green' : u.role === 'security' ? 'b-purple' : u.role === 'admin' ? 'b-red' : 'b-gray'}">${ROLE_LABEL[u.role]}</span></td>
        <td>${esc(deptName(u.department_id))}</td><td>${esc(u.mobile) || '—'}</td><td>${esc(u.email) || '—'}</td>
        <td><span class="badge ${u.active !== false ? 'b-green' : 'b-red'}">${u.active !== false ? 'Active' : 'Disabled'}</span></td>
        ${hrMode ? '' : `<td class="nowrap">
          <button class="btn sm" data-e="${u.id}">✏️</button>
          ${u.user_id !== 'ADMIN' ? `<button class="btn sm gray" data-t="${u.id}">${u.active !== false ? '⛔' : '✔'}</button>
          <button class="btn sm red" data-d="${u.id}">🗑</button>` : ''}
        </td>`}</tr>`).join('')}</table>`;
    /* everything below (edit / disable / single & bulk delete) is admin-only */
    if (hrMode) return;
    /* multi-select → bulk delete */
    const boxes = [...el.querySelectorAll('.usel:not([disabled])')];
    const bulkBtn = document.getElementById('bulkdel'), sa = document.getElementById('selall');
    const refreshSel = () => {
      const n = boxes.filter(b => b.checked).length;
      bulkBtn.disabled = !n; bulkBtn.textContent = `🗑 Delete selected (${n})`;
      sa.checked = n > 0 && n === boxes.length;
    };
    boxes.forEach(b => b.onchange = refreshSel);
    sa.onchange = () => { boxes.forEach(b => b.checked = sa.checked); refreshSel(); };
    bulkBtn.onclick = async () => {
      const ids = boxes.filter(b => b.checked).map(b => b.dataset.sel);
      if (!ids.length) return;
      const names = ids.map(id => (rows.find(x => x.id === id) || {}).user_id || id);
      if (!confirm(`Delete ${ids.length} selected user(s): ${names.join(', ')}?\nTheir pass history stays, but they cannot log in again.`)) return;
      bulkBtn.disabled = true;
      let done = 0;
      for (const id of ids) {
        const u = rows.find(x => x.id === id); if (!u) continue;
        try {
          await deleteDoc(doc(db, 'users', id));
          await deleteDoc(doc(db, 'creds', id)).catch(() => { });
          const dirRef = doc(db, 'directory', (u.user_id || '').toLowerCase());
          if ((await getDoc(dirRef)).exists()) await deleteDoc(dirRef);
          done++;
        } catch (e) { console.error(e); toast('Could not delete ' + (u.user_id || id), 'err'); }
      }
      toast(`${done} user(s) deleted.`);
      renderUsers(); syncDeptCounts().then(renderDepts);
    };
    el.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
      const u = rows.find(x => x.id === b.dataset.e); editUid = u.id;
      document.getElementById('formtitle').textContent = '✏️ Edit user: ' + u.user_id;
      document.getElementById('fw-uid').style.display = 'none';
      document.getElementById('fu_id').required = false;   // hidden box must not block Save in Chrome!
      document.getElementById('fpw').required = false; document.getElementById('fpw').placeholder = 'new password, min 6 (blank = unchanged)';
      document.getElementById('uok').style.display = 'none'; document.getElementById('uerr').style.display = 'none';
      document.getElementById('fname').value = u.name; document.getElementById('frole').value = u.role;
      document.getElementById('fdept').value = u.department_id || '';
      document.getElementById('femail').value = u.email || ''; document.getElementById('fmobile').value = u.mobile || '';
      document.getElementById('fpw').value = '';
      document.getElementById('fub').textContent = '💾 Save Changes'; document.getElementById('fuc').style.display = '';
      window.scrollTo(0, 0);
    });
    el.querySelectorAll('[data-t]').forEach(b => b.onclick = async () => {
      const u = rows.find(x => x.id === b.dataset.t);
      const to = u.active === false;
      await updateDoc(doc(db, 'users', u.id), { active: to });
      const dirRef = doc(db, 'directory', (u.user_id || '').toLowerCase());
      if ((await getDoc(dirRef)).exists()) await updateDoc(dirRef, { active: to });
      toast(`${u.user_id} ${to ? 'activated' : 'disabled'}.`); renderUsers(); syncDeptCounts().then(renderDepts);
    });
    el.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
      const u = rows.find(x => x.id === b.dataset.d);
      if (!confirm(`Delete user ${u.user_id} (${u.name})? Their pass history stays.`)) return;
      await deleteDoc(doc(db, 'users', u.id));
      await deleteDoc(doc(db, 'creds', u.id)).catch(() => { });
      const dirRef = doc(db, 'directory', (u.user_id || '').toLowerCase());
      if ((await getDoc(dirRef)).exists()) await deleteDoc(dirRef);
      toast('User deleted.'); renderUsers(); syncDeptCounts().then(renderDepts);
    });
  }
  renderUsers();

  const renderDepts = () => {
    const el = document.getElementById('dlist'); if (!el) return;
    el.innerHTML = `<table class="tbl"><tr><th>Department</th><th>People</th><th>Approval workflow (this dept)</th><th>Actions</th></tr>
    ${DEPTS.map(d => `<tr>
      <td><b>${esc(d.name)}</b></td>
      <td class="nowrap">${d.user_count || 0} user(s)${(d.hod_count || 0) === 0 ? ' · <span class="badge b-red">no Dept Head → HR approves</span>' : ''}</td>
      <td><select data-wf="${d.id}" style="min-width:210px">
        <option value="" ${!d.workflow ? 'selected' : ''}>🌐 Use global setting</option>
        <option value="both" ${d.workflow === 'both' ? 'selected' : ''}>Dept Head → HR (2-step)</option>
        <option value="hod" ${d.workflow === 'hod' ? 'selected' : ''}>Dept Head only</option>
        <option value="hr" ${d.workflow === 'hr' ? 'selected' : ''}>HR only</option></select></td>
      <td class="nowrap"><button class="btn sm gray" data-ren="${d.id}">✏️ Rename</button>
      <button class="btn sm red" data-ddel="${d.id}">🗑 Delete</button></td></tr>`).join('')}</table>`;
    el.querySelectorAll('[data-wf]').forEach(s => s.onchange = async () => {
      await updateDoc(doc(db, 'departments', s.dataset.wf), { workflow: s.value });
      await loadDepts(); toast('Dept workflow saved.'); renderDepts();
    });
    el.querySelectorAll('[data-ren]').forEach(b => b.onclick = async () => {
      const d = DEPTS.find(x => x.id === b.dataset.ren); if (!d) return;
      const n = prompt('Rename department:', d.name); if (!n || !n.trim() || n.trim() === d.name) return;
      if (DEPTS.some(x => x.id !== d.id && x.name.toLowerCase() === n.trim().toLowerCase())) return toast('A department with this name already exists.', 'err');
      await updateDoc(doc(db, 'departments', d.id), { name: n.trim() });
      await loadDepts(); toast('Department renamed. (Old passes keep the old name in history.)'); vAdminUsers();
    });
    el.querySelectorAll('[data-ddel]').forEach(b => b.onclick = async () => {
      const d = DEPTS.find(x => x.id === b.dataset.ddel); if (!d) return;
      const inUse = usersCache.filter(u => u.department_id === d.id).length;
      if (inUse) return toast(`Cannot delete "${d.name}" — ${inUse} user(s) belong to it. Reassign or delete those users first.`, 'err');
      if (!confirm(`Delete department "${d.name}"? Past passes keep their records.`)) return;
      await deleteDoc(doc(db, 'departments', d.id));
      await loadDepts(); toast('Department deleted.'); vAdminUsers();
    });
  };

  const daddBtn = document.getElementById('dadd');      // absent in HR mode
  if (daddBtn) daddBtn.onclick = async () => {
    const n = document.getElementById('dname').value.trim();
    if (!n) return;
    if (DEPTS.some(d => d.name.toLowerCase() === n.toLowerCase())) return toast('Department exists.', 'err');
    await addDoc(C.depts, { name: n });
    await loadDepts(); toast('Department added.');
    vAdminUsers(); // re-render with new dept list
  };
  syncDeptCounts().then(renderDepts);

  const csvInp = document.getElementById('csv');
  csvInp.onchange = () => { document.getElementById('csvname').textContent = csvInp.files[0] ? '📄 ' + csvInp.files[0].name : ''; };
  document.getElementById('upcsv').onclick = async () => {
    const file = csvInp.files[0];
    if (!file) return toast('Choose your file first — CSV or Excel (.xlsx).', 'err');
    const msg = document.getElementById('csvmsg');
    msg.textContent = '⏳ Reading file…';
    let added = 0, updated = 0;
    const notes = [], bad = [];
    try {
      const grid = await readUserFile(file);
      if (!grid.length) throw new Error('The file is empty');
      const head = grid.shift().map(h => (h || '').toLowerCase().replace(/^\uFEFF/, '').replace(/[^a-z]+/g, ' ').trim());
      const colOf = key => head.findIndex(h => HEAD_ALIASES[key].includes(h));
      const CL = { uid: colOf('user_id'), name: colOf('name'), pw: colOf('password'), role: colOf('role'), dept: colOf('department'), email: colOf('email'), mob: colOf('mobile') };
      if (CL.uid < 0 || CL.name < 0) throw new Error('I could not find the "user_id" and "name" columns. Best: download the template below and fill it in.');
      const take = (cols, i) => i >= 0 && i < cols.length ? String(cols[i] || '').trim() : '';
      for (const [ri, cols] of grid.entries()) {
        const rowNo = ri + 2;   // +1 header row, +1 for human 1-based counting
        const uid = take(cols, CL.uid).toUpperCase();
        try {
          const name = take(cols, CL.name);
          const role = ROLE_NORM(take(cols, CL.role));
          if (!uid) { bad.push([rowNo, '—', 'User ID is empty']); continue; }
          if (!name) { bad.push([rowNo, uid, 'Name is empty']); continue; }
          if (!role) { bad.push([rowNo, uid, `Role "${take(cols, CL.role)}" not understood — use employee / hod / hr / security`]); continue; }
          let deptN = take(cols, CL.dept);
          const email = take(cols, CL.email), mobile = take(cols, CL.mob);
          let pw = take(cols, CL.pw);
          if (pw && pw.length < 6) { notes.push([rowNo, uid, 'Password too short (Google needs 6+) — set to welcome123']); pw = ''; }
          if (!pw) pw = 'welcome123';
          let deptId = null;
          if (deptN) {
            let d = DEPTS.find(x => x.name.toLowerCase() === deptN.toLowerCase());
            if (!d) { await addDoc(C.depts, { name: deptN }); await loadDepts(); d = DEPTS.find(x => x.name.toLowerCase() === deptN.toLowerCase()); notes.push([rowNo, uid, `Department "${deptN}" was new — created it`]); }
            deptId = d ? d.id : null;
          }
          // existing user? UPDATE their details from this row (department fix included) — password untouched.
          const dirDoc = await getDoc(doc(db, 'directory', uid.toLowerCase()));
          if (dirDoc.exists() && dirDoc.data().uid) {
            await updateDoc(doc(db, 'users', dirDoc.data().uid), { name, role, department_id: deptId, email: email || '', mobile: mobile || '' });
            updated++;
          } else {
            await createUser({ user_id: uid, name, role, department_id: deptId, email, mobile, pw });
            added++;
          }
          msg.textContent = `⏳ Uploading… ${ri + 1}/${grid.length}`;
        } catch (e) {
          console.error(e);
          const why = e.code === 'ghost-account' ? e.message
            : e.code === 'auth/email-already-in-use' ? 'this email is already used by another user — leave the email blank or make it unique'
            : e.code === 'auth/invalid-email' ? 'the email looks wrong — fix it or leave it blank'
            : (e.message || 'unknown error');
          bad.push([rowNo, uid || '—', why]);
        }
      }
    } catch (e) {
      msg.innerHTML = `<div class="flash f-err" style="position:static;margin-top:8px">❌ Could not read this file. ${esc(e.message)}<br>
        <span class="muted small">Tip: make your list in Excel using the <b>template</b> below, then either upload the <b>.xlsx</b> directly or File → Save As → <b>"CSV (Comma delimited)"</b>.</span></div>`;
      return;
    }
    await syncDeptCounts();
    vAdminUsers();                       // re-render first so the report below stays visible
    toast(`Upload complete: ${added} added, ${updated} updated${bad.length ? `, ${bad.length} skipped` : ''}.`, bad.length ? 'warn' : 'ok');
    const done = document.getElementById('csvmsg');
    if (done) done.innerHTML =
      `<div style="margin-top:8px;padding:10px 12px;border-radius:10px;background:${bad.length ? '#fffbeb' : '#f0fdf4'};border:1px solid ${bad.length ? '#fcd34d' : '#bbf7d0'}">
        ✅ <b>${added}</b> new added · 🔁 <b>${updated}</b> existing UPDATED (dept/details fixed) · ${bad.length ? `⚠️ <b>${bad.length}</b> skipped` : 'no bad rows 🎉'}</div>`
      + (notes.length + bad.length ? `<div style="max-height:190px;overflow:auto;margin-top:8px;border:1px solid var(--line);border-radius:8px"><table class="tbl" style="margin:0"><tr><th></th><th>Row</th><th>User</th><th>What happened</th></tr>${
        [...notes.map(n => ['🟡', ...n]), ...bad.map(b => ['🔴', ...b])]
          .map(r => `<tr><td>${r[0]}</td><td class="nowrap">${r[1]}</td><td><b>${esc(r[2])}</b></td><td>${esc(r[3])}</td></tr>`).join('')
      }</table></div>` : '');
  };
}

async function createUser({ user_id, name, role, department_id, email, mobile, pw }) {
  const authEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '') ? email.trim() : mailOf(user_id);
  const sec = initializeApp(CFG, 'sec-' + Date.now());
  try {
    let uid;
    try {
      const cred = await createUserWithEmailAndPassword(getAuth(sec), authEmail, pw);
      uid = cred.user.uid;
    } catch (e) {
      if (e.code !== 'auth/email-already-in-use') throw e;
      /* The email is taken. Two different cases:
         (A) a REAL email was typed → it belongs to another user → always reject.
         (B) auto-made pseudo email (box was blank) → it can ONLY be a "ghost key"
             left behind by an earlier-deleted user with this SAME ID (Google keys
             survive an in-app delete/reset; nobody else could register our private
             app domain). Recycle it when the stored password still matches.       */
      if (authEmail !== mailOf(user_id))
        throw { code: 'ghost-account', message: `the email "${authEmail}" is already used by another user — leave it blank or use a different one` };
      const sAuth = getAuth(sec);
      try {
        const s = await signInWithEmailAndPassword(sAuth, authEmail, pw);
        uid = s.user.uid;
        try { await updatePassword(s.user, pw); } catch (e2) { }
      } catch (e2) {
        try { await signOut(sAuth); } catch (e3) { }
        throw {
          code: 'ghost-account',
          message: `an OLD login key for "${user_id}" is still lying in Google's Authentication list (left over from an earlier deleted test user). One-time fix: Firebase console → Authentication → delete the row "${authEmail}" → upload again.`,
        };
      }
    }
    await setDoc(doc(db, 'users', uid), {
      user_id, name, role, department_id: department_id || null, email: email || '', auth_email: authEmail,
      mobile: mobile || '', active: true, created_at: nowStr(), created_by: me.user_id,
    });
    await setDoc(doc(db, 'creds', uid), { pw });
    await setDoc(doc(db, 'directory', user_id.toLowerCase()), { email: authEmail, active: true, uid, user_id });
    await signOut(getAuth(sec));
  } finally { try { await deleteApp(sec); } catch (e) { } }
}

async function resetUserPw(uid, newPw) {
  const prof = (await getDoc(doc(db, 'users', uid))).data();
  const cred = await getDoc(doc(db, 'creds', uid));
  if (!cred.exists() || !cred.data().pw) {
    const e = new Error('this account has no stored password record (old/incomplete account). One-time fix: 🗑 delete this user and add him again with a password.');
    e.friendly = e.message; throw e;
  }
  const sec = initializeApp(CFG, 'sec-' + Date.now());
  try {
    const s = getAuth(sec);
    let sign;
    try { sign = await signInWithEmailAndPassword(s, prof.auth_email || mailOf(prof.user_id), cred.data().pw); }
    catch (e1) {
      e1.friendly = 'could not open this login account at Google (' + (e1.code || e1.message) + '). One-time fix: 🗑 delete this user and add him again.';
      throw e1;
    }
    try { await updatePassword(sign.user, newPw); }
    catch (e2) {
      e2.friendly = (e2.code === 'auth/weak-password') ? 'password too weak — use at least 6 characters.' : ('Google rejected the new password: ' + (e2.code || e2.message));
      throw e2;
    }
    try { await setDoc(doc(db, 'creds', uid), { pw: newPw }); }
    catch (e3) {
      e3.friendly = 'password is ALREADY changed at Google ✅ (user can login with the new one) but the app could not save its own record: ' + (e3.code || e3.message) + '. One-time fix: re-publish the latest security rules (see FIREBASE SETUP.html → step 4 → Publish).';
      throw e3;
    }
    // final proof: sign in with the NEW password — green button only if this works
    try {
      const v = await signInWithEmailAndPassword(s, prof.auth_email || mailOf(prof.user_id), newPw);
      if (!v || !v.user) throw new Error('no session');
      await signOut(s);
    } catch (e4) {
      e4.friendly = 'password save self-check failed: ' + (e4.code || e4.message) + ' — try once more; if it repeats, delete this user and add him again.';
      throw e4;
    }
  } finally { try { await deleteApp(sec); } catch (e) { } }
}

/* ==================================================== views: admin - settings */
function vAdminSettings() {
  const c = frame('⚙️ Settings');
  const hR = SETTINGS.appr_hod === '1', hrR = SETTINGS.appr_hr === '1';        // employee passes
  const vH = SETTINGS.appr_hod_v === '1', vR = SETTINGS.appr_hr_v === '1';     // visitor passes
  const par = isParallel();
  c.innerHTML = `
  <div class="section formcard"><h2>General</h2><form id="gen">
    <label class="fl">Company / Factory name</label><input type="text" id="company" value="${esc(SETTINGS.company_name)}">
    <label class="fl">Data retention (days)</label><input type="number" id="ret" value="${SETTINGS.retention_days}" min="7" max="3650">
    <p class="muted small">Records older than this are auto-deleted (checked daily). 60 days ≈ 2 months.</p>
    <button class="btn" type="submit">💾 Save</button></form></div>

  <div class="section formcard" style="max-width:760px"><h2>🔀 Approval workflow</h2>
    <p class="muted small">Choose who must approve. <b>At least one approver must stay selected</b> in each group.
    Departments can override this on the 👥 Users page.</p>
    <h3 style="margin:14px 0 4px">👷 Employee passes</h3>
    <label style="font-weight:600;display:inline-block;margin:4px 18px 4px 0"><input type="checkbox" id="wfH" style="width:auto" ${hR ? 'checked' : ''}> Dept Head</label>
    <label style="font-weight:600;display:inline-block"><input type="checkbox" id="wfR" style="width:auto" ${hrR ? 'checked' : ''}> HR</label>
    <div style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">
      <label style="font-weight:600;display:inline-block"><input type="checkbox" id="wfBehalf" style="width:auto" ${SETTINGS.appr_hr_for_hod === '1' ? 'checked' : ''}> 🤝 HR can approve <b>on behalf of the Dept Head</b></label>
      <p class="muted small" style="margin:4px 0 0 24px">Use this when a Dept Head is on leave / not available — HR will see that department's pending passes and can cover the Dept Head step. The record clearly shows <i>"…(HR, on behalf of Dept Head)"</i>.</p>
    </div>
    <h3 style="margin:14px 0 4px">🧍 Visitor passes</h3>
    <label style="font-weight:600;display:inline-block;margin:4px 18px 4px 0"><input type="checkbox" id="wfHv" style="width:auto" ${vH ? 'checked' : ''}> Dept Head</label>
    <label style="font-weight:600;display:inline-block"><input type="checkbox" id="wfRv" style="width:auto" ${vR ? 'checked' : ''}> HR</label>
    <div style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">
      <label style="font-weight:600;display:inline-block"><input type="checkbox" id="wfBehalfV" style="width:auto" ${SETTINGS.appr_hr_for_hod_v === '1' ? 'checked' : ''}> 🤝 HR can approve <b>on behalf of the Dept Head</b> (visitors)</label>
      <p class="muted small" style="margin:4px 0 0 24px">Same as the employee-pass option, but for visitor passes waiting at the Dept Head step.</p>
    </div>
    <h3 style="margin:14px 0 4px">When both are required, how should it flow?</h3>
    <div class="radcard">
      <label class="${par ? '' : 'sel'}" id="lblSeq"><input type="radio" name="wfmode" id="wfModeS" ${par ? '' : 'checked'}>
        <span><span class="rc-t">➡️ One after another (sequence)</span>
        <span class="rc-d">Dept Head approves first; only then it goes to HR.</span></span></label>
      <label class="${par ? 'sel' : ''}" id="lblPar"><input type="radio" name="wfmode" id="wfModeP" ${par ? 'checked' : ''}>
        <span><span class="rc-t">⚡ Both at the same time (parallel)</span>
        <span class="rc-d">Dept Head and HR both see it immediately; pass is approved when both have approved (any order). Either can reject.</span></span></label>
    </div>
    <div style="height:10px"></div><button class="btn" id="wfsave">💾 Save workflow</button>
    <p class="muted small">Current: <b id="wftxt">${hR && hrR ? 'Dept Head + HR' : (hR ? 'Dept Head only' : 'HR only')} · ${par ? 'parallel' : 'sequence'}</b></p></div>

  <div class="section formcard" style="max-width:760px"><h2>🤝 Permissions (lend powers to HR)</h2>
    <p class="muted small">Extra powers you can give the <b>HR</b> team. Turn OFF anytime — the change is instant.</p>
    <label style="font-weight:600;display:inline-block"><input type="checkbox" id="permHrUsers" style="width:auto" ${SETTINGS.hr_add_users === '1' ? 'checked' : ''}> 👥 <b>HR can add users</b></label>
    <p class="muted small" style="margin:4px 0 0 24px">When ON, HR gets an <b>"👥 Add Users"</b> menu — when a new employee / Dept Head / security guard joins, HR can create their login right away.
    HR <b>cannot</b> edit, disable or delete users, and <b>cannot</b> create another HR or an Admin.</p>
    <div style="height:12px"></div>
    <div style="font-weight:600">🧍 <b>Pre-register visitors — who is allowed?</b> <span class="muted small">(admin always can)</span></div>
    <label style="font-weight:600;display:block;margin:6px 0 0 24px"><input type="checkbox" id="permPrHr" style="width:auto" ${SETTINGS.pre_reg_hr === '1' ? 'checked' : ''}> <b>HR</b> can pre-register <span class="muted small">— auto-approved, goes straight to the gate</span></label>
    <label style="font-weight:600;display:block;margin:8px 0 0 24px"><input type="checkbox" id="permPrHod" style="width:auto" ${SETTINGS.pre_reg_hod === '1' ? 'checked' : ''}> <b>Dept Head</b> can pre-register</label>
    <label style="font-weight:600;display:block;margin:4px 0 0 48px"><input type="checkbox" id="permPrHodAppr" style="width:auto" ${SETTINGS.pre_reg_hod_hr_appr !== '0' ? 'checked' : ''}> these need <b>HR approval</b> <span class="muted small">— untick = auto-approved, straight to the gate (follows your sequence/parallel choice)</span></label>
    <p class="muted small" style="margin:6px 0 0 24px">The raiser sees a <b>"🧍 Pre-register Visitor"</b> menu with his own list + status + View. At the gate, security checks the pass, may note <b>📦 items carried / ID</b>, and only then marks the visitor IN. Walk-in registration by security works as before.</p>
    <div style="height:10px"></div><button class="btn" id="permsave">💾 Save permissions</button></div>

  <div class="section formcard"><h2>🖼️ Company logo</h2>
    <div id="logoprev">${SETTINGS.logo_b64 ? `<img src="${SETTINGS.logo_b64}" style="max-height:70px;max-width:260px;border:1px solid var(--line);border-radius:8px;padding:6px;background:#fff">` : '<p class="muted small">No logo uploaded.</p>'}</div>
    <div class="btnrow" style="margin-top:10px"><input type="file" id="logofile" accept=".png,.jpg,.jpeg" style="flex:1;min-width:200px">
    <button class="btn" id="logoup">⬆️ Upload</button>
    ${SETTINGS.logo_b64 ? `<button class="btn red sm" id="logorm">🗑 Remove</button>` : ''}</div>
    <p class="muted small">PNG/JPG — auto-resized. Shown in header, login page, printed passes and Excel reports.</p></div>

  <div class="section formcard"><h2>📲 Alerts (SMS / WhatsApp)</h2>
    <div class="warn" style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:10px 14px">
      <b>Paused in this HTML/Firebase version.</b><br>Browsers cannot call SMS/WhatsApp provider APIs directly (security restriction + your API keys would be public).
      The Python/LAN version of this app keeps full SMS + WhatsApp support. If you want alerts here, it needs a Firebase
      <b>Cloud Function</b> (Blaze pay-as-you-go plan) — tell me and I'll add it.</div></div>

  <div class="section formcard" style="border:1px solid #86efac"><h2>💾 Backup & data safety</h2>
    <p class="muted small">Your data already lives safely on Google's servers. For extra peace of mind, keep a <b>complete copy on this PC</b> — one Excel file with <b>every</b> pass, visitor, user, department and the settings.</p>
    <button class="btn" id="bkup">⬇️ Download FULL BACKUP (Excel)</button>
    <p class="muted small" style="margin-top:10px">🛡️ Golden rules: ① turn ON <b>2-Step Verification</b> for the Gmail that owns Firebase · ② keep a <b>backup ADMIN</b> account (Users page) · ③ download this backup on the <b>1st of every month</b> (records auto-delete after ${SETTINGS.retention_days} days).</p></div>

  <div class="section formcard"><h2>🧹 Data cleanup</h2>
    <p class="muted small">Auto-runs daily (on admin/HR login). Last run: <b>${esc(SETTINGS.last_cleanup_at || 'never')}</b></p>
    <button class="btn" id="cleanup">🧹 Run cleanup now</button></div>

  <div class="section formcard" style="border:1px solid #fca5a5"><h2 style="color:var(--red)">⚠️ Factory reset</h2>
    <p class="muted small">Deletes <b>all users (except your admin account), departments, and every pass record</b>. Settings & logo are kept.</p>
    <button class="btn red" id="freset">🗑 Factory reset</button></div>`;

  document.getElementById('gen').onsubmit = async ev => {
    ev.preventDefault();
    await saveSettings({ company_name: document.getElementById('company').value.trim() || APP_NAME, retention_days: +document.getElementById('ret').value || 60 });
    toast('Settings saved.');
  };
  const pairGuard = pair => ev => { const h = document.getElementById(pair[0]), r = document.getElementById(pair[1]);
    if (!h.checked && !r.checked) ev.target.checked = true;   // at least one must stay ON
  };
  document.getElementById('wfH').onchange = pairGuard(['wfH', 'wfR']);
  document.getElementById('wfR').onchange = pairGuard(['wfH', 'wfR']);
  document.getElementById('wfHv').onchange = pairGuard(['wfHv', 'wfRv']);
  document.getElementById('wfRv').onchange = pairGuard(['wfHv', 'wfRv']);
  const paintMode = () => {
    const p = document.getElementById('wfModeP').checked;
    document.getElementById('lblSeq').className = p ? '' : 'sel';
    document.getElementById('lblPar').className = p ? 'sel' : '';
    document.getElementById('wftxt').textContent =
      `${document.getElementById('wfH').checked && document.getElementById('wfR').checked ? 'Dept Head + HR' : (document.getElementById('wfH').checked ? 'Dept Head only' : 'HR only')} · ${p ? 'parallel' : 'sequence'}`;
  };
  document.getElementById('wfModeS').onchange = paintMode;
  document.getElementById('wfModeP').onchange = paintMode;
  document.getElementById('wfsave').onclick = async () => {
    const h = document.getElementById('wfH').checked, r = document.getElementById('wfR').checked;
    const hv = document.getElementById('wfHv').checked, rv = document.getElementById('wfRv').checked;
    if ((!h && !r) || (!hv && !rv)) return toast('At least one approval must stay selected in each group.', 'err');
    await saveSettings({
      appr_hod: h ? '1' : '0', appr_hr: r ? '1' : '0',
      appr_hod_v: hv ? '1' : '0', appr_hr_v: rv ? '1' : '0',
      appr_mode: document.getElementById('wfModeP').checked ? 'parallel' : 'sequence',
      appr_hr_for_hod: document.getElementById('wfBehalf').checked ? '1' : '0',
      appr_hr_for_hod_v: document.getElementById('wfBehalfV').checked ? '1' : '0',
    });
    toast('Approval workflow saved.');
  };
  // the HR-approval sub-switch only makes sense while Dept Head is allowed
  const pHod = document.getElementById('permPrHod'), pHodAppr = document.getElementById('permPrHodAppr');
  const syncSub = () => { pHodAppr.disabled = !pHod.checked; };
  pHod.onchange = syncSub; syncSub();
  document.getElementById('permsave').onclick = async () => {
    await saveSettings({
      hr_add_users: document.getElementById('permHrUsers').checked ? '1' : '0',
      pre_reg_hr: document.getElementById('permPrHr').checked ? '1' : '0',
      pre_reg_hod: pHod.checked ? '1' : '0',
      pre_reg_hod_hr_appr: pHodAppr.checked ? '1' : '0',
    });
    toast('Permissions saved.' + (hrCanAddUsers() ? ' HR now sees an "👥 Add Users" menu.' : ''));
  };
  document.getElementById('logoup').onclick = () => {
    const f = document.getElementById('logofile').files[0];
    if (!f) return toast('Choose an image.', 'err');
    const img = new Image(), rd = new FileReader();
    rd.onload = e => { img.onload = () => {
      const cv = document.createElement('canvas');
      const ratio = Math.min(400 / img.width, 200 / img.height, 1);
      cv.width = Math.round(img.width * ratio); cv.height = Math.round(img.height * ratio);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      saveSettings({ logo_b64: cv.toDataURL('image/png') }).then(() => { toast('Logo saved.'); vAdminSettings(); });
    }; img.src = e.target.result; };
    rd.readAsDataURL(f);
  };
  const rm = document.getElementById('logorm');
  if (rm) rm.onclick = async () => { await saveSettings({ logo_b64: '' }); toast('Logo removed.'); vAdminSettings(); };
  document.getElementById('bkup').onclick = async () => {
    const btn = document.getElementById('bkup'); btn.disabled = true;
    toast('Preparing full backup…');
    try {
      const wb = new ExcelJS.Workbook();
      const put = (name, cols, rows) => {
        const ws = wb.addWorksheet(name);
        ws.addRow(cols); try { ws.getRow(1).font = { bold: true }; } catch (e) { }
        rows.forEach(r => ws.addRow(r));
      };
      const [gp, vp, us, dp] = await Promise.all([getDocs(C.gp), getDocs(C.vp), getDocs(C.users), getDocs(C.depts)]);
      const V = (...xs) => xs.map(v => v === undefined || v === null ? '' : v);
      put('Employee Passes', ['Pass No', 'Employee ID', 'Name', 'Department', 'Date', 'Out', 'Return', 'Type', 'Purpose', 'Reason', 'Status', 'Dept Head by', 'HR by', 'Gate OUT at', 'Gate IN at', 'Created at'],
        gp.docs.map(d => { const p = d.data(); return V(p.pass_no, p.employee_code, p.employee_name, p.department_name, p.pass_date, p.out_time, p.return_time, p.pass_type, p.purpose, p.reason, p.status, p.hod_by, p.hr_by, p.gate_out_at, p.gate_in_at, p.created_at); }));
      put('Visitor Passes', ['Pass No', 'Visitor', 'Mobile', 'Company', 'To Meet', 'Department', 'Date', 'Purpose', 'Vehicle', 'Persons', 'Status', 'Dept Head by', 'HR by', 'Gate IN at', 'Gate OUT at', 'Created at'],
        vp.docs.map(d => { const p = d.data(); return V(p.pass_no, p.visitor_name, p.visitor_mobile, p.visitor_company, p.person_to_visit, p.department_name, p.pass_date, p.purpose, p.vehicle_no, p.persons, p.status, p.hod_by, p.hr_by, p.gate_in_at, p.gate_out_at, p.created_at); }));
      put('Users', ['User ID', 'Name', 'Role', 'Department', 'Mobile', 'Email', 'Active'],
        us.docs.map(d => { const u = d.data(); return V(u.user_id, u.name, u.role, deptName(u.department_id), u.mobile, u.email, u.active !== false ? 'yes' : 'no'); }));
      put('Departments', ['Name', 'Users', 'Dept Heads', 'Workflow'],
        dp.docs.map(d => { const dd = d.data(); return V(dd.name, dd.user_count || 0, dd.hod_count || 0, dd.workflow || 'global'); }));
      const ws = wb.addWorksheet('About');
      ws.addRow(['Factory Gate Pass Manager — FULL BACKUP']);
      ws.addRow(['Company', SETTINGS.company_name]);
      ws.addRow(['Taken at', nowStr()]);
      ws.addRow(['Records kept (days)', SETTINGS.retention_days]);
      ws.addRow(['Sheets', 'Employee Passes · Visitor Passes · Users · Departments']);
      const buf = await wb.xlsx.writeBuffer();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      a.download = `gatepass_FULL_BACKUP_${todayStr()}.xlsx`;
      a.click();
      toast('Backup downloaded — keep this file safe. 👍');
    } catch (e) { console.error(e); toast('Backup failed: ' + (e.code || e.message), 'err'); }
    btn.disabled = false;
  };
  document.getElementById('cleanup').onclick = async () => {
    await setDoc(C.settings, { last_cleanup: '' }, { merge: true });
    await loadSettings(); await housekeeping(); toast('Cleanup done.');
  };
  document.getElementById('freset').onclick = async () => {
    if (!confirm('DELETE all users and pass records?') || !confirm('Really? This cannot be undone.')) return;
    let batch = writeBatch(db), ops = 0;
    const flush = async () => { if (ops) { await batch.commit(); batch = writeBatch(db); ops = 0; } };
    for (const col of [C.gp, C.vp, C.users, C.creds, C.directory, C.depts]) {
      const s = await getDocs(col);
      for (const d of s.docs) {
        if (col === C.users && d.id === me.uid) continue;
        batch.delete(d.ref);
        if (++ops >= 400) await flush();   // Firestore batches cap at 500 ops
      }
    }
    await flush();
    await loadDepts(); toast('Factory reset complete.'); location.hash = '#/admin-users';
  };
}

/* ======================================================== change password */
function vPassword() {
  const c = frame('🔑 Change My Password');
  c.innerHTML = `<div class="section formcard" style="max-width:440px"><form id="cp">
    <label class="fl">New password</label><input type="password" id="np1" required>
    <label class="fl">Confirm new password</label><input type="password" id="np2" required>
    <div style="height:16px"></div><button class="btn" type="submit">Update Password</button></form>
    <p class="muted small" style="margin-top:10px">If this fails with "requires recent login", just logout and login again, then retry.</p></div>`;
  document.getElementById('cp').onsubmit = async ev => {
    ev.preventDefault();
    const a = document.getElementById('np1').value, b = document.getElementById('np2').value;
    if (a !== b) return toast('Passwords do not match.', 'err');
    if (a.length < 4) return toast('At least 4 characters.', 'err');
    try {
      await updatePassword(auth.currentUser, a);
      await setDoc(doc(db, 'creds', me.uid), { pw: a });
      toast('Password changed.');
      location.hash = '#/';
    } catch (e) { toast('Failed: ' + (e.code || e.message), 'err'); }
  };
}

/* ------------------------------------------------------------------- router */
function route(h) {
  depose();
  if (!me) { if (!document.getElementById('lf')) showLogin(); return; }  // keep any error message on screen
  h = (h || location.hash || '#/').split('?')[0];
  const parts = h.replace(/^#\/?/, '').split('/');
  const home = { employee: '#/my', dept_head: '#/approvals', hr: '#/dashboard', security: '#/gate', admin: '#/admin-users' };
  const guard = (...roles) => roles.includes(me.role);
  if (h === '#/login') { location.hash = home[me.role] || '#/my'; return; }   // already logged in
  if (h === '#/' || h === '#') { location.hash = home[me.role] || '#/my'; return; }
  if (h === '#/my' && guard('employee')) return vMyPasses();
  if (h === '#/pass-new' && guard('employee')) return vNewPass();
  if (parts[0] === 'pass' && parts.length === 3 && guard('employee', 'dept_head', 'hr', 'security', 'admin')) return vPassDetail(parts[1], parts[2]);
  if (h === '#/approvals' && guard('dept_head', 'hr')) return vApprovals();
  if (h === '#/visit-new' && preRegAllowed(me.role)) return vVisitNew();
  if (h === '#/gate' && guard('security', 'admin')) return vGate();
  if (h === '#/dashboard' && guard('hr', 'admin', 'dept_head')) return vDashboard();
  if (h === '#/reports' && guard('hr', 'admin', 'dept_head')) return vReports();
  if (h === '#/admin-users' && guard('admin')) return vAdminUsers();
  if (h === '#/hr-users' && guard('hr') && hrCanAddUsers()) return vAdminUsers();
  if (h === '#/admin-settings' && guard('admin')) return vAdminSettings();
  if (h === '#/password') return vPassword();
  const c = frame('Not found'); c.innerHTML = '<div class="section">⛔ Page not found or not allowed.</div>';
}

/* ---------------------------------------------------------------- bootstrap */
window.addEventListener('hashchange', () => route());

onAuthStateChanged(auth, async u => {
  if (!u) { me = null; if (location.hash !== '#/login') location.hash = '#/login'; showLogin(); return; }
  try {
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (!snap.exists()) {
      const booted = await getDoc(doc(db, 'settings', 'bootstrapped'));
      if (booted.exists()) { me = null; await signOut(auth); showLogin('Your account is disabled or was removed. Ask admin to re-create it.'); return; }
      showBootstrap(u);   // first run: let the owner create the admin profile from the app
      return;
    }
    if (snap.data().active === false) { me = null; await signOut(auth); showLogin('Your account is disabled or was removed.'); return; }
    me = { uid: u.uid, ...snap.data() };
    await loadSettings(); await loadDepts();
    housekeeping().catch(console.error);
    initAlerts();
    if (location.hash === '#/login' || location.hash === '') { location.hash = '#/'; } else { route(); }
  } catch (e) { console.error(e); showLogin('Error loading profile: ' + (e.code || e.message)); }
});

loadSettings().catch(() => { });

/* --------------------------------------------------------------- 📱 install as an app (PWA) */
// Lets phones/PCs add a real home-screen icon + full-screen app window (no Play Store needed).
let deferredInstall = null;
function paintInstallBtns() {   // show the "Install App" buttons only when the browser allows installing
  document.querySelectorAll('.installbtn').forEach(b => b.style.display = deferredInstall ? '' : 'none');
}
window.installApp = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  try { await deferredInstall.userChoice; } catch (e) { }
  deferredInstall = null; paintInstallBtns();
};
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; paintInstallBtns(); });
window.addEventListener('appinstalled', () => { deferredInstall = null; paintInstallBtns(); });
// Service worker = required for install + keeps the app shell fast.
if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
