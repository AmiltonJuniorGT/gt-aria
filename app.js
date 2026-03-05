/* ================================
   GT ARIA — HUB Comercial (Qualificação)
   Base: Google Sheets CSV (gviz)
   Melhorias:
   1) Score real de conversão (FinalizadoM)
   2) Heatmap Curso x Mídia (top pares)
   3) Contato rápido (WhatsApp + copiar)
   + Ordenar por colunas (clique no header)
=================================== */

/** ✅ SUA BASE ATUAL */
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/gviz/tq?tqx=out:csv&gid=1731723852";

/** Coluna que define conversão */
const CONVERSAO_STATUS = "FINALIZADOM"; // STATUS_PENDENTE == FinalizadoM

/** Campos “padrão” do app */
const FIELDS = {
  MARCA: "MARCA",
  NOME: "NOME",
  CURSO: "CURSO",
  MIDIA: "MIDIA",
  CPF: "CPF",
  VENDEDOR: "VENDEDOR",
  DATA_CADASTRO: "DATA_CADASTRO",
  DATA_AGENDAMENTO: "DATA_AGENDAMENTO",
  TOTAL_AGENDAMENTOS: "TOTAL_AGENDAMENTOS",
  STATUS_PENDENTE: "STATUS_PENDENTE",
};

/** “Classificação por camadas” (dentro do vendedor) */
const DEFAULT_PRIORIDADE = [
  "DATA_CADASTRO",          // mais recente primeiro
  "TOTAL_AGENDAMENTOS",     // menor primeiro
  "MIDIA",                  // melhor conversão primeiro (IA)
  "CURSO",                  // melhor conversão primeiro (IA)
];

/** Direções base */
const SORT_DIR = {
  DATA_CADASTRO: "desc",
  TOTAL_AGENDAMENTOS: "asc",
  MIDIA: "desc", // aqui “desc” significa: melhor conversão primeiro (usando score)
  CURSO: "desc", // idem
  NOME: "asc",
  CPF: "asc",
  MARCA: "asc",
  VENDEDOR: "asc",
  STATUS_PENDENTE: "asc",
};

const state = {
  loading: false,
  error: "",
  lastUpdated: null,

  all: [],       // todas as linhas (normalizadas)
  filtered: [],  // base filtrada (para KPIs e IA)
  leads: [],     // lista final (não matriculados, e status conforme filtro)

  vendedores: [],
  marcas: [],

  // filtros
  filtroMarca: "TODAS",                 // TODAS | TECNICO | PROFISSIONALIZANTE
  filtroVendedor: "TODOS",
  filtroBusca: "",
  filtroJanela: "365",                  // 30, 90, 180, 365, custom
  filtroDiasCustom: 120,
  filtroRecenciaFaixa: "TODOS",         // TODOS | NOVOS_30 | 31_90 | 91_180 | 181_365 | 366_MAIS
  filtroAgendFaixa: "TODOS",            // TODOS | 0 | 1 | 2_3 | 4_MAIS
  statusSelecionados: new Set(["AGENDADO"]), // Status (Planilha) default
  // (no futuro: Etapa HUB, etc)

  // classificação
  prioridade: [...DEFAULT_PRIORIDADE],
  headerSort: { key: null, dir: "asc" }, // ordenação por clique na tabela

  // IA (rates)
  ratesMidia: new Map(),
  ratesCurso: new Map(),
  ratesPar: new Map(), // "CURSO|||MIDIA" => {rate, total, conv}
};

const $ = (sel) => document.querySelector(sel);

init();

/* ------------------------------
   INIT
-------------------------------- */
function init() {
  window.addEventListener("hashchange", renderRoute);

  window.addEventListener("load", async () => {
    bindTopbar();
    await boot();
    renderRoute();
  });

  // sidebar
  document.querySelectorAll("[data-route]").forEach((a) => {
    a.addEventListener("click", () => {
      location.hash = a.getAttribute("data-route");
    });
  });
}

function bindTopbar() {
  const btnR = $("#btnRecarregarTop");
  const btnG = $("#btnGerarTop");
  const btnE = $("#btnExportTop");

  if (btnR) btnR.addEventListener("click", async () => { await boot(); renderRoute(); });
  if (btnG) btnG.addEventListener("click", () => gerarLista());
  if (btnE) btnE.addEventListener("click", () => exportarCSV());
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

    // listas
    state.vendedores = unique(
      state.all.map((x) => (x.VENDEDOR || "").trim()).filter(Boolean)
    ).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

    state.marcas = unique(
      state.all.map((x) => (x.MARCA || "").trim()).filter(Boolean)
    ).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

    // IA rates (com base TOTAL — depois filtramos a “visão” por janela/marca também)
    computeRates(state.all);

    state.lastUpdated = new Date();
    state.loading = false;
    state.error = "";
  } catch (e) {
    state.loading = false;
    state.error = String(e?.message || e);
  }
}

/* ------------------------------
   ROUTES
-------------------------------- */
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
  view.innerHTML = `
    <div class="section">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <div style="color:var(--muted);font-weight:700">Tela em construção.</div>
    </div>
  `;
}

/* ------------------------------
   QUALIFICAÇÃO
-------------------------------- */
function renderQualificacao() {
  const view = $("#view");
  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  // aplica filtros para KPIs/IA (mesmo antes de gerar lista)
  const baseFiltrada = applyFiltersBase(state.all);
  state.filtered = baseFiltrada;

  const totalBase = state.all.length;
  const totalFiltrada = baseFiltrada.length;
  const totalConv = baseFiltrada.filter(isConvertido).length;
  const convRate = totalFiltrada ? (totalConv / totalFiltrada) : 0;

  // IA “visão” baseada na base filtrada
  const ia = computeIASummary(baseFiltrada);

  view.innerHTML = `
    <div class="section">
      <div class="hTitleRow">
        <div>
          <h1 class="hTitle">Qualificação de Leads (HUB)</h1>
          <div class="hMeta">
            Base: <b>${formatInt(totalBase)}</b> •
            Base filtrada: <b>${formatInt(totalFiltrada)}</b> •
            Matriculou (${CONVERSAO_STATUS}): <b>${formatInt(totalConv)}</b> •
            Conversão: <b>${formatPct(convRate)}</b>
            ${state.lastUpdated ? ` • Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
          <div class="hMeta" style="margin-top:6px;">
            Partição fixa: <b>VENDEDOR</b> • Dentro do vendedor: ordenação hierárquica por camadas.
          </div>
        </div>
      </div>

      <div class="kpiGrid">
        <div class="kpiCard">
          <div class="kpiTitle">Base Total</div>
          <div class="kpiValue">${formatInt(totalBase)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Base Filtrada</div>
          <div class="kpiValue">${formatInt(totalFiltrada)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Matriculou (FinalizadoM)</div>
          <div class="kpiValue">${formatInt(totalConv)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Conversão</div>
          <div class="kpiValue">${formatPct(convRate)}</div>
        </div>
      </div>

      <div class="filtersGrid">
        <div class="field">
          <div class="label">Marca</div>
          <select id="selMarca">
            ${renderMarcaOptions()}
          </select>
        </div>

        <div class="field">
          <div class="label">Janela (tempo para trás)</div>
          <select id="selJanela">
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="180">Últimos 180 dias</option>
            <option value="365">Últimos 365 dias</option>
            <option value="CUSTOM">Personalizado</option>
          </select>
        </div>

        <div class="field">
          <div class="label">Dias (se personalizado)</div>
          <input id="inpDias" type="number" min="1" step="1" value="${escapeAttr(String(state.filtroDiasCustom))}" />
        </div>

        <div class="field">
          <div class="label">Vendedor</div>
          <select id="selVendedor">
            ${renderVendedorOptions()}
          </select>
        </div>

        <div class="field">
          <div class="label">Recência (faixa)</div>
          <select id="selRecencia">
            <option value="TODOS">Todos</option>
            <option value="NOVOS_30">0–30 dias</option>
            <option value="31_90">31–90 dias</option>
            <option value="91_180">91–180 dias</option>
            <option value="181_365">181–365 dias</option>
            <option value="366_MAIS">+365 dias</option>
          </select>
        </div>

        <div class="field">
          <div class="label">Agendamentos (faixa)</div>
          <select id="selAgend">
            <option value="TODOS">Todos</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2_3">2–3</option>
            <option value="4_MAIS">4+</option>
          </select>
        </div>

        <div class="field" style="grid-column: span 2;">
          <div class="label">Buscar (CPF/Nome)</div>
          <input id="inpBusca" placeholder="Digite CPF ou nome..." value="${escapeAttr(state.filtroBusca || "")}" />
        </div>
      </div>

      <div class="inlineChecks">
        <div style="font-weight:900;color:var(--muted)">Status (Planilha):</div>

        ${renderStatusCheck("AGENDADO", "Agendado")}
        ${renderStatusCheck("FINALIZADOM", "FinalizadoM")}
        ${renderStatusCheck("FINALIZADO", "Finalizado")}
      </div>
    </div>

    <div class="section">
      <h3 class="aiTitle">Sugestões da IA (baseado na janela/marca selecionadas)</h3>

      <div class="aiGrid">
        <div class="aiCard">
          <div class="aiCardTitle">Ordem sugerida (dentro do vendedor)</div>
          <div class="aiCardText">${escapeHtml(ia.ordemSugerida)}</div>
        </div>

        <div class="aiCard">
          <div class="aiCardTitle">Top Mídias (conversão e volume)</div>
          <div class="aiCardText">${escapeHtml(ia.topMidias)}</div>
        </div>

        <div class="aiCard">
          <div class="aiCardTitle">Top Cursos (conversão e volume)</div>
          <div class="aiCardText">${escapeHtml(ia.topCursos)}</div>
        </div>
      </div>

      <div class="aiNote">
        Heatmap (Curso × Mídia): melhores pares por conversão (com volume mínimo).
      </div>

      <div class="tableWrap" style="margin-top:10px;">
        <table>
          <thead>
            <tr>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Conversão</th>
              <th>Total</th>
              <th>Matriculou</th>
            </tr>
          </thead>
          <tbody>
            ${ia.heatmapRows || `<tr><td colspan="5" style="color:var(--muted);font-weight:700;padding:12px;">Sem dados suficientes para heatmap (ou volume mínimo não atingido).</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="aiNote" style="margin-top:10px;">
        A IA sugere, mas quem decide é você (arraste a ordem abaixo). Clique em colunas da tabela para ordenar rapidamente também.
      </div>
    </div>

    <div class="section">
      <h3 style="margin:0;font-weight:900;">Prioridade de Ordenação (arraste)</h3>
      <div style="color:var(--muted);font-weight:700;margin-top:6px;">
        Dentro do vendedor: 1ª camada = 1º campo • 2ª camada = 2º campo… (hierárquico).
      </div>

      <div class="dragWrap" id="drag"></div>
      <div style="color:var(--muted);font-weight:700;margin-top:6px;">
        Direções: <b>DATA_CADASTRO desc</b> • <b>TOTAL_AGENDAMENTOS asc</b> • <b>MÍDIA/CURSO</b> por melhor conversão • demais asc
      </div>
    </div>

    <div class="section result">
      <div class="hTitleRow">
        <div>
          <h3 style="margin:0;font-weight:900;">Resultado</h3>
          <div id="resultadoInfo" class="hMeta">Clique em <b>Gerar Lista</b>.</div>
        </div>
        <div class="hubButtons">
          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerarLista" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExportar" class="btn btnGhost">Exportar (CSV)</button>
        </div>
      </div>

      <div id="resultadoArea" style="margin-top:12px;"></div>
    </div>
  `;

  // set selects values
  $("#selMarca").value = state.filtroMarca;
  $("#selVendedor").value = state.filtroVendedor;
  $("#selRecencia").value = state.filtroRecenciaFaixa;
  $("#selAgend").value = state.filtroAgendFaixa;

  // janela
  $("#selJanela").value = (state.filtroJanela === "CUSTOM") ? "CUSTOM" : String(state.filtroJanela);

  // bind filtros
  $("#selMarca").addEventListener("change", (e) => { state.filtroMarca = e.target.value; renderRoute(); });
  $("#selVendedor").addEventListener("change", (e) => { state.filtroVendedor = e.target.value; renderRoute(); });
  $("#inpBusca").addEventListener("input", (e) => { state.filtroBusca = e.target.value; /* não re-rendera toda hora */ });
  $("#selRecencia").addEventListener("change", (e) => { state.filtroRecenciaFaixa = e.target.value; renderRoute(); });
  $("#selAgend").addEventListener("change", (e) => { state.filtroAgendFaixa = e.target.value; renderRoute(); });

  $("#selJanela").addEventListener("change", (e) => {
    const v = e.target.value;
    state.filtroJanela = (v === "CUSTOM") ? "CUSTOM" : Number(v);
    renderRoute();
  });

  $("#inpDias").addEventListener("change", (e) => {
    state.filtroDiasCustom = clampInt(e.target.value, 1, 99999, 120);
    renderRoute();
  });

  // status checks
  ["AGENDADO","FINALIZADOM","FINALIZADO"].forEach((k) => {
    const el = document.querySelector(`#chk_${k}`);
    if (!el) return;
    el.checked = state.statusSelecionados.has(k);
    el.addEventListener("change", () => {
      if (el.checked) state.statusSelecionados.add(k);
      else state.statusSelecionados.delete(k);
      renderRoute();
    });
  });

  // drag
  renderDrag();

  // buttons
  $("#btnGerarLista").addEventListener("click", () => gerarLista());
  $("#btnRecarregar").addEventListener("click", async () => { await boot(); renderRoute(); });
  $("#btnExportar").addEventListener("click", () => exportarCSV());

  // topbar buttons mirror
  const btnTopG = $("#btnGerarTop");
  const btnTopE = $("#btnExportTop");
  if (btnTopG) btnTopG.onclick = () => gerarLista();
  if (btnTopE) btnTopE.onclick = () => exportarCSV();

  // dica: gerar automaticamente uma primeira lista (opcional)
  // gerarLista();
}

/* ------------------------------
   GERAR LISTA (com camadas + sort por colunas)
-------------------------------- */
function gerarLista() {
  // base filtrada (para a lista)
  let base = applyFiltersBase(state.all);

  // status selecionados
  base = base.filter((l) => state.statusSelecionados.has(normalizeStatus(l.STATUS_PENDENTE)));

  // regra: normalmente o HUB trabalha mais “não matriculados”,
  // mas você pediu poder combinar os 3 status. Então NÃO removo FinalizadoM aqui.
  // Se quiser "somente não matriculados", descomente:
  // base = base.filter((l)=> !isConvertido(l));

  // busca (CPF/Nome)
  const q = (state.filtroBusca || "").trim().toLowerCase();
  if (q) {
    base = base.filter((l) => {
      const cpf = (l.CPF || "").toLowerCase();
      const nome = (l.NOME || "").toLowerCase();
      return cpf.includes(q) || nome.includes(q);
    });
  }

  // score real por lead (baseado nas taxas pré-calculadas)
  base.forEach((l) => l.SCORE = computeLeadScore(l));

  // agrupa por vendedor (partição fixa)
  const groups = groupBy(base, (l) => (l.VENDEDOR || "(Sem vendedor)").trim() || "(Sem vendedor)");

  // ordena vendedores
  const vendorNames = Object.keys(groups).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

  // render
  const area = $("#resultadoArea");
  const info = $("#resultadoInfo");

  // header sort (clique na tabela)
  const headerKey = state.headerSort.key;
  const headerDir = state.headerSort.dir;

  let totalLinhas = 0;

  const blocks = vendorNames.map((vend) => {
    let list = groups[vend] || [];

    // aplica ordenação por camadas (prioridade arrastável)
    list.sort(makeLayerComparator(state.prioridade));

    // se clicou num header, reordena dentro do vendedor por aquele campo
    if (headerKey) {
      list.sort(makeHeaderComparator(headerKey, headerDir));
    }

    totalLinhas += list.length;

    return `
      <div class="vendorBlock">
        <div class="vendorHeader">
          <div>${escapeHtml(vend)}</div>
          <small>${formatInt(list.length)} leads</small>
        </div>
        <div class="tableWrap">
          ${renderTabela(list)}
        </div>
      </div>
    `;
  }).join("");

  area.innerHTML = blocks || `<div style="color:var(--muted);font-weight:800;">Nenhum lead com os filtros atuais.</div>`;

  info.innerHTML = `
    Linhas: <b>${formatInt(totalLinhas)}</b> •
    Prioridade: <b>${state.prioridade.join(" > ")}</b>
    ${headerKey ? ` • Ordenação rápida: <b>${headerKey} ${headerDir.toUpperCase()}</b>` : ""}
  `;

  // bind header clicks (depois de render)
  bindHeaderSort();
  bindActionButtons();
}

/* ------------------------------
   TABELA + SORT POR COLUNA
-------------------------------- */
function renderTabela(lista) {
  // headers com indicador
  const hdr = (k, label) => {
    const active = state.headerSort.key === k;
    const arrow = active ? (state.headerSort.dir === "asc" ? "▲" : "▼") : "↕";
    return `<th data-sort="${escapeAttr(k)}">${escapeHtml(label)} <span class="sort">${arrow}</span></th>`;
  };

  const rows = lista.map((l, i) => {
    const st = normalizeStatus(l.STATUS_PENDENTE);
    const badge = st === "FINALIZADOM" ? "ok" : (st === "FINALIZADO" ? "danger" : "warn");

    const phone = pickPhone(l);
    const wa = phone ? whatsappLink(phone, l.NOME) : null;

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(l.NOME || "")}</td>
        <td>${escapeHtml(l.CPF || "")}</td>
        <td>${escapeHtml(l.CURSO || "")}</td>
        <td>${escapeHtml(l.MIDIA || "")}</td>
        <td>${escapeHtml(l.MARCA || "")}</td>
        <td>${escapeHtml(l.DATA_CADASTRO || "")}</td>
        <td>${formatInt(toInt(l.TOTAL_AGENDAMENTOS))}</td>
        <td><span class="badge ${badge}">${escapeHtml(l.STATUS_PENDENTE || "")}</span></td>
        <td>${(l.SCORE != null ? formatPct(l.SCORE) : "")}</td>
        <td class="actions">
          ${wa ? `<a class="iconBtn" href="${escapeAttr(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : `<button class="iconBtn" disabled>WhatsApp</button>`}
          <button class="iconBtn" data-copy="${escapeAttr(phone || "")}">Copiar Fone</button>
          <button class="iconBtn" data-copy="${escapeAttr(l.CPF || "")}">Copiar CPF</button>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>#</th>
          ${hdr("NOME","Nome")}
          ${hdr("CPF","CPF")}
          ${hdr("CURSO","Curso")}
          ${hdr("MIDIA","Mídia")}
          ${hdr("MARCA","Marca")}
          ${hdr("DATA_CADASTRO","Data Cad.")}
          ${hdr("TOTAL_AGENDAMENTOS","Agend.")}
          ${hdr("STATUS_PENDENTE","Status")}
          ${hdr("SCORE","Score")}
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="11" style="color:var(--muted);font-weight:800;">Sem linhas.</td></tr>`}
      </tbody>
    </table>
  `;
}

function bindHeaderSort() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (!key) return;

      if (state.headerSort.key === key) {
        state.headerSort.dir = (state.headerSort.dir === "asc") ? "desc" : "asc";
      } else {
        state.headerSort.key = key;
        state.headerSort.dir = (SORT_DIR[key] || "asc");
      }
      gerarLista();
    });
  });
}

function bindActionButtons() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const txt = btn.getAttribute("data-copy") || "";
      if (!txt) return;
      try{
        await navigator.clipboard.writeText(txt);
        btn.textContent = "Copiado!";
        setTimeout(()=> btn.textContent = btn.getAttribute("data-copy")?.includes("@") ? "Copiar" : (btn.textContent.includes("CPF") ? "Copiar CPF" : "Copiar Fone"), 800);
      } catch {
        // fallback
        prompt("Copie:", txt);
      }
    });
  });
}

/* ------------------------------
   EXPORT CSV (resultado atual)
-------------------------------- */
function exportarCSV() {
  // exporta a última lista (regera com filtros atuais)
  // (sem depender do DOM)
  let base = applyFiltersBase(state.all)
    .filter((l) => state.statusSelecionados.has(normalizeStatus(l.STATUS_PENDENTE)));

  const q = (state.filtroBusca || "").trim().toLowerCase();
  if (q) {
    base = base.filter((l) => ((l.CPF||"").toLowerCase().includes(q) || (l.NOME||"").toLowerCase().includes(q)));
  }

  base.forEach((l) => l.SCORE = computeLeadScore(l));

  // agrupa por vendedor e ordena
  const groups = groupBy(base, (l) => (l.VENDEDOR || "(Sem vendedor)").trim() || "(Sem vendedor)");
  const vendorNames = Object.keys(groups).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

  const out = [];
  vendorNames.forEach((v) => {
    let list = groups[v] || [];
    list.sort(makeLayerComparator(state.prioridade));

    if (state.headerSort.key) {
      list.sort(makeHeaderComparator(state.headerSort.key, state.headerSort.dir));
    }

    list.forEach((l) => out.push(l));
  });

  const cols = [
    "VENDEDOR","NOME","CPF","MARCA","CURSO","MIDIA",
    "DATA_CADASTRO","TOTAL_AGENDAMENTOS","STATUS_PENDENTE","SCORE"
  ];

  const csv = [
    cols.join(","),
    ...out.map((l) => cols.map((c) => csvEscape(l[c])).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `gt-aria_hub_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------
   CLASSIFICAÇÃO POR CAMADAS
-------------------------------- */
function makeLayerComparator(keys) {
  return (a, b) => {
    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";

      let cmp = 0;

      if (k === "TOTAL_AGENDAMENTOS") {
        cmp = toInt(a.TOTAL_AGENDAMENTOS) - toInt(b.TOTAL_AGENDAMENTOS);
      } else if (k === "DATA_CADASTRO") {
        cmp = toDate(a.DATA_CADASTRO) - toDate(b.DATA_CADASTRO);
        // como queremos DESC (mais recente primeiro), inverte depois:
        cmp = -cmp;
        if (dir === "asc") cmp = -cmp; // se alguém mudar no futuro
      } else if (k === "MIDIA") {
        cmp = (rateMidia(b.MIDIA) - rateMidia(a.MIDIA)); // melhor primeiro
        if (dir === "asc") cmp = -cmp;
        if (cmp === 0) cmp = str(a.MIDIA).localeCompare(str(b.MIDIA), "pt-BR", {sensitivity:"base"});
      } else if (k === "CURSO") {
        cmp = (rateCurso(b.CURSO) - rateCurso(a.CURSO)); // melhor primeiro
        if (dir === "asc") cmp = -cmp;
        if (cmp === 0) cmp = str(a.CURSO).localeCompare(str(b.CURSO), "pt-BR", {sensitivity:"base"});
      } else {
        cmp = str(a[k]).localeCompare(str(b[k]), "pt-BR", { sensitivity: "base" });
        if (dir === "desc") cmp = -cmp;
      }

      if (cmp !== 0) return cmp;
    }

    // desempate final: score, depois nome
    const s = (b.SCORE||0) - (a.SCORE||0);
    if (s !== 0) return s;
    return str(a.NOME).localeCompare(str(b.NOME), "pt-BR", {sensitivity:"base"});
  };
}

function makeHeaderComparator(key, dir) {
  return (a,b) => {
    let cmp = 0;

    if (key === "TOTAL_AGENDAMENTOS") {
      cmp = toInt(a.TOTAL_AGENDAMENTOS) - toInt(b.TOTAL_AGENDAMENTOS);
    } else if (key === "DATA_CADASTRO") {
      cmp = toDate(a.DATA_CADASTRO) - toDate(b.DATA_CADASTRO);
    } else if (key === "SCORE") {
      cmp = (a.SCORE||0) - (b.SCORE||0);
    } else {
      cmp = str(a[key]).localeCompare(str(b[key]), "pt-BR", {sensitivity:"base"});
    }

    return (dir === "desc") ? -cmp : cmp;
  };
}

/* ------------------------------
   IA — RATES, SCORE, HEATMAP
-------------------------------- */
function computeRates(all) {
  // taxa por mídia, curso e par (curso|mídia)
  const mid = new Map(); // key -> {t,c}
  const cur = new Map();
  const par = new Map();

  for (const l of all) {
    const m = normKey(str(l.MIDIA) || "(vazio)");
    const c = normKey(str(l.CURSO) || "(vazio)");
    const p = `${c}|||${m}`;

    addCount(mid, m, isConvertido(l));
    addCount(cur, c, isConvertido(l));
    addCount(par, p, isConvertido(l));
  }

  state.ratesMidia = toRateMap(mid);
  state.ratesCurso = toRateMap(cur);

  // ratesPar precisa manter volume
  state.ratesPar = new Map();
  for (const [k, v] of par.entries()) {
    const rate = v.c / Math.max(1, v.t);
    state.ratesPar.set(k, { rate, total: v.t, conv: v.c });
  }
}

function computeLeadScore(l) {
  // score 0..1 combinando:
  // (mídia 45%) + (curso 45%) + (agend 10% inverso)
  const rm = rateMidia(l.MIDIA);
  const rc = rateCurso(l.CURSO);

  // quanto MENOS agendamentos, melhor (menos “energia” já gasta)
  const ag = toInt(l.TOTAL_AGENDAMENTOS);
  const agScore = 1 - clamp(ag / 6, 0, 1); // 0..6+

  // recência (mais recente melhor) — leve peso
  const days = daysSince(l.DATA_CADASTRO);
  const rec = 1 - clamp(days / 365, 0, 1);

  // ponderação final (ajustável)
  const score = (rm * 0.35) + (rc * 0.35) + (agScore * 0.12) + (rec * 0.18);
  return clamp(score, 0, 1);
}

function computeIASummary(baseFiltrada) {
  // calcula top midias/cursos e heatmap “da visão atual”
  // (usa STATUS_PENDENTE == FinalizadoM como conversão)
  const mid = new Map();
  const cur = new Map();
  const par = new Map();

  for (const l of baseFiltrada) {
    const m = displayKey(l.MIDIA) || "(vazio)";
    const c = displayKey(l.CURSO) || "(vazio)";
    const p = `${c}|||${m}`;
    addCount(mid, m, isConvertido(l));
    addCount(cur, c, isConvertido(l));
    addCount(par, p, isConvertido(l));
  }

  const topMid = topRateList(mid, 5, 20);
  const topCur = topRateList(cur, 5, 20);

  const heatRows = topRatePairs(par, 10, 25).map((x) => {
    return `
      <tr>
        <td>${escapeHtml(x.curso)}</td>
        <td>${escapeHtml(x.midia)}</td>
        <td>${escapeHtml(formatPct(x.rate))}</td>
        <td>${escapeHtml(formatInt(x.total))}</td>
        <td>${escapeHtml(formatInt(x.conv))}</td>
      </tr>
    `;
  }).join("");

  // ordem sugerida (heurística simples)
  // se recência pesa mais e agend baixo, manter: DATA > AGEND > MIDIA > CURSO
  const ordem = "DATA_CADASTRO > TOTAL_AGENDAMENTOS > MIDIA > CURSO";

  return {
    ordemSugerida: ordem,
    topMidias: topMid.length ? topMid.join(" • ") : "—",
    topCursos: topCur.length ? topCur.join(" • ") : "—",
    heatmapRows: heatRows,
  };
}

function rateMidia(m) {
  const k = normKey(displayKey(m) || "(vazio)");
  return state.ratesMidia.get(k) || 0;
}
function rateCurso(c) {
  const k = normKey(displayKey(c) || "(vazio)");
  return state.ratesCurso.get(k) || 0;
}

/* ------------------------------
   FILTROS (KPIs seguem filtros)
-------------------------------- */
function applyFiltersBase(all) {
  let list = [...all];

  // marca
  if (state.filtroMarca !== "TODAS") {
    const alvo = normKey(state.filtroMarca);
    list = list.filter((l) => normKey(l.MARCA) === alvo);
  }

  // vendedor
  if (state.filtroVendedor !== "TODOS") {
    list = list.filter((l) => (l.VENDEDOR || "").trim() === state.filtroVendedor);
  }

  // janela (tempo para trás)
  const janelaDias = (state.filtroJanela === "CUSTOM") ? state.filtroDiasCustom : Number(state.filtroJanela || 365);
  list = list.filter((l) => {
    const d = daysSince(l.DATA_CADASTRO);
    return d >= 0 && d <= janelaDias;
  });

  // recência faixa
  list = list.filter((l) => {
    const d = daysSince(l.DATA_CADASTRO);
    switch (state.filtroRecenciaFaixa) {
      case "NOVOS_30": return d <= 30;
      case "31_90": return d >= 31 && d <= 90;
      case "91_180": return d >= 91 && d <= 180;
      case "181_365": return d >= 181 && d <= 365;
      case "366_MAIS": return d >= 366;
      default: return true;
    }
  });

  // agendamentos faixa
  list = list.filter((l) => {
    const a = toInt(l.TOTAL_AGENDAMENTOS);
    switch (state.filtroAgendFaixa) {
      case "0": return a === 0;
      case "1": return a === 1;
      case "2_3": return a >= 2 && a <= 3;
      case "4_MAIS": return a >= 4;
      default: return true;
    }
  });

  return list;
}

/* ------------------------------
   DRAG & DROP prioridade
-------------------------------- */
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
   CSV FETCH + PARSE
-------------------------------- */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública.");
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

/* ------------------------------
   NORMALIZAÇÃO LEAD
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

  const lead = {
    ID: idx + 1,
    MARCA: get("MARCA"),
    NOME: get("NOME", "NOME_LEAD", "ALUNO", "NOME_COMPLETO"),
    CURSO: get("CURSO", "CURSO_INTERESSE", "CURSO_DE_INTERESSE"),
    MIDIA: get("MIDIA", "MÍDIA", "ORIGEM", "FONTE", "CANAL"),
    CPF: get("CPF"),
    VENDEDOR: get("VENDEDOR", "CONSULTOR", "RESPONSAVEL"),
    DATA_CADASTRO: get("DATA_CADASTRO", "DT_CADASTRO", "DATA_DE_CADASTRO"),
    DATA_AGENDAMENTO: get("DATA_AGENDAMENTO", "DT_AGENDAMENTO"),
    TOTAL_AGENDAMENTOS: toInt(get("TOTAL_AGENDAMENTOS", "AGENDAMENTOS", "QTD_AGENDAMENTOS")),
    STATUS_PENDENTE: get("STATUS_PENDENTE", "STATUS_PENDENCIA", "STATUS"),
    FONE: get("FONE"),
    FONE2: get("FONE2"),
    FONE3: get("FONE3"),
    SCORE: null,
  };

  return lead;
}

function normalizeStatus(v) {
  return String(v||"").trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g,"");
}

function isConvertido(l) {
  return normalizeStatus(l.STATUS_PENDENTE) === CONVERSAO_STATUS;
}

/* ------------------------------
   RENDER HELPERS
-------------------------------- */
function renderLoading(msg) {
  const view = $("#view");
  if (!view) return;
  view.innerHTML = `
    <div class="section">
      <div style="font-weight:900;font-size:16px;margin-bottom:6px;">${escapeHtml(msg || "Carregando…")}</div>
      <div style="color:var(--muted);font-weight:700;">Aguarde.</div>
    </div>
  `;
}

function renderError(err) {
  const view = $("#view");
  view.innerHTML = `
    <div class="section">
      <h2 style="margin:0 0 8px 0;color:#8b0000;">Erro</h2>
      <div style="white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;">${escapeHtml(String(err))}</div>
      <div style="margin-top:10px;color:var(--muted);font-weight:700;">
        Dica: confirme se a planilha está pública e se o <b>gid</b> é da aba correta.
      </div>
      <button id="btnTentar" class="btn btnPrimary" style="margin-top:12px;">Tentar novamente</button>
    </div>
  `;
  $("#btnTentar").addEventListener("click", async () => { await boot(); renderRoute(); });
}

function renderVendedorOptions() {
  const opts = [`<option value="TODOS">Todos</option>`].concat(
    state.vendedores.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`)
  );
  return opts.join("");
}

function renderMarcaOptions() {
  // força os 3 estados que você quer:
  const opts = [
    `<option value="TODAS">Ambos</option>`,
    `<option value="TECNICO">Técnico</option>`,
    `<option value="PROFISSIONALIZANTE">Profissionalizante</option>`,
  ];
  return opts.join("");
}

function renderStatusCheck(key, label) {
  const checked = state.statusSelecionados.has(key) ? "checked" : "";
  return `
    <label class="chk">
      <input type="checkbox" id="chk_${escapeAttr(key)}" ${checked} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

/* ------------------------------
   UTIL / FORMAT
-------------------------------- */
function toInt(v) {
  const n = parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  const s = String(v || "").trim();
  if (!s) return new Date("1970-01-01").getTime();

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;

  // BR dd/mm/yyyy (com ou sem hora)
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

  return new Date("1970-01-01").getTime();
}

function daysSince(dateStr) {
  const t = toDate(dateStr);
  const now = Date.now();
  const d = Math.floor((now - t) / (1000 * 60 * 60 * 24));
  return Number.isFinite(d) ? Math.max(0, d) : 999999;
}

function unique(arr) { return [...new Set(arr)]; }

function formatDateTime(d) {
  try { return d.toLocaleString("pt-BR"); } catch { return String(d); }
}

function formatInt(n) {
  const x = Number(n || 0);
  return x.toLocaleString("pt-BR");
}

function formatPct(x) {
  const v = Number(x || 0);
  return (v * 100).toFixed(1) + "%";
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

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampInt(v, a, b, def) {
  const n = parseInt(String(v||""),10);
  return Number.isFinite(n) ? clamp(n,a,b) : def;
}
function str(v){ return String(v || ""); }
function normKey(v){
  return String(v||"").trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ");
}
function displayKey(v){ return String(v||"").trim(); }

/* ------------------------------
   MAPS / GROUPS
-------------------------------- */
function groupBy(arr, fn) {
  const out = {};
  arr.forEach((x) => {
    const k = fn(x);
    (out[k] ||= []).push(x);
  });
  return out;
}

function addCount(map, key, isConv) {
  const cur = map.get(key) || { t: 0, c: 0 };
  cur.t += 1;
  if (isConv) cur.c += 1;
  map.set(key, cur);
}

function toRateMap(countMap) {
  const out = new Map();
  for (const [k, v] of countMap.entries()) {
    out.set(normKey(k), v.c / Math.max(1, v.t));
  }
  return out;
}

function topRateList(countMap, limit = 5, minTotal = 20) {
  const arr = [];
  for (const [k, v] of countMap.entries()) {
    if (v.t < minTotal) continue;
    const rate = v.c / Math.max(1, v.t);
    arr.push({ k, rate, t: v.t });
  }
  arr.sort((a,b)=> (b.rate - a.rate) || (b.t - a.t));
  return arr.slice(0, limit).map((x)=> `${x.k} (${formatPct(x.rate)} • ${formatInt(x.t)})`);
}

function topRatePairs(pairMap, limit=10, minTotal=25) {
  const arr = [];
  for (const [k, v] of pairMap.entries()) {
    if (v.t < minTotal) continue;
    const rate = v.c / Math.max(1, v.t);
    const [curso, midia] = String(k).split("|||");
    arr.push({ curso, midia, rate, total: v.t, conv: v.c });
  }
  arr.sort((a,b)=> (b.rate - a.rate) || (b.total - a.total));
  return arr.slice(0, limit);
}

/* ------------------------------
   CONTATO
-------------------------------- */
function cleanPhone(v) {
  const s = String(v||"").replace(/[^\d]/g,"");
  if (!s) return "";
  // se vier com DDI já, mantém; senão assume BR
  if (s.length >= 12) return s;
  if (s.length === 11) return "55" + s;
  if (s.length === 10) return "55" + s;
  return s;
}

function pickPhone(l) {
  return cleanPhone(l.FONE) || cleanPhone(l.FONE2) || cleanPhone(l.FONE3) || "";
}

function whatsappLink(phone, nome) {
  const msg = `Olá ${nome ? nome.split(" ")[0] : ""}! Tudo bem?`;
  return `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(msg)}`;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}  "CURSO",                  // melhor conversão primeiro (IA)
];

/** Direções base */
const SORT_DIR = {
  DATA_CADASTRO: "desc",
  TOTAL_AGENDAMENTOS: "asc",
  MIDIA: "desc", // aqui “desc” significa: melhor conversão primeiro (usando score)
  CURSO: "desc", // idem
  NOME: "asc",
  CPF: "asc",
  MARCA: "asc",
  VENDEDOR: "asc",
  STATUS_PENDENTE: "asc",
};

const state = {
  loading: false,
  error: "",
  lastUpdated: null,

  all: [],       // todas as linhas (normalizadas)
  filtered: [],  // base filtrada (para KPIs e IA)
  leads: [],     // lista final (não matriculados, e status conforme filtro)

  vendedores: [],
  marcas: [],

  // filtros
  filtroMarca: "TODAS",                 // TODAS | TECNICO | PROFISSIONALIZANTE
  filtroVendedor: "TODOS",
  filtroBusca: "",
  filtroJanela: "365",                  // 30, 90, 180, 365, custom
  filtroDiasCustom: 120,
  filtroRecenciaFaixa: "TODOS",         // TODOS | NOVOS_30 | 31_90 | 91_180 | 181_365 | 366_MAIS
  filtroAgendFaixa: "TODOS",            // TODOS | 0 | 1 | 2_3 | 4_MAIS
  statusSelecionados: new Set(["AGENDADO"]), // Status (Planilha) default
  // (no futuro: Etapa HUB, etc)

  // classificação
  prioridade: [...DEFAULT_PRIORIDADE],
  headerSort: { key: null, dir: "asc" }, // ordenação por clique na tabela

  // IA (rates)
  ratesMidia: new Map(),
  ratesCurso: new Map(),
  ratesPar: new Map(), // "CURSO|||MIDIA" => {rate, total, conv}
};

const $ = (sel) => document.querySelector(sel);

init();

/* ------------------------------
   INIT
-------------------------------- */
function init() {
  window.addEventListener("hashchange", renderRoute);

  window.addEventListener("load", async () => {
    bindTopbar();
    await boot();
    renderRoute();
  });

  // sidebar
  document.querySelectorAll("[data-route]").forEach((a) => {
    a.addEventListener("click", () => {
      location.hash = a.getAttribute("data-route");
    });
  });
}

function bindTopbar() {
  const btnR = $("#btnRecarregarTop");
  const btnG = $("#btnGerarTop");
  const btnE = $("#btnExportTop");

  if (btnR) btnR.addEventListener("click", async () => { await boot(); renderRoute(); });
  if (btnG) btnG.addEventListener("click", () => gerarLista());
  if (btnE) btnE.addEventListener("click", () => exportarCSV());
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

    // listas
    state.vendedores = unique(
      state.all.map((x) => (x.VENDEDOR || "").trim()).filter(Boolean)
    ).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

    state.marcas = unique(
      state.all.map((x) => (x.MARCA || "").trim()).filter(Boolean)
    ).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

    // IA rates (com base TOTAL — depois filtramos a “visão” por janela/marca também)
    computeRates(state.all);

    state.lastUpdated = new Date();
    state.loading = false;
    state.error = "";
  } catch (e) {
    state.loading = false;
    state.error = String(e?.message || e);
  }
}

/* ------------------------------
   ROUTES
-------------------------------- */
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
  view.innerHTML = `
    <div class="section">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <div style="color:var(--muted);font-weight:700">Tela em construção.</div>
    </div>
  `;
}

/* ------------------------------
   QUALIFICAÇÃO
-------------------------------- */
function renderQualificacao() {
  const view = $("#view");
  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  // aplica filtros para KPIs/IA (mesmo antes de gerar lista)
  const baseFiltrada = applyFiltersBase(state.all);
  state.filtered = baseFiltrada;

  const totalBase = state.all.length;
  const totalFiltrada = baseFiltrada.length;
  const totalConv = baseFiltrada.filter(isConvertido).length;
  const convRate = totalFiltrada ? (totalConv / totalFiltrada) : 0;

  // IA “visão” baseada na base filtrada
  const ia = computeIASummary(baseFiltrada);

  view.innerHTML = `
    <div class="section">
      <div class="hTitleRow">
        <div>
          <h1 class="hTitle">Qualificação de Leads (HUB)</h1>
          <div class="hMeta">
            Base: <b>${formatInt(totalBase)}</b> •
            Base filtrada: <b>${formatInt(totalFiltrada)}</b> •
            Matriculou (${CONVERSAO_STATUS}): <b>${formatInt(totalConv)}</b> •
            Conversão: <b>${formatPct(convRate)}</b>
            ${state.lastUpdated ? ` • Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
          <div class="hMeta" style="margin-top:6px;">
            Partição fixa: <b>VENDEDOR</b> • Dentro do vendedor: ordenação hierárquica por camadas.
          </div>
        </div>
      </div>

      <div class="kpiGrid">
        <div class="kpiCard">
          <div class="kpiTitle">Base Total</div>
          <div class="kpiValue">${formatInt(totalBase)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Base Filtrada</div>
          <div class="kpiValue">${formatInt(totalFiltrada)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Matriculou (FinalizadoM)</div>
          <div class="kpiValue">${formatInt(totalConv)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Conversão</div>
          <div class="kpiValue">${formatPct(convRate)}</div>
        </div>
      </div>

      <div class="filtersGrid">
        <div class="field">
          <div class="label">Marca</div>
          <select id="selMarca">
            ${renderMarcaOptions()}
          </select>
        </div>

        <div class="field">
          <div class="label">Janela (tempo para trás)</div>
          <select id="selJanela">
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
            <option value="180">Últimos 180 dias</option>
            <option value="365">Últimos 365 dias</option>
            <option value="CUSTOM">Personalizado</option>
          </select>
        </div>

        <div class="field">
          <div class="label">Dias (se personalizado)</div>
          <input id="inpDias" type="number" min="1" step="1" value="${escapeAttr(String(state.filtroDiasCustom))}" />
        </div>

        <div class="field">
          <div class="label">Vendedor</div>
          <select id="selVendedor">
            ${renderVendedorOptions()}
          </select>
        </div>

        <div class="field">
          <div class="label">Recência (faixa)</div>
          <select id="selRecencia">
            <option value="TODOS">Todos</option>
            <option value="NOVOS_30">0–30 dias</option>
            <option value="31_90">31–90 dias</option>
            <option value="91_180">91–180 dias</option>
            <option value="181_365">181–365 dias</option>
            <option value="366_MAIS">+365 dias</option>
          </select>
        </div>

        <div class="field">
          <div class="label">Agendamentos (faixa)</div>
          <select id="selAgend">
            <option value="TODOS">Todos</option>
            <option value="0">0</option>
            <option value="1">1</option>
            <option value="2_3">2–3</option>
            <option value="4_MAIS">4+</option>
          </select>
        </div>

        <div class="field" style="grid-column: span 2;">
          <div class="label">Buscar (CPF/Nome)</div>
          <input id="inpBusca" placeholder="Digite CPF ou nome..." value="${escapeAttr(state.filtroBusca || "")}" />
        </div>
      </div>

      <div class="inlineChecks">
        <div style="font-weight:900;color:var(--muted)">Status (Planilha):</div>

        ${renderStatusCheck("AGENDADO", "Agendado")}
        ${renderStatusCheck("FINALIZADOM", "FinalizadoM")}
        ${renderStatusCheck("FINALIZADO", "Finalizado")}
      </div>
    </div>

    <div class="section">
      <h3 class="aiTitle">Sugestões da IA (baseado na janela/marca selecionadas)</h3>

      <div class="aiGrid">
        <div class="aiCard">
          <div class="aiCardTitle">Ordem sugerida (dentro do vendedor)</div>
          <div class="aiCardText">${escapeHtml(ia.ordemSugerida)}</div>
        </div>

        <div class="aiCard">
          <div class="aiCardTitle">Top Mídias (conversão e volume)</div>
          <div class="aiCardText">${escapeHtml(ia.topMidias)}</div>
        </div>

        <div class="aiCard">
          <div class="aiCardTitle">Top Cursos (conversão e volume)</div>
          <div class="aiCardText">${escapeHtml(ia.topCursos)}</div>
        </div>
      </div>

      <div class="aiNote">
        Heatmap (Curso × Mídia): melhores pares por conversão (com volume mínimo).
      </div>

      <div class="tableWrap" style="margin-top:10px;">
        <table>
          <thead>
            <tr>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Conversão</th>
              <th>Total</th>
              <th>Matriculou</th>
            </tr>
          </thead>
          <tbody>
            ${ia.heatmapRows || `<tr><td colspan="5" style="color:var(--muted);font-weight:700;padding:12px;">Sem dados suficientes para heatmap (ou volume mínimo não atingido).</td></tr>`}
          </tbody>
        </table>
      </div>

      <div class="aiNote" style="margin-top:10px;">
        A IA sugere, mas quem decide é você (arraste a ordem abaixo). Clique em colunas da tabela para ordenar rapidamente também.
      </div>
    </div>

    <div class="section">
      <h3 style="margin:0;font-weight:900;">Prioridade de Ordenação (arraste)</h3>
      <div style="color:var(--muted);font-weight:700;margin-top:6px;">
        Dentro do vendedor: 1ª camada = 1º campo • 2ª camada = 2º campo… (hierárquico).
      </div>

      <div class="dragWrap" id="drag"></div>
      <div style="color:var(--muted);font-weight:700;margin-top:6px;">
        Direções: <b>DATA_CADASTRO desc</b> • <b>TOTAL_AGENDAMENTOS asc</b> • <b>MÍDIA/CURSO</b> por melhor conversão • demais asc
      </div>
    </div>

    <div class="section result">
      <div class="hTitleRow">
        <div>
          <h3 style="margin:0;font-weight:900;">Resultado</h3>
          <div id="resultadoInfo" class="hMeta">Clique em <b>Gerar Lista</b>.</div>
        </div>
        <div class="hubButtons">
          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerarLista" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExportar" class="btn btnGhost">Exportar (CSV)</button>
        </div>
      </div>

      <div id="resultadoArea" style="margin-top:12px;"></div>
    </div>
  `;

  // set selects values
  $("#selMarca").value = state.filtroMarca;
  $("#selVendedor").value = state.filtroVendedor;
  $("#selRecencia").value = state.filtroRecenciaFaixa;
  $("#selAgend").value = state.filtroAgendFaixa;

  // janela
  $("#selJanela").value = (state.filtroJanela === "CUSTOM") ? "CUSTOM" : String(state.filtroJanela);

  // bind filtros
  $("#selMarca").addEventListener("change", (e) => { state.filtroMarca = e.target.value; renderRoute(); });
  $("#selVendedor").addEventListener("change", (e) => { state.filtroVendedor = e.target.value; renderRoute(); });
  $("#inpBusca").addEventListener("input", (e) => { state.filtroBusca = e.target.value; /* não re-rendera toda hora */ });
  $("#selRecencia").addEventListener("change", (e) => { state.filtroRecenciaFaixa = e.target.value; renderRoute(); });
  $("#selAgend").addEventListener("change", (e) => { state.filtroAgendFaixa = e.target.value; renderRoute(); });

  $("#selJanela").addEventListener("change", (e) => {
    const v = e.target.value;
    state.filtroJanela = (v === "CUSTOM") ? "CUSTOM" : Number(v);
    renderRoute();
  });

  $("#inpDias").addEventListener("change", (e) => {
    state.filtroDiasCustom = clampInt(e.target.value, 1, 99999, 120);
    renderRoute();
  });

  // status checks
  ["AGENDADO","FINALIZADOM","FINALIZADO"].forEach((k) => {
    const el = document.querySelector(`#chk_${k}`);
    if (!el) return;
    el.checked = state.statusSelecionados.has(k);
    el.addEventListener("change", () => {
      if (el.checked) state.statusSelecionados.add(k);
      else state.statusSelecionados.delete(k);
      renderRoute();
    });
  });

  // drag
  renderDrag();

  // buttons
  $("#btnGerarLista").addEventListener("click", () => gerarLista());
  $("#btnRecarregar").addEventListener("click", async () => { await boot(); renderRoute(); });
  $("#btnExportar").addEventListener("click", () => exportarCSV());

  // topbar buttons mirror
  const btnTopG = $("#btnGerarTop");
  const btnTopE = $("#btnExportTop");
  if (btnTopG) btnTopG.onclick = () => gerarLista();
  if (btnTopE) btnTopE.onclick = () => exportarCSV();

  // dica: gerar automaticamente uma primeira lista (opcional)
  // gerarLista();
}

/* ------------------------------
   GERAR LISTA (com camadas + sort por colunas)
-------------------------------- */
function gerarLista() {
  // base filtrada (para a lista)
  let base = applyFiltersBase(state.all);

  // status selecionados
  base = base.filter((l) => state.statusSelecionados.has(normalizeStatus(l.STATUS_PENDENTE)));

  // regra: normalmente o HUB trabalha mais “não matriculados”,
  // mas você pediu poder combinar os 3 status. Então NÃO removo FinalizadoM aqui.
  // Se quiser "somente não matriculados", descomente:
  // base = base.filter((l)=> !isConvertido(l));

  // busca (CPF/Nome)
  const q = (state.filtroBusca || "").trim().toLowerCase();
  if (q) {
    base = base.filter((l) => {
      const cpf = (l.CPF || "").toLowerCase();
      const nome = (l.NOME || "").toLowerCase();
      return cpf.includes(q) || nome.includes(q);
    });
  }

  // score real por lead (baseado nas taxas pré-calculadas)
  base.forEach((l) => l.SCORE = computeLeadScore(l));

  // agrupa por vendedor (partição fixa)
  const groups = groupBy(base, (l) => (l.VENDEDOR || "(Sem vendedor)").trim() || "(Sem vendedor)");

  // ordena vendedores
  const vendorNames = Object.keys(groups).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

  // render
  const area = $("#resultadoArea");
  const info = $("#resultadoInfo");

  // header sort (clique na tabela)
  const headerKey = state.headerSort.key;
  const headerDir = state.headerSort.dir;

  let totalLinhas = 0;

  const blocks = vendorNames.map((vend) => {
    let list = groups[vend] || [];

    // aplica ordenação por camadas (prioridade arrastável)
    list.sort(makeLayerComparator(state.prioridade));

    // se clicou num header, reordena dentro do vendedor por aquele campo
    if (headerKey) {
      list.sort(makeHeaderComparator(headerKey, headerDir));
    }

    totalLinhas += list.length;

    return `
      <div class="vendorBlock">
        <div class="vendorHeader">
          <div>${escapeHtml(vend)}</div>
          <small>${formatInt(list.length)} leads</small>
        </div>
        <div class="tableWrap">
          ${renderTabela(list)}
        </div>
      </div>
    `;
  }).join("");

  area.innerHTML = blocks || `<div style="color:var(--muted);font-weight:800;">Nenhum lead com os filtros atuais.</div>`;

  info.innerHTML = `
    Linhas: <b>${formatInt(totalLinhas)}</b> •
    Prioridade: <b>${state.prioridade.join(" > ")}</b>
    ${headerKey ? ` • Ordenação rápida: <b>${headerKey} ${headerDir.toUpperCase()}</b>` : ""}
  `;

  // bind header clicks (depois de render)
  bindHeaderSort();
  bindActionButtons();
}

/* ------------------------------
   TABELA + SORT POR COLUNA
-------------------------------- */
function renderTabela(lista) {
  // headers com indicador
  const hdr = (k, label) => {
    const active = state.headerSort.key === k;
    const arrow = active ? (state.headerSort.dir === "asc" ? "▲" : "▼") : "↕";
    return `<th data-sort="${escapeAttr(k)}">${escapeHtml(label)} <span class="sort">${arrow}</span></th>`;
  };

  const rows = lista.map((l, i) => {
    const st = normalizeStatus(l.STATUS_PENDENTE);
    const badge = st === "FINALIZADOM" ? "ok" : (st === "FINALIZADO" ? "danger" : "warn");

    const phone = pickPhone(l);
    const wa = phone ? whatsappLink(phone, l.NOME) : null;

    return `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(l.NOME || "")}</td>
        <td>${escapeHtml(l.CPF || "")}</td>
        <td>${escapeHtml(l.CURSO || "")}</td>
        <td>${escapeHtml(l.MIDIA || "")}</td>
        <td>${escapeHtml(l.MARCA || "")}</td>
        <td>${escapeHtml(l.DATA_CADASTRO || "")}</td>
        <td>${formatInt(toInt(l.TOTAL_AGENDAMENTOS))}</td>
        <td><span class="badge ${badge}">${escapeHtml(l.STATUS_PENDENTE || "")}</span></td>
        <td>${(l.SCORE != null ? formatPct(l.SCORE) : "")}</td>
        <td class="actions">
          ${wa ? `<a class="iconBtn" href="${escapeAttr(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : `<button class="iconBtn" disabled>WhatsApp</button>`}
          <button class="iconBtn" data-copy="${escapeAttr(phone || "")}">Copiar Fone</button>
          <button class="iconBtn" data-copy="${escapeAttr(l.CPF || "")}">Copiar CPF</button>
        </td>
      </tr>
    `;
  }).join("");

  return `
    <table>
      <thead>
        <tr>
          <th>#</th>
          ${hdr("NOME","Nome")}
          ${hdr("CPF","CPF")}
          ${hdr("CURSO","Curso")}
          ${hdr("MIDIA","Mídia")}
          ${hdr("MARCA","Marca")}
          ${hdr("DATA_CADASTRO","Data Cad.")}
          ${hdr("TOTAL_AGENDAMENTOS","Agend.")}
          ${hdr("STATUS_PENDENTE","Status")}
          ${hdr("SCORE","Score")}
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${rows || `<tr><td colspan="11" style="color:var(--muted);font-weight:800;">Sem linhas.</td></tr>`}
      </tbody>
    </table>
  `;
}

function bindHeaderSort() {
  document.querySelectorAll("th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.getAttribute("data-sort");
      if (!key) return;

      if (state.headerSort.key === key) {
        state.headerSort.dir = (state.headerSort.dir === "asc") ? "desc" : "asc";
      } else {
        state.headerSort.key = key;
        state.headerSort.dir = (SORT_DIR[key] || "asc");
      }
      gerarLista();
    });
  });
}

function bindActionButtons() {
  document.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const txt = btn.getAttribute("data-copy") || "";
      if (!txt) return;
      try{
        await navigator.clipboard.writeText(txt);
        btn.textContent = "Copiado!";
        setTimeout(()=> btn.textContent = btn.getAttribute("data-copy")?.includes("@") ? "Copiar" : (btn.textContent.includes("CPF") ? "Copiar CPF" : "Copiar Fone"), 800);
      } catch {
        // fallback
        prompt("Copie:", txt);
      }
    });
  });
}

/* ------------------------------
   EXPORT CSV (resultado atual)
-------------------------------- */
function exportarCSV() {
  // exporta a última lista (regera com filtros atuais)
  // (sem depender do DOM)
  let base = applyFiltersBase(state.all)
    .filter((l) => state.statusSelecionados.has(normalizeStatus(l.STATUS_PENDENTE)));

  const q = (state.filtroBusca || "").trim().toLowerCase();
  if (q) {
    base = base.filter((l) => ((l.CPF||"").toLowerCase().includes(q) || (l.NOME||"").toLowerCase().includes(q)));
  }

  base.forEach((l) => l.SCORE = computeLeadScore(l));

  // agrupa por vendedor e ordena
  const groups = groupBy(base, (l) => (l.VENDEDOR || "(Sem vendedor)").trim() || "(Sem vendedor)");
  const vendorNames = Object.keys(groups).sort((a,b)=>a.localeCompare(b,"pt-BR",{sensitivity:"base"}));

  const out = [];
  vendorNames.forEach((v) => {
    let list = groups[v] || [];
    list.sort(makeLayerComparator(state.prioridade));

    if (state.headerSort.key) {
      list.sort(makeHeaderComparator(state.headerSort.key, state.headerSort.dir));
    }

    list.forEach((l) => out.push(l));
  });

  const cols = [
    "VENDEDOR","NOME","CPF","MARCA","CURSO","MIDIA",
    "DATA_CADASTRO","TOTAL_AGENDAMENTOS","STATUS_PENDENTE","SCORE"
  ];

  const csv = [
    cols.join(","),
    ...out.map((l) => cols.map((c) => csvEscape(l[c])).join(","))
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `gt-aria_hub_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ------------------------------
   CLASSIFICAÇÃO POR CAMADAS
-------------------------------- */
function makeLayerComparator(keys) {
  return (a, b) => {
    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";

      let cmp = 0;

      if (k === "TOTAL_AGENDAMENTOS") {
        cmp = toInt(a.TOTAL_AGENDAMENTOS) - toInt(b.TOTAL_AGENDAMENTOS);
      } else if (k === "DATA_CADASTRO") {
        cmp = toDate(a.DATA_CADASTRO) - toDate(b.DATA_CADASTRO);
        // como queremos DESC (mais recente primeiro), inverte depois:
        cmp = -cmp;
        if (dir === "asc") cmp = -cmp; // se alguém mudar no futuro
      } else if (k === "MIDIA") {
        cmp = (rateMidia(b.MIDIA) - rateMidia(a.MIDIA)); // melhor primeiro
        if (dir === "asc") cmp = -cmp;
        if (cmp === 0) cmp = str(a.MIDIA).localeCompare(str(b.MIDIA), "pt-BR", {sensitivity:"base"});
      } else if (k === "CURSO") {
        cmp = (rateCurso(b.CURSO) - rateCurso(a.CURSO)); // melhor primeiro
        if (dir === "asc") cmp = -cmp;
        if (cmp === 0) cmp = str(a.CURSO).localeCompare(str(b.CURSO), "pt-BR", {sensitivity:"base"});
      } else {
        cmp = str(a[k]).localeCompare(str(b[k]), "pt-BR", { sensitivity: "base" });
        if (dir === "desc") cmp = -cmp;
      }

      if (cmp !== 0) return cmp;
    }

    // desempate final: score, depois nome
    const s = (b.SCORE||0) - (a.SCORE||0);
    if (s !== 0) return s;
    return str(a.NOME).localeCompare(str(b.NOME), "pt-BR", {sensitivity:"base"});
  };
}

function makeHeaderComparator(key, dir) {
  return (a,b) => {
    let cmp = 0;

    if (key === "TOTAL_AGENDAMENTOS") {
      cmp = toInt(a.TOTAL_AGENDAMENTOS) - toInt(b.TOTAL_AGENDAMENTOS);
    } else if (key === "DATA_CADASTRO") {
      cmp = toDate(a.DATA_CADASTRO) - toDate(b.DATA_CADASTRO);
    } else if (key === "SCORE") {
      cmp = (a.SCORE||0) - (b.SCORE||0);
    } else {
      cmp = str(a[key]).localeCompare(str(b[key]), "pt-BR", {sensitivity:"base"});
    }

    return (dir === "desc") ? -cmp : cmp;
  };
}

/* ------------------------------
   IA — RATES, SCORE, HEATMAP
-------------------------------- */
function computeRates(all) {
  // taxa por mídia, curso e par (curso|mídia)
  const mid = new Map(); // key -> {t,c}
  const cur = new Map();
  const par = new Map();

  for (const l of all) {
    const m = normKey(str(l.MIDIA) || "(vazio)");
    const c = normKey(str(l.CURSO) || "(vazio)");
    const p = `${c}|||${m}`;

    addCount(mid, m, isConvertido(l));
    addCount(cur, c, isConvertido(l));
    addCount(par, p, isConvertido(l));
  }

  state.ratesMidia = toRateMap(mid);
  state.ratesCurso = toRateMap(cur);

  // ratesPar precisa manter volume
  state.ratesPar = new Map();
  for (const [k, v] of par.entries()) {
    const rate = v.c / Math.max(1, v.t);
    state.ratesPar.set(k, { rate, total: v.t, conv: v.c });
  }
}

function computeLeadScore(l) {
  // score 0..1 combinando:
  // (mídia 45%) + (curso 45%) + (agend 10% inverso)
  const rm = rateMidia(l.MIDIA);
  const rc = rateCurso(l.CURSO);

  // quanto MENOS agendamentos, melhor (menos “energia” já gasta)
  const ag = toInt(l.TOTAL_AGENDAMENTOS);
  const agScore = 1 - clamp(ag / 6, 0, 1); // 0..6+

  // recência (mais recente melhor) — leve peso
  const days = daysSince(l.DATA_CADASTRO);
  const rec = 1 - clamp(days / 365, 0, 1);

  // ponderação final (ajustável)
  const score = (rm * 0.35) + (rc * 0.35) + (agScore * 0.12) + (rec * 0.18);
  return clamp(score, 0, 1);
}

function computeIASummary(baseFiltrada) {
  // calcula top midias/cursos e heatmap “da visão atual”
  // (usa STATUS_PENDENTE == FinalizadoM como conversão)
  const mid = new Map();
  const cur = new Map();
  const par = new Map();

  for (const l of baseFiltrada) {
    const m = displayKey(l.MIDIA) || "(vazio)";
    const c = displayKey(l.CURSO) || "(vazio)";
    const p = `${c}|||${m}`;
    addCount(mid, m, isConvertido(l));
    addCount(cur, c, isConvertido(l));
    addCount(par, p, isConvertido(l));
  }

  const topMid = topRateList(mid, 5, 20);
  const topCur = topRateList(cur, 5, 20);

  const heatRows = topRatePairs(par, 10, 25).map((x) => {
    return `
      <tr>
        <td>${escapeHtml(x.curso)}</td>
        <td>${escapeHtml(x.midia)}</td>
        <td>${escapeHtml(formatPct(x.rate))}</td>
        <td>${escapeHtml(formatInt(x.total))}</td>
        <td>${escapeHtml(formatInt(x.conv))}</td>
      </tr>
    `;
  }).join("");

  // ordem sugerida (heurística simples)
  // se recência pesa mais e agend baixo, manter: DATA > AGEND > MIDIA > CURSO
  const ordem = "DATA_CADASTRO > TOTAL_AGENDAMENTOS > MIDIA > CURSO";

  return {
    ordemSugerida: ordem,
    topMidias: topMid.length ? topMid.join(" • ") : "—",
    topCursos: topCur.length ? topCur.join(" • ") : "—",
    heatmapRows: heatRows,
  };
}

function rateMidia(m) {
  const k = normKey(displayKey(m) || "(vazio)");
  return state.ratesMidia.get(k) || 0;
}
function rateCurso(c) {
  const k = normKey(displayKey(c) || "(vazio)");
  return state.ratesCurso.get(k) || 0;
}

/* ------------------------------
   FILTROS (KPIs seguem filtros)
-------------------------------- */
function applyFiltersBase(all) {
  let list = [...all];

  // marca
  if (state.filtroMarca !== "TODAS") {
    const alvo = normKey(state.filtroMarca);
    list = list.filter((l) => normKey(l.MARCA) === alvo);
  }

  // vendedor
  if (state.filtroVendedor !== "TODOS") {
    list = list.filter((l) => (l.VENDEDOR || "").trim() === state.filtroVendedor);
  }

  // janela (tempo para trás)
  const janelaDias = (state.filtroJanela === "CUSTOM") ? state.filtroDiasCustom : Number(state.filtroJanela || 365);
  list = list.filter((l) => {
    const d = daysSince(l.DATA_CADASTRO);
    return d >= 0 && d <= janelaDias;
  });

  // recência faixa
  list = list.filter((l) => {
    const d = daysSince(l.DATA_CADASTRO);
    switch (state.filtroRecenciaFaixa) {
      case "NOVOS_30": return d <= 30;
      case "31_90": return d >= 31 && d <= 90;
      case "91_180": return d >= 91 && d <= 180;
      case "181_365": return d >= 181 && d <= 365;
      case "366_MAIS": return d >= 366;
      default: return true;
    }
  });

  // agendamentos faixa
  list = list.filter((l) => {
    const a = toInt(l.TOTAL_AGENDAMENTOS);
    switch (state.filtroAgendFaixa) {
      case "0": return a === 0;
      case "1": return a === 1;
      case "2_3": return a >= 2 && a <= 3;
      case "4_MAIS": return a >= 4;
      default: return true;
    }
  });

  return list;
}

/* ------------------------------
   DRAG & DROP prioridade
-------------------------------- */
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
   CSV FETCH + PARSE
-------------------------------- */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública.");
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

/* ------------------------------
   NORMALIZAÇÃO LEAD
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

  const lead = {
    ID: idx + 1,
    MARCA: get("MARCA"),
    NOME: get("NOME", "NOME_LEAD", "ALUNO", "NOME_COMPLETO"),
    CURSO: get("CURSO", "CURSO_INTERESSE", "CURSO_DE_INTERESSE"),
    MIDIA: get("MIDIA", "MÍDIA", "ORIGEM", "FONTE", "CANAL"),
    CPF: get("CPF"),
    VENDEDOR: get("VENDEDOR", "CONSULTOR", "RESPONSAVEL"),
    DATA_CADASTRO: get("DATA_CADASTRO", "DT_CADASTRO", "DATA_DE_CADASTRO"),
    DATA_AGENDAMENTO: get("DATA_AGENDAMENTO", "DT_AGENDAMENTO"),
    TOTAL_AGENDAMENTOS: toInt(get("TOTAL_AGENDAMENTOS", "AGENDAMENTOS", "QTD_AGENDAMENTOS")),
    STATUS_PENDENTE: get("STATUS_PENDENTE", "STATUS_PENDENCIA", "STATUS"),
    FONE: get("FONE"),
    FONE2: get("FONE2"),
    FONE3: get("FONE3"),
    SCORE: null,
  };

  return lead;
}

function normalizeStatus(v) {
  return String(v||"").trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g,"");
}

function isConvertido(l) {
  return normalizeStatus(l.STATUS_PENDENTE) === CONVERSAO_STATUS;
}

/* ------------------------------
   RENDER HELPERS
-------------------------------- */
function renderLoading(msg) {
  const view = $("#view");
  if (!view) return;
  view.innerHTML = `
    <div class="section">
      <div style="font-weight:900;font-size:16px;margin-bottom:6px;">${escapeHtml(msg || "Carregando…")}</div>
      <div style="color:var(--muted);font-weight:700;">Aguarde.</div>
    </div>
  `;
}

function renderError(err) {
  const view = $("#view");
  view.innerHTML = `
    <div class="section">
      <h2 style="margin:0 0 8px 0;color:#8b0000;">Erro</h2>
      <div style="white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace;font-size:12px;">${escapeHtml(String(err))}</div>
      <div style="margin-top:10px;color:var(--muted);font-weight:700;">
        Dica: confirme se a planilha está pública e se o <b>gid</b> é da aba correta.
      </div>
      <button id="btnTentar" class="btn btnPrimary" style="margin-top:12px;">Tentar novamente</button>
    </div>
  `;
  $("#btnTentar").addEventListener("click", async () => { await boot(); renderRoute(); });
}

function renderVendedorOptions() {
  const opts = [`<option value="TODOS">Todos</option>`].concat(
    state.vendedores.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`)
  );
  return opts.join("");
}

function renderMarcaOptions() {
  // força os 3 estados que você quer:
  const opts = [
    `<option value="TODAS">Ambos</option>`,
    `<option value="TECNICO">Técnico</option>`,
    `<option value="PROFISSIONALIZANTE">Profissionalizante</option>`,
  ];
  return opts.join("");
}

function renderStatusCheck(key, label) {
  const checked = state.statusSelecionados.has(key) ? "checked" : "";
  return `
    <label class="chk">
      <input type="checkbox" id="chk_${escapeAttr(key)}" ${checked} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

/* ------------------------------
   UTIL / FORMAT
-------------------------------- */
function toInt(v) {
  const n = parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  const s = String(v || "").trim();
  if (!s) return new Date("1970-01-01").getTime();

  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;

  // BR dd/mm/yyyy (com ou sem hora)
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

  return new Date("1970-01-01").getTime();
}

function daysSince(dateStr) {
  const t = toDate(dateStr);
  const now = Date.now();
  const d = Math.floor((now - t) / (1000 * 60 * 60 * 24));
  return Number.isFinite(d) ? Math.max(0, d) : 999999;
}

function unique(arr) { return [...new Set(arr)]; }

function formatDateTime(d) {
  try { return d.toLocaleString("pt-BR"); } catch { return String(d); }
}

function formatInt(n) {
  const x = Number(n || 0);
  return x.toLocaleString("pt-BR");
}

function formatPct(x) {
  const v = Number(x || 0);
  return (v * 100).toFixed(1) + "%";
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

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampInt(v, a, b, def) {
  const n = parseInt(String(v||""),10);
  return Number.isFinite(n) ? clamp(n,a,b) : def;
}
function str(v){ return String(v || ""); }
function normKey(v){
  return String(v||"").trim().toUpperCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g," ");
}
function displayKey(v){ return String(v||"").trim(); }

/* ------------------------------
   MAPS / GROUPS
-------------------------------- */
function groupBy(arr, fn) {
  const out = {};
  arr.forEach((x) => {
    const k = fn(x);
    (out[k] ||= []).push(x);
  });
  return out;
}

function addCount(map, key, isConv) {
  const cur = map.get(key) || { t: 0, c: 0 };
  cur.t += 1;
  if (isConv) cur.c += 1;
  map.set(key, cur);
}

function toRateMap(countMap) {
  const out = new Map();
  for (const [k, v] of countMap.entries()) {
    out.set(normKey(k), v.c / Math.max(1, v.t));
  }
  return out;
}

function topRateList(countMap, limit = 5, minTotal = 20) {
  const arr = [];
  for (const [k, v] of countMap.entries()) {
    if (v.t < minTotal) continue;
    const rate = v.c / Math.max(1, v.t);
    arr.push({ k, rate, t: v.t });
  }
  arr.sort((a,b)=> (b.rate - a.rate) || (b.t - a.t));
  return arr.slice(0, limit).map((x)=> `${x.k} (${formatPct(x.rate)} • ${formatInt(x.t)})`);
}

function topRatePairs(pairMap, limit=10, minTotal=25) {
  const arr = [];
  for (const [k, v] of pairMap.entries()) {
    if (v.t < minTotal) continue;
    const rate = v.c / Math.max(1, v.t);
    const [curso, midia] = String(k).split("|||");
    arr.push({ curso, midia, rate, total: v.t, conv: v.c });
  }
  arr.sort((a,b)=> (b.rate - a.rate) || (b.total - a.total));
  return arr.slice(0, limit);
}

/* ------------------------------
   CONTATO
-------------------------------- */
function cleanPhone(v) {
  const s = String(v||"").replace(/[^\d]/g,"");
  if (!s) return "";
  // se vier com DDI já, mantém; senão assume BR
  if (s.length >= 12) return s;
  if (s.length === 11) return "55" + s;
  if (s.length === 10) return "55" + s;
  return s;
}

function pickPhone(l) {
  return cleanPhone(l.FONE) || cleanPhone(l.FONE2) || cleanPhone(l.FONE3) || "";
}

function whatsappLink(phone, nome) {
  const msg = `Olá ${nome ? nome.split(" ")[0] : ""}! Tudo bem?`;
  return `https://wa.me/${encodeURIComponent(phone)}?text=${encodeURIComponent(msg)}`;
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replaceAll('"','""')}"`;
  }
  return s;
}
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
  currentList: [],

  vendedores: [],

  // filtros
  vendedorSelecionado: "TODOS",
  marcaSelecionada: "AMBOS",
  recenciaSelecionada: "TODOS",
  agendBucket: "TODOS",
  janelaKey: "365",
  janelaDiasCustom: 120,
  busca: "",

  statusPlanilha: { AGENDADO: true, FINALIZADOM: false, FINALIZADO: false },

  // classificação
  prioridade: [...DEFAULT_PRIORIDADE],

  // sort manual na tabela
  tableSort: { key: null, dir: "asc" },

  // taxas para “IA”
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
    a.addEventListener("click", () => (location.hash = a.getAttribute("data-route")));
  });

  $("#btnRecarregarTop")?.addEventListener("click", async () => {
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

    // vendedores
    state.vendedores = unique(
      state.all.map((l) => (l.VENDEDOR || "").trim()).filter(Boolean)
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

    // score base (mídia+curso)
    if (ENABLE_SCORE_IA) computeScoreIA(state.all);

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
  view.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <div class="muted">Tela em construção.</div>
    </div>
  `;
}

/* ------------------------------
   UI: QUALIFICAÇÃO
-------------------------------- */
function renderQualificacao() {
  const view = $("#view");
  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  const totalAll = state.all.length;
  const totalMat = state.all.filter(isMatriculado).length;

  view.innerHTML = `
    <div class="card">
      <div class="rowBetween">
        <div>
          <h2 style="margin:0 0 6px 0;">Qualificação de Leads (HUB)</h2>
          <div class="muted">
            Base: <b>${totalAll}</b> • Matriculou (FinalizadoM): <b>${totalMat}</b>
            ${state.lastUpdated ? `• Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
          <div class="muted" style="margin-top:6px;">
            <b>Partição fixa:</b> VENDEDOR • Dentro do vendedor: ordenação hierárquica por camadas.
          </div>
        </div>

        <div class="row" style="align-items:flex-end;">
          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerar" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExport" class="btn btnGhost">Exportar (CSV)</button>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="badges">
        <div class="kpi">
          <div class="kpiLabel">Base Total</div>
          <div class="kpiValue" id="kpiBase">${totalAll}</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Matriculou (FinalizadoM)</div>
          <div class="kpiValue" id="kpiMat">${totalMat}</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Filtrados</div>
          <div class="kpiValue" id="kpiFiltrados">—</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Janela</div>
          <div class="kpiValue" style="font-size:18px" id="kpiJanela">—</div>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="row" style="align-items:flex-end;">
        <div class="ctrl" style="min-width:220px;">
          <label>Marca</label>
          <select id="selMarca" class="select">
            <option value="AMBOS">Ambos</option>
            <option value="TECNICO">Técnico</option>
            <option value="PROFISSIONALIZANTE">Profissionalizante</option>
          </select>
        </div>

        <div class="ctrl" style="min-width:260px;">
          <label>Vendedor</label>
          <select id="selVendedor" class="select">
            <option value="TODOS">Todos</option>
          </select>
        </div>

        <div class="ctrl" style="min-width:240px;">
          <label>Janela (tempo para trás)</label>
          <select id="selJanela" class="select">
            ${WINDOW_OPTIONS.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:200px;">
          <label>Dias (se personalizado)</label>
          <input id="inpJanelaDias" class="input" type="number" min="1" step="1" value="${escapeAttr(String(state.janelaDiasCustom))}" disabled />
        </div>

        <div class="ctrl" style="min-width:220px;">
          <label>Recência (faixa)</label>
          <select id="selRecencia" class="select">
            ${RECENCY_OPTIONS.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:220px;">
          <label>Agendamentos (faixa)</label>
          <select id="selAgFaixa" class="select">
            ${AGEND_BUCKETS.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:320px;flex:1;">
          <label>Buscar (CPF/Nome)</label>
          <input id="inpBusca" class="input" placeholder="Digite CPF ou nome..." value="${escapeAttr(state.busca)}" />
        </div>
      </div>

      <div class="checkRow">
        <div class="muted small"><b>Status (Planilha):</b></div>
        <label><input type="checkbox" id="stAg" checked /> Agendado</label>
        <label><input type="checkbox" id="stFm" /> FinalizadoM</label>
        <label><input type="checkbox" id="stF" /> Finalizado</label>
      </div>

      <div class="hSep"></div>

      <div class="aiBox" id="aiBox">
        <h4>Sugestões da IA (baseado na janela/marca selecionadas)</h4>
        <div class="aiGrid" id="aiGrid">
          <div class="aiItem">
            <div class="t">Ordem sugerida</div>
            <div class="s" id="aiOrder">—</div>
          </div>
          <div class="aiItem">
            <div class="t">Top Mídias (conversão)</div>
            <div class="s" id="aiMidias">—</div>
          </div>
          <div class="aiItem">
            <div class="t">Top Cursos (conversão)</div>
            <div class="s" id="aiCursos">—</div>
          </div>
          <div class="aiItem">
            <div class="t">Nota</div>
            <div class="s">A IA sugere, mas quem decide é você (arraste a ordem abaixo).</div>
          </div>
        </div>
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Classificação (dentro do Vendedor) — arraste</h3>
      <div class="muted small" style="margin-bottom:8px;">
        O 1º campo ordena a lista. O 2º só reorganiza empates do 1º. O 3º só reorganiza empates do 1º+2º… (hierárquico).
      </div>
      <div id="drag" style="max-width:520px;"></div>
      <div class="muted small" style="margin-top:8px;">
        DATA_CADASTRO desc • TOTAL_AGENDAMENTOS asc • MIDIA/CURSO por taxa de conversão (FinalizadoM/Total)
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

  fillVendedores();

  $("#selJanela").value = state.janelaKey;
  $("#selMarca").value = state.marcaSelecionada;
  $("#selRecencia").value = state.recenciaSelecionada;
  $("#selAgFaixa").value = state.agendBucket;

  renderDrag();
  bindUI();

  refreshIA();
  refreshKpiJanela();
}

function bindUI() {
  $("#btnRecarregar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnGerar").addEventListener("click", gerarLista);
  $("#btnExport").addEventListener("click", exportarListaCSV);

  $("#selVendedor").addEventListener("change", (e) => {
    state.vendedorSelecionado = e.target.value || "TODOS";
    refreshIA();
    refreshKpiJanela();
  });

  $("#selMarca").addEventListener("change", (e) => {
    state.marcaSelecionada = e.target.value || "AMBOS";
    refreshIA();
    refreshKpiJanela();
  });

  $("#selJanela").addEventListener("change", (e) => {
    state.janelaKey = e.target.value || "TODOS";
    $("#inpJanelaDias").disabled = state.janelaKey !== "CUSTOM";
    refreshIA();
    refreshKpiJanela();
  });

  $("#inpJanelaDias").addEventListener("input", (e) => {
    const v = parseInt(e.target.value || "0", 10);
    state.janelaDiasCustom = Number.isFinite(v) && v > 0 ? v : 120;
    if (state.janelaKey === "CUSTOM") {
      refreshIA();
      refreshKpiJanela();
    }
  });

  $("#selRecencia").addEventListener("change", (e) => (state.recenciaSelecionada = e.target.value || "TODOS"));
  $("#selAgFaixa").addEventListener("change", (e) => (state.agendBucket = e.target.value || "TODOS"));
  $("#inpBusca").addEventListener("input", (e) => (state.busca = e.target.value || ""));

  $("#stAg").addEventListener("change", (e) => (state.statusPlanilha.AGENDADO = e.target.checked));
  $("#stFm").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADOM = e.target.checked));
  $("#stF").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADO = e.target.checked));

  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-sortkey");
      toggleTableSort(key);
      applySortAndRenderGrouped();
    });
  });
}

/* VENDEDORES */
function fillVendedores() {
  const sel = $("#selVendedor");
  if (!sel) return;
  const cur = state.vendedorSelecionado || "TODOS";
  sel.innerHTML = `<option value="TODOS">Todos</option>`;
  for (const v of state.vendedores) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  sel.value = state.vendedores.includes(cur) ? cur : "TODOS";
  state.vendedorSelecionado = sel.value;
}

/* IA */
function refreshIA() {
  const slice = filtrarBaseParaStats(state.all);
  computeConversionRates(slice);

  const order = ["DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];
  $("#aiOrder").textContent = order.join(" > ");
  $("#aiMidias").textContent = topMapPretty(state.convMidia, 5);
  $("#aiCursos").textContent = topMapPretty(state.convCurso, 5);
}

function topMapPretty(map, n) {
  const arr = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  if (!arr.length) return "—";
  return arr.map(([k, v]) => `${k} (${(v * 100).toFixed(1)}%)`).join(" • ");
}

/* KPI Janela */
function refreshKpiJanela() { $("#kpiJanela").textContent = windowLabel(); }
function windowLabel() {
  if (state.janelaKey === "TODOS") return "Todos";
  if (state.janelaKey === "CUSTOM") return `${state.janelaDiasCustom} dias`;
  return `${state.janelaKey} dias`;
}

/* Drag */
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
      if (state.currentList?.length && !state.tableSort.key) applySortAndRenderGrouped();
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

/* GERAR */
function gerarLista() {
  state.currentList = filtrarLista(state.all);
  $("#kpiFiltrados").textContent = String(state.currentList.length);
  applySortAndRenderGrouped();
  $("#resultadoInfo").textContent =
    `Linhas: ${state.currentList.length} • Dentro do vendedor: ${state.prioridade.join(" > ")}` +
    (state.tableSort.key ? ` • Sort manual: ${state.tableSort.key} ${state.tableSort.dir}` : "");
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
        if (cmp === 0) cmp = String(a.MIDIA || "").localeCompare(String(b.MIDIA || ""), "pt-BR", { sensitivity: "base" });
        if (dir === "asc") cmp = -cmp;
      } else if (k === "CURSO") {
        const ar = getRate(state.convCurso, a.CURSO);
        const br = getRate(state.convCurso, b.CURSO);
        cmp = br - ar;
        if (cmp === 0) cmp = String(a.CURSO || "").localeCompare(String(b.CURSO || ""), "pt-BR", { sensitivity: "base" });
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

/* TABELA */
function renderTabelaGrouped(vendedores, groups) {
  const tbody = $("#tbody");

  if (!state.currentList.length) {
    tbody.innerHTML = `<tr><td colspan="${ENABLE_SCORE_IA ? 13 : 12}" class="muted">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  let rowIndex = 0;
  const html = [];

  for (const vend of vendedores) {
    const list = groups[vend] || [];
    if (!list.length) continue;

    html.push(`
      <tr class="groupRow">
        <td colspan="${ENABLE_SCORE_IA ? 13 : 12}">
          <div class="groupInner">
            <div>${escapeHtml(vend)}</div>
            <div class="muted small">${list.length} leads</div>
          </div>
        </td>
      </tr>
    `);

    for (const l of list) {
      rowIndex += 1;
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
          <td>${wa ? `<a href="${wa}" target="_blank" rel="noopener">Whats</a>` : "-"}</td>
        </tr>
      `);
    }
  }

  tbody.innerHTML = html.join("");
}

/* SORT tabela */
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
function toggleTableSort(key) {
  if (state.tableSort.key !== key) { state.tableSort.key = key; state.tableSort.dir = "asc"; return; }
  if (state.tableSort.dir === "asc") { state.tableSort.dir = "desc"; return; }
  state.tableSort.key = null; state.tableSort.dir = "asc";
}
function makeColumnComparator(key, dir) {
  const mult = dir === "desc" ? -1 : 1;
  return (a, b) => {
    let av = a[key], bv = b[key];
    if (key === "TOTAL_AGENDAMENTOS" || key === "AGE_DAYS") return (toInt(av) - toInt(bv)) * mult;
    if (key === "SCORE_IA") {
      const as = Number.isFinite(av) ? av : -1;
      const bs = Number.isFinite(bv) ? bv : -1;
      return (as - bs) * mult;
    }
    if (key === "DATA_CADASTRO") return (toDate(av) - toDate(bv)) * mult;
    if (key === "MARCA") { av = normalizeMarcaLabel(av); bv = normalizeMarcaLabel(bv); }
    return String(av || "").localeCompare(String(bv || ""), "pt-BR", { sensitivity: "base" }) * mult;
  };
}

/* FILTROS */
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
      if (qDigits && cpf.includes(qDigits)) return true;
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

/* CONVERSÃO */
function computeConversionRates(slice) {
  const totalM = new Map(), matM = new Map(), totalC = new Map(), matC = new Map();

  for (const l of slice) {
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

  for (const [k, t] of totalM.entries()) state.convMidia.set(k, (matM.get(k) || 0) / Math.max(1, t));
  for (const [k, t] of totalC.entries()) state.convCurso.set(k, (matC.get(k) || 0) / Math.max(1, t));
}

/* EXPORT */
function exportarListaCSV() {
  if (!state.currentList?.length) return;

  const headers = ["CPF","NOME","MARCA","CURSO","MIDIA","VENDEDOR","DATA_CADASTRO","IDADE_DIAS","TOTAL_AGENDAMENTOS","STATUS_PENDENTE","SCORE_IA"];
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
        csvCell(l.SCORE_IA != null ? String(Number(l.SCORE_IA).toFixed(3)) : "")
      ].join(","));
    }
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

/* CSV */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública e o gid é da aba correta.");
  return await res.text();
}
function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = [];
  let cur = [], field = "", inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
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

/* Lead */
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

/* Score IA (simples) */
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

/* Helpers */
function normalizeStatus(s) { return String(s || "").trim().toUpperCase().replace(/\s+/g, ""); }
function normalizeStatusLabel(s) {
  const n = normalizeStatus(s);
  if (n === "FINALIZADOM") return "FinalizadoM";
  if (n === "FINALIZADO") return "Finalizado";
  if (n === "AGENDADO") return "Agendado";
  return String(s || "").trim();
}
function isMatriculado(l) { return normalizeStatus(l.STATUS_PENDENTE) === "FINALIZADOM"; }

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
function computeDayTs(dataCadastro) {
  const t = toDate(dataCadastro);
  if (!t) return 0;
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
function computeAgeDays(dataCadastro) {
  const t = toDate(dataCadastro);
  if (!t) return null;
  const d = Math.floor((Date.now() - t) / 86400000);
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
function unique(arr) { return [...new Set(arr)]; }
function formatDateTime(d) {
  try { return d.toLocaleString("pt-BR"); } catch { return String(d); }
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replaceAll('"', "&quot;"); }

/* Loading/Error */
function renderLoading(msg) {
  const view = $("#view");
  if (!view) return;
  view.innerHTML = `
    <div class="card">
      <div style="font-weight:1000;margin-bottom:6px;">${escapeHtml(msg || "Carregando…")}</div>
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
  currentList: [],

  vendedores: [],

  // filtros
  vendedorSelecionado: "TODOS",
  marcaSelecionada: "AMBOS",
  recenciaSelecionada: "TODOS",
  agendBucket: "TODOS",
  janelaKey: "365",
  janelaDiasCustom: 120,
  busca: "",

  statusPlanilha: { AGENDADO: true, FINALIZADOM: false, FINALIZADO: false },

  // classificação
  prioridade: [...DEFAULT_PRIORIDADE],

  // sort manual na tabela
  tableSort: { key: null, dir: "asc" },

  // taxas para “IA”
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
    a.addEventListener("click", () => (location.hash = a.getAttribute("data-route")));
  });

  $("#btnRecarregarTop")?.addEventListener("click", async () => {
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

    // vendedores
    state.vendedores = unique(
      state.all.map((l) => (l.VENDEDOR || "").trim()).filter(Boolean)
    ).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

    // score base (mídia+curso)
    if (ENABLE_SCORE_IA) computeScoreIA(state.all);

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
  view.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;">${escapeHtml(title)}</h2>
      <div class="muted">Tela em construção.</div>
    </div>
  `;
}

/* ------------------------------
   UI: QUALIFICAÇÃO
-------------------------------- */
function renderQualificacao() {
  const view = $("#view");
  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  const totalAll = state.all.length;
  const totalMat = state.all.filter(isMatriculado).length;

  view.innerHTML = `
    <div class="card">
      <div class="rowBetween">
        <div>
          <h2 style="margin:0 0 6px 0;">Qualificação de Leads (HUB)</h2>
          <div class="muted">
            Base: <b>${totalAll}</b> • Matriculou (FinalizadoM): <b>${totalMat}</b>
            ${state.lastUpdated ? `• Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
          <div class="muted" style="margin-top:6px;">
            <b>Partição fixa:</b> VENDEDOR • Dentro do vendedor: ordenação hierárquica por camadas.
          </div>
        </div>

        <div class="row" style="align-items:flex-end;">
          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerar" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExport" class="btn btnGhost">Exportar (CSV)</button>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="badges">
        <div class="kpi">
          <div class="kpiLabel">Base Total</div>
          <div class="kpiValue" id="kpiBase">${totalAll}</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Matriculou (FinalizadoM)</div>
          <div class="kpiValue" id="kpiMat">${totalMat}</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Filtrados</div>
          <div class="kpiValue" id="kpiFiltrados">—</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Janela</div>
          <div class="kpiValue" style="font-size:18px" id="kpiJanela">—</div>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="row" style="align-items:flex-end;">
        <div class="ctrl" style="min-width:220px;">
          <label>Marca</label>
          <select id="selMarca" class="select">
            <option value="AMBOS">Ambos</option>
            <option value="TECNICO">Técnico</option>
            <option value="PROFISSIONALIZANTE">Profissionalizante</option>
          </select>
        </div>

        <div class="ctrl" style="min-width:260px;">
          <label>Vendedor</label>
          <select id="selVendedor" class="select">
            <option value="TODOS">Todos</option>
          </select>
        </div>

        <div class="ctrl" style="min-width:240px;">
          <label>Janela (tempo para trás)</label>
          <select id="selJanela" class="select">
            ${WINDOW_OPTIONS.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:200px;">
          <label>Dias (se personalizado)</label>
          <input id="inpJanelaDias" class="input" type="number" min="1" step="1" value="${escapeAttr(String(state.janelaDiasCustom))}" disabled />
        </div>

        <div class="ctrl" style="min-width:220px;">
          <label>Recência (faixa)</label>
          <select id="selRecencia" class="select">
            ${RECENCY_OPTIONS.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:220px;">
          <label>Agendamentos (faixa)</label>
          <select id="selAgFaixa" class="select">
            ${AGEND_BUCKETS.map(o => `<option value="${o.key}">${escapeHtml(o.label)}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:320px;flex:1;">
          <label>Buscar (CPF/Nome)</label>
          <input id="inpBusca" class="input" placeholder="Digite CPF ou nome..." value="${escapeAttr(state.busca)}" />
        </div>
      </div>

      <div class="checkRow">
        <div class="muted small"><b>Status (Planilha):</b></div>
        <label><input type="checkbox" id="stAg" checked /> Agendado</label>
        <label><input type="checkbox" id="stFm" /> FinalizadoM</label>
        <label><input type="checkbox" id="stF" /> Finalizado</label>
      </div>

      <div class="hSep"></div>

      <div class="aiBox" id="aiBox">
        <h4>Sugestões da IA (baseado na janela/marca selecionadas)</h4>
        <div class="aiGrid" id="aiGrid">
          <div class="aiItem">
            <div class="t">Ordem sugerida</div>
            <div class="s" id="aiOrder">—</div>
          </div>
          <div class="aiItem">
            <div class="t">Top Mídias (conversão)</div>
            <div class="s" id="aiMidias">—</div>
          </div>
          <div class="aiItem">
            <div class="t">Top Cursos (conversão)</div>
            <div class="s" id="aiCursos">—</div>
          </div>
          <div class="aiItem">
            <div class="t">Nota</div>
            <div class="s">A IA sugere, mas quem decide é você (arraste a ordem abaixo).</div>
          </div>
        </div>
      </div>
    </div>

    <div class="hSep"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Classificação (dentro do Vendedor) — arraste</h3>
      <div class="muted small" style="margin-bottom:8px;">
        O 1º campo ordena a lista. O 2º só reorganiza empates do 1º. O 3º só reorganiza empates do 1º+2º… (hierárquico).
      </div>
      <div id="drag" style="max-width:520px;"></div>
      <div class="muted small" style="margin-top:8px;">
        DATA_CADASTRO desc • TOTAL_AGENDAMENTOS asc • MIDIA/CURSO por taxa de conversão (FinalizadoM/Total)
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

  // popular selects
  fillVendedores();
  // set defaults UI
  $("#selJanela").value = state.janelaKey;
  $("#selMarca").value = state.marcaSelecionada;
  $("#selRecencia").value = state.recenciaSelecionada;
  $("#selAgFaixa").value = state.agendBucket;

  // drag
  renderDrag();

  // bind
  bindUI();

  // já prepara IA (sem gerar lista)
  refreshIA();
  refreshKpiJanela();
}

function bindUI() {
  $("#btnRecarregar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnGerar").addEventListener("click", gerarLista);
  $("#btnExport").addEventListener("click", exportarListaCSV);

  $("#selVendedor").addEventListener("change", (e) => {
    state.vendedorSelecionado = e.target.value || "TODOS";
    refreshIA();
    refreshKpiJanela();
  });

  $("#selMarca").addEventListener("change", (e) => {
    state.marcaSelecionada = e.target.value || "AMBOS";
    refreshIA();
    refreshKpiJanela();
  });

  $("#selJanela").addEventListener("change", (e) => {
    state.janelaKey = e.target.value || "TODOS";
    $("#inpJanelaDias").disabled = state.janelaKey !== "CUSTOM";
    refreshIA();
    refreshKpiJanela();
  });

  $("#inpJanelaDias").addEventListener("input", (e) => {
    const v = parseInt(e.target.value || "0", 10);
    state.janelaDiasCustom = Number.isFinite(v) && v > 0 ? v : 120;
    if (state.janelaKey === "CUSTOM") {
      refreshIA();
      refreshKpiJanela();
    }
  });

  $("#selRecencia").addEventListener("change", (e) => (state.recenciaSelecionada = e.target.value || "TODOS"));
  $("#selAgFaixa").addEventListener("change", (e) => (state.agendBucket = e.target.value || "TODOS"));

  $("#inpBusca").addEventListener("input", (e) => (state.busca = e.target.value || ""));

  $("#stAg").addEventListener("change", (e) => (state.statusPlanilha.AGENDADO = e.target.checked));
  $("#stFm").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADOM = e.target.checked));
  $("#stF").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADO = e.target.checked));

  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-sortkey");
      toggleTableSort(key);
      applySortAndRenderGrouped();
    });
  });
}

/* ------------------------------
   VENDEDORES
-------------------------------- */
function fillVendedores() {
  const sel = $("#selVendedor");
  if (!sel) return;

  const cur = state.vendedorSelecionado || "TODOS";
  sel.innerHTML = `<option value="TODOS">Todos</option>`;
  for (const v of state.vendedores) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  }
  sel.value = state.vendedores.includes(cur) ? cur : "TODOS";
  state.vendedorSelecionado = sel.value;
}

/* ------------------------------
   IA (sugestões)
-------------------------------- */
function refreshIA() {
  const slice = filtrarBaseParaStats(state.all);
  computeConversionRates(slice);

  // ordem sugerida (heurística simples):
  // - sempre DATA_CADASTRO primeiro (puxar “novo”)
  // - depois MIDIA/CURSO se houver taxa bem diferenciada
  // - TOTAL_AGENDAMENTOS para reduzir energia
  const order = ["DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];

  $("#aiOrder").textContent = order.join(" > ");

  $("#aiMidias").textContent = topMapPretty(state.convMidia, 5);
  $("#aiCursos").textContent = topMapPretty(state.convCurso, 5);
}

function topMapPretty(map, n) {
  const arr = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
  if (!arr.length) return "—";
  return arr.map(([k, v]) => `${k} (${(v * 100).toFixed(1)}%)`).join(" • ");
}

/* ------------------------------
   KPI Janela
-------------------------------- */
function refreshKpiJanela() {
  const label = windowLabel();
  $("#kpiJanela").textContent = label;
}
function windowLabel() {
  if (state.janelaKey === "TODOS") return "Todos";
  if (state.janelaKey === "CUSTOM") return `${state.janelaDiasCustom} dias`;
  return `${state.janelaKey} dias`;
}

/* ------------------------------
   DRAG & DROP (classificação por camadas)
-------------------------------- */
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
      // se já tem lista, re-render
      if (state.currentList?.length && !state.tableSort.key) applySortAndRenderGrouped();
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
   GERAR / ORDENAR / AGRUPAR
-------------------------------- */
function gerarLista() {
  state.currentList = filtrarLista(state.all);

  // KPIs
  $("#kpiFiltrados").textContent = String(state.currentList.length);

  applySortAndRenderGrouped();

  $("#resultadoInfo").textContent =
    `Linhas: ${state.currentList.length} • Dentro do vendedor: ${state.prioridade.join(" > ")}` +
    (state.tableSort.key ? ` • Sort manual: ${state.tableSort.key} ${state.tableSort.dir}` : "");
}

function applySortAndRenderGrouped() {
  const groups = groupBy(state.currentList, (l) => (l.VENDEDOR || "").trim() || "(sem vendedor)");
  const vendedores = Object.keys(groups).sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  for (const v of vendedores) {
    if (state.tableSort.key) groups[v].sort(makeColumnComparator(state.tableSort.key, state.tableSort.dir));
    else groups[v].sort(makeHierarchicalComparator(state.prioridade));
  }

  renderTabelaGrouped(vendedores, groups);

  // refresh icons
  document.querySelectorAll("[data-sortkey]").forEach((btn) => {
    const k = btn.getAttribute("data-sortkey");
    const iconEl = btn.querySelector(".sortIcon");
    if (!iconEl) return;
    iconEl.textContent = state.tableSort.key === k ? (state.tableSort.dir === "asc" ? "▲" : "▼") : "";
  });
}

/** Comparator hierárquico real (camadas) */
function makeHierarchicalComparator(keys) {
  return (a, b) => {
    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";
      let cmp = 0;

      if (k === "DATA_CADASTRO") {
        const ad = a.DAY_TS ?? 0;
        const bd = b.DAY_TS ?? 0;
        cmp = bd - ad; // desc
        if (dir === "asc") cmp = -cmp;
      } else if (k === "TOTAL_AGENDAMENTOS") {
        cmp = toInt(a.TOTAL_AGENDAMENTOS) - toInt(b.TOTAL_AGENDAMENTOS);
        if (dir === "desc") cmp = -cmp;
      } else if (k === "MIDIA") {
        const ar = getRate(state.convMidia, a.MIDIA);
        const br = getRate(state.convMidia, b.MIDIA);
        cmp = br - ar; // desc por conversão
        if (cmp === 0) cmp = String(a.MIDIA || "").localeCompare(String(b.MIDIA || ""), "pt-BR", { sensitivity: "base" });
        if (dir === "asc") cmp = -cmp;
      } else if (k === "CURSO") {
        const ar = getRate(state.convCurso, a.CURSO);
        const br = getRate(state.convCurso, b.CURSO);
        cmp = br - ar; // desc por conversão
        if (cmp === 0) cmp = String(a.CURSO || "").localeCompare(String(b.CURSO || ""), "pt-BR", { sensitivity: "base" });
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

/* ------------------------------
   TABELA (agrupada por vendedor)
-------------------------------- */
function renderTabelaGrouped(vendedores, groups) {
  const tbody = $("#tbody");

  if (!state.currentList.length) {
    tbody.innerHTML = `<tr><td colspan="${ENABLE_SCORE_IA ? 13 : 12}" class="muted">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  let rowIndex = 0;
  const html = [];

  for (const vend of vendedores) {
    const list = groups[vend] || [];
    if (!list.length) continue;

    html.push(`
      <tr class="groupRow">
        <td colspan="${ENABLE_SCORE_IA ? 13 : 12}">
          <div class="groupInner">
            <div>${escapeHtml(vend)}</div>
            <div class="muted small">${list.length} leads</div>
          </div>
        </td>
      </tr>
    `);

    for (const l of list) {
      rowIndex += 1;
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
          <td>${wa ? `<a href="${wa}" target="_blank">Whats</a>` : "-"}</td>
        </tr>
      `);
    }
  }

  tbody.innerHTML = html.join("");
}

/* ------------------------------
   SORT por clique na tabela
-------------------------------- */
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

/* ------------------------------
   FILTROS (lista)
-------------------------------- */
function filtrarLista(base) {
  let lista = [...base];

  // janela
  const maxDays = getWindowMaxDays();
  if (maxDays != null) lista = lista.filter((l) => l.AGE_DAYS != null && l.AGE_DAYS <= maxDays);

  // marca
  if (state.marcaSelecionada !== "AMBOS") {
    lista = lista.filter((l) => normalizeMarcaKey(l.MARCA) === state.marcaSelecionada);
  }

  // vendedor
  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  }

  // recência (faixa)
  if (state.recenciaSelecionada !== "TODOS") {
    lista = lista.filter((l) => recencyKeyFromAge(l.AGE_DAYS) === state.recenciaSelecionada);
  }

  // agendamentos (faixa)
  if (state.agendBucket !== "TODOS") {
    lista = lista.filter((l) => agendKeyFromN(toInt(l.TOTAL_AGENDAMENTOS)) === state.agendBucket);
  }

  // status (planilha)
  lista = lista.filter((l) => {
    const s = normalizeStatus(l.STATUS_PENDENTE);
    if (s === "AGENDADO") return !!state.statusPlanilha.AGENDADO;
    if (s === "FINALIZADOM") return !!state.statusPlanilha.FINALIZADOM;
    if (s === "FINALIZADO") return !!state.statusPlanilha.FINALIZADO;
    return true;
  });

  // buscar
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

  return lista;
}

/* Base para stats (IA): aplica janela + marca + vendedor */
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
function computeConversionRates(slice) {
  const totalM = new Map();
  const matM = new Map();
  const totalC = new Map();
  const matC = new Map();

  for (const l of slice) {
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

  for (const [k, t] of totalM.entries()) state.convMidia.set(k, (matM.get(k) || 0) / Math.max(1, t));
  for (const [k, t] of totalC.entries()) state.convCurso.set(k, (matC.get(k) || 0) / Math.max(1, t));
}

/* ------------------------------
   EXPORT CSV
-------------------------------- */
function exportarListaCSV() {
  if (!state.currentList?.length) return;

  const headers = ["CPF","NOME","MARCA","CURSO","MIDIA","VENDEDOR","DATA_CADASTRO","IDADE_DIAS","TOTAL_AGENDAMENTOS","STATUS_PENDENTE","SCORE_IA"];
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
        csvCell(l.SCORE_IA != null ? String(Number(l.SCORE_IA).toFixed(3)) : "")
      ].join(","));
    }
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

/* ------------------------------
   CSV FETCH + PARSE
-------------------------------- */
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

/* ------------------------------
   NORMALIZA LEAD
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
   SCORE IA (info)
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
  try { return d.toLocaleString("pt-BR"); }
  catch { return String(d); }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replaceAll('"', "&quot;"); }

/* ------------------------------
   RENDER HELPERS
-------------------------------- */
function renderLoading(msg) {
  const view = $("#view");
  if (!view) return;
  view.innerHTML = `
    <div class="card">
      <div style="font-weight:1000;margin-bottom:6px;">${escapeHtml(msg || "Carregando…")}</div>
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
