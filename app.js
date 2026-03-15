const CONFIG = {
  SHEET_ID: "1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI",
  GID: "1731723852",
  CSV_URL:
    "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852",
  MAX_GENERATED: 30,
};

const state = {
  headers: [],
  rows: [],
  filtered: [],
  generated: [],
  cols: {},
};

const $ = (selector) => document.querySelector(selector);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result.map((v) => String(v ?? "").trim());
}

function parseCSV(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseCSVLine);
}

function toNumber(value) {
  const cleaned = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function parseDateBR(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]) - 1;
    const year = Number(br[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function diffDaysFromToday(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const base = new Date(date);
  base.setHours(0, 0, 0, 0);

  return Math.round((today.getTime() - base.getTime()) / 86400000);
}

function buildCols() {
  state.cols = {};
  state.headers.forEach((header, index) => {
    state.cols[normalize(header)] = index;
  });
}

function getCell(row, columnName) {
  const idx = state.cols[normalize(columnName)];
  return idx >= 0 ? String(row[idx] ?? "").trim() : "";
}

function getPhone(row) {
  return (
    getCell(row, "FONE") ||
    getCell(row, "FONE2") ||
    getCell(row, "FONE3") ||
    ""
  );
}

function classifyPriority(score) {
  if (score >= 70) return "Alta";
  if (score >= 35) return "Média";
  return "Baixa";
}

function scoreLead(row) {
  let score = 0;

  const totalAg = toNumber(getCell(row, "TOTAL_AGENDAMENTOS"));
  const status = normalize(getCell(row, "STATUS"));
  const pendencia = normalize(getCell(row, "STATUS_PENDENCIA"));
  const midia = normalize(getCell(row, "MIDIA"));
  const curso = normalize(getCell(row, "CURSO"));
  const tipoCadastro = normalize(getCell(row, "TIPO_CADASTRO"));
  const turno = normalize(getCell(row, "TURNO"));

  const dataCadastro = parseDateBR(getCell(row, "DATA_CADASTRO"));
  const dataAgendamento = parseDateBR(getCell(row, "DATA_AGENDAMENTO"));
  const dataMatricula = parseDateBR(getCell(row, "DATA_MATRICULA"));

  const ageCadastro = diffDaysFromToday(dataCadastro);
  const ageAgendamento = diffDaysFromToday(dataAgendamento);

  score += totalAg * 14;

  if (dataAgendamento) score += 18;
  if (dataMatricula) score -= 1000;

  if (status.includes("agend")) score += 24;
  if (status.includes("confirm")) score += 20;
  if (status.includes("contato")) score += 8;
  if (status.includes("retorno")) score += 10;
  if (status.includes("interesse")) score += 12;
  if (status.includes("matric")) score -= 1000;
  if (status.includes("perd")) score -= 25;
  if (status.includes("cancel")) score -= 35;
  if (status.includes("sem interesse")) score -= 25;
  if (status.includes("duplic")) score -= 20;

  if (pendencia) score -= 8;

  if (midia.includes("indic")) score += 10;
  if (midia.includes("whats")) score += 7;
  if (midia.includes("instagram")) score += 5;
  if (midia.includes("facebook")) score += 3;
  if (midia.includes("google")) score += 4;
  if (midia.includes("site")) score += 2;

  if (tipoCadastro) score += 4;
  if (turno.includes("noite")) score += 2;
  if (curso) score += 3;

  if (ageCadastro !== null) {
    if (ageCadastro <= 2) score += 22;
    else if (ageCadastro <= 7) score += 14;
    else if (ageCadastro <= 15) score += 6;
    else if (ageCadastro > 45) score -= 10;
    else if (ageCadastro > 90) score -= 18;
  }

  if (ageAgendamento !== null) {
    if (ageAgendamento <= 1) score += 14;
    else if (ageAgendamento <= 3) score += 8;
    else if (ageAgendamento > 15) score -= 8;
  }

  return score;
}

function rowToLead(row) {
  const score = scoreLead(row);

  return {
    raw: row,
    score,
    priority: classifyPriority(score),
    nome: getCell(row, "NOME"),
    curso: getCell(row, "CURSO"),
    midia: getCell(row, "MIDIA"),
    vendedor: getCell(row, "VENDEDOR"),
    status: getCell(row, "STATUS"),
    pendencia: getCell(row, "STATUS_PENDENCIA"),
    totalAgendamentos: getCell(row, "TOTAL_AGENDAMENTOS"),
    telefone: getPhone(row),
    dataAgendamento: getCell(row, "DATA_AGENDAMENTO"),
    dataCadastro: getCell(row, "DATA_CADASTRO"),
    dataMatricula: getCell(row, "DATA_MATRICULA"),
  };
}

function uniqueValues(columnName) {
  const values = state.rows
    .map((item) => getCell(item.raw, columnName))
    .filter(Boolean);

  return [...new Set(values)].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function optionTags(values) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
    .join("");
}

function getFilteredLeads() {
  const busca = normalize($("#fBusca")?.value || "");
  const vendedor = normalize($("#fVendedor")?.value || "");
  const midia = normalize($("#fMidia")?.value || "");
  const curso = normalize($("#fCurso")?.value || "");
  const prioridade = normalize($("#fPrioridade")?.value || "");

  return state.rows
    .filter((item) => {
      const allText = normalize(item.raw.join(" "));
      const rowVendedor = normalize(item.vendedor);
      const rowMidia = normalize(item.midia);
      const rowCurso = normalize(item.curso);
      const rowPrioridade = normalize(item.priority);

      if (busca && !allText.includes(busca)) return false;
      if (vendedor && rowVendedor !== vendedor) return false;
      if (midia && rowMidia !== midia) return false;
      if (curso && rowCurso !== curso) return false;
      if (prioridade && rowPrioridade !== prioridade) return false;

      return true;
    })
    .sort((a, b) => b.score - a.score);
}

function renderScreen() {
  const view = $("#view");
  if (!view) return;

  const vendedores = uniqueValues("VENDEDOR");
  const midias = uniqueValues("MIDIA");
  const cursos = uniqueValues("CURSO");

  view.innerHTML = `
    <section class="panel">
      <div class="filters" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px;">
        <label>
          <div>Buscar</div>
          <input id="fBusca" type="text" placeholder="Nome, telefone, curso..." />
        </label>

        <label>
          <div>Vendedor</div>
          <select id="fVendedor">
            <option value="">Todos</option>
            ${optionTags(vendedores)}
          </select>
        </label>

        <label>
          <div>Mídia</div>
          <select id="fMidia">
            <option value="">Todas</option>
            ${optionTags(midias)}
          </select>
        </label>

        <label>
          <div>Curso</div>
          <select id="fCurso">
            <option value="">Todos</option>
            ${optionTags(cursos)}
          </select>
        </label>

        <label>
          <div>Prioridade</div>
          <select id="fPrioridade">
            <option value="">Todas</option>
            <option value="Alta">Alta</option>
            <option value="Média">Média</option>
            <option value="Baixa">Baixa</option>
          </select>
        </label>
      </div>

      <h3 style="margin:0 0 12px 0;">Sugestões da IA</h3>
      <div id="aiGrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin-bottom:18px;"></div>

      <div style="overflow:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;">Score</th>
              <th style="text-align:left;">Prioridade</th>
              <th style="text-align:left;">Nome</th>
              <th style="text-align:left;">Curso</th>
              <th style="text-align:left;">Mídia</th>
              <th style="text-align:left;">Vendedor</th>
              <th style="text-align:left;">Status</th>
              <th style="text-align:left;">Agend.</th>
              <th style="text-align:left;">Telefone</th>
              <th style="text-align:left;">Data Agendamento</th>
            </tr>
          </thead>
          <tbody id="tbodyLeads"></tbody>
        </table>
      </div>
    </section>
  `;

  const filterIds = ["#fBusca", "#fVendedor", "#fMidia", "#fCurso", "#fPrioridade"];
  filterIds.forEach((id) => {
    const el = $(id);
    if (!el) return;
    const eventName = el.tagName === "INPUT" ? "input" : "change";
    el.addEventListener(eventName, applyFilters);
  });

  applyFilters();
}

function cardHtml(title, value, desc) {
  return `
    <div class="ai-card" style="border:1px solid rgba(0,0,0,.08);border-radius:14px;padding:14px;">
      <div style="font-size:12px;opacity:.7;margin-bottom:6px;">${escapeHtml(title)}</div>
      <div style="font-size:24px;font-weight:700;line-height:1.1;margin-bottom:8px;">${escapeHtml(value)}</div>
      <div style="font-size:13px;opacity:.8;">${escapeHtml(desc)}</div>
    </div>
  `;
}

function renderAICards() {
  const aiGrid = $("#aiGrid");
  if (!aiGrid) return;

  const leads = state.filtered;
  const high = leads.filter((item) => item.priority === "Alta");
  const medium = leads.filter((item) => item.priority === "Média");
  const top = leads[0] || null;

  const sellerScores = {};
  const courseScores = {};

  leads.forEach((item) => {
    const seller = item.vendedor || "Sem vendedor";
    const course = item.curso || "Sem curso";

    sellerScores[seller] = (sellerScores[seller] || 0) + item.score;
    courseScores[course] = (courseScores[course] || 0) + item.score;
  });

  const bestSeller =
    Object.entries(sellerScores).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  const bestCourse =
    Object.entries(courseScores).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";

  aiGrid.innerHTML = [
    cardHtml(
      "Leads prioritários",
      String(high.length),
      "Quantidade de leads com maior chance de avanço imediato."
    ),
    cardHtml(
      "Faixa média",
      String(medium.length),
      "Leads que precisam de ação comercial rápida para subir de prioridade."
    ),
    cardHtml(
      "Melhor lead agora",
      top ? top.nome || "Sem nome" : "—",
      top
        ? `${top.curso || "Sem curso"} • ${top.vendedor || "Sem vendedor"} • Score ${top.score}`
        : "Sem dados no filtro atual."
    ),
    cardHtml(
      "Sugestão IA",
      bestSeller,
      `Começar pelos leads do curso ${bestCourse}.`
    ),
  ].join("");
}

function renderTable() {
  const tbody = $("#tbodyLeads");
  if (!tbody) return;

  if (!state.filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="padding:12px 0;">Nenhum lead encontrado com os filtros atuais.</td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = state.filtered
    .map((item) => {
      return `
        <tr>
          <td>${item.score}</td>
          <td>${escapeHtml(item.priority)}</td>
          <td>${escapeHtml(item.nome)}</td>
          <td>${escapeHtml(item.curso)}</td>
          <td>${escapeHtml(item.midia)}</td>
          <td>${escapeHtml(item.vendedor)}</td>
          <td>${escapeHtml(item.status)}</td>
          <td>${escapeHtml(item.totalAgendamentos)}</td>
          <td>${escapeHtml(item.telefone)}</td>
          <td>${escapeHtml(item.dataAgendamento)}</td>
        </tr>
      `;
    })
    .join("");
}

function applyFilters() {
  state.filtered = getFilteredLeads();

  const crumbs = $("#crumbs");
  if (crumbs) {
    crumbs.textContent = `Base carregada: ${state.filtered.length} leads`;
  }

  renderAICards();
  renderTable();
}

function generateList() {
  state.generated = state.filtered.slice(0, CONFIG.MAX_GENERATED);

  if (!state.generated.length) {
    window.alert("Nenhum lead encontrado com os filtros atuais.");
    return;
  }

  window.alert(`Lista gerada com ${state.generated.length} leads prioritários.`);
}

function exportCSV() {
  const rows = state.filtered;
  if (!rows.length) {
    window.alert("Não há dados para exportar.");
    return;
  }

  const headers = [
    "SCORE",
    "PRIORIDADE",
    "NOME",
    "CURSO",
    "MIDIA",
    "VENDEDOR",
    "STATUS",
    "TOTAL_AGENDAMENTOS",
    "FONE",
    "DATA_AGENDAMENTO",
    "DATA_CADASTRO",
    "STATUS_PENDENCIA",
  ];

  const csvRows = rows.map((item) => [
    item.score,
    item.priority,
    item.nome,
    item.curso,
    item.midia,
    item.vendedor,
    item.status,
    item.totalAgendamentos,
    item.telefone,
    item.dataAgendamento,
    item.dataCadastro,
    item.pendencia,
  ]);

  const csv = [headers, ...csvRows]
    .map((row) =>
      row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads-qualificados.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadBase() {
  const crumbs = $("#crumbs");
  const view = $("#view");

  if (crumbs) crumbs.textContent = "Carregando base...";
  if (view) view.innerHTML = "Carregando...";

  try {
    const response = await fetch(CONFIG.CSV_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const parsed = parseCSV(text);

    if (!parsed.length || parsed.length < 2) {
      throw new Error("Base vazia");
    }

    state.headers = parsed[0];
    buildCols();

    state.rows = parsed
      .slice(1)
      .filter((row) => row.some((cell) => String(cell ?? "").trim() !== ""))
      .map(rowToLead)
      .sort((a, b) => b.score - a.score);

    state.filtered = [...state.rows];

    renderScreen();

    if (crumbs) {
      crumbs.textContent = `Base carregada: ${state.rows.length} leads`;
    }
  } catch (error) {
    console.error(error);

    if (crumbs) crumbs.textContent = "Erro ao carregar base";
    if (view) {
      view.innerHTML = `
        <div style="padding:12px 0;">
          Erro ao carregar a planilha.
        </div>
      `;
    }
  }
}

function bindTopButtons() {
  const btnReload = $("#btnRecarregarTop");
  const btnGenerate = $("#btnGerarTop");
  const btnExport = $("#btnExportTop");

  if (btnReload) btnReload.onclick = loadBase;
  if (btnGenerate) btnGenerate.onclick = generateList;
  if (btnExport) btnExport.onclick = exportCSV;
}

function init() {
  bindTopButtons();
  loadBase();
}

window.addEventListener("DOMContentLoaded", init);
