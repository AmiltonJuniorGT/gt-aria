console.log("ARIA iniciado");

/* PLANILHA */
const CSV_URL =
"https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

/* ELEMENTOS */
const crumbs = document.getElementById("crumbs");
const view = document.getElementById("view");

/* CARREGAR DADOS */
async function carregarBase() {

crumbs.innerText = "Carregando base...";

try {

const r = await fetch(CSV_URL);
const t = await r.text();

const linhas = t.split("\n").map(l => l.split(","));

crumbs.innerText =
"Base carregada: " + (linhas.length - 1) + " leads";

renderTabela(linhas);

}

catch(e){

crumbs.innerText = "Erro ao carregar base";
console.log(e);

}

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
