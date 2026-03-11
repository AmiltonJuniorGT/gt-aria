console.log("ARIA iniciado");

/* PLANILHA */
const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

/* ELEMENTOS */
const crumbs = document.getElementById("crumbs");
const view = document.getElementById("view");
const btnRecarregarTop = document.getElementById("btnRecarregarTop");
const btnGerarTop = document.getElementById("btnGerarTop");
const btnExportTop = document.getElementById("btnExportTop");

/* ESTADO */
let BASE_RAW = [];
let BASE_ROWS = [];
let FILTRADOS = [];
let COLS = {};
let LISTA_GERADA = [];

/* HELPERS */
function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
  return result.map(v => v.trim());
}

function parseCSV(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter(line => line.trim() !== "")
    .map(parseCSVLine);
}

function normalizar(texto) {
  return String(texto || "").trim().toLowerCase();
}

function toNumber(value) {
  const n = Number(String(value || "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function getColIndex(nome) {
  const key = normalizar(nome);
  return Object.prototype.hasOwnProperty.call(COLS, key) ? COLS[key] : -1;
}

function getCell(row, nome) {
  const idx = getColIndex(nome);
  return idx >= 0 ? String(row[idx] ?? "").trim() : "";
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/* SCORE */
function calcularScore(row) {
  let score = 0;

  const totalAg = toNumber(getCell(row, "TOTAL_AGENDAMENTOS"));
  const curso = getCell(row, "CURSO");
  const midia = getCell(row, "MIDIA");
  const status = getCell(row, "STATUS");
  const pendencia = getCell(row, "STATUS_PENDENCIA");
  const dataAg = getCell(row, "DATA_AGENDAMENTO");
  const dataMat = getCell(row, "DATA_MATRICULA");
  const tipoCadastro = getCell(row, "TIPO_CADASTRO");

  score += totalAg * 15;

  if (dataAg) score += 20;
  if (dataMat) score -= 1000;
  if (pendencia) score -= 5;
  if (tipoCadastro) score += 4;

  const statusNorm = normalizar(status);
  if (statusNorm.includes("agend")) score += 25;
  if (statusNorm.includes("confirm")) score += 20;
  if (statusNorm.includes("matric")) score -= 1000;
  if (statusNorm.includes("perd")) score -= 30;
  if (statusNorm.includes("cancel")) score -= 40;

  const midiaNorm = normalizar(midia);
  if (midiaNorm.includes("indic")) score += 10;
  if (midiaNorm.includes("whats")) score += 6;
  if (midiaNorm.includes("instagram")) score += 5;

  if (curso) score += 3;

  return score;
}

function classificarFaixa(score) {
  if (score >= 45) return "Alta";
  if (score >= 20) return "Média";
  return "Baixa";
}

/* CARREGAR BASE */
async function carregarBase() {
  crumbs.innerText = "Carregando base...";

  try {
    const r = await fetch(CSV_URL, { cache: "no-store" });
    const t = await r.text();

    BASE_RAW = parseCSV(t);
    if (!BASE_RAW.length || BASE_RAW.length < 2) {
      throw new Error("Base vazia");
    }

    COLS = {};
    BASE_RAW[0].forEach((nome, idx) => {
      COLS[normalizar(nome)] = idx;
    });

    BASE_ROWS = BASE_RAW.slice(1).map(row => {
      const score = calcularScore(row);
      return {
        raw: row,
        score,
        faixa: classificarFaixa(score)
      };
    });

    FILTRADOS = [...BASE_ROWS].sort((a, b) => b.score - a.score);

    crumbs.innerText = "Base carregada: " + BASE_ROWS.length + " leads";

    renderTela();
  } catch (e) {
    crumbs.innerText = "Erro ao carregar base";
    console.log(e);
    view.innerHTML = `
      <div class="card">
        Erro ao carregar a planilha.
      </div>
    `;
  }
}

/* TELA */
function renderTela() {
  const vendedores = uniqueSorted(BASE_ROWS.map(item => getCell(item.raw, "VENDEDOR")));
  const midias = uniqueSorted(BASE_ROWS.map(item => getCell(item.raw, "MIDIA")));
  const cursos = uniqueSorted(BASE_ROWS.map(item => getCell(item.raw, "CURSO")));

  view.innerHTML = `
    <div class="card">
      <div class="filtersGrid">
        <div class="field">
          <label class="label">Buscar</label>
          <input id="fBusca" class="input" placeholder="Nome, curso, telefone, status...">
        </div>

        <div class="field">
          <label class="label">Vendedor</label>
          <select id="fVendedor" class="select">
            <option value="">Todos</option>
            ${vendedores.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label">Mídia</label>
          <select id="fMidia" class="select">
            <option value="">Todas</option>
            ${midias.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label">Curso</label>
          <select id="fCurso" class="select">
            <option value="">Todos</option>
            ${cursos.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>

    <div class="card">
      <h3 class="aiTitle">Sugestões da IA</h3>
      <div class="aiGrid" id="aiGrid"></div>
      <div class="smallNote">Lista dinâmica baseada em score, agendamentos, status e sinais da base.</div>
    </div>

    <div class="card">
      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Score</th>
              <th>Prioridade</th>
              <th>Nome</th>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Vendedor</th>
              <th>Status</th>
              <th>Agendamentos</th>
              <th>Telefone</th>
              <th>Data Agendamento</th>
            </tr>
          </thead>
          <tbody id="tbodyLeads"></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById("fBusca").addEventListener("input", aplicarFiltros);
  document.getElementById("fVendedor").addEventListener("change", aplicarFiltros);
  document.getElementById("fMidia").addEventListener("change", aplicarFiltros);
  document.getElementById("fCurso").addEventListener("change", aplicarFiltros);

  aplicarFiltros();
}

/* FILTROS */
function aplicarFiltros() {
  const busca = normalizar(document.getElementById("fBusca")?.value);
  const vendedor = normalizar(document.getElementById("fVendedor")?.value);
  const midia = normalizar(document.getElementById("fMidia")?.value);
  const curso = normalizar(document.getElementById("fCurso")?.value);

  FILTRADOS = BASE_ROWS
    .filter(item => {
      const row = item.raw;

      const okBusca = !busca || row.join(" ").toLowerCase().includes(busca);
      const okVendedor = !vendedor || normalizar(getCell(row, "VENDEDOR")) === vendedor;
      const okMidia = !midia || normalizar(getCell(row, "MIDIA")) === midia;
      const okCurso = !curso || normalizar(getCell(row, "CURSO")) === curso;

      return okBusca && okVendedor && okMidia && okCurso;
    })
    .sort((a, b) => b.score - a.score);

  crumbs.innerText = "Base carregada: " + FILTRADOS.length + " leads";
  renderCardsIA();
  renderTabela();
}

/* CARDS IA */
function renderCardsIA() {
  const aiGrid = document.getElementById("aiGrid");
  if (!aiGrid) return;

  const altas = FILTRADOS.filter(item => item.faixa === "Alta");
  const top1 = FILTRADOS[0];
  const vendedorTop = descobrirMelhorVendedor(FILTRADOS);
  const cursoTop = descobrirCursoTop(FILTRADOS);

  aiGrid.innerHTML = `
    <div class="aiCard">
      <div class="aiCardTitle">Leads prioritários</div>
      <div class="aiCardValue">${altas.length}</div>
      <div class="aiCardText">Quantidade de leads com maior probabilidade de avanço imediato.</div>
    </div>

    <div class="aiCard">
      <div class="aiCardTitle">Melhor lead agora</div>
      <div class="aiCardValue">${escapeHtml(top1 ? getCell(top1.raw, "NOME") || "—" : "—")}</div>
      <div class="aiCardText">
        ${top1 ? `Curso: ${escapeHtml(getCell(top1.raw, "CURSO"))} • Vendedor: ${escapeHtml(getCell(top1.raw, "VENDEDOR"))} • Score: ${top1.score}` : "Sem dados"}
      </div>
    </div>

    <div class="aiCard">
      <div class="aiCardTitle">Sugestão IA</div>
      <div class="aiCardValue">${escapeHtml(vendedorTop || "—")}</div>
      <div class="aiCardText">
        ${cursoTop ? `Priorizar contatos do curso ${escapeHtml(cursoTop)} e atacar primeiro os leads com mais agendamentos.` : "Sem recomendação no momento."}
      </div>
    </div>
  `;
}

function descobrirMelhorVendedor(lista) {
  const mapa = {};

  lista.forEach(item => {
    const vendedor = getCell(item.raw, "VENDEDOR") || "Sem vendedor";
    mapa[vendedor] = (mapa[vendedor] || 0) + item.score;
  });

  const ordenado = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  return ordenado[0]?.[0] || "";
}

function descobrirCursoTop(lista) {
  const mapa = {};

  lista.forEach(item => {
    const curso = getCell(item.raw, "CURSO") || "Sem curso";
    mapa[curso] = (mapa[curso] || 0) + item.score;
  });

  const ordenado = Object.entries(mapa).sort((a, b) => b[1] - a[1]);
  return ordenado[0]?.[0] || "";
}

/* TABELA */
function renderTabela() {
  const tbody = document.getElementById("tbodyLeads");
  if (!tbody) return;

  tbody.innerHTML = FILTRADOS.map(item => {
    const row = item.raw;
    const nome = getCell(row, "NOME");
    const curso = getCell(row, "CURSO");
    const midia = getCell(row, "MIDIA");
    const vendedor = getCell(row, "VENDEDOR");
    const status = getCell(row, "STATUS");
    const ag = getCell(row, "TOTAL_AGENDAMENTOS");
    const fone = getCell(row, "FONE") || getCell(row, "FONE2") || getCell(row, "FONE3");
    const dataAg = getCell(row, "DATA_AGENDAMENTO");

    return `
      <tr>
        <td><strong>${item.score}</strong></td>
        <td><span class="badge">${escapeHtml(item.faixa)}</span></td>
        <td>${escapeHtml(nome)}</td>
        <td>${escapeHtml(curso)}</td>
        <td>${escapeHtml(midia)}</td>
        <td>${escapeHtml(vendedor)}</td>
        <td>${escapeHtml(status)}</td>
        <td>${escapeHtml(ag)}</td>
        <td>${escapeHtml(fone)}</td>
        <td>${escapeHtml(dataAg)}</td>
      </tr>
    `;
  }).join("");
}

/* GERAR LISTA */
function gerarLista() {
  LISTA_GERADA = FILTRADOS.slice(0, 30);

  if (!LISTA_GERADA.length) {
    alert("Nenhum lead encontrado com os filtros atuais.");
    return;
  }

  alert("Lista gerada com " + LISTA_GERADA.length + " leads prioritários.");
}

/* EXPORTAR LISTA */
function exportarCSV() {
  if (!FILTRADOS.length) return;

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
    "DATA_AGENDAMENTO"
  ];

  const rows = FILTRADOS.map(item => [
    item.score,
    item.faixa,
    getCell(item.raw, "NOME"),
    getCell(item.raw, "CURSO"),
    getCell(item.raw, "MIDIA"),
    getCell(item.raw, "VENDEDOR"),
    getCell(item.raw, "STATUS"),
    getCell(item.raw, "TOTAL_AGENDAMENTOS"),
    getCell(item.raw, "FONE") || getCell(item.raw, "FONE2") || getCell(item.raw, "FONE3"),
    getCell(item.raw, "DATA_AGENDAMENTO")
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads-qualificados.csv";
  a.click();
  URL.revokeObjectURL(url);
}

/* EVENTOS */
if (btnRecarregarTop) btnRecarregarTop.addEventListener("click", carregarBase);
if (btnGerarTop) btnGerarTop.addEventListener("click", gerarLista);
if (btnExportTop) btnExportTop.addEventListener("click", exportarCSV);

/* START */
window.onload = carregarBase;
}

}

/* TELA */

function renderTela(){

let html = `

<div class="card">

<input id="busca" placeholder="Buscar lead..." style="width:100%;padding:10px">

</div>

<div class="card">

<table>

<thead>
<tr>
${BASE[0].map(c=>"<th>"+c+"</th>").join("")}
</tr>
</thead>

<tbody id="tbody"></tbody>

</table>

</div>

`;

view.innerHTML = html;

renderTabela(BASE);

document.getElementById("busca")
.addEventListener("input",filtrar);

}

/* FILTRO */

function filtrar(){

const termo =
document.getElementById("busca").value.toLowerCase();

let filtrados = BASE.filter((l,i)=>{

if(i===0) return true;

return l.join(" ").toLowerCase().includes(termo);

});

renderTabela(filtrados);

}

/* TABELA */

function renderTabela(linhas){

let tbody = "";

for(let i=1;i<linhas.length;i++){

tbody += "<tr>";

linhas[i].forEach(c=>{
tbody += "<td>"+c+"</td>";
});

tbody += "</tr>";

}

document.getElementById("tbody").innerHTML = tbody;

}

/* START */

window.onload = carregarBase;
}

/* TABELA */
function renderTabela(linhas){

let html = "<div class='card'>";

html += "<table>";
html += "<tr>";

linhas[0].forEach(c => {
html += "<th>"+c+"</th>";
});

html += "</tr>";

for(let i=1;i<linhas.length;i++){

html += "<tr>";

linhas[i].forEach(c=>{
html += "<td>"+c+"</td>";
});

html += "</tr>";

}

html += "</table>";
html += "</div>";

view.innerHTML = html;

}

/* START */
window.onload = carregarBase;
