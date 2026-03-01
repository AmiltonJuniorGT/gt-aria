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
  vendedorSelecionado: "TODOS",
  prioridade: [...DEFAULT_PRIORIDADE],
};

const $ = (sel) => document.querySelector(sel);

init();

/* ================= INIT ================= */

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

/* ================= BOOT ================= */

async function boot() {
  state.loading = true;
  state.error = "";
  renderLoading("Carregando dados do Google Sheets…");

  try {
    const csvText = await fetchCsvNoCache(SHEET_CSV_URL);
    const rows = parseCSV(csvText);
    const normalizedRows = rows.map(normalizeRowKeys);
    state.all = normalizedRows.map((r, idx) => normalizeLead(r, idx));

    state.vendedores = [...new Set(
      state.all.map((l) => l.VENDEDOR).filter((v) => v && v.trim())
    )].sort((a, b) => a.localeCompare(b, "pt-BR"));

    state.leads = state.all.filter((l) => !isMatriculado(l));

    if (ENABLE_SCORE_IA) computeScoreIA(state.all);

    state.lastUpdated = new Date();
    state.loading = false;
  } catch (e) {
    state.loading = false;
    state.error = String(e?.message || e);
  }
}

/* ================= ROUTER ================= */

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
      <h2>${escapeHtml(title)}</h2>
      <div style="opacity:.8">Tela em construção.</div>
    </div>
  `;
}

/* ================= UI PRINCIPAL ================= */

function renderQualificacao() {
  if (state.loading) return renderLoading("Carregando…");
  if (state.error) return renderError(state.error);

  $("#view").innerHTML = `
    <div class="card">
      <h2>Qualificação de Leads</h2>
      <div style="opacity:.8;font-size:13px">
        Base: <b>${state.all.length}</b> • Não matriculados: <b>${state.leads.length}</b>
      </div>
      <div style="margin-top:10px;">
        Vendedor:
        <select id="selVendedor">
          <option value="TODOS">Todos</option>
          ${state.vendedores.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join("")}
        </select>
        <button id="btnGerar">Gerar Lista</button>
      </div>
    </div>

    <div class="card">
      <h3>Prioridade (arraste)</h3>
      <div id="drag"></div>
    </div>

    <div class="card">
      <h3>Resultado</h3>
      <div style="overflow:auto">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Nome</th>
              <th>Vendedor</th>
              <th>Data</th>
              <th>Mídia</th>
              <th>Curso</th>
              <th>Agend.</th>
              ${ENABLE_SCORE_IA ? "<th>Score</th>" : ""}
            </tr>
          </thead>
          <tbody id="tbody">
            <tr><td colspan="8">Clique em Gerar Lista</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  renderDrag();

  $("#selVendedor").addEventListener("change", e => {
    state.vendedorSelecionado = e.target.value;
  });

  $("#btnGerar").addEventListener("click", gerarLista);
}

/* ================= DRAG ================= */

function renderDrag() {
  const drag = $("#drag");
  drag.innerHTML = "";

  state.prioridade.forEach(p => {
    const div = document.createElement("div");
    div.textContent = p;
    div.draggable = true;
    div.className = "dragItem";
    drag.appendChild(div);
  });

  enableDrag();
}

function enableDrag() {
  const container = $("#drag");

  container.addEventListener("dragstart", e => {
    if (e.target.classList.contains("dragItem"))
      e.target.classList.add("dragging");
  });

  container.addEventListener("dragend", e => {
    if (e.target.classList.contains("dragItem"))
      e.target.classList.remove("dragging");

    state.prioridade = [...container.querySelectorAll(".dragItem")]
      .map(el => el.textContent.trim());
  });

  container.addEventListener("dragover", e => {
    e.preventDefault();
    const dragging = container.querySelector(".dragging");
    const after = getDragAfter(container, e.clientY);
    if (!after) container.appendChild(dragging);
    else container.insertBefore(dragging, after);
  });
}

function getDragAfter(container, y) {
  const els = [...container.querySelectorAll(".dragItem:not(.dragging)")];
  return els.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset)
      return { offset, element: child };
    return closest;
  }, { offset: -Infinity }).element;
}

/* ================= LISTA ================= */

function gerarLista() {
  let lista = [...state.leads];

  if (state.vendedorSelecionado !== "TODOS") {
    lista = lista.filter(l => l.VENDEDOR === state.vendedorSelecionado);
  }

  lista.sort((a, b) => {
    for (const key of state.prioridade) {
      const dir = SORT_DIR[key] === "desc" ? -1 : 1;

      let av = a[key];
      let bv = b[key];

      if (key === "TOTAL_AGENDAMENTOS")
        av = toInt(av), bv = toInt(bv);

      if (key === "DATA_CADASTRO")
        av = toDate(av), bv = toDate(bv);

      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
    }
    return 0;
  });

  renderTabela(lista);
}

function renderTabela(lista) {
  const tbody = $("#tbody");

  if (!lista.length) {
    tbody.innerHTML = `<tr><td colspan="8">Nenhum lead</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((l,i)=>`
    <tr>
      <td>${i+1}</td>
      <td>${escapeHtml(l.NOME)}</td>
      <td>${escapeHtml(l.VENDEDOR)}</td>
      <td>${escapeHtml(l.DATA_CADASTRO)}</td>
      <td>${escapeHtml(l.MIDIA)}</td>
      <td>${escapeHtml(l.CURSO)}</td>
      <td>${toInt(l.TOTAL_AGENDAMENTOS)}</td>
      ${ENABLE_SCORE_IA ? `<td>${l.SCORE_IA?.toFixed(3) || ""}</td>` : ""}
    </tr>
  `).join("");
}

/* ================= CSV ================= */

async function fetchCsvNoCache(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar CSV.");
  return await res.text();
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "");
  const rows = text.split("\n").map(r => r.split(","));
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).filter(r => r.length).map(r => {
    const obj = {};
    headers.forEach((h,i)=> obj[h]=r[i]||"");
    return obj;
  });
}

function normalizeRowKeys(row) {
  const out = {};
  Object.keys(row).forEach(k => {
    out[normalizeKey(k)] = row[k];
  });
  return out;
}

function normalizeKey(k) {
  return k.trim().toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/\s+/g,"_");
}

/* ================= NORMALIZAÇÃO ================= */

function normalizeLead(r, idx) {
  return {
    ID: idx+1,
    NOME: r.NOME || "",
    VENDEDOR: r.VENDEDOR || "",
    DATA_CADASTRO: r.DATA_CADASTRO || "",
    MIDIA: r.MIDIA || "",
    CURSO: r.CURSO || "",
    TOTAL_AGENDAMENTOS: r.TOTAL_AGENDAMENTOS || 0,
    MATRICULADO: r.MATRICULADO || "",
    SCORE_IA: null
  };
}

function isMatriculado(l) {
  const v = (l.MATRICULADO || "").toUpperCase();
  return v.includes("SIM") || v.includes("MATRIC");
}

/* ================= SCORE ================= */

function computeScoreIA(all) {
  const total = {};
  const matric = {};

  all.forEach(l=>{
    const key = l.MIDIA + "|" + l.CURSO;
    total[key] = (total[key]||0)+1;
    if (isMatriculado(l)) matric[key]=(matric[key]||0)+1;
  });

  all.forEach(l=>{
    const key = l.MIDIA + "|" + l.CURSO;
    l.SCORE_IA = (matric[key]||0)/(total[key]||1);
  });
}

/* ================= HELPERS ================= */

function toInt(v){ return parseInt(v||0,10)||0; }

function toDate(v){
  const d = new Date(v);
  return isNaN(d) ? 0 : d.getTime();
}

function renderLoading(msg){
  $("#view").innerHTML = `<div class="card">${msg}</div>`;
}

function renderError(err){
  $("#view").innerHTML = `<div class="card">Erro: ${escapeHtml(err)}</div>`;
}

function escapeHtml(s){
  return String(s||"")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;");
}

function escapeAttr(s){
  return escapeHtml(s).replaceAll('"',"&quot;");
}
