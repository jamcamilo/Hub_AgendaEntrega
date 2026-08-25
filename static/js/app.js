// ═══════════════════════════════════════════════════════════════════
// FreightBoard — Client-side logic (Flask version)
// ═══════════════════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────────────────
let orders         = [];
let filteredOrders = [];  // orders after filters applied
let currentDate    = new Date();
let draggingOrder  = null;
let pendingChanges = {};  // { orderId: { orderId, oldDate, newDate } }

const DAYS   = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ── Filters ───────────────────────────────────────────────────────
const SIT_LABELS = { '1': '1 - Aberta', '2': '2 - Em andamento', '4': '4 - Concluída' };

function populateFilters() {
  const tipMers = [...new Set(orders.map(o => o.tipMer || '').filter(Boolean))].sort();
  const desOris = [...new Set(orders.map(o => o.desOri || '').filter(Boolean))].sort();
  const sitIpos = [...new Set(orders.map(o => o.sitIpo || '').filter(Boolean))].sort();
  const nomUsus = [...new Set(orders.map(o => o.nomUsu || '').filter(Boolean))].sort();
  const fils    = [...new Set(orders.map(o => o.fil    || '').filter(Boolean))].sort();
  const codDeps = [...new Set(orders.map(o => o.codDep || '').filter(Boolean))].sort();

  const selTip = document.getElementById('filter-tipmer');
  const selDes = document.getElementById('filter-desori');
  const selSit = document.getElementById('filter-sitipo');
  const selUsu = document.getElementById('filter-nomusu');
  const selFil = document.getElementById('filter-fil');
  const selDep = document.getElementById('filter-coddep');
  const curTip = selTip.value, curDes = selDes.value, curSit = selSit.value;
  const curUsu = selUsu.value, curFil = selFil.value, curDep = selDep.value;

  selTip.innerHTML = '<option value="">Tipo Mercadoria</option>'
    + tipMers.map(v => `<option value="${esc(v)}" ${v===curTip?'selected':''}>${esc(v)}</option>`).join('');
  selDes.innerHTML = '<option value="">Origem</option>'
    + desOris.map(v => `<option value="${esc(v)}" ${v===curDes?'selected':''}>${esc(v)}</option>`).join('');
  selSit.innerHTML = '<option value="">Situação</option>'
    + sitIpos.map(v => `<option value="${esc(v)}" ${v===curSit?'selected':''}>${esc(SIT_LABELS[v]||v)}</option>`).join('');
  selUsu.innerHTML = '<option value="">Usuário</option>'
    + nomUsus.map(v => `<option value="${esc(v)}" ${v===curUsu?'selected':''}>${esc(v)}</option>`).join('');
  selFil.innerHTML = '<option value="">Filial</option>'
    + fils.map(v => `<option value="${esc(v)}" ${v===curFil?'selected':''}>${esc(v)}</option>`).join('');
  selDep.innerHTML = '<option value="">Depósito</option>'
    + codDeps.map(v => `<option value="${esc(v)}" ${v===curDep?'selected':''}>${esc(v)}</option>`).join('');

  [selTip,selDes,selSit,selUsu,selFil,selDep].forEach(s =>
    s.className = 'sb-select' + (s.value ? ' sb-select-active' : ''));
}

function applyFilters() {
  const tipMer = document.getElementById('filter-tipmer').value;
  const desOri = document.getElementById('filter-desori').value;
  const sitIpo = document.getElementById('filter-sitipo').value;
  const nomUsu = document.getElementById('filter-nomusu').value;
  const fil    = document.getElementById('filter-fil').value;
  const codDep = document.getElementById('filter-coddep').value;

  [document.getElementById('filter-tipmer'),
   document.getElementById('filter-desori'),
   document.getElementById('filter-sitipo'),
   document.getElementById('filter-nomusu'),
   document.getElementById('filter-fil'),
   document.getElementById('filter-coddep')].forEach(s =>
    s.className = 'sb-select' + (s.value ? ' sb-select-active' : ''));

  filteredOrders = orders.filter(o =>
    (!tipMer || o.tipMer === tipMer) &&
    (!desOri || o.desOri === desOri) &&
    (!sitIpo || o.sitIpo === sitIpo) &&
    (!nomUsu || o.nomUsu === nomUsu) &&
    (!fil    || o.fil    === fil) &&
    (!codDep || o.codDep === codDep)
  );

  renderSidebar();
  renderCalendar();
  renderPending();
  if (currentView === 'docks') renderDocks();
}

// ── API Calls ─────────────────────────────────────────────────────
async function loadOrders() {
  showToast('Carregando ordens...', 'info', 1500);

  // Calcula primeiro e último dia do mês exibido
  const y = currentDate.getFullYear();
  const m = currentDate.getMonth();
  const datIni = fmtDate(new Date(y, m, 1));
  const datFim = fmtDate(new Date(y, m + 1, 0)); // último dia do mês

  try {
    const res = await fetch(`/api/orders?datIni=${datIni}&datFim=${datFim}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    orders = await res.json();
    if (orders.error) throw new Error(orders.error);
    pendingChanges = {};
    showToast(`${orders.length} ordens · ${MONTHS[m]} ${y}`, 'success');

    // Auto-popula dockAssignments a partir dos dados do ERP
    dockAssignments = {};
    orders.forEach(o => {
      if (o.itens && o.itens.length) {
        // Usa numDoc/horDes do primeiro item que tiver doca atribuída
        const itemComDoca = o.itens.find(it => it.numDoc && it.numDoc !== '0');
        if (itemComDoca) {
          dockAssignments[o.id] = {
            dock: parseInt(itemComDoca.numDoc) || 1,
            time: itemComDoca.horDesHM || '08:00',
          };
        }
      }
    });
  } catch (e) {
    showToast(`Falha: ${e.message}`, 'error');
  }
  populateFilters();
  applyFilters();
}

async function saveAllChanges() {
  // Valida distribuição de itens antes de salvar
  // Auto-preenche splits padrão para ordens que não tiveram itens editados manualmente
  const invalidOrders = [];
  for (const pc of Object.values(pendingChanges)) {
    const order = orders.find(o => o.id === pc.orderId);
    if (!order || !order.itens || !order.itens.length) continue; // sem itens = ok, pula validação

    for (const item of order.itens) {
      const key = `${pc.orderId}_${item.codPro}`;
      if (!itemsSplits[key] || !itemsSplits[key].length) {
        // Auto-preenche com distribuição original (toda qtd na data atual da OC)
        itemsSplits[key] = [{ date: order.deliveryDate, qty: item.qtdAbe }];
      }
      const splits = itemsSplits[key];
      const total = splits.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
      if (Math.abs(total - item.qtdAbe) > 0.01) {
        invalidOrders.push({ id: pc.orderId, codPro: item.codPro, reason: `${total}/${item.qtdAbe}` });
      }
    }
  }

  if (invalidOrders.length > 0) {
    const ids = [...new Set(invalidOrders.map(o => o.id))];
    showToast(`Distribua toda a quantidade dos itens antes de salvar. OC(s): ${ids.join(', ')}`, 'error', 5000);
    return;
  }

  const changes = Object.values(pendingChanges).map(pc => {
    const order = orders.find(o => o.id === pc.orderId);

    // Coleta splits do itemsSplits para montar distOC
    const distOC = [];
    const dockInfo = dockAssignments[pc.orderId]; // { dock, time }

    if (order && order.itens && order.itens.length) {
      console.log(`[SAVE] OC ${pc.orderId}: ${order.itens.length} itens encontrados, doca=${dockInfo?.dock || '-'} hora=${dockInfo?.time || '-'}`);
      order.itens.forEach((item, idx) => {
        const key = `${pc.orderId}_${item.codPro}`;
        const splits = itemsSplits[key];
        console.log(`  [SAVE] Item ${item.codPro} key=${key} splits=`, splits);
        if (splits && splits.length > 0) {
          splits.forEach((s, splitIdx) => {
            distOC.push({
              codEmp: item.codEmp || order.emp || '',
              codFil: item.codFil || order.fil || '',
              datPrg: s.date,
              numOcp: item.numOcp || pc.orderId,
              qtdDis: s.qty,
              seqIpo: String(idx + 1),
              seqDis: String(splitIdx + 1),
              numDoc: dockInfo ? String(dockInfo.dock) : '',
              horDes: dockInfo ? dockInfo.time : '',
            });
          });
        }
      });
    } else if (dockInfo) {
      // Sem itensOC mas com doca atribuída — gera linha com dados da OC
      console.log(`[SAVE] OC ${pc.orderId}: sem itens, gerando distOC pela doca ${dockInfo.dock} ${dockInfo.time}`);
      distOC.push({
        codEmp: order?.emp || '',
        codFil: order?.fil || '',
        datPrg: order?.deliveryDate || pc.newDate,
        numOcp: pc.orderId,
        qtdDis: 0,
        seqIpo: '1',
        seqDis: '1',
        numDoc: String(dockInfo.dock),
        horDes: dockInfo.time,
      });
    } else {
      console.log(`[SAVE] OC ${pc.orderId}: sem itens e sem doca`, order?.itens);
    }
    console.log(`[SAVE] OC ${pc.orderId}: distOC final com ${distOC.length} linhas`, distOC);

    return {
      orderId:    pc.orderId,
      emp:        order?.emp || '',
      fil:        order?.fil || '',
      oldDate:    pc.oldDate,
      newDate:    pc.newDate,
      chaveNfe:   pc.chaveNfe || '',
      observacao: pc.observacao || '',
      distOC:     distOC,
    };
  });
  if (!changes.length) return;

  const btn = document.getElementById('save-btn');
  btn.disabled = true;
  btn.innerHTML = '⏳ Salvando...';

  try {
    const res = await fetch('/api/orders/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes }),
    });
    const data = await res.json();

    // Remove as que deram certo
    (data.results || []).forEach(r => {
      if (r.ok) delete pendingChanges[r.orderId];
    });

    if (data.summary.ok > 0)
      showToast(`${data.summary.ok} ordem(s) atualizada(s)!`, 'success');
    if (data.summary.failed > 0)
      showToast(`${data.summary.failed} ordem(s) falharam. Verifique o Debug.`, 'error');
  } catch (e) {
    showToast(`Erro ao salvar: ${e.message}`, 'error');
  }

  btn.disabled = false;

  // Limpa splits das OCs salvas e recarrega dados do mês atual
  Object.keys(itemsSplits).forEach(k => {
    const oid = k.split('_')[0];
    if (!pendingChanges[oid]) delete itemsSplits[k];
  });
  await loadOrders();
}

function discardAllChanges() {
  for (const pc of Object.values(pendingChanges)) {
    const o = orders.find(x => x.id === pc.orderId);
    if (o) o.deliveryDate = pc.oldDate;
  }
  const count = Object.keys(pendingChanges).length;
  pendingChanges = {};
  showToast(`${count} alteração(ões) descartada(s).`, 'info');
  renderSidebar();
  renderCalendar();
  renderPending();
}

function undoChange(orderId) {
  const pc = pendingChanges[orderId];
  if (!pc) return;
  const o = orders.find(x => x.id === orderId);
  if (o && pc.oldDate !== pc.newDate) o.deliveryDate = pc.oldDate;
  delete pendingChanges[orderId];
  // Limpa splits desta OC
  Object.keys(itemsSplits).forEach(k => {
    if (k.startsWith(orderId + '_')) delete itemsSplits[k];
  });
  showToast(`OC ${orderId} restaurada.`, 'info');
  renderSidebar();
  renderCalendar();
  renderPending();
}

function trackChange(orderId, oldDate, newDate, chaveNfe, observacao) {
  const existing = pendingChanges[orderId];
  if (existing) {
    if (existing.oldDate === newDate) {
      // Voltou à data original — mas mantém se tem distribuição
      if (existing.hasDistribution) {
        pendingChanges[orderId] = { ...existing, newDate, chaveNfe: chaveNfe || existing.chaveNfe, observacao: observacao || existing.observacao };
      } else {
        delete pendingChanges[orderId];
      }
    } else {
      pendingChanges[orderId] = {
        orderId,
        oldDate: existing.oldDate,
        newDate,
        chaveNfe: chaveNfe || existing.chaveNfe || '',
        observacao: observacao || existing.observacao || '',
        hasDistribution: existing.hasDistribution || false,
      };
    }
  } else {
    pendingChanges[orderId] = { orderId, oldDate, newDate, chaveNfe: chaveNfe || '', observacao: observacao || '', hasDistribution: false };
  }
  renderPending();
}

// ── Move Confirmation Modal ────────────────────────────────────────
// Todas as movimentações passam por aqui para coletar chaveNfe e observação
let pendingMove = null; // { orderId, oldDate, newDate, callback }

function openMoveModal(orderId, oldDate, newDate, callback) {
  const order = orders.find(o => o.id === orderId);
  pendingMove = { orderId, oldDate, newDate, callback };

  const modal = document.getElementById('move-modal');
  document.getElementById('move-modal-info').innerHTML = `
    <strong># ${orderId}</strong> · ${order?.supplier || ''}
    <div style="margin-top:4px;font-size:11px;color:var(--text-muted);">
      ${formatDisplay(oldDate)} → <strong style="color:var(--accent3)">${formatDisplay(newDate)}</strong>
    </div>`;
  document.getElementById('move-chave').value = '';
  document.getElementById('move-obs').value = '';
  document.getElementById('move-chave-error').style.display = 'none';
  modal.classList.add('open');
  setTimeout(() => document.getElementById('move-chave').focus(), 100);
}

function closeMoveModal() {
  document.getElementById('move-modal').classList.remove('open');
  pendingMove = null;
}

function confirmMove() {
  if (!pendingMove) return;

  const chaveNfe  = document.getElementById('move-chave').value.trim();
  const observacao = document.getElementById('move-obs').value.trim();
  const errEl     = document.getElementById('move-chave-error');

  // Validar chave NFe: se preenchida, deve ter 44 caracteres numéricos
  if (chaveNfe && (chaveNfe.length !== 44 || !/^\d{44}$/.test(chaveNfe))) {
    errEl.textContent = 'Chave NFe deve ter exatamente 44 dígitos numéricos.';
    errEl.style.display = '';
    return;
  }
  errEl.style.display = 'none';

  const { orderId, oldDate, newDate, callback } = pendingMove;
  closeMoveModal();

  trackChange(orderId, oldDate, newDate, chaveNfe, observacao);
  if (callback) callback();
}

document.getElementById('move-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeMoveModal();
});

// ── Pending panel ─────────────────────────────────────────────────
function renderPending() {
  const panel   = document.getElementById('pending-panel');
  const saveBar = document.getElementById('save-bar');
  const list    = Object.values(pendingChanges);

  if (!list.length) {
    panel.style.display   = 'none';
    saveBar.style.display = 'none';
    return;
  }

  panel.style.display   = '';
  saveBar.style.display = '';

  document.getElementById('save-btn').innerHTML =
    `💾 Salvar ${list.length} alteraç${list.length === 1 ? 'ão' : 'ões'}`;

  panel.innerHTML = `
    <div class="pending-header">✏️ ${list.length} alteraç${list.length === 1 ? 'ão pendente' : 'ões pendentes'}</div>
    ${list.map(pc => {
      const dateChanged = pc.oldDate !== pc.newDate;
      return `
      <div class="pending-item">
        <span class="pending-id">#${pc.orderId}</span>
        ${dateChanged
          ? `<span class="pending-from">${formatDisplay(pc.oldDate)}</span>
             <span class="pending-arrow">→</span>
             <span class="pending-to">${formatDisplay(pc.newDate)}</span>`
          : `<span class="pending-dist">📦 Distribuição</span>`
        }
        ${pc.chaveNfe ? '<span class="pending-nfe" title="'+esc(pc.chaveNfe)+'">📄</span>' : ''}
        ${pc.observacao ? '<span class="pending-obs" title="'+esc(pc.observacao)+'">💬</span>' : ''}
        ${pc.hasDistribution ? '<span class="pending-nfe" title="Distribuição de itens">📦</span>' : ''}
        ${pc.hasDock ? '<span class="pending-nfe" title="Doca atribuída">🏭</span>' : ''}
        <button class="pending-undo" onclick="undoChange('${pc.orderId}')" title="Desfazer">↩</button>
      </div>`;
    }).join('')}
  `;
}

// ── Sidebar ───────────────────────────────────────────────────────
function renderSidebar() {
  const list   = document.getElementById('orders-list');
  const filter = document.getElementById('sidebar-search')?.value.toLowerCase() || '';
  const filtered = filteredOrders.filter(o =>
    o.id.toLowerCase().includes(filter) ||
    o.supplier.toLowerCase().includes(filter) ||
    o.product.toLowerCase().includes(filter)
  );
  document.getElementById('order-count').textContent = filteredOrders.length;

  if (!filtered.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-faint);font-size:13px;">Nenhuma ordem encontrada</div>';
    return;
  }

  list.innerHTML = filtered.map(o => {
    const ip = !!pendingChanges[o.id];
    const done = o.sitIpo === '4';
    const overdue = isOverdue(o);
    return `
    <div class="order-card ${ip ? 'order-card-pending' : ''} ${done ? 'order-card-done' : ''} ${overdue ? 'order-card-overdue' : ''}"
      ${done ? '' : 'draggable="true"'}
      data-id="${o.id}"
      ${done ? '' : `ondragstart="onDragStart(event,'${o.id}')" ondragend="onDragEnd(event)" oncontextmenu="openCtx(event,'${o.id}'); return false;"`}>
      <div class="order-card-header">
        <span class="order-id">${overdue ? '⚠️' : (done ? '✅' : (ip ? '✏️' : ''))} # ${o.id}</span>
        <span class="order-supplier" title="${o.supplier}">${o.supplier}</span>
        <span class="truck-mini">${done ? '✅' : '🚚'}</span>
      </div>
      <div class="order-products">${formatProducts(o.products || [o.product])}</div>
      <div class="order-meta">
        <span class="order-qty">🏢 E${o.emp||'-'} F${o.fil||'-'}</span>
        ${!done && o.itens && o.itens.length ? `<button class="sidebar-items-btn" onclick="event.stopPropagation();openItemsModal('${o.id}')">📦 Itens</button>` : ''}
        <span class="order-date-badge">${overdue ? '<span class="overdue-badge">⚠️ ATRASO</span> ' : ''}📅 ${formatDisplay(o.deliveryDate)}</span>
      </div>
      ${o.nomUsu ? `<div class="order-user">👤 ${esc(o.nomUsu)}</div>` : ''}
      ${done && o.numNfc && o.numNfc !== '0' ? `<div class="order-nfc">📄 NF: ${esc(o.numNfc)}</div>` : ''}
    </div>`;
  }).join('');
}

// ── Calendar ──────────────────────────────────────────────────────
function renderCalendar() {
  const y = currentDate.getFullYear(), m = currentDate.getMonth();
  document.getElementById('cal-title').textContent = `${MONTHS[m]} ${y}`;
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  DAYS.forEach(d => {
    const h = document.createElement('div');
    h.className = 'day-header'; h.textContent = d;
    grid.appendChild(h);
  });

  const firstDow   = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysInPrev  = new Date(y, m, 0).getDate();
  const today       = fmtDate(new Date());

  for (let i = firstDow - 1; i >= 0; i--)
    grid.appendChild(makeCell(daysInPrev - i, fmtDate(new Date(y, m - 1, daysInPrev - i)), true, today));
  for (let d = 1; d <= daysInMonth; d++)
    grid.appendChild(makeCell(d, fmtDate(new Date(y, m, d)), false, today));
  const total = firstDow + daysInMonth;
  const fill  = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let d = 1; d <= fill; d++)
    grid.appendChild(makeCell(d, fmtDate(new Date(y, m + 1, d)), true, today));
}

function makeCell(day, dateStr, otherMonth, today) {
  const cell = document.createElement('div');
  cell.className = 'day-cell' + (otherMonth ? ' other-month' : '') + (dateStr === today ? ' today' : '');
  cell.dataset.date = dateStr;
  cell.ondragover  = e => { e.preventDefault(); cell.classList.add('drag-over'); };
  cell.ondragleave = () => cell.classList.remove('drag-over');
  cell.ondrop      = e => onDrop(e, dateStr);

  const num = document.createElement('div');
  num.className = 'day-num'; num.textContent = day;
  cell.appendChild(num);

  const dayOrders = filteredOrders.filter(o => o.deliveryDate === dateStr);
  const max = 2;

  dayOrders.slice(0, max).forEach(o => {
    const ip = !!pendingChanges[o.id];
    const done = o.sitIpo === '4';
    const overdue = isOverdue(o);
    const productTooltip = (o.products || [o.product]).join('\n');
    const truck = document.createElement('div');
    truck.className = 'cal-truck' + (ip ? ' cal-truck-pending' : '') + (done ? ' cal-truck-done' : '') + (overdue ? ' cal-truck-overdue' : '');
    truck.draggable = !done;
    truck.dataset.id = o.id;
    truck.innerHTML = `
      <span class="truck-emoji">${overdue ? '⚠️' : (done ? '✅' : '🚚')}</span>
      <div class="truck-info">
        <div class="truck-id">#${o.id} ${ip ? '●' : ''}</div>
        <div class="truck-name">${esc(o.supplier)}</div>
        ${done && o.numNfc && o.numNfc !== '0' ? `<div class="truck-nfc">NF: ${esc(o.numNfc)}</div>` : ''}
        ${!done && dockAssignments[o.id] ? `<div class="truck-dock-badge">🏭 D${dockAssignments[o.id].dock} · ${dockAssignments[o.id].time || '--:--'}</div>` : ''}
      </div>
      <div class="truck-btns">
        ${!done && o.itens && o.itens.length ? `<button class="truck-items-btn" onclick="event.stopPropagation();openItemsModal('${o.id}')" title="Ver itens">📦</button>` : ''}
        ${!done ? `<button class="truck-dock-btn" onclick="event.stopPropagation();openDockAssign(event,'${o.id}')" title="Atribuir doca">🏭</button>` : ''}
      </div>
      <div class="truck-tooltip">${(o.products || [o.product]).map(p => '<div class="tt-line">' + esc(p) + '</div>').join('')}${done && o.numNfc && o.numNfc !== '0' ? '<div class="tt-line" style="border-color:var(--accent3);font-weight:600;">📄 NF: '+esc(o.numNfc)+'</div>' : ''}${overdue ? '<div class="tt-line" style="border-color:var(--accent2);font-weight:700;color:var(--accent2);">⚠️ ENTREGA EM ATRASO</div>' : ''}</div>`;
    if (!done) {
      truck.ondragstart    = e => onDragStart(e, o.id);
      truck.ondragend      = e => onDragEnd(e);
      truck.oncontextmenu  = e => { e.preventDefault(); openCtx(e, o.id); return false; };
    } else {
      truck.oncontextmenu  = e => { e.preventDefault(); return false; };
    }
    truck.onclick = e => { e.stopPropagation(); };
    cell.appendChild(truck);
  });

  if (dayOrders.length > max) {
    const more = document.createElement('div');
    more.className = 'more-badge';
    more.textContent = `+${dayOrders.length - max} ordens`;
    more.onclick = e => { e.stopPropagation(); openDayModal(dateStr, dayOrders); };
    cell.appendChild(more);
  }

  return cell;
}

// ── Drag & Drop ───────────────────────────────────────────────────
function onDragStart(e, orderId) {
  draggingOrder = orders.find(o => o.id === orderId);
  if (!draggingOrder) return;
  e.dataTransfer.setData('orderId', orderId);
  e.dataTransfer.effectAllowed = 'move';

  const blank = document.createElement('canvas');
  blank.width = 1; blank.height = 1;
  e.dataTransfer.setDragImage(blank, 0, 0);

  const ghost = document.getElementById('drag-ghost');
  document.getElementById('ghost-id').textContent   = draggingOrder.id;
  document.getElementById('ghost-name').textContent  = draggingOrder.supplier;
  ghost.style.display = 'flex';
  ghost.style.left = (e.clientX + 12) + 'px';
  ghost.style.top  = (e.clientY - 30) + 'px';

  document.querySelector('.sidebar').classList.add('drag-active');
  setTimeout(() => {
    document.querySelectorAll(`[data-id="${orderId}"]`).forEach(el => el.classList.add('dragging'));
  }, 0);
}

function onDragEnd(e) {
  document.getElementById('drag-ghost').style.display = 'none';
  document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  document.querySelector('.sidebar').classList.remove('drag-active');
  draggingOrder = null;
}

function onDrop(e, newDate) {
  e.preventDefault();
  document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

  const orderId = e.dataTransfer.getData('orderId');
  const order = orders.find(o => o.id === orderId);
  if (!order || order.deliveryDate === newDate) return;

  const oldDate = order.deliveryDate;
  openMoveModal(orderId, oldDate, newDate, () => {
    order.deliveryDate = newDate;
    showToast(`OC ${order.id} → ${formatDisplay(newDate)} (pendente)`, 'info');
    renderSidebar();
    renderCalendar();
  });
}

document.addEventListener('dragover', e => {
  const g = document.getElementById('drag-ghost');
  if (g.style.display !== 'none') {
    g.style.left = (e.clientX + 14) + 'px';
    g.style.top  = (e.clientY - 28) + 'px';
  }
});

// ── Mouse drag (modal) ────────────────────────────────────────────
let mouseDragging = false, mouseDragOrder = null, lastHoveredCell = null;

function startMouseDrag(e, orderId) {
  if (e.button !== 0) return;
  e.preventDefault();
  mouseDragging  = true;
  mouseDragOrder = orders.find(o => o.id === orderId);
  if (!mouseDragOrder) return;

  const ghost = document.getElementById('drag-ghost');
  document.getElementById('ghost-id').textContent   = mouseDragOrder.id;
  document.getElementById('ghost-name').textContent  = mouseDragOrder.supplier;
  ghost.style.display = 'flex';
  ghost.style.left = (e.clientX + 14) + 'px';
  ghost.style.top  = (e.clientY - 28) + 'px';

  const modal = document.getElementById('day-modal');
  modal.style.opacity       = '0';
  modal.style.pointerEvents = 'none';
  modal.style.transition    = 'opacity 0.15s ease';
  document.querySelector('.sidebar').classList.add('drag-active');
}

document.addEventListener('mousemove', e => {
  if (!mouseDragging) return;
  const g = document.getElementById('drag-ghost');
  g.style.left = (e.clientX + 14) + 'px';
  g.style.top  = (e.clientY - 28) + 'px';
  const el   = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest('.day-cell');
  if (lastHoveredCell && lastHoveredCell !== cell) lastHoveredCell.classList.remove('drag-over');
  if (cell) { cell.classList.add('drag-over'); lastHoveredCell = cell; }
});

document.addEventListener('mouseup', e => {
  if (!mouseDragging) return;
  document.getElementById('drag-ghost').style.display = 'none';
  if (lastHoveredCell) lastHoveredCell.classList.remove('drag-over');
  document.querySelector('.sidebar').classList.remove('drag-active');

  const modal   = document.getElementById('day-modal');
  const order   = mouseDragOrder;
  const cell    = lastHoveredCell;
  const newDate = cell?.dataset?.date;
  mouseDragging = false; mouseDragOrder = null; lastHoveredCell = null;

  if (!order || !newDate || newDate === order.deliveryDate) {
    modal.style.opacity = ''; modal.style.pointerEvents = '';
    return;
  }

  const oldDate = order.deliveryDate;
  modal.style.opacity = ''; modal.style.pointerEvents = '';
  closeDayModal();
  openMoveModal(order.id, oldDate, newDate, () => {
    order.deliveryDate = newDate;
    showToast(`OC ${order.id} → ${formatDisplay(newDate)} (pendente)`, 'info');
    renderSidebar();
    renderCalendar();
  });
});

// ── Day Modal ─────────────────────────────────────────────────────
function openDayModal(dateStr, dayOrders) {
  document.getElementById('day-modal-title').textContent =
    `🚚 ${dayOrders.length} ordens · ${formatDisplay(dateStr)}`;
  const list = document.getElementById('day-modal-list');
  list.innerHTML = dayOrders.map(o => {
    const ip = !!pendingChanges[o.id];
    const done = o.sitIpo === '4';
    const overdue = isOverdue(o);
    return `
    <div class="order-card ${ip ? 'order-card-pending' : ''} ${done ? 'order-card-done' : ''} ${overdue ? 'order-card-overdue' : ''}"
         ${done ? '' : `onmousedown="startMouseDrag(event,'${o.id}')" oncontextmenu="openCtx(event,'${o.id}'); return false;"`}>
      <div class="order-card-header">
        <span class="order-id">${overdue ? '⚠️' : (done ? '✅' : (ip ? '✏️' : ''))} # ${o.id}</span>
        <span class="order-supplier">${o.supplier}</span>
        <span class="truck-mini">${done ? '✅' : '🚚'}</span>
      </div>
      <div class="order-products">${formatProducts(o.products || [o.product])}</div>
      <div class="order-meta">
        <span class="order-qty">🏢 E${o.emp||'-'} F${o.fil||'-'}</span>
        <span class="order-date-badge">${overdue ? '<span class="overdue-badge">⚠️ ATRASO</span> ' : ''}📅 ${formatDisplay(o.deliveryDate)}</span>
      </div>
      ${o.nomUsu ? `<div class="order-user">👤 ${esc(o.nomUsu)}</div>` : ''}
      ${done && o.numNfc && o.numNfc !== '0' ? `<div class="order-nfc">📄 NF: ${esc(o.numNfc)}</div>` : ''}
    </div>`;
  }).join('');
  document.getElementById('day-modal').classList.add('open');
}

function closeDayModal() {
  document.getElementById('day-modal').classList.remove('open');
}
document.getElementById('day-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeDayModal();
});

// ── Items Modal (itensOC - quebra de quantidades) ─────────────────
let itemsSplits = {}; // { orderId_codPro: [{ date, qty }] }
let itemsModalOrderId = null; // OC aberta no modal

function openItemsModal(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order || !order.itens || !order.itens.length) {
    showToast('Esta OC não possui itens detalhados.', 'info');
    return;
  }

  itemsModalOrderId = orderId;

  document.getElementById('items-modal-title').textContent =
    `📦 Itens · OC #${order.id} · ${order.supplier}`;

  const body = document.getElementById('items-modal-body');
  body.innerHTML = order.itens.map((item, idx) => {
    const key = `${orderId}_${item.codPro}`;
    if (!itemsSplits[key]) {
      itemsSplits[key] = [{ date: order.deliveryDate, qty: item.qtdAbe }];
    }

    return `
    <div class="items-card">
      <div class="items-header">
        <span class="items-code">${esc(item.codPro)}</span>
        <span class="items-qty-badge">Pedido: ${item.qtdPed} · Aberto: ${item.qtdAbe}</span>
      </div>
      <div class="items-desc">${esc(item.desPro)}</div>
      <div class="items-splits" id="splits-${esc(key)}">
        <div class="items-splits-header">
          <span>Quebra por data de entrega:</span>
          <button class="items-add-btn" onclick="addSplit('${esc(key)}', '${order.deliveryDate}', ${item.qtdAbe})">+ Adicionar data</button>
        </div>
        ${renderSplits(key, item.qtdAbe)}
      </div>
    </div>`;
  }).join('');

  document.getElementById('items-modal').classList.add('open');
}

function saveItemsDistribution() {
  if (!itemsModalOrderId) return;
  const order = orders.find(o => o.id === itemsModalOrderId);
  if (!order) return;

  // Verifica se todas as quantidades estão corretas
  let valid = true;
  (order.itens || []).forEach(item => {
    const key = `${itemsModalOrderId}_${item.codPro}`;
    const splits = itemsSplits[key] || [];
    const total = splits.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
    if (Math.abs(total - item.qtdAbe) > 0.01) valid = false;
  });

  if (!valid) {
    showToast('Distribua toda a quantidade antes de salvar.', 'error');
    return;
  }

  // Cria/atualiza pendência com mesma data (sem mudança de data, só distribuição)
  const orderId = itemsModalOrderId;
  if (!pendingChanges[orderId]) {
    pendingChanges[orderId] = {
      orderId,
      oldDate: order.deliveryDate,
      newDate: order.deliveryDate,
      chaveNfe: '',
      observacao: '',
      hasDistribution: true,
    };
  } else {
    pendingChanges[orderId].hasDistribution = true;
  }

  renderPending();
  renderSidebar();
  renderCalendar();
  closeItemsModal();
  showToast(`Distribuição da OC #${orderId} marcada para gravar.`, 'success');
}

function renderSplits(key, qtdAbe) {
  const splits = itemsSplits[key] || [];
  const totalSplit = splits.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
  const remaining = qtdAbe - totalSplit;

  return `
    <table class="items-table">
      <thead><tr><th>Data entrega</th><th>Quantidade</th><th></th></tr></thead>
      <tbody>
        ${splits.map((s, i) => `
          <tr>
            <td><input type="date" class="items-input" value="${s.date}" onchange="updateSplit('${key}',${i},'date',this.value,${qtdAbe})" /></td>
            <td><input type="number" class="items-input items-input-qty" value="${s.qty}" min="0" max="${qtdAbe}" step="1" onchange="updateSplit('${key}',${i},'qty',this.value,${qtdAbe})" /></td>
            <td>${splits.length > 1 ? `<button class="items-remove-btn" onclick="removeSplit('${key}',${i},${qtdAbe})">✕</button>` : ''}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr>
          <td style="text-align:right;font-weight:600;">Total:</td>
          <td class="${Math.abs(remaining) > 0.01 ? 'items-warn' : 'items-ok'}">${totalSplit} / ${qtdAbe} ${Math.abs(remaining) > 0.01 ? `(resta ${remaining.toFixed(1)})` : '✓'}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>`;
}

function updateSplit(key, idx, field, value, qtdAbe) {
  if (field === 'qty') {
    value = parseFloat(value) || 0;
    if (value < 0) value = 0;
    // Calcula quanto já foi usado nas OUTRAS linhas
    const otherTotal = itemsSplits[key].reduce((s, r, i) => i === idx ? s : s + (parseFloat(r.qty) || 0), 0);
    const maxAllowed = Math.max(0, qtdAbe - otherTotal);
    if (value > maxAllowed) value = maxAllowed;
  }
  itemsSplits[key][idx][field] = value;
  document.getElementById('splits-' + key).innerHTML =
    `<div class="items-splits-header"><span>Quebra por data de entrega:</span><button class="items-add-btn" onclick="addSplit('${key}','${itemsSplits[key][0]?.date||''}',${qtdAbe})">+ Adicionar data</button></div>` +
    renderSplits(key, qtdAbe);
}

function addSplit(key, defaultDate, qtdAbe) {
  const splits = itemsSplits[key];
  const used = splits.reduce((s, r) => s + (parseFloat(r.qty) || 0), 0);
  const remaining = Math.max(0, qtdAbe - used);
  if (remaining <= 0) {
    showToast('Toda a quantidade já foi distribuída.', 'info');
    return;
  }
  splits.push({ date: defaultDate, qty: remaining });
  document.getElementById('splits-' + key).innerHTML =
    `<div class="items-splits-header"><span>Quebra por data de entrega:</span><button class="items-add-btn" onclick="addSplit('${key}','${defaultDate}',${qtdAbe})">+ Adicionar data</button></div>` +
    renderSplits(key, qtdAbe);
}

function removeSplit(key, idx, qtdAbe) {
  itemsSplits[key].splice(idx, 1);
  document.getElementById('splits-' + key).innerHTML =
    `<div class="items-splits-header"><span>Quebra por data de entrega:</span><button class="items-add-btn" onclick="addSplit('${key}','${itemsSplits[key][0]?.date||''}',${qtdAbe})">+ Adicionar data</button></div>` +
    renderSplits(key, qtdAbe);
}

function closeItemsModal() {
  document.getElementById('items-modal').classList.remove('open');
}
document.getElementById('items-modal')?.addEventListener('click', function(e) {
  if (e.target === this) closeItemsModal();
});

// ── Context Menu Datepicker ───────────────────────────────────────
function openCtx(e, orderId) {
  e.preventDefault(); e.stopPropagation();
  closeCtx();
  const order = orders.find(o => o.id === orderId);
  if (!order) return;

  const menu = document.createElement('div');
  menu.className = 'ctx-datepicker'; menu.id = 'ctx-datepicker';
  menu.innerHTML = `
    <div class="ctx-title">📅 Alterar data de entrega</div>
    <div class="ctx-order-info">
      <strong># ${order.id}</strong>
      <span class="ctx-supplier">${order.supplier}</span>
      <div class="ctx-current">Atual: ${formatDisplay(order.deliveryDate)}</div>
    </div>
    <input type="date" class="ctx-date-input" id="ctx-date-value" value="${order.deliveryDate}" />
    <div style="margin-bottom:8px;">
      <label class="login-label" style="margin-bottom:4px;">Chave NFe (44 dígitos) — opcional</label>
      <input class="login-input" id="ctx-chave" type="text" maxlength="44" placeholder="44 dígitos" style="font-size:11px;padding:7px 10px;font-family:'DM Mono',monospace;" />
    </div>
    <div style="margin-bottom:10px;">
      <label class="login-label" style="margin-bottom:4px;">Observação — opcional</label>
      <textarea class="login-input" id="ctx-obs" rows="2" placeholder="Motivo..." style="font-size:11px;padding:7px 10px;resize:vertical;"></textarea>
    </div>
    <div class="ctx-actions">
      <button class="ctx-btn ctx-btn-cancel" onclick="closeCtx()">Cancelar</button>
      <button class="ctx-btn ctx-btn-confirm" style="background:var(--accent3);" onclick="closeCtx();openItemsModal('${order.id}')">📦 Itens</button>
      <button class="ctx-btn ctx-btn-confirm" onclick="confirmCtx('${order.id}')">Mover caminhão</button>
    </div>`;
  document.body.appendChild(menu);

  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = menu.getBoundingClientRect();
  let x = e.clientX + 6, y = e.clientY + 6;
  if (x + rect.width  > vw - 10) x = e.clientX - rect.width  - 6;
  if (y + rect.height > vh - 10) y = e.clientY - rect.height - 6;
  menu.style.left = `${Math.max(10, x)}px`;
  menu.style.top  = `${Math.max(10, y)}px`;

  setTimeout(() => {
    const inp = document.getElementById('ctx-date-value');
    inp?.focus();
    try { inp?.showPicker?.(); } catch(_) {}
    document.addEventListener('click', ctxOutsideClick, { once: true });
    document.addEventListener('keydown', ctxEscHandler);
  }, 0);
}

function ctxOutsideClick(e) {
  const m = document.getElementById('ctx-datepicker');
  if (m && !m.contains(e.target)) closeCtx();
  else if (m) document.addEventListener('click', ctxOutsideClick, { once: true });
}
function ctxEscHandler(e) { if (e.key === 'Escape') closeCtx(); }
function closeCtx() {
  document.getElementById('ctx-datepicker')?.remove();
  document.removeEventListener('keydown', ctxEscHandler);
}

function confirmCtx(orderId) {
  const newDate    = document.getElementById('ctx-date-value')?.value;
  const chaveNfe   = document.getElementById('ctx-chave')?.value.trim() || '';
  const observacao = document.getElementById('ctx-obs')?.value.trim() || '';

  // Validar chave NFe se preenchida
  if (chaveNfe && (chaveNfe.length !== 44 || !/^\d{44}$/.test(chaveNfe))) {
    showToast('Chave NFe deve ter 44 dígitos numéricos.', 'error');
    return;
  }

  closeCtx();
  if (!newDate) return;
  const order = orders.find(o => o.id === orderId);
  if (!order || order.deliveryDate === newDate) return;

  const oldDate = order.deliveryDate;
  trackChange(order.id, oldDate, newDate, chaveNfe, observacao);
  order.deliveryDate = newDate;
  closeDayModal();
  showToast(`OC ${order.id} → ${formatDisplay(newDate)} (pendente)`, 'info');
  renderSidebar();
  renderCalendar();
}

// ── Debug Panel ───────────────────────────────────────────────────
async function openDebug() {
  try {
    const res  = await fetch('/api/debug');
    const data = await res.json();
    document.getElementById('dbg-request').textContent  = data.lastRequest  || '—';
    document.getElementById('dbg-response').textContent = data.lastResponse || '—';
    document.getElementById('dbg-error').textContent    = data.lastError    || '—';
    document.getElementById('dbg-status').textContent   =
      data.lastError ? `✕ ${data.lastError.substring(0,60)}` : `✓ HTTP ${data.lastStatus} · ${data.lastMs}ms`;
    document.getElementById('dbg-status').className     =
      `debug-status ${data.lastError ? 'err' : 'ok'}`;
  } catch (e) {
    document.getElementById('dbg-error').textContent = e.message;
  }
  document.getElementById('debug-overlay').classList.add('open');
}
function closeDebug() { document.getElementById('debug-overlay').classList.remove('open'); }
function switchDebugTab(tab, btn) {
  ['request','response','error'].forEach(t =>
    document.getElementById(`debug-tab-${t}`).style.display = t === tab ? '' : 'none');
  document.querySelectorAll('.debug-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── View Switching ────────────────────────────────────────────────
let currentView = 'calendar';

function switchView(view) {
  currentView = view;
  document.getElementById('view-calendar').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('view-docks').style.display    = view === 'docks'    ? '' : 'none';
  document.getElementById('tab-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('tab-docks').classList.toggle('active', view === 'docks');
  // Update header breadcrumb
  const title = document.getElementById('hd-page-title');
  if (title) title.textContent = view === 'calendar' ? 'Calendário' : 'Docas';
  if (view === 'docks') renderDocks();
}

function toggleOrdersPanel() {
  const panel = document.getElementById('sidebar');
  const shell = document.querySelector('.volt-shell');
  panel.classList.toggle('open');
  shell.classList.toggle('has-orders');
}

// ── Docks View (visualização diária com horários) ────────────────
const NUM_DOCKS = 4;
const DOCK_HOURS = ['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'];
let dockAssignments = {}; // { orderId: { dock: 1, time: "08:00" } }
let docksDate = null; // data exibida na aba docas

function renderDocks() {
  const container = document.getElementById('docks-container');
  if (!docksDate) docksDate = new Date();
  const dateStr = fmtDate(docksDate);
  const dayName = DAYS[docksDate.getDay()];
  const today   = fmtDate(new Date());
  const isToday = dateStr === today;

  // Ordens do dia selecionado
  const dayOrders = filteredOrders.filter(o => o.deliveryDate === dateStr);

  // Navegação do dia
  const navHtml = `
    <div class="docks-day-nav">
      <button class="nav-btn" onclick="docksPrevDay()">‹</button>
      <h2 class="docks-day-title ${isToday ? 'docks-today-title' : ''}">
        ${dayName} · ${docksDate.getDate()} de ${MONTHS[docksDate.getMonth()]} ${docksDate.getFullYear()}
        ${isToday ? '<span class="docks-today-badge">HOJE</span>' : ''}
      </h2>
      <button class="nav-btn" onclick="docksNextDay()">›</button>
      <button class="btn btn-ghost" onclick="docksGoToday()" style="margin-left:8px;">Hoje</button>
      <span class="docks-day-summary">${dayOrders.length} OC${dayOrders.length !== 1 ? 's' : ''} · ${countTotalQty(dayOrders)} un</span>
    </div>`;

  // Ordens sem doca atribuída neste dia
  const unassigned = dayOrders.filter(o => !dockAssignments[o.id]);
  const assigned   = dayOrders.filter(o => !!dockAssignments[o.id]);

  // Monta grid horários x docas
  let gridHtml = `
    <div class="docks-timeline">
      <div class="docks-tl-header">
        <div class="docks-tl-time-header">Horário</div>
        ${Array.from({length: NUM_DOCKS}, (_, i) => `<div class="docks-tl-dock-header">🏭 Doca ${i+1}</div>`).join('')}
      </div>
      ${DOCK_HOURS.map(hour => {
        return `<div class="docks-tl-row">
          <div class="docks-tl-time">${hour}</div>
          ${Array.from({length: NUM_DOCKS}, (_, i) => {
            const dockNum = i + 1;
            const cellOrders = assigned.filter(o => dockAssignments[o.id]?.dock === dockNum && dockAssignments[o.id]?.time === hour);
            return renderDockTimeCell(dockNum, hour, cellOrders, dateStr);
          }).join('')}
        </div>`;
      }).join('')}
    </div>`;

  // Painel de ordens não atribuídas
  let unassignedHtml = '';
  if (unassigned.length) {
    unassignedHtml = `
      <div class="docks-unassigned">
        <div class="docks-unassigned-title">📦 Sem doca atribuída (${unassigned.length})</div>
        <div class="docks-unassigned-list">
          ${unassigned.map(o => renderDockOrder(o)).join('')}
        </div>
      </div>`;
  }

  container.innerHTML = navHtml + unassignedHtml + gridHtml;
}

function renderDockTimeCell(dockNum, hour, orders, dateStr) {
  const totalQty = countTotalQty(orders);
  return `
    <div class="docks-tl-cell ${orders.length ? 'docks-tl-cell-filled' : ''}"
         ondragover="event.preventDefault();this.classList.add('docks-cell-hover')"
         ondragleave="this.classList.remove('docks-cell-hover')"
         ondrop="onDockTimeDrop(event,${dockNum},'${hour}','${dateStr}');this.classList.remove('docks-cell-hover')">
      ${orders.length ? `<div class="docks-volume">📦 ${totalQty.toLocaleString('pt-BR')} un</div>` : ''}
      ${orders.map(o => renderDockOrder(o)).join('')}
    </div>`;
}

function renderDockOrder(o) {
  const done = o.sitIpo === '4';
  const da   = dockAssignments[o.id];
  return `
    <div class="dock-order ${done ? 'dock-order-done' : ''}"
         draggable="${!done}"
         ondragstart="onDockDragStart(event,'${o.id}')"
         title="${esc(o.supplier + ' · ' + o.product)}">
      <div class="dock-order-top">
        <span class="dock-order-id">${done ? '✅' : '🚚'} #${o.id}</span>
        ${da ? `<span class="dock-order-time">🏭D${da.dock} ${da.time}</span>` : ''}
      </div>
      <span class="dock-order-supplier">${esc(o.supplier)}</span>
      ${(o.itens || []).map(it => `
        <div class="dock-item-row">
          <span class="dock-item-code">${esc(it.codPro)}</span>
          <span class="dock-item-qty">${it.qtdAbe} un</span>
        </div>
      `).join('')}
    </div>`;
}

function countTotalQty(orders) {
  return orders.reduce((s, o) => s + (o.itens || []).reduce((si, it) => si + (it.qtdAbe || 0), 0), 0);
}

// Navegação diária
function docksPrevDay() { docksDate.setDate(docksDate.getDate() - 1); renderDocks(); }
function docksNextDay() { docksDate.setDate(docksDate.getDate() + 1); renderDocks(); }
function docksGoToday() { docksDate = new Date(); renderDocks(); }

// Drag & drop na timeline
function onDockDragStart(e, orderId) {
  e.dataTransfer.setData('dockOrderId', orderId);
  e.dataTransfer.effectAllowed = 'move';
}

function onDockTimeDrop(e, dockNum, hour, dateStr) {
  e.preventDefault();
  const orderId = e.dataTransfer.getData('dockOrderId');
  if (!orderId) return;
  const order = orders.find(o => o.id === orderId);
  if (!order || order.sitIpo === '4') return;

  dockAssignments[orderId] = { dock: dockNum, time: hour };

  // Cria pendência
  if (!pendingChanges[orderId]) {
    pendingChanges[orderId] = {
      orderId,
      oldDate: order.deliveryDate,
      newDate: order.deliveryDate,
      chaveNfe: '',
      observacao: '',
      hasDistribution: true,
      hasDock: true,
    };
  } else {
    pendingChanges[orderId].hasDock = true;
    pendingChanges[orderId].hasDistribution = true;
  }

  showToast(`OC #${orderId} → Doca ${dockNum} · ${hour}`, 'success');
  renderPending();
  renderDocks();
  renderCalendar();
}

// ── Dock Assignment Popover (botão 🏭 no calendário) ─────────────
function openDockAssign(e, orderId) {
  e.preventDefault();
  e.stopPropagation();
  closeDockAssign();

  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  const current = dockAssignments[orderId];

  const pop = document.createElement('div');
  pop.className = 'dock-assign-pop';
  pop.id = 'dock-assign-pop';
  pop.innerHTML = `
    <div class="ctx-title">🏭 Atribuir Doca</div>
    <div class="ctx-order-info">
      <strong># ${order.id}</strong>
      <span class="ctx-supplier">${order.supplier}</span>
    </div>
    <div class="dock-assign-field">
      <label class="login-label">Doca</label>
      <div class="dock-assign-options">
        ${Array.from({length: NUM_DOCKS}, (_, i) => `
          <button class="dock-opt-btn ${current?.dock === i+1 ? 'dock-opt-active' : ''}"
                  onclick="selectDockOpt(this, ${i+1})">${i+1}</button>
        `).join('')}
      </div>
    </div>
    <div class="dock-assign-field">
      <label class="login-label">Horário</label>
      <input type="time" class="login-input" id="dock-time-input" value="${current?.time || '08:00'}" style="padding:8px 10px;" />
    </div>
    <div class="ctx-actions">
      <button class="ctx-btn ctx-btn-cancel" onclick="closeDockAssign()">Cancelar</button>
      ${current ? `<button class="ctx-btn" style="background:var(--danger);color:white;" onclick="removeDockAssign('${orderId}')">Remover</button>` : ''}
      <button class="ctx-btn ctx-btn-confirm" onclick="confirmDockAssign('${orderId}')">Confirmar</button>
    </div>`;

  document.body.appendChild(pop);

  // Posiciona
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = pop.getBoundingClientRect();
  let x = e.clientX + 6, y = e.clientY + 6;
  if (x + rect.width > vw - 10) x = e.clientX - rect.width - 6;
  if (y + rect.height > vh - 10) y = e.clientY - rect.height - 6;
  pop.style.left = `${Math.max(10, x)}px`;
  pop.style.top  = `${Math.max(10, y)}px`;

  // Salva doca selecionada
  pop._selectedDock = current?.dock || 1;

  setTimeout(() => {
    document.addEventListener('click', dockAssignOutsideClick, { once: true });
    document.addEventListener('keydown', dockAssignEscHandler);
  }, 0);
}

function selectDockOpt(btn, num) {
  const pop = document.getElementById('dock-assign-pop');
  pop.querySelectorAll('.dock-opt-btn').forEach(b => b.classList.remove('dock-opt-active'));
  btn.classList.add('dock-opt-active');
  pop._selectedDock = num;
}

function confirmDockAssign(orderId) {
  const pop  = document.getElementById('dock-assign-pop');
  const dock = pop._selectedDock || 1;
  const time = document.getElementById('dock-time-input')?.value || '08:00';
  closeDockAssign();
  dockAssignments[orderId] = { dock, time };

  // Cria pendência para persistir no ERP
  const order = orders.find(o => o.id === orderId);
  if (order) {
    if (!pendingChanges[orderId]) {
      pendingChanges[orderId] = {
        orderId,
        oldDate: order.deliveryDate,
        newDate: order.deliveryDate,
        chaveNfe: '',
        observacao: '',
        hasDistribution: true,
        hasDock: true,
      };
    } else {
      pendingChanges[orderId].hasDock = true;
      pendingChanges[orderId].hasDistribution = true;
    }
  }

  showToast(`OC #${orderId} → Doca ${dock} · ${time}`, 'success');
  renderPending();
  renderCalendar();
  renderSidebar();
  if (currentView === 'docks') renderDocks();
}

function removeDockAssign(orderId) {
  closeDockAssign();
  delete dockAssignments[orderId];

  // Remove flag de doca da pendência
  if (pendingChanges[orderId]) {
    pendingChanges[orderId].hasDock = false;
    // Se não tem mais nada pendente, remove
    if (!pendingChanges[orderId].hasDistribution && pendingChanges[orderId].oldDate === pendingChanges[orderId].newDate) {
      delete pendingChanges[orderId];
    }
  }

  showToast(`OC #${orderId} — doca removida`, 'info');
  renderPending();
  renderCalendar();
  renderSidebar();
  if (currentView === 'docks') renderDocks();
}

function closeDockAssign() {
  document.getElementById('dock-assign-pop')?.remove();
  document.removeEventListener('keydown', dockAssignEscHandler);
}
function dockAssignOutsideClick(e) {
  const m = document.getElementById('dock-assign-pop');
  if (m && !m.contains(e.target)) closeDockAssign();
  else if (m) document.addEventListener('click', dockAssignOutsideClick, { once: true });
}
function dockAssignEscHandler(e) { if (e.key === 'Escape') closeDockAssign(); }

// ── Navigation (auto-recarrega do Senior ao mudar de mês) ─────────
function prevMonth() { currentDate.setMonth(currentDate.getMonth() - 1); loadOrders(); }
function nextMonth() { currentDate.setMonth(currentDate.getMonth() + 1); loadOrders(); }
function goToday()   { currentDate = new Date(); loadOrders(); }

// ── Helpers ───────────────────────────────────────────────────────
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDisplay(dateStr) {
  if (!dateStr) return '';
  const [y,m,d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatProducts(products) {
  if (!products || !products.length) return '<span class="order-product">—</span>';
  if (products.length === 1) {
    return `<div class="order-product" title="${esc(products[0])}">${esc(products[0])}</div>`;
  }
  return products.map((p, i) =>
    `<div class="order-product-item">${esc(p)}</div>`
  ).join('');
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function isOverdue(o) {
  if (o.sitIpo === '4') return false; // concluída não é atraso
  if (!o.deliveryDate) return false;
  const today = fmtDate(new Date());
  return o.deliveryDate < today;
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, type = 'info', duration = 3500) {
  const c = document.getElementById('toasts');
  const icons = { success: '✓', error: '✕', info: '→' };
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${icons[type]||'·'}</span><span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'slideOut 0.3s ease forwards';
    setTimeout(() => t.remove(), 300);
  }, duration);
}

// ── Init ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => checkSession());

// ── Auth ──────────────────────────────────────────────────────────
async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    if (data.logged) {
      hideLogin(data.user);
      loadOrders();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-overlay').style.display = '';
}

function hideLogin(user) {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('user-badge').style.display = 'flex';
  document.getElementById('user-name').textContent = user;
}

async function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value.trim();
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');

  if (!user || !pass) {
    errEl.textContent = 'Preencha usuário e senha.';
    errEl.style.display = '';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Autenticando...';
  errEl.style.display = 'none';

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password: pass }),
    });
    const data = await res.json();

    if (data.ok) {
      hideLogin(data.user);
      loadOrders();
    } else {
      errEl.textContent = data.error || 'Falha na autenticação.';
      errEl.style.display = '';
    }
  } catch (e) {
    errEl.textContent = `Erro de conexão: ${e.message}`;
    errEl.style.display = '';
  }

  btn.disabled = false;
  btn.textContent = 'Entrar';
}

async function doLogout() {
  await fetch('/api/logout', { method: 'POST' });
  document.getElementById('user-badge').style.display = 'none';
  orders = [];
  filteredOrders = [];
  pendingChanges = {};
  renderSidebar();
  renderCalendar();
  renderPending();
  showLogin();
  showToast('Sessão encerrada.', 'info');
}

// Enter key no login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('login-overlay').style.display !== 'none') {
    doLogin();
  }
});

// ── Sidebar Toggle ────────────────────────────────────────────────
// Replaced by toggleOrdersPanel in switchView section

// ── Mobile Drawer ─────────────────────────────────────────────────
function toggleDrawer() {
  const sb = document.querySelector('.volt-sidebar');
  const ov = document.getElementById('sidebar-overlay');
  sb.classList.toggle('drawer-open');
  ov.classList.toggle('open');
}
function closeDrawer() {
  document.querySelector('.volt-sidebar')?.classList.remove('drawer-open');
  document.getElementById('sidebar-overlay')?.classList.remove('open');
}
