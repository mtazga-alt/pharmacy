/* =========================================================
   صيدليتي — نظام إدارة صيدلية بالباركود
   يعمل على GitHub Pages — قاعدة بيانات محلية (IndexedDB)
   أو سحابية مشتركة (Firebase Firestore) اختيارياً
   ========================================================= */
'use strict';

/* ---------- أدوات عامة ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const clone = o => JSON.parse(JSON.stringify(o));
const localDate = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysTo = ds => Math.round((new Date(ds + 'T00:00:00') - new Date(localDate() + 'T00:00:00')) / 864e5);
const num = v => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };
const fmtNum = n => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = n => `${fmtNum(n)} ${esc(S().currency || '')}`;
const fmtDT = t => new Date(t).toLocaleString('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });
const fmtD = ds => ds ? new Date(ds + 'T00:00:00').toLocaleDateString('ar-EG-u-nu-latn', { dateStyle: 'medium' }) : '—';
const ic = (name, cls = '') => `<i data-lucide="${name}" class="ic ${cls}"></i>`;
const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) { } };
const norm = s => String(s ?? '').toLowerCase()
  .replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
const LOGO = `<img src="icons/icon.svg" alt="" class="logo">`;
const ROLE_LABEL = { admin: 'مسئول', pharmacist: 'صيدلي', citizen: 'مواطن' };
const isStaff = () => state.user && state.user.role !== 'citizen';
const isAdmin = () => state.user && state.user.role === 'admin';

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('تعذر تحميل ' + src));
    document.head.appendChild(s);
  });
}
function timeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

/* ---------- الحقول الافتراضية لبطاقة الدواء ---------- */
const DEFAULT_FIELDS = [
  { key: 'name', label: 'الاسم التجاري', type: 'text', required: true, public: true, inList: true, system: true },
  { key: 'scientific', label: 'الاسم العلمي (المادة الفعالة)', type: 'text', required: false, public: true, inList: true },
  { key: 'company', label: 'الشركة المنتجة', type: 'text', required: false, public: false, inList: false },
  { key: 'form', label: 'الشكل الدوائي', type: 'select', options: ['أقراص', 'كبسولات', 'شراب', 'حقن', 'كريم / مرهم', 'نقط', 'بخاخ', 'لبوس', 'أكياس فوار', 'مستلزمات', 'أخرى'], required: false, public: true, inList: true },
  { key: 'category', label: 'التصنيف العلاجي', type: 'select', options: ['مضاد حيوي', 'مسكن وخافض حرارة', 'ضغط وقلب', 'سكر', 'جهاز هضمي', 'برد وحساسية', 'فيتامينات ومكملات', 'جلدية', 'أطفال', 'أخرى'], required: false, public: false, inList: false },
  { key: 'price', label: 'سعر البيع', type: 'number', required: true, public: true, inList: true, system: true },
  { key: 'cost', label: 'سعر الشراء', type: 'number', required: false, public: false, inList: false },
  { key: 'qty', label: 'الكمية المتوفرة', type: 'number', required: true, public: false, inList: true, system: true },
  { key: 'expiry', label: 'تاريخ الصلاحية', type: 'date', required: false, public: false, inList: true, system: true },
  { key: 'location', label: 'مكان الرف', type: 'text', required: false, public: false, inList: false },
  { key: 'rx', label: 'يُصرف بروشتة طبيب', type: 'select', options: ['لا', 'نعم'], required: false, public: true, inList: false },
  { key: 'notes', label: 'ملاحظات', type: 'textarea', required: false, public: false, inList: false },
];
const DEFAULT_SETTINGS = {
  id: 'main', pharmacyName: 'صيدلية الشفاء', phone: '', address: '', hours: 'يومياً من 9 صباحاً حتى 12 منتصف الليل',
  currency: 'ج.م', lowStock: 5, expiryDays: 60, citizenEnabled: true, citizenSeesQty: false,
  fields: DEFAULT_FIELDS,
};
const TYPE_LABEL = { text: 'نص', number: 'رقم', date: 'تاريخ', select: 'قائمة اختيار', textarea: 'نص طويل' };

/* =========================================================
   طبقة البيانات — ذاكرة + IndexedDB أو Firestore
   ========================================================= */
const COLS = ['settings', 'users', 'drugs', 'sales'];
const Store = {
  mode: 'local', cache: {}, db: null, fs: null, listeners: [],

  cloudConfig() {
    if (window.PHARMA_FIREBASE_CONFIG && window.PHARMA_FIREBASE_CONFIG.projectId) return { cfg: window.PHARMA_FIREBASE_CONFIG, src: 'file' };
    try { const c = JSON.parse(localStorage.getItem('pharma_cloud') || 'null'); if (c && c.projectId) return { cfg: c, src: 'device' }; } catch (e) { }
    return null;
  },

  async init() {
    COLS.forEach(c => this.cache[c] = new Map());
    const cc = this.cloudConfig();
    if (cc) {
      try { await timeout(this.initCloud(cc.cfg), 15000, 'انتهت مهلة الاتصال'); this.mode = 'cloud'; this.cloudSrc = cc.src; return; }
      catch (e) { console.error(e); COLS.forEach(c => this.cache[c].clear()); this.cloudError = e.message; }
    }
    await this.initLocal();
  },

  initLocal() {
    return new Promise((res, rej) => {
      const req = indexedDB.open('pharma_db', 1);
      req.onupgradeneeded = () => { const db = req.result; COLS.forEach(c => { if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' }); }); };
      req.onsuccess = async () => {
        this.db = req.result;
        for (const c of COLS) (await this._all(c)).forEach(i => this.cache[c].set(i.id, i));
        res();
      };
      req.onerror = () => rej(req.error);
    });
  },
  _all(c) { return new Promise((res, rej) => { const r = this.db.transaction(c).objectStore(c).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  _tx(c, fn) { return new Promise((res, rej) => { const tx = this.db.transaction(c, 'readwrite'); fn(tx.objectStore(c)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); },

  async initCloud(cfg) {
    if (!window.firebase) {
      await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js');
    }
    if (!firebase.apps.length) firebase.initializeApp(cfg);
    this.fs = firebase.firestore();
    try { this.fs.enablePersistence({ synchronizeTabs: true }).catch(() => { }); } catch (e) { }
    await Promise.all(COLS.map(c => new Promise((res, rej) => {
      let first = true;
      this.fs.collection(c).onSnapshot(snap => {
        snap.docChanges().forEach(ch => {
          if (ch.type === 'removed') this.cache[c].delete(ch.doc.id);
          else this.cache[c].set(ch.doc.id, { ...ch.doc.data(), id: ch.doc.id });
        });
        if (first) { first = false; res(); } else if (!snap.metadata.hasPendingWrites) this.emit(c);
      }, err => { if (first) { first = false; rej(err); } else console.error(err); });
    })));
  },

  all(c) { return [...this.cache[c].values()]; },
  get(c, id) { return this.cache[c].get(String(id)); },
  async put(c, obj) {
    obj.id = String(obj.id);
    const o = clone(obj);
    this.cache[c].set(o.id, o);
    if (this.mode === 'cloud') await this.fs.collection(c).doc(o.id).set(o);
    else await this._tx(c, s => s.put(o));
  },
  async putMany(c, list) {
    list = list.map(o => { o = clone(o); o.id = String(o.id); this.cache[c].set(o.id, o); return o; });
    if (this.mode === 'cloud') {
      for (let i = 0; i < list.length; i += 400) {
        const b = this.fs.batch();
        list.slice(i, i + 400).forEach(o => b.set(this.fs.collection(c).doc(o.id), o));
        await b.commit();
      }
    } else await this._tx(c, s => list.forEach(o => s.put(o)));
  },
  async del(c, id) {
    id = String(id); this.cache[c].delete(id);
    if (this.mode === 'cloud') await this.fs.collection(c).doc(id).delete();
    else await this._tx(c, s => s.delete(id));
  },
  async clear(c) {
    const ids = [...this.cache[c].keys()]; this.cache[c].clear();
    if (this.mode === 'cloud') {
      for (let i = 0; i < ids.length; i += 400) { const b = this.fs.batch(); ids.slice(i, i + 400).forEach(id => b.delete(this.fs.collection(c).doc(id))); await b.commit(); }
    } else await this._tx(c, s => s.clear());
  },
  on(fn) { this.listeners.push(fn); },
  emit(c) { this.listeners.forEach(f => f(c)); },
};

const S = () => Store.get('settings', 'main') || DEFAULT_SETTINGS;
const fields = () => S().fields || DEFAULT_FIELDS;

/* ---------- تشفير كلمات المرور ---------- */
async function sha(str) {
  if (window.crypto && crypto.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 'f' + (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}
const passHash = (u, p) => sha(`pharma|${String(u).toLowerCase()}|${p}`);

async function seed() {
  if (!Store.get('settings', 'main')) await Store.put('settings', clone(DEFAULT_SETTINGS));
  else {
    // ضمان وجود الحقول الأساسية حتى لو حُذفت بالخطأ
    const s = S(); let changed = false;
    DEFAULT_FIELDS.filter(f => f.system).forEach(f => { if (!s.fields.find(x => x.key === f.key)) { s.fields.push(clone(f)); changed = true; } });
    if (changed) await Store.put('settings', s);
  }
  if (!Store.all('users').length) {
    await Store.put('users', { id: 'admin', username: 'admin', name: 'مدير النظام', role: 'admin', active: true, mustChange: true, pass: await passHash('admin', 'admin123'), createdAt: Date.now() });
  }
}

/* =========================================================
   واجهة: تنبيهات ونوافذ
   ========================================================= */
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = ic(type === 'err' ? 'circle-x' : type === 'warn' ? 'triangle-alert' : 'circle-check') + `<span>${esc(msg)}</span>`;
  $('#toasts').append(el); icons();
  setTimeout(() => el.classList.add('out'), 3000);
  setTimeout(() => el.remove(), 3400);
}

const modalStack = [];
function openModal({ title, body, footer = '', size = '', icon = 'pill', cls = '', onMount, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `<div class="modal ${size} ${cls}">
    <div class="modal-head"><div class="mh-title">${ic(icon)}<h3>${esc(title)}</h3></div><button class="icon-btn" data-close title="إغلاق">${ic('x')}</button></div>
    <div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ''}</div>`;
  $('#modal-root').append(wrap);
  modalStack.push({ el: wrap, onClose });
  wrap.addEventListener('mousedown', e => { wrap._down = e.target; });
  wrap.addEventListener('click', e => {
    if ((e.target === wrap && wrap._down === wrap) || e.target.closest('[data-close]')) closeModal(wrap);
  });
  icons();
  requestAnimationFrame(() => wrap.classList.add('show'));
  onMount && onMount(wrap);
  return wrap;
}
function closeModal(el) {
  const i = el ? modalStack.findIndex(m => m.el === el) : modalStack.length - 1;
  if (i < 0) return;
  const [m] = modalStack.splice(i, 1);
  m.onClose && m.onClose();
  m.el.classList.remove('show');
  setTimeout(() => m.el.remove(), 200);
}
function confirmDlg(msg, { ok = 'تأكيد', danger = false, title = 'تأكيد' } = {}) {
  return new Promise(res => {
    let done = false;
    const w = openModal({
      title, size: 'sm', icon: danger ? 'triangle-alert' : 'circle-check',
      body: `<p style="font-size:15px">${msg}</p>`,
      footer: `<button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(ok)}</button><button class="btn btn-ghost" data-close>إلغاء</button>`,
      onClose: () => { if (!done) res(false); }
    });
    $('[data-ok]', w).onclick = () => { done = true; res(true); closeModal(w); };
  });
}
function promptDlg({ title, label, type = 'text', value = '', icon = 'pencil', help = '' }) {
  return new Promise(res => {
    let done = false;
    const w = openModal({
      title, size: 'sm', icon,
      body: `<form id="pf" class="fld"><label>${esc(label)}</label><input name="v" type="${type}" ${type === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(value)}" required>${help ? `<span class="help">${help}</span>` : ''}</form>`,
      footer: `<button class="btn btn-primary" form="pf">${ic('check')} حفظ</button><button class="btn btn-ghost" data-close>إلغاء</button>`,
      onClose: () => { if (!done) res(null); },
      onMount: w => setTimeout(() => $('input', w).focus(), 80),
    });
    $('#pf', w).onsubmit = e => { e.preventDefault(); done = true; res($('input', w).value); closeModal(w); };
  });
}

/* =========================================================
   قارئ الباركود — الكاميرا + تحليل GS1 DataMatrix
   ========================================================= */
function beep() {
  try {
    const a = new (window.AudioContext || window.webkitAudioContext)(); const o = a.createOscillator(); const g = a.createGain();
    o.connect(g); g.connect(a.destination); o.frequency.value = 1250; g.gain.value = .12; o.start(); o.stop(a.currentTime + .12);
  } catch (e) { }
}

/** يحلل الكود: باركود عادي أو GS1 (الموجود على علب الأدوية) ويستخرج GTIN والصلاحية والتشغيلة */
function parseCode(raw) {
  let s = String(raw || '').trim().replace(/^\][A-Za-z]\d/, '');
  const GS = '\x1d', out = { raw: s };
  if (/^\(\d{2}\)/.test(s)) s = s.replace(/\((\d{2,4})\)/g, (m, ai) => GS + ai).replace(/^\x1d/, '');
  if (/^01\d{14}/.test(s) && s.length > 16) {
    let i = 0;
    while (i < s.length) {
      if (s[i] === GS) { i++; continue; }
      const ai = s.substr(i, 2);
      if (ai === '01') { out.gtin = s.substr(i + 2, 14); i += 16; }
      else if (ai === '17' || ai === '11' || ai === '15') { if (ai === '17') out.exp = s.substr(i + 2, 6); i += 8; }
      else if (ai === '10' || ai === '21') {
        let j = s.indexOf(GS, i + 2); if (j < 0) j = s.length;
        out[ai === '10' ? 'lot' : 'serial'] = s.slice(i + 2, j); i = j;
      } else break;
    }
  }
  let code = out.gtin || s;
  if (/^0\d{13}$/.test(code)) code = code.slice(1); // GTIN-14 → EAN-13
  out.code = code;
  if (out.exp && /^\d{6}$/.test(out.exp)) {
    const y = 2000 + +out.exp.slice(0, 2), m = +out.exp.slice(2, 4); let d = +out.exp.slice(4, 6);
    if (!d) d = new Date(y, m, 0).getDate();
    out.expiry = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  return out;
}
function findDrug(code) {
  const c = String(code || '').trim(); if (!c) return null;
  for (const t of [c, c.replace(/^0+/, ''), '0' + c]) { const d = Store.get('drugs', t); if (d) return d; }
  return null;
}

const Scanner = {
  inst: null,
  async open(onResult) {
    if (!window.Html5Qrcode) return toast('مكتبة قراءة الباركود غير محمّلة', 'err');
    let done = false;
    openModal({
      title: 'قراءة الباركود بالكاميرا', icon: 'scan-barcode', cls: 'scanner-modal',
      body: `<div id="reader"></div><div class="scan-hint">وجّه الكاميرا نحو باركود العلبة وثبّتها قليلاً</div>
             <div class="scan-tools"><button class="btn btn-sm" id="torchBtn" hidden>${ic('flashlight')} الفلاش</button></div>`,
      onClose: () => this.stop(),
    });
    const F = Html5QrcodeSupportedFormats;
    const formats = [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.CODE_93, F.ITF, F.CODABAR, F.QR_CODE, F.DATA_MATRIX].filter(x => x !== undefined);
    try {
      this.inst = new Html5Qrcode('reader', { formatsToSupport: formats, verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      await this.inst.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: (w, h) => ({ width: Math.floor(Math.min(w * .88, 380)), height: Math.floor(Math.min(h * .55, 200)) }) },
        txt => {
          if (done) return; done = true;
          beep(); navigator.vibrate && navigator.vibrate(90);
          closeModal(); onResult(txt);
        }, () => { }
      );
      // زر الفلاش إن كانت الكاميرا تدعمه
      try {
        const caps = this.inst.getRunningTrackCapabilities();
        if (caps && caps.torch) {
          const b = $('#torchBtn'); b.hidden = false; let on = false;
          b.onclick = () => { on = !on; this.inst.applyVideoConstraints({ advanced: [{ torch: on }] }).catch(() => { }); };
        }
      } catch (e) { }
    } catch (e) {
      const r = $('#reader');
      if (r) r.innerHTML = `<div class="cam-err">${ic('camera-off')}<br><b>تعذر تشغيل الكاميرا</b><br>
        تأكد من السماح للمتصفح باستخدام الكاميرا، وأن الصفحة مفتوحة عبر رابط آمن <b>https</b> (مثل GitHub Pages).<br>
        <small>${esc(e && (e.message || e))}</small></div>`;
      icons();
    }
  },
  async stop() {
    const inst = this.inst; this.inst = null;
    if (!inst) return;
    try { if (inst.isScanning) await inst.stop(); inst.clear(); } catch (e) { }
  },
};

/* =========================================================
   الحالة والتنقل
   ========================================================= */
const state = {
  user: null, page: 'dashboard', cart: [], discount: 0,
  drugsFilter: { q: '', f: 'all', limit: 60 },
  salesFilter: { period: 'today', user: '' },
  settingsTab: 'general', fieldsDraft: null, citizenQ: '',
};
const NAV = {
  dashboard: { label: 'الرئيسية', icon: 'layout-dashboard', roles: ['admin', 'pharmacist'], sub: 'نظرة عامة على الصيدلية' },
  scan: { label: 'مسح باركود', icon: 'scan-barcode', roles: ['admin', 'pharmacist', 'citizen'], sub: 'ابحث عن الدواء أو أضفه بالباركود' },
  drugs: { label: 'الأدوية والمخزون', icon: 'pill', roles: ['admin', 'pharmacist'], sub: 'قاعدة بيانات الأدوية التي أنشأتها' },
  pos: { label: 'نقطة البيع', icon: 'shopping-cart', roles: ['admin', 'pharmacist'], sub: 'بيع سريع بالباركود' },
  sales: { label: 'المبيعات والتقارير', icon: 'receipt', roles: ['admin', 'pharmacist'], sub: 'سجل الفواتير والأكثر مبيعاً' },
  users: { label: 'المستخدمون', icon: 'users', roles: ['admin'], sub: 'حسابات المسئولين والصيادلة' },
  settings: { label: 'الإعدادات', icon: 'settings', roles: ['admin'], sub: 'بيانات الصيدلية وحقول الدواء وقاعدة البيانات' },
  search: { label: 'ابحث عن دواء', icon: 'search', roles: ['citizen'], sub: 'اعرف توفر الدواء وسعره' },
  about: { label: 'عن الصيدلية', icon: 'store', roles: ['citizen'], sub: 'العنوان والتواصل ومواعيد العمل' },
};
const navFor = role => Object.entries(NAV).filter(([, v]) => v.roles.includes(role)).map(([k]) => k);

function saveSession() { if (state.user) localStorage.setItem('pharma_session', JSON.stringify({ id: state.user.id, role: state.user.role })); else localStorage.removeItem('pharma_session'); }
function restoreSession() {
  try {
    const s = JSON.parse(localStorage.getItem('pharma_session') || 'null'); if (!s) return false;
    if (s.role === 'citizen') { if (!S().citizenEnabled) return false; state.user = { id: 'guest', name: 'زائر', role: 'citizen' }; return true; }
    const u = Store.get('users', s.id); if (!u || !u.active) return false;
    state.user = u; return true;
  } catch (e) { return false; }
}

function boot() {
  if (state.user) renderApp(); else renderLogin();
  const sp = $('#splash'); sp.classList.add('hide'); setTimeout(() => sp.remove(), 450);
}

/* =========================================================
   شاشة الدخول
   ========================================================= */
function renderLogin(role = 'admin') {
  const s = S();
  const admin = Store.get('users', 'admin');
  const shapes = Array.from({ length: 14 }, (_, i) => {
    const t = ['pill', 'cross', 'dot'][i % 3];
    return `<span class="${t}" style="top:${(i * 37) % 95}%;left:${(i * 53) % 95}%;--r:${(i * 47) % 180}deg;animation-delay:-${i * 1.3}s;animation-duration:${10 + (i % 5) * 2}s"></span>`;
  }).join('');
  $('#root').innerHTML = `
  <div class="login-page">
    <div class="bg-shapes">${shapes}</div>
    <div class="login-card">
      <div class="login-brand">${LOGO}<h1>${esc(s.pharmacyName)}</h1><p>نظام ذكي لإدارة الصيدلية بالباركود</p></div>
      <div class="role-tabs">
        <button class="role-tab" data-role="admin"><span class="rt-ic">${ic('shield-check')}</span>مسئول</button>
        <button class="role-tab" data-role="pharmacist"><span class="rt-ic">${ic('stethoscope')}</span>صيدلي</button>
        ${s.citizenEnabled ? `<button class="role-tab" data-role="citizen"><span class="rt-ic">${ic('user')}</span>مواطن</button>` : ''}
      </div>
      <form id="loginForm" class="login-form">
        <div class="input-ic">${ic('user')}<input name="u" placeholder="اسم المستخدم" autocomplete="username" required autocapitalize="none"></div>
        <div class="input-ic">${ic('lock')}<input name="p" type="password" placeholder="كلمة المرور" autocomplete="current-password" required></div>
        <button class="btn btn-primary btn-xl btn-block" type="submit">${ic('log-in')} تسجيل الدخول</button>
      </form>
      <div class="citizen-box" id="citizenBox" hidden>
        <p>تصفّح الأدوية المتوفرة في الصيدلية واعرف أسعارها، أو امسح باركود العلبة بكاميرا جوالك.</p>
        <button class="btn btn-primary btn-xl btn-block" id="guestBtn">${ic('search')} الدخول كمواطن</button>
      </div>
      ${admin && admin.mustChange ? `<div class="login-hint">${ic('key-round')}<span>أول دخول للمسئول: اسم المستخدم <b>admin</b> وكلمة المرور <b>admin123</b> — سيُطلب منك تغييرها فوراً.</span></div>` : ''}
    </div>
    <div class="login-foot">${ic(Store.mode === 'cloud' ? 'cloud' : 'hard-drive')}<span>${Store.mode === 'cloud' ? 'متصل بقاعدة البيانات السحابية' : 'قاعدة بيانات محلية على هذا الجهاز'}</span></div>
  </div>`;
  icons();
  const setRole = r => {
    $$('.role-tab').forEach(b => b.classList.toggle('active', b.dataset.role === r));
    $('#loginForm').hidden = r === 'citizen'; $('#citizenBox').hidden = r !== 'citizen';
    $('#loginForm').dataset.role = r;
  };
  $$('.role-tab').forEach(b => b.onclick = () => setRole(b.dataset.role));
  setRole(role);
  if (Store.cloudError) toast('تعذر الاتصال بالسحابة — يعمل التطبيق محلياً', 'warn');
  $('#guestBtn') && ($('#guestBtn').onclick = () => { state.user = { id: 'guest', name: 'زائر', role: 'citizen' }; saveSession(); state.page = 'search'; renderApp(); });
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    const f = e.target, tab = f.dataset.role;
    const un = f.u.value.trim().toLowerCase(), u = Store.get('users', un);
    if (!u || u.pass !== await passHash(un, f.p.value)) return toast('اسم المستخدم أو كلمة المرور غير صحيحة', 'err');
    if (!u.active) return toast('هذا الحساب موقوف، راجع المسئول', 'err');
    if (tab === 'admin' && u.role !== 'admin') return toast('هذا الحساب ليس حساب مسئول — اختر "صيدلي"', 'err');
    state.user = u; saveSession();
    state.page = 'dashboard';
    renderApp();
    toast(`أهلاً ${u.name}`);
    if (u.mustChange) changePassword(true);
  };
}

/* =========================================================
   الهيكل العام
   ========================================================= */
function renderApp() {
  const u = state.user, s = S(), items = navFor(u.role);
  if (!items.includes(state.page)) state.page = items[0];
  const sb = items.map(k => `<button class="sb-item" data-nav="${k}">${ic(NAV[k].icon)}<span>${NAV[k].label}</span>${k === 'pos' ? '<span class="count cart-count" hidden></span>' : ''}</button>`).join('');
  const bottom = u.role === 'citizen'
    ? ['search', '__scan', 'about']
    : ['dashboard', 'drugs', '__scan', 'pos', '__more'];
  const bn = bottom.map(k => {
    if (k === '__scan') return `<div class="bn-fab"><button data-nav="scan" aria-label="مسح باركود">${ic('scan-barcode')}</button></div>`;
    if (k === '__more') return `<button class="bn-item" data-act="drawer">${ic('ellipsis')}<span>المزيد</span></button>`;
    return `<button class="bn-item" data-nav="${k}">${ic(NAV[k].icon)}<span>${({dashboard:'الرئيسية',drugs:'الأدوية',pos:'البيع',search:'بحث',about:'الصيدلية'})[k]||NAV[k].label}</span>${k === 'pos' ? '<span class="count cart-count" hidden></span>' : ''}</button>`;
  }).join('');
  const isC = u.role === 'citizen';
  $('#root').innerHTML = `
  <div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="sb-brand"><img src="icons/icon.svg" alt=""><div><b>${esc(s.pharmacyName)}</b><small>نظام إدارة الصيدلية</small></div></div>
      <nav class="sb-nav">${sb}</nav>
      <div class="sb-foot">
        <div class="user-card"><div class="avatar">${esc((u.name || '?').trim()[0])}</div><div><b>${esc(u.name)}</b><small>${ROLE_LABEL[u.role]}</small></div></div>
        ${isC ? '' : `<button class="sb-item" data-act="changePass">${ic('key-round')}<span>تغيير كلمة المرور</span></button>`}
        <button class="sb-item" data-act="logout">${ic('log-out')}<span>${isC ? 'خروج' : 'تسجيل الخروج'}</span></button>
      </div>
    </aside>
    <div class="sb-overlay" id="sbOverlay"></div>
    <main class="main">
      <header class="topbar"><div class="tb-row">
        <button class="icon-btn tb-menu" data-act="drawer" aria-label="القائمة">${ic('menu')}</button>
        <div class="tb-title"><h2 id="pgTitle"></h2><p id="pgSub"></p></div>
        <div class="tb-actions">
          <span class="chip ${Store.mode === 'cloud' ? 'cloud' : ''} hide-m"><span class="dotc"></span>${Store.mode === 'cloud' ? 'سحابي متزامن' : 'محلي'}</span>
          <span class="chip">${ic(isC ? 'user' : u.role === 'admin' ? 'shield-check' : 'stethoscope')}<span class="hide-m">${esc(u.name)}</span></span>
        </div>
      </div></header>
      <section id="view" class="view"></section>
    </main>
    <nav class="bottom-nav">${bn}</nav>
  </div>`;
  $('#sbOverlay').onclick = () => drawer(false);
  go(state.page);
}

function drawer(open) {
  const sb = $('#sidebar'); if (!sb) return;
  open = open ?? !sb.classList.contains('open');
  sb.classList.toggle('open', open); $('#sbOverlay').classList.toggle('show', open);
}

function go(page) {
  if (!navFor(state.user.role).includes(page)) page = navFor(state.user.role)[0];
  if (state.page === 'scan' || page !== state.page) Scanner.stop();
  state.page = page;
  $$('[data-nav]').forEach(b => b.classList.toggle('active', b.dataset.nav === page));
  $('#pgTitle').innerHTML = `${NAV[page].label}`;
  $('#pgSub').textContent = NAV[page].sub;
  drawer(false);
  renderPage();
  window.scrollTo({ top: 0 });
}
function renderPage() {
  const v = $('#view'); if (!v) return;
  v.style.animation = 'none'; v.offsetHeight; v.style.animation = '';
  (PAGES[state.page] || PAGES.dashboard)();
  updateCartCount();
  icons();
}
function updateCartCount() {
  const n = state.cart.reduce((a, b) => a + b.qty, 0);
  $$('.cart-count').forEach(el => { el.hidden = !n; el.textContent = n; });
}

/* ---------- تفويض الأحداث العامة ---------- */
document.addEventListener('click', e => {
  const nav = e.target.closest('[data-nav]');
  if (nav) { go(nav.dataset.nav); return; }
  const a = e.target.closest('[data-act]');
  if (a && ACTIONS[a.dataset.act]) { e.stopPropagation(); ACTIONS[a.dataset.act](a.dataset.id, a); }
});

const ACTIONS = {
  drawer: () => drawer(),
  logout: async () => { if (await confirmDlg('هل تريد تسجيل الخروج؟', { ok: 'خروج' })) { state.user = null; state.cart = []; saveSession(); renderLogin(); } },
  changePass: () => changePassword(false),
  view: id => openDrugDetails(id),
  edit: id => { closeAllModals(); openDrugForm(id); },
  stock: id => addStock(id),
  cart: id => { addToCart(id); },
  del: id => deleteDrug(id),
  add: () => openDrugForm(null, {}),
  scanTo: (id, el) => Scanner.open(code => handleScan(code, el.dataset.ctx || state.page)),
};
function closeAllModals() { while (modalStack.length) closeModal(); }

/* ---------- حالة المخزون والصلاحية ---------- */
function stockStatus(d) {
  const q = num(d.qty), s = S();
  if (q <= 0) return { cls: 'b-danger', label: 'نفدت الكمية', icon: 'circle-x', k: 'out' };
  if (q <= s.lowStock) return { cls: 'b-warn', label: `قاربت على النفاد (${fmtNum(q)})`, icon: 'triangle-alert', k: 'low' };
  return { cls: 'b-ok', label: `متوفر (${fmtNum(q)})`, icon: 'circle-check', k: 'ok' };
}
function expiryStatus(d) {
  if (!d.expiry) return null;
  const n = daysTo(d.expiry);
  if (n < 0) return { cls: 'b-danger', label: 'منتهي الصلاحية', icon: 'calendar-x', k: 'expired', n };
  if (n <= S().expiryDays) return { cls: 'b-warn', label: `ينتهي خلال ${n} يوم`, icon: 'clock', k: 'near', n };
  return { cls: 'b-teal', label: `صالح حتى ${fmtD(d.expiry)}`, icon: 'calendar-check', k: 'ok', n };
}
function formIcon(d) {
  const f = d.form || '';
  if (/شراب|نقط/.test(f)) return 'flask-conical';
  if (/حقن/.test(f)) return 'syringe';
  if (/كريم|مرهم/.test(f)) return 'droplet';
  if (/بخاخ/.test(f)) return 'spray-can';
  if (/مستلزمات/.test(f)) return 'package';
  return 'pill';
}
function fieldDisplay(f, v) {
  if (v === undefined || v === null || v === '') return '—';
  if (f.key === 'price' || f.key === 'cost') return money(v);
  if (f.type === 'number') return fmtNum(v);
  if (f.type === 'date') return fmtD(v);
  return esc(v);
}

/* =========================================================
   الصفحات
   ========================================================= */
const PAGES = {};
const view = html => { $('#view').innerHTML = html; };
const emptyBox = (icon, title, sub = '', extra = '') => `<div class="empty"><div class="e-ic">${ic(icon)}</div><b>${title}</b><p>${sub}</p>${extra}</div>`;

function computeStats() {
  const s = S(), d = Store.all('drugs'); const r = { total: d.length, low: 0, out: 0, near: 0, exp: 0, value: 0 };
  d.forEach(x => {
    const q = num(x.qty);
    if (q <= 0) r.out++; else if (q <= s.lowStock) r.low++;
    r.value += Math.max(q, 0) * num(x.price);
    if (x.expiry) { const n = daysTo(x.expiry); if (n < 0) r.exp++; else if (n <= s.expiryDays) r.near++; }
  });
  const t = localDate(); const sales = Store.all('sales').filter(x => x.date === t);
  r.todaySum = sales.reduce((a, b) => a + num(b.total), 0); r.todayCount = sales.length;
  return r;
}

/* ---------- الرئيسية ---------- */
PAGES.dashboard = () => {
  const st = computeStats(), s = S(), u = state.user;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const drugs = Store.all('drugs');
  const lowList = drugs.filter(d => num(d.qty) <= s.lowStock).sort((a, b) => num(a.qty) - num(b.qty)).slice(0, 8);
  const expList = drugs.filter(d => d.expiry && daysTo(d.expiry) <= s.expiryDays).sort((a, b) => a.expiry.localeCompare(b.expiry)).slice(0, 8);
  const recent = Store.all('sales').sort((a, b) => b.at - a.at).slice(0, 6);
  const stat = (c, icon, val, label, f) => `<button class="stat ${c}" data-gofilter="${f || ''}"><div class="stat-ic">${ic(icon)}</div><div><b>${val}</b><small>${label}</small></div></button>`;
  view(`
    <div class="stats">
      ${stat('c-teal', 'pill', fmtNum(st.total), 'إجمالي الأصناف', 'all')}
      ${stat('c-green', 'wallet', money(st.todaySum), `مبيعات اليوم (${st.todayCount} فاتورة)`, 'sales')}
      ${stat('c-amber', 'triangle-alert', fmtNum(st.low), 'قاربت على النفاد', 'low')}
      ${stat('c-rose', 'circle-x', fmtNum(st.out), 'نفدت كميتها', 'out')}
      ${stat('c-violet', 'clock', fmtNum(st.near), 'صلاحية قريبة', 'near')}
      ${stat('c-rose', 'calendar-x', fmtNum(st.exp), 'منتهية الصلاحية', 'expired')}
    </div>
    <div class="card welcome">
      <div><h3>${greet}، ${esc(u.name)} 👋</h3><p>قيمة المخزون الحالية: <b>${money(st.value)}</b></p></div>
      <div class="quick">
        <button class="btn btn-primary" data-nav="scan">${ic('scan-barcode')} مسح باركود</button>
        <button class="btn btn-soft" data-act="add">${ic('plus')} دواء جديد</button>
        <button class="btn btn-soft" data-nav="pos">${ic('shopping-cart')} بيع</button>
      </div>
    </div>
    <div class="grid-2" style="margin-top:18px">
      <div class="card"><div class="card-head"><h3>${ic('triangle-alert')} أصناف تحتاج إعادة طلب</h3></div>
        ${lowList.length ? `<div class="list">${lowList.map(d => { const ss = stockStatus(d); return `<div class="list-item" data-act="view" data-id="${esc(d.id)}"><div class="li-ic">${ic(formIcon(d))}</div><div class="li-main"><b>${esc(d.name)}</b><small class="barcode-txt">${esc(d.barcode)}</small></div><span class="badge ${ss.cls}">${ss.label}</span></div>`; }).join('')}</div>`
      : emptyBox('package-check', 'المخزون جيد', 'لا توجد أصناف قاربت على النفاد')}
      </div>
      <div class="card"><div class="card-head"><h3>${ic('clock')} تنبيهات الصلاحية</h3></div>
        ${expList.length ? `<div class="list">${expList.map(d => { const es = expiryStatus(d); return `<div class="list-item" data-act="view" data-id="${esc(d.id)}"><div class="li-ic">${ic(formIcon(d))}</div><div class="li-main"><b>${esc(d.name)}</b><small>${fmtD(d.expiry)}</small></div><span class="badge ${es.cls}">${es.label}</span></div>`; }).join('')}</div>`
      : emptyBox('calendar-check', 'لا توجد تنبيهات', 'كل الأصناف صلاحيتها بعيدة')}
      </div>
    </div>
    <div class="card"><div class="card-head"><h3>${ic('receipt')} آخر المبيعات</h3><button class="btn btn-sm btn-soft" data-nav="sales">عرض الكل</button></div>
      ${recent.length ? `<div class="list">${recent.map(x => `<div class="list-item" data-sale="${esc(x.id)}"><div class="li-ic">${ic('receipt')}</div><div class="li-main"><b>فاتورة #${esc(x.no)} — ${x.items.length} صنف</b><small>${fmtDT(x.at)} • ${esc(x.byName || x.by)}</small></div><b style="color:var(--pd)">${money(x.total)}</b></div>`).join('')}</div>`
      : emptyBox('receipt', 'لا توجد مبيعات بعد', 'ابدأ البيع من نقطة البيع')}
    </div>`);
  $$('[data-gofilter]').forEach(b => b.onclick = () => {
    const f = b.dataset.gofilter;
    if (f === 'sales') return go('sales');
    state.drugsFilter = { q: '', f, limit: 60 }; go('drugs');
  });
  $$('[data-sale]').forEach(b => b.onclick = () => openSale(b.dataset.sale));
};

/* ---------- مسح الباركود ---------- */
PAGES.scan = () => {
  const staff = isStaff();
  view(`
    <div class="card scan-hero">
      <div class="scan-visual"><div class="bars"></div><div class="laser"></div></div>
      <h2>امسح باركود الدواء</h2>
      <p>${staff ? 'إذا كان الدواء مسجلاً ستظهر بياناته، وإن لم يكن سيفتح نموذج إضافته فوراً' : 'اعرف هل الدواء متوفر في الصيدلية وسعره'}</p>
      <button class="btn btn-primary btn-xl" data-act="scanTo" data-ctx="scan">${ic('camera')} فتح الكاميرا</button>
      <div class="or">أو</div>
      <form id="codeForm" class="code-input">${ic('barcode')}<input id="codeIn" placeholder="اكتب الباركود أو استخدم قارئ الباركود (USB)" enterkeyhint="search" autocomplete="off"><button class="btn btn-soft">بحث</button></form>
      <p class="help" style="margin-top:10px">${ic('info', 'ic-sm')} قارئ الباركود السلكي يعمل تلقائياً على الكمبيوتر — فقط اجعل المؤشر داخل الخانة</p>
    </div>
    <div id="scanResult"></div>`);
  const inp = $('#codeIn');
  if (window.matchMedia('(min-width:900px)').matches) inp.focus();
  $('#codeForm').onsubmit = e => { e.preventDefault(); const v = inp.value.trim(); if (v) { handleScan(v, 'scan'); inp.value = ''; } };
};

function handleScan(raw, ctx) {
  const p = parseCode(raw);
  if (ctx === 'pos') return posAddByCode(p.code);
  if (ctx === 'form') return;
  if (ctx === 'search') { state.citizenQ = p.code; }
  if (state.page !== 'scan') go('scan');
  const d = findDrug(p.code), box = $('#scanResult');
  if (d) {
    box.innerHTML = drugCard(d);
    if (isStaff() && p.expiry && d.expiry !== p.expiry) {
      box.insertAdjacentHTML('beforeend', `<div class="card" style="max-width:720px;margin:12px auto 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap">${ic('calendar-clock')}<span style="flex:1">صلاحية هذه العلبة حسب الكود: <b>${fmtD(p.expiry)}</b></span><button class="btn btn-sm btn-soft" id="updExp">تحديث الصلاحية</button></div>`);
      $('#updExp').onclick = async () => { d.expiry = p.expiry; d.updatedAt = Date.now(); await Store.put('drugs', d); toast('تم تحديث الصلاحية'); handleScan(raw, 'scan'); };
    }
  } else if (isStaff()) {
    box.innerHTML = `<div class="card drug-card" style="padding:0">${emptyBox('package-plus', 'هذا الدواء غير مسجل بعد', `الباركود <span class="barcode-txt">${esc(p.code)}</span> غير موجود في قاعدة بياناتك`,
      `<button class="btn btn-primary" id="addNew">${ic('plus')} إضافة الدواء الآن</button>`)}</div>`;
    const open = () => openDrugForm(null, { barcode: p.code, expiry: p.expiry || '' });
    $('#addNew').onclick = open; icons(); open();
  } else {
    box.innerHTML = `<div class="card drug-card" style="padding:0">${emptyBox('search-x', 'الدواء غير متوفر حالياً', 'لم نجد هذا الدواء في الصيدلية، يمكنك التواصل معنا للاستفسار')}</div>`;
  }
  icons();
}

/* ---------- بطاقة الدواء ---------- */
function drugCard(d, { modal = false } = {}) {
  const staff = isStaff(), s = S();
  const ss = stockStatus(d), es = expiryStatus(d);
  const shown = fields().filter(f => !['name', 'scientific', 'price'].includes(f.key) && (staff || f.public) && !(f.key === 'qty' && !staff));
  let badges;
  if (staff) badges = `<span class="badge ${ss.cls}">${ic(ss.icon)}${ss.label}</span>${es ? `<span class="badge ${es.cls}">${ic(es.icon)}${es.label}</span>` : ''}`;
  else badges = num(d.qty) > 0 ? `<span class="badge b-ok">${ic('circle-check')}متوفر${s.citizenSeesQty ? ` (${fmtNum(d.qty)})` : ''}</span>` : `<span class="badge b-danger">${ic('circle-x')}غير متوفر حالياً</span>`;
  if (d.rx === 'نعم') badges += `<span class="badge b-info">${ic('file-text')}يُصرف بروشتة</span>`;
  return `<div class="${modal ? '' : 'card '}drug-card" ${modal ? 'style="margin:0;max-width:none"' : ''}>
    <div class="dc-head">
      <div class="dc-ic">${ic(formIcon(d))}</div>
      <div class="dc-title"><h3>${esc(d.name)}</h3><p>${esc(d.scientific || '')}${d.scientific ? ' • ' : ''}<span class="barcode-txt">${esc(d.barcode)}</span></p></div>
      <div class="dc-price"><b>${money(d.price)}</b><small>سعر البيع</small></div>
    </div>
    <div class="dc-badges">${badges}</div>
    <div class="dc-grid">${shown.map(f => `<div class="dc-f"><small>${esc(f.label)}</small><span>${fieldDisplay(f, d[f.key])}</span></div>`).join('')}</div>
    ${staff ? `<div class="dc-actions">
      <button class="btn btn-primary" data-act="cart" data-id="${esc(d.id)}">${ic('shopping-cart')} إضافة للسلة</button>
      <button class="btn btn-soft" data-act="stock" data-id="${esc(d.id)}">${ic('package-plus')} إضافة كمية</button>
      <button class="btn btn-soft" data-act="edit" data-id="${esc(d.id)}">${ic('pencil')} تعديل</button>
      ${isAdmin() ? `<button class="btn btn-danger" data-act="del" data-id="${esc(d.id)}">${ic('trash-2')} حذف</button>` : ''}
    </div>` : ''}
  </div>`;
}
function openDrugDetails(id) {
  const d = Store.get('drugs', id); if (!d) return toast('الصنف غير موجود', 'err');
  openModal({ title: 'بيانات الدواء', size: 'lg', icon: formIcon(d), body: drugCard(d, { modal: true }) });
}

/* ---------- نموذج إضافة / تعديل دواء (حقوله من الإعدادات) ---------- */
function fieldInput(f, v) {
  const req = f.required ? 'required' : '';
  const lab = `<label for="f_${f.key}">${esc(f.label)}${f.required ? ' <b class="req">*</b>' : ''}</label>`;
  const val = esc(v ?? '');
  let inp;
  switch (f.type) {
    case 'number': inp = `<input id="f_${f.key}" type="number" step="any" ${['qty', 'price', 'cost'].includes(f.key) ? 'min="0"' : ''} inputmode="decimal" name="${f.key}" value="${val}" ${req}>`; break;
    case 'date': inp = `<input id="f_${f.key}" type="date" name="${f.key}" value="${val}" ${req}>`; break;
    case 'textarea': inp = `<textarea id="f_${f.key}" name="${f.key}" rows="2" ${req}>${val}</textarea>`; break;
    case 'select': {
      const opts = [...(f.options || [])]; if (v && !opts.includes(v)) opts.push(v);
      inp = `<select id="f_${f.key}" name="${f.key}" ${req}><option value="">— اختر —</option>${opts.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`; break;
    }
    default: inp = `<input id="f_${f.key}" type="text" name="${f.key}" value="${val}" ${req}>`;
  }
  return `<div class="fld ${f.type === 'textarea' ? 'full' : ''}">${lab}${inp}</div>`;
}

function openDrugForm(id, preset = {}) {
  const isNew = !id;
  const old = id ? Store.get('drugs', id) : null;
  const d = old ? clone(old) : { ...preset };
  const w = openModal({
    title: isNew ? 'إضافة دواء جديد' : 'تعديل بيانات الدواء', size: 'lg', icon: isNew ? 'package-plus' : 'pencil',
    body: `<form id="drugForm" class="form-grid" novalidate>
      <div class="fld full"><label for="f_barcode">الباركود <b class="req">*</b></label>
        <div class="input-group"><input id="f_barcode" name="barcode" class="barcode-txt" value="${esc(d.barcode || '')}" ${isNew ? '' : 'readonly'} required placeholder="امسح أو اكتب الباركود">
        ${isNew ? `<button type="button" class="btn btn-soft" id="fScan" title="مسح بالكاميرا">${ic('scan-barcode')}</button>` : ''}</div></div>
      ${fields().map(f => fieldInput(f, d[f.key])).join('')}
    </form>`,
    footer: `<button class="btn btn-primary" type="submit" form="drugForm">${ic('check')} حفظ الدواء</button><button class="btn btn-ghost" data-close>إلغاء</button>`,
    onMount: w => {
      const first = isNew && d.barcode ? $('#f_name', w) : $(isNew ? '#f_barcode' : '#f_name', w);
      setTimeout(() => first && first.focus(), 120);
    }
  });
  const fs = $('#fScan', w);
  if (fs) fs.onclick = () => Scanner.open(code => { const p = parseCode(code); $('#f_barcode', w).value = p.code; if (p.expiry && $('#f_expiry', w) && !$('#f_expiry', w).value) $('#f_expiry', w).value = p.expiry; });
  $('#drugForm', w).onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const barcode = String(fd.get('barcode') || '').trim();
    if (!barcode) return toast('الباركود مطلوب', 'err');
    const vals = {};
    for (const f of fields()) {
      let v = String(fd.get(f.key) ?? '').trim();
      if (f.required && v === '') { $(`#f_${f.key}`, w).focus(); return toast(`الحقل "${f.label}" مطلوب`, 'err'); }
      vals[f.key] = f.type === 'number' ? (v === '' ? '' : num(v)) : v;
    }
    if (isNew) {
      const ex = findDrug(barcode);
      if (ex) {
        if (await confirmDlg(`الباركود مسجل بالفعل باسم <b>${esc(ex.name)}</b>. هل تريد فتحه للتعديل؟`, { ok: 'فتح للتعديل' })) { closeModal(w); openDrugForm(ex.id); }
        return;
      }
    }
    const obj = {
      ...(old || {}), ...vals, id: barcode, barcode,
      createdAt: old?.createdAt || Date.now(), createdBy: old?.createdBy || state.user.username || state.user.id,
      updatedAt: Date.now(), updatedBy: state.user.username || state.user.id,
    };
    try { await Store.put('drugs', obj); } catch (err) { return toast('تعذر الحفظ: ' + err.message, 'err'); }
    closeModal(w);
    toast(isNew ? 'تمت إضافة الدواء إلى قاعدة البيانات' : 'تم حفظ التعديلات');
    if (state.page === 'scan') { $('#scanResult').innerHTML = drugCard(obj); icons(); }
    else if (state.page !== 'pos') renderPage();
  };
}

async function addStock(id) {
  const d = Store.get('drugs', id); if (!d) return;
  const v = await promptDlg({ title: `إضافة كمية — ${d.name}`, label: 'الكمية المضافة (وارد جديد)', type: 'number', icon: 'package-plus', help: `الكمية الحالية: ${fmtNum(d.qty)}` });
  if (v === null || num(v) === 0) return;
  d.qty = num(d.qty) + num(v); d.updatedAt = Date.now(); d.updatedBy = state.user.username;
  await Store.put('drugs', d);
  toast(`تمت الإضافة — الكمية الآن ${fmtNum(d.qty)}`);
  closeAllModals();
  if (state.page === 'scan') { $('#scanResult').innerHTML = drugCard(d); icons(); } else renderPage();
}
async function deleteDrug(id) {
  const d = Store.get('drugs', id); if (!d) return;
  if (!await confirmDlg(`سيتم حذف <b>${esc(d.name)}</b> نهائياً من قاعدة البيانات.`, { ok: 'حذف', danger: true, title: 'حذف دواء' })) return;
  await Store.del('drugs', id);
  closeAllModals(); toast('تم الحذف');
  if (state.page === 'scan') $('#scanResult').innerHTML = ''; else renderPage();
}

/* ---------- الأدوية والمخزون ---------- */
function filteredDrugs() {
  const { q, f } = state.drugsFilter, s = S();
  let list = Store.all('drugs');
  if (q) { const k = norm(q); list = list.filter(d => norm(Object.values(d).join(' ')).includes(k)); }
  if (f && f !== 'all') list = list.filter(d => {
    const qq = num(d.qty), n = d.expiry ? daysTo(d.expiry) : null;
    if (f === 'low') return qq > 0 && qq <= s.lowStock;
    if (f === 'out') return qq <= 0;
    if (f === 'near') return n !== null && n >= 0 && n <= s.expiryDays;
    if (f === 'expired') return n !== null && n < 0;
    return true;
  });
  return list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
}
PAGES.drugs = () => {
  const F = state.drugsFilter;
  view(`
    <div class="card toolbar">
      <div class="search">${ic('search')}<input id="dq" placeholder="ابحث بالاسم أو المادة الفعالة أو الباركود…" value="${esc(F.q)}"></div>
      <select id="df">
        <option value="all">كل الأصناف</option><option value="low">قاربت على النفاد</option><option value="out">نفدت كميتها</option>
        <option value="near">صلاحية قريبة</option><option value="expired">منتهية الصلاحية</option>
      </select>
      <button class="btn btn-primary" data-act="add">${ic('plus')}<span class="btn-label">دواء جديد</span></button>
      <button class="btn btn-soft" data-act="scanTo" data-ctx="scan" title="مسح">${ic('scan-barcode')}<span class="btn-label">مسح</span></button>
      <button class="btn btn-soft" id="expCsv" title="تصدير Excel">${ic('download')}<span class="btn-label">تصدير</span></button>
    </div>
    <div class="card"><div id="drugsTable"></div></div>`);
  $('#df').value = F.f;
  $('#dq').oninput = debounce(e => { F.q = e.target.value; F.limit = 60; renderDrugsTable(); }, 200);
  $('#df').onchange = e => { F.f = e.target.value; F.limit = 60; renderDrugsTable(); };
  $('#expCsv').onclick = exportDrugsCSV;
  renderDrugsTable();
};
function renderDrugsTable() {
  const list = filteredDrugs(), F = state.drugsFilter;
  const cols = fields().filter(f => f.inList && f.key !== 'name');
  const box = $('#drugsTable');
  if (!Store.all('drugs').length) {
    box.innerHTML = emptyBox('database', 'قاعدة البيانات فارغة', 'ابدأ بمسح باركود أول دواء وسيُطلب منك إدخال بياناته — هكذا تبني قاعدة بياناتك بنفسك',
      `<button class="btn btn-primary" data-nav="scan">${ic('scan-barcode')} ابدأ المسح</button>`);
    icons(); return;
  }
  if (!list.length) { box.innerHTML = emptyBox('search-x', 'لا توجد نتائج', 'جرّب كلمة بحث أو فلتر مختلف'); icons(); return; }
  const rows = list.slice(0, F.limit).map(d => {
    const ss = stockStatus(d);
    return `<tr data-act="view" data-id="${esc(d.id)}">
      <td class="name-cell"><b>${esc(d.name)}</b><small class="barcode-txt">${esc(d.barcode)}</small></td>
      ${cols.map(f => {
      let v = fieldDisplay(f, d[f.key]);
      if (f.key === 'qty') v = `<span class="badge ${ss.cls}">${fmtNum(d.qty)}</span>`;
      if (f.key === 'expiry' && d.expiry) { const es = expiryStatus(d); v = `<span class="badge ${es.cls}">${fmtD(d.expiry)}</span>`; }
      return `<td data-label="${esc(f.label)}">${v}</td>`;
    }).join('')}
      <td class="actions">
        <button class="icon-btn sm" data-act="cart" data-id="${esc(d.id)}" title="إضافة للسلة">${ic('shopping-cart')}</button>
        <button class="icon-btn sm" data-act="stock" data-id="${esc(d.id)}" title="إضافة كمية">${ic('package-plus')}</button>
        <button class="icon-btn sm" data-act="edit" data-id="${esc(d.id)}" title="تعديل">${ic('pencil')}</button>
        ${isAdmin() ? `<button class="icon-btn sm danger" data-act="del" data-id="${esc(d.id)}" title="حذف">${ic('trash-2')}</button>` : ''}
      </td></tr>`;
  }).join('');
  box.innerHTML = `<div class="card-head"><span class="count-note">عدد النتائج: <b>${fmtNum(list.length)}</b> صنف</span></div>
    <div class="table-wrap"><table class="rtable"><thead><tr><th>الدواء</th>${cols.map(f => `<th>${esc(f.label)}</th>`).join('')}<th></th></tr></thead><tbody>${rows}</tbody></table></div>
    ${list.length > F.limit ? `<div class="more-row"><button class="btn btn-soft" id="moreBtn">${ic('chevron-down')} عرض المزيد (${fmtNum(list.length - F.limit)})</button></div>` : ''}`;
  const mb = $('#moreBtn'); if (mb) mb.onclick = () => { F.limit += 100; renderDrugsTable(); };
  icons();
}

/* ---------- CSV ---------- */
function toCSV(rows) { return '﻿' + rows.map(r => r.map(v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }).join(',')).join('\r\n'); }
function download(name, content, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([content], { type })); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportDrugsCSV() {
  const fl = fields(), list = filteredDrugs();
  download(`ادوية-${localDate()}.csv`, toCSV([['الباركود', ...fl.map(f => f.label)], ...list.map(d => [d.barcode, ...fl.map(f => d[f.key])])]));
  toast(`تم تصدير ${list.length} صنف — يفتح مباشرة في Excel`);
}
function parseCSV(text) {
  const rows = []; let row = [], v = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { v += '"'; i++; } else q = false; } else v += c; }
    else if (c === '"') q = true;
    else if (c === ',' || c === ';' || c === '\t') { row.push(v); v = ''; }
    else if (c === '\n') { row.push(v); rows.push(row); row = []; v = ''; }
    else if (c !== '\r') v += c;
  }
  if (v !== '' || row.length) { row.push(v); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}

/* ---------- نقطة البيع ---------- */
function addToCart(id, n = 1) {
  const d = Store.get('drugs', id); if (!d) return;
  if (num(d.qty) <= 0) toast(`تنبيه: ${d.name} غير متوفر في المخزون`, 'warn');
  const it = state.cart.find(x => x.id === d.id);
  if (it) it.qty += n; else state.cart.push({ id: d.id, name: d.name, price: num(d.price), qty: n });
  beep(); updateCartCount();
  if (state.page === 'pos') renderCart(); else toast(`أضيف "${d.name}" إلى السلة`);
}
function posAddByCode(code) {
  const d = findDrug(code);
  if (d) return addToCart(d.id);
  toast('الباركود غير مسجل', 'warn');
  if (isStaff()) confirmDlg(`الباركود <span class="barcode-txt">${esc(code)}</span> غير مسجل. هل تريد إضافته الآن؟`, { ok: 'إضافة' }).then(ok => ok && openDrugForm(null, { barcode: code }));
}
PAGES.pos = () => {
  view(`<div class="pos-grid">
    <div class="card">
      <form id="posForm" class="code-input" style="max-width:none">${ic('barcode')}<input id="posIn" placeholder="امسح الباركود أو اكتب اسم الدواء" autocomplete="off" enterkeyhint="go">
        <button type="button" class="btn btn-primary" data-act="scanTo" data-ctx="pos" title="الكاميرا">${ic('camera')}</button></form>
      <div id="posSuggest"></div>
      <div id="cartBox" class="cart"></div>
    </div>
    <div class="card pos-summary">
      <div class="card-head"><h3>${ic('receipt')} ملخص الفاتورة</h3></div>
      <div class="sum-row"><span>عدد القطع</span><b id="sCount">0</b></div>
      <div class="sum-row"><span>الإجمالي قبل الخصم</span><b id="sSub">0</b></div>
      <div class="sum-row"><span>خصم</span><input id="sDisc" type="number" min="0" step="any" inputmode="decimal" style="width:120px" value="${state.discount || ''}" placeholder="0"></div>
      <div class="sum-row total"><span>الصافي</span><b id="sTotal">0</b></div>
      <div class="fld" style="margin:12px 0"><input id="sCust" placeholder="اسم العميل (اختياري)"></div>
      <button class="btn btn-primary btn-xl btn-block" id="checkout">${ic('circle-check')} إتمام البيع</button>
      <button class="btn btn-ghost btn-block" id="clearCart" style="margin-top:8px">${ic('trash-2')} تفريغ السلة</button>
    </div></div>`);
  const inp = $('#posIn');
  if (window.matchMedia('(min-width:900px)').matches) inp.focus();
  const suggest = q => {
    const box = $('#posSuggest');
    if (!q || q.length < 2) { box.innerHTML = ''; return; }
    const k = norm(q);
    const res = Store.all('drugs').filter(d => norm(`${d.name} ${d.scientific || ''} ${d.barcode}`).includes(k)).slice(0, 8);
    box.innerHTML = res.length ? `<div class="suggest">${res.map(d => `<button type="button" data-pick="${esc(d.id)}">${ic(formIcon(d))}<span><b>${esc(d.name)}</b> <small class="count-note">${esc(d.scientific || '')}</small></span><span class="badge ${stockStatus(d).cls}">${fmtNum(d.qty)}</span><b>${money(d.price)}</b></button>`).join('')}</div>` : '';
    $$('[data-pick]', box).forEach(b => b.onclick = () => { addToCart(b.dataset.pick); inp.value = ''; box.innerHTML = ''; inp.focus(); });
    icons();
  };
  inp.oninput = debounce(() => suggest(inp.value.trim()), 150);
  $('#posForm').onsubmit = e => {
    e.preventDefault(); const v = inp.value.trim(); if (!v) return;
    const d = findDrug(parseCode(v).code);
    if (d) { addToCart(d.id); inp.value = ''; $('#posSuggest').innerHTML = ''; return; }
    const first = $('[data-pick]'); if (first) first.click(); else posAddByCode(parseCode(v).code);
  };
  $('#sDisc').oninput = e => { state.discount = num(e.target.value); renderTotals(); };
  $('#clearCart').onclick = async () => { if (state.cart.length && await confirmDlg('تفريغ السلة؟', { ok: 'تفريغ', danger: true })) { state.cart = []; state.discount = 0; $('#sDisc').value = ''; renderCart(); } };
  $('#checkout').onclick = checkout;
  renderCart();
};
function renderTotals() {
  const sub = state.cart.reduce((a, b) => a + b.qty * b.price, 0), disc = Math.min(num(state.discount), sub);
  $('#sCount').textContent = fmtNum(state.cart.reduce((a, b) => a + b.qty, 0));
  $('#sSub').innerHTML = money(sub); $('#sTotal').innerHTML = money(sub - disc);
  updateCartCount();
}
function renderCart() {
  const box = $('#cartBox'); if (!box) return;
  if (!state.cart.length) box.innerHTML = emptyBox('shopping-cart', 'السلة فارغة', 'امسح باركود الدواء أو ابحث باسمه لإضافته');
  else box.innerHTML = state.cart.map((it, i) => {
    const d = Store.get('drugs', it.id), over = d && it.qty > num(d.qty);
    return `<div class="cart-item">
      <div><b>${esc(it.name)}</b><small>${money(it.price)} للوحدة ${over ? `<span class="badge b-warn">المتاح ${fmtNum(d.qty)} فقط</span>` : ''}</small></div>
      <div class="stepper"><button data-q="${i}" data-d="1">${ic('plus')}</button><input data-qi="${i}" type="number" min="1" inputmode="numeric" value="${it.qty}"><button data-q="${i}" data-d="-1">${ic('minus')}</button></div>
      <div class="line-total">${money(it.qty * it.price)}</div>
      <button class="icon-btn sm danger" data-rm="${i}">${ic('x')}</button></div>`;
  }).join('');
  $$('[data-q]', box).forEach(b => b.onclick = () => { const it = state.cart[b.dataset.q]; it.qty = Math.max(1, it.qty + +b.dataset.d); renderCart(); });
  $$('[data-qi]', box).forEach(b => b.onchange = () => { state.cart[b.dataset.qi].qty = Math.max(1, Math.round(num(b.value))); renderCart(); });
  $$('[data-rm]', box).forEach(b => b.onclick = () => { state.cart.splice(+b.dataset.rm, 1); renderCart(); });
  renderTotals(); icons();
}
async function checkout() {
  if (!state.cart.length) return toast('السلة فارغة', 'warn');
  const over = state.cart.filter(it => { const d = Store.get('drugs', it.id); return !d || it.qty > num(d.qty); });
  if (over.length && !await confirmDlg(`الكمية المطلوبة أكبر من المخزون في: <b>${over.map(x => esc(x.name)).join('، ')}</b>.<br>متابعة البيع على أي حال؟`, { ok: 'متابعة', danger: true })) return;
  const sub = state.cart.reduce((a, b) => a + b.qty * b.price, 0), disc = Math.min(num(state.discount), sub);
  const no = Store.all('sales').reduce((m, x) => Math.max(m, num(x.no)), 0) + 1;
  const sale = {
    id: uid(), no, at: Date.now(), date: localDate(), items: clone(state.cart), subtotal: sub, discount: disc, total: sub - disc,
    customer: $('#sCust').value.trim(), by: state.user.username, byName: state.user.name,
  };
  try {
    await Store.put('sales', sale);
    const upd = sale.items.map(it => { const d = Store.get('drugs', it.id); if (!d) return null; d.qty = num(d.qty) - it.qty; d.updatedAt = Date.now(); return d; }).filter(Boolean);
    await Store.putMany('drugs', upd);
  } catch (e) { return toast('تعذر حفظ الفاتورة: ' + e.message, 'err'); }
  state.cart = []; state.discount = 0;
  renderPage();
  toast(`تم البيع — فاتورة #${no} بقيمة ${fmtNum(sale.total)}`);
  if (await confirmDlg(`تم حفظ الفاتورة رقم <b>#${no}</b> بإجمالي <b>${money(sale.total)}</b>.<br>هل تريد طباعة الإيصال؟`, { ok: 'طباعة', title: 'تمت عملية البيع' })) printReceipt(sale);
}
function printReceipt(sale) {
  const s = S();
  $('#print-area').innerHTML = `<div class="receipt">
    <h2>${esc(s.pharmacyName)}</h2><div class="c">${esc(s.address || '')}${s.phone ? ' — ' + esc(s.phone) : ''}</div>
    <div class="c">فاتورة رقم #${esc(sale.no)} — ${fmtDT(sale.at)}</div>${sale.customer ? `<div class="c">العميل: ${esc(sale.customer)}</div>` : ''}
    <table><thead><tr><th>الصنف</th><th>كمية</th><th>سعر</th><th>إجمالي</th></tr></thead><tbody>
    ${sale.items.map(i => `<tr><td>${esc(i.name)}</td><td>${i.qty}</td><td>${fmtNum(i.price)}</td><td>${fmtNum(i.qty * i.price)}</td></tr>`).join('')}</tbody></table>
    ${sale.discount ? `<div>الخصم: ${fmtNum(sale.discount)}</div>` : ''}
    <div class="tot">الإجمالي: ${money(sale.total)}</div>
    <div class="c" style="margin-top:8px">البائع: ${esc(sale.byName || sale.by)} — شفاكم الله</div></div>`;
  setTimeout(() => window.print(), 100);
}

/* ---------- المبيعات ---------- */
PAGES.sales = () => {
  const F = state.salesFilter;
  const users = Store.all('users');
  view(`
    <div class="card toolbar">
      <select id="sp"><option value="today">اليوم</option><option value="7">آخر 7 أيام</option><option value="30">آخر 30 يوم</option><option value="all">كل الفترات</option></select>
      <select id="su"><option value="">كل المستخدمين</option>${users.map(u => `<option value="${esc(u.username)}">${esc(u.name)}</option>`).join('')}</select>
      <span style="flex:1"></span>
      <button class="btn btn-soft" id="expSales">${ic('download')}<span class="btn-label">تصدير</span></button>
    </div>
    <div id="salesBody"></div>`);
  $('#sp').value = F.period; $('#su').value = F.user;
  $('#sp').onchange = e => { F.period = e.target.value; renderSales(); };
  $('#su').onchange = e => { F.user = e.target.value; renderSales(); };
  $('#expSales').onclick = () => {
    const list = filteredSales();
    download(`مبيعات-${localDate()}.csv`, toCSV([['رقم الفاتورة', 'التاريخ', 'البائع', 'العميل', 'الأصناف', 'الخصم', 'الإجمالي'],
    ...list.map(x => [x.no, fmtDT(x.at), x.byName || x.by, x.customer || '', x.items.map(i => `${i.name} ×${i.qty}`).join(' | '), x.discount || 0, x.total])]));
  };
  renderSales();
};
function filteredSales() {
  const F = state.salesFilter; let list = Store.all('sales');
  if (F.period === 'today') list = list.filter(x => x.date === localDate());
  else if (F.period !== 'all') { const from = localDate(new Date(Date.now() - (+F.period - 1) * 864e5)); list = list.filter(x => x.date >= from); }
  if (F.user) list = list.filter(x => x.by === F.user);
  return list.sort((a, b) => b.at - a.at);
}
function renderSales() {
  const list = filteredSales();
  const total = list.reduce((a, b) => a + num(b.total), 0), pieces = list.reduce((a, b) => a + b.items.reduce((x, y) => x + y.qty, 0), 0);
  const top = {}; list.forEach(s => s.items.forEach(i => { top[i.id] = top[i.id] || { name: i.name, qty: 0, sum: 0 }; top[i.id].qty += i.qty; top[i.id].sum += i.qty * i.price; }));
  const topList = Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 6);
  $('#salesBody').innerHTML = `
    <div class="stats">
      <div class="stat c-green"><div class="stat-ic">${ic('wallet')}</div><div><b>${money(total)}</b><small>إجمالي المبيعات</small></div></div>
      <div class="stat c-teal"><div class="stat-ic">${ic('receipt')}</div><div><b>${fmtNum(list.length)}</b><small>عدد الفواتير</small></div></div>
      <div class="stat c-sky"><div class="stat-ic">${ic('boxes')}</div><div><b>${fmtNum(pieces)}</b><small>قطع مباعة</small></div></div>
      <div class="stat c-violet"><div class="stat-ic">${ic('trending-up')}</div><div><b>${money(list.length ? total / list.length : 0)}</b><small>متوسط الفاتورة</small></div></div>
    </div>
    <div class="grid-2">
      <div class="card"><div class="card-head"><h3>${ic('receipt')} الفواتير</h3></div>
        ${list.length ? `<div class="list">${list.slice(0, 200).map(x => `<div class="list-item" data-sale="${esc(x.id)}"><div class="li-ic">${ic('receipt')}</div><div class="li-main"><b>#${esc(x.no)} — ${x.items.length} صنف${x.customer ? ' • ' + esc(x.customer) : ''}</b><small>${fmtDT(x.at)} • ${esc(x.byName || x.by)}</small></div><b style="color:var(--pd)">${money(x.total)}</b></div>`).join('')}</div>`
      : emptyBox('receipt', 'لا توجد فواتير في هذه الفترة')}
      </div>
      <div class="card"><div class="card-head"><h3>${ic('trending-up')} الأكثر مبيعاً</h3></div>
        ${topList.length ? `<div class="list">${topList.map((t, i) => `<div class="list-item"><div class="li-ic"><b>${i + 1}</b></div><div class="li-main"><b>${esc(t.name)}</b><small>${fmtNum(t.qty)} قطعة</small></div><b>${money(t.sum)}</b></div>`).join('')}</div>`
      : emptyBox('trending-up', 'لا توجد بيانات')}
      </div>
    </div>`;
  $$('[data-sale]').forEach(b => b.onclick = () => openSale(b.dataset.sale));
  icons();
}
function openSale(id) {
  const x = Store.get('sales', id); if (!x) return;
  const w = openModal({
    title: `فاتورة #${x.no}`, icon: 'receipt',
    body: `<p class="count-note">${fmtDT(x.at)} • البائع: ${esc(x.byName || x.by)}${x.customer ? ' • العميل: ' + esc(x.customer) : ''}</p>
      <div class="table-wrap" style="margin-top:10px"><table class="rtable"><thead><tr><th>الصنف</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead><tbody>
      ${x.items.map(i => `<tr><td class="name-cell"><b>${esc(i.name)}</b></td><td data-label="الكمية">${i.qty}</td><td data-label="السعر">${money(i.price)}</td><td data-label="الإجمالي">${money(i.qty * i.price)}</td></tr>`).join('')}</tbody></table></div>
      ${x.discount ? `<div class="sum-row"><span>الخصم</span><b>${money(x.discount)}</b></div>` : ''}
      <div class="sum-row total"><span>الإجمالي</span><b>${money(x.total)}</b></div>`,
    footer: `<button class="btn btn-primary" id="prt">${ic('printer')} طباعة</button>${isAdmin() ? `<button class="btn btn-danger" id="delSale">${ic('trash-2')} إلغاء الفاتورة</button>` : ''}<button class="btn btn-ghost" data-close>إغلاق</button>`,
  });
  $('#prt', w).onclick = () => printReceipt(x);
  const ds = $('#delSale', w);
  if (ds) ds.onclick = async () => {
    if (!await confirmDlg('سيتم إلغاء الفاتورة وإرجاع الكميات إلى المخزون.', { ok: 'إلغاء الفاتورة', danger: true })) return;
    const upd = x.items.map(i => { const d = Store.get('drugs', i.id); if (!d) return null; d.qty = num(d.qty) + i.qty; return d; }).filter(Boolean);
    await Store.putMany('drugs', upd); await Store.del('sales', x.id);
    closeAllModals(); toast('تم إلغاء الفاتورة وإرجاع الكميات'); renderPage();
  };
}

/* ---------- المستخدمون ---------- */
PAGES.users = () => {
  const list = Store.all('users').sort((a, b) => (a.role > b.role ? 1 : -1));
  view(`<div class="card">
    <div class="card-head"><h3>${ic('users')} حسابات النظام</h3><button class="btn btn-primary" id="addUser">${ic('user-plus')} مستخدم جديد</button></div>
    <div class="table-wrap"><table class="rtable"><thead><tr><th>الاسم</th><th>اسم الدخول</th><th>الصلاحية</th><th>الحالة</th><th></th></tr></thead><tbody>
    ${list.map(u => `<tr><td class="name-cell"><b>${esc(u.name)}</b></td><td data-label="اسم الدخول"><span class="barcode-txt">${esc(u.username)}</span></td>
      <td data-label="الصلاحية"><span class="badge ${u.role === 'admin' ? 'b-info' : 'b-teal'}">${ic(u.role === 'admin' ? 'shield-check' : 'stethoscope')}${ROLE_LABEL[u.role]}</span></td>
      <td data-label="الحالة"><span class="badge ${u.active ? 'b-ok' : 'b-muted'}">${u.active ? 'نشط' : 'موقوف'}</span></td>
      <td class="actions"><button class="icon-btn sm" data-edit-user="${esc(u.id)}" title="تعديل">${ic('pencil')}</button>
      ${u.id !== state.user.id ? `<button class="icon-btn sm danger" data-del-user="${esc(u.id)}" title="حذف">${ic('trash-2')}</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="help" style="margin-top:12px">${ic('info', 'ic-sm')} المواطن لا يحتاج حساباً — يدخل مباشرة من زر "مواطن" في شاشة الدخول (يمكن إيقافه من الإعدادات).</p></div>`);
  $('#addUser').onclick = () => userForm();
  $$('[data-edit-user]').forEach(b => b.onclick = () => userForm(b.dataset.editUser));
  $$('[data-del-user]').forEach(b => b.onclick = async () => {
    const u = Store.get('users', b.dataset.delUser);
    if (u.role === 'admin' && Store.all('users').filter(x => x.role === 'admin' && x.active).length <= 1) return toast('لا يمكن حذف آخر مسئول', 'err');
    if (await confirmDlg(`حذف المستخدم <b>${esc(u.name)}</b>؟`, { ok: 'حذف', danger: true })) { await Store.del('users', u.id); toast('تم الحذف'); renderPage(); }
  });
};
function userForm(id) {
  const u = id ? Store.get('users', id) : null;
  const w = openModal({
    title: u ? 'تعديل مستخدم' : 'مستخدم جديد', icon: 'user-plus',
    body: `<form id="uf" class="form-grid">
      <div class="fld"><label>الاسم الكامل <b class="req">*</b></label><input name="name" value="${esc(u?.name || '')}" required></div>
      <div class="fld"><label>اسم الدخول <b class="req">*</b></label><input name="username" class="barcode-txt" value="${esc(u?.username || '')}" ${u ? 'readonly' : ''} required autocapitalize="none" pattern="[A-Za-z0-9_.\\-]+" title="حروف إنجليزية وأرقام فقط"></div>
      <div class="fld"><label>الصلاحية</label><select name="role"><option value="pharmacist">صيدلي</option><option value="admin">مسئول</option></select></div>
      <div class="fld"><label>كلمة المرور ${u ? '<small class="count-note">(اتركها فارغة لعدم التغيير)</small>' : '<b class="req">*</b>'}</label><input name="pass" type="password" ${u ? '' : 'required'} minlength="4" autocomplete="new-password"></div>
      <label class="chk full"><input type="checkbox" name="active" ${!u || u.active ? 'checked' : ''}> الحساب نشط</label>
    </form>`,
    footer: `<button class="btn btn-primary" form="uf">${ic('check')} حفظ</button><button class="btn btn-ghost" data-close>إلغاء</button>`,
  });
  $('[name=role]', w).value = u?.role || 'pharmacist';
  $('#uf', w).onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const username = f.username.value.trim().toLowerCase();
    if (!u && Store.get('users', username)) return toast('اسم الدخول مستخدم بالفعل', 'err');
    const obj = { ...(u || { createdAt: Date.now() }), id: username, username, name: f.name.value.trim(), role: f.role.value, active: f.active.checked };
    if (u && u.role === 'admin' && (obj.role !== 'admin' || !obj.active) && Store.all('users').filter(x => x.role === 'admin' && x.active).length <= 1) return toast('يجب أن يبقى مسئول نشط واحد على الأقل', 'err');
    if (f.pass.value) { obj.pass = await passHash(username, f.pass.value); obj.mustChange = false; }
    await Store.put('users', obj);
    if (u && u.id === state.user.id) { state.user = obj; }
    closeModal(w); toast('تم حفظ المستخدم'); renderPage();
  };
}
function changePassword(forced) {
  const w = openModal({
    title: forced ? 'غيّر كلمة المرور الافتراضية' : 'تغيير كلمة المرور', icon: 'key-round', size: 'sm',
    body: `<form id="cpf" class="login-form">${forced ? '<p class="help">لحماية الصيدلية، اختر كلمة مرور جديدة بدلاً من الافتراضية.</p>' : `<input name="old" type="password" placeholder="كلمة المرور الحالية" required>`}
      <input name="p1" type="password" placeholder="كلمة المرور الجديدة" minlength="4" required autocomplete="new-password">
      <input name="p2" type="password" placeholder="تأكيد كلمة المرور" minlength="4" required autocomplete="new-password"></form>`,
    footer: `<button class="btn btn-primary" form="cpf">${ic('check')} حفظ</button>${forced ? '' : '<button class="btn btn-ghost" data-close>إلغاء</button>'}`,
  });
  $('#cpf', w).onsubmit = async e => {
    e.preventDefault(); const f = e.target, u = Store.get('users', state.user.id);
    if (!forced && u.pass !== await passHash(u.username, f.old.value)) return toast('كلمة المرور الحالية غير صحيحة', 'err');
    if (f.p1.value !== f.p2.value) return toast('كلمتا المرور غير متطابقتين', 'err');
    u.pass = await passHash(u.username, f.p1.value); u.mustChange = false;
    await Store.put('users', u); state.user = u; closeModal(w); toast('تم تغيير كلمة المرور');
  };
}

/* ---------- الإعدادات ---------- */
PAGES.settings = () => {
  const tabs = [['general', 'store', 'بيانات الصيدلية'], ['fields', 'list-plus', 'حقول الدواء'], ['cloud', 'cloud', 'قاعدة البيانات'], ['backup', 'database', 'النسخ الاحتياطي']];
  view(`<div class="tabs">${tabs.map(([k, i, l]) => `<button class="tab ${state.settingsTab === k ? 'active' : ''}" data-tab="${k}">${ic(i)}${l}</button>`).join('')}</div><div id="setBody"></div>`);
  $$('[data-tab]').forEach(b => b.onclick = () => { state.settingsTab = b.dataset.tab; state.fieldsDraft = null; renderPage(); });
  ({ general: setGeneral, fields: setFields, cloud: setCloud, backup: setBackup })[state.settingsTab]();
};
function setGeneral() {
  const s = S();
  $('#setBody').innerHTML = `<div class="card"><form id="gf" class="form-grid">
    <div class="fld"><label>اسم الصيدلية</label><input name="pharmacyName" value="${esc(s.pharmacyName)}" required></div>
    <div class="fld"><label>رقم الهاتف</label><input name="phone" value="${esc(s.phone)}" inputmode="tel"></div>
    <div class="fld full"><label>العنوان</label><input name="address" value="${esc(s.address)}"></div>
    <div class="fld full"><label>مواعيد العمل</label><input name="hours" value="${esc(s.hours || '')}"></div>
    <div class="fld"><label>العملة</label><input name="currency" value="${esc(s.currency)}"></div>
    <div class="fld"><label>حد التنبيه لنفاد الكمية</label><input name="lowStock" type="number" min="0" value="${s.lowStock}"></div>
    <div class="fld"><label>التنبيه قبل انتهاء الصلاحية بـ (يوم)</label><input name="expiryDays" type="number" min="0" value="${s.expiryDays}"></div>
    <div class="fld" style="justify-content:flex-end;gap:10px">
      <label class="chk"><input type="checkbox" name="citizenEnabled" ${s.citizenEnabled ? 'checked' : ''}> السماح بدخول المواطنين</label>
      <label class="chk"><input type="checkbox" name="citizenSeesQty" ${s.citizenSeesQty ? 'checked' : ''}> إظهار الكمية للمواطن</label>
    </div>
    <div class="full"><button class="btn btn-primary">${ic('check')} حفظ الإعدادات</button></div>
  </form></div>`;
  $('#gf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    const n = { ...S(), pharmacyName: f.pharmacyName.value.trim(), phone: f.phone.value.trim(), address: f.address.value.trim(), hours: f.hours.value.trim(), currency: f.currency.value.trim(), lowStock: num(f.lowStock.value), expiryDays: num(f.expiryDays.value), citizenEnabled: f.citizenEnabled.checked, citizenSeesQty: f.citizenSeesQty.checked };
    await Store.put('settings', n); toast('تم حفظ الإعدادات'); renderApp();
  };
}
function setFields() {
  if (!state.fieldsDraft) state.fieldsDraft = clone(fields());
  const D = state.fieldsDraft;
  $('#setBody').innerHTML = `<div class="card">
    <div class="card-head"><h3>${ic('list-plus')} الحقول المطلوبة عند إضافة دواء جديد</h3>
      <div class="quick"><button class="btn btn-soft" id="addField">${ic('plus')} حقل جديد</button><button class="btn btn-soft" id="prevForm">${ic('eye')} معاينة النموذج</button><button class="btn btn-primary" id="saveFields">${ic('check')} حفظ الحقول</button></div></div>
    <p class="help" style="margin-bottom:14px">رتّب الحقول، غيّر أسماءها وأنواعها، وحدد ما هو إلزامي وما يظهر للمواطن وفي جدول الأدوية. حقل <b>الباركود</b> ثابت دائماً، والحقول المعلَّمة "أساسي" يعتمد عليها البيع والتنبيهات فلا يمكن حذفها.</p>
    <div id="frList">${D.map((f, i) => `<div class="field-row ${f.system ? 'sys' : ''}" data-i="${i}">
      <div class="fr-order"><button data-mv="-1" title="لأعلى">${ic('chevron-up')}</button><button data-mv="1" title="لأسفل">${ic('chevron-down')}</button></div>
      <div><input class="fr-label" value="${esc(f.label)}" placeholder="اسم الحقل">${f.system ? '<span class="sys-tag">أساسي</span>' : ''}</div>
      <select class="fr-type" ${f.system ? 'disabled' : ''}>${Object.entries(TYPE_LABEL).map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input class="fr-opts" value="${esc((f.options || []).join('، '))}" placeholder="الخيارات مفصولة بفاصلة" ${f.type === 'select' ? '' : 'hidden'}>
      <label class="chk"><input type="checkbox" class="fr-req" ${f.required ? 'checked' : ''} ${f.key === 'name' ? 'disabled' : ''}>إلزامي</label>
      <label class="chk"><input type="checkbox" class="fr-pub" ${f.public ? 'checked' : ''}>للمواطن</label>
      <label class="chk"><input type="checkbox" class="fr-list" ${f.inList ? 'checked' : ''} ${f.key === 'name' ? 'disabled' : ''}>بالجدول</label>
      <button class="icon-btn sm danger" data-rmf ${f.system ? 'disabled style="opacity:.25"' : ''} title="حذف">${ic('trash-2')}</button>
    </div>`).join('')}</div></div>`;
  const list = $('#frList');
  list.oninput = list.onchange = e => {
    const row = e.target.closest('.field-row'); if (!row) return; const f = D[+row.dataset.i];
    f.label = $('.fr-label', row).value; f.type = $('.fr-type', row).value;
    f.options = $('.fr-opts', row).value.split(/[,،]/).map(x => x.trim()).filter(Boolean);
    f.required = $('.fr-req', row).checked; f.public = $('.fr-pub', row).checked; f.inList = $('.fr-list', row).checked;
    $('.fr-opts', row).hidden = f.type !== 'select';
  };
  list.onclick = async e => {
    const row = e.target.closest('.field-row'); if (!row) return; const i = +row.dataset.i;
    const mv = e.target.closest('[data-mv]');
    if (mv) { const j = i + +mv.dataset.mv; if (j < 0 || j >= D.length) return; [D[i], D[j]] = [D[j], D[i]]; setFields(); icons(); }
    if (e.target.closest('[data-rmf]') && !D[i].system && await confirmDlg(`حذف الحقل "${esc(D[i].label)}"؟ (القيم المسجلة سابقاً لن تُحذف من الأدوية)`, { ok: 'حذف', danger: true })) { D.splice(i, 1); setFields(); icons(); }
  };
  $('#addField').onclick = () => { D.push({ key: 'f_' + uid(), label: 'حقل جديد', type: 'text', required: false, public: false, inList: false }); setFields(); icons(); const ls = $$('.fr-label'); ls[ls.length - 1].select(); };
  $('#prevForm').onclick = () => openModal({ title: 'معاينة نموذج إضافة دواء', size: 'lg', icon: 'eye', body: `<div class="form-grid"><div class="fld full"><label>الباركود *</label><input disabled></div>${D.map(f => fieldInput(f, '')).join('')}</div>` });
  $('#saveFields').onclick = async () => {
    if (D.some(f => !f.label.trim())) return toast('يوجد حقل بدون اسم', 'err');
    if (D.some(f => f.type === 'select' && !(f.options || []).length)) return toast('حقل من نوع "قائمة اختيار" يحتاج خيارات', 'err');
    await Store.put('settings', { ...S(), fields: clone(D) }); state.fieldsDraft = null; toast('تم حفظ حقول الدواء'); setFields(); icons();
  };
}
function setCloud() {
  const cc = Store.cloudConfig();
  $('#setBody').innerHTML = `<div class="grid-2">
    <div class="card setting-section">
      <div class="card-head"><h3>${ic(Store.mode === 'cloud' ? 'cloud' : 'hard-drive')} الوضع الحالي</h3></div>
      ${Store.mode === 'cloud'
      ? `<span class="badge b-info" style="align-self:flex-start">${ic('cloud')} متصل بـ Firebase — مشروع ${esc(cc.cfg.projectId)}</span><p>كل الأجهزة التي تفتح التطبيق تشارك نفس قاعدة البيانات وتتحدث لحظياً.</p>`
      : `<span class="badge b-teal" style="align-self:flex-start">${ic('hard-drive')} قاعدة بيانات محلية (IndexedDB)</span><p>البيانات محفوظة داخل متصفح هذا الجهاز فقط. مناسب لجهاز واحد في الصيدلية. لتشارك عدة أجهزة نفس البيانات فعّل الوضع السحابي.</p>`}
      ${Store.cloudError ? `<div class="login-hint">${ic('triangle-alert')}<span>فشل الاتصال بالسحابة: ${esc(Store.cloudError)}</span></div>` : ''}
      <p class="help">الطريقة الأفضل: ضع إعدادات Firebase في ملف <b>js/config.js</b> على GitHub فتتصل كل الأجهزة تلقائياً. أو الصقها هنا لتفعيلها على هذا الجهاز فقط.</p>
      <ol class="steps"><li>ادخل console.firebase.google.com وأنشئ مشروعاً مجانياً</li><li>أضف تطبيق Web وانسخ firebaseConfig</li><li>فعّل Firestore Database</li><li>الصق الإعدادات هنا أو في config.js</li></ol>
    </div>
    <div class="card setting-section">
      <div class="card-head"><h3>${ic('cloud')} إعدادات Firebase لهذا الجهاز</h3></div>
      ${cc && cc.src === 'file' ? `<p class="help">الإعدادات محمّلة من ملف config.js — عدّلها من هناك.</p>` : `
      <textarea id="fbCfg" class="code-box" placeholder='{ "apiKey": "...", "authDomain": "...", "projectId": "...", "appId": "..." }'>${cc ? esc(JSON.stringify(cc.cfg, null, 2)) : ''}</textarea>
      <div class="quick"><button class="btn btn-primary" id="fbSave">${ic('cloud')} حفظ والاتصال</button>${cc ? `<button class="btn btn-danger" id="fbOff">${ic('hard-drive')} العودة للوضع المحلي</button>` : ''}</div>`}
      <p class="help">${ic('info', 'ic-sm')} لنقل بياناتك الحالية: صدّر نسخة احتياطية من تبويب "النسخ الاحتياطي" قبل التبديل، ثم استوردها بعد الاتصال.</p>
    </div></div>`;
  const sv = $('#fbSave');
  if (sv) sv.onclick = () => {
    let t = $('#fbCfg').value.trim(), cfg;
    const m = t.match(/\{[\s\S]*\}/); if (!m) return toast('الصق كائن الإعدادات {...}', 'err');
    try { cfg = JSON.parse(m[0]); } catch (e) { try { cfg = Function('"use strict";return (' + m[0] + ')')(); } catch (e2) { return toast('صيغة الإعدادات غير صحيحة', 'err'); } }
    if (!cfg || !cfg.projectId || !cfg.apiKey) return toast('الإعدادات ناقصة (apiKey / projectId)', 'err');
    localStorage.setItem('pharma_cloud', JSON.stringify(cfg)); toast('جارِ الاتصال…'); setTimeout(() => location.reload(), 600);
  };
  const off = $('#fbOff');
  if (off) off.onclick = async () => { if (await confirmDlg('العودة لقاعدة البيانات المحلية على هذا الجهاز؟')) { localStorage.removeItem('pharma_cloud'); location.reload(); } };
}
function setBackup() {
  $('#setBody').innerHTML = `<div class="grid-2">
    <div class="card setting-section"><div class="card-head"><h3>${ic('download')} تصدير</h3></div>
      <p>نسخة كاملة (الأدوية، المستخدمين، المبيعات، الإعدادات) في ملف واحد يمكنك استرجاعه لاحقاً أو نقله لجهاز آخر.</p>
      <div class="quick"><button class="btn btn-primary" id="bkExp">${ic('download')} نسخة احتياطية كاملة</button><button class="btn btn-soft" id="csvExp">${ic('sheet')} الأدوية Excel (CSV)</button></div>
    </div>
    <div class="card setting-section"><div class="card-head"><h3>${ic('upload')} استيراد</h3></div>
      <p>استرجاع نسخة احتياطية (JSON) أو استيراد قائمة أدوية من Excel محفوظ بصيغة CSV — الصف الأول أسماء الأعمدة مطابقة لأسماء الحقول، ويجب وجود عمود "الباركود".</p>
      <div class="quick"><label class="btn btn-primary">${ic('upload')} استرجاع نسخة<input type="file" id="bkImp" accept=".json,application/json" hidden></label>
      <label class="btn btn-soft">${ic('sheet')} استيراد أدوية CSV<input type="file" id="csvImp" accept=".csv,text/csv" hidden></label></div>
    </div>
    <div class="card setting-section danger-zone" style="grid-column:1/-1"><div class="card-head"><h3 style="color:var(--danger)">${ic('triangle-alert')} منطقة الخطر</h3></div>
      <div class="quick"><button class="btn btn-danger" id="clrSales">${ic('trash-2')} حذف كل المبيعات</button><button class="btn btn-danger" id="clrDrugs">${ic('trash-2')} حذف كل الأدوية</button><button class="btn btn-danger" id="factory">${ic('rotate-ccw')} إعادة ضبط المصنع</button></div>
    </div></div>`;
  $('#bkExp').onclick = () => {
    const data = { app: 'pharma', version: 1, exportedAt: new Date().toISOString() };
    COLS.forEach(c => data[c] = Store.all(c));
    download(`نسخة-صيدلية-${localDate()}.json`, JSON.stringify(data, null, 1), 'application/json');
    toast('تم تصدير النسخة الاحتياطية');
  };
  $('#csvExp').onclick = () => { state.drugsFilter = { q: '', f: 'all', limit: 60 }; exportDrugsCSV(); };
  $('#bkImp').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    let data; try { data = JSON.parse(await file.text()); } catch (err) { return toast('ملف غير صالح', 'err'); }
    if (data.app !== 'pharma') return toast('هذا الملف ليس نسخة من هذا التطبيق', 'err');
    const replace = await confirmDlg(`الملف يحتوي على ${(data.drugs || []).length} دواء و ${(data.sales || []).length} فاتورة.<br><b>تأكيد</b> = استبدال كل البيانات الحالية بها.<br><b>إلغاء</b> = لا شيء.`, { ok: 'استبدال البيانات', danger: true, title: 'استرجاع نسخة' });
    if (!replace) return;
    toast('جارِ الاسترجاع…');
    for (const c of COLS) { if (Array.isArray(data[c])) { await Store.clear(c); await Store.putMany(c, data[c]); } }
    await seed(); toast('تم استرجاع النسخة بنجاح'); state.user = Store.get('users', state.user.id) || state.user; renderApp();
  };
  $('#csvImp').onchange = async e => {
    const file = e.target.files[0]; if (!file) return;
    const rows = parseCSV(await file.text()); if (rows.length < 2) return toast('الملف فارغ', 'err');
    const head = rows[0].map(h => h.trim()), fl = fields();
    const bi = head.findIndex(h => ['الباركود', 'باركود', 'barcode', 'Barcode', 'BARCODE'].includes(h));
    if (bi < 0) return toast('لا يوجد عمود "الباركود" في الملف', 'err');
    const map = head.map(h => fl.find(f => f.label === h || f.key === h));
    const list = [];
    rows.slice(1).forEach(r => {
      const bc = String(r[bi] || '').trim(); if (!bc) return;
      const old = Store.get('drugs', bc) || { createdAt: Date.now(), createdBy: state.user.username };
      const o = { ...old, id: bc, barcode: bc, updatedAt: Date.now(), updatedBy: state.user.username };
      map.forEach((f, i) => { if (f && r[i] !== undefined && r[i] !== '') o[f.key] = f.type === 'number' ? num(r[i]) : r[i].trim(); });
      list.push(o);
    });
    await Store.putMany('drugs', list); toast(`تم استيراد/تحديث ${list.length} دواء`);
  };
  $('#clrSales').onclick = async () => { if (await confirmDlg('حذف كل سجل المبيعات نهائياً؟', { ok: 'حذف', danger: true })) { await Store.clear('sales'); toast('تم حذف المبيعات'); } };
  $('#clrDrugs').onclick = async () => { if (await confirmDlg('حذف كل الأدوية من قاعدة البيانات نهائياً؟', { ok: 'حذف', danger: true })) { await Store.clear('drugs'); toast('تم حذف الأدوية'); } };
  $('#factory').onclick = async () => {
    if (!await confirmDlg('سيتم حذف <b>كل شيء</b> وإرجاع التطبيق لحالته الأولى (المسئول: admin / admin123).', { ok: 'إعادة الضبط', danger: true })) return;
    for (const c of COLS) await Store.clear(c);
    await seed(); state.user = null; saveSession(); renderLogin();
  };
}

/* ---------- صفحات المواطن ---------- */
PAGES.search = () => {
  const s = S();
  view(`<div class="card citizen-hero">
      <div class="scan-visual" style="width:130px;height:76px;padding:10px 14px"><div class="bars"></div><div class="laser"></div></div>
      <h2>ابحث عن دوائك في ${esc(s.pharmacyName)}</h2><p>اكتب اسم الدواء أو المادة الفعالة، أو امسح الباركود من على العلبة</p>
      <form id="cs" class="code-input">${ic('search')}<input id="cq" placeholder="مثال: بانادول، باراسيتامول…" value="${esc(state.citizenQ)}" enterkeyhint="search" autocomplete="off">
        <button type="button" class="btn btn-primary" data-act="scanTo" data-ctx="scan" title="مسح بالكاميرا">${ic('camera')}</button></form>
    </div><div id="cRes"></div>`);
  const run = () => {
    const q = state.citizenQ.trim(), box = $('#cRes');
    if (q.length < 2) { box.innerHTML = ''; return; }
    const k = norm(q), pub = fields().filter(f => f.public);
    const res = Store.all('drugs').filter(d => norm([d.barcode, d.name, d.scientific, ...pub.map(f => d[f.key])].join(' ')).includes(k))
      .sort((a, b) => (num(b.qty) > 0) - (num(a.qty) > 0) || String(a.name).localeCompare(String(b.name), 'ar')).slice(0, 60);
    box.innerHTML = res.length ? `<div class="results-grid">${res.map(d => `<div class="r-card" data-act="view" data-id="${esc(d.id)}">
        <div class="r-top"><div class="li-ic">${ic(formIcon(d))}</div><div><b>${esc(d.name)}</b><small>${esc(d.scientific || d.form || '')}</small></div></div>
        <div class="r-bottom">${num(d.qty) > 0 ? `<span class="badge b-ok">${ic('circle-check')}متوفر</span>` : `<span class="badge b-danger">${ic('circle-x')}غير متوفر</span>`}<span class="price">${money(d.price)}</span></div></div>`).join('')}</div>`
      : `<div class="card" style="margin-top:18px">${emptyBox('search-x', 'لم نجد نتائج', 'جرّب اسماً آخر أو تواصل مع الصيدلية')}</div>`;
    icons();
  };
  $('#cq').oninput = debounce(e => { state.citizenQ = e.target.value; run(); }, 200);
  $('#cs').onsubmit = e => { e.preventDefault(); run(); };
  run();
};
PAGES.about = () => {
  const s = S();
  view(`<div class="card citizen-hero">${LOGO.replace('class="logo"', 'style="width:90px;height:90px;margin-bottom:10px"')}<h2>${esc(s.pharmacyName)}</h2><p>نسعد بخدمتكم دائماً</p>
    <div class="info-list" style="max-width:520px;margin:0 auto;text-align:right">
      ${s.phone ? `<div>${ic('phone')}<a href="tel:${esc(s.phone)}" class="barcode-txt">${esc(s.phone)}</a></div>` : ''}
      ${s.address ? `<div>${ic('map-pin')}<span>${esc(s.address)}</span></div>` : ''}
      ${s.hours ? `<div>${ic('clock')}<span>${esc(s.hours)}</span></div>` : ''}
    </div></div>`);
};

/* =========================================================
   التحديث اللحظي (في الوضع السحابي) وبدء التشغيل
   ========================================================= */
const liveRefresh = debounce(c => {
  if (!state.user || modalStack.length) return;
  if (['pos', 'settings', 'users', 'scan'].includes(state.page)) return;
  if (c === 'settings') return renderApp();
  renderPage();
}, 400);
Store.on(liveRefresh);

(async function start() {
  try {
    await Store.init();
    await seed();
  } catch (e) {
    console.error(e);
    $('#splash .splash-text').textContent = 'تعذر فتح قاعدة البيانات: ' + e.message;
    return;
  }
  restoreSession();
  boot();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
