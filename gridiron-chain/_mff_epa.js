// MFF EPA layer — Expected Points Added, built entirely in post-processing over
// the engine's play log (NO engine change, lowest possible risk).
//
// Method (nflfastR-style, simplified):
//  1. Build an empirical Expected-Points model EP(down, ytg-bucket, yardline-bucket)
//     = mean signed points of the NEXT score within the same half, over many plays.
//  2. EPA(play) = EP_after - EP_before, where EP_after uses the next snap's state
//     (possession-adjusted) or the actual points if the drive scored.
//  3. Roll up to team offense/defense EPA/play, pass vs run EPA, success rate,
//     and per-QB EPA (attributed via the play log's `passer` field).
//
// Validation it prints: EP at canonical states (sanity), league pass/run EPA &
// success rate vs NFL, team-offense EPA ↔ points/game correlation, QB leaderboard.
// Dev/audit tool only — ignored by the build.   node _mff_epa.js [seasons]
const fs=require("fs"),path=require("path");
const files=["play-data.js","play-player.js","play-render.js","play-sim.js","play-motion.js","play-engine.js"];
function stripUiInit(c,f){return f!=="play-render.js"?c:c.replace(/^buildOptions\([^)]*\);\s*$/gm,"//x").replace(/^setupPreview\([^)]*\);\s*$/gm,"//x");}
const shim=`var _stub=new Proxy(function(){},{get(t,k){if(k==="style"||k==="classList"||k==="dataset")return _stub;if(k==="length")return 0;if(k===Symbol.iterator)return function*(){};return _stub;},set(){return true;},apply(){return _stub;},construct(){return _stub;}});
var document={createElement:()=>_stub,getElementById:()=>_stub,querySelector:()=>_stub,querySelectorAll:()=>[],addEventListener:()=>{},body:_stub,documentElement:_stub};
var window=(typeof globalThis!=="undefined"?globalThis:this);window.addEventListener=()=>{};
if(typeof performance==="undefined")var performance={now:()=>Date.now()};var requestAnimationFrame=()=>0;
var localStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`;

const audit=`;(function(){
  if(typeof GameSimulator==="undefined"){console.error("no GameSimulator");process.exit(1);}
  const SEASONS=Number(process.argv[2]||1);
  function buildRoster(t){return genRoster(getPlaybook(t),{},null);}
  const PASS=new Set(["complete","incomplete","sack","int"]);
  const RUN =new Set(["run","scramble"]);
  const SNAP=new Set([...PASS,...RUN]);

  // State bucketing
  const ytgB=y=>y<=3?0:y<=6?1:y<=10?2:3;                 // short/med/long/vlong
  const yardB=y=>Math.max(0,Math.min(9,Math.floor(y/10)));// own-goal(0) .. opp-goal(9)
  const keyFull=(d,y,yl)=>d+"|"+ytgB(y)+"|"+yardB(yl);
  const keyDown=(d,yl)=>d+"||"+yardB(yl);
  const keyYard=(yl)=>"||"+yardB(yl);

  // ── Pass 1: simulate, capture per-game scrimmage snaps + score events ──
  const games=[]; // {snaps:[{gi,d,y,yl,poss,half,kind,passer,off}], scores:[{gi,team,pts,half}], teamPts:{home,away}, qbOf:{home,away}}
  const teamPF={}, teamPA={}, teamPlays={}, teamEPA={}; // by team id
  const t0=Date.now();
  for(let s=0;s<SEASONS;s++){
    const ros={}, qb={}; for(const t of TEAMS){ ros[t.id]=buildRoster(t);
      // starting QB = highest-OVR QB on the roster
      const qbs=ros[t.id].filter(p=>p.position==="QB").sort((a,b)=>b.overall-a.overall); qb[t.id]=qbs[0]; }
    for(let i=0;i<TEAMS.length;i++)for(let j=i+1;j<TEAMS.length;j++){
      const H=TEAMS[i],A=TEAMS[j];
      const sim=new GameSimulator(H,A,ros[H.id],ros[A.id]); sim.simulate();
      const pl=sim.plays; let h=0,a=0; const snaps=[],scores=[];
      for(let gi=0;gi<pl.length;gi++){ const p=pl[gi];
        const nh=p.homeScore??h, na=p.awayScore??a;
        if(nh!==h||na!==a){ const team=nh>h?"home":"away", pts=Math.abs((nh-h)||(na-a)); const half=(p.quarter<=2)?1:2;
          scores.push({gi,team,pts,half}); h=nh;a=na; }
        if(SNAP.has(p.kind)&&p.down>=1&&p.down<=4&&typeof p.yardLine==="number"){
          snaps.push({gi,d:p.down,y:p.ytg||10,yl:p.yardLine,poss:p.poss,half:(p.quarter<=2)?1:2,kind:p.kind,passer:p.passer||null}); }
      }
      const offId={home:H.id,away:A.id};
      games.push({snaps,scores,offId,qbName:{home:qb[H.id]?.name,away:qb[A.id]?.name},qbOvr:{home:qb[H.id]?.overall,away:qb[A.id]?.overall}});
      teamPF[H.id]=(teamPF[H.id]||0)+sim.score.home; teamPA[H.id]=(teamPA[H.id]||0)+sim.score.away;
      teamPF[A.id]=(teamPF[A.id]||0)+sim.score.away; teamPA[A.id]=(teamPA[A.id]||0)+sim.score.home;
    }
  }

  // ── Build EP model: next score within half ──
  const acc={}; // key -> {sum,n}
  const add=(k,v)=>{ (acc[k]||(acc[k]={sum:0,n:0})); acc[k].sum+=v; acc[k].n++; };
  function nextScoreVal(g,snap){ for(const sc of g.scores){ if(sc.gi>snap.gi&&sc.half===snap.half){
        return sc.team===snap.poss? sc.pts : -sc.pts; } } return 0; }
  for(const g of games) for(const sn of g.snaps){ const v=nextScoreVal(g,sn);
    add(keyFull(sn.d,sn.y,sn.yl),v); add(keyDown(sn.d,sn.yl),v); add(keyYard(sn.yl),v); }
  const epOf=k=>acc[k]&&acc[k].n>0?acc[k].sum/acc[k].n:null;
  function EP(d,y,yl){ const a=epOf(keyFull(d,y,yl)); if(a!=null&&acc[keyFull(d,y,yl)].n>=30)return a;
    const b=epOf(keyDown(d,yl)); if(b!=null&&acc[keyDown(d,yl)].n>=30)return b;
    const c=epOf(keyYard(yl)); return c!=null?c:0; }

  // ── Pass 2: EPA per play ──
  let nPass=0,nRun=0,sumPassEPA=0,sumRunEPA=0,succP=0,succR=0;
  const qbAcc=new Map(); // name -> {ovr,epa,db,team}
  for(const g of games){ const sn=g.snaps;
    for(let i=0;i<sn.length;i++){ const c=sn[i];
      const epB=EP(c.d,c.y,c.yl);
      // score change strictly after this snap and before the next snap?
      const next=sn[i+1];
      let epA, scored=null;
      for(const sc of g.scores){ if(sc.gi>c.gi && (!next||sc.gi<=next.gi)){ scored=sc; break; } }
      if(scored){ epA = scored.team===c.poss? scored.pts : -scored.pts; }
      else if(next && next.half===c.half){ epA = next.poss===c.poss? EP(next.d,next.y,next.yl) : -EP(next.d,next.y,next.yl); }
      else epA=0;
      const epa=epA-epB;
      const off=g.offId[c.poss];
      teamEPA[off]=(teamEPA[off]||0)+epa; teamPlays[off]=(teamPlays[off]||0)+1;
      if(PASS.has(c.kind)){ nPass++; sumPassEPA+=epa; if(epa>0)succP++;
        const nm=g.qbName[c.poss]; if(nm){ let q=qbAcc.get(nm); if(!q){q={ovr:g.qbOvr[c.poss],epa:0,db:0};qbAcc.set(nm,q);} q.epa+=epa; q.db++; } }
      else { nRun++; sumRunEPA+=epa; if(epa>0)succR++; }
    }
  }
  const secs=((Date.now()-t0)/1000).toFixed(0);

  // ── Output ──
  const L=(...a)=>console.log(...a);
  L("");
  L("═══════════════════════════════════════════════════════════════════════════");
  L("  MFF EPA LAYER — expected points added   ["+SEASONS+"-season round-robin, "+secs+"s]");
  L("═══════════════════════════════════════════════════════════════════════════");
  L("");
  L("  ── EP MODEL SANITY (expected points by state) ─────────────────────────────");
  const show=(lab,d,y,yl)=>L("    "+lab.padEnd(34)+" EP = "+EP(d,y,yl).toFixed(2));
  show("1st & 10, own 25 (yl25)",1,10,25);
  show("1st & 10, midfield (yl50)",1,10,50);
  show("1st & 10, opp 25 (yl75)",1,10,75);
  show("1st & goal, opp 5 (yl95)",1,5,95);
  show("3rd & 8, own 10 (yl10)",3,8,10);
  show("4th & 2, opp 40 (yl60)",4,2,60);
  show("1st & 10, own 1 (backed up)",1,10,1);
  L("    (NFL refs: own-25 ~+0.4, midfield ~+2.0, 1st&goal-5 ~+4.5, backed-up ~-0.5)");
  L("");
  L("  ── LEAGUE EPA ─────────────────────────────────────────────────────────────");
  L("    pass EPA/play:  "+(sumPassEPA/nPass).toFixed(3)+"   (NFL ~ +0.05 to +0.15)   success "+(100*succP/nPass).toFixed(0)+"%");
  L("    run  EPA/play:  "+(sumRunEPA/nRun).toFixed(3)+"   (NFL ~ -0.05 to +0.02)   success "+(100*succR/nRun).toFixed(0)+"%");
  L("    overall success rate: "+(100*(succP+succR)/(nPass+nRun)).toFixed(0)+"%   (NFL ~45%)");
  L("    pass-run EPA gap: "+((sumPassEPA/nPass)-(sumRunEPA/nRun)).toFixed(3)+"   (passing should be more efficient)");
  L("");
  // Team offense EPA/play ↔ points/game (validation: should be strongly positive)
  const teams=TEAMS.map(t=>({id:t.id,ab:t.abbr||t.id,epaPl:(teamEPA[t.id]||0)/Math.max(1,teamPlays[t.id]||1),ppg:(teamPF[t.id]||0)/Math.max(1,(SEASONS*(TEAMS.length-1)))}));
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  const corr=(xs,ys)=>{const mx=mean(xs),my=mean(ys);let n=0,dx=0,dy=0;for(let i=0;i<xs.length;i++){n+=(xs[i]-mx)*(ys[i]-my);dx+=(xs[i]-mx)**2;dy+=(ys[i]-my)**2;}return n/Math.sqrt(dx*dy||1);};
  const rEP=corr(teams.map(t=>t.epaPl),teams.map(t=>t.ppg));
  L("  ── VALIDATION: team offensive EPA/play ↔ points/game ──────────────────────");
  L("    r = "+rEP.toFixed(2)+"   "+(rEP>=0.8?"✓ strong (EPA explains scoring)":rEP>=0.6?"✓ ok":"⚠ weak"));
  L("");
  L("  ── TOP 12 QBs by EPA/dropback (min "+(30*SEASONS)+" dropbacks) ──────────────────────");
  L("    "+"QB".padEnd(22)+"OVR  dropbacks  totEPA   EPA/db");
  const qbs=[...qbAcc.entries()].map(([nm,q])=>({nm,...q})).filter(q=>q.db>=30*SEASONS).sort((a,b)=>b.epa/b.db-a.epa/a.db);
  qbs.slice(0,12).forEach(q=>L("    "+q.nm.padEnd(22)+String(q.ovr).padEnd(5)+String(q.db).padEnd(11)+q.epa.toFixed(1).padStart(7)+"   "+(q.epa/q.db).toFixed(3).padStart(7)));
  L("");
  L("    QB EPA/db ↔ OVR:  r = "+corr(qbs.map(q=>q.epa/q.db),qbs.map(q=>q.ovr)).toFixed(2)+"   (should be positive, < ~0.9)");
  L("");
})();`;
let code=shim+"\n"; for(const f of files){let c=fs.readFileSync(path.join(__dirname,f),"utf8");c=stripUiInit(c,f);code+="\n"+c+"\n";}
code+=audit; require("vm").runInThisContext(code,{filename:"_mff_epa_bundle.js"});
