/* Horgászverseny – bírói alkalmazás */
(function(){
"use strict";
var H = window.HCore, esc=H.esc, kg=H.kg, num=H.num, uid=H.uid;
var COLORS = ["#d93a2b","#e0b100","#2f9e44","#1c7ed6","#7048e8","#e8590c","#0b7285","#c2255c"];
var K = {state:"hb-state", ui:"hb-ui", cfg:"hb-cfg", auth:"hb-auth", pend:"hb-pending"};
var app = document.getElementById("app");

function load(k,def){ try{ var v=JSON.parse(localStorage.getItem(k)||"null"); return v==null?def:v; }catch(e){ return def; } }
function save(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }

/* ---------- állapot ---------- */
var state = load(K.state, {v:1, comps:[]});
state.comps = (state.comps||[]).map(H.normalize);
var cfg = load(K.cfg, {db:"", key:"", viewer:"", email:""});
var auth = load(K.auth, null);
var pending = load(K.pend, {});
var ui = load(K.ui, {});
ui = {view: ui.view||"home", compId: ui.compId||null, tab: ui.tab||"input", sort: ui.sort||"place", open:{}};
var modal = null, focusKey = null, sync = {status:"", busy:false}, flushTimer = null;

function comp(id){ for(var i=0;i<state.comps.length;i++) if(state.comps[i].id===id) return state.comps[i]; return null; }
function sectorById(c,id){ for(var i=0;i<c.sectors.length;i++) if(c.sectors[i].id===id) return c.sectors[i]; return null; }
function teamById(sec,id){ for(var i=0;i<sec.teams.length;i++) if(sec.teams[i].id===id) return sec.teams[i]; return null; }

/* ---------- Firebase (REST) ---------- */
function dbBase(){ var d=(cfg.db||"").trim().replace(/\/+$/,""); if(d && !/^https?:\/\//.test(d)) d="https://"+d; return d; }
function cloudReady(){ return !!(dbBase() && cfg.key && auth && auth.refreshToken); }

async function login(email, pw){
  var r = await fetch("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key="+encodeURIComponent(cfg.key), {
    method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({email:email, password:pw, returnSecureToken:true})});
  var j = await r.json().catch(function(){return {};});
  if(!r.ok){ var m=(j.error&&j.error.message)||("HTTP "+r.status); throw new Error(loginMsg(m)); }
  auth = {idToken:j.idToken, refreshToken:j.refreshToken, exp:Date.now()+(+j.expiresIn||3600)*1000, email:j.email};
  save(K.auth, auth);
}
function loginMsg(m){
  if(/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/.test(m)) return "Hibás e-mail cím vagy jelszó.";
  if(/API key not valid|API_KEY_INVALID/.test(m)) return "Hibás Web API kulcs.";
  if(/OPERATION_NOT_ALLOWED|PASSWORD_LOGIN_DISABLED/.test(m)) return "Az e-mail/jelszó bejelentkezés nincs bekapcsolva a Firebase-ben.";
  if(/TOO_MANY/.test(m)) return "Túl sok próbálkozás, várj pár percet.";
  return m;
}
async function token(){
  if(!auth) throw new Error("nologin");
  if(Date.now() < auth.exp - 60000) return auth.idToken;
  var r = await fetch("https://securetoken.googleapis.com/v1/token?key="+encodeURIComponent(cfg.key), {
    method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:"grant_type=refresh_token&refresh_token="+encodeURIComponent(auth.refreshToken)});
  var j = await r.json().catch(function(){return {};});
  if(!r.ok){ if(r.status===400||r.status===401){ auth=null; save(K.auth,null); throw new Error("nologin"); } throw new Error("net"); }
  auth.idToken=j.id_token; auth.refreshToken=j.refresh_token; auth.exp=Date.now()+(+j.expires_in||3600)*1000; save(K.auth,auth);
  return auth.idToken;
}
async function dbReq(method, path, body){
  var t = await token();
  var r = await fetch(dbBase()+"/"+path+".json?auth="+encodeURIComponent(t), {method:method, headers:{"Content-Type":"application/json"}, body: body==null?undefined:JSON.stringify(body)});
  if(r.status===401||r.status===403) throw new Error("denied");
  if(!r.ok) throw new Error("HTTP "+r.status);
  return r.json();
}

function markPending(id, op){ pending[id]=op; save(K.pend,pending); scheduleFlush(900); }
function scheduleFlush(ms){ clearTimeout(flushTimer); flushTimer=setTimeout(flush, ms); }
async function flush(){
  if(sync.busy) return scheduleFlush(1500);
  var ids = Object.keys(pending);
  if(!ids.length){ setStatus(cloudReady()?"ok":"local"); return; }
  if(!cloudReady()){ setStatus("local"); return; }
  sync.busy=true; setStatus("busy");
  try{
    for(var i=0;i<ids.length;i++){
      var id=ids[i], op=pending[id], c=comp(id);
      if(op==="del" || !c) await dbReq("DELETE","comps/"+id);
      else await dbReq("PUT","comps/"+id, c);
      if(pending[id]===op){ delete pending[id]; save(K.pend,pending); }
    }
    setStatus(Object.keys(pending).length?"busy":"ok");
    if(Object.keys(pending).length) scheduleFlush(300);
  }catch(e){
    var m=String(e.message||e);
    if(m==="nologin"){ setStatus("nologin"); }
    else if(m==="denied"){ setStatus("denied"); }
    else { setStatus("offline"); scheduleFlush(15000); }
  }finally{ sync.busy=false; }
}
async function pull(showToast){
  if(!cloudReady()) return;
  try{
    var all = await dbReq("GET","comps") || {};
    var n=0;
    Object.keys(all).forEach(function(id){
      var rc = H.normalize(all[id]); if(!rc||!rc.id) return;
      var lc = comp(id);
      if(pending[id]) return;
      if(!lc){ state.comps.push(rc); n++; }
      else if((rc.updated||0) > (lc.updated||0)){ state.comps[state.comps.indexOf(lc)] = rc; n++; }
    });
    save(K.state,state);
    if(showToast) toast(n? n+" verseny frissítve a felhőből" : "Minden naprakész");
    render();
  }catch(e){ if(showToast) toast("Nem sikerült letölteni: "+(e.message==="denied"?"nincs jogosultság":"nincs kapcsolat")); }
}
window.addEventListener("online", function(){ scheduleFlush(500); });
setInterval(function(){ if(Object.keys(pending).length && !sync.busy) flush(); }, 20000);

var STATUS = {ok:"✓ Szinkronizálva", busy:"⏳ Feltöltés…", offline:"⚠ Nincs internet – később feltöltöm", local:"● Csak a telefonon (nincs felhő beállítva)", nologin:"⚠ Jelentkezz be újra (Beállítások)", denied:"⚠ Nincs írási jog (Firebase szabályok)"};
function setStatus(s){ sync.status=s; var el=document.getElementById("syncst"); if(el){ el.textContent=STATUS[s]||""; el.className="syncst "+s; } }

/* ---------- mentés ---------- */
function changed(compId){
  var c = comp(compId||ui.compId);
  if(c) c.updated = Date.now();
  save(K.state, state);
  if(c) markPending(c.id,"put");
  render();
}
function persistUI(){ save(K.ui, {view:ui.view, compId:ui.compId, tab:ui.tab, sort:ui.sort}); }

/* ---------- megjelenítés ---------- */
function render(){
  var c = comp(ui.compId), html;
  if(ui.view==="settings") html = viewSettings();
  else if(ui.view==="comp" && c) html = viewComp(c);
  else { ui.view="home"; html = viewHome(); }
  if(modal) html += modal.html;
  app.innerHTML = html;
  setStatus(sync.status || (cloudReady()?"ok":"local"));
  if(focusKey){ var f=app.querySelector('[data-fk="'+focusKey+'"]'); if(f) f.focus(); focusKey=null; }
  persistUI();
}
function topbar(title, back, extra){
  return '<div class="top">'+(back?'<button class="back" data-a="'+back+'">‹</button>':'<span style="font-size:22px">🎣</span>')+
    '<h1>'+esc(title)+'</h1>'+(extra||'')+'</div><div id="syncst" class="syncst"></div>';
}
function compCard(x){
  var st = H.compStats(x), teams=0; x.sectors.forEach(function(s){teams+=s.teams.length;});
  return '<div class="card comp" data-a="open" data-id="'+x.id+'" style="cursor:pointer"><div class="ico">🐟</div><div class="grow"><h3>'+esc(x.name||"Névtelen verseny")+'</h3>'+
    '<div class="muted small">'+esc(x.date||"")+(x.place?' · '+esc(x.place):'')+'</div>'+
    '<div class="small" style="margin-top:3px">'+x.sectors.length+' szektor · '+teams+' csapat · <b>'+kg(st.total)+' kg</b> · '+st.count+' hal</div></div><div class="muted" style="font-size:20px">›</div></div>';
}
function viewHome(){
  var s = topbar("Horgászversenyek", null, '<button class="back" data-a="settings">⚙</button>') + '<div class="wrap">';
  if(!cloudReady()) s += '<div class="warn" style="margin-bottom:12px">A versenyzők csak akkor látják az eredményeket, ha beállítod a felhőt és bejelentkezel. <a href="#" data-a="settings">Beállítások ›</a></div>';
  if(!state.comps.length) s += '<div class="card empty">Még nincs verseny.<br>Hozz létre egyet az alábbi gombbal.</div>';
  state.comps.slice().sort(function(a,b){return (b.updated||0)-(a.updated||0);}).forEach(function(x){ s += compCard(x); });
  return s + '</div><button class="btn fab" data-a="newComp">＋ Új verseny</button>';
}
function viewSettings(){
  var s = topbar("Beállítások", "home") + '<div class="wrap">';
  s += '<div class="card"><h2>Felhő (Firebase)</h2>'+
    '<form data-f="cfg"><label class="f">Adatbázis címe (Realtime Database URL)</label><input type="text" name="db" value="'+esc(cfg.db)+'" placeholder="https://xxxx-default-rtdb.europe-west1.firebasedatabase.app" autocapitalize="off" autocorrect="off" spellcheck="false">'+
    '<label class="f">Web API kulcs</label><input type="text" name="key" value="'+esc(cfg.key)+'" placeholder="AIza…" autocapitalize="off" autocorrect="off" spellcheck="false">'+
    '<label class="f">Néző oldal címe</label><input type="text" name="viewer" value="'+esc(cfg.viewer)+'" placeholder="https://felhasznalonev.github.io/horgasz-biro/" autocapitalize="off" autocorrect="off" spellcheck="false">'+
    '<button class="btn" style="margin-top:12px" type="submit">Mentés</button></form></div>';
  s += '<div class="card"><h2>Bírói fiók</h2>';
  if(auth) s += '<p>Bejelentkezve: <b>'+esc(auth.email||"")+'</b></p><div class="row"><button class="btn sec" data-a="pull">⟳ Letöltés a felhőből</button><button class="btn danger" data-a="logout">Kijelentkezés</button></div>';
  else s += '<form data-f="login"><label class="f">E-mail</label><input type="text" name="email" inputmode="email" value="'+esc(cfg.email)+'" autocapitalize="off">'+
    '<label class="f">Jelszó</label><input type="password" name="pw" style="border:1px solid var(--line);border-radius:10px;padding:9px 10px;width:100%">'+
    '<button class="btn" style="margin-top:12px" type="submit">Bejelentkezés</button></form>';
  s += '</div><div class="card small muted">A versenyek mindig a telefonon is el vannak mentve, így internet nélkül is lehet rögzíteni. Amint van kapcsolat, az app magától feltölti a változásokat.</div>';
  return s + '</div>';
}
function viewComp(c){
  var s = topbar(c.name||"Verseny", "home", '<button class="back" data-a="share">🔗 Link</button>');
  s += '<div class="wrap"><div class="tabs">'+
    ['input:Fogások','results:Eredmények','settings:Beállítások'].map(function(t){ var p=t.split(":"); return '<button class="'+(ui.tab===p[0]?'on':'')+'" data-a="tab" data-id="'+p[0]+'">'+p[1]+'</button>'; }).join('')+'</div>';
  if(ui.tab==="input") s += tabInput(c);
  else if(ui.tab==="results") s += H.resultsHTML(c, ui);
  else s += tabSettings(c);
  return s + '</div>';
}
function periodSelect(c, sel, attrs){
  return '<select '+attrs+'>'+c.periods.map(function(p){ return '<option value="'+p.id+'"'+(p.id===sel?' selected':'')+'>'+esc(p.name)+'</option>'; }).join('')+'</select>';
}
function tabInput(c){
  var s = "";
  if(c.periods.length>1) s += '<div class="card row"><span class="grow small muted">Aktuális időszak (az új fogások ide kerülnek):</span>'+periodSelect(c,c.activePeriod,'data-ch="activePeriod" style="width:auto"')+'</div>';
  if(!c.sectors.length) s += '<div class="card empty">Még nincs szektor. Adj hozzá egyet!</div>';
  c.sectors.forEach(function(sec){
    var rk = H.rankSector(sec), placeOf={}; rk.rows.forEach(function(r){placeOf[r.team.id]=r.place;});
    s += '<div class="card"><div class="secthead" style="background:'+esc(sec.color)+'"><span class="t">'+esc(sec.name)+'</span><span>'+kg(rk.total)+' kg</span><button class="btn sm sec" data-a="editSector" data-id="'+sec.id+'">✎</button></div>';
    var teams = sec.teams.slice().sort(function(a,b){ return H.boxCmp(a.box,b.box); });
    if(!teams.length) s += '<div class="empty small">Nincs még csapat ebben a szektorban.</div>';
    teams.forEach(function(t){
      var st = H.teamStats(t);
      s += '<div class="team"><div class="hd"><div class="boxn" style="background:'+esc(sec.color)+'">'+esc(t.box||"–")+'</div>'+
        '<div class="nm" data-a="editTeam" data-id="'+t.id+'" data-sec="'+sec.id+'">'+esc(t.name||"Névtelen")+' <span class="muted small">✎</span></div>'+
        '<div class="sum"><b>'+kg(st.total)+'</b> kg<br>'+st.count+' hal · '+(st.count?placeOf[t.id]+'. hely':'–')+'</div></div>';
      if(t.catches.length){
        s += '<div class="chips">'+t.catches.map(function(k){
          return '<button class="chip'+(k.w===st.big?' bf':'')+'" data-a="editCatch" data-id="'+k.id+'" data-team="'+t.id+'" data-sec="'+sec.id+'">'+kg(k.w)+(c.periods.length>1?'<sup>'+H.periodIdx(c,k.p)+'</sup>':'')+'</button>';
        }).join('')+'</div>';
      } else s += '<div style="height:8px"></div>';
      s += '<form class="addrow" data-f="addCatch" data-team="'+t.id+'" data-sec="'+sec.id+'"><input data-fk="w-'+t.id+'" name="w" inputmode="decimal" autocomplete="off" placeholder="Hal tömege (kg), pl. 6,375"><button class="btn" type="submit">＋</button></form></div>';
    });
    s += '<button class="btn sec big" data-a="addTeam" data-id="'+sec.id+'">＋ Csapat hozzáadása</button></div>';
  });
  return s + '<button class="btn big" data-a="addSector">＋ Új szektor</button>';
}
function tabSettings(c){
  var s = '<div class="card"><h2>Verseny adatai</h2>'+
    '<label class="f">Név</label><input type="text" data-ch="name" value="'+esc(c.name)+'">'+
    '<label class="f">Dátum</label><input type="text" data-ch="date" value="'+esc(c.date)+'" placeholder="pl. 2026. 11. 08–09.">'+
    '<label class="f">Helyszín</label><input type="text" data-ch="place" value="'+esc(c.place||"")+'"></div>';
  s += '<div class="card"><h2>Időszakok (Big Fish)</h2><div class="small muted" style="margin-bottom:8px">Többnapos versenynél add meg a napokat vagy szakaszokat. Mindegyikhez külön Big Fish készül.</div>';
  c.periods.forEach(function(p){
    s += '<div class="per"><input type="text" data-pch="'+p.id+'" value="'+esc(p.name)+'">'+(c.periods.length>1?'<button class="btn sm danger" data-a="delPeriod" data-id="'+p.id+'">✕</button>':'')+'</div>';
  });
  s += '<button class="btn sec sm" data-a="addPeriod">＋ Időszak</button></div>';
  s += '<div class="card"><h2>Műveletek</h2><div class="row">'+
    '<button class="btn sec" data-a="dupComp">Másolat sablonként (fogások nélkül)</button>'+
    '<button class="btn danger" data-a="delComp">Verseny törlése</button></div></div>';
  return s;
}

/* ---------- ablakok ---------- */
function openModal(html){ modal={html:'<div class="modalbg" data-a="closeBg"><div class="modal">'+html+'</div></div>'}; render(); var i=app.querySelector(".modal input:not([readonly]):not([type=hidden])"); if(i) i.focus(); }
function closeModal(){ modal=null; render(); }
function toast(t){ document.querySelectorAll(".toast").forEach(function(x){x.remove();}); var d=document.createElement("div"); d.className="toast"; d.textContent=t; document.body.appendChild(d); setTimeout(function(){d.remove();},2600); }
function confirmBox(text, yes){
  openModal('<h3>Megerősítés</h3><p>'+text+'</p><div class="row"><span class="grow"></span><button class="btn sec" data-a="closeM">Mégse</button><button class="btn danger" data-a="yes">Törlés</button></div>');
  modal.yes = yes;
}
function teamModal(c, secId, teamId){
  var sec=sectorById(c,secId), t=teamId?teamById(sec,teamId):null;
  openModal('<h3>'+(t?'Csapat szerkesztése':'Új csapat – '+esc(sec.name))+'</h3><form data-f="team" data-sec="'+secId+'" data-id="'+(teamId||"")+'">'+
    '<label class="f">Box száma</label><input type="text" name="box" inputmode="decimal" value="'+esc(t?t.box:"")+'" required>'+
    '<label class="f">Csapat / versenyző neve</label><input type="text" name="name" value="'+esc(t?t.name:"")+'" required>'+
    '<div class="row" style="margin-top:14px">'+(t?'<button type="button" class="btn danger" data-a="delTeam" data-id="'+t.id+'" data-sec="'+secId+'">Törlés</button>':'')+'<span class="grow"></span><button type="button" class="btn sec" data-a="closeM">Mégse</button><button class="btn" type="submit">'+(t?'Mentés':'Hozzáadás')+'</button></div></form>');
}
function liveLink(c){
  var v=(cfg.viewer||"").trim(); if(!v) return "";
  var db=dbBase().replace(/^https:\/\//,"");
  return v + (v.indexOf("?")>=0?"&":"?") + "db=" + encodeURIComponent(db) + "&c=" + c.id;
}
function nativeShare(text){ if(window.Android && Android.share){ Android.share(text); return true; } return false; }
function nativeCopy(text){
  if(window.Android && Android.copy){ Android.copy(text); toast("Link kimásolva"); return; }
  try{ navigator.clipboard.writeText(text).then(function(){toast("Link kimásolva");},function(){toast("Jelöld ki és másold ki kézzel");}); }catch(e){ toast("Jelöld ki és másold ki kézzel"); }
}

/* Android vissza gomb */
window.__back = function(){
  if(modal){ closeModal(); return true; }
  if(ui.view!=="home"){ ui.view="home"; render(); return true; }
  return false;
};

/* ---------- események ---------- */
app.addEventListener("click", function(e){
  var el = e.target.closest("[data-a]"); if(!el) return;
  var a = el.getAttribute("data-a"), id = el.getAttribute("data-id");
  if(a==="closeBg"){ if(e.target===el) closeModal(); return; }
  if(el.tagName==="A") e.preventDefault();
  var c = comp(ui.compId);
  switch(a){
    case "home": ui.view="home"; modal=null; render(); window.scrollTo(0,0); break;
    case "settings": ui.view="settings"; modal=null; render(); window.scrollTo(0,0); break;
    case "open": ui.view="comp"; ui.compId=id; ui.tab="input"; render(); window.scrollTo(0,0); break;
    case "tab": ui.tab=id; render(); break;
    case "sort": ui.sort = ui.sort==="box"?"place":"box"; render(); break;
    case "toggle": ui.open[id]=!ui.open[id]; render(); break;
    case "pull": pull(true); break;
    case "logout": auth=null; save(K.auth,null); setStatus("local"); render(); break;
    case "closeM": closeModal(); break;
    case "yes": if(modal&&modal.yes) modal.yes(); break;
    case "newComp":
      openModal('<h3>Új verseny</h3><form data-f="newComp"><label class="f">Verseny neve</label><input type="text" name="name" required placeholder="pl. Őszi kupa">'+
        '<label class="f">Dátum</label><input type="text" name="date" value="'+new Date().toLocaleDateString("hu-HU")+'">'+
        '<label class="f">Szektorok száma</label><input type="number" name="ns" value="3" min="0" max="12">'+
        '<label class="f">Napok / időszakok száma (Big Fish)</label><input type="number" name="np" value="1" min="1" max="10">'+
        '<div class="row" style="margin-top:14px"><button type="button" class="btn sec grow" data-a="closeM">Mégse</button><button class="btn grow" type="submit">Létrehozás</button></div></form>');
      break;
    case "addSector":
      var n=c.sectors.length; c.sectors.push({id:uid(), name:"Szektor "+String.fromCharCode(65+n), color:COLORS[n%COLORS.length], teams:[]}); changed(); break;
    case "editSector":
      var sec=sectorById(c,id);
      openModal('<h3>Szektor</h3><form data-f="editSector" data-id="'+id+'"><label class="f">Név</label><input type="text" name="name" value="'+esc(sec.name)+'">'+
        '<label class="f">Szín</label><div class="colorsw">'+COLORS.map(function(col){return '<button type="button" class="'+(col===sec.color?'on':'')+'" style="background:'+col+'" data-a="pickColor" data-id="'+col+'"></button>';}).join('')+'</div><input type="hidden" name="color" value="'+sec.color+'">'+
        '<div class="row" style="margin-top:14px"><button type="button" class="btn danger" data-a="delSector" data-id="'+id+'">Törlés</button><span class="grow"></span><button type="button" class="btn sec" data-a="closeM">Mégse</button><button class="btn" type="submit">Mentés</button></div></form>');
      break;
    case "pickColor":
      var f=el.closest("form"); f.color.value=id; f.querySelectorAll(".colorsw button").forEach(function(b){b.classList.toggle("on",b===el);}); break;
    case "delSector":
      var sc=sectorById(c,id);
      confirmBox('Biztosan törlöd a(z) „'+esc(sc.name)+'” szektort az összes csapatával és fogásával együtt?', function(){ c.sectors=c.sectors.filter(function(x){return x.id!==id;}); modal=null; changed(); }); break;
    case "addTeam": teamModal(c, id, null); break;
    case "editTeam": teamModal(c, el.getAttribute("data-sec"), id); break;
    case "delTeam":
      var sc2=sectorById(c,el.getAttribute("data-sec")), tm=teamById(sc2,id);
      confirmBox('Törlöd a(z) „'+esc(tm.name)+'” csapatot és a '+tm.catches.length+' fogását?', function(){ sc2.teams=sc2.teams.filter(function(x){return x.id!==id;}); modal=null; changed(); }); break;
    case "editCatch":
      var sc3=sectorById(c,el.getAttribute("data-sec")), t3=teamById(sc3,el.getAttribute("data-team")), k=t3.catches.filter(function(x){return x.id===id;})[0];
      openModal('<h3>Fogás módosítása</h3><div class="muted small">'+esc(t3.name)+' · box '+esc(t3.box)+'</div><form data-f="editCatch" data-id="'+id+'" data-team="'+t3.id+'" data-sec="'+sc3.id+'">'+
        '<label class="f">Tömeg (kg)</label><input name="w" inputmode="decimal" value="'+kg(k.w)+'">'+
        (c.periods.length>1?'<label class="f">Időszak</label>'+periodSelect(c,k.p,'name="p"'):'')+
        '<div class="row" style="margin-top:14px"><button type="button" class="btn danger" data-a="delCatch" data-id="'+id+'" data-team="'+t3.id+'" data-sec="'+sc3.id+'">Törlés</button><span class="grow"></span><button type="button" class="btn sec" data-a="closeM">Mégse</button><button class="btn" type="submit">Mentés</button></div></form>');
      break;
    case "delCatch":
      var t4=teamById(sectorById(c,el.getAttribute("data-sec")),el.getAttribute("data-team"));
      t4.catches=t4.catches.filter(function(x){return x.id!==id;}); modal=null; changed(); break;
    case "addPeriod": c.periods.push({id:uid(), name:(c.periods.length+1)+". nap"}); changed(); break;
    case "delPeriod":
      var used=0; c.sectors.forEach(function(s){s.teams.forEach(function(t){t.catches.forEach(function(k){ if(k.p===id) used++; });});});
      if(used){ toast("Ehhez az időszakhoz "+used+" fogás tartozik – előbb módosítsd azokat."); break; }
      c.periods=c.periods.filter(function(p){return p.id!==id;}); if(c.activePeriod===id) c.activePeriod=c.periods[0].id; changed(); break;
    case "dupComp":
      var cp = JSON.parse(JSON.stringify(c)); cp.id=uid(); cp.name=(c.name||"Verseny")+" (másolat)";
      cp.sectors.forEach(function(s){ s.id=uid(); s.teams.forEach(function(t){ t.id=uid(); t.catches=[]; }); });
      state.comps.push(cp); ui.compId=cp.id; ui.tab="settings"; toast("Másolat elkészült"); changed(cp.id); break;
    case "delComp":
      confirmBox('Biztosan törlöd a(z) „'+esc(c.name)+'” versenyt? A nézők linkje is megszűnik.', function(){
        state.comps=state.comps.filter(function(x){return x.id!==c.id;}); save(K.state,state); markPending(c.id,"del"); ui.view="home"; modal=null; render(); }); break;
    case "share":
      var link = liveLink(c);
      var warn = !cloudReady() ? '<div class="warn" style="margin-top:12px">Még nincs beállítva a felhő vagy nem vagy bejelentkezve, ezért a link most még nem mutat adatot. <a href="#" data-a="settings">Beállítások ›</a></div>' : '';
      if(!link){ openModal('<h3>🔗 Link a versenyzőknek</h3><div class="warn">Előbb add meg a <b>Néző oldal címét</b> a Beállításokban.</div><div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn" data-a="settings">Beállítások</button></div>'); break; }
      openModal('<h3>🔗 Link a versenyzőknek</h3><div class="small muted" style="margin-bottom:10px">Ezen a linken a versenyzők alkalmazás nélkül, bármelyik telefonról követhetik ennek a versenynek az eredményeit. Ha új halat írsz be, magától frissül.</div>'+
        '<input type="text" readonly value="'+esc(link)+'" id="lnk" style="font-size:12.5px">'+
        '<div class="row" style="margin-top:10px"><button class="btn grow" data-a="doShare">Megosztás…</button><button class="btn sec" data-a="copy">Másolás</button><a class="btn sec" href="'+esc(link)+'" target="_blank" style="text-decoration:none">Megnyitás</a></div>'+warn+
        '<div class="row" style="margin-top:12px"><span class="grow"></span><button class="btn ghost" data-a="closeM">Bezárás</button></div>');
      break;
    case "doShare":
      var l=document.getElementById("lnk").value;
      if(!nativeShare((comp(ui.compId).name||"Horgászverseny")+" – élő eredmények: "+l)) nativeCopy(l);
      break;
    case "copy": nativeCopy(document.getElementById("lnk").value); break;
  }
});

app.addEventListener("submit", function(e){
  e.preventDefault();
  var f=e.target, kind=f.getAttribute("data-f"), c=comp(ui.compId);
  if(kind==="cfg"){
    cfg.db=f.db.value.trim(); cfg.key=f.key.value.trim(); cfg.viewer=f.viewer.value.trim();
    if(cfg.viewer && !/^https?:\/\//.test(cfg.viewer)) cfg.viewer="https://"+cfg.viewer;
    save(K.cfg,cfg); toast("Mentve"); render(); return;
  }
  if(kind==="login"){
    if(!dbBase()||!cfg.key){ toast("Előbb add meg az adatbázis címét és az API kulcsot, majd nyomj Mentést."); return; }
    var email=f.email.value.trim(), pw=f.pw.value; cfg.email=email; save(K.cfg,cfg);
    var btn=f.querySelector("button[type=submit]"); btn.disabled=true; btn.textContent="Bejelentkezés…";
    login(email,pw).then(function(){
      toast("Sikeres bejelentkezés");
      state.comps.forEach(function(x){ if(!pending[x.id]) pending[x.id]="put"; }); save(K.pend,pending);
      return pull(false);
    }).then(function(){ render(); flush(); })
    .catch(function(err){ btn.disabled=false; btn.textContent="Bejelentkezés"; toast(err.message==="Failed to fetch"?"Nincs internetkapcsolat":err.message); });
    return;
  }
  if(kind==="newComp"){
    var ns=Math.max(0,Math.min(12,parseInt(f.ns.value)||0)), np=Math.max(1,Math.min(10,parseInt(f.np.value)||1));
    var periods=[]; for(var i=0;i<np;i++) periods.push({id:uid(), name: np===1?"Verseny":(i+1)+". nap"});
    var sectors=[]; for(var j=0;j<ns;j++) sectors.push({id:uid(), name:"Szektor "+String.fromCharCode(65+j), color:COLORS[j%COLORS.length], teams:[]});
    var nc={id:uid(), name:f.name.value.trim(), date:f.date.value.trim(), place:"", periods:periods, activePeriod:periods[0].id, sectors:sectors};
    state.comps.push(nc); ui.compId=nc.id; ui.view="comp"; ui.tab="input"; modal=null; changed(nc.id); return;
  }
  if(kind==="editSector"){ var s=sectorById(c,f.getAttribute("data-id")); s.name=f.name.value.trim()||s.name; s.color=f.color.value; modal=null; changed(); return; }
  if(kind==="team"){
    var sec=sectorById(c,f.getAttribute("data-sec")), tid=f.getAttribute("data-id");
    var box=f.box.value.trim(), name=f.name.value.trim();
    var dup = c.sectors.some(function(s2){ return s2.teams.some(function(t){ return t.id!==tid && String(t.box)===box; }); });
    if(dup){ toast("A(z) "+box+". box már foglalt!"); return; }
    if(tid){ var t=teamById(sec,tid); t.box=box; t.name=name; }
    else sec.teams.push({id:uid(), box:box, name:name, catches:[]});
    modal=null; changed(); return;
  }
  if(kind==="addCatch"){
    var w=num(f.w.value);
    if(!(w>0) || w>200){ toast("Érvénytelen tömeg"); f.w.focus(); return; }
    var tm=teamById(sectorById(c,f.getAttribute("data-sec")), f.getAttribute("data-team"));
    tm.catches.push({id:uid(), w:Math.round(w*1000)/1000, p:c.activePeriod, t:Date.now()});
    focusKey="w-"+tm.id; changed(); return;
  }
  if(kind==="editCatch"){
    var w2=num(f.w.value); if(!(w2>0)){ toast("Érvénytelen tömeg"); return; }
    var t2=teamById(sectorById(c,f.getAttribute("data-sec")), f.getAttribute("data-team"));
    var k=t2.catches.filter(function(x){return x.id===f.getAttribute("data-id");})[0];
    k.w=Math.round(w2*1000)/1000; if(f.p) k.p=f.p.value; modal=null; changed(); return;
  }
});

app.addEventListener("change", function(e){
  var el=e.target, c=comp(ui.compId); if(!c) return;
  var k=el.getAttribute("data-ch");
  if(k){ c[k]=el.value; changed(); return; }
  var pid=el.getAttribute("data-pch");
  if(pid){ c.periods.forEach(function(p){ if(p.id===pid) p.name=el.value.trim()||p.name; }); changed(); }
});

render();
if(cloudReady()){ pull(false).then(flush); }
})();
