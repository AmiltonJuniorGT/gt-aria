/* ================================
   GT ARIA — Qualificação (Google Sheets CSV)
   - VENDEDOR = PARTIÇÃO FIXA (blocos)
   - Drag define a CLASSIFICAÇÃO HIERÁRQUICA dentro do vendedor
   - KPIs seguem filtros
   - Recência por DATA_CADASTRO
   - Tabela ordenável por clique (opcional; não quebra o agrupamento)
   - 2 cards de IA:
     1) Base Total
     2) Vendedor
=================================== */

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

const ENABLE_SCORE_IA = true;

const DEFAULT_PRIORIDADE = ["DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];

const SORT_DIR = {
  DATA_CADASTRO: "desc",
  TOTAL_AGENDAMENTOS: "asc",
  MIDIA: "desc",
  CURSO: "desc",
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

  marcaSelecionada: "AMBOS",
  vendedorSelecionado: "TODOS",
  recenciaSelecionada: "TODOS",
  agendBucket: "TODOS",

  janelaKey: "TODOS",
  janelaDiasCustom: 120,

  busca: "",

  statusPlanilha: {
    AGENDADO: true,
    FINALIZADOM: false,
    FINALIZADO: false,
  },

  prioridade: [...DEFAULT_PRIORIDADE],
  currentList: [],
  tableSort: { key: null, dir: "asc" },

  convMidia: new Map(),
  convCurso: new Map(),
};

const $ = (sel) => document.querySelector(sel);

init();

/* ------------------------------
   INIT + ROUTER
-------------------------------- */
function init() {
  window.addEventListener("hashchange", renderRoute);

  window.addEventListener("load", async () => {
    await boot();
    renderRoute();
  });

  document.querySelectorAll("[data-route]").forEach((a) => {
    a.addEventListener("click", () => {
      location.hash = a.getAttribute("data-route");
    });
  });

  $("#btnReloadTop")?.addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnRecarregarTop")?.addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnGerarTop")?.addEventListener("click", () => {
    gerarLista();
  });

  $("#btnExportTop")?.addEventListener("click", () => {
    exportarListaCSV();
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
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

    if (ENABLE_SCORE_IA) computeScoreIA(state.all);

    const statsBase = filtrarBaseParaStats(state.all);
    computeConversionRates(statsBase);

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
  const view = $("#view");
  if (!view) return;

  view.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <div style="opacity:.8">Tela em construção.</div>
    </div>
  `;
}

/* ------------------------------
   UI PRINCIPAL
-------------------------------- */
function renderQualificacao() {
  const view = $("#view");
  if (!view) return;

  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  const totalAll = state.all.length;
  const totalMat = state.all.filter(isMatriculado).length;

  const baseStats = filtrarBaseParaStats(state.all);
  computeConversionRates(baseStats);

  const aiBase = buildBaseInsight(baseStats);
  const aiVendedor = buildSellerInsight(baseStats, state.vendedorSelecionado);

  view.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;">
        <div>
          <h2 style="margin:0 0 4px 0;">Qualificação de Leads (HUB)</h2>
          <div style="opacity:.85;font-size:13px">
            Base total: <b>${formatInt(totalAll)}</b> • Clientes (FinalizadoM): <b>${formatInt(totalMat)}</b>
            ${state.lastUpdated ? `• Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
          <div style="opacity:.8;font-size:12px;margin-top:6px;">
            <b>Partição fixa:</b> VENDEDOR. Arraste define a classificação <b>dentro</b> do vendedor.
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerar" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExport" class="btn btnGhost">Exportar (CSV)</button>
        </div>
      </div>

      <div style="height:12px"></div>

      <div class="row" style="align-items:flex-end;">
        <div class="ctrl" style="min-width:210px;">
          <label>Marca</label>
          <select id="selMarca" class="select">
            <option value="AMBOS">Ambos</option>
            <option value="TECNICO" ${state.marcaSelecionada === "TECNICO" ? "selected" : ""}>Técnico</option>
            <option value="PROFISSIONALIZANTE" ${state.marcaSelecionada === "PROFISSIONALIZANTE" ? "selected" : ""}>Profissionalizante</option>
          </select>
        </div>

        <div class="ctrl" style="min-width:220px;">
          <label>Vendedor</label>
          <select id="selVendedor" class="select">
            <option value="TODOS">Todos</option>
            ${state.vendedores
              .map(
                (v) =>
                  `<option value="${escapeAttr(v)}" ${state.vendedorSelecionado === v ? "selected" : ""}>${escapeHtml(v)}</option>`
              )
              .join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:210px;">
          <label>Janela (tempo para trás)</label>
          <select id="selJanela" class="select">
            ${WINDOW_OPTIONS.map((o) => `<option value="${o.key}" ${state.janelaKey === o.key ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:180px;">
          <label>Dias (se personalizado)</label>
          <input
            id="inpJanelaDias"
            class="input"
            type="number"
            min="1"
            step="1"
            value="${escapeAttr(String(state.janelaDiasCustom || 120))}"
            ${state.janelaKey === "CUSTOM" ? "" : "disabled"}
          />
        </div>

        <div class="ctrl" style="min-width:210px;">
          <label>Recência (faixa)</label>
          <select id="selRecencia" class="select">
            ${RECENCY_OPTIONS.map((o) => `<option value="${o.key}" ${state.recenciaSelecionada === o.key ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:210px;">
          <label>Agendamentos (faixa)</label>
          <select id="selAgFaixa" class="select">
            ${AGEND_BUCKETS.map((o) => `<option value="${o.key}" ${state.agendBucket === o.key ? "selected" : ""}>${o.label}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:320px;flex:1;">
          <label>Buscar (CPF/Nome)</label>
          <input id="inpBusca" class="input" placeholder="Digite CPF ou nome..." value="${escapeAttr(state.busca)}" />
        </div>
      </div>

      <div style="height:10px"></div>

      <div class="checkRow">
        <div class="muted small"><b>Status (Planilha):</b></div>
        <label><input type="checkbox" id="stAg" ${state.statusPlanilha.AGENDADO ? "checked" : ""}/> Agendado</label>
        <label><input type="checkbox" id="stFm" ${state.statusPlanilha.FINALIZADOM ? "checked" : ""}/> FinalizadoM</label>
        <label><input type="checkbox" id="stF" ${state.statusPlanilha.FINALIZADO ? "checked" : ""}/> Finalizado</label>
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;">
        ${renderAICard("IA • Base Total", "Visão consolidada da base filtrada", aiBase)}
        ${renderAICard("IA • Vendedor", state.vendedorSelecionado === "TODOS" ? "Selecione um vendedor para detalhar" : `Carteira de ${escapeHtml(state.vendedorSelecionado)}`, aiVendedor)}
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Classificação (dentro do Vendedor) — arraste para reordenar</h3>
      <div class="muted small" style="margin-bottom:8px;">
        Resultado sempre vem em <b>blocos por Vendedor</b>. Dentro de cada bloco, aplica a ordem abaixo (hierárquica).
      </div>
      <div id="drag" style="max-width:520px;"></div>
      <div class="muted small" style="margin-top:8px;">
        DATA_CADASTRO por dia • TOTAL_AGENDAMENTOS menor primeiro • MIDIA/CURSO por taxa de conversão de Agendado → FinalizadoM.
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <div class="rowBetween">
        <h3 style="margin:0;">Resultado (agrupado por Vendedor)</h3>
        <div class="muted small" id="resultadoInfo">Clique em <b>Gerar Lista</b>.</div>
      </div>

      <div class="tableWrap" style="margin-top:10px;">
        <table id="tbl">
          <thead>
            <tr>
              <th>#</th>
              ${renderSortableTh("Nome", "NOME")}
              ${renderSortableTh("CPF", "CPF")}
              ${renderSortableTh("Curso", "CURSO")}
              ${renderSortableTh("Mídia", "MIDIA")}
              ${renderSortableTh("Marca", "MARCA")}
              <th>Vendedor</th>
              ${renderSortableTh("Data Cad.", "DATA_CADASTRO")}
              ${renderSortableTh("Dias", "AGE_DAYS")}
              ${renderSortableTh("Agend.", "TOTAL_AGENDAMENTOS")}
              ${renderSortableTh("Status", "STATUS_PENDENTE")}
              ${ENABLE_SCORE_IA ? renderSortableTh("Score IA", "SCORE_IA") : ""}
              <th>Telefone</th>
              <th>WhatsApp</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="${ENABLE_SCORE_IA ? 14 : 13}" class="muted">Clique em <b>Gerar Lista</b>.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderDrag();
  bindUI();
}

function renderSortableTh(label, key) {
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

function renderAICard(title, subtitle, items) {
  const listHtml = (items || [])
    .map((item, index) => {
      return `
        <li style="display:grid;grid-template-columns:28px 1fr;gap:10px;align-items:flex-start;">
          <div style="width:28px;height:28px;border-radius:999px;background:#d1fae5;color:#065f46;font-weight:800;font-size:13px;display:flex;align-items:center;justify-content:center;">
            ${index + 1}
          </div>
          <div style="color:#14532d;font-size:14px;line-height:1.45;font-weight:700;">${escapeHtml(item)}</div>
        </li>
      `;
    })
    .join("");

  return `
    <div style="
      border:1px solid #bbf7d0;
      border-radius:16px;
      padding:16px;
      background:linear-gradient(180deg,#f0fdf4 0%,#dcfce7 100%);
      box-shadow:0 8px 20px rgba(22,101,52,.08);
    ">
      <div style="font-size:12px;letter-spacing:.02em;color:#166534;opacity:.9;font-weight:800;margin-bottom:4px;">
        ${escapeHtml(title)}
      </div>
      <div style="font-size:13px;color:#15803d;font-weight:700;margin-bottom:12px;">
        ${escapeHtml(subtitle)}
      </div>
      <ol style="list-style:none;padding:0;margin:0;display:grid;gap:10px;">
        ${listHtml || `<li style="color:#166534;font-weight:700;">Sem dados suficientes.</li>`}
      </ol>
    </div>
  `;
}

/* ------------------------------
   BIND UI
-------------------------------- */
function bindUI() {
  $("#selVendedor")?.addEventListener("change", (e) => {
    state.vendedorSelecionado = e.target.value || "TODOS";
    renderRoute();
  });

  $("#selMarca")?.addEventListener("change", (e) => {
    state.marcaSelecionada = e.target.value || "AMBOS";
    renderRoute();
  });

  $("#selRecencia")?.addEventListener("change", (e) => {
    state.recenciaSelecionada = e.target.value || "TODOS";
    renderRoute();
  });

  $("#selAgFaixa")?.addEventListener("change", (e) => {
    state.agendBucket = e.target.value || "TODOS";
    renderRoute();
  });

  $("#inpBusca")?.addEventListener("input", (e) => {
    state.busca = e.target.value || "";
  });

  $("#selJanela")?.addEventListener("change", (e) => {
    state.janelaKey = e.target.value || "TODOS";
    const inp = $("#inpJanelaDias");
    if (inp) inp.disabled = state.janelaKey !== "CUSTOM";
    renderRoute();
  });

  $("#inpJanelaDias")?.addEventListener("input", (e) => {
    const v = parseInt(e.target.value || "0", 10);
    state.janelaDiasCustom = Number.isFinite(v) && v > 0 ? v : 120;
  });

  $("#inpJanelaDias")?.addEventListener("change", () => {
    if (state.janelaKey === "CUSTOM") renderRoute();
  });

  $("#stAg")?.addEventListener("change", (e) => {
    state.statusPlanilha.AGENDADO = e.target.checked;
  });

  $("#stFm")?.addEventListener("change", (e) => {
    state.statusPlanilha.FINALIZADOM = e.target.checked;
  });

  $("#stF")?.addEventListener("change", (e) => {
    state.statusPlanilha.FINALIZADO = e.target.checked;
  });

  $("#btnGerar")?.addEventListener("click", gerarLista);

  $("#btnRecarregar")?.addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnExport")?.addEventListener("click", exportarListaCSV);

  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-sortkey");
      toggleTableSort(key);
      applySortAndRenderGrouped();
    });
  });
}

/* ------------------------------
   IA
-------------------------------- */
function buildBaseInsight(base) {
  if (!base.length) return ["Sem dados na base filtrada."];

  const topMidias = getTopRateLabels(state.convMidia, 2);
  const topCursos = getTopRateLabels(state.convCurso, 2);
  const conv = getAgendadoToFinalizadoRate(base);

  return [
    `Conversão Agendado → FinalizadoM da base: ${formatPct(conv)}.`,
    `Prioridade sugerida de mídia: ${topMidias.join(" • ") || "—"}.`,
    `Prioridade sugerida de curso: ${topCursos.join(" • ") || "—"}.`,
  ];
}

function buildSellerInsight(base, vendedor) {
  if (vendedor === "TODOS") {
    return [
      "Selecione um vendedor para detalhar a carteira.",
      "A IA mostrará a prioridade sugerida com base em conversão.",
      "A leitura considera Agendado que virou FinalizadoM.",
    ];
  }

  const sellerBase = base.filter((l) => (l.VENDEDOR || "").trim() === vendedor);

  if (!sellerBase.length) {
    return [
      `Sem dados para ${vendedor} nos filtros atuais.`,
      "Tente ampliar a janela ou remover filtros.",
      "Sem carteira suficiente para sugerir prioridade.",
    ];
  }

  const sellerRatesMidia = buildRateMapForField(sellerBase, "MIDIA");
  const sellerRatesCurso = buildRateMapForField(sellerBase, "CURSO");
  const conv = getAgendadoToFinalizadoRate(sellerBase);

  return [
    `${vendedor}: conversão Agendado → FinalizadoM em ${formatPct(conv)}.`,
    `Mídias prioritárias: ${getTopRateLabels(sellerRatesMidia, 2).join(" • ") || "—"}.`,
    `Cursos prioritários: ${getTopRateLabels(sellerRatesCurso, 2).join(" • ") || "—"}.`,
  ];
}

function buildRateMapForField(list, field) {
  const total = new Map();
  const conv = new Map();

  for (const item of list) {
    if (!isAgendadoOuFinalizado(item)) continue;

    const key = normalizeText(item[field] || "(vazio)");
    total.set(key, (total.get(key) || 0) + 1);

    if (isMatriculado(item)) {
      conv.set(key, (conv.get(key) || 0) + 1);
    }
  }

  const out = new Map();
  for (const [k, t] of total.entries()) {
    out.set(k, (conv.get(k) || 0) / Math.max(1, t));
  }
  return out;
}

function getTopRateLabels(map, limit = 2) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `${k} (${formatPct(v)})`);
}

function getAgendadoToFinalizadoRate(list) {
  const relevantes = list.filter(isAgendadoOuFinalizado);
  if (!relevantes.length) return 0;
  const finalizados = relevantes.filter(isMatriculado).length;
  return finalizados / relevantes.length;
}

/* ------------------------------
   DRAG & DROP
-------------------------------- */
function renderDrag() {
  const drag = $("#drag");
  if (!drag) return;

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
  if (!container) return;

  const items = container.querySelectorAll(".dragItem");

  items.forEach((item) => {
    item.addEventListener("dragstart", () => item.classList.add("dragging"));
    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      state.prioridade = [...container.querySelectorAll(".dragItem")].map((el) => el.textContent.trim());

      if (!state.tableSort.key && state.currentList?.length) {
        applySortAndRenderGrouped();
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

/* ------------------------------
   GERAR + AGRUPAR
-------------------------------- */
function gerarLista() {
  state.currentList = filtrarLista(state.all);

  const statsBase = filtrarBaseParaStats(state.all);
  computeConversionRates(statsBase);

  applySortAndRenderGrouped();

  const info = $("#resultadoInfo");
  if (info) {
    info.textContent =
      `Linhas: ${state.currentList.length} • ` +
      `Partição: VENDEDOR • Dentro: ${state.prioridade.join(" > ")}` +
      (state.tableSort.key ? ` • Sort manual: ${state.tableSort.key} ${state.tableSort.dir}` : "");
  }
}

function applySortAndRenderGrouped() {
  const groups = groupBy(state.currentList, (l) => (l.VENDEDOR || "").trim() || "(sem vendedor)");
  const vendedores = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  for (const v of vendedores) {
    if (state.tableSort.key) groups[v].sort(makeColumnComparator(state.tableSort.key, state.tableSort.dir));
    else groups[v].sort(makeHierarchicalComparator(state.prioridade));
  }

  renderTabelaGrouped(vendedores, groups);

  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    const k = btn.getAttribute("data-sortkey");
    const iconEl = btn.querySelector(".sortIcon");
    if (!iconEl) return;
    iconEl.textContent = state.tableSort.key === k ? (state.tableSort.dir === "asc" ? "▲" : "▼") : "";
  });
}

function makeHierarchicalComparator(keys) {
  return (a, b) => {
    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";
      let cmp = 0;

      if (k === "DATA_CADASTRO") {
        const ad = a.DAY_TS ?? 0;
        const bd = b.DAY_TS ?? 0;
        cmp = bd - ad;
        if (dir === "asc") cmp = -cmp;
      } else if (k === "TOTAL_AGENDAMENTOS") {
        cmp = toInt(a.TOTAL_AGENDAMENTOS) - toInt(b.TOTAL_AGENDAMENTOS);
        if (dir === "desc") cmp = -cmp;
      } else if (k === "MIDIA") {
        const ar = getRate(state.convMidia, a.MIDIA);
        const br = getRate(state.convMidia, b.MIDIA);
        cmp = br - ar;
        if (cmp === 0) {
          cmp = String(a.MIDIA || "").localeCompare(String(b.MIDIA || ""), "pt-BR", { sensitivity: "base" });
        }
        if (dir === "asc") cmp = -cmp;
      } else if (k === "CURSO") {
        const ar = getRate(state.convCurso, a.CURSO);
        const br = getRate(state.convCurso, b.CURSO);
        cmp = br - ar;
        if (cmp === 0) {
          cmp = String(a.CURSO || "").localeCompare(String(b.CURSO || ""), "pt-BR", { sensitivity: "base" });
        }
        if (dir === "asc") cmp = -cmp;
      } else {
        cmp = String(a[k] || "").localeCompare(String(b[k] || ""), "pt-BR", { sensitivity: "base" });
        if (dir === "desc") cmp = -cmp;
      }

      if (cmp !== 0) return cmp;
    }

    return 0;
  };
}

function getRate(map, key) {
  const nk = normalizeText(key || "");
  return map.get(nk) ?? 0;
}

function renderTabelaGrouped(vendedores, groups) {
  const tbody = $("#tbody");
  if (!tbody) return;

  if (!state.currentList.length) {
    tbody.innerHTML = `<tr><td colspan="${ENABLE_SCORE_IA ? 14 : 13}" class="muted">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  let rowIndex = 0;
  const html = [];

  for (const vend of vendedores) {
    const list = groups[vend] || [];
    if (!list.length) continue;

    html.push(`
      <tr>
        <td colspan="${ENABLE_SCORE_IA ? 14 : 13}" style="background:#f8fafc;border-bottom:1px solid #e5e7eb;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="font-weight:1000;">${escapeHtml(vend)}</div>
            <div style="opacity:.8;font-size:12px;">${list.length} leads</div>
          </div>
        </td>
      </tr>
    `);

    for (const l of list) {
      rowIndex += 1;
      const phoneDisplay = formatPhoneDisplay(getBestPhone(l));
      const wa = buildWhatsLink(l);
      const status = normalizeStatusLabel(l.STATUS_PENDENTE);
      const marcaLabel = normalizeMarcaLabel(l.MARCA);
      const days = Number.isFinite(l.AGE_DAYS) ? l.AGE_DAYS : "";

      html.push(`
        <tr>
          <td>${rowIndex}</td>
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
          <td>${escapeHtml(phoneDisplay || "-")}</td>
          <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener">🟢 WhatsApp</a>` : "-"}</td>
        </tr>
      `);
    }
  }

  tbody.innerHTML = html.join("");
}

/* ------------------------------
   FILTROS
-------------------------------- */
function filtrarLista(base) {
  let lista = [...base];

  const maxDays = getWindowMaxDays();
  if (maxDays != null) lista = lista.filter((l) => l.AGE_DAYS != null && l.AGE_DAYS <= maxDays);

  if (state.marcaSelecionada !== "AMBOS") {
    lista = lista.filter((l) => normalizeMarcaKey(l.MARCA) === state.marcaSelecionada);
  }

  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  }

  if (state.recenciaSelecionada !== "TODOS") {
    lista = lista.filter((l) => recencyKeyFromAge(l.AGE_DAYS) === state.recenciaSelecionada);
  }

  if (state.agendBucket !== "TODOS") {
    lista = lista.filter((l) => agendKeyFromN(toInt(l.TOTAL_AGENDAMENTOS)) === state.agendBucket);
  }

  lista = lista.filter((l) => {
    const s = normalizeStatus(l.STATUS_PENDENTE);
    if (s === "AGENDADO") return !!state.statusPlanilha.AGENDADO;
    if (s === "FINALIZADOM") return !!state.statusPlanilha.FINALIZADOM;
    if (s === "FINALIZADO") return !!state.statusPlanilha.FINALIZADO;
    return true;
  });

  const q = (state.busca || "").trim();
  if (q) {
    const qDigits = q.replace(/\D/g, "");
    const qLower = q.toLowerCase();

    lista = lista.filter((l) => {
      const cpf = String(l.CPF || "").replace(/\D/g, "");
      const nome = String(l.NOME || "").toLowerCase();
      const phone = String(getBestPhone(l) || "");
      if (qDigits && (cpf.includes(qDigits) || phone.includes(qDigits))) return true;
      if (nome.includes(qLower)) return true;
      return false;
    });
  }

  return lista;
}

function filtrarBaseParaStats(base) {
  let lista = [...base];

  const maxDays = getWindowMaxDays();
  if (maxDays != null) lista = lista.filter((l) => l.AGE_DAYS != null && l.AGE_DAYS <= maxDays);

  if (state.marcaSelecionada !== "AMBOS") {
    lista = lista.filter((l) => normalizeMarcaKey(l.MARCA) === state.marcaSelecionada);
  }

  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
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

/* ------------------------------
   CONVERSÃO MIDIA/CURSO
-------------------------------- */
function computeConversionRates(allLeadsSlice) {
  const totalM = new Map();
  const matM = new Map();
  const totalC = new Map();
  const matC = new Map();

  for (const l of allLeadsSlice) {
    if (!isAgendadoOuFinalizado(l)) continue;

    const m = normalizeText(l.MIDIA || "(vazio)");
    const c = normalizeText(l.CURSO || "(vazio)");

    totalM.set(m, (totalM.get(m) || 0) + 1);
    totalC.set(c, (totalC.get(c) || 0) + 1);

    if (isMatriculado(l)) {
      matM.set(m, (matM.get(m) || 0) + 1);
      matC.set(c, (matC.get(c) || 0) + 1);
    }
  }

  state.convMidia = new Map();
  state.convCurso = new Map();

  for (const [k, t] of totalM.entries()) {
    state.convMidia.set(k, (matM.get(k) || 0) / Math.max(1, t));
  }
  for (const [k, t] of totalC.entries()) {
    state.convCurso.set(k, (matC.get(k) || 0) / Math.max(1, t));
  }
}

/* ------------------------------
   SORT MANUAL
-------------------------------- */
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

function makeColumnComparator(key, dir) {
  const mult = dir === "desc" ? -1 : 1;

  return (a, b) => {
    let av = a[key];
    let bv = b[key];

    if (key === "TOTAL_AGENDAMENTOS" || key === "AGE_DAYS") {
      return (toInt(av) - toInt(bv)) * mult;
    }

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

/* ------------------------------
   EXPORT CSV
-------------------------------- */
function exportarListaCSV() {
  if (!state.currentList?.length) return;

  const headers = [
    "CPF",
    "NOME",
    "MARCA",
    "CURSO",
    "MIDIA",
    "VENDEDOR",
    "DATA_CADASTRO",
    "IDADE_DIAS",
    "TOTAL_AGENDAMENTOS",
    "STATUS_PENDENTE",
    "SCORE_IA",
    "TELEFONE",
    "WHATSAPP",
  ];

  const rows = [headers.join(",")];

  const groups = groupBy(state.currentList, (l) => (l.VENDEDOR || "").trim() || "(sem vendedor)");
  const vendedores = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  for (const v of vendedores) {
    const list = groups[v] || [];
    if (state.tableSort.key) list.sort(makeColumnComparator(state.tableSort.key, state.tableSort.dir));
    else list.sort(makeHierarchicalComparator(state.prioridade));

    for (const l of list) {
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
        csvCell(normalizeStatusLabel(l.STATUS_PENDENTE)),
        csvCell(l.SCORE_IA != null ? String(Number(l.SCORE_IA).toFixed(3)) : ""),
        csvCell(formatPhoneDisplay(getBestPhone(l))),
        csvCell(buildWhatsLink(l)),
      ].join(","));
    }
  }

  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gt_aria_lista_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(v) {
  const s = String(v ?? "");
  if (/[,"\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/* ------------------------------
   CSV FETCH + PARSE
-------------------------------- */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública e o gid é da aba correta.");
  }
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
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (c === "\n") {
      cur.push(field);
      field = "";
      rows.push(cur);
      cur = [];
      continue;
    }
    if (c === "\r") continue;

    field += c;
  }

  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }

  const clean = rows.filter((r) => r.some((x) => String(x || "").trim().length));
  if (!clean.length) return [];

  const headers = clean[0].map((h) => String(h || "").trim());

  return clean.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = r[idx] != null ? String(r[idx]) : "";
    });
    return obj;
  });
}

function normalizeRowKeys(row) {
  const out = { __raw: row };
  Object.keys(row).forEach((k) => {
    out[normalizeKey(k)] = row[k];
  });
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

/* ------------------------------
   NORMALIZE LEAD
-------------------------------- */
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
  const dayTs = computeDayTs(dataCad);

  return {
    ID: idx + 1,
    MARCA: get("MARCA"),
    NOME: get("NOME"),
    CPF: get("CPF"),
    VENDEDOR: get("VENDEDOR"),
    DATA_CADASTRO: dataCad,
    DAY_TS: dayTs,
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

/* ------------------------------
   SCORE IA
-------------------------------- */
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

/* ------------------------------
   HELPERS
-------------------------------- */
function normalizeStatus(s) {
  return String(s || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeStatusLabel(s) {
  const n = normalizeStatus(s);
  if (n === "FINALIZADOM") return "FinalizadoM";
  if (n === "FINALIZADO") return "Finalizado";
  if (n === "AGENDADO") return "Agendado";
  return String(s || "").trim();
}

function isMatriculado(l) {
  return normalizeStatus(l.STATUS_PENDENTE) === "FINALIZADOM";
}

function isAgendadoOuFinalizado(l) {
  const s = normalizeStatus(l.STATUS_PENDENTE);
  return s === "AGENDADO" || s === "FINALIZADOM";
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

function cleanPhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function getBestPhone(l) {
  return cleanPhone(l.FONE) || cleanPhone(l.FONE2) || cleanPhone(l.FONE3) || "";
}

function formatPhoneDisplay(phone) {
  const p = cleanPhone(phone);
  if (!p) return "";

  let local = p;
  if (local.startsWith("55") && local.length >= 12) {
    local = local.slice(2);
  }

  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }

  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }

  return local;
}

function buildWhatsLink(l) {
  const phone = getBestPhone(l);
  if (!phone) return "";

  const full = phone.startsWith("55") ? phone : `55${phone}`;
  const primeiroNome = String(l.NOME || "").trim().split(/\s+/)[0] || "";
  const curso = String(l.CURSO || "").trim();
  const mensagem = `Olá ${primeiroNome}, aqui é do Grau Técnico. Você demonstrou interesse no curso ${curso}. Podemos conversar?`;

  return `https://wa.me/${full}?text=${encodeURIComponent(mensagem)}`;
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

function computeDayTs(dataCadastro) {
  const t = toDate(dataCadastro);
  if (!t) return 0;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
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

function groupBy(arr, fnKey) {
  const m = {};
  for (const x of arr) {
    const k = fnKey(x);
    (m[k] ||= []).push(x);
  }
  return m;
}

function unique(arr) {
  return [...new Set(arr)];
}

function formatDateTime(d) {
  try {
    return d.toLocaleString("pt-BR");
  } catch {
    return String(d);
  }
}

function formatInt(n) {
  return Number(n || 0).toLocaleString("pt-BR");
}

function formatPct(v) {
  return `${(Number(v || 0) * 100).toFixed(1)}%`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

/* ------------------------------
   LOADING / ERROR
-------------------------------- */
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
  if (!view) return;

  view.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;color:#8b0000;">Erro</h2>
      <div style="white-space:pre-wrap;font-family:monospace;font-size:12px;">${escapeHtml(String(err))}</div>
      <div style="height:10px"></div>
      <button id="btnTentar" class="btn btnGhost">Tentar novamente</button>
    </div>
  `;

  $("#btnTentar")?.addEventListener("click", async () => {
    await boot();
    renderRoute();
  });
}
