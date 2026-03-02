const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

const HUB_STAGE = {
  NOVO: "NOVO",
  AQUECIDO: "AQUECIDO",
  ENVIADO: "ENVIADO",
  DESCARTADO: "DESCARTADO"
};

const state = {
  all: [],
  viewList: [],
  selectedCpf: "",
  filters: {
    marca: "AMBOS",
    vendedor: "TODOS",
    q: "",
    status: { AGENDADO: true, FINALIZADOM: false, FINALIZADO: false }
  }
};

init();

async function init(){
  document.getElementById("btnReloadTop").onclick = boot;
  await boot();
}

async function boot(){
  const res = await fetch(SHEET_CSV_URL);
  const text = await res.text();
  state.all = parseCSV(text).map(normalizeLead);
  render();
}

/* ===============================
   RENDER
=================================*/
function render(){
  state.viewList = buildList();

  document.getElementById("view").innerHTML = `
    <div class="card">
      <div class="cardTitle">Filtros</div>

      <div class="row">
        <div>
          <label>Marca</label>
          <div class="pills">
            ${marcaPill("AMBOS","Ambos")}
            ${marcaPill("TECNICO","Técnico")}
            ${marcaPill("PROFISSIONALIZANTE","Profissionalizante")}
          </div>
        </div>

        <div class="ctrl">
          <label>Buscar</label>
          <input class="input" id="inpQ" value="${state.filters.q}">
        </div>

        <div class="ctrl">
          <label>Vendedor</label>
          <select class="select" id="selVend">
            <option value="TODOS">Todos</option>
            ${unique(state.all.map(x=>x.VENDEDOR)).map(v=>`
              <option ${state.filters.vendedor===v?"selected":""}>${v}</option>
            `).join("")}
          </select>
        </div>
      </div>
    </div>

    <div class="hSep"></div>

    <div class="gridMain">
      <div class="card">
        <div class="cardTitle">Lista</div>
        <div class="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Nome</th>
                <th>Curso</th>
                <th>Marca</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${state.viewList.map(l=>`
                <tr onclick="selectLead('${l.CPF}')">
                  <td>${l.NOME}</td>
                  <td>${l.CURSO}</td>
                  <td>${l.MARCA}</td>
                  <td>${l.STATUS_PENDENTE}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="card stickyRight">
        ${renderNext()}
      </div>
    </div>
  `;

  bind();
}

function marcaPill(key,label){
  return `
    <div class="pill ${state.filters.marca===key?"pillActive":""}"
      onclick="setMarca('${key}')">
      ${label}
    </div>
  `;
}

function setMarca(key){
  state.filters.marca = key;
  render();
}

function buildList(){
  let list = [...state.all];

  if(state.filters.marca !== "AMBOS"){
    list = list.filter(l =>
      normalize(l.MARCA) === state.filters.marca
    );
  }

  if(state.filters.vendedor !== "TODOS"){
    list = list.filter(l=>l.VENDEDOR===state.filters.vendedor);
  }

  if(state.filters.q){
    const q = state.filters.q.toLowerCase();
    list = list.filter(l =>
      l.NOME.toLowerCase().includes(q) ||
      l.CPF.includes(q)
    );
  }

  return list;
}

function renderNext(){
  const lead = state.viewList.find(l=>l.CPF===state.selectedCpf)
    || state.viewList[0];

  if(!lead) return "<div>Nenhum lead</div>";

  return `
    <div class="cardTitle">Próximo Lead</div>
    <div class="big">${lead.NOME}</div>
    <div>${lead.CURSO}</div>
    <div>Marca: <b>${lead.MARCA}</b></div>
    <div>Status: ${lead.STATUS_PENDENTE}</div>
    <div class="hSep"></div>
    <button class="btn btnPrimary">Whats</button>
  `;
}

function selectLead(cpf){
  state.selectedCpf = cpf;
  render();
}

/* ===============================
   HELPERS
=================================*/
function normalize(s){
  return String(s||"")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"");
}

function normalizeLead(r){
  return {
    NOME:r.NOME||"",
    CPF:r.CPF||"",
    CURSO:r.CURSO||"",
    MARCA: normalize(r.MARCA)==="TECNICO"?"TECNICO":"PROFISSIONALIZANTE",
    STATUS_PENDENTE:r.STATUS_PENDENTE||"",
    VENDEDOR:r.VENDEDOR||""
  };
}

function parseCSV(text){
  const rows = text.split("\n").map(r=>r.split(","));
  const headers = rows[0];
  return rows.slice(1).map(r=>{
    const obj={};
    headers.forEach((h,i)=>obj[h.trim()]=r[i]);
    return obj;
  });
}

function unique(arr){
  return [...new Set(arr.filter(Boolean))];
}
