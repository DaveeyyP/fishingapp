/* Közös kód: számítások és eredménytábla (bíró-app és néző oldal is használja) */
(function(g){
"use strict";
var H = {};
/* Nyelv: "hu" (bíró-app) vagy "sr" (néző oldal, szerb latin) */
H.lang = "hu";
var TXT = {
  hu:{noTeam:"Nincs csapat.", box:"Box", team:"Csapat", fish:"Hal", total:"Össz (kg)", big:"Big fish", place:"Hely",
      noCatch:"Még nincs fogás.", tapHint:"Koppints egy csapatra a halak listájáért. Rendezés:", byBox:"box szerint", byPlace:"helyezés szerint",
      bigTitle:"Big Fish", boxW:"box", biggest:"Verseny legnagyobb hala", summary:"Összesítés", sumKg:"Összes kg", sumN:"Halak száma", avg:"Átlag (kg)"},
  sr:{noTeam:"Nema ekipa.", box:"Box", team:"Ekipa", fish:"Riba", total:"Ukupno (kg)", big:"Big fish", place:"Plasman",
      noCatch:"Još nema ulova.", tapHint:"Dodirni ekipu za listu riba. Sortiranje:", byBox:"po boksu", byPlace:"po plasmanu",
      bigTitle:"Big Fish", boxW:"boks", biggest:"Najveća riba takmičenja", summary:"Ukupno", sumKg:"Ukupno kg", sumN:"Broj riba", avg:"Prosek (kg)"}
};
function T(k){ return (TXT[H.lang]||TXT.hu)[k]; }
H.esc = function(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); };
H.num = function(s){ if(typeof s==="number") return s; s=String(s==null?"":s).trim().replace(/\s/g,"").replace(",","."); var n=parseFloat(s); return isFinite(n)?n:NaN; };
H.fmt = function(n,d){ if(n==null||!isFinite(n)) return "–"; d=d==null?3:d; return n.toFixed(d).replace(".",","); };
H.kg = function(n){ return H.fmt(n,3); };
H.uid = function(){ return Math.random().toString(36).slice(2,8) + Date.now().toString(36).slice(-4); };

/* Firebase-ből érkező adatnál a tömbök hiányozhatnak, ha üresek */
H.normalize = function(c){
  if(!c) return null;
  c.periods = arr(c.periods); if(!c.periods.length) c.periods=[{id:"p1",name:"Verseny"}];
  if(!c.activePeriod) c.activePeriod = c.periods[0].id;
  c.sectors = arr(c.sectors);
  c.sectors.forEach(function(s){ s.teams = arr(s.teams); s.teams.forEach(function(t){ t.catches = arr(t.catches); }); });
  return c;
};
function arr(x){ if(!x) return []; if(Array.isArray(x)) return x.filter(function(v){return v!=null;}); return Object.keys(x).map(function(k){return x[k];}); }

H.periodName = function(c,pid){ for(var i=0;i<c.periods.length;i++) if(c.periods[i].id===pid) return c.periods[i].name; return "?"; };
H.periodIdx = function(c,pid){ for(var i=0;i<c.periods.length;i++) if(c.periods[i].id===pid) return i+1; return 0; };

H.teamStats = function(t){
  var tot=0, big=0, n=0;
  t.catches.forEach(function(k){ tot+=k.w; n++; if(k.w>big) big=k.w; });
  return {total:Math.round(tot*1000)/1000, big:big, count:n};
};
/* Helyezés: össztömeg szerint csökkenő; egyenlőségnél a nagyobb hal dönt */
H.rankSector = function(s){
  var rows = s.teams.map(function(t){ var st=H.teamStats(t); return {team:t,total:st.total,big:st.big,count:st.count}; });
  var sorted = rows.slice().sort(function(a,b){ return (b.total-a.total) || (b.big-a.big); });
  sorted.forEach(function(r,i){
    var prev = sorted[i-1];
    r.place = (prev && prev.total===r.total && prev.big===r.big) ? prev.place : i+1;
  });
  var tot = rows.reduce(function(a,r){return a+r.total;},0);
  return {rows:rows, sorted:sorted, total:Math.round(tot*1000)/1000};
};
H.compStats = function(c){
  var tot=0,n=0, perBig={}, overall=null;
  c.sectors.forEach(function(s){ s.teams.forEach(function(t){ t.catches.forEach(function(k){
    tot+=k.w; n++;
    var rec={w:k.w, team:t, sector:s};
    if(!perBig[k.p] || k.w>perBig[k.p].w) perBig[k.p]=rec;
    if(!overall || k.w>overall.w) overall=rec;
  }); }); });
  return {total:Math.round(tot*1000)/1000, count:n, avg:n?tot/n:null, perBig:perBig, overall:overall};
};
H.boxCmp = function(a,b){ var x=H.num(a), y=H.num(b); if(isFinite(x)&&isFinite(y)&&x!==y) return x-y; return String(a).localeCompare(String(b)); };

/* Eredménytábla. view = {sort:"place"|"box", open:{teamId:true}} */
H.resultsHTML = function(c, view){
  var esc=H.esc, kg=H.kg, cs = H.compStats(c), s = '<div class="secgrid'+(c.sectors.length>1?' cols':'')+'">';
  c.sectors.forEach(function(sec){
    var rk = H.rankSector(sec);
    var rows = view.sort==="box" ? rk.rows.slice().sort(function(a,b){return H.boxCmp(a.team.box,b.team.box);}) : rk.sorted;
    s += '<div class="card"><div class="secthead" style="background:'+esc(sec.color)+'"><span class="t">'+esc(sec.name)+'</span><span>'+kg(rk.total)+' kg</span></div>';
    if(!rows.length){ s+='<div class="empty small">'+T('noTeam')+'</div></div>'; return; }
    s += '<table class="res"><thead><tr><th>'+T('box')+'</th><th>'+T('team')+'</th><th class="n">'+T('fish')+'</th><th class="n">'+T('total')+'</th><th class="n">'+T('big')+'</th><th class="n">'+T('place')+'</th></tr></thead><tbody>';
    rows.forEach(function(r){
      s += '<tr class="clk" data-a="toggle" data-id="'+esc(r.team.id)+'"><td><b>'+esc(r.team.box)+'</b></td><td>'+esc(r.team.name)+'</td><td class="n">'+r.count+'</td><td class="n"><b>'+kg(r.total)+'</b></td><td class="n">'+(r.count?kg(r.big):'–')+'</td><td class="n">'+(r.count?'<span class="place p'+r.place+'">'+r.place+'</span>':'–')+'</td></tr>';
      if(view.open[r.team.id]){
        s += '<tr class="det"><td colspan="6"><div class="chips" style="margin:0">'+(r.team.catches.length? r.team.catches.map(function(k,i){
          return '<span class="chip'+(k.w===r.big?' bf':'')+'"><span class="muted">'+(i+1)+'.</span> '+kg(k.w)+(c.periods.length>1?'<sup>'+esc(H.periodName(c,k.p))+'</sup>':'')+'</span>'; }).join('') : '<span class="muted small">'+T('noCatch')+'</span>')+'</div></td></tr>';
      }
    });
    s += '</tbody></table><div class="small muted" style="margin-top:6px">'+T('tapHint')+' <a href="#" data-a="sort">'+(view.sort==="box"?T('byBox'):T('byPlace'))+'</a></div></div>';
  });
  s += '</div>';
  s += '<div class="card"><h2>'+T('bigTitle')+'</h2>';
  if(c.periods.length>1){
    c.periods.forEach(function(p){
      var b = cs.perBig[p.id];
      s += '<div class="bfrow"><div class="grow"><div class="small muted">'+esc(p.name)+'</div><b>'+(b?esc(b.team.name):'–')+'</b>'+(b?' <span class="muted small">('+esc(b.sector.name)+', '+T('boxW')+' '+esc(b.team.box)+')</span>':'')+'</div><div class="w">'+(b?kg(b.w)+' kg':'–')+'</div></div>';
    });
  }
  var o = cs.overall;
  s += '<div class="bfrow main"><div class="grow"><div class="small muted">'+T('biggest')+'</div><b>'+(o?esc(o.team.name):'–')+'</b>'+(o?' <span class="muted small">('+esc(o.sector.name)+', '+T('boxW')+' '+esc(o.team.box)+')</span>':'')+'</div><div class="w">'+(o?kg(o.w)+' kg':'–')+'</div></div></div>';
  s += '<div class="card"><h2>'+T('summary')+'</h2><div class="stats">'+
    '<div class="stat"><div class="v">'+kg(cs.total)+'</div><div class="l">'+T('sumKg')+'</div></div>'+
    '<div class="stat"><div class="v">'+cs.count+'</div><div class="l">'+T('sumN')+'</div></div>'+
    '<div class="stat"><div class="v">'+(cs.avg==null?'–':kg(cs.avg))+'</div><div class="l">'+T('avg')+'</div></div></div></div>';
  return s;
};
g.HCore = H;
})(window);
