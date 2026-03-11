console.log("ARIA iniciado");

/* PLANILHA */
const CSV_URL =
"https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

/* ELEMENTOS */
const crumbs = document.getElementById("crumbs");
const view = document.getElementById("view");

let BASE = [];

/* CARREGAR BASE */

async function carregarBase(){

crumbs.innerText = "Carregando base...";

try{

const r = await fetch(CSV_URL);
const t = await r.text();

BASE = t.split("\n").map(l => l.split(","));

crumbs.innerText =
"Base carregada: " + (BASE.length-1) + " leads";

renderTela();

}

catch(e){

crumbs.innerText = "Erro ao carregar base";
console.log(e);

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
