// MFF audit — vertical slice #1: pass-rush / pass-protection grades.
// Runs a full round-robin season, accumulates the per-snap trench attribution
// the engine now records (pass_rush_snaps, pressures, qb_hits, sk for rushers;
// pass_pro_snaps, pressures_allowed, sacks_allowed for blockers), turns them
// into 0-99 PFF-style grades, and prints leaderboards + validation.
//
// Validation it prints: (1) league pressure rate (target NFL ~33-38%),
// (2) grade<->OVR correlation per group (must be positive but < ~0.85 or the
// grade is just re-stating OVR), (3) leaderboards with OVR for face-validity.
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

  const acc=new Map(); // name -> record
  const get=(name,pos,ovr,arch)=>{ let r=acc.get(name);
    if(!r){r={name,pos,ovr,arch,prs_snaps:0,pressures:0,qb_hits:0,sk:0,pp_snaps:0,pa:0,sk_allowed:0,grade:0};acc.set(name,r);}
    return r; };

  const t0=Date.now();
  for(let s=0;s<SEASONS;s++){
    const ros={}; const meta=new Map();
    for(const t of TEAMS){ ros[t.id]=buildRoster(t);
      for(const p of ros[t.id]) meta.set(p.name,{pos:p.position,ovr:p.overall,arch:p.archetype}); }
    for(let i=0;i<TEAMS.length;i++) for(let j=i+1;j<TEAMS.length;j++){
      const h=TEAMS[i],a=TEAMS[j];
      const sim=new GameSimulator(h,a,ros[h.id],ros[a.id]); sim.simulate();
      for(const side of ["home","away"]){ const pls=sim.stats[side].players;
        for(const n in pls){ const p=pls[n]; const m=meta.get(n); if(!m)continue;
          if((p.pass_rush_snaps||0)>0||(p.sk||0)>0){ const r=get(n,m.pos,m.ovr,m.arch);
            r.prs_snaps+=p.pass_rush_snaps||0; r.pressures+=p.pressures||0; r.qb_hits+=p.qb_hits||0; r.sk+=p.sk||0; }
          if((p.pass_pro_snaps||0)>0||(p.sacks_allowed||0)>0){ const r=get(n,m.pos,m.ovr,m.arch);
            r.pp_snaps+=p.pass_pro_snaps||0; r.pa+=p.pressures_allowed||0; r.sk_allowed+=p.sacks_allowed||0; }
        }
      }
    }
  }
  const secs=((Date.now()-t0)/1000).toFixed(0);

  const all=[...acc.values()];
  let totP=0,totS=0; for(const r of all){totP+=r.pressures;totS+=r.prs_snaps;}
  const leagueRate=totS?100*totP/totS:0;

  const mean=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
  const sd=(xs,m)=>Math.sqrt(xs.reduce((a,b)=>a+(b-m)*(b-m),0)/Math.max(1,xs.length))||1;
  const prRate=r=>r.pressures/Math.max(1,r.prs_snaps);
  const paRate=r=>r.pa/Math.max(1,r.pp_snaps);
  const saRate=r=>r.sk_allowed/Math.max(1,r.pp_snaps);
  const skRate=r=>r.sk/Math.max(1,r.prs_snaps);

  const rushers=all.filter(r=>r.prs_snaps>=200);
  const prm=mean(rushers.map(prRate)),prs_=sd(rushers.map(prRate),prm);
  const skm=mean(rushers.map(skRate)),sks_=sd(rushers.map(skRate),skm);
  // Pass-rush grade blends xPressure rate with sack rate. The engine's pressure
  // scalar doesn't use the individual rusher's rating (only team d-line + archetype
  // + pick frequency), so rate alone is a noisy individual signal; sacks ARE
  // individually credited (reps.dl gets the sk), so weighting them lifts the grade
  // toward genuine finishing ability. Volume (reps, ~overall^2-weighted picks) adds
  // a workload signal.
  const rpm=mean(rushers.map(r=>r.prs_snaps)),rps_=sd(rushers.map(r=>r.prs_snaps),rpm);
  for(const r of rushers) r.grade=Math.max(20,Math.min(99,Math.round(60+7*((prRate(r)-prm)/prs_)+11*((skRate(r)-skm)/sks_)+3*((r.prs_snaps-rpm)/rps_))));

  const blockers=all.filter(r=>r.pp_snaps>=200);
  const pam=mean(blockers.map(paRate)),pas_=sd(blockers.map(paRate),pam);
  const sam=mean(blockers.map(saRate)),sas_=sd(blockers.map(saRate),sam);
  for(const r of blockers) r.grade=Math.max(20,Math.min(99,Math.round(60-13*((paRate(r)-pam)/pas_)-6*((saRate(r)-sam)/sas_))));

  const corr=(rows,fx,fy)=>{ const xs=rows.map(fx),ys=rows.map(fy),mx=mean(xs),my=mean(ys);
    let n=0,dx=0,dy=0; for(let i=0;i<xs.length;i++){n+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}
    return n/Math.sqrt(dx*dy||1); };
  const gradeStr=g=>{const L=g>=90?"A+":g>=82?"A":g>=75?"B+":g>=68?"B":g>=60?"C+":g>=52?"C":g>=44?"D":"F";return String(g).padStart(2)+" "+L;};
  const fmtR=r=>"    "+r.name.padEnd(22)+r.pos.padEnd(4)+String(r.ovr).padEnd(5)+String(r.prs_snaps).padEnd(6)+String(Math.round(r.pressures)).padEnd(5)+(100*prRate(r)).toFixed(1).padEnd(7)+String(r.sk).padEnd(4)+String(r.qb_hits).padEnd(6)+"  "+gradeStr(r.grade);
  const fmtB=r=>"    "+r.name.padEnd(22)+r.pos.padEnd(4)+String(r.ovr).padEnd(5)+String(r.pp_snaps).padEnd(7)+String(Math.round(r.pa)).padEnd(5)+(100*paRate(r)).toFixed(1).padEnd(7)+String(r.sk_allowed).padEnd(6)+"  "+gradeStr(r.grade);
  const L=(...a)=>console.log(...a);

  L("");
  L("═══════════════════════════════════════════════════════════════════════");
  L("  MFF AUDIT — pass-rush / pass-protection slice   ["+SEASONS+"-season round-robin, "+secs+"s]");
  L("═══════════════════════════════════════════════════════════════════════");
  L("");
  L("  League pressure rate: "+leagueRate.toFixed(1)+"%   (NFL ~33-38%)   "+(leagueRate>=30&&leagueRate<=40?"✓":(leagueRate>=25?"~ close":"⚠ off")));
  L("  Qualified rushers (≥200 reps): "+rushers.length+"  ·  blockers (≥200 snaps): "+blockers.length);
  L("");
  L("  ── TOP 15 PASS RUSHERS (by pressures) ──────────────────────────────");
  L("    "+"player".padEnd(22)+"pos  OVR  reps  prs  rate%  sk  hits  GRADE");
  rushers.slice().sort((a,b)=>b.pressures-a.pressures).slice(0,15).forEach(r=>L(fmtR(r)));
  L("");
  L("  ── TOP 10 by pressure RATE (min 250 reps) ──────────────────────────");
  L("    "+"player".padEnd(22)+"pos  OVR  reps  prs  rate%  sk  hits  GRADE");
  rushers.filter(r=>r.prs_snaps>=250).sort((a,b)=>prRate(b)-prRate(a)).slice(0,10).forEach(r=>L(fmtR(r)));
  L("");
  L("  ── TOP 10 PASS BLOCKERS (lowest pressure-allowed rate) ─────────────");
  L("    "+"player".padEnd(22)+"pos  OVR  snaps  pa   rate%  sk-a  GRADE");
  blockers.slice().sort((a,b)=>paRate(a)-paRate(b)).slice(0,10).forEach(r=>L(fmtB(r)));
  L("");
  L("  ── WORST 5 PASS BLOCKERS (turnstiles) ──────────────────────────────");
  blockers.slice().sort((a,b)=>paRate(b)-paRate(a)).slice(0,5).forEach(r=>L(fmtB(r)));
  L("");
  L("  ── VALIDATION ──────────────────────────────────────────────────────");
  const rcRush=corr(rushers,r=>r.grade,r=>r.ovr), rcBlock=corr(blockers,r=>r.grade,r=>r.ovr);
  const band=v=>(Math.abs(v)>=0.4&&Math.abs(v)<=0.85)?"✓ defensible (0.4-0.85)":(Math.abs(v)>0.85?"⚠ too high (circular?)":"⚠ too low (noisy?)");
  L("    pass-rush grade ↔ OVR:  r="+rcRush.toFixed(2)+"   "+band(rcRush));
  L("    pass-pro  grade ↔ OVR:  r="+rcBlock.toFixed(2)+"   "+band(rcBlock));
  L("    (positive = talent shows; < 0.85 = grade adds info beyond raw OVR)");
  L("");
})();`;
let code=shim+"\n"; for(const f of files){let c=fs.readFileSync(path.join(__dirname,f),"utf8");c=stripUiInit(c,f);code+="\n"+c+"\n";}
code+=audit; require("vm").runInThisContext(code,{filename:"_mff_audit_bundle.js"});
