/* ================================
   GT ARIA — Qualificação (Google Sheets CSV)
   Repo: AmiltonJuniorGT/gt-aria
=================================== */

/** Google Sheets (CSV via gviz) */
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/16CDo-QOkvB1rEbsgJcE7Y2Z-oLzzu2m2/gviz/tq?tqx=out:csv&gid=1636709650";

/** Opcional: Score simples por conversão */
const ENABLE_SCORE_IA = true;

/** Ordenação padrão solicitada */
const DEFAULT_PRIORIDADE = ["VENDEDOR", "DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"];

/** Direção por campo (quando entrar no comparator) */
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

  /** linhas brutas (todas) */
  all: [],

  /** apenas não matriculados (base da tela) */
  leads: [],

  /** vendors */
  vendedores: [],

  /** UI */
  vendedorSelecionado: "TODOS",
  prioridade: [...DEFAULT_PRIORIDADE],
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

  // sidebar links (index.html usa data-route)
  document.querySelectorAll("[data-route]").forEach((a) => {
    a.addEventListener("click", () => {
      location.hash = a.getAttribute("data-route");
    });
  });
}

async function boot() {
  state.loading = true;
  state.error = "";
  renderLoading("Carregando dados do Google Sheets…");

  try {
    const csvText = await fetchCsvNoCache(SHEET_CSV_URL);

    // parse robusto
    const rows = parseCSV(csvText);

    // normaliza cabeçalhos: trim + remove BOM + mantém original
    // e cria mapeamento tolerante (case-insensitive, espaços, acentos)
    const normalizedRows = rows.map(normalizeRowKeys);

    state.all = normalizedRows.map((r, idx) => normalizeLead(r, idx));

    // vendedores
    state.vendedores = unique(
      state.all
        .map((l) => l.VENDEDOR)
        .filter((v) => (v || "").trim().length > 0)
        .map((v) => v.trim())
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));

    // filtra não matriculados
    state.leads = state.all.filter((l) => !isMatriculado(l));

    // score
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

  // crumbs
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

  const totalNaoMat = state.leads.length;
  const totalAll = state.all.length;

  view.innerHTML = `
    <div class="card">
      <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;justify-content:space-between;">
        <div>
          <h2 style="margin:0 0 4px 0;">Qualificação de Leads</h2>
          <div style="opacity:.85;font-size:13px">
            Base: <b>${totalAll}</b> leads • Não matriculados: <b>${totalNaoMat}</b>
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
        </div>
      </div>
    </div>

    <div style="height:12px"></div>

    <div class="card">
      <h3 style="margin:0 0 8px 0;">Prioridade de Ordenação (arraste para reordenar)</h3>
      <div id="drag" style="max-width:420px;"></div>
      <div style="font-size:12px;opacity:.8;margin-top:8px;">
        Direções fixas: <b>DATA_CADASTRO desc</b> • <b>TOTAL_AGENDAMENTOS asc</b> • demais asc
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
              <th>Vendedor</th>
              <th>Data Cadastro</th>
              <th>Mídia</th>
              <th>Curso</th>
              <th>Agend.</th>
              ${ENABLE_SCORE_IA ? "<th>Score IA</th>" : ""}
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="${ENABLE_SCORE_IA ? 8 : 7}" style="opacity:.7;">Clique em <b>Gerar Lista</b>.</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // monta drag
  renderDrag();

  // bind
  $("#selVendedor").addEventListener("change", (e) => {
    state.vendedorSelecionado = e.target.value || "TODOS";
  });

  $("#btnGerar").addEventListener("click", gerarLista);
  $("#btnRecarregar").addEventListener("click", async () => {
    await boot();
    renderRoute();
  });
}

function renderVendedorOptions() {
  const opts = [`<option value="TODOS">Todos</option>`].concat(
    state.vendedores.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`)
  );

  // mantém selecionado
  return opts
    .map((o) => {
      if (o.includes(`value="${escapeAttr(state.vendedorSelecionado)}"`)) {
        return o.replace("<option ", "<option selected ");
      }
      return o;
    })
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
   GERAR LISTA + TABELA
-------------------------------- */
function gerarLista() {
  let lista = [...state.leads];

  // filtro vendedor
  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter((l) => (l.VENDEDOR || "").trim() === state.vendedorSelecionado);
  }

  // ordenação multi-campo pela prioridade (com direções fixas por campo)
  lista.sort(makeMultiComparator(state.prioridade));

  // render
  renderTabela(lista);

  const info = $("#resultadoInfo");
  info.textContent = `Linhas: ${lista.length} • Prioridade: ${state.prioridade.join(" > ")}`;
}

function makeMultiComparator(keys) {
  return (a, b) => {
    for (const k of keys) {
      const dir = SORT_DIR[k] || "asc";

      const av = a[k];
      const bv = b[k];

      let cmp = 0;

      if (k === "TOTAL_AGENDAMENTOS") {
        cmp = (toInt(av) - toInt(bv));
      } else if (k === "DATA_CADASTRO") {
        cmp = (toDate(bv) - toDate(av)); // já é DESC por padrão
        // se alguém inverter prioridade e ainda quiser asc, respeita dir:
        if (dir === "asc") cmp = -cmp;
      } else {
        cmp = String(av || "").localeCompare(String(bv || ""), "pt-BR", { sensitivity: "base" });
      }

      if (cmp !== 0) return dir === "desc" && k !== "DATA_CADASTRO" ? -cmp : cmp;
      // obs: DATA_CADASTRO tratada acima
    }
    return 0;
  };
}

function renderTabela(lista) {
  const tbody = $("#tbody");

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="${ENABLE_SCORE_IA ? 8 : 7}" style="opacity:.7;">Nenhum lead para este filtro.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista
    .map((l, i) => {
      return `
        <tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(l.NOME || "")}</td>
          <td>${escapeHtml(l.VENDEDOR || "")}</td>
          <td>${escapeHtml(l.DATA_CADASTRO || "")}</td>
          <td>${escapeHtml(l.MIDIA || "")}</td>
          <td>${escapeHtml(l.CURSO || "")}</td>
          <td>${escapeHtml(String(toInt(l.TOTAL_AGENDAMENTOS)))}</td>
          ${
            ENABLE_SCORE_IA
              ? `<td>${l.SCORE_IA != null ? Number(l.SCORE_IA).toFixed(3) : ""}</td>`
              : ""
          }
        </tr>
      `;
    })
    .join("");
}

/* ------------------------------
   CSV FETCH + PARSE (robusto)
-------------------------------- */
async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV. Confirme se a planilha está pública.");
  return await res.text();
}

/**
 * CSV robusto (suporta aspas, vírgula, quebra de linha em campo quoted)
 * Retorna array de objetos usando headers da primeira linha.
 */
function parseCSV(text) {
  // remove BOM
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

  // última linha
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }

  // remove linhas vazias
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

/**
 * Cria um objeto com chaves normalizadas (tolerante a case/espaço/acentos)
 * mas mantém também o original para fallback.
 */
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
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s+/g, "_");
}

/* ------------------------------
   NORMALIZAÇÃO LEAD + REGRAS
-------------------------------- */
function normalizeLead(r, idx) {
  // leitura por headers tolerantes
  const get = (...keys) => {
    for (const k of keys) {
      const nk = normalizeKey(k);
      if (r[nk] != null && String(r[nk]).trim() !== "") return r[nk];
    }

    // fallback: tenta raw exato
    if (r.__raw) {
      for (const k of keys) {
        if (r.__raw[k] != null && String(r.__raw[k]).trim() !== "") return r.__raw[k];
      }
    }
    return "";
  };

  const lead = {
    ID: idx + 1,
    NOME: get("NOME", "NOME_LEAD", "ALUNO", "NOME_COMPLETO"),
    CPF: get("CPF"),
    VENDEDOR: get("VENDEDOR", "CONSULTOR", "RESPONSAVEL"),
    DATA_CADASTRO: get("DATA_CADASTRO", "DT_CADASTRO", "DATA", "DATA_DE_CADASTRO"),
    MIDIA: get("MIDIA", "MÍDIA", "ORIGEM", "FONTE", "CANAL"),
    CURSO: get("CURSO", "CURSO_INTERESSE", "CURSO_DE_INTERESSE"),
    TOTAL_AGENDAMENTOS: toInt(get("TOTAL_AGENDAMENTOS", "AGENDAMENTOS", "TOTAL_AGEND", "QTD_AGENDAMENTOS")),
    MATRICULADO: get("MATRICULADO", "MATRICULA", "STATUS_MATRICULA", "SITUACAO"),
    STATUS_PENDENCIA: get("STATUS_PENDENCIA", "PENDENCIA", "PENDÊNCIAS"),
    SCORE_IA: null,
  };

  // espelha nos nomes padrão pedidos (para ordenar/render)
  // garante que sempre existam as chaves padrão:
  DEFAULT_PRIORIDADE.forEach((k) => {
    if (!(k in lead)) lead[k] = "";
  });

  return lead;
}

function isMatriculado(l) {
  const v = String(l.MATRICULADO || "").trim().toUpperCase();
  if (!v) return false;

  // considera "SIM" e variações
  if (["SIM", "S", "YES", "Y", "TRUE", "1"].includes(v)) return true;

  // caso status/situação venha como texto contendo "MATRIC"
  if (v.includes("MATRIC")) return true;

  return false;
}

/* ------------------------------
   SCORE IA (conversão por mídia/curso)
-------------------------------- */
function computeScoreIA(allLeads) {
  const totalMidia = new Map();
  const matMidia = new Map();
  const totalCurso = new Map();
  const matCurso = new Map();

  for (const l of allLeads) {
    const m = (l.MIDIA || "").trim() || "(vazio)";
    const c = (l.CURSO || "").trim() || "(vazio)";

    totalMidia.set(m, (totalMidia.get(m) || 0) + 1);
    totalCurso.set(c, (totalCurso.get(c) || 0) + 1);

    if (isMatriculado(l)) {
      matMidia.set(m, (matMidia.get(m) || 0) + 1);
      matCurso.set(c, (matCurso.get(c) || 0) + 1);
    }
  }

  for (const l of allLeads) {
    const m = (l.MIDIA || "").trim() || "(vazio)";
    const c = (l.CURSO || "").trim() || "(vazio)";

    const rm = (matMidia.get(m) || 0) / Math.max(1, totalMidia.get(m) || 0);
    const rc = (matCurso.get(c) || 0) / Math.max(1, totalCurso.get(c) || 0);

    // 0..1
    l.SCORE_IA = rm * 0.6 + rc * 0.4;
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
        Dica: confirme se a planilha está pública e se o <b>gid</b> é da aba <b>data</b>.
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

function toInt(v) {
  const n = parseInt(String(v || "").replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function toDate(v) {
  const s = String(v || "").trim();
  if (!s) return new Date("1970-01-01").getTime();

  // tenta ISO
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return iso;

  // tenta BR dd/mm/yyyy (com ou sem hora)
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
