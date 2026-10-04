/* ============ حالة عامة ============ */
let CURRENT_USER = JSON.parse(sessionStorage.getItem('sara_user') || 'null');
let CURRENT_SECTION = 'dashboard';
let CACHE = {}; // كاش بسيط للبيانات المجلوبة من الشيت

const root = document.getElementById('root');

/* ============ اتصال بالـ API ============ */

async function api(action, payload) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('PASTE_') === 0) {
    throw new Error('https://script.google.com/macros/s/AKfycbyoFT0VTOYwH_RCltkouBqSO9N8VUXFOPaf8JoVD1PjSU49hH6VN-0wGKq_v6mbc63g/exec');
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
  ['listFashionSales', 'listFashionItems', 'listFashionCategories'].forEach(function (a) {
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
  { id: 'scan', label: 'بيع بالباركود', icon: '🔍' },
  { id: 'fashion', label: 'الأزياء', icon: '🧕' },
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
    inventory: renderInventory,
    accounting: renderAccounting,
    users: renderUsers
  };
  (renderers[CURRENT_SECTION] || renderDashboard)();
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
    const [sales, items] = await Promise.all([cachedApi('listFashionSales'), cachedApi('listFashionItems')]);
    const today = new Date().toISOString().substring(0, 10);
    const todaySales = sales.items.filter(function (r) { return String(r.date).substring(0, 10) === today; });
    const todayTotal = todaySales.reduce(function (s, r) { return s + Number(r.totalPrice || 0); }, 0);
    const todayProfit = todaySales.reduce(function (s, r) { return s + Number(r.profitPrice || 0); }, 0);
    const lowStock = items.items.filter(function (i) { return Number(i.quantity) <= 2; }).length;

    content().innerHTML = `
      <div class="grid grid-4">
        <div class="card stat-card"><div class="stat-label">مبيعات اليوم</div><div class="stat-value brown">${todayTotal.toLocaleString()} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">أرباح اليوم</div><div class="stat-value dark">${todayProfit.toLocaleString()} ج.م</div></div>
        <div class="card stat-card"><div class="stat-label">عمليات اليوم</div><div class="stat-value dark">${todaySales.length}</div></div>
        <div class="card stat-card"><div class="stat-label">أصناف على وشك النفاذ</div><div class="stat-value brown">${lowStock}</div></div>
      </div>
      <div class="card" style="margin-top:20px">
        <h3 style="margin-top:0">آخر العمليات اليوم</h3>
        <div class="table-wrap">
          <table>
            <thead><tr><th>الوقت</th><th>النوع</th><th>الصنف</th><th>العميلة</th><th>الإجمالي</th><th>الموظف</th></tr></thead>
            <tbody>
              ${todaySales.slice(-10).reverse().map(function (r) {
                return `<tr><td>${esc(String(r.date).substring(11))}</td><td>${esc(r.categoryName)}</td><td>${esc(itemLabel(r))}</td>
                <td>${esc(r.customerName) || '-'}</td><td>${Number(r.totalPrice || 0).toLocaleString()} ج.م</td><td>${esc(r.employee) || '-'}</td></tr>`;
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

/* ============ بيع بالباركود / الكود ============ */

let scanCustomer = { name: '', phone: '' };

async function renderScan() {
  setBreadcrumb('اكتبي كود المنتج أو امسحيه بالباركود');
  content().innerHTML = `
    <div class="card" style="max-width:520px">
      <h3 style="margin-top:0">بيانات العميلة</h3>
      <div class="grid grid-2">
        <div class="field"><label>اسم العميلة</label><input type="text" id="scan-customer-name" value="${esc(scanCustomer.name)}" /></div>
        <div class="field"><label>رقم العميلة</label><input type="text" id="scan-customer-phone" value="${esc(scanCustomer.phone)}" /></div>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin:16px 0" />
      <h3 style="margin-top:0">كود المنتج</h3>
      <div class="field">
        <label>امسح الباركود بالسكانر أو اكتب الكود يدويًا واضغط Enter</label>
        <input type="text" id="scan-code-input" placeholder="مثال: 123456" autocomplete="off" />
      </div>
      <button class="btn btn-primary btn-block" id="scan-search-btn">بحث عن المنتج</button>
    </div>
    <div id="scan-result" style="max-width:520px;margin-top:16px"></div>
  `;
  const codeInput = document.getElementById('scan-code-input');
  codeInput.focus();
  codeInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); doScanSearch(); }
  });
  document.getElementById('scan-search-btn').addEventListener('click', doScanSearch);
}

function readScanCustomer() {
  scanCustomer.name = document.getElementById('scan-customer-name').value.trim();
  scanCustomer.phone = document.getElementById('scan-customer-phone').value.trim();
}

async function doScanSearch() {
  readScanCustomer();
  const code = document.getElementById('scan-code-input').value.trim();
  const resultBox = document.getElementById('scan-result');
  if (!code) { toast('اكتب أو امسح كود المنتج الأول', 'error'); return; }
  resultBox.innerHTML = `<div class="empty-state">جاري البحث...</div>`;
  try {
    const data = await api('findProductByCode', { code: code });
    if (data.found) renderScanFoundProduct(data.item, code);
    else renderScanNotFound(code);
  } catch (err) {
    resultBox.innerHTML = `<div class="empty-state">${esc(err.message)}</div>`;
  }
}

function renderScanFoundProduct(item, code) {
  const resultBox = document.getElementById('scan-result');
  const outOfStock = Number(item.quantity) <= 0;
  resultBox.innerHTML = `
    <div class="card">
      <div class="badge badge-success">تم إيجاد المنتج</div>
      <h3>${esc(item.name)}</h3>
      <p style="color:#888;margin:4px 0">${esc(item.categoryName)}${item.color ? ' — اللون: ' + esc(item.color) : ''}${item.size ? ' — المقاس: ' + esc(item.size) : ''} — الكود: ${esc(item.code)}</p>
      <div class="row" style="display:flex;justify-content:space-between;font-size:15px;margin:10px 0">
        <span>سعر القطعة</span><strong>${Number(item.totalPrice).toLocaleString()} ج.م</strong>
      </div>
      <div class="row" style="display:flex;justify-content:space-between;font-size:14px;color:#888;margin-bottom:10px">
        <span>الكمية المتاحة</span><span>${esc(item.quantity)}</span>
      </div>
      ${outOfStock
        ? `<div class="error-msg">الكمية غير متاحة في المخزون</div>`
        : `<div class="field"><label>الكمية المطلوبة</label>
             <input type="number" id="scan-sell-qty" value="1" min="1" max="${esc(item.quantity)}" /></div>
           <div class="field"><label>ملاحظات (اختياري)</label><textarea id="scan-sell-notes" rows="2" placeholder="أي ملاحظات عن العملية..."></textarea></div>
           <button class="btn btn-primary btn-block" id="confirm-scan-sell">تأكيد البيع</button>`}
    </div>
  `;
  if (outOfStock) return;
  document.getElementById('confirm-scan-sell').addEventListener('click', async function () {
    readScanCustomer();
    if (!scanCustomer.name || !scanCustomer.phone) { toast('محتاج اسم العميلة ورقمها الأول', 'error'); return; }
    const qty = document.getElementById('scan-sell-qty').value;
    const notesEl = document.getElementById('scan-sell-notes');
    try {
      const result = await api('sellByCode', {
        code: code, customerName: scanCustomer.name, customerPhone: scanCustomer.phone,
        quantity: qty, notes: notesEl ? notesEl.value : '', employee: CURRENT_USER.name
      });
      invalidateProductCaches();
      toast('تم تسجيل عملية البيع', 'success');
      printReceipt({
        customerName: scanCustomer.name, customerPhone: scanCustomer.phone,
        productName: itemLabel(result.sale) + (result.sale.quantity > 1 ? ' × ' + result.sale.quantity : ''),
        employee: CURRENT_USER.name, total: result.sale.totalPrice
      });
      document.getElementById('scan-code-input').value = '';
      document.getElementById('scan-result').innerHTML = '';
      document.getElementById('scan-code-input').focus();
    } catch (err) { toast(err.message, 'error'); }
  });
}

function renderScanNotFound(code) {
  document.getElementById('scan-result').innerHTML = `
    <div class="card">
      <div class="badge badge-danger">مفيش منتج بالكود ده</div>
      <p style="color:#888">الكود <strong>${esc(code)}</strong> مش مسجل في النظام. تقدري تضيفيه دلوقتي كمنتج جديد وهيتباع فورًا للعميلة.</p>
      <button class="btn btn-dark btn-block" id="scan-add-item">إضافة المنتج</button>
    </div>
  `;
  document.getElementById('scan-add-item').addEventListener('click', function () {
    openScanAddItemForm(code, function () { toast('تمت إضافة المنتج، جاري البيع...', 'success'); sellScannedProductNow(code); });
  });
}

async function sellScannedProductNow(code) {
  if (!scanCustomer.name || !scanCustomer.phone) {
    toast('المنتج اتضاف بنجاح، ادخلي بيانات العميلة وابحثي بنفس الكود تاني عشان تكملي البيع', 'success');
    renderScan();
    return;
  }
  try {
    const result = await api('sellByCode', {
      code: code, customerName: scanCustomer.name, customerPhone: scanCustomer.phone, employee: CURRENT_USER.name
    });
    invalidateProductCaches();
    toast('تم البيع بنجاح', 'success');
    printReceipt({
      customerName: scanCustomer.name, customerPhone: scanCustomer.phone,
      productName: itemLabel(result.sale), employee: CURRENT_USER.name, total: result.sale.totalPrice
    });
    renderScan();
  } catch (err) { toast(err.message, 'error'); }
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
          </div>`;
        }).join('') || '<div class="empty-state">لا توجد أنواع بعد، أضيفي أول نوع</div>'}
      </div>
    `;
    document.getElementById('add-cat-btn').addEventListener('click', openAddCategoryForm);
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

/* ============ طباعة الإيصال ============ */

function printReceipt(data) {
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
      <div class="row"><span>المنتج:</span><span>${esc(data.productName) || '-'}</span></div>
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
  setTimeout(function () {
    const input = document.getElementById('scan-code-input');
    if (input) {
      input.value = code;
      doScanSearch();
    }
  }, 30);
}

/* ============ بدء التشغيل ============ */

if (CURRENT_USER) { prefetchAll(); renderApp(); } else renderLogin();
