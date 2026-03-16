/* =========================================================
   GT ARIA — HUB Comercial
   app.js — versão limpa
   ========================================================= */

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/1_mVAHiJ2VSsG33de4mFfvffjy8KDufxI/export?format=csv&gid=1731723852";

const ST = { headers: [], cols: {}, rows: [], filtered: [] };

function esc(v) {
  return String(v ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function norm(v) { return String(v ?? "").trim().toLowerCase(); }
function toNum(v) { const n = Number(String(v??"").replace(/[^\d.-]/g,"")); return isFinite(n)?n:0; }
function cell(row, col) { const i=ST.cols[norm(col)]; return i!==undefined?String(row[i]??"").trim():""; }
function uniqueSorted(col) {
  return [...new Set(ST.rows.map(r=>cell(r.raw,col)).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR"));
}
function fmtPhone(r) { return r.replace(/\D/g,""); }
function parseDate(s) { if(!s||s==="0000-00-00") return null; const d=new Date(s+"T00:00:00"); return isNaN(d)?null:d; }

function calcScore(row) {
  let s=0;
  const ag=toNum(cell(row,"TOTAL_AGENDAMENTOS")), status=norm(cell(row,"STATUS")),
        pend=cell(row,"STATUS_PENDENCIA"), dataMat=cell(row,"DATA_MATRICULA"),
        dataAg=cell(row,"DATA_AGENDAMENTO"), midia=norm(cell(row,"MIDIA")),
        tipo=cell(row,"TIPO_CADASTRO"), curso=cell(row,"CURSO");
  s+=ag*15;
  if(dataAg&&dataAg!=="0000-00-00") s+=20;
  if(dataMat&&dataMat!=="0000-00-00") s-=1000;
  if(status.includes("agend"))   s+=25;
  if(status.includes("confirm")) s+=20;
  if(status.includes("matric"))  s-=1000;
  if(status.includes("perd"))    s-=30;
  if(status.includes("cancel"))  s-=40;
  if(pend) s-=5; if(tipo) s+=4; if(curso) s+=3;
  if(midia.includes("indic"))     s+=10;
  if(midia.includes("whats"))     s+=6;
  if(midia.includes("instagram")) s+=5;
  return s;
}
function faixa(sc) { return sc>=45?"Alta":sc>=20?"Média":"Baixa"; }

function parseCSVLine(line) {
  const out=[]; let cur="", inQ=false;
  for(let i=0;i<line.length;i++) {
    const c=line[i],nx=line[i+1];
    if(c==='"'){if(inQ&&nx==='"'){cur+='"';i++;}else inQ=!inQ;}
    else if(c===","&&!inQ){out.push(cur.trim());cur="";}
    else cur+=c;
  }
  out.push(cur.trim()); return out;
}
function parseCSV(text) {
  return text.replace(/\r\n/g,"\n").replace(/\r/g,"\n")
    .split("\n").filter(l=>l.trim()).map(parseCSVLine);
}

async function loadBase() {
  setCrumbs("Carregando base...");
  setView(`<div class="card"><p>Carregando dados...</p></div>`);
  try {
    const r=await fetch(CSV_URL,{cache:"no-store"});
    if(!r.ok) throw new Error("HTTP "+r.status);
    const raw=parseCSV(await r.text());
    if(raw.length<2) throw new Error("Base vazia");
    ST.headers=raw[0]; ST.cols={};
    ST.headers.forEach((h,i)=>{ST.cols[norm(h)]=i;});
    ST.rows=raw.slice(1).map(row=>{const sc=calcScore(row);return{raw:row,score:sc,faixa:faixa(sc)};});
    ST.filtered=[...ST.rows].sort((a,b)=>b.score-a.score);
    setCrumbs("Base carregada: "+ST.rows.length+" leads");
    renderTela();
  } catch(e) {
    setCrumbs("Erro ao carregar");
    setView(`<div class="card"><p style="color:red">Erro: ${esc(e.message)}</p></div>`);
  }
}

function renderTela() {
  const vendedores=uniqueSorted("VENDEDOR"), midias=uniqueSorted("MIDIA"), cursos=uniqueSorted("CURSO");
  const opts=arr=>arr.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");
  const hoje=new Date(), noventa=new Date(hoje);
  noventa.setDate(hoje.getDate()-90);
  const fmtD=d=>d.toISOString().slice(0,10);

  setView(`
    <div class="card">
      <div class="filters">
        <div class="fItem"><label>Buscar</label>
          <input id="fBusca" class="input" placeholder="Nome, telefone, status..."></div>
        <div class="fItem"><label>Vendedor</label>
          <select id="fVendedor" class="select"><option value="">Todos</option>${opts(vendedores)}</select></div>
        <div class="fItem"><label>Mídia</label>
          <select id="fMidia" class="select"><option value="">Todas</option>${opts(midias)}</select></div>
        <div class="fItem"><label>Curso</label>
          <select id="fCurso" class="select"><option value="">Todos</option>${opts(cursos)}</select></div>
        <div class="fItem"><label>Cadastro (de)</label>
          <input id="fDataDe" type="date" class="input" value="${fmtD(noventa)}"></div>
        <div class="fItem"><label>Cadastro (até)</label>
          <input id="fDataAte" type="date" class="input" value="${fmtD(hoje)}"></div>
      </div>
      <div class="checkRow" style="margin-top:12px">
        <label class="chk"><input type="checkbox" id="chkExcluiMat" checked> Excluir matriculados</label>
        <label class="chk"><input type="checkbox" id="chkSoAgend"> Só com agendamentos</label>
      </div>
    </div>

    <div class="hSep"></div>
    <div class="card">
      <div style="font-weight:900;font-size:14px;opacity:.7;margin-bottom:10px">Análise ARIA</div>
      <div class="cardsAI" id="cardsAI"></div>
    </div>

    <div class="hSep"></div>
    <div class="card">
      <div class="tableWrap">
        <table>
          <thead><tr>
            <th>Score</th><th>Prioridade</th><th>Nome</th><th>Curso</th>
            <th>Mídia</th><th>Vendedor</th><th>Status</th>
            <th>Agend.</th><th>Cadastro</th><th>Contato</th>
          </tr></thead>
          <tbody id="tbody"></tbody>
        </table>
      </div>
      <div id="tableInfo" class="smallNote" style="margin-top:8px"></div>
    </div>
  `);

  ["fBusca","fVendedor","fMidia","fCurso","fDataDe","fDataAte","chkExcluiMat","chkSoAgend"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.addEventListener(el.type==="checkbox"?"change":"input",applyFilters);
  });
  applyFilters();
}

function applyFilters() {
  const busca=norm(document.getElementById("fBusca")?.value);
  const vend=norm(document.getElementById("fVendedor")?.value);
  const midia=norm(document.getElementById("fMidia")?.value);
  const curso=norm(document.getElementById("fCurso")?.value);
  const dataDe=document.getElementById("fDataDe")?.value;
  const dataAte=document.getElementById("fDataAte")?.value;
  const exclMat=document.getElementById("chkExcluiMat")?.checked;
  const soAgend=document.getElementById("chkSoAgend")?.checked;
  const de=dataDe?new Date(dataDe+"T00:00:00"):null;
  const ate=dataAte?new Date(dataAte+"T23:59:59"):null;

  ST.filtered=ST.rows.filter(item=>{
    const row=item.raw;
    if(busca&&!row.join(" ").toLowerCase().includes(busca)) return false;
    if(vend&&norm(cell(row,"VENDEDOR"))!==vend) return false;
    if(midia&&norm(cell(row,"MIDIA"))!==midia) return false;
    if(curso&&norm(cell(row,"CURSO"))!==curso) return false;
    if(de||ate){
      const dc=parseDate(cell(row,"DATA_CADASTRO"));
      if(!dc) return false;
      if(de&&dc<de) return false;
      if(ate&&dc>ate) return false;
    }
    if(exclMat){
      const dm=cell(row,"DATA_MATRICULA"), st=norm(cell(row,"STATUS"));
      if((dm&&dm!=="0000-00-00")||st.includes("matric")) return false;
    }
    if(soAgend&&toNum(cell(row,"TOTAL_AGENDAMENTOS"))===0) return false;
    return true;
  }).sort((a,b)=>b.score-a.score);

  setCrumbs(ST.filtered.length+" leads encontrados");
  renderCards(); renderTable();
}

function renderCards() {
  const el=document.getElementById("cardsAI"); if(!el) return;
  const altas=ST.filtered.filter(r=>r.faixa==="Alta").length;
  const top=ST.filtered[0];
  const cursoMap={};
  ST.filtered.forEach(r=>{const c=cell(r.raw,"CURSO")||"Sem curso";if(!cursoMap[c])cursoMap[c]=0;cursoMap[c]+=r.score;});
  const topCurso=Object.entries(cursoMap).sort((a,b)=>b[1]-a[1])[0];
  const midiaMap={};
  ST.filtered.forEach(r=>{const m=cell(r.raw,"MIDIA")||"Sem mídia";if(!midiaMap[m])midiaMap[m]=0;midiaMap[m]+=r.score;});
  const topMidia=Object.entries(midiaMap).sort((a,b)=>b[1]-a[1])[0];

  el.innerHTML=`
    <div class="aiCard">
      <h4>Leads prioritários</h4>
      <div class="big">${altas}</div>
      <div class="list">Alta probabilidade de avanço na seleção atual.</div>
    </div>
    <div class="aiCard">
      <h4>Melhor lead agora</h4>
      <div class="big">${esc(top?cell(top.raw,"NOME")||"—":"—")}</div>
      <div class="list">${top?`${esc(cell(top.raw,"CURSO"))} · score ${top.score}`:"Sem dados"}</div>
    </div>
    <div class="aiCard">
      <h4>Sugestão ARIA</h4>
      <div class="big">${esc(topCurso?.[0]||"—")}</div>
      <div class="list">Top mídia: ${esc(topMidia?.[0]||"—")}.</div>
    </div>`;
}

function badgeCls(f) { return f==="Alta"?"badge badgeGreen":f==="Média"?"badge badgeBlue":"badge"; }

function renderTable() {
  const tbody=document.getElementById("tbody"), info=document.getElementById("tableInfo");
  if(!tbody) return;
  const MAX=500, lista=ST.filtered.slice(0,MAX);
  tbody.innerHTML=lista.map(item=>{
    const row=item.raw;
    const fone=cell(row,"FONE")||cell(row,"FONE2")||cell(row,"FONE3");
    const num=fmtPhone(fone);
    const wa=num
      ?`<a href="https://wa.me/55${num}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;background:#25D366;color:#fff;padding:5px 10px;border-radius:8px;font-size:12px;text-decoration:none;font-weight:900;white-space:nowrap">
          &#128172; WA</a>`
      :`<span style="color:#ccc;font-size:12px">—</span>`;
    return `<tr>
      <td><strong>${item.score}</strong></td>
      <td><span class="${badgeCls(item.faixa)}">${esc(item.faixa)}</span></td>
      <td>${esc(cell(row,"NOME"))}</td>
      <td style="max-width:150px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(cell(row,"CURSO"))}</td>
      <td>${esc(cell(row,"MIDIA"))}</td>
      <td>${esc(cell(row,"VENDEDOR"))}</td>
      <td>${esc(cell(row,"STATUS"))}</td>
      <td style="text-align:center">${esc(cell(row,"TOTAL_AGENDAMENTOS"))}</td>
      <td>${esc(cell(row,"DATA_CADASTRO"))}</td>
      <td>${wa}</td>
    </tr>`;
  }).join("");
  if(info) info.textContent=ST.filtered.length>MAX?`Exibindo ${MAX} de ${ST.filtered.length} leads. Refine os filtros.`:`${ST.filtered.length} leads`;
}

function generateList() {
  if(!ST.filtered.length){alert("Nenhum lead com os filtros atuais.");return;}
  alert(`Lista pronta: ${Math.min(80,ST.filtered.length)} leads.\nUse "Exportar CSV" para baixar.`);
}

function exportCSV() {
  if(!ST.filtered.length) return;
  const cols=["SCORE","PRIORIDADE","NOME","CURSO","MIDIA","VENDEDOR","STATUS",
              "TOTAL_AGENDAMENTOS","FONE","DATA_CADASTRO","DATA_AGENDAMENTO"];
  const rows=ST.filtered.map(item=>[
    item.score,item.faixa,
    cell(item.raw,"NOME"),cell(item.raw,"CURSO"),cell(item.raw,"MIDIA"),
    cell(item.raw,"VENDEDOR"),cell(item.raw,"STATUS"),
    cell(item.raw,"TOTAL_AGENDAMENTOS"),
    cell(item.raw,"FONE")||cell(item.raw,"FONE2")||cell(item.raw,"FONE3"),
    cell(item.raw,"DATA_CADASTRO"),cell(item.raw,"DATA_AGENDAMENTO"),
  ]);
  const csv=[cols,...rows].map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8;"}));
  a.download="aria-leads.csv"; a.click();
}

function setCrumbs(txt){const el=document.getElementById("crumbs");if(el)el.textContent=txt;}
function setView(html){const el=document.getElementById("view");if(el)el.innerHTML=html;}

function bindNav() {
  document.querySelectorAll(".navItem[data-route]").forEach(a=>{
    a.addEventListener("click",e=>{
      e.preventDefault();
      document.querySelectorAll(".navItem").forEach(n=>n.classList.remove("active"));
      a.classList.add("active");
      loadBase();
    });
  });
}

function bindTopBar() {
  [["btnRecarregarTop",loadBase],["btnGerarTop",generateList],["btnExportTop",exportCSV],
   ["btnRecarregar",loadBase],["btnGerar",generateList],["btnExport",exportCSV]
  ].forEach(([id,fn])=>{const el=document.getElementById(id);if(el)el.addEventListener("click",fn);});
}

window.addEventListener("load",()=>{
  window.__APPJS_OK__=true;
  bindNav(); bindTopBar(); loadBase();
});
