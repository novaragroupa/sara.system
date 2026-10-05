/* ============ حالة عامة ============ */
let CURRENT_USER = JSON.parse(sessionStorage.getItem('sara_user') || 'null');
let CURRENT_SECTION = 'dashboard';
let CACHE = {}; // كاش بسيط للبيانات المجلوبة من الشيت

const root = document.getElementById('root');

/* ============ اتصال بالـ API ============ */

async function api(action, payload) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
    throw new Error('لسه ما حطيتش رابط الـ Web app في ملف config.js');
  }
  const res = await fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(Object.assign({ action: action }, payload || {}))
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'حصل خطأ غير معروف');
  return data;
}

// نظام كاش بسيط: أول مرة بيجيب البيانات من الشيت، وبعد كده بيرجعها فورًا من الذاكرة
// من غير ما ينتظر السيرفر تاني، لحد ما البيانات تتغير فعليًا (عملية إضافة/بيع/تعديل)
// أو يعدي وقت الصلاحية (60 ثانية) كحماية إضافية لو حد تاني غيّر حاجة من مكان تاني.
const CACHE_TTL_MS = 60000;
// مؤشر "جاري تحديث البيانات..." تحت في الجنب: بيظهر لما نجيب بيانات من الشيت، وبيتحول لـ "تم تحديث البيانات" بعد ما تخلص
let ACTIVE_READS = 0, READ_FAILED = false, refreshToast = null, refreshTimer = null;
function readStarted() {
  ACTIVE_READS++;
  if (ACTIVE_READS === 1 && !refreshToast && !refreshTimer) {
    // تأخير بسيط عشان الطلبات السريعة جدًا متعملش وميض
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      refreshToast = toast('جاري تحديث البيانات...', 'loading', true);
    }, 250);
  }
}
function readFinished() {
  ACTIVE_READS = Math.max(0, ACTIVE_READS - 1);
  if (ACTIVE_READS > 0) return;
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; READ_FAILED = false; return; }
  if (refreshToast) {
    refreshToast.update(READ_FAILED ? 'تعذر تحديث البيانات' : 'تم تحديث البيانات', READ_FAILED ? 'error' : 'success');
    refreshToast = null;
  }
  READ_FAILED = false;
}
const INFLIGHT = {}; // طلبات شغالة دلوقتي، عشان نفس الطلب ميتبعتش مرتين للسيرفر
function cachedApi(action, payload, forceRefresh) {
  const key = action + ':' + JSON.stringify(payload || {});
  const now = Date.now();
  if (!forceRefresh && CACHE[key] && (now - CACHE[key].time) < CACHE_TTL_MS) {
    return Promise.resolve(CACHE[key].data);
  }
  if (!forceRefresh && INFLIGHT[key]) return INFLIGHT[key];
  readStarted();
  const p = api(action, payload).then(function (data) {
    // لو الكاش اتمسح/اتعدل وإحنا في الطريق، منخزنش نسخة قديمة
    if (INFLIGHT[key] === p) CACHE[key] = { data: data, time: Date.now() };
    return data;
  }, function (err) {
    READ_FAILED = true;
    throw err;
  }).finally(function () {
    if (INFLIGHT[key] === p) delete INFLIGHT[key];
    readFinished();
  });
  INFLIGHT[key] = p;
  return p;
}

// تحميل مسبق لأهم القوائم بعد الدخول، عشان التنقل بين الصفحات يبقى فوري
let PREFETCHED = false;
function prefetchAll() {
  if (PREFETCHED || !CURRENT_USER) return;
  PREFETCHED = true;
  ['listFashionSales', 'listFashionItems', 'listFashionCategories', 'listFactoryDocs'].forEach(function (a) {
    cachedApi(a).catch(function () {});
  });
}

// بعد أي عملية إضافة/بيع/تعديل بتغيّر البيانات، بنمسح الكاش الخاص بيها
// عشان أول قراءة بعدها تجيب النسخة المحدثة فعليًا من الشيت
function invalidateCache(actionPrefix) {
  Object.keys(CACHE).forEach(function (k) {
    if (k.indexOf(actionPrefix + ':') === 0) delete CACHE[k];
  });
  Object.keys(INFLIGHT).forEach(function (k) {
    if (k.indexOf(actionPrefix + ':') === 0) delete INFLIGHT[k];
  });
}

// بعد ما السيرفر يؤكد الإضافة، بنحط الصف الجديد في الكاش مباشرة بدل ما نعيد تحميل القائمة كلها
// (ده اللي بيخلي الجدول يتحدث فورًا). لو السيرفر مرجعش الصف، بنمسح الكاش ونرجع للطريقة العادية.
function patchCacheAdd(action, item) {
  const usable = item && typeof item === 'object' && (item.id !== undefined || item.date !== undefined);
  Object.keys(CACHE).forEach(function (k) {
    if (k.indexOf(action + ':') !== 0) return;
    const d = CACHE[k].data;
    if (usable && d && Array.isArray(d.items)) d.items.push(item);
    else delete CACHE[k];
  });
  Object.keys(INFLIGHT).forEach(function (k) {
    if (k.indexOf(action + ':') === 0) delete INFLIGHT[k];
  });
}

// إبطال شامل لكل الكاش المرتبط ببيع أو تعديل منتج ، يُستخدم بعد أي عملية بيع
function invalidateProductCaches() {
  invalidateCache('listFashionItems');
  invalidateCache('listFashionSales');
  invalidateCache('accountingSummary');
}
function invalidateFactoryCaches() {
  ['listFactoryDocs', 'listFactoryLines', 'listFactoryPayments', 'listFashionItems'].forEach(invalidateCache);
}

// تاريخ النهارده بتوقيت الجهاز (مش UTC) وحساب الأيام المتبقية لتاريخ معين
function localToday() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
}
function daysUntil(dateStr) {
  const s = String(dateStr || '').substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const p = s.split('-').map(Number), t = localToday().split('-').map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - Date.UTC(t[0], t[1] - 1, t[2])) / 86400000);
}
function money(n) { return Number(n || 0).toLocaleString(); }

// حماية: أي نص جاي من المستخدم بيتعرض جوه HTML لازم يعدي من هنا
function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function itemLabel(i) {
  return (i.name || i.itemName || '') + (i.color ? ' - ' + i.color : '') + (i.size ? ' - ' + i.size : '');
}

// إشعار في الجنب تحت. بيرجع كائن فيه update() عشان نغيّر الرسالة (من "جاري..." لـ "تم")
function toast(msg, type, sticky) {
  let box = document.getElementById('side-toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'side-toasts';
    document.body.appendChild(box);
  }
  const el = document.createElement('div');
  box.appendChild(el);
  let timer = null;
  function set(m, t, keep) {
    el.className = 'side-toast ' + (t || '');
    el.innerHTML = (t === 'loading' ? '<span class="spin"></span>' : '') + '<span></span>';
    el.lastChild.textContent = m;
    clearTimeout(timer);
    if (!keep) timer = setTimeout(function () { el.remove(); }, t === 'error' ? 5000 : 3000);
  }
  set(msg, type, sticky);
  return { update: set, close: function () { clearTimeout(timer); el.remove(); } };
}

// بيقفل شاشة الإضافة فورًا، بيكتب "يتم إضافة البيانات..." في الجنب، ويكمل الحفظ في الخلفية.
// لو الحفظ فشل بيرجّع الشاشة بنفس البيانات اللي اتكتبت عشان متضيعش.
async function saveInBackground(overlay, work, opts) {
  opts = opts || {};
  if (overlay._saving) return;
  overlay._saving = true;
  overlay.style.display = 'none';
  const t = toast(opts.loadingMsg || 'يتم إضافة البيانات...', 'loading', true);
  let result;
  try {
    result = await work();
  } catch (err) {
    overlay._saving = false;
    overlay.style.display = '';
    t.update(err.message, 'error');
    return;
  }
  overlay.remove();
  t.update(opts.successMsg || 'تمت إضافة البيانات بنجاح', 'success');
  if (opts.onDone) opts.onDone(result);
}

/* ============ تسجيل الدخول ============ */

function renderLogin(errorMsg) {
  root.innerHTML = `
    <div class="login-screen">
      <div class="login-card">
        <img src="logo.png" class="logo-mark" alt="${SHOP_NAME}" />
        <h1>${SHOP_NAME}</h1>
        <p class="subtitle">نظام إدارة المحل — سجّل دخولك للمتابعة</p>
        ${errorMsg ? `<div class="error-msg">${errorMsg}</div>` : ''}
        <form id="login-form">
          <div class="field">
            <label>اسم المستخدم</label>
            <input type="text" name="username" required autocomplete="username" />
          </div>
          <div class="field">
            <label>كلمة المرور</label>
            <input type="password" name="password" required autocomplete="current-password" />
          </div>
          <button class="btn btn-primary btn-block" type="submit">دخول</button>
        </form>
      </div>
    </div>
  `;
  document.getElementById('login-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'جاري الدخول...';
    try {
      const data = await api('login', { username: fd.get('username'), password: fd.get('password') });
      CURRENT_USER = data.user;
      sessionStorage.setItem('sara_user', JSON.stringify(CURRENT_USER));
      prefetchAll();
      renderApp();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

function logout() {
  sessionStorage.removeItem('sara_user');
  CURRENT_USER = null;
  PREFETCHED = false;
  CACHE = {};
  renderLogin();
}

/* ============ الهيكل الرئيسي ============ */

const NAV_ITEMS = [
  { id: 'dashboard', label: 'الرئيسية', icon: '🏠' },
  { id: 'scan', label: 'نقطة البيع', icon: '🛒' },
  { id: 'fashion', label: 'الأزياء', icon: '🧕' },
  { id: 'factoryIn', label: 'وارد مصنع', icon: '📥' },
  { id: 'factoryOut', label: 'صادر مصنع', icon: '📤' },
  { id: 'inventory', label: 'المخزون', icon: '📦' },
  { id: 'accounting', label: 'الحسابات', icon: '📊' },
  { id: 'users', label: 'الموظفين', icon: '👤', adminOnly: true }
];

function renderApp() {
  if (!CURRENT_USER) return renderLogin();

  const navHtml = NAV_ITEMS
    .filter(function (item) { return !item.adminOnly || CURRENT_USER.role === 'مدير النظام'; })
    .map(function (item) {
      return `<li><button class="nav-btn ${item.id === CURRENT_SECTION ? 'active' : ''}" data-nav="${item.id}">
        <span>${item.icon}</span><span class="label">${item.label}</span>
      </button></li>`;
    }).join('');

  root.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand">
          <img src="logo-icon.png" class="logo-mark" alt="${SHOP_NAME}" />
          <div><strong>${SHOP_NAME}</strong><span>أزياء المرأة المسلمة</span></div>
        </div>
        <ul class="nav-list">${navHtml}</ul>
        <div class="user-box">
          <div class="name">${CURRENT_USER.name}</div>
          <div class="role">${CURRENT_USER.role}</div>
          <button class="btn btn-outline btn-sm btn-block" id="logout-btn">تسجيل الخروج</button>
        </div>
      </aside>
      <div class="main-area">
        <div class="topbar">
          <div>
            <h2 id="page-title"></h2>
            <div class="breadcrumb" id="page-breadcrumb"></div>
          </div>
        </div>
        <div class="content" id="page-content"></div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-nav]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      CURRENT_SECTION = btn.getAttribute('data-nav');
      renderApp();
    });
  });
  document.getElementById('logout-btn').addEventListener('click', logout);

  const titleMap = {};
  NAV_ITEMS.forEach(function (i) { titleMap[i.id] = i.label; });
  document.getElementById('page-title').textContent = titleMap[CURRENT_SECTION] || '';

  const renderers = {
    dashboard: renderDashboard,
    scan: renderScan,
    fashion: renderFashion,
    factoryIn: renderFactoryIn,
    factoryOut: renderFactoryOut,
    inventory: renderInventory,
    accounting: renderAccounting,
    users: renderUsers
  };
  (renderers[CURRENT_SECTION] || renderDashboard)();
  refreshAlertsBadge();
}

function content() { return document.getElementById('page-content'); }

function setBreadcrumb(text) {
  document.getElementById('page-breadcrumb').textContent = text || '';
}

/* ============ مودال عام ============ */

function openModal(title, bodyHtml, onMount) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal"><h3>${title}</h3><div id="modal-body">${bodyHtml}</div></div>`;
  overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  if (onMount) onMount(overlay);
  return overlay;
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(function (m) { m.remove(); });
}

/* ============ الرئيسية (Dashboard) ============ */

async function renderDashboard() {
  setBreadcrumb('نظرة عامة سريعة');
  content().innerHTML = `<div class="empty-state">جاري تحميل البيانات...</div>`;
  try {
    const [sales, items, fdocs] = await Promise.all([
      cachedApi('listFashionSales'), cachedApi('listFashionItems'),
      cachedApi('listFactoryDocs').catch(function () { return { items: [] }; })
    ]);
    const today = localToday();
    const todaySales = sales.items.filter(function (r) { return String(r.date).substring(0, 10) === today; });
    const todayTotal = todaySales.reduce(function (s, r) { return s + Number(r.totalPrice || 0); }, 0);
    const todayProfit = todaySales.reduce(function (s, r) { return s + Number(r.profitPrice || 0); }, 0);
    const lowStock = items.items.filter(function (i) { return Number(i.quantity) <= 2; }).length;
    const alerts = dueAlerts(fdocs.items);
    const owed = factoryBalances(fdocs.items).net;

    content().innerHTML = `
      ${alerts.length ? `<div class="card alert-card">
        <h3 style="margin-top:0">⏰ فواتير مصانع محتاجة دفع (${alerts.length})</h3>
        ${alerts.map(function (a) {
          return `<div class="alert-row"><span><strong>${esc(a.doc.factoryName)}</strong> — فاتورة ${esc(a.doc.docNo)}</span>
            <span>المتبقي <strong>${money(a.doc.remaining)}</strong> ج.م</span>${dueBadge(a.days)}</div>`;
        }).join('')}
      </div>` : ''}
      <div class="grid grid-4" style="${alerts.length ? 'margin-top:16px' : ''}">
        <div class="card stat-card"><div class="stat-label">مبيعات اليوم</div><div class="stat-value brown">${money(todayTotal)} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">أرباح اليوم</div><div class="stat-value dark">${money(todayProfit)} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">عمليات اليوم</div><div class="stat-value dark">${todaySales.length}</div></div>
        <div class="card stat-card"><div class="stat-label">أصناف على وشك النفاذ</div><div class="stat-value brown">${lowStock}</div></div>
      </div>
      <div class="grid grid-4" style="margin-top:16px">
        <div class="card stat-card"><div class="stat-label">المستحق للمصانع</div><div class="stat-value brown">${money(owed)} ج.م</div></div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3 style="margin-top:0">آخر العمليات اليوم</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الوقت</th><th>النوع</th><th>الصنف</th><th>العميلة</th><th>الإجمالي</th><th>الموظف</th></tr></thead>
            <tbody>
              ${todaySales.slice(-10).reverse().map(function (r) {
                return `<tr><td>${esc(String(r.date).substring(11))}</td><td>${esc(r.categoryName)}</td><td>${esc(itemLabel(r))}${Number(r.quantity) > 1 ? ' × ' + esc(r.quantity) : ''}</td>
                <td>${esc(r.customerName) || '-'}</td><td>${money(r.totalPrice)} ج.م</td><td>${esc(r.employee) || '-'}</td></tr>`;
              }).join('') || `<tr><td colspan="6" class="empty-state">لا توجد عمليات اليوم بعد</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;
  } catch (err) {
    content().innerHTML = `<div class="empty-state">تعذر تحميل البيانات: ${esc(err.message)}</div>`;
  }
}

/* ============ نقطة البيع: بحث + باركود + أكتر من صنف ============ */

let scanCustomer = { name: '', phone: '', notes: '' };
let CART = []; // { id, label, price, qty, max }

function readPosCustomer() {
  const n = document.getElementById('pos-customer-name');
  if (!n) return;
  scanCustomer.name = n.value.trim();
  scanCustomer.phone = document.getElementById('pos-customer-phone').value.trim();
  scanCustomer.notes = document.getElementById('pos-notes').value;
}

function posMatches(items, q) {
  q = String(q || '').toLowerCase().trim();
  if (!q) return [];
  return items.filter(function (i) {
    return [i.name, i.color, i.code, i.categoryName, i.size].some(function (x) { return String(x || '').toLowerCase().includes(q); });
  }).slice(0, 8);
}

function renderScan() {
  setBreadcrumb('ابحثي بالاسم أو امسحي الباركود، وضيفي أكتر من منتج في نفس البيعة');
  content().innerHTML = `
    <div class="grid grid-2 pos-grid">
      <div class="card">
        <h3 style="margin-top:0">المنتجات</h3>
        <div class="field"><input type="text" id="pos-search" placeholder="🔍 ابحثي بالاسم أو اللون، أو امسحي الباركود واضغطي Enter" autocomplete="off" /></div>
        <div id="pos-results"></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">السلة</h3>
        <div id="pos-cart"></div>
        <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
        <div class="grid grid-2">
          <div class="field"><label>اسم العميلة</label><input type="text" id="pos-customer-name" value="${esc(scanCustomer.name)}" /></div>
          <div class="field"><label>رقم العميلة</label><input type="text" id="pos-customer-phone" value="${esc(scanCustomer.phone)}" /></div>
        </div>
        <div class="field"><label>ملاحظات (اختياري)</label><textarea id="pos-notes" rows="2">${esc(scanCustomer.notes)}</textarea></div>
        <button class="btn btn-primary btn-block" id="pos-confirm">تأكيد البيع</button>
      </div>
    </div>
  `;
  const input = document.getElementById('pos-search');
  input.focus();
  input.addEventListener('input', async function () {
    const q = input.value.trim();
    const box = document.getElementById('pos-results');
    if (!q) { box.innerHTML = ''; return; }
    const items = (await cachedApi('listFashionItems')).items;
    const list = posMatches(items, q);
    box.innerHTML = list.length ? list.map(function (i) {
      const out = Number(i.quantity) <= 0;
      return `<button type="button" class="pos-result" data-add-id="${esc(i.id)}" ${out ? 'disabled' : ''}>
        <span><strong>${esc(itemLabel(i))}</strong><small>${esc(i.categoryName)} — كود ${esc(i.code)}</small></span>
        <span>${money(i.totalPrice)} ج.م <small>${out ? 'خلصت' : 'متاح ' + esc(i.quantity)}</small></span></button>`;
    }).join('') : `<div class="empty-state" style="padding:14px">مفيش نتائج. لو ده باركود جديد اضغطي Enter</div>`;
    box.querySelectorAll('[data-add-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const it = items.find(function (x) { return String(x.id) === btn.getAttribute('data-add-id'); });
        if (it) { posAdd(it); input.value = ''; box.innerHTML = ''; input.focus(); }
      });
    });
  });
  input.addEventListener('keydown', async function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const items = (await cachedApi('listFashionItems')).items;
    const exact = items.find(function (i) { return String(i.code) === q; });
    const m = posMatches(items, q);
    if (exact) posAdd(exact);
    else if (m.length === 1) posAdd(m[0]);
    else if (!m.length && q.indexOf(' ') === -1 && q.length >= 3) { posNotFound(q); return; }
    else return;
    input.value = ''; document.getElementById('pos-results').innerHTML = ''; input.focus();
  });
  document.getElementById('pos-confirm').addEventListener('click', posConfirm);
  renderCart();
}

function posAdd(item) {
  const stock = Number(item.quantity) || 0;
  if (stock <= 0) { toast('"' + item.name + '" خلصت من المخزون', 'error'); return; }
  const ex = CART.find(function (c) { return c.id === item.id; });
  if (ex) {
    if (ex.qty >= stock) { toast('وصلتي لآخر كمية متاحة من "' + item.name + '"', 'error'); return; }
    ex.qty++;
  } else {
    CART.push({ id: item.id, label: itemLabel(item), price: Number(item.totalPrice) || 0, qty: 1, max: stock });
  }
  renderCart();
}

async function posAddByCode(code) {
  const items = (await cachedApi('listFashionItems')).items;
  const found = items.find(function (i) { return String(i.code) === String(code); });
  if (found) posAdd(found); else posNotFound(code);
}

function posNotFound(code) {
  const box = document.getElementById('pos-results');
  if (!box) return;
  box.innerHTML = `<div class="card" style="box-shadow:none">
    <div class="badge badge-danger">مفيش منتج بالكود ده</div>
    <p style="color:#888">الكود <strong>${esc(code)}</strong> مش مسجل. تقدري تضيفيه كمنتج جديد وهيتضاف للسلة.</p>
    <button class="btn btn-dark btn-block" id="pos-add-new">إضافة المنتج</button></div>`;
  document.getElementById('pos-add-new').addEventListener('click', function () {
    openScanAddItemForm(code, function () { box.innerHTML = ''; posAddByCode(code); });
  });
}

function cartTotal() { return CART.reduce(function (s, c) { return s + c.price * c.qty; }, 0); }

function renderCart() {
  const box = document.getElementById('pos-cart');
  if (!box) return;
  if (!CART.length) { box.innerHTML = `<div class="empty-state" style="padding:20px">السلة فاضية — ضيفي منتجات من اليمين</div>`; return; }
  box.innerHTML = `
    <div class="table-wrap"><table>
      <thead><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th></th></tr></thead>
      <tbody>${CART.map(function (c, idx) {
        return `<tr><td>${esc(c.label)}<br><small style="color:#888">${money(c.price)} ج.م للقطعة</small></td>
          <td><input type="number" class="cart-qty" data-idx="${idx}" value="${c.qty}" min="1" max="${c.max}" style="width:64px;padding:6px" /></td>
          <td><strong>${money(c.price * c.qty)}</strong></td>
          <td><button type="button" class="link-btn" data-del="${idx}">حذف</button></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="cart-total"><span>الإجمالي</span><strong>${money(cartTotal())} ج.م</strong></div>`;
  box.querySelectorAll('.cart-qty').forEach(function (inp) {
    inp.addEventListener('change', function () {
      const c = CART[Number(inp.getAttribute('data-idx'))];
      let v = Math.floor(Number(inp.value)) || 1;
      if (v > c.max) { v = c.max; toast('الكمية المتاحة ' + c.max + ' بس', 'error'); }
      c.qty = Math.max(1, v);
      renderCart();
    });
  });
  box.querySelectorAll('[data-del]').forEach(function (btn) {
    btn.addEventListener('click', function () { CART.splice(Number(btn.getAttribute('data-del')), 1); renderCart(); });
  });
}

async function posConfirm() {
  readPosCustomer();
  if (!CART.length) { toast('ضيفي منتج واحد على الأقل', 'error'); return; }
  if (!scanCustomer.name || !scanCustomer.phone) { toast('محتاج اسم العميلة ورقمها الأول', 'error'); return; }
  const btn = document.getElementById('pos-confirm');
  btn.disabled = true; btn.textContent = 'جاري التسجيل...';
  try {
    const result = await api('sellCart', {
      items: CART.map(function (c) { return { itemId: c.id, quantity: c.qty }; }),
      customerName: scanCustomer.name, customerPhone: scanCustomer.phone, notes: scanCustomer.notes, employee: CURRENT_USER.name
    });
    invalidateProductCaches();
    toast('تم تسجيل البيع', 'success');
    printReceipt({
      customerName: scanCustomer.name, customerPhone: scanCustomer.phone, employee: CURRENT_USER.name, total: result.total,
      lines: result.sales.map(function (x) { return { name: itemLabel(x), qty: x.quantity, total: x.totalPrice }; })
    });
    CART = [];
    scanCustomer = { name: '', phone: '', notes: '' };
    renderScan();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false; btn.textContent = 'تأكيد البيع';
  }
}

/* ============ الأزياء ============ */

function categoryIcon_(name) {
  const n = name || '';
  const map = [
    [/دبوس|دبابيس/, '📍'],
    [/طرح|طرحة|طرحه/, '🧕'],
    [/حجاب|خمار|هيجاب/, '🧕'],
    [/إسدال|اسدال/, '👗'],
    [/عباي|عبايه|عباية/, '👘'],
    [/نقاب|برقع/, '🖤'],
    [/بونيه|بونية|بندانة|باندانا|اند كاب|إند كاب|ايشارب|إيشارب|شال|وشاح/, '🧣'],
    [/فستان|جيبة|جونلة/, '👗'],
    [/بنطلون|بنطال/, '👖'],
    [/جاكيت|بلوفر|كارديجان|توب|بلوزة|قميص|تيشيرت/, '🧥'],
    [/جوارب|شراب|كالسون/, '🧦'],
    [/قفاز|جوانتي/, '🧤'],
    [/شنط|حقيبة/, '👜'],
    [/حذاء|جزم|صندل|شوز|شبشب/, '👟'],
    [/خاتم|اكسسوار|إكسسوار|سلسلة|حلق|اسورة|إسورة/, '💍'],
    [/بيجامة|منزلي|قطيفة/, '🌙']
  ];
  for (let i = 0; i < map.length; i++) { if (map[i][0].test(n)) return map[i][1]; }
  return '🛍️';
}

async function renderFashion() {
  setBreadcrumb('اختاري نوع المنتج (طرح، حجاب، دبابيس طرح ...)');
  content().innerHTML = `<div class="empty-state">جاري التحميل...</div>`;
  try {
    const [catData, itemData] = await Promise.all([cachedApi('listFashionCategories'), cachedApi('listFashionItems')]);
    content().innerHTML = `
      <div class="section-header">
        <div></div>
        <button class="btn btn-primary" id="add-cat-btn">+ إضافة نوع جديد</button>
      </div>
      <div class="grid grid-4" id="cat-grid">
        ${catData.items.map(function (c) {
          const list = itemData.items.filter(function (i) { return i.categoryId === c.id; });
          const qty = list.reduce(function (s, i) { return s + Number(i.quantity || 0); }, 0);
          return `<div class="category-box" data-cat-id="${esc(c.id)}" data-cat-name="${esc(c.name)}">
            <div class="icon">${categoryIcon_(c.name)}</div><div class="name">${esc(c.name)}</div>
            <div class="count">${list.length} صنف — ${qty} قطعة</div>
            ${list.length ? '' : `<button class="link-btn" data-del-cat="${esc(c.id)}" style="margin-top:8px;font-size:12px;color:var(--danger)">حذف النوع</button>`}
          </div>`;
        }).join('') || '<div class="empty-state">لا توجد أنواع بعد، أضيفي أول نوع</div>'}
      </div>
    `;
    document.getElementById('add-cat-btn').addEventListener('click', openAddCategoryForm);
    document.querySelectorAll('[data-del-cat]').forEach(function (btn) {
      btn.addEventListener('click', async function (e) {
        e.stopPropagation();
        if (!confirm('تحذفي النوع ده؟')) return;
        try {
          await api('deleteFashionCategory', { id: btn.getAttribute('data-del-cat') });
          invalidateCache('listFashionCategories');
          renderFashion();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
    document.querySelectorAll('[data-cat-id]').forEach(function (box) {
      box.addEventListener('click', function () {
        renderFashionItems(box.getAttribute('data-cat-id'), box.getAttribute('data-cat-name'));
      });
    });
  } catch (err) {
    content().innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

function openAddCategoryForm() {
  const overlay = openModal('إضافة نوع جديد', `
    <form id="cat-form">
      <div class="field"><label>اسم النوع (مثال: طرح، حجاب، دبابيس طرح، إسدالات، عبايات، نقاب)</label><input name="name" required /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('[name=name]').focus();
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#cat-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        const res = await api('addFashionCategory', { name: String(fd.get('name')).trim() });
        patchCacheAdd('listFashionCategories', res.item);
      }, { successMsg: 'تمت إضافة النوع', onDone: function () { if (CURRENT_SECTION === 'fashion') renderFashion(); } });
    });
  });
}

async function renderFashionItems(catId, catName) {
  setBreadcrumb('الأزياء / ' + catName);
  content().innerHTML = `
    <div class="section-header">
      <button class="link-btn" id="back-cats">→ رجوع لكل الأنواع</button>
      <div class="toolbar">
        <input type="text" id="item-search" placeholder="بحث بالاسم أو اللون..." />
        <button class="btn btn-dark btn-sm" id="scan-add-btn">🔍 إضافة/تعديل بالباركود</button>
        <button class="btn btn-primary btn-sm" id="add-item-btn">+ إضافة صنف</button>
      </div>
    </div>
    <div id="items-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('back-cats').addEventListener('click', renderFashion);
  document.getElementById('add-item-btn').addEventListener('click', function () { openAddItemForm(catId, catName); });
  document.getElementById('scan-add-btn').addEventListener('click', function () { openQuickBarcodeForCategory(catId, catName); });
  document.getElementById('item-search').addEventListener('input', function () { loadItemsTable(catId); });
  await loadItemsTable(catId);
}

function openQuickBarcodeForCategory(catId, catName) {
  const overlay = openModal('إضافة أو تحديث بالباركود — ' + catName, `
    <div class="field">
      <label>امسح الباركود أو اكتب الكود واضغط Enter</label>
      <input type="text" id="quick-code-input" placeholder="امسح الباركود هنا..." autocomplete="off" />
    </div>
    <p style="color:#888;font-size:13px">لو الكود موجود بالفعل هيفتحلك تعديل السعر والكمية فورًا. لو كود جديد هيفتحلك إضافة صنف جديد بنفس الكود.</p>
  `, function (el) {
    const input = el.querySelector('#quick-code-input');
    input.focus();
    async function doSearch() {
      const code = input.value.trim();
      if (!code) return;
      try {
        const data = await api('findProductByCode', { code: code });
        overlay.remove();
        if (data.found) openEditItemForm(data.item, function () { loadItemsTable(catId); });
        else openAddItemForm(catId, catName, code);
      } catch (err) { toast(err.message, 'error'); }
    }
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  });
}

async function loadItemsTable(catId) {
  const search = ((document.getElementById('item-search') || {}).value || '').toLowerCase();
  try {
    const data = await cachedApi('listFashionItems');
    let rows = data.items.filter(function (i) { return i.categoryId === catId; });
    if (search) rows = rows.filter(function (i) {
      return String(i.name || '').toLowerCase().includes(search) || String(i.color || '').toLowerCase().includes(search);
    });
    document.getElementById('items-table').innerHTML = rows.length ? `
      <table>
        <thead><tr><th>الكود</th><th>الاسم</th><th>اللون</th><th>المقاس</th><th>سعر الجملة</th><th>المكسب</th><th>الإجمالي</th><th>الكمية</th><th></th><th></th></tr></thead>
        <tbody>
          ${rows.map(function (i) {
            return `<tr>
              <td><span class="badge badge-slate">${esc(i.code) || '-'}</span></td>
              <td>${esc(i.name)}</td><td>${esc(i.color) || '-'}</td><td>${esc(i.size) || '-'}</td>
              <td>${Number(i.wholesalePrice).toLocaleString()}</td><td>${Number(i.profitPrice).toLocaleString()}</td>
              <td><strong>${Number(i.totalPrice).toLocaleString()}</strong></td>
              <td>${Number(i.quantity) <= 2 ? '<span class="badge badge-danger">' + esc(i.quantity) + '</span>' : esc(i.quantity)}</td>
              <td><button class="btn btn-primary btn-sm" data-sell-id="${esc(i.id)}">بيع</button></td>
              <td><button class="link-btn" data-edit-id="${esc(i.id)}">تعديل</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>` : `<div class="empty-state">لا توجد أصناف في هذا النوع بعد</div>`;

    function findRow(id) { return rows.find(function (r) { return String(r.id) === id; }); }
    document.querySelectorAll('[data-sell-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openSellForm(findRow(btn.getAttribute('data-sell-id')), function () { loadItemsTable(catId); });
      });
    });
    document.querySelectorAll('[data-edit-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openEditItemForm(findRow(btn.getAttribute('data-edit-id')), function () { loadItemsTable(catId); });
      });
    });
  } catch (err) {
    document.getElementById('items-table').innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

// حقول الصنف المشتركة بين الإضافة والتعديل
function itemFieldsHtml(v) {
  v = v || {};
  return `
    <div class="field"><label>اسم الصنف</label><input name="name" value="${esc(v.name)}" required /></div>
    <div class="grid grid-2">
      <div class="field"><label>اللون (اختياري)</label><input name="color" value="${esc(v.color)}" placeholder="مثال: بيج، كحلي" /></div>
      <div class="field"><label>المقاس (اختياري)</label><input name="size" value="${esc(v.size)}" placeholder="مثال: 150، فري سايز" /></div>
    </div>
    <div class="grid grid-2">
      <div class="field"><label>سعر الجملة</label><input type="number" name="wholesalePrice" value="${v.wholesalePrice !== undefined ? esc(v.wholesalePrice) : 0}" required /></div>
      <div class="field"><label>سعر المكسب</label><input type="number" name="profitPrice" value="${v.profitPrice !== undefined ? esc(v.profitPrice) : 0}" required /></div>
    </div>
    <div class="field"><label>الكمية</label><input type="number" name="quantity" value="${v.quantity !== undefined ? esc(v.quantity) : 1}" required /></div>`;
}

function openAddItemForm(catId, catName, prefillCode) {
  const overlay = openModal('إضافة صنف جديد — ' + catName, `
    <form id="item-form">
      ${itemFieldsHtml()}
      <div class="field"><label>كود المنتج (اختياري — سيبيه فاضي عشان يتولد تلقائي)</label><input name="code" placeholder="اختياري" value="${esc(prefillCode)}" /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('[name=name]').focus();
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        const res = await api('addFashionItem', {
          categoryId: catId, categoryName: catName, name: fd.get('name'), code: fd.get('code'),
          color: fd.get('color'), size: fd.get('size'),
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listFashionItems', res.item);
      }, { successMsg: 'تمت إضافة الصنف', onDone: function () { loadItemsTable(catId); } });
    });
  });
}

// إضافة منتج مع اختيار النوع (بتتستخدم من البيع بالباركود ومن المخزون)
async function openScanAddItemForm(code, onSaved) {
  let categories = [];
  try { categories = (await cachedApi('listFashionCategories')).items; } catch (e) { /* ignore */ }
  const overlay = openModal(code ? ('إضافة منتج جديد — كود ' + code) : 'إضافة منتج جديد', `
    <form id="scan-item-form">
      <div class="field">
        <label>النوع</label>
        <select name="categoryId" required>
          <option value="">اختاري النوع...</option>
          ${categories.map(function (c) { return `<option value="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}</option>`; }).join('')}
          <option value="__new__">+ نوع جديد</option>
        </select>
      </div>
      <div class="field hidden" id="new-cat-field"><label>اسم النوع الجديد</label><input name="newCategoryName" /></div>
      ${itemFieldsHtml()}
      ${code ? '' : '<div class="field"><label>كود المنتج (اختياري)</label><input name="code" placeholder="اختياري - يتولد تلقائي" /></div>'}
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ المنتج</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    const catSelect = el.querySelector('[name=categoryId]');
    catSelect.addEventListener('change', function () {
      el.querySelector('#new-cat-field').classList.toggle('hidden', catSelect.value !== '__new__');
    });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#scan-item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        let categoryId = fd.get('categoryId');
        let categoryName;
        if (categoryId === '__new__') {
          const newCat = await api('addFashionCategory', { name: String(fd.get('newCategoryName')).trim() });
          categoryId = newCat.item.id; categoryName = newCat.item.name;
          patchCacheAdd('listFashionCategories', newCat.item);
        } else {
          categoryName = catSelect.options[catSelect.selectedIndex].getAttribute('data-name');
        }
        const res = await api('addFashionItem', {
          code: code || fd.get('code'), categoryId: categoryId, categoryName: categoryName, name: fd.get('name'),
          color: fd.get('color'), size: fd.get('size'),
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        patchCacheAdd('listFashionItems', res.item);
      }, { successMsg: 'تمت إضافة المنتج بنجاح', onDone: function () { if (onSaved) onSaved(); } });
    });
  });
}

function openEditItemForm(item, onSaved) {
  const overlay = openModal('تعديل الصنف', `
    <form id="edit-item-form">
      ${itemFieldsHtml(item)}
      <div class="field"><label>كود المنتج</label><input name="code" value="${esc(item.code)}" /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ التعديلات</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#edit-item-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        await api('updateFashionItem', {
          id: item.id, name: fd.get('name'), code: fd.get('code'), color: fd.get('color'), size: fd.get('size'),
          wholesalePrice: fd.get('wholesalePrice'), profitPrice: fd.get('profitPrice'), quantity: fd.get('quantity')
        });
        invalidateCache('listFashionItems');
      }, {
        loadingMsg: 'يتم حفظ التعديلات...', successMsg: 'تم تعديل الصنف بنجاح',
        onDone: function () { if (onSaved) onSaved(); else loadInventoryBody(); }
      });
    });
  });
}

function openSellForm(item, onDone) {
  const overlay = openModal('بيع للعميلة — ' + itemLabel(item), `
    <form id="sell-form">
      <div class="field"><label>اسم العميلة</label><input name="customerName" required /></div>
      <div class="field"><label>رقم العميلة</label><input name="customerPhone" required /></div>
      <div class="field">
        <label>الكمية (المتاح: ${esc(item.quantity)})</label>
        <input type="number" name="quantity" value="1" min="1" max="${esc(item.quantity)}" required />
      </div>
      <div class="field"><label>ملاحظات (اختياري)</label><textarea name="notes" rows="3" placeholder="أي ملاحظات عن العملية..."></textarea></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">تأكيد البيع</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#sell-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const result = await api('sellFashionItem', {
          itemId: item.id, customerName: fd.get('customerName'), customerPhone: fd.get('customerPhone'),
          quantity: fd.get('quantity'), notes: fd.get('notes'), employee: CURRENT_USER.name
        });
        invalidateProductCaches();
        overlay.remove();
        toast('تم تسجيل عملية البيع', 'success');
        printReceipt({
          customerName: result.sale.customerName, customerPhone: result.sale.customerPhone,
          productName: itemLabel(result.sale) + (result.sale.quantity > 1 ? ' × ' + result.sale.quantity : ''),
          employee: result.sale.employee, total: result.sale.totalPrice
        });
        if (onDone) onDone();
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

/* ============ المخزون ============ */

async function renderInventory() {
  setBreadcrumb('كل المنتجات المتاحة بالمحل');
  content().innerHTML = `
    <div class="section-header">
      <div class="toolbar"><input type="text" id="inv-search" placeholder="بحث بالاسم أو اللون أو الكود..." /></div>
      <button class="btn btn-primary" id="inv-add-btn">+ إضافة منتج للمخزون</button>
    </div>
    <div id="inventory-body"></div>
  `;
  document.getElementById('inv-add-btn').addEventListener('click', function () {
    openScanAddItemForm(null, function () { toast('تمت إضافة المنتج للمخزون', 'success'); loadInventoryBody(); });
  });
  document.getElementById('inv-search').addEventListener('input', loadInventoryBody);
  await loadInventoryBody();
}

async function loadInventoryBody() {
  const wrap = document.getElementById('inventory-body');
  if (!wrap) return;
  const q = ((document.getElementById('inv-search') || {}).value || '').toLowerCase().trim();
  try {
    const [cats, items] = await Promise.all([cachedApi('listFashionCategories'), cachedApi('listFashionItems')]);
    function match(i) {
      if (!q) return true;
      return [i.name, i.color, i.code].some(function (x) { return String(x || '').toLowerCase().includes(q); });
    }
    const cards = cats.items.map(function (c) {
      const all = items.items.filter(function (i) { return i.categoryId === c.id; });
      const list = all.filter(match);
      if (q && !list.length) return '';
      const totalQty = all.reduce(function (s, i) { return s + Number(i.quantity || 0); }, 0);
      return `<div class="card">
        <h3 style="margin-top:0">${categoryIcon_(c.name)} ${esc(c.name)} <span class="badge badge-brown">${totalQty} قطعة</span></h3>
        ${list.length ? list.map(function (i) {
          return `<div style="padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>${esc(itemLabel(i))}</strong>
              <span>${Number(i.quantity) <= 2 ? '<span class="badge badge-danger">' + esc(i.quantity) + '</span>' : esc(i.quantity)}
              <button class="link-btn" style="margin-right:8px" data-edit-inv-id="${esc(i.id)}">تعديل</button></span>
            </div>
            <div style="color:#888">كود: ${esc(i.code) || '-'} — السعر: ${Number(i.totalPrice).toLocaleString()} ج.م — أُضيف: ${esc(i.dateAdded)}</div>
          </div>`;
        }).join('') : '<div class="empty-state" style="padding:12px">لا توجد أصناف</div>'}
      </div>`;
    }).join('');
    wrap.innerHTML = cards ? `<div class="grid grid-3">${cards}</div>` : '<div class="empty-state">لا توجد نتائج</div>';
    document.querySelectorAll('[data-edit-inv-id]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const found = items.items.find(function (i) { return String(i.id) === btn.getAttribute('data-edit-inv-id'); });
        if (found) openEditItemForm(found);
      });
    });
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

let accountingRecordsCache = null;

async function renderAccounting() {
  setBreadcrumb('تقارير يومية / شهرية / سنوية، وملخص كل نوع');
  content().innerHTML = `<div class="empty-state">جاري التحميل...</div>`;
  try {
    const data = await cachedApi('accountingSummary');
    accountingRecordsCache = data.records;
  } catch (err) {
    content().innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
    return;
  }

  content().innerHTML = `
    <div class="grid grid-3" id="acc-summary-cards"></div>
    <div class="tabs" style="margin-top:20px">
      <button class="tab-btn active" data-acc-view="daily">يومي</button>
      <button class="tab-btn" data-acc-view="monthly">شهري</button>
      <button class="tab-btn" data-acc-view="yearly">سنوي</button>
      <button class="tab-btn" data-acc-view="category">حسب النوع</button>
    </div>
    <div id="accounting-body"></div>
  `;
  renderAccountingSummaryCards();
  document.querySelectorAll('[data-acc-view]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('[data-acc-view]').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      renderAccountingTable(b.getAttribute('data-acc-view')); // بدون طلب شبكة، فورية
    });
  });
  renderAccountingTable('daily');
}

function renderAccountingSummaryCards() {
  const byCategory = {};
  let all = { total: 0, profit: 0 };
  accountingRecordsCache.forEach(function (r) {
    if (!byCategory[r.category]) byCategory[r.category] = { total: 0, profit: 0 };
    byCategory[r.category].total += r.total;
    byCategory[r.category].profit += r.profit;
    all.total += r.total; all.profit += r.profit;
  });
  function card(icon, title, v) {
    return `<div class="card">
      <div style="font-size:22px;margin-bottom:6px">${icon}</div>
      <h3 style="margin:0 0 10px">${esc(title)}</h3>
      <div class="stat-label">بعتي بإجمالي</div>
      <div class="stat-value brown" style="font-size:20px;margin-bottom:8px">${v.total.toLocaleString()} ج.م</div>
      <div class="stat-label">كسبتي (المكسب)</div>
      <div class="stat-value dark" style="font-size:20px">${v.profit.toLocaleString()} ج.م</div>
    </div>`;
  }
  document.getElementById('acc-summary-cards').innerHTML =
    card('🧾', 'إجمالي المبيعات', all) +
    Object.keys(byCategory).map(function (cat) { return card(categoryIcon_(cat), cat, byCategory[cat]); }).join('');
}

function renderAccountingTable(view) {
  const wrap = document.getElementById('accounting-body');
  const records = accountingRecordsCache || [];

  function groupBy(keyFn) {
    const map = {};
    records.forEach(function (r) {
      const key = keyFn(r);
      if (!map[key]) map[key] = { wholesale: 0, profit: 0, total: 0 };
      map[key].wholesale += r.wholesale;
      map[key].profit += r.profit;
      map[key].total += r.total;
    });
    return map;
  }

  let map, headLabel;
  if (view === 'daily') { map = groupBy(function (r) { return r.date; }); headLabel = 'اليوم'; }
  else if (view === 'monthly') { map = groupBy(function (r) { return r.date.substring(0, 7); }); headLabel = 'الشهر'; }
  else if (view === 'yearly') { map = groupBy(function (r) { return r.date.substring(0, 4); }); headLabel = 'السنة'; }
  else { map = groupBy(function (r) { return r.category; }); headLabel = 'النوع'; }

  const keys = Object.keys(map).sort().reverse();
  wrap.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>${headLabel}</th><th>سعر الجملة</th><th>المكسب</th><th>الإجمالي (اللي بعتيه)</th></tr></thead>
        <tbody>
          ${keys.map(function (k) {
            const v = map[k];
            return `<tr><td>${esc(k)}</td><td>${v.wholesale.toLocaleString()} ج.م</td>
            <td>${v.profit.toLocaleString()} ج.م</td><td><strong>${v.total.toLocaleString()} ج.م</strong></td></tr>`;
          }).join('') || '<tr><td colspan="4" class="empty-state">لا توجد بيانات بعد</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

/* ============ الموظفين ============ */

async function renderUsers() {
  if (CURRENT_USER.role !== 'مدير النظام') {
    content().innerHTML = `<div class="empty-state">هذا القسم لمدير النظام فقط</div>`;
    return;
  }
  setBreadcrumb('إدارة حسابات الموظفين');
  content().innerHTML = `
    <div class="section-header"><div></div><button class="btn btn-primary" id="add-user-btn">+ إضافة موظف</button></div>
    <div id="users-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>
  `;
  document.getElementById('add-user-btn').addEventListener('click', openAddUserForm);
  await loadUsersTable();
}

async function loadUsersTable() {
  try {
    const data = await cachedApi('listUsers');
    document.getElementById('users-table').innerHTML = `
      <table>
        <thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>تاريخ الإنشاء</th></tr></thead>
        <tbody>
          ${data.items.map(function (u) {
            return `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td>
            <td><span class="badge ${u.role === 'مدير النظام' ? 'badge-brown' : 'badge-slate'}">${esc(u.role)}</span></td>
            <td>${esc(u.createdAt)}</td></tr>`;
          }).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    document.getElementById('users-table').innerHTML = `<div class="empty-state">${err.message}</div>`;
  }
}

function openAddUserForm() {
  const overlay = openModal('إضافة موظف جديد', `
    <form id="user-form">
      <div class="field"><label>اسم الموظف</label><input name="name" required /></div>
      <div class="field"><label>اسم المستخدم (يوزر نيم)</label><input name="username" required /></div>
      <div class="field"><label>كلمة المرور</label><input type="password" name="password" required /></div>
      <div class="field">
        <label>الصلاحية</label>
        <select name="role" required>
          <option value="حسابات">حسابات</option>
          <option value="مدير النظام">مدير النظام</option>
        </select>
      </div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#user-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      saveInBackground(overlay, async function () {
        await api('addUser', {
          name: fd.get('name'), username: fd.get('username'), password: fd.get('password'), role: fd.get('role')
        });
        invalidateCache('listUsers');
      }, { successMsg: 'تمت إضافة الموظف', onDone: function () { loadUsersTable(); } });
    });
  });
}

/* ============ وارد / صادر مصنع ============ */

// وارد = فاتورة بتدخل المحل من المصنع | صادر = مرتجع بيرجع للمصنع (بتتخصم قيمته من المستحق)
function factoryBalances(docs) {
  const m = {};
  docs.forEach(function (d) {
    const f = d.factoryName || '-';
    const o = m[f] || (m[f] = { invoices: 0, paid: 0, remaining: 0, returns: 0 });
    if (d.kind === 'in') { o.invoices += Number(d.total) || 0; o.paid += Number(d.paid) || 0; o.remaining += Number(d.remaining) || 0; }
    else o.returns += Number(d.total) || 0;
  });
  let net = 0;
  Object.keys(m).forEach(function (f) { m[f].net = m[f].remaining - m[f].returns; net += m[f].net; });
  return { byFactory: m, net: net };
}

// الفواتير اللي لسه عليها فلوس وموعدها قرب (حسب عدد أيام التنبيه) أو فات
function dueAlerts(docs) {
  return docs.filter(function (d) { return d.kind === 'in' && Number(d.remaining) > 0 && daysUntil(d.dueDate) !== null; })
    .map(function (d) { return { doc: d, days: daysUntil(d.dueDate) }; })
    .filter(function (a) {
      const lead = a.doc.reminderDays === '' || isNaN(Number(a.doc.reminderDays)) ? 3 : Number(a.doc.reminderDays);
      return a.days <= lead;
    })
    .sort(function (x, y) { return x.days - y.days; });
}

function dueBadge(days) {
  if (days === null) return '<span class="badge badge-slate">بدون موعد</span>';
  if (days < 0) return `<span class="badge badge-danger">متأخرة ${-days} يوم</span>`;
  if (days === 0) return '<span class="badge badge-danger">النهارده</span>';
  return `<span class="badge badge-brown">بعد ${days} يوم</span>`;
}

async function refreshAlertsBadge() {
  try {
    const docs = (await cachedApi('listFactoryDocs')).items;
    const n = dueAlerts(docs).length;
    const b = document.querySelector('[data-nav="factoryIn"]');
    if (b && n && !b.querySelector('.nav-badge')) b.insertAdjacentHTML('beforeend', '<span class="nav-badge">' + n + '</span>');
    if (n && !sessionStorage.getItem('sara_due_toast')) {
      sessionStorage.setItem('sara_due_toast', '1');
      toast('عندك ' + n + ' فاتورة مصنع قرب أو فات موعد دفعها', 'error');
    }
  } catch (e) { /* التنبيه مش أساسي */ }
}

// أدوات مشتركة لسطور الأصناف في فورم الوارد والصادر
function itemDatalist(items) {
  return '<datalist id="items-dl">' + items.map(function (i) {
    return `<option value="${esc(i.code)} — ${esc(itemLabel(i))}"></option>`;
  }).join('') + '</datalist>';
}
function resolveItem(items, val) {
  val = String(val || '').trim();
  return items.find(function (i) { return (i.code + ' — ' + itemLabel(i)) === val; })
    || items.find(function (i) { return String(i.code) === val; });
}
const OLD_LINE_HTML = `<div class="line-row" data-type="old">
  <span class="badge badge-slate">قديم</span>
  <input class="ln-item" list="items-dl" placeholder="ابحثي بالاسم أو الكود" style="grid-column:span 2" />
  <input class="ln-cost" type="number" min="0" step="any" placeholder="سعر الجملة" />
  <input class="ln-qty" type="number" min="1" value="1" placeholder="الكمية" />
  <button type="button" class="link-btn ln-del">حذف</button></div>`;

async function renderFactoryIn() {
  setBreadcrumb('فواتير المصانع — اللي دخل المحل والمدفوع والمتبقي');
  content().innerHTML = `
    <div id="f-summary"></div>
    <div class="section-header" style="margin-top:18px">
      <div class="tabs" style="margin-bottom:0">
        <button class="tab-btn ${factoryFilter === 'open' ? 'active' : ''}" data-ff="open">لسه عليها فلوس</button>
        <button class="tab-btn ${factoryFilter === 'paid' ? 'active' : ''}" data-ff="paid">مسددة</button>
        <button class="tab-btn ${factoryFilter === 'all' ? 'active' : ''}" data-ff="all">الكل</button>
      </div>
      <div class="toolbar" style="margin-bottom:0">
        <input type="text" id="f-search" placeholder="بحث باسم المصنع أو رقم الفاتورة..." />
        <button class="btn btn-primary" id="f-add-btn">+ فاتورة وارد جديدة</button>
      </div>
    </div>
    <div id="f-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>`;
  document.querySelectorAll('[data-ff]').forEach(function (b) {
    b.addEventListener('click', function () { factoryFilter = b.getAttribute('data-ff'); renderFactoryIn(); });
  });
  document.getElementById('f-add-btn').addEventListener('click', openFactoryInvoiceForm);
  document.getElementById('f-search').addEventListener('input', loadFactoryIn);
  await loadFactoryIn();
}
let factoryFilter = 'open';

async function loadFactoryIn() {
  try {
    const all = (await cachedApi('listFactoryDocs')).items;
    const bal = factoryBalances(all);
    const tot = Object.keys(bal.byFactory).reduce(function (a, f) {
      a.inv += bal.byFactory[f].invoices; a.paid += bal.byFactory[f].paid; a.ret += bal.byFactory[f].returns; return a;
    }, { inv: 0, paid: 0, ret: 0 });
    document.getElementById('f-summary').innerHTML = `
      <div class="grid grid-4">
        <div class="card stat-card"><div class="stat-label">إجمالي الفواتير</div><div class="stat-value dark">${money(tot.inv)} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">المدفوع</div><div class="stat-value dark">${money(tot.paid)} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">مرتجعات (صادر)</div><div class="stat-value dark">${money(tot.ret)} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">المتبقي عليكي للمصانع</div><div class="stat-value brown">${money(bal.net)} ج.م</div></div>
      </div>
      ${Object.keys(bal.byFactory).length > 1 ? `<div class="card" style="margin-top:12px"><strong>أرصدة المصانع:</strong>
        ${Object.keys(bal.byFactory).map(function (f) { return `<span class="badge badge-brown" style="margin:4px">${esc(f)}: ${money(bal.byFactory[f].net)} ج.م</span>`; }).join('')}</div>` : ''}`;

    const q = ((document.getElementById('f-search') || {}).value || '').toLowerCase().trim();
    let rows = all.filter(function (d) { return d.kind === 'in'; });
    if (factoryFilter === 'open') rows = rows.filter(function (d) { return Number(d.remaining) > 0; });
    else if (factoryFilter === 'paid') rows = rows.filter(function (d) { return Number(d.remaining) <= 0; });
    if (q) rows = rows.filter(function (d) { return String(d.factoryName).toLowerCase().includes(q) || String(d.docNo).toLowerCase().includes(q); });
    rows.sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });

    document.getElementById('f-table').innerHTML = rows.length ? `<table>
      <thead><tr><th>التاريخ</th><th>رقم الفاتورة</th><th>المصنع</th><th>الإجمالي</th><th>المدفوع</th><th>المتبقي</th><th>الاستحقاق</th><th></th><th></th></tr></thead>
      <tbody>${rows.map(function (d) {
        const left = Number(d.remaining) || 0;
        return `<tr><td>${esc(String(d.date).substring(0, 10))}</td><td>${esc(d.docNo)}</td><td>${esc(d.factoryName)}</td>
          <td>${money(d.total)}</td><td>${money(d.paid)}</td><td><strong>${money(left)}</strong></td>
          <td>${left > 0 ? (d.dueDate ? esc(String(d.dueDate).substring(0, 10)) + ' ' + dueBadge(daysUntil(d.dueDate)) : '-') : '<span class="badge badge-success">مسددة</span>'}</td>
          <td><button class="link-btn" data-view-doc="${esc(d.id)}">تفاصيل</button></td>
          <td>${left > 0 ? `<button class="btn btn-primary btn-sm" data-pay-doc="${esc(d.id)}">تسجيل دفعة</button>` : ''}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty-state">لا توجد فواتير مطابقة</div>';

    function docOf(id) { return all.find(function (d) { return String(d.id) === id; }); }
    document.querySelectorAll('[data-view-doc]').forEach(function (b) {
      b.addEventListener('click', function () { openFactoryDocDetail(docOf(b.getAttribute('data-view-doc'))); });
    });
    document.querySelectorAll('[data-pay-doc]').forEach(function (b) {
      b.addEventListener('click', function () { openFactoryPaymentForm(docOf(b.getAttribute('data-pay-doc'))); });
    });
  } catch (err) {
    document.getElementById('f-table').innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

async function openFactoryDocDetail(doc) {
  const isIn = doc.kind === 'in';
  const [lineRes, payRes] = await Promise.all([
    cachedApi('listFactoryLines'), isIn ? cachedApi('listFactoryPayments') : Promise.resolve({ items: [] })
  ]);
  const lines = lineRes.items.filter(function (l) { return String(l.docId) === String(doc.id); });
  const pays = payRes.items.filter(function (p) { return String(p.docId) === String(doc.id); });
  const overlay = openModal((isIn ? 'فاتورة وارد ' : 'مرتجع صادر ') + esc(doc.docNo) + ' — ' + esc(doc.factoryName), `
    <p style="color:#888;margin-top:0">التاريخ: ${esc(String(doc.date).substring(0, 10))}${isIn && doc.dueDate ? ' — الاستحقاق: ' + esc(String(doc.dueDate).substring(0, 10)) : ''}${doc.notes ? ' — ' + esc(doc.notes) : ''}</p>
    <div class="table-wrap"><table>
      <thead><tr><th>الصنف</th>${isIn ? '<th>نوعه</th>' : ''}<th>الكمية</th><th>سعر الجملة</th><th>الإجمالي</th></tr></thead>
      <tbody>${lines.map(function (l) {
        return `<tr><td>${esc(itemLabel(l))}</td>${isIn ? `<td><span class="badge ${l.isNew === 'نعم' ? 'badge-brown' : 'badge-slate'}">${l.isNew === 'نعم' ? 'صنف جديد' : 'زيادة مخزون'}</span></td>` : ''}
          <td>${esc(l.quantity)}</td><td>${money(l.unitCost)}</td><td>${money(l.lineTotal)}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="empty-state">لا توجد أصناف</td></tr>'}</tbody></table></div>
    <div class="cart-total"><span>إجمالي ${isIn ? 'الفاتورة' : 'المرتجع'}</span><strong>${money(doc.total)} ج.م</strong></div>
    ${isIn ? `<div class="cart-total"><span>المدفوع</span><strong>${money(doc.paid)} ج.م</strong></div>
      <div class="cart-total"><span>المتبقي</span><strong style="color:var(--coral)">${money(doc.remaining)} ج.م</strong></div>
      <h4>الدفعات</h4>
      ${pays.length ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظات</th></tr></thead><tbody>
        ${pays.map(function (p) { return `<tr><td>${esc(String(p.date).substring(0, 10))}</td><td>${money(p.amount)}</td><td>${esc(p.notes) || '-'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty-state" style="padding:10px">لا توجد دفعات</div>'}` : ''}
    <div class="modal-actions">
      ${isIn && Number(doc.remaining) > 0 ? '<button type="button" class="btn btn-primary" id="d-pay">تسجيل دفعة</button>' : ''}
      <button type="button" class="btn btn-outline" id="d-close">إغلاق</button></div>
  `, function (el) {
    el.querySelector('.modal').classList.add('wide');
    el.querySelector('#d-close').addEventListener('click', function () { overlay.remove(); });
    const pay = el.querySelector('#d-pay');
    if (pay) pay.addEventListener('click', function () { overlay.remove(); openFactoryPaymentForm(doc); });
  });
}

function openFactoryPaymentForm(doc) {
  const left = Number(doc.remaining) || 0;
  const overlay = openModal('تسجيل دفعة — ' + esc(doc.factoryName), `
    <form id="pay-form">
      <p style="margin-top:0">فاتورة <strong>${esc(doc.docNo)}</strong> — المتبقي <strong>${money(left)} ج.م</strong></p>
      <div class="field"><label>المبلغ المدفوع</label><input type="number" name="amount" min="0.01" max="${left}" step="any" value="${left}" required /></div>
      <div class="field"><label>تاريخ الدفع</label><input type="date" name="date" value="${localToday()}" required /></div>
      <div class="field"><label>ملاحظات (اختياري)</label><input name="notes" placeholder="مثال: دفعة الأسبوع" /></div>
      <p id="pay-after" style="color:var(--teal-dark);font-weight:700"></p>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ الدفعة</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    const amt = el.querySelector('[name=amount]'), after = el.querySelector('#pay-after');
    function upd() { after.textContent = 'هيفضل عليكي: ' + money(Math.round((left - (Number(amt.value) || 0)) * 100) / 100) + ' ج.م'; }
    amt.addEventListener('input', upd); upd(); amt.select();
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#pay-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target);
      if (Number(fd.get('amount')) > left) { toast('المبلغ أكبر من المتبقي', 'error'); return; }
      saveInBackground(overlay, async function () {
        await api('addFactoryPayment', { docId: doc.id, amount: fd.get('amount'), date: fd.get('date'), notes: fd.get('notes'), employee: CURRENT_USER.name });
        invalidateFactoryCaches();
      }, { loadingMsg: 'يتم تسجيل الدفعة...', successMsg: 'تم تسجيل الدفعة', onDone: function () { if (CURRENT_SECTION === 'factoryIn') loadFactoryIn(); else renderApp(); } });
    });
  });
}

async function openFactoryInvoiceForm() {
  const [catRes, itemRes, docRes] = await Promise.all([cachedApi('listFashionCategories'), cachedApi('listFashionItems'), cachedApi('listFactoryDocs')]);
  const cats = catRes.items, items = itemRes.items;
  const factories = Array.from(new Set(docRes.items.map(function (d) { return d.factoryName; }).filter(Boolean)));
  const newLineHtml = `<div class="line-row" data-type="new">
    <span class="badge badge-brown">جديد</span>
    <select class="ln-cat">${cats.map(function (c) { return `<option value="${esc(c.id)}" data-name="${esc(c.name)}">${esc(c.name)}</option>`; }).join('')}</select>
    <input class="ln-name" placeholder="اسم الصنف" /><input class="ln-color" placeholder="اللون" /><input class="ln-size" placeholder="المقاس" />
    <input class="ln-code" placeholder="كود (اختياري)" />
    <input class="ln-cost" type="number" min="0" step="any" placeholder="سعر الجملة" />
    <input class="ln-profit" type="number" min="0" step="any" placeholder="المكسب" />
    <input class="ln-qty" type="number" min="1" value="1" placeholder="الكمية" />
    <button type="button" class="link-btn ln-del">حذف</button></div>`;
  const overlay = openModal('فاتورة وارد مصنع', `
    <form id="inv-form">
      <div class="grid grid-2">
        <div class="field"><label>اسم المصنع</label><input name="factoryName" list="factory-dl" required />
          <datalist id="factory-dl">${factories.map(function (f) { return `<option value="${esc(f)}"></option>`; }).join('')}</datalist></div>
        <div class="field"><label>رقم الفاتورة (اختياري)</label><input name="docNo" /></div>
        <div class="field"><label>تاريخ الفاتورة</label><input type="date" name="date" value="${localToday()}" required /></div>
        <div class="field"><label>تاريخ الاستحقاق (اختياري)</label><input type="date" name="dueDate" /></div>
      </div>
      <div class="field"><label>نبّهني قبل الاستحقاق بكام يوم</label><input type="number" name="reminderDays" value="3" min="0" /></div>
      <h4 style="margin:6px 0">الأصناف</h4>
      <p style="color:#888;font-size:13px;margin:0 0 8px">الصنف القديم بيزيد على الكمية الموجودة، والجديد بيتعمله صنف جديد في المخزون.</p>
      ${itemDatalist(items)}
      <div id="inv-lines"></div>
      <div class="toolbar">
        <button type="button" class="btn btn-outline btn-sm" id="add-old-line">+ صنف قديم</button>
        <button type="button" class="btn btn-outline btn-sm" id="add-new-line">+ صنف جديد</button>
      </div>
      <div class="grid grid-2">
        <div class="field"><label>إجمالي الفاتورة (حساب الفاتورة)</label><input type="number" name="total" id="inv-total" min="0" step="any" value="0" /></div>
        <div class="field"><label>المدفوع دلوقتي</label><input type="number" name="paid" id="inv-paid" min="0" step="any" value="0" /></div>
      </div>
      <p id="inv-left" style="color:var(--teal-dark);font-weight:700;margin-top:0"></p>
      <div class="field"><label>ملاحظات (اختياري)</label><input name="notes" /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ الفاتورة</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('.modal').classList.add('wide');
    const linesBox = el.querySelector('#inv-lines'), totalIn = el.querySelector('#inv-total'), paidIn = el.querySelector('#inv-paid');
    function recalc() {
      if (!totalIn.dataset.manual) {
        let sum = 0;
        linesBox.querySelectorAll('.line-row').forEach(function (r) {
          sum += (Number(r.querySelector('.ln-qty').value) || 0) * (Number(r.querySelector('.ln-cost').value) || 0);
        });
        totalIn.value = Math.round(sum * 100) / 100;
      }
      el.querySelector('#inv-left').textContent = 'المتبقي بعد الدفع: ' + money(Math.round(((Number(totalIn.value) || 0) - (Number(paidIn.value) || 0)) * 100) / 100) + ' ج.م';
    }
    function addLine(html) { linesBox.insertAdjacentHTML('beforeend', html); recalc(); }
    el.querySelector('#add-old-line').addEventListener('click', function () { addLine(OLD_LINE_HTML); });
    el.querySelector('#add-new-line').addEventListener('click', function () {
      if (!cats.length) { toast('ضيفي نوع واحد على الأقل من قسم الأزياء الأول', 'error'); return; }
      addLine(newLineHtml);
    });
    totalIn.addEventListener('input', function () { totalIn.dataset.manual = '1'; recalc(); });
    paidIn.addEventListener('input', recalc);
    linesBox.addEventListener('input', function (e) {
      if (e.target.classList.contains('ln-item')) {
        const it = resolveItem(items, e.target.value), cost = e.target.closest('.line-row').querySelector('.ln-cost');
        if (it && !cost.value) cost.value = it.wholesalePrice;
      }
      recalc();
    });
    linesBox.addEventListener('click', function (e) {
      if (e.target.classList.contains('ln-del')) { e.target.closest('.line-row').remove(); recalc(); }
    });
    addLine(OLD_LINE_HTML);
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#inv-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target), lines = [];
      const rowsEls = linesBox.querySelectorAll('.line-row');
      for (let i = 0; i < rowsEls.length; i++) {
        const r = rowsEls[i], qty = Number(r.querySelector('.ln-qty').value), cost = Number(r.querySelector('.ln-cost').value) || 0;
        if (!(qty > 0)) { toast('الكمية في السطر ' + (i + 1) + ' لازم تكون أكبر من صفر', 'error'); return; }
        if (r.getAttribute('data-type') === 'old') {
          const it = resolveItem(items, r.querySelector('.ln-item').value);
          if (!it) { toast('اختاري صنف قديم من القايمة في السطر ' + (i + 1), 'error'); return; }
          lines.push({ itemId: it.id, quantity: qty, unitCost: cost });
        } else {
          const name = r.querySelector('.ln-name').value.trim(), cat = r.querySelector('.ln-cat');
          if (!name) { toast('اكتبي اسم الصنف الجديد في السطر ' + (i + 1), 'error'); return; }
          lines.push({ quantity: qty, unitCost: cost, newItem: {
            name: name, categoryId: cat.value, categoryName: cat.options[cat.selectedIndex].getAttribute('data-name'),
            color: r.querySelector('.ln-color').value.trim(), size: r.querySelector('.ln-size').value.trim(),
            code: r.querySelector('.ln-code').value.trim(), profitPrice: r.querySelector('.ln-profit').value || 0 } });
        }
      }
      if (!lines.length) { toast('ضيفي صنف واحد على الأقل', 'error'); return; }
      if ((Number(fd.get('paid')) || 0) > (Number(fd.get('total')) || 0)) { toast('المدفوع أكبر من إجمالي الفاتورة', 'error'); return; }
      saveInBackground(overlay, async function () {
        await api('addFactoryInvoice', {
          factoryName: fd.get('factoryName'), docNo: fd.get('docNo'), date: fd.get('date'), dueDate: fd.get('dueDate'),
          reminderDays: fd.get('reminderDays'), total: fd.get('total'), paid: fd.get('paid'), notes: fd.get('notes'),
          items: lines, employee: CURRENT_USER.name
        });
        invalidateFactoryCaches();
      }, {
        loadingMsg: 'يتم تسجيل الفاتورة...', successMsg: 'تم تسجيل الفاتورة وتحديث المخزون',
        onDone: function () { if (CURRENT_SECTION === 'factoryIn') loadFactoryIn(); }
      });
    });
  });
}

/* ---------- صادر مصنع ---------- */

async function renderFactoryOut() {
  setBreadcrumb('بضاعة راجعة للمصنع — بتنقص من المخزون وبتتخصم من المستحق');
  content().innerHTML = `
    <div class="section-header"><div></div><button class="btn btn-primary" id="o-add-btn">+ صادر جديد للمصنع</button></div>
    <div id="o-table" class="table-wrap"><div class="empty-state">جاري التحميل...</div></div>`;
  document.getElementById('o-add-btn').addEventListener('click', openFactoryReturnForm);
  await loadFactoryOut();
}

async function loadFactoryOut() {
  try {
    const all = (await cachedApi('listFactoryDocs')).items;
    const rows = all.filter(function (d) { return d.kind === 'out'; })
      .sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
    document.getElementById('o-table').innerHTML = rows.length ? `<table>
      <thead><tr><th>التاريخ</th><th>الرقم</th><th>المصنع</th><th>القيمة</th><th>ملاحظات</th><th></th></tr></thead>
      <tbody>${rows.map(function (d) {
        return `<tr><td>${esc(String(d.date).substring(0, 10))}</td><td>${esc(d.docNo)}</td><td>${esc(d.factoryName)}</td>
          <td><strong>${money(d.total)}</strong></td><td>${esc(d.notes) || '-'}</td>
          <td><button class="link-btn" data-view-doc="${esc(d.id)}">تفاصيل</button></td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty-state">لا توجد عمليات صادر بعد</div>';
    document.querySelectorAll('[data-view-doc]').forEach(function (b) {
      b.addEventListener('click', function () {
        openFactoryDocDetail(all.find(function (d) { return String(d.id) === b.getAttribute('data-view-doc'); }));
      });
    });
  } catch (err) {
    document.getElementById('o-table').innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

async function openFactoryReturnForm() {
  const [itemRes, docRes] = await Promise.all([cachedApi('listFashionItems'), cachedApi('listFactoryDocs')]);
  const items = itemRes.items;
  const factories = Array.from(new Set(docRes.items.map(function (d) { return d.factoryName; }).filter(Boolean)));
  const overlay = openModal('صادر مصنع (بضاعة راجعة)', `
    <form id="ret-form">
      <div class="grid grid-2">
        <div class="field"><label>اسم المصنع</label><input name="factoryName" list="factory-dl" required />
          <datalist id="factory-dl">${factories.map(function (f) { return `<option value="${esc(f)}"></option>`; }).join('')}</datalist></div>
        <div class="field"><label>التاريخ</label><input type="date" name="date" value="${localToday()}" required /></div>
      </div>
      ${itemDatalist(items)}
      <div id="ret-lines"></div>
      <div class="toolbar"><button type="button" class="btn btn-outline btn-sm" id="add-ret-line">+ صنف</button></div>
      <div class="cart-total"><span>قيمة الصادر (بتتخصم من المستحق للمصنع)</span><strong id="ret-total">0 ج.م</strong></div>
      <div class="field" style="margin-top:12px"><label>ملاحظات / السبب (اختياري)</label><input name="notes" placeholder="مثال: عيب تصنيع" /></div>
      <div class="modal-actions">
        <button type="submit" class="btn btn-primary">حفظ</button>
        <button type="button" class="btn btn-outline" id="cancel-btn">إلغاء</button>
      </div>
    </form>
  `, function (el) {
    el.querySelector('.modal').classList.add('wide');
    const box = el.querySelector('#ret-lines');
    function recalc() {
      let sum = 0;
      box.querySelectorAll('.line-row').forEach(function (r) { sum += (Number(r.querySelector('.ln-qty').value) || 0) * (Number(r.querySelector('.ln-cost').value) || 0); });
      el.querySelector('#ret-total').textContent = money(Math.round(sum * 100) / 100) + ' ج.م';
    }
    function addLine() { box.insertAdjacentHTML('beforeend', OLD_LINE_HTML.replace('>قديم<', '>صنف<')); }
    addLine();
    el.querySelector('#add-ret-line').addEventListener('click', addLine);
    box.addEventListener('input', function (e) {
      if (e.target.classList.contains('ln-item')) {
        const it = resolveItem(items, e.target.value), cost = e.target.closest('.line-row').querySelector('.ln-cost');
        if (it && !cost.value) cost.value = it.wholesalePrice;
      }
      recalc();
    });
    box.addEventListener('click', function (e) { if (e.target.classList.contains('ln-del')) { e.target.closest('.line-row').remove(); recalc(); } });
    el.querySelector('#cancel-btn').addEventListener('click', function () { overlay.remove(); });
    el.querySelector('#ret-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const fd = new FormData(e.target), lines = [], rowsEls = box.querySelectorAll('.line-row');
      for (let i = 0; i < rowsEls.length; i++) {
        const r = rowsEls[i], it = resolveItem(items, r.querySelector('.ln-item').value), qty = Number(r.querySelector('.ln-qty').value);
        if (!it) { toast('اختاري صنف من القايمة في السطر ' + (i + 1), 'error'); return; }
        if (!(qty > 0) || qty > Number(it.quantity)) { toast('الكمية في السطر ' + (i + 1) + ' لازم تكون بين 1 و ' + it.quantity, 'error'); return; }
        lines.push({ itemId: it.id, quantity: qty, unitCost: Number(r.querySelector('.ln-cost').value) || 0 });
      }
      if (!lines.length) { toast('ضيفي صنف واحد على الأقل', 'error'); return; }
      saveInBackground(overlay, async function () {
        await api('addFactoryReturn', { factoryName: fd.get('factoryName'), date: fd.get('date'), notes: fd.get('notes'), items: lines, employee: CURRENT_USER.name });
        invalidateFactoryCaches();
      }, {
        loadingMsg: 'يتم تسجيل الصادر...', successMsg: 'تم تسجيل الصادر وخصمه من المخزون',
        onDone: function () { if (CURRENT_SECTION === 'factoryOut') loadFactoryOut(); }
      });
    });
  });
}

/* ============ طباعة الإيصال ============ */

function printReceipt(data) {
  const rowsHtml = data.lines && data.lines.length
    ? data.lines.map(function (l) { return `<div class="row"><span>${esc(l.name)} × ${esc(l.qty)}</span><span>${money(l.total)}</span></div>`; }).join('')
    : `<div class="row"><span>المنتج:</span><span>${esc(data.productName) || '-'}</span></div>`;
  const win = window.open('', '_blank', 'width=340,height=520');
  win.document.write(`
    <html dir="rtl"><head><title>إيصال</title>
    <style>
      body { font-family: 'Courier New', monospace; padding: 16px; }
      .center { text-align: center; }
      hr { border: none; border-top: 1px dashed #000; }
      .row { display: flex; justify-content: space-between; margin: 6px 0; }
    </style></head>
    <body>
      <div class="center"><h2>${SHOP_NAME}</h2><div style="font-size:12px">كل ما تحتاجه المرأة المسلمة من زي شرعي</div></div>
      <hr />
      <div class="row"><span>العميل:</span><span>${esc(data.customerName) || '-'}</span></div>
      <div class="row"><span>الهاتف:</span><span>${esc(data.customerPhone) || '-'}</span></div>
      ${rowsHtml}
      <div class="row"><span>الموظف:</span><span>${esc(data.employee) || '-'}</span></div>
      <hr />
      <div class="row" style="font-weight:bold;font-size:18px"><span>الإجمالي:</span><span>${Number(data.total || 0).toLocaleString()} ج.م</span></div>
      <hr />
      <div class="center">شكرًا لتعاملكم معنا</div>
      <script>window.print();</script>
    </body></html>
  `);
  win.document.close();
}

/* ============ السكانر العام (يشتغل من أي مكان في النظام) ============ */

let globalScanBuffer = '';
let globalScanLastTime = 0;

document.addEventListener('keydown', function (e) {
  // لو المستخدم بيكتب فعليًا في أي خانة نص/تيكست إريا/قايمة (زي فورم إضافة أو تسجيل دخول)
  // سيبها تتصرف عادي، ومتتدخلش خالص
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (isTyping) return;
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!CURRENT_USER) return; // قبل تسجيل الدخول متعملش حاجة

  const now = Date.now();
  // ماسحات الباركود بتكتب الأرقام بسرعة جدًا (أسرع من أي كتابة بشرية)
  // لو الفاصل بين الضغطات كبير، يبقى ده كتابة عادية أو ضغطة عرضية، ابدأ بافر جديد
  if (now - globalScanLastTime > 60) globalScanBuffer = '';
  globalScanLastTime = now;

  if (e.key === 'Enter') {
    const code = globalScanBuffer.trim();
    globalScanBuffer = '';
    if (code.length >= 3) {
      e.preventDefault();
      handleGlobalScan(code);
    }
    return;
  }
  if (e.key.length === 1) {
    globalScanBuffer += e.key;
  }
});

function handleGlobalScan(code) {
  CURRENT_SECTION = 'scan';
  renderApp();
  setTimeout(function () { posAddByCode(code); }, 30);
}

/* ============ بدء التشغيل ============ */

if (CURRENT_USER) { prefetchAll(); renderApp(); } else renderLogin();
