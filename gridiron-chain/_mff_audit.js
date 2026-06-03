// MFF audit — trench slices: pass-rush + run-stuff (DL), pass-pro + run-block (OL).
// Runs a full round-robin season, accumulates the per-snap trench attribution the
// engine records (no RNG, no outcome change), turns it into 0-99 PFF-style grades,
// and prints leaderboards + validation.
//
// Validation: (1) league pressure rate & run-block-win rate vs NFL, (2) each
// grade's correlation with player OVR (must be positive but < ~0.85, or it's just
// re-stating OVR), (3) leaderboards with OVR for face-validity.
// Dev/audit tool only — ignored by the build.   node _mff_audit.js [seasons]
const fs = require("fs"); const path = require("path");
const files = ["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js","play-engine.js"];
function stripUiInit(code,file){ if(file!=="play-render.js")return code;
  return code.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x"); }
const shim=`var _stub=new Proxy(function(){},{get(t,k){if(k==="style"||k==="classList"||k==="dataset")return _stub;if(k==="length")return 0;if(k===Symbol.iterator)return function*(){};return _stub;},set(){return true;},apply(){return _stub;},construct(){return _stub;}});
var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
if(typeof performance==="undefined")var performance={now:()=>Date.now()};var requestAnimationFrame=()=>0;
var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`;

const audit=`;(function(){
  if(typeof GameSimulator==="undefined"){console.error("no GameSimulator");process.exit(1);}
  const SEASONS=Number(process.argv[2]||1);
  function buildRoster(t){return genRoster(getPlaybook(t),{},null);}

  const acc=new Map();
  const F=["prs_snaps","pressures","qb_hits","sk","rd_snaps","stuffs","rd_loss",
           "pp_snaps","pa","sk_allowed","rb_snaps","rb_win","rb_loss"];
  const get=(name,pos,ovr,arch)=>{ let r=acc.get(name);
    if(!r){r={name,pos,ovr,arch};for(const f of F)r[f]=0;r.grade=0;acc.set(name,r);} return r; };

  const t0=Date.now();
  for(let s=0;s<SEASONS;s++){
    const ros={}; const meta=new Map();
    for(const t of TEAMS){ ros[t.id]=buildRoster(t);
      for(const p of ros[t.id]) meta.set(p.name,{pos:p.position,ovr:p.overall,arch:p.archetype}); }
    for(let i=0;i<TEAMS.length;i++) for(let j=i+1;j<TEAMS.length;j++){
      const sim=new GameSimulator(TEAMS[i],TEAMS[j],ros[TEAMS[i].id],ros[TEAMS[j].id]); sim.simulate();
      for(const side of ["home","away"]){ const pls=sim.stats[side].players;
        for(const n in pls){ const p=pls[n]; const m=meta.get(n); if(!m)continue;
          const any=(p.pass_rush_snaps||0)+(p.run_def_snaps||0)+(p.pass_pro_snaps||0)+(p.run_block_snaps||0)+(p.sk||0)+(p.sacks_allowed||0);
          if(!any)continue; const r=get(n,m.pos,m.ovr,m.arch);
          r.prs_snaps+=p.pass_rush_snaps||0; r.pressures+=p.pressures||0; r.qb_hits+=p.qb_hits||0; r.sk+=p.sk||0;
          r.rd_snaps+=p.run_def_snaps||0; r.stuffs+=p.run_stuffs||0; r.rd_loss+=p.run_def_losses||0;
          r.pp_snaps+=p.pass_pro_snaps||0; r.pa+=p.pressures_allowed||0; r.sk_allowed+=p.sacks_allowed||0;
          r.rb_snaps+=p.run_block_snaps||0; r.rb_win+=p.run_block_wins||0; r.rb_loss+=p.run_block_losses||0;
        }
      }
    }
  }
  const secs=((Date.now()-t0)/1000).toFixed(0);
  const all=[...acc.values()];

  const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
  const sd=(xs,m)=>Math.sqrt(xs.reduce((a,b)=>a+(b-m)*(b-m),0)/Math.max(1,xs.length))||1;
  const corr=(rows,fx,fy)=>{const xs=rows.map(fx),ys=rows.map(fy),mx=mean(xs),my=mean(ys);
    let n=0,dx=0,dy=0;for(let i=0;i<xs.length;i++){n+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}return n/Math.sqrt(dx*dy||1);};
  // Standardized-grade helper: writes r[key] from a per-player rate, given weight
  // terms [{fn,w}] (positive w = higher rate is better). center 60, clamp 20-99.
  const zg=(rows,key,terms)=>{ const stat=terms.map(t=>{const xs=rows.map(t.fn);const m=mean(xs);return {m,s:sd(xs,m),...t};});
    for(const r of rows){ let g=60; for(const t of stat) g+=t.w*((t.fn(r)-t.m)/t.s); r[key]=Math.max(20,Math.min(99,Math.round(g))); } };

  // Rates
  const prRate=r=>r.pressures/Math.max(1,r.prs_snaps), skRate=r=>r.sk/Math.max(1,r.prs_snaps);
  const stuffRate=r=>r.stuffs/Math.max(1,r.rd_snaps);
  const rdNet=r=>(r.stuffs-r.rd_loss)/Math.max(1,r.rd_snaps);  // net DL run-trench win rate
  const paRate=r=>r.pa/Math.max(1,r.pp_snaps), saRate=r=>r.sk_allowed/Math.max(1,r.pp_snaps);
  const rbNet=r=>(r.rb_win-r.rb_loss)/Math.max(1,r.rb_snaps);

  // Qualified pools
  const rushers =all.filter(r=>r.prs_snaps>=200);
  const runDef  =all.filter(r=>r.rd_snaps>=150);
  const blockers=all.filter(r=>r.pp_snaps>=200);
  const runBlk  =all.filter(r=>r.rb_snaps>=150);

  // Grades (each on its own qualified pool)
  zg(rushers,"g_prsh",[{fn:prRate,w:7},{fn:skRate,w:11},{fn:r=>r.prs_snaps,w:3}]);
  zg(runDef ,"g_rstf",[{fn:rdNet,w:14}]);
  zg(blockers,"g_ppro",[{fn:paRate,w:-13},{fn:saRate,w:-6}]);
  zg(runBlk ,"g_rblk",[{fn:rbNet,w:14}]);

  // Combined position grades (avg of available sub-grades)
  for(const r of all){ const dl=[r.g_prsh,r.g_rstf].filter(Boolean), ol=[r.g_ppro,r.g_rblk].filter(Boolean);
    r.g_dl=dl.length?Math.round(dl.reduce((a,b)=>a+b,0)/dl.length):0;
    r.g_ol=ol.length?Math.round(ol.reduce((a,b)=>a+b,0)/ol.length):0; }

  // League sanity
  let tP=0,tS=0,tW=0,tR=0; for(const r of all){tP+=r.pressures;tS+=r.prs_snaps;tW+=r.rb_win;tR+=r.rb_snaps;}
  const presRate=tS?100*tP/tS:0, rbWinRate=tR?100*tW/tR:0;

  const gs=g=>{const L=g>=90?"A+":g>=82?"A":g>=75?"B+":g>=68?"B":g>=60?"C+":g>=52?"C":g>=44?"D":"F";return String(g).padStart(2)+" "+L;};
  const L=(...a)=>console.log(...a);
  L("");
  L("═══════════════════════════════════════════════════════════════════════════");
  L("  MFF AUDIT — trench grades (pass-rush+run-stuff / pass-pro+run-block)");
  L("  ["+SEASONS+"-season round-robin, "+secs+"s]");
  L("═══════════════════════════════════════════════════════════════════════════");
  L("");
  L("  League pressure rate:     "+presRate.toFixed(1)+"%   (NFL ~33-38%)   "+(presRate>=30&&presRate<=40?"✓":"~"));
  L("  League run-block-win rate: "+rbWinRate.toFixed(1)+"%   (sanity: ~35-55%)  "+(rbWinRate>=30&&rbWinRate<=60?"✓":"~"));
  L("");
  const dlRows=all.filter(r=>r.g_dl&&r.prs_snaps>=200&&r.rd_snaps>=150);
  const olRows=all.filter(r=>r.g_ol&&r.pp_snaps>=200&&r.rb_snaps>=150);

  L("  ── TOP 15 DEFENSIVE LINEMEN (combined: pass-rush + run-stuff) ─────────────");
  L("    "+"player".padEnd(22)+"OVR  pRush  rStuf  DL    | prs% stuf% sk");
  dlRows.slice().sort((a,b)=>b.g_dl-a.g_dl).slice(0,15).forEach(r=>L(
    "    "+r.name.padEnd(22)+String(r.ovr).padEnd(5)+gs(r.g_prsh).padEnd(7)+gs(r.g_rstf).padEnd(7)+gs(r.g_dl).padEnd(6)+"| "+
    (100*prRate(r)).toFixed(0).padStart(3)+"  "+(100*stuffRate(r)).toFixed(0).padStart(3)+"   "+String(r.sk).padStart(2)));
  L("");
  L("  ── TOP 12 OFFENSIVE LINEMEN (combined: pass-pro + run-block) ──────────────");
  L("    "+"player".padEnd(22)+"OVR  pPro   rBlk   OL    | pa%  rbWin% sk-a");
  olRows.slice().sort((a,b)=>b.g_ol-a.g_ol).slice(0,12).forEach(r=>L(
    "    "+r.name.padEnd(22)+String(r.ovr).padEnd(5)+gs(r.g_ppro).padEnd(7)+gs(r.g_rblk).padEnd(7)+gs(r.g_ol).padEnd(6)+"| "+
    (100*paRate(r)).toFixed(0).padStart(3)+"  "+(100*(r.rb_win/Math.max(1,r.rb_snaps))).toFixed(0).padStart(4)+"   "+String(r.sk_allowed).padStart(3)));
  L("");
  L("  ── WORST 6 OFFENSIVE LINEMEN ──────────────────────────────────────────────");
  olRows.slice().sort((a,b)=>a.g_ol-b.g_ol).slice(0,6).forEach(r=>L(
    "    "+r.name.padEnd(22)+String(r.ovr).padEnd(5)+gs(r.g_ppro).padEnd(7)+gs(r.g_rblk).padEnd(7)+gs(r.g_ol).padEnd(6)+"| "+
    (100*paRate(r)).toFixed(0).padStart(3)+"  "+(100*(r.rb_win/Math.max(1,r.rb_snaps))).toFixed(0).padStart(4)+"   "+String(r.sk_allowed).padStart(3)));
  L("");
  L("  ── VALIDATION (grade ↔ OVR; defensible band 0.40-0.85) ────────────────────");
  const band=v=>(Math.abs(v)>=0.4&&Math.abs(v)<=0.85)?"✓":(Math.abs(v)>0.85?"⚠ high (circular?)":"⚠ low (noisy?)");
  const lines=[["pass-rush ",corr(rushers,r=>r.g_prsh,r=>r.ovr)],["run-stuff ",corr(runDef,r=>r.g_rstf,r=>r.ovr)],
               ["pass-pro  ",corr(blockers,r=>r.g_ppro,r=>r.ovr)],["run-block ",corr(runBlk,r=>r.g_rblk,r=>r.ovr)],
               ["DL combo  ",corr(dlRows,r=>r.g_dl,r=>r.ovr)],["OL combo  ",corr(olRows,r=>r.g_ol,r=>r.ovr)]];
  for(const [lab,r] of lines) L("    "+lab+" r="+r.toFixed(2)+"   "+band(r));
  L("");
})();`;
let code=shim+"\n"; for(const f of files){let c=fs.readFileSync(path.join(__dirname,f),"utf8");c=stripUiInit(c,f);code+="\n"+c+"\n";}
code+=audit; require("vm").runInThisContext(code,{filename:"_mff_audit_bundle.js"});
