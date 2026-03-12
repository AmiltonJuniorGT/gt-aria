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
  if (btnGerar) btnGerar.addEventListener("click", function () {
    applyFilters();
    renderRoute();
  });
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

    if (!response.ok) {
      throw new Error("HTTP " + response.status);
    }

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
  return Object.keys(row)
    .map(function (key) {
      return typeof row[key] === "string" ? row[key] : "";
    })
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function calculateScore(row) {
  var score = 0;
  var ag = toNumber(getField(row, ["TOTAL_AGENDAMENTOS"]));
  var status = (
    getField(row, ["STATUS"]) +
    " " +
    getField(row, ["STATUS_PENDENCIA"])
  ).toLowerCase();

  if (getField(row, ["VENDEDOR"])) score += 10;
  if (getField(row, ["MIDIA", "MIDIA_"])) score += 10;
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
    if (STATE.filters.midia && getField(row, ["MIDIA", "MIDIA_"]) !== STATE.filters.midia) return false;
    if (STATE.filters.curso && getField(row, ["CURSO"]) !== STATE.filters.curso) return false;

    if (STATE.filters.somenteComAgendamento) {
      if (toNumber(getField(row, ["TOTAL_AGENDAMENTOS"])) <= 0) return false;
    }

    if (STATE.filters.somenteSemMatricula) {
      var s = (
        getField(row, ["STATUS"]) +
        " " +
        getField(row, ["STATUS_PENDENCIA"]) +
        " " +
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
    view.innerHTML = '<section class="section"><h1 class="hTitle">Login</h1><div class="smallNote">Tela reservada.</div></section>';
    return;
  }

  if (STATE.route === "#/funil") {
    view.innerHTML = '<section class="section"><h1 class="hTitle">Funil Diário</h1><div class="smallNote">Módulo reservado.</div></section>';
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

  return `
    <section class="section">
      <h1 class="hTitle">Tratamento de Leads</h1>
      <div class="smallNote">${escapeHtml(meta)}</div>
    </section>

    <section class="section">
      <div class="kpiGrid">
        <div class="kpiCard">
          <div class="kpiTitle">Base total</div>
          <div class="kpiValue">${formatNumber(kpis.total)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Filtrados</div>
          <div class="kpiValue">${formatNumber(kpis.filtered)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Alta prioridade</div>
          <div class="kpiValue">${formatNumber(kpis.high)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Agendados</div>
          <div class="kpiValue">${formatNumber(kpis.scheduled)}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="aiTitle">Filtros</div>

      <div class="filtersGrid">
        <div class="field">
          <label class="label" for="fVendedor">Vendedor</label>
          <select id="fVendedor" class="select">
            <option value="">Todos</option>
            ${opts.vendedores.map(function (v) {
              return '<option value="' + escapeHtml(v) + '"' + (STATE.filters.vendedor === v ? " selected" : "") + '>' + escapeHtml(v) + '</option>';
            }).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label" for="fMidia">Mídia</label>
          <select id="fMidia" class="select">
            <option value="">Todas</option>
            ${opts.midias.map(function (v) {
              return '<option value="' + escapeHtml(v) + '"' + (STATE.filters.midia === v ? " selected" : "") + '>' + escapeHtml(v) + '</option>';
            }).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label" for="fCurso">Curso</label>
          <select id="fCurso" class="select">
            <option value="">Todos</option>
            ${opts.cursos.map(function (v) {
              return '<option value="' + escapeHtml(v) + '"' + (STATE.filters.curso === v ? " selected" : "") + '>' + escapeHtml(v) + '</option>';
            }).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label" for="fBusca">Busca</label>
          <input id="fBusca" class="input" type="text" placeholder="Nome, telefone, status..." value="${escapeHtml(STATE.filters.busca)}">
        </div>
      </div>

      <div class="inlineChecks">
        <label class="chk">
          <input id="fAgendamento" type="checkbox" ${STATE.filters.somenteComAgendamento ? "checked" : ""}>
          <span>Somente com agendamento</span>
        </label>

        <label class="chk">
          <input id="fSemMatricula" type="checkbox" ${STATE.filters.somenteSemMatricula ? "checked" : ""}>
          <span>Somente sem matrícula</span>
        </label>
      </div>
    </section>

    <section class="section">
      <div class="aiTitle">Sugestões da IA</div>
      <div class="aiGrid">
        <div class="aiCard">
          <div class="aiCardTitle">Melhor foco</div>
          <div class="aiCardValue">${escapeHtml(getTopMidia())}</div>
          <div class="aiCardText">Mídia com maior presença no recorte atual.</div>
        </div>
        <div class="aiCard">
          <div class="aiCardTitle">Curso destaque</div>
          <div class="aiCardValue">${escapeHtml(getTopCurso())}</div>
          <div class="aiCardText">Curso mais recorrente entre os leads filtrados.</div>
        </div>
        <div class="aiCard">
          <div class="aiCardTitle">Ação sugerida</div>
          <div class="aiCardValue">${kpis.high > 0 ? formatNumber(kpis.high) + " quentes" : "Base morna"}</div>
          <div class="aiCardText">${kpis.high > 0 ? "Priorizar contato imediato." : "Refinar filtros e revisar priorização."}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="aiTitle">Leads priorizados</div>
      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Prioridade</th>
              <th>Score</th>
              <th>Nome</th>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Vendedor</th>
              <th>Agendamentos</th>
              <th>Status</th>
              <th>Data Cadastro</th>
              <th>Telefone</th>
            </tr>
          </thead>
          <tbody>
            ${
              rows.length
                ? rows.map(function (row, index) {
                    return `
                      <tr>
                        <td><span class="badge">${index + 1}</span></td>
                        <td>${row.__score}</td>
                        <td>${escapeHtml(getLeadName(row))}</td>
                        <td>${escapeHtml(getField(row, ["CURSO"]))}</td>
                        <td>${escapeHtml(getField(row, ["MIDIA", "MIDIA_"]))}</td>
                        <td>${escapeHtml(getField(row, ["VENDEDOR"]))}</td>
                        <td>${escapeHtml(getField(row, ["TOTAL_AGENDAMENTOS"]))}</td>
                        <td>${escapeHtml(getField(row, ["STATUS", "STATUS_PENDENCIA"]))}</td>
                        <td>${escapeHtml(getField(row, ["DATA_CADASTRO"]))}</td>
                        <td>${escapeHtml(getLeadPhone(row))}</td>
                      </tr>
                    `;
                  }).join("")
                : '<tr><td colspan="10">Nenhum lead encontrado.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    </section>
  `;
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
    midias: uniqueSorted(STATE.rows.map(function (r) { return getField(r, ["MIDIA", "MIDIA_"]); })),
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
  return "Base: " + formatNumber(STATE.rows.length) + " leads • filtrados: " + formatNumber(STATE.filtered.length) + " • origem: " + STATE.source + " • atualizado: " + formatDateTime(STATE.loadedAt);
}

function getTopMidia() {
  return getTopValue(STATE.filtered, ["MIDIA", "MIDIA_"]) || "Sem destaque";
}

function getTopCurso() {
  return getTopValue(STATE.filtered, ["CURSO"]) || "Sem destaque";
}

function getTopValue(rows, keys) {
  var map = {};

  rows.slice(0, 500).forEach(function (row) {
    var key = getField(row, keys) || "Sem valor";
    map[key] = (map[key] || 0) + 1;
  });

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
      getField(row, ["MIDIA", "MIDIA_"]),
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
    var args = arguments;
    clearTimeout(timer);
    timer = setTimeout(function () {
      fn.apply(null, args);
    }, wait);
  };
}    draggedIndex: null
  }
};

/* =========================
   BOOT
   ========================= */
document.addEventListener("DOMContentLoaded", async () => {
  bindGlobalEvents();
  setRoute(ARIA.route || ARIA_CONFIG.defaultRoute);
  await bootData();
  renderCurrentRoute();
});

function bindGlobalEvents() {
  window.addEventListener("hashchange", () => {
    setRoute(location.hash || ARIA_CONFIG.defaultRoute);
    renderCurrentRoute();
  });

  const btnReloadTop = document.getElementById("btnRecarregarTop");
  const btnGerarTop = document.getElementById("btnGerarTop");
  const btnExportTop = document.getElementById("btnExportTop");

  if (btnReloadTop) btnReloadTop.addEventListener("click", bootData);
  if (btnGerarTop) btnGerarTop.addEventListener("click", handleGerarLista);
  if (btnExportTop) btnExportTop.addEventListener("click", exportCurrentCSV);

  document.querySelectorAll("[data-route]").forEach((item) => {
    item.addEventListener("click", () => {
      const route = item.getAttribute("data-route") || ARIA_CONFIG.defaultRoute;
      location.hash = route;
    });
  });
}

/* =========================
   DATA
   ========================= */
async function bootData() {
  setLoading(true);
  setError("");

  try {
    const result = await fetchSheetRows({
      sheetId: ARIA_CONFIG.sheetId,
      sheetName: ARIA_CONFIG.sheetName,
      fallbackGid: ARIA_CONFIG.fallbackGid,
      timeoutMs: ARIA_CONFIG.timeoutMs
    });

    ARIA.rows = result.rows.map(normalizeLeadRow);
    ARIA.headers = result.headers;
    ARIA.loadedAt = new Date();
    ARIA.source = result.source;

    applyFiltersAndRank();
    exposeStore();
    renderCurrentRoute();
  } catch (error) {
    ARIA.rows = [];
    ARIA.filteredRows = [];
    ARIA.rankedRows = [];
    ARIA.headers = [];
    ARIA.loadedAt = null;
    ARIA.source = "";
    setError(getErrorMessage(error));
    exposeStore();
    renderCurrentRoute();
  } finally {
    setLoading(false);
  }
}

async function fetchSheetRows({ sheetId, sheetName, fallbackGid, timeoutMs }) {
  const attempts = [
    {
      source: "gviz-sheet",
      url:
        `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
        `?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&headers=1&tq=${encodeURIComponent("select *")}`,
      parser: parseGvizResponse
    },
    {
      source: "csv-gid",
      url:
        `https://docs.google.com/spreadsheets/d/${sheetId}/export` +
        `?format=csv&gid=${encodeURIComponent(fallbackGid)}`,
      parser: parseCsvResponse
    }
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      const text = await fetchText(attempt.url, timeoutMs);
      const parsed = attempt.parser(text);

      if (!parsed.rows.length) {
        throw new Error(`Fonte ${attempt.source} retornou 0 linhas.`);
      }

      return {
        headers: parsed.headers,
        rows: parsed.rows,
        source: attempt.source
      };
    } catch (error) {
      errors.push(`${attempt.source}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(`Falha ao carregar a planilha. ${errors.join(" | ")}`);
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseGvizResponse(text) {
  const jsonText = extractGvizJson(text);
  const payload = JSON.parse(jsonText);

  const table = payload?.table;
  const cols = Array.isArray(table?.cols) ? table.cols : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];

  const headers = cols.map((col, index) => {
    const label = String(col?.label || "").trim();
    return label || `COL_${index + 1}`;
  });

  const parsedRows = rows
    .map((row) => {
      const cells = Array.isArray(row?.c) ? row.c : [];
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = readGvizCell(cells[index]);
      });

      return obj;
    })
    .filter(hasAnyValue);

  return { headers, rows: parsedRows };
}

function extractGvizJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Resposta GViz inválida.");
  }

  return text.slice(start, end + 1);
}

function readGvizCell(cell) {
  if (!cell) return "";
  if (cell.f != null && String(cell.f).trim() !== "") return String(cell.f).trim();
  if (cell.v == null) return "";
  return String(cell.v).trim();
}

function parseCsvResponse(text) {
  const matrix = parseCSV(text).filter((row) => row.some((cell) => String(cell || "").trim() !== ""));

  if (!matrix.length) return { headers: [], rows: [] };

  const headers = matrix[0].map((header, index) => {
    const value = String(header || "").trim();
    return value || `COL_${index + 1}`;
  });

  const rows = matrix
    .slice(1)
    .map((line) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = String(line[index] ?? "").trim();
      });
      return obj;
    })
    .filter(hasAnyValue);

  return { headers, rows };
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
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
      if (char === "\r" && next === "\n") i += 1;
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

function normalizeLeadRow(row, index) {
  const original = {};
  const normalized = {};

  Object.keys(row).forEach((key) => {
    const cleanKey = String(key || "").trim();
    const cleanValue = String(row[key] ?? "").trim();
    original[cleanKey] = cleanValue;
    normalized[normalizeHeader(cleanKey)] = cleanValue;
  });

  const lead = {
    __index: index,
    __original: original,
    ...normalized
  };

  lead.__search = buildSearchIndex(lead);
  lead.__score = 0;
  lead.__scoreLabel = "Média";

  return lead;
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function buildSearchIndex(lead) {
  return Object.values(lead)
    .filter((v) => typeof v === "string")
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function hasAnyValue(obj) {
  return Object.values(obj).some((value) => String(value ?? "").trim() !== "");
}

/* =========================
   ROUTER / RENDER
   ========================= */
function setRoute(route) {
  ARIA.route = route || ARIA_CONFIG.defaultRoute;

  document.querySelectorAll(".navItem").forEach((item) => {
    item.classList.toggle("active", item.getAttribute("data-route") === ARIA.route);
  });

  const crumbs = document.getElementById("crumbs");
  if (!crumbs) return;

  if (ARIA.route === "#/login") crumbs.textContent = "Login";
  else if (ARIA.route === "#/funil") crumbs.textContent = "Funil Diário";
  else crumbs.textContent = "Tratamento de Leads";
}

function renderCurrentRoute() {
  const view = document.getElementById("view");
  if (!view) return;

  if (ARIA.route === "#/login") {
    view.innerHTML = renderLoginView();
    return;
  }

  if (ARIA.route === "#/funil") {
    view.innerHTML = renderFunilView();
    return;
  }

  view.innerHTML = renderQualificacaoView();
  bindQualificacaoEvents();
}

function renderLoginView() {
  return `
    <section class="section">
      <h1 class="hTitle">Login</h1>
      <div class="smallNote">Tela reservada para autenticação futura.</div>
    </section>
  `;
}

function renderFunilView() {
  return `
    <section class="section">
      <h1 class="hTitle">Funil Diário</h1>
      <div class="smallNote">Módulo reservado para evolução futura.</div>
    </section>
  `;
}

function renderQualificacaoView() {
  const meta = getMetaText();
  const kpis = getKpis();
  const options = getFilterOptions();
  const ai = getAiInsights();
  const rows = ARIA.rankedRows.slice(0, ARIA_CONFIG.maxRowsRender);

  return `
    <section class="section">
      <div class="hTitleRow">
        <div>
          <h1 class="hTitle">Tratamento de Leads</h1>
          <div class="hMeta">${meta}</div>
        </div>
      </div>

      <div class="kpiGrid">
        <div class="kpiCard">
          <div class="kpiTitle">Base total</div>
          <div class="kpiValue">${formatNumber(kpis.baseTotal)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Filtrados</div>
          <div class="kpiValue">${formatNumber(kpis.filtrados)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Alta prioridade</div>
          <div class="kpiValue">${formatNumber(kpis.alta)}</div>
        </div>
        <div class="kpiCard">
          <div class="kpiTitle">Agendados</div>
          <div class="kpiValue">${formatNumber(kpis.agendados)}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="aiTitle">Filtros</div>

      <div class="filtersGrid">
        <div class="field">
          <label class="label" for="fVendedor">Vendedor</label>
          <select id="fVendedor" class="select">
            <option value="">Todos</option>
            ${options.vendedores.map((v) => `<option value="${escapeHtml(v)}" ${ARIA.filters.vendedor === v ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label" for="fMidia">Mídia</label>
          <select id="fMidia" class="select">
            <option value="">Todas</option>
            ${options.midias.map((v) => `<option value="${escapeHtml(v)}" ${ARIA.filters.midia === v ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label" for="fCurso">Curso</label>
          <select id="fCurso" class="select">
            <option value="">Todos</option>
            ${options.cursos.map((v) => `<option value="${escapeHtml(v)}" ${ARIA.filters.curso === v ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label class="label" for="fBusca">Busca</label>
          <input id="fBusca" class="input" type="text" placeholder="Nome, telefone, status..." value="${escapeHtml(ARIA.filters.busca)}" />
        </div>
      </div>

      <div class="inlineChecks">
        <label class="chk">
          <input id="fAgendamento" type="checkbox" ${ARIA.filters.somenteComAgendamento ? "checked" : ""} />
          <span>Somente com agendamento</span>
        </label>

        <label class="chk">
          <input id="fSemMatricula" type="checkbox" ${ARIA.filters.somenteSemMatricula ? "checked" : ""} />
          <span>Somente sem matrícula</span>
        </label>
      </div>
    </section>

    <section class="section">
      <div class="aiTitle">Sugestões da IA</div>
      <div class="aiGrid">
        <div class="aiCard">
          <div class="aiCardTitle">Melhor foco</div>
          <div class="aiCardValue">${escapeHtml(ai.topFocusTitle)}</div>
          <div class="aiCardText">${escapeHtml(ai.topFocusText)}</div>
        </div>
        <div class="aiCard">
          <div class="aiCardTitle">Vendedor destaque</div>
          <div class="aiCardValue">${escapeHtml(ai.topSellerTitle)}</div>
          <div class="aiCardText">${escapeHtml(ai.topSellerText)}</div>
        </div>
        <div class="aiCard">
          <div class="aiCardTitle">Ação sugerida</div>
          <div class="aiCardValue">${escapeHtml(ai.actionTitle)}</div>
          <div class="aiCardText">${escapeHtml(ai.actionText)}</div>
        </div>
      </div>
      <div class="aiNote">As sugestões usam a base carregada e a ordem de prioridade abaixo.</div>
    </section>

    <section class="section">
      <div class="aiTitle">Ordem de prioridade</div>
      <div class="dragWrap" id="dragWrap">
        ${ARIA.priority.map((item, index) => `
          <div class="dragItem" draggable="true" data-index="${index}">
            ${index + 1}. ${labelPriority(item)}
          </div>
        `).join("")}
      </div>
    </section>

    <section class="section">
      <div class="aiTitle">Leads priorizados</div>
      <div class="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Prioridade</th>
              <th>Score</th>
              <th>Nome</th>
              <th>Curso</th>
              <th>Mídia</th>
              <th>Vendedor</th>
              <th>Agendamentos</th>
              <th>Status</th>
              <th>Data Cadastro</th>
              <th>Telefone</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map(renderTableRow).join("") : `
              <tr>
                <td colspan="10">Nenhum lead encontrado.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTableRow(row, index) {
  return `
    <tr>
      <td><span class="badge">${index + 1}</span></td>
      <td>${row.__score} • ${row.__scoreLabel}</td>
      <td>${escapeHtml(getLeadName(row))}</td>
      <td>${escapeHtml(getField(row, ["CURSO"]))}</td>
      <td>${escapeHtml(getField(row, ["MIDIA", "MÍDIA"]))}</td>
      <td>${escapeHtml(getField(row, ["VENDEDOR"]))}</td>
      <td>${escapeHtml(getField(row, ["TOTAL_AGENDAMENTOS"]))}</td>
      <td>${escapeHtml(getField(row, ["STATUS", "STATUS_PENDENCIA"]))}</td>
      <td>${escapeHtml(getField(row, ["DATA_CADASTRO"]))}</td>
      <td>${escapeHtml(getLeadPhone(row))}</td>
    </tr>
  `;
}

/* =========================
   VIEW EVENTS
   ========================= */
function bindQualificacaoEvents() {
  const fVendedor = document.getElementById("fVendedor");
  const fMidia = document.getElementById("fMidia");
  const fCurso = document.getElementById("fCurso");
  const fBusca = document.getElementById("fBusca");
  const fAgendamento = document.getElementById("fAgendamento");
  const fSemMatricula = document.getElementById("fSemMatricula");

  if (fVendedor) {
    fVendedor.addEventListener("change", (e) => {
      ARIA.filters.vendedor = e.target.value;
      applyFiltersAndRank();
      renderCurrentRoute();
    });
  }

  if (fMidia) {
    fMidia.addEventListener("change", (e) => {
      ARIA.filters.midia = e.target.value;
      applyFiltersAndRank();
      renderCurrentRoute();
    });
  }

  if (fCurso) {
    fCurso.addEventListener("change", (e) => {
      ARIA.filters.curso = e.target.value;
      applyFiltersAndRank();
      renderCurrentRoute();
    });
  }

  if (fBusca) {
    fBusca.addEventListener("input", debounce((e) => {
      ARIA.filters.busca = e.target.value || "";
      applyFiltersAndRank();
      renderCurrentRoute();
    }, 180));
  }

  if (fAgendamento) {
    fAgendamento.addEventListener("change", (e) => {
      ARIA.filters.somenteComAgendamento = e.target.checked;
      applyFiltersAndRank();
      renderCurrentRoute();
    });
  }

  if (fSemMatricula) {
    fSemMatricula.addEventListener("change", (e) => {
      ARIA.filters.somenteSemMatricula = e.target.checked;
      applyFiltersAndRank();
      renderCurrentRoute();
    });
  }

  bindDragPriority();
}

function bindDragPriority() {
  const items = Array.from(document.querySelectorAll(".dragItem"));
  if (!items.length) return;

  items.forEach((item) => {
    item.addEventListener("dragstart", () => {
      ARIA.ui.draggedIndex = Number(item.dataset.index);
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      ARIA.ui.draggedIndex = null;
      item.classList.remove("dragging");
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();

      const from = ARIA.ui.draggedIndex;
      const to = Number(item.dataset.index);

      if (Number.isNaN(from) || Number.isNaN(to) || from === to) return;

      const updated = [...ARIA.priority];
      const [moved] = updated.splice(from, 1);
      updated.splice(to, 0, moved);

      ARIA.priority = updated;
      applyFiltersAndRank();
      renderCurrentRoute();
    });
  });
}

/* =========================
   FILTER / RANK
   ========================= */
function handleGerarLista() {
  applyFiltersAndRank();
  renderCurrentRoute();
}

function applyFiltersAndRank() {
  const busca = normalizeSearch(ARIA.filters.busca);

  ARIA.filteredRows = ARIA.rows.filter((row) => {
    if (ARIA.filters.vendedor && getField(row, ["VENDEDOR"]) !== ARIA.filters.vendedor) return false;
    if (ARIA.filters.midia && getField(row, ["MIDIA", "MÍDIA"]) !== ARIA.filters.midia) return false;
    if (ARIA.filters.curso && getField(row, ["CURSO"]) !== ARIA.filters.curso) return false;

    if (ARIA.filters.somenteComAgendamento) {
      const ag = toNumber(getField(row, ["TOTAL_AGENDAMENTOS"]));
      if (ag <= 0) return false;
    }

    if (ARIA.filters.somenteSemMatricula) {
      const statusMat = `${getField(row, ["STATUS"])} ${getField(row, ["STATUS_PENDENCIA"])} ${getField(row, ["DATA_MATRICULA"])}`.toLowerCase();
      if (statusMat.includes("matric")) return false;
    }

    if (busca && !row.__search.includes(busca)) return false;

    return true;
  });

  ARIA.rankedRows = ARIA.filteredRows
    .map((row) => {
      const score = calculateLeadScore(row, ARIA.priority);
      return {
        ...row,
        __score: score,
        __scoreLabel: score >= 80 ? "Alta" : score >= 50 ? "Média" : "Baixa"
      };
    })
    .sort((a, b) => b.__score - a.__score);
}

function calculateLeadScore(row, priority) {
  const weightMap = {};
  priority.forEach((key, index) => {
    weightMap[key] = (priority.length - index) * 10;
  });

  let score = 0;

  const vendedor = getField(row, ["VENDEDOR"]);
  const midia = getField(row, ["MIDIA", "MÍDIA"]);
  const curso = getField(row, ["CURSO"]);
  const ag = toNumber(getField(row, ["TOTAL_AGENDAMENTOS"]));
  const status = `${getField(row, ["STATUS"])} ${getField(row, ["STATUS_PENDENCIA"])}`.toLowerCase();

  if (vendedor) score += weightMap.VENDEDOR || 0;
  if (midia) score += weightMap.MIDIA || 0;
  if (curso) score += weightMap.CURSO || 0;

  if (ag > 0) score += (weightMap.TOTAL_AGENDAMENTOS || 0) + Math.min(ag * 4, 20);

  if (status.includes("contat")) score += 12;
  if (status.includes("agend")) score += 16;
  if (status.includes("pend")) score += 8;
  if (status.includes("matric")) score -= 60;

  if (getLeadPhone(row)) score += 6;
  if (getLeadName(row)) score += 6;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/* =========================
   EXPORT
   ========================= */
function exportCurrentCSV() {
  const rows = ARIA.rankedRows;
  if (!rows.length) return;

  const headers = [
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

  const lines = rows.map((row, index) => [
    index + 1,
    row.__score,
    getLeadName(row),
    getField(row, ["CURSO"]),
    getField(row, ["MIDIA", "MÍDIA"]),
    getField(row, ["VENDEDOR"]),
    getField(row, ["TOTAL_AGENDAMENTOS"]),
    getField(row, ["STATUS", "STATUS_PENDENCIA"]),
    getField(row, ["DATA_CADASTRO"]),
    getLeadPhone(row)
  ]);

  const csv = [headers, ...lines]
    .map((line) => line.map(csvEscape).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads_priorizados.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

/* =========================
   INSIGHTS
   ========================= */
function getAiInsights() {
  const rows = ARIA.rankedRows.slice(0, 200);

  const byMidia = groupCount(rows, (row) => getField(row, ["MIDIA", "MÍDIA"]) || "Sem mídia");
  const bySeller = groupCount(rows, (row) => getField(row, ["VENDEDOR"]) || "Sem vendedor");
  const byCourse = groupCount(rows, (row) => getField(row, ["CURSO"]) || "Sem curso");

  const topMidia = getTopEntry(byMidia);
  const topSeller = getTopEntry(bySeller);
  const topCourse = getTopEntry(byCourse);

  const alta = rows.filter((row) => row.__score >= 80).length;
  const agendados = rows.filter((row) => toNumber(getField(row, ["TOTAL_AGENDAMENTOS"])) > 0).length;

  return {
    topFocusTitle: topMidia.key || "Sem destaque",
    topFocusText: topMidia.value
      ? `Maior concentração entre os leads filtrados. Curso líder: ${topCourse.key || "—"}.`
      : "Sem dados suficientes para sugerir foco.",

    topSellerTitle: topSeller.key || "Sem destaque",
    topSellerText: topSeller.value
      ? `${formatNumber(topSeller.value)} leads no recorte atual.`
      : "Sem dados suficientes para vendedor destaque.",

    actionTitle: alta > 0 ? `${formatNumber(alta)} leads quentes` : "Base morna",
    actionText: alta > 0
      ? `Priorize contatos imediatos. Há ${formatNumber(agendados)} leads com agendamento no recorte.`
      : "Refine filtros ou ajuste a ordem de prioridade."
  };
}

/* =========================
   HELPERS
   ========================= */
function getMetaText() {
  if (ARIA.loading) return "Carregando base...";
  if (ARIA.error) return `Erro: ${ARIA.error}`;
  if (!ARIA.loadedAt) return "Base não carregada.";

  return `Base: ${formatNumber(ARIA.rows.length)} leads • filtrados: ${formatNumber(ARIA.rankedRows.length)} • origem: ${ARIA.source} • atualizado: ${formatDateTime(ARIA.loadedAt)}`;
}

function getKpis() {
  return {
    baseTotal: ARIA.rows.length,
    filtrados: ARIA.rankedRows.length,
    alta: ARIA.rankedRows.filter((r) => r.__score >= 80).length,
    agendados: ARIA.rankedRows.filter((r) => toNumber(getField(r, ["TOTAL_AGENDAMENTOS"])) > 0).length
  };
}

function getFilterOptions() {
  return {
    vendedores: uniqueSorted(ARIA.rows.map((r) => getField(r, ["VENDEDOR"]))),
    midias: uniqueSorted(ARIA.rows.map((r) => getField(r, ["MIDIA", "MÍDIA"]))),
    cursos: uniqueSorted(ARIA.rows.map((r) => getField(r, ["CURSO"])))
  };
}

function groupCount(rows, fn) {
  const map = new Map();
  rows.forEach((row) => {
    const key = fn(row);
    map.set(key, (map.get(key) || 0) + 1);
  });
  return map;
}

function getTopEntry(map) {
  let bestKey = "";
  let bestValue = 0;

  map.forEach((value, key) => {
    if (value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  });

  return { key: bestKey, value: bestValue };
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function getField(row, possibleKeys) {
  for (const key of possibleKeys) {
    const normalized = normalizeHeader(key);
    if (row[normalized] != null && String(row[normalized]).trim() !== "") {
      return String(row[normalized]).trim();
    }
  }
  return "";
}

function getLeadName(row) {
  return getField(row, ["NOME", "LEAD", "CLIENTE", "ALUNO"]);
}

function getLeadPhone(row) {
  return getField(row, ["FONE", "FONE1", "FONE2", "CELULAR", "TELEFONE"]);
}

function labelPriority(value) {
  const map = {
    VENDEDOR: "Vendedor",
    MIDIA: "Mídia",
    CURSO: "Curso",
    TOTAL_AGENDAMENTOS: "Total de Agendamentos"
  };
  return map[value] || value;
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

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function toNumber(value) {
  const clean = String(value || "")
    .replace(/\./g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");
  const num = Number(clean);
  return Number.isFinite(num) ? num : 0;
}

function setLoading(value) {
  ARIA.loading = Boolean(value);
}

function setError(message) {
  ARIA.error = String(message || "");
}

function getErrorMessage(error) {
  if (!error) return "Erro desconhecido.";
  if (error.name === "AbortError") return "Tempo limite excedido ao buscar a planilha.";
  return String(error.message || error);
}

function exposeStore() {
  window.ARIA_STORE = {
    config: { ...ARIA_CONFIG },
    state: {
      loading: ARIA.loading,
      error: ARIA.error,
      headers: [...ARIA.headers],
      rows: [...ARIA.rows],
      filteredRows: [...ARIA.filteredRows],
      rankedRows: [...ARIA.rankedRows],
      loadedAt: ARIA.loadedAt,
      source: ARIA.source,
      total: ARIA.rows.length
    },
    reload: bootData,
    render: renderCurrentRoute,
    getRows: () => [...ARIA.rows],
    getRankedRows: () => [...ARIA.rankedRows],
    getHeaders: () => [...ARIA.headers],
    getMeta: () => ({
      loading: ARIA.loading,
      error: ARIA.error,
      loadedAt: ARIA.loadedAt,
      source: ARIA.source,
      total: ARIA.rows.length
    })
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}    if (el) {
      el.addEventListener("click", async (event) => {
        event.preventDefault();
        await bootSheet();
      });
    }
  });
}

async function bootSheet() {
  setLoading(true);
  setError("");

  try {
    const result = await fetchSheetRows({
      sheetId: ARIA_CONFIG.sheetId,
      sheetName: ARIA_CONFIG.sheetName,
      fallbackGid: ARIA_CONFIG.fallbackGid,
      timeoutMs: ARIA_CONFIG.timeoutMs,
    });

    ARIA_STATE.rows = result.rows;
    ARIA_STATE.headers = result.headers;
    ARIA_STATE.loadedAt = new Date();
    ARIA_STATE.source = result.source;
    ARIA_STATE.error = "";

    exposeStore();
    updateInfraStatus();
    dispatchSheetReady();
  } catch (error) {
    ARIA_STATE.rows = [];
    ARIA_STATE.headers = [];
    ARIA_STATE.loadedAt = null;
    ARIA_STATE.source = "";
    ARIA_STATE.error = getErrorMessage(error);

    exposeStore();
    updateInfraStatus();
    dispatchSheetError(error);
  } finally {
    setLoading(false);
  }
}

async function fetchSheetRows({ sheetId, sheetName, fallbackGid, timeoutMs }) {
  const attempts = [
    {
      source: "gviz-sheet",
      url:
        `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
        `?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&headers=1&tq=${encodeURIComponent("select *")}`,
      parser: parseGvizResponse,
    },
    {
      source: "csv-gid",
      url:
        `https://docs.google.com/spreadsheets/d/${sheetId}/export` +
        `?format=csv&gid=${encodeURIComponent(fallbackGid)}`,
      parser: parseCsvResponse,
    },
  ];

  const errors = [];

  for (const attempt of attempts) {
    try {
      const text = await fetchText(attempt.url, timeoutMs);
      const parsed = attempt.parser(text);

      if (!parsed.rows.length) {
        throw new Error(`Fonte ${attempt.source} retornou 0 linhas.`);
      }

      return {
        headers: parsed.headers,
        rows: parsed.rows.map((row, index) => normalizeRow(row, index)),
        source: attempt.source,
      };
    } catch (error) {
      errors.push(`${attempt.source}: ${getErrorMessage(error)}`);
    }
  }

  throw new Error(`Falha ao carregar a planilha. ${errors.join(" | ")}`);
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseGvizResponse(text) {
  const jsonText = extractGvizJson(text);
  const payload = JSON.parse(jsonText);

  const table = payload?.table;
  const cols = Array.isArray(table?.cols) ? table.cols : [];
  const rows = Array.isArray(table?.rows) ? table.rows : [];

  const headers = cols.map((col, index) => {
    const label = String(col?.label || "").trim();
    return label || `COL_${index + 1}`;
  });

  const parsedRows = rows
    .map((row) => {
      const cells = Array.isArray(row?.c) ? row.c : [];
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = readGvizCell(cells[index]);
      });

      return obj;
    })
    .filter(hasAnyValue);

  return { headers, rows: parsedRows };
}

function extractGvizJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Resposta GViz inválida.");
  }

  return text.slice(start, end + 1);
}

function readGvizCell(cell) {
  if (!cell) return "";

  if (cell.f != null && String(cell.f).trim() !== "") return String(cell.f).trim();
  if (cell.v == null) return "";

  if (typeof cell.v === "string") return cell.v.trim();
  if (typeof cell.v === "number") return String(cell.v);
  if (typeof cell.v === "boolean") return cell.v ? "TRUE" : "FALSE";

  return String(cell.v).trim();
}

function parseCsvResponse(text) {
  const matrix = parseCSV(text).filter((row) => row.some((cell) => String(cell || "").trim() !== ""));

  if (!matrix.length) {
    return { headers: [], rows: [] };
  }

  const headers = matrix[0].map((header, index) => {
    const value = String(header || "").trim();
    return value || `COL_${index + 1}`;
  });

  const rows = matrix
    .slice(1)
    .map((line) => {
      const obj = {};
      headers.forEach((header, index) => {
        obj[header] = String(line[index] ?? "").trim();
      });
      return obj;
    })
    .filter(hasAnyValue);

  return { headers, rows };
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        value += '"';
        i += 1;
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
      if (char === "\r" && next === "\n") i += 1;
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
  const normalized = {};
  const original = {};

  Object.keys(row).forEach((key) => {
    const cleanKey = String(key || "").trim();
    const cleanValue = String(row[key] ?? "").trim();

    original[cleanKey] = cleanValue;
    normalized[normalizeHeader(cleanKey)] = cleanValue;
  });

  return {
    __index: index,
    __original: original,
    ...normalized,
  };
}

function normalizeHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function hasAnyValue(obj) {
  return Object.values(obj).some((value) => String(value ?? "").trim() !== "");
}

function exposeStore() {
  window.ARIA_STORE = {
    config: { ...ARIA_CONFIG },
    state: {
      loading: ARIA_STATE.loading,
      error: ARIA_STATE.error,
      headers: [...ARIA_STATE.headers],
      rows: [...ARIA_STATE.rows],
      loadedAt: ARIA_STATE.loadedAt,
      source: ARIA_STATE.source,
      total: ARIA_STATE.rows.length,
    },
    reload: bootSheet,
    getRows: () => [...ARIA_STATE.rows],
    getHeaders: () => [...ARIA_STATE.headers],
    getMeta: () => ({
      loading: ARIA_STATE.loading,
      error: ARIA_STATE.error,
      loadedAt: ARIA_STATE.loadedAt,
      source: ARIA_STATE.source,
      total: ARIA_STATE.rows.length,
    }),
  };
}

function dispatchSheetReady() {
  window.dispatchEvent(
    new CustomEvent("aria:data-ready", {
      detail: {
        rows: [...ARIA_STATE.rows],
        headers: [...ARIA_STATE.headers],
        total: ARIA_STATE.rows.length,
        loadedAt: ARIA_STATE.loadedAt,
        source: ARIA_STATE.source,
      },
    })
  );
}

function dispatchSheetError(error) {
  window.dispatchEvent(
    new CustomEvent("aria:data-error", {
      detail: {
        message: getErrorMessage(error),
      },
    })
  );
}

function updateInfraStatus() {
  const total = ARIA_STATE.rows.length;
  const loadedAt = ARIA_STATE.loadedAt ? formatDateTime(ARIA_STATE.loadedAt) : "—";
  const message = ARIA_STATE.error
    ? `Erro ao carregar base: ${ARIA_STATE.error}`
    : `Base carregada: ${total} linhas • origem: ${ARIA_STATE.source} • atualizado: ${loadedAt}`;

  const statusIds = ["sheetStatus", "infraStatus", "resultadoInfo"];
  statusIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  });

  document.querySelectorAll("[data-sheet-status]").forEach((el) => {
    el.textContent = message;
  });

  document.body.dataset.sheetLoading = ARIA_STATE.loading ? "true" : "false";
  document.body.dataset.sheetReady = ARIA_STATE.error ? "false" : "true";
}

function setLoading(value) {
  ARIA_STATE.loading = Boolean(value);
  updateInfraStatus();
}

function setError(message) {
  ARIA_STATE.error = String(message || "");
  updateInfraStatus();
}

function formatDateTime(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(date);
}

function getErrorMessage(error) {
  if (!error) return "Erro desconhecido.";
  if (error.name === "AbortError") return "Tempo limite excedido ao buscar a planilha.";
  return String(error.message || error);
}
