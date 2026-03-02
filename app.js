/* ================================
   GT ARIA — Qualificação (HUB + Inteligência)
   - Base: Google Sheets CSV (somente leitura)
   - Operação: notas/etapa local por CPF (paralelo ao ERP)
=================================== */

/** === CONFIG === */
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

const ENABLE_SCORE_IA = true;

/** Ordenação padrão solicitada (arrastável) */
const DEFAULT_PRIORIDADE = ["VENDEDOR", "DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];
const SORT_DIR = {
  VENDEDOR: "asc",
  DATA_CADASTRO: "desc",
  TOTAL_AGENDAMENTOS: "asc",
  MIDIA: "asc",
  CURSO: "asc",
};

/** Etapas locais do HUB (não mexe no ERP) */
const HUB_STAGE = {
  NOVO: "NOVO",
  AQUECIDO: "AQUECIDO",
  ENVIADO: "ENVIADO",
  DESCARTADO: "DESCARTADO",
};

/** Storage key */
const LS_KEY = "gt_aria_hub_by_cpf_v1";

const state = {
  loading: false,
  error: "",
  lastUpdated: null,

  all: [],

  vendedores: [],
  vendedorSelecionado: "TODOS",
  prioridade: [...DEFAULT_PRIORIDADE],

  filters: {
    // status pendente (planilha)
    status: { AGENDADO: true, FINALIZADOM: false, FINALIZADO: false },
    // etapa hub (local)
    hub: { NOVO: true, AQUECIDO: true, ENVIADO: true, DESCARTADO: false },
    // lead velho
    minAgeDays: 0,
    // faixa de agendamentos
    agBucket: "",
    // busca
    q: "",
  },

  /** dados locais por CPF */
  hubByCpf: loadHubByCpf(),
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
}

async function boot() {
  state.loading = true;
  state.error = "";
  renderLoading("Carregando base de Leads…");

  try {
    const csvText = await fetchCsvNoCache(SHEET_CSV_URL);
    const rows = parseCSVRobusto(csvText);
    const normalizedRows = rows.map(normalizeRowKeys);

    state.all = normalizedRows.map((r, idx) => normalizeLead(r, idx));

    // vendedores
    state.vendedores = unique(
      state.all
        .map((l) => l.VENDEDOR)
        .filter((v) => (v || "").trim().length > 0)
        .map((v) => v.trim())
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    // score
    if (ENABLE_SCORE_IA) computeScoreIA(state.all);

    // aplica etapa hub local (se existir)
    attachHubLocal(state.all);

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
      <div style="opacity:.8">Tela em construção.</div>
    </div>
  `;
}

/* ------------------------------
   QUALIFICAÇÃO UI
-------------------------------- */
function renderQualificacao() {
  const view = $("#view");

  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  const totalAll = state.all.length;

  view.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
        <div>
          <h2 style="margin:0 0 4px 0;">Qualificação de Leads (HUB)</h2>
          <div style="opacity:.85;font-size:13px">
            Base: <b>${totalAll}</b>
            ${state.lastUpdated ? `• Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
          <label style="font-size:13px;opacity:.9">
            Vendedor:
            <select id="selVendedor" style="margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #ddd;">
              ${renderVendedorOptions()}
            </select>
          </label>

          <button id="btnRecarregar" style="padding:8px 10px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;">
            Recarregar
          </button>

          <button id="btnGerar" style="padding:8px 10px;border-radius:10px;border:none;background:#083a1f;color:#fff;cursor:pointer;">
            Gerar Lista
          </button>

          <button id="btnExport" style="padding:8px 10px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;">
            Exportar HUB (CSV)
          </button>
        </div>
      </div>

      <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
        <div style="font-size:13px;opacity:.85;"><b>Status (Planilha):</b></div>

        <label style="font-size:13px;">
          <input type="checkbox" id="stAG" ${state.filters.status.AGENDADO ? "checked" : ""} />
          Agendado
        </label>

        <label style="font-size:13px;">
          <input type="checkbox" id="stFM" ${state.filters.status.FINALIZADOM ? "checked" : ""} />
          FinalizadoM
        </label>

        <label style="font-size:13px;">
          <input type="checkbox" id="stF" ${state.filters.status.FINALIZADO ? "checked" : ""} />
          Finalizado
        </label>

        <div style="font-size:13px;opacity:.85;margin-left:8px;"><b>Etapa (HUB):</b></div>

        <label style="font-size:13px;">
          <input type="checkbox" id="hbN" ${state.filters.hub.NOVO ? "checked" : ""} />
          Novo
        </label>
        <label style="font-size:13px;">
          <input type="checkbox" id="hbA" ${state.filters.hub.AQUECIDO ? "checked" : ""} />
          Aquecido
        </label>
        <label style="font-size:13px;">
          <input type="checkbox" id="hbE" ${state.filters.hub.ENVIADO ? "checked" : ""} />
          Enviado
        </label>
        <label style="font-size:13px;">
          <input type="checkbox" id="hbD" ${state.filters.hub.DESCARTADO ? "checked" : ""} />
          Descartado
        </label>
      </div>

      <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;align-items:center;">
        <label style="font-size:13px;opacity:.9;">
          Lead antigo (>= dias):
          <select id="selAge" style="margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #ddd;">
            ${renderAgeOptions()}
          </select>
        </label>

        <label style="font-size:13px;opacity:.9;">
          Agend.:
          <select id="selAg" style="margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #ddd;">
            ${renderAgOptions()}
          </select>
        </label>

        <label style="font-size:13px;opacity:.9;">
          Buscar (CPF/Nome):
          <input id="inpQ" value="${escapeAttr(state.filters.q || "")}" placeholder="Digite CPF ou nome..."
            style="margin-left:6px;padding:6px 8px;border-radius:8px;border:1px solid #ddd;min-width:240px;" />
        </label>
      </div>
    </div>

    <div style="height:12px"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Prioridade de Ordenação (arraste)</h3>
      <div id="drag" style="max-width:520px;"></div>
      <div style="font-size:12px;opacity:.8;margin-top:8px;">
        Score IA é prioridade fixa (primeiro). Depois, sua ordem arrastável.
      </div>
    </div>

    <div style="height:12px"></div>

    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <h3 style="margin:0;">Resultado</h3>
        <div style="font-size:13px;opacity:.85" id="resultadoInfo">—</div>
      </div>

      <div style="overflow:auto;">
        <table id="tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Nome</th>
              <th>CPF</th>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Vendedor</th>
              <th>Data Cad.</th>
              <th>Agend.</th>
              <th>Status</th>
              <th>Etapa HUB</th>
              ${ENABLE_SCORE_IA ? "<th>Score IA</th>" : ""}
              <th>Contato</th>
              <th>Ações</th>
              <th>Nota HUB</th>
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="${ENABLE_SCORE_IA ? 14 : 13}" style="opacity:.7;">Clique em <b>Gerar Lista</b>.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderDrag();
  bindQualificacaoUI();
}

function bindQualificacaoUI() {
  $("#selVendedor").addEventListener("change", (e) => {
    state.vendedorSelecionado = e.target.value || "TODOS";
  });

  $("#btnGerar").addEventListener("click", gerarLista);

  $("#btnRecarregar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnExport").addEventListener("click", exportHubCsv);

  // status planilha
  $("#stAG").addEventListener("change", (e) => (state.filters.status.AGENDADO = !!e.target.checked));
  $("#stFM").addEventListener("change", (e) => (state.filters.status.FINALIZADOM = !!e.target.checked));
  $("#stF").addEventListener("change", (e) => (state.filters.status.FINALIZADO = !!e.target.checked));

  // etapa hub
  $("#hbN").addEventListener("change", (e) => (state.filters.hub.NOVO = !!e.target.checked));
  $("#hbA").addEventListener("change", (e) => (state.filters.hub.AQUECIDO = !!e.target.checked));
  $("#hbE").addEventListener("change", (e) => (state.filters.hub.ENVIADO = !!e.target.checked));
  $("#hbD").addEventListener("change", (e) => (state.filters.hub.DESCARTADO = !!e.target.checked));

  // idade
  $("#selAge").addEventListener("change", (e) => {
    state.filters.minAgeDays = parseInt(e.target.value || "0", 10) || 0;
  });

  // agendamentos
  $("#selAg").addEventListener("change", (e) => {
    state.filters.agBucket = e.target.value || "";
  });

  // busca
  $("#inpQ").addEventListener("input", (e) => {
    state.filters.q = e.target.value || "";
  });
}

function renderVendedorOptions() {
  const opts = [`<option value="TODOS">Todos</option>`].concat(
    state.vendedores.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`)
  );

  return opts
    .map((o) => {
      if (o.includes(`value="${escapeAttr(state.vendedorSelecionado)}"`)) return o.replace("<option ", "<option selected ");
      return o;
    })
    .join("");
}

function renderAgeOptions() {
  const options = [
    { v: "0", t: "Todos" },
    { v: "30", t: "30" },
    { v: "60", t: "60" },
    { v: "90", t: "90" },
    { v: "120", t: "120" },
    { v: "180", t: "180" },
  ];
  return options
    .map((o) => `<option value="${o.v}" ${String(state.filters.minAgeDays) === o.v ? "selected" : ""}>${o.t}</option>`)
    .join("");
}

function renderAgOptions() {
  const options = [
    { v: "", t: "Todos" },
    { v: "0-1", t: "0–1" },
    { v: "2-3", t: "2–3" },
    { v: "4+", t: "4+" },
  ];
  return options
    .map((o) => `<option value="${o.v}" ${state.filters.agBucket === o.v ? "selected" : ""}>${o.t}</option>`)
    .join("");
}

/* ------------------------------
   DRAG & DROP PRIORIDADE
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
   FILTROS + LISTA + ORDENAÇÃO
-------------------------------- */
function gerarLista() {
  let lista = [...state.all];

  // vendedor
  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  }

  // status planilha
  lista = lista.filter(passesStatusPlanilha);

  // etapa hub
  lista = lista.filter(passesHubStage);

  // idade
  lista = lista.filter(passesAgeFilter);

  // faixa agendamentos
  lista = lista.filter(passesAgBucket);

  // busca
  lista = lista.filter(passesQuery);

  // sort: Score IA primeiro, depois prioridade
  lista.sort((a, b) => {
    if (ENABLE_SCORE_IA) {
      const sa = Number.isFinite(a.SCORE_IA) ? a.SCORE_IA : 0;
      const sb = Number.isFinite(b.SCORE_IA) ? b.SCORE_IA : 0;
      if (sb !== sa) return sb - sa;
    }
    return makeMultiComparator(state.prioridade)(a, b);
  });

  renderTabela(lista);

  const info = $("#resultadoInfo");
  info.textContent = `Linhas: ${lista.length} • Status: ${statusResumoPlanilha()} • HUB: ${hubResumo()} • Idade>=${state.filters.minAgeDays || 0}d • Agend.: ${state.filters.agBucket || "Todos"}`;
}

function passesStatusPlanilha(l) {
  const s = getStatusPendente(l); // AGENDADO / FINALIZADOM / FINALIZADO
  const f = state.filters.status;
  if (s === "AGENDADO") return !!f.AGENDADO;
  if (s === "FINALIZADOM") return !!f.FINALIZADOM;
  if (s === "FINALIZADO") return !!f.FINALIZADO;
  return true; // desconhecido
}

function passesHubStage(l) {
  const st = String(l.HUB_STAGE || HUB_STAGE.NOVO).toUpperCase();
  const f = state.filters.hub;
  if (st === HUB_STAGE.NOVO) return !!f.NOVO;
  if (st === HUB_STAGE.AQUECIDO) return !!f.AQUECIDO;
  if (st === HUB_STAGE.ENVIADO) return !!f.ENVIADO;
  if (st === HUB_STAGE.DESCARTADO) return !!f.DESCARTADO;
  return true;
}

function passesAgeFilter(l) {
  const min = state.filters.minAgeDays || 0;
  if (!min) return true;
  return ageDaysFromCadastro(l) >= min;
}

function passesAgBucket(l) {
  const b = state.filters.agBucket || "";
  if (!b) return true;
  const n = toInt(l.TOTAL_AGENDAMENTOS);

  if (b === "0-1") return n >= 0 && n <= 1;
  if (b === "2-3") return n >= 2 && n <= 3;
  if (b === "4+") return n >= 4;
  return true;
}

function passesQuery(l) {
  const q = String(state.filters.q || "").trim();
  if (!q) return true;

  const qn = q.replace(/\D/g, ""); // se digitarem cpf com pontuação
  const cpf = String(l.CPF || "").replace(/\D/g, "");
  const nome = String(l.NOME || "").toLowerCase();

  if (qn && cpf.includes(qn)) return true;
  if (String(l.CPF || "").toLowerCase().includes(q.toLowerCase())) return true;
  if (nome.includes(q.toLowerCase())) return true;

  return false;
}

function makeMultiComparator(keys) {
  return (a, b) => {
    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";
      const av = a[k];
      const bv = b[k];

      let cmp = 0;

      if (k === "TOTAL_AGENDAMENTOS") {
        cmp = toInt(av) - toInt(bv);
      } else if (k === "DATA_CADASTRO") {
        // default desc
        cmp = toDate(bv) - toDate(av);
        if (dir === "asc") cmp = -cmp;
      } else {
        cmp = String(av || "").localeCompare(String(bv || ""), "pt-BR", { sensitivity: "base" });
      }

      if (cmp !== 0) return dir === "desc" && k !== "DATA_CADASTRO" ? -cmp : cmp;
    }
    return 0;
  };
}

function renderTabela(lista) {
  const tbody = $("#tbody");
  const colspan = ENABLE_SCORE_IA ? 14 : 13;

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" style="opacity:.7;">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista
    .map((l, i) => {
      const stPlan = getStatusPendente(l);
      const hubStage = l.HUB_STAGE || HUB_STAGE.NOVO;
      const score = ENABLE_SCORE_IA && Number.isFinite(l.SCORE_IA) ? Number(l.SCORE_IA).toFixed(3) : "";
      const fone = firstPhone(l);
      const wa = fone ? makeWhatsUrl(fone) : "";

      const nota = getHubLocal(l.CPF)?.nota || "";

      return `
        <tr data-cpf="${escapeAttr(l.CPF || "")}">
          <td>${i + 1}</td>
          <td>${escapeHtml(l.NOME || "")}</td>
          <td>${escapeHtml(l.CPF || "")}</td>
          <td>${escapeHtml(l.CURSO || "")}</td>
          <td>${escapeHtml(l.MIDIA || "")}</td>
          <td>${escapeHtml(l.VENDEDOR || "")}</td>
          <td>${escapeHtml(l.DATA_CADASTRO || "")}</td>
          <td>${escapeHtml(String(toInt(l.TOTAL_AGENDAMENTOS)))}</td>
          <td>${escapeHtml(stPlan)}</td>
          <td><b>${escapeHtml(hubStage)}</b></td>
          ${ENABLE_SCORE_IA ? `<td>${score}</td>` : ""}
          <td>${escapeHtml(fone || "")}</td>
          <td style="white-space:nowrap;">
            <button class="miniBtn" data-act="copycpf">CPF</button>
            <button class="miniBtn" data-act="copyfone" ${fone ? "" : "disabled"}>Fone</button>
            <button class="miniBtn" data-act="whats" ${wa ? "" : "disabled"}>Whats</button>
            <button class="miniBtn" data-act="aquecer">Aquecer</button>
            <button class="miniBtn" data-act="enviar">Enviar</button>
            <button class="miniBtn" data-act="descartar">Descartar</button>
          </td>
          <td style="min-width:240px;">
            <input class="notaInp" data-act="nota" value="${escapeAttr(nota)}"
              placeholder="Nota do HUB (salva no navegador)…"
              style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid #ddd;" />
          </td>
        </tr>
      `;
    })
    .join("");

  // bind ações por linha (delegação)
  tbody.querySelectorAll("tr").forEach((tr) => {
    const cpf = tr.getAttribute("data-cpf") || "";

    tr.querySelectorAll("button[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => handleRowAction(btn.getAttribute("data-act"), cpf));
    });

    const notaInp = tr.querySelector("input[data-act='nota']");
    if (notaInp) {
      notaInp.addEventListener("change", (e) => {
        upsertHubLocal(cpf, { nota: e.target.value || "" });
      });
    }
  });
}

/* ------------------------------
   AÇÕES DO HUB (local)
-------------------------------- */
function handleRowAction(act, cpf) {
  const lead = state.all.find((l) => String(l.CPF || "") === String(cpf || ""));
  if (!lead) return;

  const fone = firstPhone(lead);

  if (act === "copycpf") {
    copyText(String(lead.CPF || ""));
    toast("CPF copiado.");
    return;
  }

  if (act === "copyfone") {
    copyText(String(fone || ""));
    toast("Telefone copiado.");
    return;
  }

  if (act === "whats") {
    const url = makeWhatsUrl(fone);
    if (url) window.open(url, "_blank");
    return;
  }

  if (act === "aquecer") {
    upsertHubLocal(cpf, { stage: HUB_STAGE.AQUECIDO });
    lead.HUB_STAGE = HUB_STAGE.AQUECIDO;
    // pequeno boost local (ratifica aquecido)
    if (ENABLE_SCORE_IA) lead.SCORE_IA = (lead.SCORE_IA || 0) + 0.05;
    gerarLista();
    toast("Lead marcado como AQUECIDO (local).");
    return;
  }

  if (act === "enviar") {
    upsertHubLocal(cpf, { stage: HUB_STAGE.ENVIADO });
    lead.HUB_STAGE = HUB_STAGE.ENVIADO;
    gerarLista();
    toast("Lead marcado como ENVIADO (local).");
    return;
  }

  if (act === "descartar") {
    upsertHubLocal(cpf, { stage: HUB_STAGE.DESCARTADO });
    lead.HUB_STAGE = HUB_STAGE.DESCARTADO;
    gerarLista();
    toast("Lead marcado como DESCARTADO (local).");
    return;
  }
}

/* ------------------------------
   EXPORTAÇÃO (handoff para ERP)
   - CSV com CPF + Stage + Nota + UpdatedAt
-------------------------------- */
function exportHubCsv() {
  const rows = [];

  // cabeçalho
  rows.push(["CPF", "HUB_STAGE", "HUB_NOTA", "UPDATED_AT"].join(","));

  const entries = Object.entries(state.hubByCpf || {});
  // ordena por updatedAt desc
  entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));

  for (const [cpf, obj] of entries) {
    const stage = obj?.stage || HUB_STAGE.NOVO;
    const nota = (obj?.nota || "").replaceAll('"', '""');
    const ts = obj?.updatedAt ? new Date(obj.updatedAt).toISOString() : "";
    rows.push([csvCell(cpf), csvCell(stage), `"${nota}"`, csvCell(ts)].join(","));
  }

  const content = rows.join("\n");
  const filename = `gt_aria_hub_${new Date().toISOString().slice(0, 10)}.csv`;
  downloadTextFile(content, filename, "text/csv;charset=utf-8");
  toast("CSV do HUB gerado.");
}

function csvCell(v) {
  const s = String(v ?? "");
  // se tiver vírgula/aspas/quebra, coloca aspas
  if (/[,"\n\r]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/* ------------------------------
   SCORE IA (histórico por MIDIA|CURSO)
   sucesso: STATUS_PENDENTE = FINALIZADOM
   penaliza energia (agendamentos)
-------------------------------- */
function computeScoreIA(allLeads) {
  const total = new Map();
  const mat = new Map();

  for (const l of allLeads) {
    const key = `${(l.MIDIA || "").trim()}|${(l.CURSO || "").trim()}`;
    total.set(key, (total.get(key) || 0) + 1);

    if (getStatusPendente(l) === "FINALIZADOM") {
      mat.set(key, (mat.get(key) || 0) + 1);
    }
  }

  for (const l of allLeads) {
    const key = `${(l.MIDIA || "").trim()}|${(l.CURSO || "").trim()}`;
    const taxa = (mat.get(key) || 0) / Math.max(1, total.get(key) || 0);

    const ag = Math.max(0, toInt(l.TOTAL_AGENDAMENTOS));
    const penalidadeEnergia = 1 / (1 + ag);

    l.SCORE_IA = taxa * 0.7 + penalidadeEnergia * 0.3;
  }
}

/* ------------------------------
   LOCAL HUB STORE
-------------------------------- */
function loadHubByCpf() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj;
    return {};
  } catch {
    return {};
  }
}

function saveHubByCpf() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state.hubByCpf || {}));
  } catch {
    // ignore
  }
}

function getHubLocal(cpf) {
  const key = String(cpf || "").trim();
  if (!key) return null;
  return state.hubByCpf[key] || null;
}

function upsertHubLocal(cpf, patch) {
  const key = String(cpf || "").trim();
  if (!key) return;

  const cur = state.hubByCpf[key] || { stage: HUB_STAGE.NOVO, nota: "", updatedAt: 0 };
  const next = {
    ...cur,
    ...patch,
    stage: patch.stage || cur.stage || HUB_STAGE.NOVO,
    nota: patch.nota != null ? patch.nota : cur.nota,
    updatedAt: Date.now(),
  };

  state.hubByCpf[key] = next;
  saveHubByCpf();
}

function attachHubLocal(leads) {
  for (const l of leads) {
    const cpf = String(l.CPF || "").trim();
    const hub = cpf ? getHubLocal(cpf) : null;
    l.HUB_STAGE = hub?.stage || HUB_STAGE.NOVO;
  }
}

/* ------------------------------
   STATUS (planilha)
-------------------------------- */
function normStatus(v) {
  return String(v || "").trim().toUpperCase().replace(/\s+/g, "");
}
function getStatusPendente(l) {
  return normStatus(l.STATUS_PENDENTE || l.STATUS_PENDENCIA || "");
}
function statusResumoPlanilha() {
  const s = state.filters.status;
  const on = [];
  if (s.AGENDADO) on.push("Agendado");
  if (s.FINALIZADOM) on.push("FinalizadoM");
  if (s.FINALIZADO) on.push("Finalizado");
  return on.join(", ") || "Nenhum";
}
function hubResumo() {
  const h = state.filters.hub;
  const on = [];
  if (h.NOVO) on.push("Novo");
  if (h.AQUECIDO) on.push("Aquecido");
  if (h.ENVIADO) on.push("Enviado");
  if (h.DESCARTADO) on.push("Descartado");
  return on.join(", ") || "Nenhum";
}

/* ------------------------------
   HELPERS
-------------------------------- */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública e o gid está correto.");
  return await res.text();
}

/** CSV robusto */
function parseCSVRobusto(text) {
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
    headers.forEach((h, idx) => (obj[h] = r[idx] != null ? String(r[idx]) : ""));
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

/** Mapeamento conforme cabeçalhos */
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
    NOME: get("NOME"),
    CPF: get("CPF"),
    CURSO: get("CURSO"),
    MIDIA: get("MIDIA"),
    FONE: get("FONE"),
    FONE2: get("FONE2"),
    FONE3: get("FONE3"),
    TIPO_CADASTRO: get("TIPO_CADASTRO"),
    TURNO: get("TURNO"),
    STATUS: get("STATUS"),
    DATA_MATRICULA: get("DATA_MATRICULA"),
    VALOR_MATRICULA: get("VALOR_MATRICULA"),
    DATA_CADASTRO: get("DATA_CADASTRO"),
    DATA_AGENDAMENTO: get("DATA_AGENDAMENTO"),
    TOTAL_AGENDAMENTOS: toInt(get("TOTAL_AGENDAMENTOS")),
    STATUS_PENDENTE: get("STATUS_PENDENTE", "STATUS_PENDENCIA"),
    STATUS_PENDENCIA: get("STATUS_PENDENCIA"), // compat
    VENDEDOR: get("VENDEDOR"),
    HUB_STAGE: HUB_STAGE.NOVO,
    SCORE_IA: null,
  };

  DEFAULT_PRIORIDADE.forEach((k) => {
    if (!(k in lead)) lead[k] = "";
  });

  return lead;
}

function firstPhone(l) {
  const a = String(l.FONE || "").trim();
  const b = String(l.FONE2 || "").trim();
  const c = String(l.FONE3 || "").trim();
  return a || b || c || "";
}

function makeWhatsUrl(phone) {
  const p = String(phone || "").replace(/\D/g, "");
  if (!p) return "";
  // Brasil: se vier com 55 ok, se não tiver, assume BR
  const full = p.startsWith("55") ? p : `55${p}`;
  return `https://wa.me/${full}`;
}

function copyText(text) {
  const s = String(text ?? "");
  if (!s) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(s).catch(() => {});
  } else {
    const ta = document.createElement("textarea");
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    document.body.removeChild(ta);
  }
}

function downloadTextFile(content, filename, mime) {
  const blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "export.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toast(msg) {
  // toast minimalista sem CSS extra
  const id = "gt_aria_toast";
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.style.position = "fixed";
    el.style.right = "14px";
    el.style.bottom = "14px";
    el.style.padding = "10px 12px";
    el.style.borderRadius = "12px";
    el.style.background = "rgba(0,0,0,.78)";
    el.style.color = "#fff";
    el.style.fontSize = "13px";
    el.style.zIndex = "9999";
    el.style.maxWidth = "320px";
    el.style.boxShadow = "0 8px 22px rgba(0,0,0,.25)";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = "0";
  }, 1600);
}

function ageDaysFromCadastro(l) {
  const t = toDate(l.DATA_CADASTRO);
  if (!t) return 0;
  return Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
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

function toInt(v) {
  const n = parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
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

/* ------------------------------
   RENDER HELPERS
-------------------------------- */
function renderLoading(msg) {
  const view = $("#view");
  if (!view) return;
  view.innerHTML = `
    <div class="card">
      <div style="font-weight:bold;margin-bottom:6px;">${escapeHtml(msg || "Carregando…")}</div>
      <div style="opacity:.8;font-size:13px;">Aguarde.</div>
    </div>
  `;
}

function renderError(err) {
  const view = $("#view");
  view.innerHTML = `
    <div class="card">
      <h2 style="margin:0 0 8px 0;color:#8b0000;">Erro</h2>
      <div style="white-space:pre-wrap;font-family:monospace;font-size:12px;">${escapeHtml(String(err))}</div>
      <div style="margin-top:10px;font-size:13px;opacity:.85;">
        Dica: confirme se a planilha está pública e se o <b>gid</b> é o da aba correta.
      </div>
      <button id="btnTentar" style="margin-top:12px;padding:8px 10px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;">
        Tentar novamente
      </button>
    </div>
  `;
  $("#btnTentar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });
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
   Mini CSS via classe (sem mudar styles.css)
-------------------------------- */
(function injectMiniCss() {
  const css = `
    .miniBtn{padding:6px 8px;border-radius:10px;border:1px solid #ddd;background:#fff;cursor:pointer;font-size:12px;margin-right:6px}
    .miniBtn:disabled{opacity:.45;cursor:not-allowed}
  `;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
})();
