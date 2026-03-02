/* ================================
   GT ARIA — Qualificação (Google Sheets CSV)
   (Versão anterior com topo compacto + drag)
=================================== */

/** Google Sheets (CSV via export) */
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

/** Opcional: Score simples por conversão */
const ENABLE_SCORE_IA = true;

/** Ordenação padrão solicitada */
const DEFAULT_PRIORIDADE = ["VENDEDOR", "DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];

/** Direção por campo */
const SORT_DIR = {
  VENDEDOR: "asc",
  DATA_CADASTRO: "desc",
  TOTAL_AGENDAMENTOS: "asc",
  MIDIA: "asc",
  CURSO: "asc",
};

const state = {
  loading: false,
  error: "",
  lastUpdated: null,

  all: [],
  leads: [],

  vendedores: [],
  marcas: [],

  vendedorSelecionado: "TODOS",
  marcaSelecionada: "AMBOS",

  // filtros (topo compacto)
  statusPlanilha: { AGENDADO: true, FINALIZADOM: false, FINALIZADO: false },
  etapaHub: { NOVO: true, AQUECIDO: true, ENVIADO: true, DESCARTADO: false },

  // opcionais existentes
  leadAntigoDias: "TODOS",
  agendFiltro: "TODOS",
  busca: "",

  prioridade: [...DEFAULT_PRIORIDADE],
};

const $ = (sel) => document.querySelector(sel);

init();

/* ------------------------------
   INIT
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

  // topo
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

    // vendedores
    state.vendedores = unique(
      state.all
        .map((l) => l.VENDEDOR)
        .filter((v) => (v || "").trim().length > 0)
        .map((v) => v.trim())
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    // marcas (Técnico / Profissionalizante)
    state.marcas = unique(
      state.all
        .map((l) => l.MARCA)
        .filter((m) => (m || "").trim().length > 0)
        .map((m) => normalizeMarcaLabel(m))
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    // base da tela: aqui mantemos "não matriculados" como antes.
    // Na sua base, o "matriculado" é FinalizadoM (Status_Pendente).
    // Então: leads = tudo que NÃO é FinalizadoM, por padrão.
    state.leads = state.all.filter((l) => !isMatriculado(l));

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
      <div class="rowBetween">
        <div>
          <h2 style="margin:0 0 4px 0;">Qualificação de Leads (HUB)</h2>
          <div class="muted small">
            Base: <b>${totalAll}</b>
            ${state.lastUpdated ? `• Atualizado: <b>${formatDateTime(state.lastUpdated)}</b>` : ""}
          </div>
        </div>

        <div class="row" style="align-items:flex-end;">
          <div class="ctrl" style="min-width:220px;">
            <label>Marca</label>
            <select id="selMarca" class="select">
              <option value="AMBOS">Ambos</option>
              <option value="TECNICO" ${state.marcaSelecionada==="TECNICO"?"selected":""}>Técnico</option>
              <option value="PROFISSIONALIZANTE" ${state.marcaSelecionada==="PROFISSIONALIZANTE"?"selected":""}>Profissionalizante</option>
            </select>
          </div>

          <div class="ctrl" style="min-width:220px;">
            <label>Vendedor</label>
            <select id="selVendedor" class="select">
              <option value="TODOS">Todos</option>
              ${state.vendedores.map(v => `<option value="${escapeAttr(v)}" ${state.vendedorSelecionado===v?"selected":""}>${escapeHtml(v)}</option>`).join("")}
            </select>
          </div>

          <button id="btnRecarregar" class="btn btnGhost">Recarregar</button>
          <button id="btnGerar" class="btn btnPrimary">Gerar Lista</button>
          <button id="btnExport" class="btn btnGhost">Exportar HUB (CSV)</button>
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

        <div class="checkRow">
          <div class="muted small"><b>Etapa (HUB):</b></div>
          <label><input type="checkbox" id="hbN" ${state.etapaHub.NOVO?"checked":""}/> Novo</label>
          <label><input type="checkbox" id="hbA" ${state.etapaHub.AQUECIDO?"checked":""}/> Aquecido</label>
          <label><input type="checkbox" id="hbE" ${state.etapaHub.ENVIADO?"checked":""}/> Enviado</label>
          <label><input type="checkbox" id="hbD" ${state.etapaHub.DESCARTADO?"checked":""}/> Descartado</label>
        </div>
      </div>

      <div class="hSep"></div>

      <div class="row" style="align-items:flex-end;">
        <div class="ctrl" style="min-width:220px;">
          <label>Lead antigo (>= dias)</label>
          <select id="selAntigo" class="select">
            ${["TODOS","30","60","90","180","365"].map(v => `<option value="${v}" ${state.leadAntigoDias===v?"selected":""}>${v==="TODOS"?"Todos":v}</option>`).join("")}
          </select>
        </div>

        <div class="ctrl" style="min-width:220px;">
          <label>Agend.</label>
          <select id="selAg" class="select">
            ${["TODOS","0","1","2","3","4","5"].map(v => `<option value="${v}" ${state.agendFiltro===v?"selected":""}>${v==="TODOS"?"Todos":v}</option>`).join("")}
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
      <h3 style="margin:0 0 8px 0;">Prioridade de Ordenação (arraste)</h3>
      <div id="drag" style="max-width:520px;"></div>
      <div class="muted small" style="margin-top:8px;">
        Score IA é prioridade fixa (primeiro). Depois, sua ordem arrastável.
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
              <th>#</th>
              <th>Nome</th>
              <th>CPF</th>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Marca</th>
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
            <tr><td colspan="${ENABLE_SCORE_IA ? 15 : 14}" class="muted">Clique em <b>Gerar Lista</b>.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderDrag();

  // binds
  $("#selVendedor").addEventListener("change", (e) => {
    state.vendedorSelecionado = e.target.value || "TODOS";
  });

  $("#selMarca").addEventListener("change", (e) => {
    state.marcaSelecionada = e.target.value || "AMBOS";
  });

  $("#selAntigo").addEventListener("change", (e) => {
    state.leadAntigoDias = e.target.value || "TODOS";
  });

  $("#selAg").addEventListener("change", (e) => {
    state.agendFiltro = e.target.value || "TODOS";
  });

  $("#inpBusca").addEventListener("input", (e) => {
    state.busca = e.target.value || "";
  });

  // status
  $("#stAg").addEventListener("change", (e) => (state.statusPlanilha.AGENDADO = e.target.checked));
  $("#stFm").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADOM = e.target.checked));
  $("#stF").addEventListener("change", (e) => (state.statusPlanilha.FINALIZADO = e.target.checked));

  // hub
  $("#hbN").addEventListener("change", (e) => (state.etapaHub.NOVO = e.target.checked));
  $("#hbA").addEventListener("change", (e) => (state.etapaHub.AQUECIDO = e.target.checked));
  $("#hbE").addEventListener("change", (e) => (state.etapaHub.ENVIADO = e.target.checked));
  $("#hbD").addEventListener("change", (e) => (state.etapaHub.DESCARTADO = e.target.checked));

  $("#btnGerar").addEventListener("click", gerarLista);
  $("#btnRecarregar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });

  $("#btnExport").addEventListener("click", exportarListaCSV);
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
   GERAR LISTA + TABELA
-------------------------------- */
function gerarLista() {
  let lista = [...state.leads];

  // filtro marca
  if (state.marcaSelecionada !== "AMBOS") {
    lista = lista.filter((l) => normalizeMarcaKey(l.MARCA) === state.marcaSelecionada);
  }

  // filtro vendedor
  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  }

  // filtro status (planilha)
  lista = lista.filter((l) => {
    const s = normalizeStatus(l.STATUS_PENDENTE);
    if (s === "AGENDADO") return !!state.statusPlanilha.AGENDADO;
    if (s === "FINALIZADOM") return !!state.statusPlanilha.FINALIZADOM;
    if (s === "FINALIZADO") return !!state.statusPlanilha.FINALIZADO;
    return true;
  });

  // filtro lead antigo (>= dias)
  if (state.leadAntigoDias !== "TODOS") {
    const dias = parseInt(state.leadAntigoDias, 10);
    if (Number.isFinite(dias)) {
      const now = Date.now();
      lista = lista.filter((l) => {
        const t = toDate(l.DATA_CADASTRO);
        if (!t) return false;
        const ageDays = Math.floor((now - t) / 86400000);
        return ageDays >= dias;
      });
    }
  }

  // filtro agendamentos
  if (state.agendFiltro !== "TODOS") {
    const n = parseInt(state.agendFiltro, 10);
    if (Number.isFinite(n)) {
      lista = lista.filter((l) => toInt(l.TOTAL_AGENDAMENTOS) === n);
    }
  }

  // busca
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

  // ordenação (Score IA sempre primeiro, depois drag)
  lista.sort(makeMultiComparatorWithScore(state.prioridade));

  renderTabela(lista);

  $("#resultadoInfo").textContent = `Linhas: ${lista.length} • Marca: ${
    state.marcaSelecionada === "AMBOS" ? "Ambos" : (state.marcaSelecionada === "TECNICO" ? "Técnico" : "Profissionalizante")
  } • Prioridade: ScoreIA > ${state.prioridade.join(" > ")}`;
}

function makeMultiComparatorWithScore(keys) {
  return (a, b) => {
    // score desc (fixo)
    if (ENABLE_SCORE_IA) {
      const as = Number.isFinite(a.SCORE_IA) ? a.SCORE_IA : -1;
      const bs = Number.isFinite(b.SCORE_IA) ? b.SCORE_IA : -1;
      if (bs !== as) return bs - as;
    }

    // demais por prioridade
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

function renderTabela(lista) {
  const tbody = $("#tbody");

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="${ENABLE_SCORE_IA ? 15 : 14}" class="muted">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista
    .map((l, i) => {
      const wa = buildWhatsLink(l);
      const status = normalizeStatus(l.STATUS_PENDENTE);
      const marcaLabel = normalizeMarcaLabel(l.MARCA);

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
          <td>${escapeHtml(String(toInt(l.TOTAL_AGENDAMENTOS)))}</td>
          <td>${escapeHtml(status)}</td>
          <td>${escapeHtml(l.ETAPA_HUB || "Novo")}</td>
          ${ENABLE_SCORE_IA ? `<td>${l.SCORE_IA != null ? Number(l.SCORE_IA).toFixed(3) : ""}</td>` : ""}
          <td>${wa ? `<a href="${wa}" target="_blank">Whats</a>` : "-"}</td>
          <td>
            <button class="btn btnGhost" onclick="copiar('${escapeAttr(l.CPF || "")}')">Copiar CPF</button>
          </td>
          <td>${escapeHtml(l.NOTA_HUB || "")}</td>
        </tr>
      `;
    })
    .join("");
}

/* Export simples do que está na tela (última lista gerada) */
function exportarListaCSV() {
  const rows = [];
  const headers = ["CPF","NOME","MARCA","CURSO","MIDIA","VENDEDOR","DATA_CADASTRO","TOTAL_AGENDAMENTOS","STATUS_PENDENTE","SCORE_IA"];
  rows.push(headers.join(","));

  // pega o que está renderizado no tbody (última lista)
  const tr = [...document.querySelectorAll("#tbody tr")];
  if (!tr.length) return;

  // melhor: recriar a lista (mesmos filtros) e exportar
  let lista = [...state.leads];
  if (state.marcaSelecionada !== "AMBOS") lista = lista.filter((l) => normalizeMarcaKey(l.MARCA) === state.marcaSelecionada);
  if (state.vendedorSelecionado !== "TODOS") lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  lista = lista.filter((l) => {
    const s = normalizeStatus(l.STATUS_PENDENTE);
    if (s === "AGENDADO") return !!state.statusPlanilha.AGENDADO;
    if (s === "FINALIZADOM") return !!state.statusPlanilha.FINALIZADOM;
    if (s === "FINALIZADO") return !!state.statusPlanilha.FINALIZADO;
    return true;
  });
  if (state.leadAntigoDias !== "TODOS") {
    const dias = parseInt(state.leadAntigoDias, 10);
    if (Number.isFinite(dias)) {
      const now = Date.now();
      lista = lista.filter((l) => {
        const t = toDate(l.DATA_CADASTRO);
        if (!t) return false;
        const ageDays = Math.floor((now - t) / 86400000);
        return ageDays >= dias;
      });
    }
  }
  if (state.agendFiltro !== "TODOS") {
    const n = parseInt(state.agendFiltro, 10);
    if (Number.isFinite(n)) lista = lista.filter((l) => toInt(l.TOTAL_AGENDAMENTOS) === n);
  }
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
  lista.sort(makeMultiComparatorWithScore(state.prioridade));

  for (const l of lista) {
    rows.push([
      csvCell(l.CPF),
      csvCell(l.NOME),
      csvCell(normalizeMarcaLabel(l.MARCA)),
      csvCell(l.CURSO),
      csvCell(l.MIDIA),
      csvCell(l.VENDEDOR),
      csvCell(l.DATA_CADASTRO),
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
   NORMALIZAÇÃO
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
    NOME: get("NOME"),
    CPF: get("CPF"),
    VENDEDOR: get("VENDEDOR"),
    DATA_CADASTRO: get("DATA_CADASTRO"),
    MIDIA: get("MIDIA", "MÍDIA"),
    CURSO: get("CURSO"),
    TOTAL_AGENDAMENTOS: toInt(get("TOTAL_AGENDAMENTOS")),
    STATUS_PENDENTE: get("STATUS_PENDENTE"),
    ETAPA_HUB: "Novo",
    NOTA_HUB: "",
    SCORE_IA: null,
    FONE: get("FONE"),
    FONE2: get("FONE2"),
    FONE3: get("FONE3"),
  };

  DEFAULT_PRIORIDADE.forEach((k) => {
    if (!(k in lead)) lead[k] = "";
  });

  return lead;
}

function normalizeStatus(s) {
  return String(s || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeMarcaKey(s) {
  const n = String(s || "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function isMatriculado(l) {
  // Na sua regra atual, FinalizadoM = matriculado
  const s = normalizeStatus(l.STATUS_PENDENTE);
  return s === "FINALIZADOM";
}

function buildWhatsLink(l) {
  const f = String(l.FONE || "").trim() || String(l.FONE2 || "").trim() || String(l.FONE3 || "").trim();
  const p = String(f || "").replace(/\D/g, "");
  if (!p) return "";
  const full = p.startsWith("55") ? p : `55${p}`;
  return `https://wa.me/${full}`;
}

function copiar(txt) {
  if (!txt) return;
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt);
}

/* ------------------------------
   SCORE IA (conversão mídia/curso)
-------------------------------- */
function computeScoreIA(allLeads) {
  const total = new Map();
  const mat = new Map();

  for (const l of allLeads) {
    const key = `${(l.MIDIA || "").trim()}|${(l.CURSO || "").trim()}`;
    total.set(key, (total.get(key) || 0) + 1);
    if (isMatriculado(l)) mat.set(key, (mat.get(key) || 0) + 1);
  }

  for (const l of allLeads) {
    const key = `${(l.MIDIA || "").trim()}|${(l.CURSO || "").trim()}`;
    const taxa = (mat.get(key) || 0) / Math.max(1, total.get(key) || 0);
    const ag = Math.max(0, toInt(l.TOTAL_AGENDAMENTOS));
    const penal = 1 / (1 + ag);
    l.SCORE_IA = taxa * 0.7 + penal * 0.3;
  }
}

/* ------------------------------
   HELPERS
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
