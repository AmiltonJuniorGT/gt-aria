/* ================================
   GT ARIA - Versão Conectada Google Sheets
   ================================ */

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/16CDo-QOkvB1rEbsgJcE7Y2Z-oLzzu2m2/gviz/tq?tqx=out:csv&gid=1636709650";

const state = {
  leads: [],
  prioridade: ["VENDEDOR", "DATA_CADASTRO", "TOTAL_AGENDAMENTOS", "MIDIA", "CURSO"]
};

const $ = (s) => document.querySelector(s);

/* ================================
   INICIALIZAÇÃO
================================ */

window.addEventListener("load", async () => {
  await loadFromGoogleSheets();
  render();
});

/* ================================
   GOOGLE SHEETS
================================ */

async function loadFromGoogleSheets() {
  const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
  if (!res.ok) {
    alert("Erro ao carregar Google Sheets. Confirme se está público.");
    return;
  }

  const csvText = await res.text();
  const rows = parseCSV(csvText);

  state.leads = rows.map((r, idx) => ({
    ID: idx + 1,
    NOME: r.NOME || "",
    CPF: r.CPF || "",
    VENDEDOR: r.VENDEDOR || "",
    DATA_CADASTRO: r.DATA_CADASTRO || "",
    MIDIA: r.MIDIA || "",
    CURSO: r.CURSO || "",
    TOTAL_AGENDAMENTOS: parseInt(r.TOTAL_AGENDAMENTOS || 0),
    MATRICULADO: r.MATRICULADO || "",
    STATUS_PENDENCIA: r.STATUS_PENDENCIA || ""
  }));

  calcularIA();
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  const delimiter = lines[0].includes(";") ? ";" : ",";
  const headers = lines[0].split(delimiter).map(h => h.trim());

  return lines.slice(1).map(line => {
    const parts = line.split(delimiter);
    const obj = {};
    headers.forEach((h, i) => obj[h] = parts[i]);
    return obj;
  });
}

/* ================================
   IA SIMPLES (Score por conversão)
================================ */

function calcularIA() {
  const totalPorMidia = {};
  const matriculadosPorMidia = {};
  const totalPorCurso = {};
  const matriculadosPorCurso = {};

  state.leads.forEach(l => {
    totalPorMidia[l.MIDIA] = (totalPorMidia[l.MIDIA] || 0) + 1;
    totalPorCurso[l.CURSO] = (totalPorCurso[l.CURSO] || 0) + 1;

    if (l.MATRICULADO === "SIM") {
      matriculadosPorMidia[l.MIDIA] = (matriculadosPorMidia[l.MIDIA] || 0) + 1;
      matriculadosPorCurso[l.CURSO] = (matriculadosPorCurso[l.CURSO] || 0) + 1;
    }
  });

  state.leads.forEach(l => {
    const taxaMidia =
      (matriculadosPorMidia[l.MIDIA] || 0) / (totalPorMidia[l.MIDIA] || 1);
    const taxaCurso =
      (matriculadosPorCurso[l.CURSO] || 0) / (totalPorCurso[l.CURSO] || 1);

    l.SCORE_IA = taxaMidia * 0.6 + taxaCurso * 0.4;
  });
}

/* ================================
   RENDER
================================ */

function render() {
  const view = document.getElementById("view");

  view.innerHTML = `
    <div class="card">
      <h3>Prioridade (arraste para ordenar)</h3>
      <div id="drag"></div>
      <button onclick="gerar()">Gerar Lista</button>
      <div id="resultado"></div>
    </div>
  `;

  renderDrag();
}

function renderDrag() {
  const drag = document.getElementById("drag");
  drag.innerHTML = "";

  state.prioridade.forEach(p => {
    const div = document.createElement("div");
    div.className = "dragItem";
    div.draggable = true;
    div.innerText = p;
    drag.appendChild(div);
  });

  enableDrag();
}

/* ================================
   DRAG
================================ */

function enableDrag() {
  const items = document.querySelectorAll(".dragItem");

  items.forEach(item => {
    item.addEventListener("dragstart", () => {
      item.classList.add("dragging");
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      state.prioridade = [...document.querySelectorAll(".dragItem")].map(el => el.innerText);
    });
  });

  document.getElementById("drag").addEventListener("dragover", e => {
    e.preventDefault();
    const dragging = document.querySelector(".dragging");
    const afterElement = getDragAfterElement(e.clientY);
    if (afterElement == null) {
      e.currentTarget.appendChild(dragging);
    } else {
      e.currentTarget.insertBefore(dragging, afterElement);
    }
  });
}

function getDragAfterElement(y) {
  const elements = [...document.querySelectorAll(".dragItem:not(.dragging)")];

  return elements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/* ================================
   GERA LISTA
================================ */

function gerar() {
  let lista = [...state.leads];

  // apenas não matriculados
  lista = lista.filter(l => l.MATRICULADO !== "SIM");

  state.prioridade.forEach(campo => {
    lista.sort((a, b) => {

      if (campo === "DATA_CADASTRO") {
        return new Date(b.DATA_CADASTRO) - new Date(a.DATA_CADASTRO);
      }

      if (campo === "TOTAL_AGENDAMENTOS") {
        return a.TOTAL_AGENDAMENTOS - b.TOTAL_AGENDAMENTOS;
      }

      return (a[campo] || "").localeCompare(b[campo] || "");
    });
  });

  renderTabela(lista);
}

function renderTabela(lista) {
  const resultado = document.getElementById("resultado");

  resultado.innerHTML = `
    <table>
      <tr>
        <th>Nome</th>
        <th>Vendedor</th>
        <th>Mídia</th>
        <th>Curso</th>
        <th>Agend.</th>
        <th>Score IA</th>
      </tr>
      ${lista.map(l => `
        <tr>
          <td>${l.NOME}</td>
          <td>${l.VENDEDOR}</td>
          <td>${l.MIDIA}</td>
          <td>${l.CURSO}</td>
          <td>${l.TOTAL_AGENDAMENTOS}</td>
          <td>${l.SCORE_IA.toFixed(2)}</td>
        </tr>
      `).join("")}
    </table>
  `;
}
