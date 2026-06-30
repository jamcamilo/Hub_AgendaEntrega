const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const loginScreen = document.getElementById('loginScreen');
const appScreen   = document.getElementById('appScreen');
const loginForm   = document.getElementById('loginForm');
const loginError  = document.getElementById('loginError');
const loginBtn    = document.getElementById('loginBtn');

let currentView = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let ordersByDay = {};   // 'YYYY-MM-DD' -> [order, ...]
let activeOrder = null;

function pad(n){ return String(n).padStart(2,'0'); }
function isoDate(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

// ── Sessão ────────────────────────────────────────────────
async function checkSession(){
  const r = await fetch('/api/session');
  const data = await r.json();
  if (data.logged){
    showApp(data.user);
  } else {
    showLogin();
  }
}

function showLogin(){
  loginScreen.style.display = 'flex';
  appScreen.style.display = 'none';
}

function showApp(user){
  loginScreen.style.display = 'none';
  appScreen.style.display = 'flex';
  document.getElementById('userName').textContent = user;
  document.getElementById('userInitials').textContent = user.slice(0,2).toUpperCase();
  loadMonth();
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';
  loginBtn.disabled = true;
  loginBtn.textContent = 'Entrando...';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user: document.getElementById('loginUser').value,
        password: document.getElementById('loginPass').value,
      }),
    });
    const data = await r.json();
    if (data.ok){
      showApp(data.user);
    } else {
      loginError.textContent = data.error || 'Falha no login.';
      loginError.style.display = 'block';
    }
  } catch (err){
    loginError.textContent = 'Erro de conexão com o servidor.';
    loginError.style.display = 'block';
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Entrar';
  }
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  showLogin();
});

// ── Calendário ────────────────────────────────────────────
async function loadMonth(){
  const y = currentView.getFullYear(), m = currentView.getMonth();
  document.getElementById('monthLabel').textContent = `${MONTHS[m]} ${y}`;

  const datIni = isoDate(new Date(y, m, 1));
  const datFim = isoDate(new Date(y, m + 1, 0));

  const statusMsg = document.getElementById('statusMsg');
  statusMsg.style.display = 'inline-flex';
  statusMsg.className = 'chip chip--info';
  statusMsg.textContent = 'Carregando...';

  try {
    const r = await fetch(`/api/orders?datIni=${datIni}&datFim=${datFim}`);
    const data = await r.json();
    if (data.error){
      statusMsg.className = 'chip chip--error';
      statusMsg.textContent = data.error;
      ordersByDay = {};
    } else {
      ordersByDay = {};
      data.forEach(o => {
        const key = o.deliveryDate;
        if (!ordersByDay[key]) ordersByDay[key] = [];
        ordersByDay[key].push(o);
      });
      statusMsg.style.display = 'none';
    }
  } catch (err){
    statusMsg.className = 'chip chip--error';
    statusMsg.textContent = 'Erro de conexão.';
    ordersByDay = {};
  }
  renderGrid();
}

function renderGrid(){
  const grid = document.getElementById('calGrid');
  const y = currentView.getFullYear(), m = currentView.getMonth();
  const startDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const prevDays = new Date(y, m, 0).getDate();
  const todayIso = isoDate(new Date());

  let html = '';
  for (let i = startDow - 1; i >= 0; i--){
    html += cellHtml(new Date(y, m - 1, prevDays - i), true, todayIso);
  }
  for (let d = 1; d <= daysInMonth; d++){
    html += cellHtml(new Date(y, m, d), false, todayIso);
  }
  const trailing = (7 - ((startDow + daysInMonth) % 7)) % 7;
  for (let d = 1; d <= trailing; d++){
    html += cellHtml(new Date(y, m + 1, d), true, todayIso);
  }
  grid.innerHTML = html;

  grid.querySelectorAll('.oc-card').forEach(card => {
    card.addEventListener('click', () => openOrderModal(card.dataset.id));
  });
}

function cellHtml(date, muted, todayIso){
  const iso = isoDate(date);
  const isToday = iso === todayIso && !muted;
  const orders = muted ? [] : (ordersByDay[iso] || []);
  let cards = orders.slice(0, 3).map(o => `
    <div class="oc-card status-${o.sitIpo}" data-id="${o.id}">
      <div class="oc-card__id">${o.id}</div>
      <div class="oc-card__supplier">${escapeHtml(o.supplier || '')}</div>
    </div>`).join('');
  if (orders.length > 3) cards += `<div class="oc-card__more">+${orders.length - 3} mais</div>`;
  return `<div class="cal__cell ${muted ? 'muted' : ''} ${isToday ? 'today' : ''}">
      <div class="cal__daynum">${date.getDate()}</div>${cards}
    </div>`;
}

function escapeHtml(s){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.getElementById('prevMonth').addEventListener('click', () => {
  currentView = new Date(currentView.getFullYear(), currentView.getMonth() - 1, 1);
  loadMonth();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  currentView = new Date(currentView.getFullYear(), currentView.getMonth() + 1, 1);
  loadMonth();
});
document.getElementById('todayBtn').addEventListener('click', () => {
  currentView = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  loadMonth();
});
document.getElementById('refreshBtn').addEventListener('click', loadMonth);
document.getElementById('saveBtn').addEventListener('click', () => {
  alert('As alterações de data são salvas individualmente ao confirmar no card da OC.');
});

// ── Modal de reagendamento ────────────────────────────────
function openOrderModal(id){
  const all = Object.values(ordersByDay).flat();
  activeOrder = all.find(o => o.id === id);
  if (!activeOrder) return;
  document.getElementById('omId').textContent = activeOrder.id;
  document.getElementById('omSupplier').textContent = activeOrder.supplier || '';
  document.getElementById('omNewDate').value = activeOrder.deliveryDate;
  document.getElementById('omObs').value = '';
  document.getElementById('orderModal').style.display = 'flex';
}
document.getElementById('closeOrderModal').addEventListener('click', () => {
  document.getElementById('orderModal').style.display = 'none';
});
document.getElementById('omCancel').addEventListener('click', () => {
  document.getElementById('orderModal').style.display = 'none';
});
document.getElementById('omConfirm').addEventListener('click', async () => {
  if (!activeOrder) return;
  const newDate = document.getElementById('omNewDate').value;
  const obs = document.getElementById('omObs').value;
  if (!newDate) return;

  const r = await fetch('/api/orders/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changes: [{
        orderId: activeOrder.id,
        emp: activeOrder.emp,
        fil: activeOrder.fil,
        oldDate: activeOrder.deliveryDate,
        newDate: newDate,
        chaveNfe: activeOrder.numNfc || '',
        observacao: obs,
      }],
    }),
  });
  const data = await r.json();
  document.getElementById('orderModal').style.display = 'none';

  const statusMsg = document.getElementById('statusMsg');
  statusMsg.style.display = 'inline-flex';
  if (data.summary && data.summary.ok > 0){
    statusMsg.className = 'chip chip--success';
    statusMsg.textContent = 'Alteração salva.';
    loadMonth();
  } else {
    statusMsg.className = 'chip chip--error';
    statusMsg.textContent = (data.results && data.results[0] && data.results[0].error) || 'Erro ao salvar.';
  }
});

// ── Debug ─────────────────────────────────────────────────
document.getElementById('navDebug').addEventListener('click', async () => {
  document.getElementById('debugModal').style.display = 'flex';
  document.getElementById('debugContent').textContent = 'Carregando...';
  const r = await fetch('/api/debug');
  const data = await r.json();
  document.getElementById('debugContent').textContent = JSON.stringify(data, null, 2);
});
document.getElementById('closeDebug').addEventListener('click', () => {
  document.getElementById('debugModal').style.display = 'none';
});

checkSession();
