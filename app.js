const state={leads:[],prioridade:["DATA","MIDIA","CURSO","AGEND"]};
const $=s=>document.querySelector(s);

function render(){
 const h=location.hash||"#/login";
 if(h==="#/login") viewLogin();
 if(h==="#/qualificacao") viewQualificacao();
 if(h==="#/funil") viewFunil();
}
function viewLogin(){
 $("#crumbs").textContent="Login";
 $("#view").innerHTML=`<div class='card'>
  <h2>Acelerador de vendas 0.1</h2>
  <button onclick="location.hash='#/qualificacao'">Entrar</button>
 </div>`;
}
function viewQualificacao(){
 $("#crumbs").textContent="Tratamento de Leads";
 $("#view").innerHTML=`
 <div class='card'>
  <h3>Ordem de Prioridade (arraste)</h3>
  <div id='drag'>
   ${state.prioridade.map(p=>`<div class='dragItem' draggable='true'>${p}</div>`).join("")}
  </div>
  <button onclick='gerar()'>Gerar</button>
  <div id='lista'></div>
 </div>`;
 enableDrag();
}
function viewFunil(){
 $("#crumbs").textContent="Funil Diário";
 $("#view").innerHTML=`<div class='card'><h3>Funil (protótipo)</h3></div>`;
}
function gerar(){
 $("#lista").innerHTML="<table><tr><th>Exemplo</th></tr><tr><td>Leads ordenados...</td></tr></table>";
}
function enableDrag(){
 const items=document.querySelectorAll(".dragItem");
 items.forEach(i=>{
  i.addEventListener("dragstart",()=>i.classList.add("dragging"));
  i.addEventListener("dragend",()=>i.classList.remove("dragging"));
 });
 document.getElementById("drag").addEventListener("dragover",e=>{
  e.preventDefault();
  const dragging=document.querySelector(".dragging");
  const after=[...items].find(el=>e.clientY<el.getBoundingClientRect().top+el.offsetHeight/2);
  if(after) e.currentTarget.insertBefore(dragging,after);
  else e.currentTarget.appendChild(dragging);
 });
}
window.addEventListener("hashchange",render);
render();
