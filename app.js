const CONFIG = {
  SHEET_ID: "1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI",
  SHEET_NAME: "data",
  GID: "1731723852",
  TIMEOUT: 20000,
  MAX_RENDER: 300
};

const STATE = {
  route: location.hash || "#/qualificacao",
  rows: [],
  filtered: [],
  headers: [],
  loading: false,
  error: "",
  loadedAt: null,
  source: "",
  filters: {
    vendedor: "",
    midia: "",
    curso: "",
    busca: "",
    somenteComAgendamento: false,
    somenteSemMatricula: true
  }
};

document.addEventListener("DOMContentLoaded", initApp);

function initApp() {
  bindShellEvents();
  renderRoute();
  loadData();
}

function bindShellEvents() {
  window.addEventListener("hashchange", function () {
    STATE.route = location.hash || "#/qualificacao";
    renderRoute();
  });

  var btnReload = document.getElementById("btnRecarregarTop");
  var btnGerar = document.getElementById("btnGerarTop");
  var btnExport = document.getElementById("btnExportTop");

  if (btnReload) btnReload.addEventListener("click", loadData);

  if (btnGerar) {
    btnGerar.addEventListener("click", function () {
      applyFilters();
      renderRoute();
    });
  }

  if (btnExport) btnExport.addEventListener("click", exportCSV);

  var navItems = document.querySelectorAll("[data-route]");
  for (var i = 0; i < navItems.length; i++) {
    navItems[i].addEventListener("click", function () {
      var route = this.getAttribute("data-route") || "#/qualificacao";
      location.hash = route;
    });
  }
}

async function loadData() {
  STATE.loading = true;
  STATE.error = "";
  renderRoute();

  try {
    var result = await fetchSheetData();
    STATE.rows = result.rows.map(normalizeRow);
    STATE.headers = result.headers;
    STATE.source = result.source;
    STATE.loadedAt = new Date();
    applyFilters();
    exposeStore();
  } catch (err) {
    STATE.rows = [];
    STATE.filtered = [];
    STATE.headers = [];
    STATE.source = "";
    STATE.loadedAt = null;
    STATE.error = getErrorMessage(err);
    exposeStore();
  }

  STATE.loading = false;
  renderRoute();
}

async function fetchSheetData() {
  var attempts = [
    {
      source: "gviz-sheet",
      url:
        "https://docs.google.com/spreadsheets/d/" +
        CONFIG.SHEET_ID +
        "/gviz/tq?tqx=out:json&sheet=" +
        encodeURIComponent(CONFIG.SHEET_NAME) +
        "&headers=1&tq=" +
        encodeURIComponent("select *"),
      parser: parseGviz
    },
    {
      source: "csv-gid",
      url:
        "https://docs.google.com/spreadsheets/d/" +
        CONFIG.SHEET_ID +
        "/export?format=csv&gid=" +
        encodeURIComponent(CONFIG.GID),
      parser: parseCsvText
    }
  ];

  var errors = [];

  for (var i = 0; i < attempts.length; i++) {
    try {
      var text = await fetchText(attempts[i].url, CONFIG.TIMEOUT);
      var parsed = attempts[i].parser(text);

      if (!parsed.rows || !parsed.rows.length) {
        throw new Error("Sem linhas retornadas.");
      }

      return {
        headers: parsed.headers || [],
        rows: parsed.rows || [],
        source: attempts[i].source
      };
    } catch (e) {
      errors.push(attempts[i].source + ": " + getErrorMessage(e));
    }
  }

  throw new Error("Falha ao carregar planilha. " + errors.join(" | "));
}

async function fetchText(url, timeout) {
  var controller = new AbortController();
  var timer = setTimeout(function () {
    controller.abort();
  }, timeout);

  try {
    var response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) throw new Error("HTTP " + response.status);

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseGviz(text) {
  var start = text.indexOf("{");
  var end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Resposta GViz inválida.");
  }

  var json = JSON.parse(text.slice(start, end + 1));
  var table = json && json.table ? json.table : {};
  var cols = Array.isArray(table.cols) ? table.cols : [];
  var rows = Array.isArray(table.rows) ? table.rows : [];

  var headers = cols.map(function (col, index) {
    var label = String((col && col.label) || "").trim();
    return label || ("COL_" + (index + 1));
  });

  var out = [];

  for (var i = 0; i < rows.length; i++) {
    var line = rows[i];
    var cells = Array.isArray(line && line.c) ? line.c : [];
    var obj = {};

    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = readCell(cells[j]);
    }

    if (hasAnyValue(obj)) out.push(obj);
  }

  return { headers: headers, rows: out };
}

function readCell(cell) {
  if (!cell) return "";
  if (cell.f != null && String(cell.f).trim() !== "") return String(cell.f).trim();
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function parseCsvText(text) {
  var matrix = parseCSV(text).filter(function (row) {
    return row.some(function (cell) {
      return String(cell || "").trim() !== "";
    });
  });

  if (!matrix.length) return { headers: [], rows: [] };

  var headers = matrix[0].map(function (header, index) {
    var value = String(header || "").trim();
    return value || ("COL_" + (index + 1));
  });

  var rows = [];

  for (var i = 1; i < matrix.length; i++) {
    var line = matrix[i];
    var obj = {};

    for (var j = 0; j < headers.length; j++) {
      obj[headers[j]] = String(line[j] == null ? "" : line[j]).trim();
    }

    if (hasAnyValue(obj)) rows.push(obj);
  }

  return { headers: headers, rows: rows };
}

function parseCSV(text) {
  var rows = [];
  var row = [];
  var value = "";
  var inQuotes = false;

  for (var i = 0; i < text.length; i++) {
    var char = text[i];
    var next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      continue;
    }

    value += char;
  }

  row.push(value);
  rows.push(row);

  return rows;
}

function normalizeRow(row, index) {
  var original = {};
  var normalized = {};

  Object.keys(row).forEach(function (key) {
    var cleanKey = String(key || "").trim();
    var cleanValue = String(row[key] == null ? "" : row[key]).trim();
    original[cleanKey] = cleanValue;
    normalized[normalizeHeader(cleanKey)] = cleanValue;
  });

  normalized.__index = index;
  normalized.__original = original;
  normalized.__search = buildSearchText(normalized);
  normalized.__score = calculateScore(normalized);

  return normalized;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function buildSearchText(row) {
  var parts = [];

  Object.keys(row).forEach(function (key) {
    if (typeof row[key] === "string") parts.push(row[key]);
  });

  return parts
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function calculateScore(row) {
  var score = 0;
  var ag = toNumber(getField(row, ["TOTAL_AGENDAMENTOS"]));
  var status = (
    getField(row, ["STATUS"]) + " " + getField(row, ["STATUS_PENDENCIA"])
  ).toLowerCase();

  if (getField(row, ["VENDEDOR"])) score += 10;
  if (getField(row, ["MIDIA"])) score += 10;
  if (getField(row, ["CURSO"])) score += 10;
  if (getLeadName(row)) score += 10;
  if (getLeadPhone(row)) score += 10;

  if (ag > 0) score += Math.min(ag * 8, 30);
  if (status.indexOf("agend") >= 0) score += 10;
  if (status.indexOf("contat") >= 0) score += 8;
  if (status.indexOf("matric") >= 0) score -= 50;

  if (score < 0) score = 0;
  if (score > 100) score = 100;

  return Math.round(score);
}

function applyFilters() {
  var busca = normalizeText(STATE.filters.busca);

  STATE.filtered = STATE.rows.filter(function (row) {
    if (STATE.filters.vendedor && getField(row, ["VENDEDOR"]) !== STATE.filters.vendedor) return false;
    if (STATE.filters.midia && getField(row, ["MIDIA"]) !== STATE.filters.midia) return false;
    if (STATE.filters.curso && getField(row, ["CURSO"]) !== STATE.filters.curso) return false;

    if (STATE.filters.somenteComAgendamento) {
      if (toNumber(getField(row, ["TOTAL_AGENDAMENTOS"])) <= 0) return false;
    }

    if (STATE.filters.somenteSemMatricula) {
      var s = (
        getField(row, ["STATUS"]) + " " +
        getField(row, ["STATUS_PENDENCIA"]) + " " +
        getField(row, ["DATA_MATRICULA"])
      ).toLowerCase();

      if (s.indexOf("matric") >= 0) return false;
    }

    if (busca && row.__search.indexOf(busca) === -1) return false;

    return true;
  });

  STATE.filtered.sort(function (a, b) {
    return b.__score - a.__score;
  });
}

function renderRoute() {
  updateCrumbs();

  var view = document.getElementById("view");
  if (!view) return;

  if (STATE.route === "#/login") {
    view.innerHTML =
      '<section class="section"><h1 class="hTitle">Login</h1><div class="smallNote">Tela reservada.</div></section>';
    return;
  }

  if (STATE.route === "#/funil") {
    view.innerHTML =
      '<section class="section"><h1 class="hTitle">Funil Diário</h1><div class="smallNote">Módulo reservado.</div></section>';
    return;
  }

  view.innerHTML = renderQualificacao();
  bindQualificacaoEvents();
}

function updateCrumbs() {
  var crumbs = document.getElementById("crumbs");
  if (!crumbs) return;

  if (STATE.route === "#/login") crumbs.textContent = "Login";
  else if (STATE.route === "#/funil") crumbs.textContent = "Funil Diário";
  else crumbs.textContent = "Tratamento de Leads";
}

function renderQualificacao() {
  var meta = getMetaText();
  var opts = getOptions();
  var kpis = getKpis();
  var rows = STATE.filtered.slice(0, CONFIG.MAX_RENDER);

  var html = '';

  html += '<section class="section">';
  html += '<h1 class="hTitle">Tratamento de Leads</h1>';
  html += '<div class="smallNote">' + escapeHtml(meta) + '</div>';
  html += '</section>';

  html += '<section class="section">';
  html += '<div class="kpiGrid">';
  html += cardKpi("Base total", formatNumber(kpis.total));
  html += cardKpi("Filtrados", formatNumber(kpis.filtered));
  html += cardKpi("Alta prioridade", formatNumber(kpis.high));
  html += cardKpi("Agendados", formatNumber(kpis.scheduled));
  html += '</div>';
  html += '</section>';

  html += '<section class="section">';
  html += '<div class="aiTitle">Filtros</div>';
  html += '<div class="filtersGrid">';

  html += '<div class="field">';
  html += '<label class="label" for="fVendedor">Vendedor</label>';
  html += '<select id="fVendedor" class="select">';
  html += '<option value="">Todos</option>';
  html += buildOptions(opts.vendedores, STATE.filters.vendedor);
  html += '</select>';
  html += '</div>';

  html += '<div class="field">';
  html += '<label class="label" for="fMidia">Mídia</label>';
  html += '<select id="fMidia" class="select">';
  html += '<option value="">Todas</option>';
  html += buildOptions(opts.midias, STATE.filters.midia);
  html += '</select>';
  html += '</div>';

  html += '<div class="field">';
  html += '<label class="label" for="fCurso">Curso</label>';
  html += '<select id="fCurso" class="select">';
  html += '<option value="">Todos</option>';
  html += buildOptions(opts.cursos, STATE.filters.curso);
  html += '</select>';
  html += '</div>';

  html += '<div class="field">';
  html += '<label class="label" for="fBusca">Busca</label>';
  html += '<input id="fBusca" class="input" type="text" placeholder="Nome, telefone, status..." value="' + escapeHtml(STATE.filters.busca) + '">';
  html += '</div>';

  html += '</div>';

  html += '<div class="inlineChecks">';

  html += '<label class="chk">';
  html += '<input id="fAgendamento" type="checkbox"' + (STATE.filters.somenteComAgendamento ? ' checked' : '') + '>';
  html += '<span>Somente com agendamento</span>';
  html += '</label>';

  html += '<label class="chk">';
  html += '<input id="fSemMatricula" type="checkbox"' + (STATE.filters.somenteSemMatricula ? ' checked' : '') + '>';
  html += '<span>Somente sem matrícula</span>';
  html += '</label>';

  html += '</div>';
  html += '</section>';

  html += '<section class="section">';
  html += '<div class="aiTitle">Sugestões da IA</div>';
  html += '<div class="aiGrid">';
  html += aiCard("Melhor foco", getTopMidia(), "Mídia com maior presença no recorte atual.");
  html += aiCard("Curso destaque", getTopCurso(), "Curso mais recorrente entre os leads filtrados.");
  html += aiCard(
    "Ação sugerida",
    kpis.high > 0 ? formatNumber(kpis.high) + " quentes" : "Base morna",
    kpis.high > 0 ? "Priorizar contato imediato." : "Refinar filtros e revisar priorização."
  );
  html += '</div>';
  html += '</section>';

  html += '<section class="section">';
  html += '<div class="aiTitle">Leads priorizados</div>';
  html += '<div class="tableWrap">';
  html += '<table>';
  html += '<thead><tr>';
  html += '<th>Prioridade</th>';
  html += '<th>Score</th>';
  html += '<th>Nome</th>';
  html += '<th>Curso</th>';
  html += '<th>Mídia</th>';
  html += '<th>Vendedor</th>';
  html += '<th>Agendamentos</th>';
  html += '<th>Status</th>';
  html += '<th>Data Cadastro</th>';
  html += '<th>Telefone</th>';
  html += '</tr></thead>';
  html += '<tbody>';

  if (rows.length) {
    for (var i = 0; i < rows.length; i++) {
      html += renderTableRow(rows[i], i);
    }
  } else {
    html += '<tr><td colspan="10">Nenhum lead encontrado.</td></tr>';
  }

  html += '</tbody>';
  html += '</table>';
  html += '</div>';
  html += '</section>';

  return html;
}

function cardKpi(title, value) {
  return (
    '<div class="kpiCard">' +
      '<div class="kpiTitle">' + escapeHtml(title) + '</div>' +
      '<div class="kpiValue">' + escapeHtml(value) + '</div>' +
    '</div>'
  );
}

function aiCard(title, value, text) {
  return (
    '<div class="aiCard">' +
      '<div class="aiCardTitle">' + escapeHtml(title) + '</div>' +
      '<div class="aiCardValue">' + escapeHtml(value || "Sem destaque") + '</div>' +
      '<div class="aiCardText">' + escapeHtml(text) + '</div>' +
    '</div>'
  );
}

function buildOptions(values, selectedValue) {
  var html = '';
  for (var i = 0; i < values.length; i++) {
    var value = values[i];
    html += '<option value="' + escapeHtml(value) + '"' + (selectedValue === value ? ' selected' : '') + '>' + escapeHtml(value) + '</option>';
  }
  return html;
}

function renderTableRow(row, index) {
  var html = '';
  html += '<tr>';
  html += '<td><span class="badge">' + (index + 1) + '</span></td>';
  html += '<td>' + row.__score + '</td>';
  html += '<td>' + escapeHtml(getLeadName(row)) + '</td>';
  html += '<td>' + escapeHtml(getField(row, ["CURSO"])) + '</td>';
  html += '<td>' + escapeHtml(getField(row, ["MIDIA"])) + '</td>';
  html += '<td>' + escapeHtml(getField(row, ["VENDEDOR"])) + '</td>';
  html += '<td>' + escapeHtml(getField(row, ["TOTAL_AGENDAMENTOS"])) + '</td>';
  html += '<td>' + escapeHtml(getField(row, ["STATUS", "STATUS_PENDENCIA"])) + '</td>';
  html += '<td>' + escapeHtml(getField(row, ["DATA_CADASTRO"])) + '</td>';
  html += '<td>' + escapeHtml(getLeadPhone(row)) + '</td>';
  html += '</tr>';
  return html;
}

function bindQualificacaoEvents() {
  var fVendedor = document.getElementById("fVendedor");
  var fMidia = document.getElementById("fMidia");
  var fCurso = document.getElementById("fCurso");
  var fBusca = document.getElementById("fBusca");
  var fAgendamento = document.getElementById("fAgendamento");
  var fSemMatricula = document.getElementById("fSemMatricula");

  if (fVendedor) {
    fVendedor.addEventListener("change", function () {
      STATE.filters.vendedor = this.value;
      applyFilters();
      renderRoute();
    });
  }

  if (fMidia) {
    fMidia.addEventListener("change", function () {
      STATE.filters.midia = this.value;
      applyFilters();
      renderRoute();
    });
  }

  if (fCurso) {
    fCurso.addEventListener("change", function () {
      STATE.filters.curso = this.value;
      applyFilters();
      renderRoute();
    });
  }

  if (fBusca) {
    fBusca.addEventListener("input", debounce(function () {
      STATE.filters.busca = fBusca.value || "";
      applyFilters();
      renderRoute();
    }, 180));
  }

  if (fAgendamento) {
    fAgendamento.addEventListener("change", function () {
      STATE.filters.somenteComAgendamento = this.checked;
      applyFilters();
      renderRoute();
    });
  }

  if (fSemMatricula) {
    fSemMatricula.addEventListener("change", function () {
      STATE.filters.somenteSemMatricula = this.checked;
      applyFilters();
      renderRoute();
    });
  }
}

function getOptions() {
  return {
    vendedores: uniqueSorted(STATE.rows.map(function (r) { return getField(r, ["VENDEDOR"]); })),
    midias: uniqueSorted(STATE.rows.map(function (r) { return getField(r, ["MIDIA"]); })),
    cursos: uniqueSorted(STATE.rows.map(function (r) { return getField(r, ["CURSO"]); }))
  };
}

function getKpis() {
  return {
    total: STATE.rows.length,
    filtered: STATE.filtered.length,
    high: STATE.filtered.filter(function (r) { return r.__score >= 70; }).length,
    scheduled: STATE.filtered.filter(function (r) { return toNumber(getField(r, ["TOTAL_AGENDAMENTOS"])) > 0; }).length
  };
}

function getMetaText() {
  if (STATE.loading) return "Carregando base...";
  if (STATE.error) return "Erro: " + STATE.error;
  if (!STATE.loadedAt) return "Base não carregada.";

  return (
    "Base: " + formatNumber(STATE.rows.length) +
    " leads • filtrados: " + formatNumber(STATE.filtered.length) +
    " • origem: " + STATE.source +
    " • atualizado: " + formatDateTime(STATE.loadedAt)
  );
}

function getTopMidia() {
  return getTopValue(STATE.filtered, ["MIDIA"]) || "Sem destaque";
}

function getTopCurso() {
  return getTopValue(STATE.filtered, ["CURSO"]) || "Sem destaque";
}

function getTopValue(rows, keys) {
  var map = {};
  var sample = rows.slice(0, 500);

  for (var i = 0; i < sample.length; i++) {
    var key = getField(sample[i], keys) || "Sem valor";
    map[key] = (map[key] || 0) + 1;
  }

  var best = "";
  var bestCount = 0;

  Object.keys(map).forEach(function (key) {
    if (map[key] > bestCount) {
      best = key;
      bestCount = map[key];
    }
  });

  return best;
}

function exportCSV() {
  if (!STATE.filtered.length) return;

  var headers = [
    "PRIORIDADE",
    "SCORE",
    "NOME",
    "CURSO",
    "MIDIA",
    "VENDEDOR",
    "TOTAL_AGENDAMENTOS",
    "STATUS",
    "DATA_CADASTRO",
    "FONE"
  ];

  var lines = STATE.filtered.map(function (row, index) {
    return [
      index + 1,
      row.__score,
      getLeadName(row),
      getField(row, ["CURSO"]),
      getField(row, ["MIDIA"]),
      getField(row, ["VENDEDOR"]),
      getField(row, ["TOTAL_AGENDAMENTOS"]),
      getField(row, ["STATUS", "STATUS_PENDENCIA"]),
      getField(row, ["DATA_CADASTRO"]),
      getLeadPhone(row)
    ];
  });

  var csv = [headers].concat(lines).map(function (line) {
    return line.map(csvEscape).join(",");
  }).join("\n");

  var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "leads_priorizados.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exposeStore() {
  window.ARIA_STORE = {
    getRows: function () { return STATE.rows.slice(); },
    getFiltered: function () { return STATE.filtered.slice(); },
    getMeta: function () {
      return {
        total: STATE.rows.length,
        filtered: STATE.filtered.length,
        loading: STATE.loading,
        error: STATE.error,
        source: STATE.source,
        loadedAt: STATE.loadedAt
      };
    },
    reload: loadData
  };
}

function getField(row, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = normalizeHeader(keys[i]);
    if (row[key] != null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

function getLeadName(row) {
  return getField(row, ["NOME", "LEAD", "CLIENTE", "ALUNO"]);
}

function getLeadPhone(row) {
  return getField(row, ["FONE", "FONE1", "FONE2", "FONE3", "CELULAR", "TELEFONE"]);
}

function uniqueSorted(values) {
  return Array.from(new Set(values.filter(Boolean))).sort(function (a, b) {
    return a.localeCompare(b, "pt-BR");
  });
}

function hasAnyValue(obj) {
  return Object.keys(obj).some(function (key) {
    return String(obj[key] == null ? "" : obj[key]).trim() !== "";
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toNumber(value) {
  var clean = String(value || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  var n = Number(clean);
  return isNaN(n) ? 0 : n;
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Number(value || 0));
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function csvEscape(value) {
  return '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
}

function getErrorMessage(err) {
  if (!err) return "Erro desconhecido.";
  if (err.name === "AbortError") return "Tempo limite excedido.";
  return String(err.message || err);
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function debounce(fn, wait) {
  var timer = null;
  return function () {
    clearTimeout(timer);
    var args = arguments;
    timer = setTimeout(function () {
      fn.apply(null, args);
    }, wait);
  };
}
