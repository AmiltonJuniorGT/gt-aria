/* =========================================================
   ARIA • Infraestrutura App
   Validação de carregamento da planilha
   - GitHub Pages
   - JavaScript puro
   - sem framework
   - sem lógica visual do motor
   ========================================================= */

const ARIA_CONFIG = {
  sheetId: "1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI",
  sheetName: "data",
  fallbackGid: "1731723852",
  timeoutMs: 20000,
};

const ARIA_STATE = {
  loading: false,
  error: "",
  rows: [],
  headers: [],
  loadedAt: null,
  source: "",
};

(function initARIAInfra() {
  document.addEventListener("DOMContentLoaded", () => {
    bindInfraButtons();
    bootSheet();
  });
})();

function bindInfraButtons() {
  const reloadIds = ["btnReloadTop", "btnRecarregar", "btnReload", "reloadSheet"];
  reloadIds.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
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
