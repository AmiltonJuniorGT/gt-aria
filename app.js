/* ================================
   GT ARIA — Qualificação (Google Sheets CSV)
   - KPIs EXECUTIVOS seguem filtros
   - Recência calculada por DATA_CADASTRO
   - Tabela ordenável por clique no cabeçalho
   - Janela "tempo para trás" (últimos X dias / custom)
   - Matriculou: STATUS_PENDENTE == FinalizadoM
=================================== */

/** ✅ ATENÇÃO: confirme sempre o gid da aba "data" */
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

const ENABLE_SCORE_IA = true;

const DEFAULT_PRIORIDADE = ["VENDEDOR", "DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];
const SORT_DIR = {
  VENDEDOR: "asc",
  DATA_CADASTRO: "desc",
  TOTAL_AGENDAMENTOS: "asc",
  MIDIA: "asc",
  CURSO: "asc",
};

const RECENCY_OPTIONS = [
  { key: "TODOS", label: "Todos" },
  { key: "0_30", label: "0–30 dias" },
  { key: "31_60", label: "31–60" },
  { key: "61_90", label: "61–90" },
  { key: "90P", label: "90+" },
];

const AGEND_BUCKETS = [
  { key: "TODOS", label: "Todos" },
  { key: "0_1", label: "0–1" },
  { key: "2_3", label: "2–3" },
  { key: "4P", label: "4+" },
];

const WINDOW_OPTIONS = [
  { key: "TODOS", label: "Todos" },
  { key: "30", label: "Últimos 30 dias" },
  { key: "60", label: "Últimos 60 dias" },
  { key: "90", label: "Últimos 90 dias" },
  { key: "180", label: "Últimos 180 dias" },
  { key: "365", label: "Últimos 365 dias" },
  { key: "CUSTOM", label: "Personalizado (dias)" },
];

const state = {
  loading: false,
  error: "",
  lastUpdated: null,

  all: [],
  vendedores: [],
  marcas: [],

  vendedorSelecionado: "TODOS",
  marcaSelecionada: "AMBOS",

  /** recência (faixas 0-30/31-60/...) */
  recenciaSelecionada: "TODOS",

  /** filtro por agendamentos (faixa) */
  agendBucket: "TODOS",

  /** tempo para trás (janela) */
  janelaKey: "TODOS",
  janelaDiasCustom: 120,

  /** busca (CPF/NOME) */
  busca: "",

  /** status da planilha */
  statusPlanilha: { AGENDADO: true, FINALIZADOM: false, FINALIZADO: false },

  /** ordenação por prioridade arrastável */
  prioridade: [...DEFAULT_PRIORIDADE],

  /** sugestões */
  sugestoes: { quick: null, hub: null },

  /** lista atual da tabela */
  currentList: [],

  /** ordenação manual (clicando no cabeçalho) */
  tableSort: { key: null, dir: "asc" },
};

const $ = (sel) => document.querySelector(sel);

init();

function init() {
  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("load", async () => {
    await boot();
    renderRoute();
  });

  document.querySelectorAll("[data-route]").forEach((a) => {
    a.addEventListener("click", () => (location.hash = a.getAttribute("data-route")));
  });

  $("#btnReloadTop")?.addEventListener("click", async () => {
    await boot();
    renderRoute();
  });
}

async function boot() {
  state.loading = true;
  state.error = "";
  renderLoading("Carregando dados do Google Sheets…");

  try {
    const csvText = await fetchCsvNoCache(SHEET_CSV_URL);
    const rows = parseCSV(csvText);
    const normalizedRows = rows.map(normalizeRowKeys);

    state.all = normalizedRows.map((r, idx) => normalizeLead(r, idx));

    state.vendedores = unique(
      state.all.map((l) => (l.VENDEDOR || "").trim()).filter(Boolean)
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    state.marcas = unique(
      state.all.map((l) => normalizeMarcaLabel(l.MARCA)).filter(Boolean)
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    if (ENABLE_SCORE_IA) computeScoreIA(state.all);

    state.sugestoes = computeSuggestions(state.all);

    state.lastUpdated = new Date();
    state.loading = false;
    state.error = "";
  } catch (e) {
    state.loading = false;
    state.error = String(e?.message || e);
  }
}

function renderRoute() {
  const hash = location.hash || "#/qualificacao";
  const crumbs = $("#crumbs");

  if (crumbs) {
    crumbs.textContent =
      hash === "#/login"
        ? "Login"
        : hash === "#/funil"
        ? "Funil Diário"
        : "Tratamento de Leads • Qualificação";
  }

  if (hash === "#/login") return renderPlaceholder("Login (protótipo)");
  if (hash === "#/funil") return renderPlaceholder("Funil Diário (protótipo)");
  return renderQualificacao();
}

function renderPlaceholder(title) {
  $("#view").innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <div style="opacity:.8">Tela em construção.</div>
    </div>
  `;
}

function renderQualificacao() {
  const view = $("#view");
  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  const totalAll = state.all.length;
  const totalMat = state.all.filter(isMatriculado).length;
  const totalNaoMat = totalAll - totalMat;

  view.innerHTML = `
    <div class="card">
      <div class="rowBetween">
        <div>
          <h2 style="margin:0 0 4px 0;">Qualificação de Leads (HUB)</h2>
          <div class="muted small">
            Base total: <b>${totalAll}</b> • Não clientes: <b>${totalNaoMat}</b> • Clientes (FinalizadoM): <b>${totalMat}</b>
            ${state.lastUpdated ? `• Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
          <div class="muted small" style="margin-top:6px;">
            Recência/KPIs usam: <b>DATA_CADASTRO</b>. Matriculou: <b>STATUS_PENDENTE == FinalizadoM</b>.
          </div>
        </div>

        <div class="row" style="align-items:flex-end;">
          <div class="ctrl" style="min-width:210px;">
            <label>Marca</label>
            <select id="selMarca" class="select">
              <option value="AMBOS">Ambos</option>
              <option value="TECNICO" ${state.marcaSelecionada==="TECNICO"?"selected":""}>Técnico</option>
              <option value="PROFISSIONALIZANTE" ${state.marcaSelecionada==="PROFISSIONALIZANTE"?"selected":""}>Profissionalizante</option>
            </select>
          </div>

          <div class="ctrl" style="min-width:210px;">
            <label>Vendedor</label>
            <select id="selVendedor" class="select">
              <option value="TODOS">Todos</option>
              ${state.vendedores.map(v => `<option value="${escapeAttr(v)}" ${state.vendedorSelecionado===v?"selected":""}>${escapeHtml(v)}</option>`).join("")}
            </select>
          </div>

          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerar" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExport" class="btn btnGhost">Exportar (CSV)</button>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="rowBetween">
        <div class="checkRow">
          <div class="muted small"><b>Status (Planilha):</b></div>
          <label><input type="checkbox" id="stAg" ${state.statusPlanilha.AGENDADO?"checked":""}/> Agendado</label>
          <label><input type="checkbox" id="stFm" ${state.statusPlanilha.FINALIZADOM?"checked":""}/> FinalizadoM</label>
          <label><input type="checkbox" id="stF" ${state.statusPlanilha.FINALIZADO?"checked":""}/> Finalizado</label>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="row" style="align-items:flex-end;">
        <div class="ctrl" style="min-width:210px;">
          <label>Janela (tempo para trás)</label>
          <select id="selJanela" class="select">
            ${WINDOW_OPTIONS.map(o => `<option value="${o.key}" ${state.janelaKey===o.key?"selected":""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:180px;">
          <label>Dias (se personalizado)</label>
          <input id="inpJanelaDias" class="input" type="number" min="1" step="1"
            value="${escapeAttr(String(state.janelaDiasCustom || 120))}"
            ${state.janelaKey==="CUSTOM" ? "" : "disabled"}
          />
        </div>

        <div class="ctrl" style="min-width:210px;">
          <label>Recência (faixa)</label>
          <select id="selRecencia" class="select">
            ${RECENCY_OPTIONS.map(o => `<option value="${o.key}" ${state.recenciaSelecionada===o.key?"selected":""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:210px;">
          <label>Agendamentos (faixa)</label>
          <select id="selAgFaixa" class="select">
            ${AGEND_BUCKETS.map(o => `<option value="${o.key}" ${state.agendBucket===o.key?"selected":""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:320px; flex:1;">
          <label>Buscar (CPF/Nome)</label>
          <input id="inpBusca" class="input" placeholder="Digite CPF ou nome..." value="${escapeAttr(state.busca)}" />
        </div>
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <div class="rowBetween">
        <h3 style="margin:0;">Sugestão IA (recomendação, você decide)</h3>
        <div class="muted small">Baseada no histórico de <b>FinalizadoM</b> (virou cliente)</div>
      </div>

      <div class="hSep"></div>

      <div class="sugGrid">
        ${renderSuggestionBox("Fechar rápido (novos 0–30)", "quick")}
        ${renderSuggestionBox("Missão HUB (antigos 90+)", "hub")}
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <div class="rowBetween">
        <h3 style="margin:0;">KPIs (seguem filtros atuais)</h3>
        <div class="muted small" id="kpiNote">Clique em <b>Gerar Lista</b> para calcular.</div>
      </div>

      <div class="hSep"></div>

      <div id="kpiWrap" class="kpiGrid">
        ${renderKpiPlaceholder()}
      </div>

      <div class="muted small" style="margin-top:10px;">
        Obs.: como KPIs seguem filtros, se você desmarcar <b>FinalizadoM</b>, “matriculados” pode zerar.
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Prioridade de Ordenação (arraste)</h3>
      <div id="drag" style="max-width:520px;"></div>
      <div class="muted small" style="margin-top:8px;">
        Padrão: Score IA (se ligado) > sua ordem arrastável.
        <br/>Na tabela, clique no cabeçalho para ordenar manualmente (▲/▼).
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <div class="rowBetween">
        <h3 style="margin:0;">Resultado</h3>
        <div class="muted small" id="resultadoInfo">Clique em <b>Gerar Lista</b>.</div>
      </div>

      <div class="tableWrap" style="margin-top:10px;">
        <table id="tbl">
          <thead>
            <tr>
              ${renderSortableTh("#", null)}
              ${renderSortableTh("Nome", "NOME")}
              ${renderSortableTh("CPF", "CPF")}
              ${renderSortableTh("Curso", "CURSO")}
              ${renderSortableTh("Mídia", "MIDIA")}
              ${renderSortableTh("Marca", "MARCA")}
              ${renderSortableTh("Vendedor", "VENDEDOR")}
              ${renderSortableTh("Data Cad.", "DATA_CADASTRO")}
              ${renderSortableTh("Dias", "AGE_DAYS")}
              ${renderSortableTh("Agend.", "TOTAL_AGENDAMENTOS")}
              ${renderSortableTh("Status", "STATUS_PENDENTE")}
              ${ENABLE_SCORE_IA ? renderSortableTh("Score IA", "SCORE_IA") : ""}
              <th>Contato</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="${ENABLE_SCORE_IA ? 13 : 12}" class="muted">Clique em <b>Gerar Lista</b>.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderDrag();
  bindUI();
}

/* =========================
   KPI placeholders
========================= */
function renderKpiPlaceholder() {
  return `
    <div class="kpi"><div class="kpiTitle">Leads analisados</div><div class="kpiValue">—</div><div class="kpiSub">—</div></div>
    <div class="kpi"><div class="kpiTitle">Matriculados (FinalizadoM)</div><div class="kpiValue">—</div><div class="kpiSub">—</div></div>
    <div class="kpi"><div class="kpiTitle">Conversão</div><div class="kpiValue">—</div><div class="kpiSub">—</div></div>
    <div class="kpi"><div class="kpiTitle">80/20 por recência</div><div class="kpiValue">—</div><div class="kpiSub">—</div></div>
  `;
}

/* =========================
   Table header sortable
========================= */
function renderSortableTh(label, key) {
  if (!key) return `<th>${escapeHtml(label)}</th>`;

  const isActive = state.tableSort.key === key;
  const icon = isActive ? (state.tableSort.dir === "asc" ? "▲" : "▼") : "";
  return `
    <th>
      <button class="thBtn" data-sortkey="${escapeAttr(key)}" title="Ordenar por ${escapeAttr(label)}">
        <span>${escapeHtml(label)}</span>
        <span class="sortIcon">${icon}</span>
      </button>
    </th>
  `;
}

/* =========================
   UI bind
========================= */
function bindUI() {
  $("#selVendedor").addEventListener("change", (e) => (state.vendedorSelecionado = e.target.value || "TODOS"));
  $("#selMarca").addEventListener("change", (e) => (state.marcaSelecionada = e.target.value || "AMBOS"));
  $("#selRecencia").addEventListener("change", (e) => (state.recenciaSelecionada = e.target.value || "TODOS"));
  $("#selAgFaixa").addEventListener("change", (e) => (state.agendBucket = e.target.value || "TODOS"));
  $("#inpBusca").addEventListener("input", (e) => (state.busca = e.target.value || ""));

  $("#selJanela").addEventListener("change", (e) => {
    state.janelaKey = e.target.value || "TODOS";
    const inp = $("#inpJanelaDias");
    if (inp) inp.disabled = state.janelaKey !== "CUSTOM";
  });
  $("#inpJanelaDias").addEventListener("input", (e) => {
    const v = parseInt(e.target.value || "0", 10);
    state.janelaDiasCustom = Number.isFinite(v) && v > 0 ? v : 120;
  });

  $("#stAg").addEventListener("change", (e) => (state.statusPlanilha.AGENDADO = e.target.checked));
  $("#stFm").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADOM = e.target.checked));
  $("#stF").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADO = e.target.checked));

  $("#btnGerar").addEventListener("click", gerarLista);
  $("#btnRecarregar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });
  $("#btnExport").addEventListener("click", exportarListaCSV);

  $("#btnApplyQuick")?.addEventListener("click", () => applySuggestion(state.sugestoes.quick));
  $("#btnApplyHub")?.addEventListener("click", () => applySuggestion(state.sugestoes.hub));

  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-sortkey");
      toggleTableSort(key);
      applyCurrentSortAndRender();
    });
  });
}

/* ====== Ordenação manual da tabela ====== */
function toggleTableSort(key) {
  if (state.tableSort.key !== key) {
    state.tableSort.key = key;
    state.tableSort.dir = "asc";
    return;
  }
  if (state.tableSort.dir === "asc") {
    state.tableSort.dir = "desc";
    return;
  }
  state.tableSort.key = null;
  state.tableSort.dir = "asc";
}

function applyCurrentSortAndRender() {
  if (!state.currentList?.length) return;
  const list = [...state.currentList];

  if (state.tableSort.key) list.sort(makeColumnComparator(state.tableSort.key, state.tableSort.dir));
  else list.sort(makeMultiComparatorWithScore(state.prioridade));

  renderTabela(list);

  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    const k = btn.getAttribute("data-sortkey");
    const iconEl = btn.querySelector(".sortIcon");
    if (!iconEl) return;
    iconEl.textContent = state.tableSort.key === k ? (state.tableSort.dir === "asc" ? "▲" : "▼") : "";
  });
}

function makeColumnComparator(key, dir) {
  const mult = dir === "desc" ? -1 : 1;

  return (a, b) => {
    let av = a[key];
    let bv = b[key];

    if (key === "TOTAL_AGENDAMENTOS" || key === "AGE_DAYS") return (toInt(av) - toInt(bv)) * mult;

    if (key === "SCORE_IA") {
      const as = Number.isFinite(av) ? av : -1;
      const bs = Number.isFinite(bv) ? bv : -1;
      return (as - bs) * mult;
    }

    if (key === "DATA_CADASTRO") return (toDate(av) - toDate(bv)) * mult;

    if (key === "MARCA") {
      av = normalizeMarcaLabel(av);
      bv = normalizeMarcaLabel(bv);
    }

    return String(av || "").localeCompare(String(bv || ""), "pt-BR", { sensitivity: "base" }) * mult;
  };
}

/* =========================
   Sugestões IA (render)
========================= */
function renderSuggestionBox(title, kind) {
  const sug = state.sugestoes[kind];
  if (!sug) {
    return `
      <div class="sugBox">
        <div class="sugTitle">${escapeHtml(title)}</div>
        <div class="muted small">Sem dados suficientes ainda para sugerir.</div>
      </div>
    `;
  }

  const btnId = kind === "quick" ? "btnApplyQuick" : "btnApplyHub";

  return `
    <div class="sugBox">
      <div class="rowBetween">
        <div class="sugTitle">${escapeHtml(title)}</div>
        <button id="${btnId}" class="btn btnGhost btnTiny">Aplicar</button>
      </div>

      <div class="sugLine"><b>Combo:</b> ${escapeHtml(sug.comboText)}</div>

      <div class="sugMeta">
        <span class="badge badgeBlue">Conv: <b>${fmtPct(sug.conv)}</b></span>
        <span class="badge badgeGreen">Lift: <b>${fmtX(sug.lift)}</b></span>
        <span class="badge badgeAmber">n: <b>${sug.n}</b></span>
      </div>
      <div class="muted small" style="margin-top:8px;">
        (Base: mesma recência, compara com conv. geral daquele universo)
      </div>
    </div>
  `;
}

function applySuggestion(sug) {
  if (!sug) return;

  state.marcaSelecionada = sug.marcaKey || "AMBOS";
  state.recenciaSelecionada = sug.recenciaKey || "TODOS";
  state.agendBucket = sug.agendKey || "TODOS";

  state._comboLock = { curso: sug.curso || "", midia: sug.midia || "" };

  renderQualificacao();
  gerarLista();
}

/* =========================
   Drag & Drop prioridade
========================= */
function renderDrag() {
  const drag = $("#drag");
  drag.innerHTML = "";

  state.prioridade.forEach((p) => {
    const div = document.createElement("div");
    div.className = "dragItem";
    div.draggable = true;
    div.textContent = p;
    drag.appendChild(div);
  });

  enableDrag();
}

function enableDrag() {
  const container = $("#drag");
  const items = container.querySelectorAll(".dragItem");

  items.forEach((item) => {
    item.addEventListener("dragstart", () => item.classList.add("dragging"));
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      state.prioridade = [...container.querySelectorAll(".dragItem")].map((el) => el.textContent.trim());

      if (!state.tableSort.key && state.currentList?.length) {
        state.currentList.sort(makeMultiComparatorWithScore(state.prioridade));
        renderTabela(state.currentList);
      }
    });
  });

  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    const dragging = container.querySelector(".dragging");
    if (!dragging) return;

    const after = getDragAfterElement(container, e.clientY);
    if (after == null) container.appendChild(dragging);
    else container.insertBefore(dragging, after);
  });
}

function getDragAfterElement(container, y) {
  const els = [...container.querySelectorAll(".dragItem:not(.dragging)")];
  return els.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, element: null }
  ).element;
}

/* =========================
   Gerar lista + KPIs (seguem filtros)
========================= */
function gerarLista() {
  const listaFiltrada = filtrarLista(state.all);

  renderKPIs(listaFiltrada);

  state.currentList = [...listaFiltrada];

  if (state.tableSort.key) state.currentList.sort(makeColumnComparator(state.tableSort.key, state.tableSort.dir));
  else state.currentList.sort(makeMultiComparatorWithScore(state.prioridade));

  renderTabela(state.currentList);

  $("#resultadoInfo").textContent =
    `Linhas: ${state.currentList.length} • ` +
    `Ordem: ${state.tableSort.key ? `Manual (${state.tableSort.key} ${state.tableSort.dir})` : `Padrão (ScoreIA > ${state.prioridade.join(" > ")})`}`;
}

function filtrarLista(base) {
  let lista = [...base];

  // 0) Janela tempo para trás (AGE_DAYS <= janela)
  const maxDays = getWindowMaxDays();
  if (maxDays != null) {
    lista = lista.filter((l) => l.AGE_DAYS != null && l.AGE_DAYS <= maxDays);
  }

  // 1) Marca
  if (state.marcaSelecionada !== "AMBOS") {
    lista = lista.filter((l) => normalizeMarcaKey(l.MARCA) === state.marcaSelecionada);
  }

  // 2) Vendedor
  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  }

  // 3) Recência (faixa)
  if (state.recenciaSelecionada !== "TODOS") {
    lista = lista.filter((l) => recencyKeyFromAge(l.AGE_DAYS) === state.recenciaSelecionada);
  }

  // 4) Agendamentos (faixa)
  if (state.agendBucket !== "TODOS") {
    lista = lista.filter((l) => agendKeyFromN(toInt(l.TOTAL_AGENDAMENTOS)) === state.agendBucket);
  }

  // 5) Status (Planilha)
  lista = lista.filter((l) => {
    const s = normalizeStatus(l.STATUS_PENDENTE);
    if (s === "AGENDADO") return !!state.statusPlanilha.AGENDADO;
    if (s === "FINALIZADOM") return !!state.statusPlanilha.FINALIZADOM;
    if (s === "FINALIZADO") return !!state.statusPlanilha.FINALIZADO;
    return true;
  });

  // 6) Busca CPF/nome
  const q = (state.busca || "").trim();
  if (q) {
    const qDigits = q.replace(/\D/g, "");
    const qLower = q.toLowerCase();
    lista = lista.filter((l) => {
      const cpf = String(l.CPF || "").replace(/\D/g, "");
      const nome = String(l.NOME || "").toLowerCase();
      if (qDigits && cpf.includes(qDigits)) return true;
      if (nome.includes(qLower)) return true;
      return false;
    });
  }

  // 7) lock por sugestão IA (curso/mídia) quando aplica sugestão
  if (state._comboLock) {
    const { curso, midia } = state._comboLock;
    if (curso) lista = lista.filter((l) => normalizeText(l.CURSO) === normalizeText(curso));
    if (midia) lista = lista.filter((l) => normalizeText(l.MIDIA) === normalizeText(midia));
    state._comboLock = null;
  }

  return lista;
}

function getWindowMaxDays() {
  if (state.janelaKey === "TODOS") return null;
  if (state.janelaKey === "CUSTOM") {
    const v = parseInt(String(state.janelaDiasCustom || ""), 10);
    return Number.isFinite(v) && v > 0 ? v : 120;
  }
  const n = parseInt(state.janelaKey, 10);
  return Number.isFinite(n) ? n : null;
}

function renderKPIs(lista) {
  const total = lista.length;
  const mats = lista.filter(isMatriculado);
  const mat = mats.length;
  const conv = total ? (mat / total) : 0;

  const buckets = ["0_30","31_60","61_90","90P"];
  const byBucket = new Map(buckets.map(b => [b, { total: 0, mat: 0 }]));

  for (const l of lista) {
    const rk = recencyKeyFromAge(l.AGE_DAYS);
    if (!byBucket.has(rk)) continue;
    const x = byBucket.get(rk);
    x.total += 1;
    if (isMatriculado(l)) x.mat += 1;
  }

  const matTotalBuckets = buckets.reduce((s,b)=> s + byBucket.get(b).mat, 0);
  const share = (b) => matTotalBuckets ? (byBucket.get(b).mat / matTotalBuckets) : 0;

  const hub = byBucket.get("90P");
  const hubTotal = hub.total;
  const hubMat = hub.mat;
  const hubConv = hubTotal ? (hubMat / hubTotal) : 0;

  const targets = [0.03, 0.05];
  const upliftText = hubTotal
    ? targets.map(t => {
        const delta = Math.max(0, Math.round(hubTotal * t) - hubMat);
        return `${Math.round(t*100)}% → +${delta}`;
      }).join(" • ")
    : "—";

  const kpiWrap = $("#kpiWrap");
  const kpiNote = $("#kpiNote");
  if (kpiNote) kpiNote.textContent = `Calculado em ${formatDateTime(new Date())} • Base filtrada atual`;

  if (!kpiWrap) return;

  const recLabel = (k) => (RECENCY_OPTIONS.find(o=>o.key===k)?.label || k);
  const convBucket = (b) => {
    const x = byBucket.get(b);
    const c = x.total ? (x.mat / x.total) : 0;
    return `${recLabel(b)}: ${fmtPct(c)} (n=${x.total})`;
  };

  const shareTxt = buckets.map(b => `${recLabel(b)} ${fmtPct(share(b))}`).join(" • ");

  kpiWrap.innerHTML = `
    <div class="kpi">
      <div class="kpiTitle">Leads analisados (filtro atual)</div>
      <div class="kpiValue">${total}</div>
      <div class="kpiSub">Inclui apenas o que passou nos filtros acima</div>
    </div>

    <div class="kpi">
      <div class="kpiTitle">Matriculados (FinalizadoM)</div>
      <div class="kpiValue">${mat}</div>
      <div class="kpiSub">Regra: STATUS_PENDENTE == FinalizadoM</div>
    </div>

    <div class="kpi">
      <div class="kpiTitle">Conversão (base filtrada)</div>
      <div class="kpiValue">${fmtPct(conv)}</div>
      <div class="kpiSub">matriculados / leads analisados</div>
      <div class="kpiMini">
        <span>${convBucket("0_30")}</span>
        <span>${convBucket("31_60")}</span>
        <span>${convBucket("61_90")}</span>
        <span>${convBucket("90P")}</span>
      </div>
    </div>

    <div class="kpi">
      <div class="kpiTitle">80/20 por recência (matrículas)</div>
      <div class="kpiValue">${matTotalBuckets ? "Distribuição" : "—"}</div>
      <div class="kpiSub">${matTotalBuckets ? shareTxt : "Sem matrículas dentro do filtro atual"}</div>
      <div class="kpiMini" style="margin-top:8px;">
        <span>HUB 90+: ${hubTotal ? `${hubTotal} leads • conv ${fmtPct(hubConv)}` : "—"}</span>
        <span>Se elevar: ${upliftText}</span>
      </div>
    </div>
  `;
}

/* =========================
   Ordenação padrão (Score IA + prioridade)
========================= */
function makeMultiComparatorWithScore(keys) {
  return (a, b) => {
    if (ENABLE_SCORE_IA) {
      const as = Number.isFinite(a.SCORE_IA) ? a.SCORE_IA : -1;
      const bs = Number.isFinite(b.SCORE_IA) ? b.SCORE_IA : -1;
      if (bs !== as) return bs - as;
    }

    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";
      const av = a[k];
      const bv = b[k];

      let cmp = 0;

      if (k === "TOTAL_AGENDAMENTOS") {
        cmp = toInt(av) - toInt(bv);
      } else if (k === "DATA_CADASTRO") {
        cmp = toDate(bv) - toDate(av); // desc
        if (dir === "asc") cmp = -cmp;
      } else {
        cmp = String(av || "").localeCompare(String(bv || ""), "pt-BR", { sensitivity: "base" });
      }

      if (cmp !== 0) return dir === "desc" && k !== "DATA_CADASTRO" ? -cmp : cmp;
    }
    return 0;
  };
}

/* =========================
   Tabela
========================= */
function renderTabela(lista) {
  const tbody = $("#tbody");

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="${ENABLE_SCORE_IA ? 13 : 12}" class="muted">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((l, i) => {
    const wa = buildWhatsLink(l);
    const status = normalizeStatus(l.STATUS_PENDENTE);
    const marcaLabel = normalizeMarcaLabel(l.MARCA);
    const days = Number.isFinite(l.AGE_DAYS) ? l.AGE_DAYS : "";

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(l.NOME || "")}</td>
        <td>${escapeHtml(l.CPF || "")}</td>
        <td>${escapeHtml(l.CURSO || "")}</td>
        <td>${escapeHtml(l.MIDIA || "")}</td>
        <td>${escapeHtml(marcaLabel || "")}</td>
        <td>${escapeHtml(l.VENDEDOR || "")}</td>
        <td>${escapeHtml(l.DATA_CADASTRO || "")}</td>
        <td>${escapeHtml(String(days))}</td>
        <td>${escapeHtml(String(toInt(l.TOTAL_AGENDAMENTOS)))}</td>
        <td>${escapeHtml(status)}</td>
        ${ENABLE_SCORE_IA ? `<td>${l.SCORE_IA != null ? Number(l.SCORE_IA).toFixed(3) : ""}</td>` : ""}
        <td>${wa ? `<a href="${wa}" target="_blank">Whats</a>` : "-"}</td>
      </tr>
    `;
  }).join("");
}

/* =========================
   Export CSV (lista atual)
========================= */
function exportarListaCSV() {
  if (!state.currentList?.length) return;

  const headers = ["CPF","NOME","MARCA","CURSO","MIDIA","VENDEDOR","DATA_CADASTRO","IDADE_DIAS","TOTAL_AGENDAMENTOS","STATUS_PENDENTE","SCORE_IA"];
  const rows = [headers.join(",")];

  for (const l of state.currentList) {
    rows.push([
      csvCell(l.CPF),
      csvCell(l.NOME),
      csvCell(normalizeMarcaLabel(l.MARCA)),
      csvCell(l.CURSO),
      csvCell(l.MIDIA),
      csvCell(l.VENDEDOR),
      csvCell(l.DATA_CADASTRO),
      csvCell(String(l.AGE_DAYS ?? "")),
      csvCell(String(toInt(l.TOTAL_AGENDAMENTOS))),
      csvCell(normalizeStatus(l.STATUS_PENDENTE)),
      csvCell(l.SCORE_IA != null ? String(Number(l.SCORE_IA).toFixed(3)) : "")
    ].join(","));
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gt_aria_lista_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[,"\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/* =========================
   Sugestão IA — cálculo
========================= */
function computeSuggestions(all) {
  const out = { quick: null, hub: null };

  const enriched = all.map(l => ({
    ...l,
    REC: recencyKeyFromAge(l.AGE_DAYS),
    AGK: agendKeyFromN(toInt(l.TOTAL_AGENDAMENTOS)),
    MK: normalizeMarcaKey(l.MARCA),
    COURSE: normalizeText(l.CURSO),
    MEDIA: normalizeText(l.MIDIA),
    ISMAT: isMatriculado(l),
  }));

  out.quick = bestComboForRecency(enriched, "0_30");
  out.hub = bestComboForRecency(enriched, "90P");

  return out;
}

function bestComboForRecency(rows, recKey) {
  const universe = rows.filter(r => r.REC === recKey && r.COURSE && r.MEDIA);
  const nU = universe.length;
  if (nU < 80) return null;

  const matU = universe.reduce((acc, r) => acc + (r.ISMAT ? 1 : 0), 0);
  const convU = (matU + 1) / (nU + 2);

  const map = new Map();

  for (const r of universe) {
    const keys = [
      `AMBOS|${r.COURSE}|${r.MEDIA}|${r.AGK}`,
      `${r.MK}|${r.COURSE}|${r.MEDIA}|${r.AGK}`,
    ];

    for (const k of keys) {
      const cur = map.get(k) || { n: 0, m: 0 };
      cur.n += 1;
      cur.m += (r.ISMAT ? 1 : 0);
      map.set(k, cur);
    }
  }

  let best = null;

  for (const [k, v] of map.entries()) {
    const n = v.n;
    if (n < 30) continue;
    const conv = (v.m + 1) / (n + 2);
    const lift = conv / convU;

    const parts = k.split("|");
    const agk = parts[3];
    const bonus = agk === "0_1" ? 1.08 : agk === "2_3" ? 1.00 : agk === "4P" ? 0.92 : 1.00;

    const score = lift * Math.log10(n + 1) * bonus;

    if (!best || score > best.score) best = { k, n, conv, lift, score };
  }

  if (!best) return null;

  const [marcaKey, courseNorm, mediaNorm, agendKey] = best.k.split("|");
  const pickCourse = firstLabel(universe, "CURSO", courseNorm) || courseNorm;
  const pickMedia  = firstLabel(universe, "MIDIA", mediaNorm) || mediaNorm;

  const comboText = [
    `Recência: ${RECENCY_OPTIONS.find(o=>o.key===recKey)?.label || recKey}`,
    marcaKey !== "AMBOS" ? `Marca: ${marcaKey === "TECNICO" ? "Técnico" : "Profissionalizante"}` : `Marca: Ambos`,
    `Curso: ${pickCourse}`,
    `Mídia: ${pickMedia}`,
    `Agend.: ${AGEND_BUCKETS.find(o=>o.key===agendKey)?.label || agendKey}`
  ].join(" • ");

  return { recenciaKey: recKey, marcaKey, curso: pickCourse, midia: pickMedia, agendKey, n: best.n, conv: best.conv, lift: best.lift, comboText };
}

function firstLabel(universe, field, normValue) {
  for (const r of universe) {
    if (field === "CURSO" && normalizeText(r.CURSO) === normValue) return r.CURSO;
    if (field === "MIDIA" && normalizeText(r.MIDIA) === normValue) return r.MIDIA;
  }
  return "";
}

/* =========================
   Score IA (simples)
========================= */
function computeScoreIA(allLeads) {
  const total = new Map();
  const mat = new Map();

  for (const l of allLeads) {
    const key = `${normalizeText(l.MIDIA)}|${normalizeText(l.CURSO)}`;
    total.set(key, (total.get(key) || 0) + 1);
    if (isMatriculado(l)) mat.set(key, (mat.get(key) || 0) + 1);
  }

  for (const l of allLeads) {
    const key = `${normalizeText(l.MIDIA)}|${normalizeText(l.CURSO)}`;
    const taxa = (mat.get(key) || 0) / Math.max(1, total.get(key) || 0);
    const ag = Math.max(0, toInt(l.TOTAL_AGENDAMENTOS));
    const penal = 1 / (1 + ag);
    l.SCORE_IA = taxa * 0.75 + penal * 0.25;
  }
}

/* =========================
   CSV fetch + parse
========================= */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública e o gid é da aba correta.");
  return await res.text();
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");

  const rows = [];
  let cur = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
      continue;
    }

    if (c === '"') { inQuotes = true; continue; }
    if (c === ",") { cur.push(field); field = ""; continue; }
    if (c === "\n") { cur.push(field); field = ""; rows.push(cur); cur = []; continue; }
    if (c === "\r") continue;

    field += c;
  }

  if (field.length || cur.length) { cur.push(field); rows.push(cur); }

  const clean = rows.filter((r) => r.some((x) => String(x || "").trim().length));
  if (!clean.length) return [];

  const headers = clean[0].map((h) => String(h || "").trim());
  return clean.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = r[idx] != null ? String(r[idx]) : ""; });
    return obj;
  });
}

function normalizeRowKeys(row) {
  const out = { __raw: row };
  Object.keys(row).forEach((k) => { out[normalizeKey(k)] = row[k]; });
  return out;
}

function normalizeKey(k) {
  return String(k || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "_");
}

/* =========================
   Normalize lead
========================= */
function normalizeLead(r, idx) {
  const get = (...keys) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (r[nk] != null && String(r[nk]).trim() !== "") return r[nk];
    }
    if (r.__raw) {
      for (const k of keys) {
        if (r.__raw[k] != null && String(r.__raw[k]).trim() !== "") return r.__raw[k];
      }
    }
    return "";
  };

  const dataCad = get("DATA_CADASTRO");
  const age = computeAgeDays(dataCad);

  return {
    ID: idx + 1,
    MARCA: get("MARCA"),
    NOME: get("NOME"),
    CPF: get("CPF"),
    VENDEDOR: get("VENDEDOR"),
    DATA_CADASTRO: dataCad,
    MIDIA: get("MIDIA", "MÍDIA"),
    CURSO: get("CURSO"),
    TOTAL_AGENDAMENTOS: toInt(get("TOTAL_AGENDAMENTOS")),
    STATUS_PENDENTE: get("STATUS_PENDENTE"),
    SCORE_IA: null,
    AGE_DAYS: age,
    FONE: get("FONE"),
    FONE2: get("FONE2"),
    FONE3: get("FONE3"),
  };
}

/* =========================
   Rules / helpers
========================= */
function normalizeStatus(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

function isMatriculado(l) {
  // Regra definida por você:
  return normalizeStatus(l.STATUS_PENDENTE) === "FINALIZADOM";
}

function normalizeText(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeMarcaKey(s) {
  const n = normalizeText(s);
  if (n.startsWith("TEC")) return "TECNICO";
  if (n.startsWith("PRO")) return "PROFISSIONALIZANTE";
  return n || "AMBOS";
}

function normalizeMarcaLabel(s) {
  const k = normalizeMarcaKey(s);
  if (k === "TECNICO") return "Técnico";
  if (k === "PROFISSIONALIZANTE") return "Profissionalizante";
  return String(s || "").trim();
}

function buildWhatsLink(l) {
  const f = String(l.FONE || "").trim() || String(l.FONE2 || "").trim() || String(l.FONE3 || "").trim();
  const p = String(f || "").replace(/\D/g, "");
  if (!p) return "";
  const full = p.startsWith("55") ? p : `55${p}`;
  return `https://wa.me/${full}`;
}

function toInt(v) {
  const n = parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  const s = String(v || "").trim();
  if (!s) return 0;

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;

  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    const dd = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10) - 1;
    let yy = parseInt(m[3], 10);
    if (yy < 100) yy += 2000;
    const hh = parseInt(m[4] || "0", 10);
    const mi = parseInt(m[5] || "0", 10);
    const ss = parseInt(m[6] || "0", 10);
    return new Date(yy, mm, dd, hh, mi, ss).getTime();
  }

  return 0;
}

function computeAgeDays(dataCadastro) {
  const t = toDate(dataCadastro);
  if (!t) return null;
  const now = Date.now();
  const d = Math.floor((now - t) / 86400000);
  return d >= 0 && d < 20000 ? d : null;
}

function recencyKeyFromAge(ageDays) {
  if (ageDays == null) return "TODOS";
  if (ageDays <= 30) return "0_30";
  if (ageDays <= 60) return "31_60";
  if (ageDays <= 90) return "61_90";
  return "90P";
}

function agendKeyFromN(n) {
  if (!Number.isFinite(n)) return "TODOS";
  if (n <= 1) return "0_1";
  if (n <= 3) return "2_3";
  return "4P";
}

function unique(arr) { return [...new Set(arr)]; }
function formatDateTime(d) { try { return d.toLocaleString("pt-BR"); } catch { return String(d); } }

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replaceAll('"', "&quot;"); }

function renderLoading(msg) {
  const view = $("#view");
  if (!view) return;
  view.innerHTML = `
    <div class="card">
      <div style="font-weight:900;margin-bottom:6px;">${escapeHtml(msg || "Carregando…")}</div>
      <div class="muted small">Aguarde.</div>
    </div>
  `;
}

function renderError(err) {
  const view = $("#view");
  view.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;color:#8b0000;">Erro</h2>
      <div style="white-space:pre-wrap;font-family:monospace;font-size:12px;">${escapeHtml(String(err))}</div>
      <div class="hSep"></div>
      <button id="btnTentar" class="btn btnGhost">Tentar novamente</button>
    </div>
  `;
  $("#btnTentar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });
}

function fmtPct(x) { const v = Number(x || 0); return (v * 100).toFixed(1) + "%"; }
function fmtX(x) { const v = Number(x || 0); return v.toFixed(2) + "x"; }
