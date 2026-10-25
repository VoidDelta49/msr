// The island: terrain, roads, town, props, collision grid, minimap image, parking lot.
// (Philippine-flavoured, not a real place.) Built once at load; physics reads H() and OBBS.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PI, clamp, sstep, fbm, rand, hash2 } from './util.js';
import { scene, ctex, std, aoGeo, ANISO, GPU } from './renderer.js';
import { cfg, Q, BUILD } from './config.js';
import { attribute, texture, uv, vec2, vec3, float, select } from 'three/tsl';
import { gpuInst, finishGpuInst } from './gpucull.js';
import * as T from './tex.js';
import { glowMat, lampMat, poolMat, haloMat, POOL_GEO, HALO_GEO } from './lights.js';
import { mkTex } from './tex.js';
import { DRAW, FAR, freeze, cullFar, addLOD, liteMaterials, mergeByMaterial } from './perf.js';

// N64-style textures (tex.js): tiny, dithered, bilinear. Tiling scale ~ what the old 256 px speck textures had.
const tAsph=mkTex(T.asphalt()),tCon=mkTex(T.concrete());
// The island layout (coast, terrain features, river, roads, town blocks, parked vehicles, prop counts) lives in
// data/map/island.json, so a map editor only has to edit that file. This module turns it into terrain, roads and props.
// Buildings: placed houses / huts / shophouses and the movable landmarks (church, plaza, market, gas, lot) are in the file too.
// Map source: ?map=local = the map maker's test map (localStorage, maker/ "Test ride"); ?map=<name> = data/map/<name>.json;
// default island.json. Multiplayer players should be on the same map (ghosts are placed by coordinates).
const MQ=new URLSearchParams(location.search).get('map')||'',MLOC=MQ==='local'&&(()=>{try{return localStorage.getItem('cpm.map.test')}catch(e){return null}})();
export const MAPSRC=MLOC?'local':/^[\w-]+$/.test(MQ)?MQ:'island';
export const MD=MLOC?JSON.parse(MLOC):await (await fetch(`data/map/${MAPSRC}.json?v=`+BUILD)).json();
const SEA=MD.sea,ICX=MD.island.cx,ICZ=MD.island.cz,CR=MD.island.coast,CN=CR.length;
// shoreline radius: periodic Catmull-Rom through the coast samples (sample 0 at +x, turning towards +z)
function coastR(th){const f=(((th/(2*PI))%1)+1)%1*CN,i=Math.floor(f),t=f-i,g=k=>CR[((k%CN)+CN)%CN],a=g(i-1),b=g(i),c=g(i+1),d=g(i+2);
  return .5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t*t+(-a+3*b-3*c+d)*t*t*t)}
// Extra islands (island.json 'islands': [{pts:[[x,z],...]}]): closed Catmull-Rom outlines; land = signed distance to the
// outline (+ inside). inland() takes the larger of the main coast and any island, so beaches, hills and sea depth follow.
function loopS(P,st){const n=P.length,out=[];for(let i=0;i<n;i++){const p0=P[(i-1+n)%n],p1=P[i],p2=P[(i+1)%n],p3=P[(i+2)%n],k=Math.max(1,Math.round(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/st));
  for(let j=0;j<k;j++){const t=j/k,t2=t*t,t3=t2*t,f=(a,b,c,d)=>.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);out.push([f(p0[0],p1[0],p2[0],p3[0]),f(p0[1],p1[1],p2[1],p3[1])])}}return out}
const ISL=(MD.islands||[]).filter(o=>o.pts&&o.pts.length>2).map(o=>{const S=loopS(o.pts,8),xs=S.map(p=>p[0]),zs=S.map(p=>p[1]);let per=0;for(let i=0;i<S.length;i++)per+=Math.hypot(S[i][0]-S[(i+1)%S.length][0],S[i][1]-S[(i+1)%S.length][1]);
  return{S,per,cx:xs.reduce((a,b)=>a+b)/S.length,cz:zs.reduce((a,b)=>a+b)/S.length,x0:Math.min(...xs),x1:Math.max(...xs),z0:Math.min(...zs),z1:Math.max(...zs),R:Math.max(...S.map(p=>Math.hypot(p[0]-ICX,p[1]-ICZ)))+40}});
function islD(x,z,S){let d=1e18,ins=false;for(let i=0,j=S.length-1;i<S.length;j=i++){const[ax,az]=S[j],[bx,bz]=S[i];if((az>z)!==(bz>z)&&x<(bx-ax)*(z-az)/(bz-az)+ax)ins=!ins;
  const ex=bx-ax,ez=bz-az,t=clamp(((x-ax)*ex+(z-az)*ez)/(ex*ex+ez*ez||1),0,1),dx=ax+ex*t-x,dz=az+ez*t-z,q=dx*dx+dz*dz;if(q<d)d=q}return ins?Math.sqrt(d):-Math.sqrt(d)}
const inland=(x,z)=>{let v=coastR(Math.atan2(z-ICZ,x-ICX))-Math.hypot(x-ICX,z-ICZ);for(const I of ISL)if(x>I.x0-220&&x<I.x1+220&&z>I.z0-220&&z<I.z1+220){const d=islD(x,z,I.S);if(d>v)v=d}return v};
const rectD=(x,z,hx,hz,cx=0,cz=0)=>Math.hypot(Math.max(Math.abs(x-cx)-hx,0),Math.max(Math.abs(z-cz)-hz,0));
const rd=(x,z,r,pad=0)=>rectD(x,z,(r.x1-r.x0)/2+pad,(r.z1-r.z0)/2+pad,(r.x0+r.x1)/2,(r.z0+r.z1)/2); // distance to a {x0,z0,x1,z1} rect
const TOWN=MD.town,PADDY=MD.paddy,FEAT=MD.features,HL=MD.hills,PROPS=MD.props;
const VOL=FEAT.find(f=>f.type==='volcano')||{x:1e6,z:1e6,h:0,r:1,crater:0,craterR:1},TERR=FEAT.find(f=>f.type==='terraces')||{x:1e6,z:1e6,r:0};
for(const f of FEAT)if(f.type==='ridge'){const p=f.pts;f.bb=[Math.min(...p.map(q=>q[0]))-3*f.w,Math.max(...p.map(q=>q[0]))+3*f.w,Math.min(...p.map(q=>q[1]))-3*f.w,Math.max(...p.map(q=>q[1]))+3*f.w]}
// distance to a polyline; PD.h = the 3rd coordinate (if any) interpolated at the nearest point (ridge crest heights)
const PD={d:0,h:0};
function polyD(x,z,P){let bd=1e18,bh=0;for(let i=1;i<P.length;i++){const[ax,az,ah=0]=P[i-1],[bx,bz,bh2=0]=P[i],ex=bx-ax,ez=bz-az,t=clamp(((x-ax)*ex+(z-az)*ez)/(ex*ex+ez*ez),0,1),dx=ax+ex*t-x,dz=az+ez*t-z,d=dx*dx+dz*dz;if(d<bd){bd=d;bh=ah+(bh2-ah)*t}}PD.d=Math.sqrt(bd);PD.h=bh;return PD}
// Terrain = coast profile + rolling hills inland, then each feature in file order:
//  volcano {x,z,h,r,crater,craterR} · terraces {x,z,r,h,step} (stepped rice terraces) · ridge {pts:[[x,z,crest h]...],w}
//  (a mountain range along a polyline, crest height per point, gaussian cross-section of half-width w) · flat {x0,z0,x1,z1,h,blend} (levelled to height h,
//  blending back over 'blend' metres: town, paddies, airstrip).
function terrBase(x,z){
  const inl=inland(x,z);
  let h=inl>0?SEA+.2+Math.min(inl,60)*.045:Math.max(-10,SEA-.2+inl*.06);
  const hl=sstep(HL.inl0,HL.inl1,inl);h+=(fbm(x*HL.scale+7,z*HL.scale)*HL.amp+HL.off)*hl;if(inl>60)h=Math.max(h,SEA+3); // hollows in the hills would fill with sea water (the sea plane is everywhere)
  for(const f of FEAT){const t=f.type;
    if(t==='volcano'){const dv=Math.hypot(x-f.x,z-f.z);h+=f.h*Math.exp(-Math.pow(dv/f.r,1.8))-f.crater*Math.exp(-((dv/f.craterR)**2))}
    else if(t==='terraces'){const dt=Math.hypot(x-f.x,z-f.z);if(dt<f.r+260){/* was r+40: the hill gaussian ended in a 2.5 m step on a circle */h+=f.h*Math.exp(-((dt/100)**2));const w=1-sstep(f.r-40,f.r,dt),q=h/f.step,fr=q-Math.floor(q);h+=((Math.floor(q)+sstep(.7,1,fr))*f.step-h)*w*.85}}
    else if(t==='ridge'){if(x>f.bb[0]&&x<f.bb[1]&&z>f.bb[2]&&z<f.bb[3]){const p=polyD(x,z,f.pts);h+=p.h*Math.exp(-((p.d/f.w)**2))*sstep(0,80,inl)*(1+.18*(fbm(x*.02+3,z*.02)-.5))}}
    else if(t==='flat'){const w=1-sstep(0,f.blend,rd(x,z,f));if(w>0)h+=(f.h-h)*w}}
  return h}
const RIVER=MD.river.pts,RW0=MD.river.w0,RW1=MD.river.w1;
const RLEN=[0];for(let i=1;i<RIVER.length;i++)RLEN.push(RLEN[i-1]+Math.hypot(RIVER[i][0]-RIVER[i-1][0],RIVER[i][1]-RIVER[i-1][1]));
const RB=[Math.min(...RIVER.map(p=>p[0]))-RW1-12,Math.max(...RIVER.map(p=>p[0]))+RW1+12,Math.min(...RIVER.map(p=>p[1]))-RW1-12,Math.max(...RIVER.map(p=>p[1]))+RW1+12];
let lastCarve=0;
function riverAmt(x,z){if(x<RB[0]||x>RB[1]||z<RB[2]||z>RB[3])return 0;let bd=1e9,bs=0;for(let i=1;i<RIVER.length;i++){const[ax,az]=RIVER[i-1],[bx,bz]=RIVER[i],ex=bx-ax,ez=bz-az,l2=ex*ex+ez*ez,t=clamp(((x-ax)*ex+(z-az)*ez)/l2,0,1),dx=ax+ex*t-x,dz=az+ez*t-z,d=dx*dx+dz*dz;if(d<bd){bd=d;bs=(RLEN[i-1]+t*Math.sqrt(l2))/RLEN[RLEN.length-1]}}
  return(1-sstep(RW0,RW1,Math.sqrt(bd)))*sstep(0,.15,bs)}
function terr(x,z){const h=terrBase(x,z);lastCarve=riverAmt(x,z);return h+(SEA-1.4-h)*lastCarve}

/* Buildings (island.json 'buildings': [type, x, z, ry, ...]): house [.., w, d], nipa, shop [.., w, d, floors 1-3] anywhere;
   landmarks church / plaza / market / gas / lot keep their hand-built code, drawn in a frame moved from its original spot
   LMO to (x, z) and turned by ry (front = (sin ry, cos ry), like shops). The ground under a landmark is levelled to the
   terrain height at its centre (an extra flat feature). Maps without 'buildings' get the original five; there is always a lot. */
const BLD=MD.buildings||[['church',128,62,0],['plaza',118,28,0],['market',120,-40,0],['gas',-40,40,0],['lot',40,40,0]];
const LMO={church:[128,62],plaza:[118,28],market:[120,-40],gas:[-40,40],lot:[40,40]},LMH={church:[13,15],plaza:[31,20],market:[25,28],gas:[20,20],lot:[35,35]};
const LMB=BLD.filter(b=>LMO[b[0]]);if(!LMB.some(b=>b[0]==='lot'))LMB.push(['lot',40,40,0]);
function frame(b){const t=b[0],[OX,OZ]=LMO[t],x=b[1],z=b[2],ry=b[3]||0,c=Math.cos(ry),s=Math.sin(ry),W=(X,Z)=>{const a=X-OX,d=Z-OZ;return{x:x+a*c+d*s,z:z-a*s+d*c}};
  return{t,x,z,ry,y:0,W,obb:(X,Z,hx,hz,r=0)=>{const m=W(X,Z);addOBB(m.x,m.z,hx,hz,r+ry)},box:(x0,z0,x1,z1)=>{const m=W((x0+x1)/2,(z0+z1)/2);addOBB(m.x,m.z,(x1-x0)/2,(z1-z0)/2,ry)},
    loc:(X,Z)=>{const dx=X-x,dz=Z-z;return[dx*c-dz*s,dx*s+dz*c]}}}
const LMF={church:[],plaza:[],market:[],gas:[],lot:[]};
for(const b of LMB){const F=frame(b),[hx,hz]=LMH[F.t],ex=Math.abs(hx*Math.cos(F.ry))+Math.abs(hz*Math.sin(F.ry))+4,ez=Math.abs(hx*Math.sin(F.ry))+Math.abs(hz*Math.cos(F.ry))+4;
  F.y=terrBase(F.x,F.z);FEAT.push({type:'flat',x0:F.x-ex,z0:F.z-ez,x1:F.x+ex,z1:F.z+ez,h:F.y,blend:30});LMF[F.t].push(F)}
const nearLM=(x,z)=>[...LMF.lot,...LMF.gas].some(F=>{const[a,d]=F.loc(x,z),h=F.t==='lot'?30:22;return Math.hypot(Math.max(Math.abs(a)-h,0),Math.max(Math.abs(d)-h,0))<=2});
const atGas=(x,z)=>LMF.gas.some(F=>{const[a,d]=F.loc(x,z);return Math.abs(a)<6&&Math.abs(d)<3.5});
const GEN=[]; // roadside houses the generator placed this load (map maker bakes them into 'buildings')
/* roads: Catmull-Rom splines, heights smoothed from the terrain and grade-limited.
   island.json road = {pts, w, hwy?, closed?, kind?}; kind 'strip' = airstrip (concrete, runway markings, no poles/houses) */
const ROADS=MD.roads.map(r=>({pts:r.pts,w:r.w,closed:!!r.closed,hwy:!!r.hwy,kind:r.kind||'',grade:r.grade})),SEGG=new Map(),BUMPS=[];
function crSample(r){const P=r.pts,n=P.length,out=[];const get=i=>r.closed?P[(i+n)%n]:P[clamp(i,0,n-1)];
  for(let i=0;i<(r.closed?n:n-1);i++){const p0=get(i-1),p1=get(i),p2=get(i+1),p3=get(i+2),L=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]),k=Math.max(1,Math.round(L/2));
    for(let j=0;j<k;j++){const t=j/k,t2=t*t,t3=t2*t,f=(a,b,c,d)=>.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);out.push([f(p0[0],p1[0],p2[0],p3[0]),f(p0[1],p1[1],p2[1],p3[1])])}}
  out.push(r.closed?out[0]:P[n-1]);return out}
for(const r of ROADS){const S=crSample(r);let h=S.map(([x,z])=>terrBase(x,z));
  for(let pass=0;pass<3;pass++){const a=h.slice();for(let i=0;i<h.length;i++){let s=0,c=0;for(let j=-12;j<=12;j++){const k=i+j;if(k>=0&&k<h.length){s+=a[k];c++}}h[i]=s/c}}
  const G=r.grade||.13,dl=i=>Math.hypot(S[i][0]-S[i-1][0],S[i][1]-S[i-1][1]); // max grade per metre (was .26 per sample, so short samples in hairpins allowed 35%)
  for(let i=1;i<h.length;i++){const g=G*dl(i);h[i]=clamp(h[i],h[i-1]-g,h[i-1]+g)}for(let i=h.length-2;i>=0;i--){const g=G*dl(i+1);h[i]=clamp(h[i],h[i+1]-g,h[i+1]+g)}
  r.s=S.map(([x,z],i)=>({x,z,h:Math.max(h[i],.05)}));r.G=G}
// Junctions: a road that ends on another road takes that road's height at its end and eases away from it at its own
// grade limit (each road is smoothed on its own, so a branch used to meet its parent with a step: 39 cm at the terrace
// road, 19 m where the pass met it).
for(const r of ROADS){if(r.closed)continue;for(const e of[0,r.s.length-1]){const E=r.s[e];let bd=1e9,bh=0;
  for(const o of ROADS){if(o===r)continue;for(const q of o.s){const d=Math.hypot(q.x-E.x,q.z-E.z);if(d<bd&&d<o.w/2+2){bd=d;bh=q.h}}}
  if(bd===1e9)continue;E.h=bh;const dir=e===0?1:-1;
  for(let i=e+dir;i>=0&&i<r.s.length;i+=dir){const A=r.s[i-dir],B=r.s[i],g=r.G*Math.hypot(B.x-A.x,B.z-A.z),c=clamp(B.h,A.h-g,A.h+g);if(c===B.h)break;B.h=c}}}
for(const r of ROADS){
  for(let i=0;i<r.s.length;i++){const a=r.s[Math.max(0,i-1)],b=r.s[Math.min(r.s.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1;r.s[i].tx=(b.x-a.x)/l;r.s[i].tz=(b.z-a.z)/l}
  for(let i=1;i<r.s.length;i++){const A=r.s[i-1],B=r.s[i],sg={ax:A.x,az:A.z,bx:B.x,bz:B.z,ha:A.h,hb:B.h,w:r.w,l2:Math.max(1e-6,(B.x-A.x)**2+(B.z-A.z)**2)},m=r.w/2+9;
    for(let gx=Math.floor((Math.min(A.x,B.x)-m)/20);gx<=Math.floor((Math.max(A.x,B.x)+m)/20);gx++)for(let gz=Math.floor((Math.min(A.z,B.z)-m)/20);gz<=Math.floor((Math.max(A.z,B.z)+m)/20);gz++){const k=gx*1000+gz;if(!SEGG.has(k))SEGG.set(k,[]);SEGG.get(k).push(sg)}}}
for(const[x,z,ax]of MD.bumps)BUMPS.push({x,z,ax});
const NR={d:0,h:0,w:0};
function nearRoad(x,z){const L=SEGG.get(Math.floor(x/20)*1000+Math.floor(z/20));if(!L)return null;let bd=1e18,bh=0,bw=0;
  for(const s of L){const ex=s.bx-s.ax,ez=s.bz-s.az,t=clamp(((x-s.ax)*ex+(z-s.az)*ez)/s.l2,0,1),px=s.ax+ex*t-x,pz=s.az+ez*t-z,d=px*px+pz*pz;if(d<bd){bd=d;bh=s.ha+(s.hb-s.ha)*t;bw=s.w}}
  NR.d=Math.sqrt(bd);NR.h=bh;NR.w=bw;return NR}
function bumpAt(x,z){for(const b of BUMPS){const al=b.ax==='z'?z-b.z:x-b.x,cr=b.ax==='z'?x-b.x:z-b.z;if(Math.abs(al)<.35&&Math.abs(cr)<3.6)return .075*(1+Math.cos(PI*al/.35))/2}return 0}
function HA(x,z,mesh){const t=terr(x,z),q=nearRoad(x,z);if(!q)return t;const hw=q.w/2;
  if(q.d<hw)return mesh?q.h-.25:q.h+bumpAt(x,z);if(lastCarve>.25)return t;
  const b=sstep(hw,hw+8,q.d);return q.h-.05+(t-q.h+.05)*b}
// Ground the bike stands on = what is drawn: road ribbons (analytic) or the 5 m terrain mesh, interpolated per
// triangle exactly like the PlaneGeometry. (The analytic terrain has detail and shoulder curves the mesh can't show.)
// Map size follows the coast: the terrain grid is centred on the island and covers its widest radius + 80 m of sea,
// rounded up to whole tiles. Terrain tiles, LOD, road chunks, prop culling and physics heights all derive from it.
const CMAX=Math.max(...CR),EXT=Math.max(CMAX,...ISL.map(I=>I.R)),TS=5,TILE=280,TSZ=Math.ceil((2*EXT+160)/TILE)*TILE,TN=TSZ/TS,GX=Math.round(ICX/TS)*TS,GZ=Math.round(ICZ/TS)*TS;let MH=null;
function meshH(x,z){const fx=(x-GX+TSZ/2)/TS,fz=(z-GZ+TSZ/2)/TS,ix=Math.floor(fx),iz=Math.floor(fz);if(ix<0||iz<0||ix>=TN||iz>=TN)return HA(x,z);
  const u=fx-ix,v=fz-iz,W=TN+1,a=MH[ix+W*iz],b=MH[ix+W*(iz+1)],c=MH[ix+1+W*(iz+1)],d=MH[ix+1+W*iz];
  return u+v<=1?a+(d-a)*u+(b-a)*v:c+(b-c)*(1-u)+(d-c)*(1-v)}
// Next to a road the mesh is pulled down under the ribbon, which would make every road edge a ~10 cm kerb; there the
// smooth shoulder is used instead, but never below the mesh (so the bike can't sink into the grass).
function H(x,z,mesh){if(mesh||!MH)return HA(x,z,mesh);const q=nearRoad(x,z);if(q&&q.d<q.w/2)return q.h+bumpAt(x,z);const m=meshH(x,z);
  if(q&&q.d<q.w/2+6){return Math.max(m,HA(x,z))}return m}
const roadH=(x,z)=>H(x,z);
// Lowest / highest DRAWN ground under a footprint (centre, corners, edge midpoints). Props are placed on this, not on
// terr(): the analytic terrain has detail the 5 m mesh can't show and ignores the road cuts/fills, so props placed on it
// floated (trees up to 53 m beside cut roads) or sank. Build 8.5.
const FP={lo:0,hi:0};
function foot(x,z,hx,hz,ry=0){const c=Math.cos(ry),s=Math.sin(ry);let lo=1e9,hi=-1e9;
  for(const[a,b]of[[0,0],[-hx,-hz],[hx,-hz],[-hx,hz],[hx,hz],[0,-hz],[0,hz],[-hx,0],[hx,0]]){const h=H(x+a*c+b*s,z-a*s+b*c);if(h<lo)lo=h;if(h>hi)hi=h}
  FP.lo=lo;FP.hi=hi;return FP}

/* collision footprints: oriented boxes (Rapier makes colliders from these) */
const OBBS=[];
function addOBB(cx,cz,hx,hz,ry=0){const b={cx,cz,hx,hz,ry,c:Math.cos(ry),s:-Math.sin(ry)};OBBS.push(b)}
function addBox(x0,z0,x1,z1){addOBB((x0+x1)/2,(z0+z1)/2,(x1-x0)/2,(z1-z0)/2)}
const dummy=new THREE.Object3D(),CELL=700; // CELL: power-wire chunk size
// Instanced props, split into static 700 m chunks (one InstancedMesh per type per chunk). Buffers never change after
// load; three frustum-culls each chunk exactly (main + shadow pass) and perf.js hides chunks past their draw distance.
const CHUNK=700;
// WebGPU + Options > GPU culling: per-instance culling in a compute pass instead (gpucull.js). Tiny lists and flat
// decals stay here.
const GCULL=GPU&&cfg.gpuCull!==false;
function inst(geo,mat,list,shadow=true,far=FAR.big){
  if(GCULL&&list.length>=8&&!mat.transparent){geo.computeBoundingBox();const b=geo.boundingBox;if(b.max.y-b.min.y>.05){gpuInst(geo,mat,list,shadow,Math.min(far,DRAW));return}}
  const mkI=(L,m,cs)=>{const o=new THREE.InstancedMesh(geo,m,L.length);
    L.forEach((o2,i)=>{dummy.position.set(o2.x,o2.y||0,o2.z);dummy.rotation.set(0,o2.ry||0,0);dummy.scale.set(o2.sx||1,o2.sy||1,o2.sz||1);dummy.updateMatrix();o.setMatrixAt(i,dummy.matrix);if(cs&&o2.c!==undefined)o.setColorAt(i,new THREE.Color(o2.c))});
    o.computeBoundingSphere();freeze(o);scene.add(o);return o};
  const cells=(sz)=>{const M=new Map();for(const o of list){const k=Math.floor(o.x/sz)*1000+Math.floor(o.z/sz);let a=M.get(k);if(!a)M.set(k,a=[]);a.push(o)}return M.values()};
  // Shadows (Build 8.3): a 700 m chunk's bounding sphere always touches the ±28 m shadow camera, so every caster in it
  // was drawn into the shadow map. Casters get their own 140 m chunks on layer 1 (only the shadow camera sees it, the
  // same trick as the old bike proxy), so the shadow pass draws only the few chunks around the bike.
  const sh=shadow&&Q.shadow>0;
  for(const L of cells(CHUNK)){const m=mkI(L,mat,true);m.castShadow=false;m.receiveShadow=true;cullFar(m,far)}
  if(sh)for(const L of cells(SHCH)){const m=mkI(L,SHM,false);m.castShadow=true;m.receiveShadow=false;m.layers.set(1)}}
const SHCH=140,SHM=new THREE.MeshBasicMaterial();
// Two prop parts placed by the same list (palm trunk + fronds, tree trunk + crown, jeepney body + wheels, nipa hut +
// roof) become ONE instanced type: merged geometry, and one material that keeps each part's own texture (picked per
// vertex by 'tsel'), base colour (baked into the vertex colours), roughness and metalness. Halves those types' draws.
// a/b = {g, m}; b's geometry must already be in a's instance space.
function pair(a,b){
  const pre=(o,k)=>{let g=o.g.clone();const n=g.attributes.position.count,c=new Float32Array(n*3),bc=o.m.color,vc=o.m.vertexColors&&g.attributes.color;
    for(let i=0;i<n;i++){const f=vc?vc.getX(i):1;c[i*3]=bc.r*f;c[i*3+1]=bc.g*(vc?vc.getY(i):1);c[i*3+2]=bc.b*(vc?vc.getZ(i):1)}
    g.setAttribute('color',new THREE.BufferAttribute(c,3));g.setAttribute('tsel',new THREE.BufferAttribute(new Float32Array(n).fill(k),1));
    for(const a2 of Object.keys(g.attributes))if(!['position','normal','uv','color','tsel'].includes(a2))g.deleteAttribute(a2);return g};
  let ga=pre(a,0),gb=pre(b,1);if(!ga.index||!gb.index){if(ga.index)ga=ga.toNonIndexed();if(gb.index)gb=gb.toNonIndexed()}
  const geo=mergeGeometries([ga,gb]),t=attribute('tsel','float').greaterThan(.5),u=uv();
  const tx=m=>m.map?texture(m.map,u.mul(vec2(m.map.repeat.x,m.map.repeat.y))).rgb:vec3(1);
  const mat=Q.lite?new THREE.MeshLambertNodeMaterial({vertexColors:true}):new THREE.MeshStandardNodeMaterial({vertexColors:true});
  mat.colorNode=select(t,tx(b.m),tx(a.m));if(!Q.lite){mat.roughnessNode=select(t,float(b.m.roughness),float(a.m.roughness));mat.metalnessNode=select(t,float(b.m.metalness),float(a.m.metalness))}
  return[geo,mat]}
function prism(w,h,len){const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,h);s.lineTo(-w/2,0);return new THREE.ExtrudeGeometry(s,{depth:len,bevelEnabled:false}).translate(0,0,-len/2)}
const pastel=()=>new THREE.Color().setHSL(rand(),.35+rand()*.3,.62+rand()*.18);
const TIN=[0xa8492f,0x2f5f9a,0x3d7a4a,0xb9bcc0,0x8a2f2f,0xc96f2a];
const tDet=mkTex(T.detail(),260,{aniso:ANISO});
const tRoad=mkTex(T.roadSt(),0,{aniso:ANISO}),tHwy=mkTex(T.roadHwy(),0,{aniso:ANISO});
const WC=[1,2,3].map(n=>T.walls(n)),tW=WC.map(c=>mkTex(c)),tWG=WC.map(c=>mkTex(c.glow)),tTin=mkTex(T.tin()),tBark=mkTex(T.bark()),tFrond=mkTex(T.frond()),tLeaf=mkTex(T.leaves()),tJeep=mkTex(T.jeep());
// materials for AO'd instanced geometry (vertexColors = the baked gradient; instance colour still tints)
const vstd=(c,r=.6,mt=0,map)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:mt,map:map||null,vertexColors:true});
{
  // terrain mesh with vertex colours
  const N=TN,SZ=TSZ,geo=new THREE.PlaneGeometry(SZ,SZ,N,N).rotateX(-PI/2).translate(GX,0,GZ),pos=geo.attributes.position,col=new Float32Array(pos.count*3),c=new THREE.Color();
  const C={sand:new THREE.Color(0xe2d2a2),grass:new THREE.Color(0x76a845),grass2:new THREE.Color(0x5e9438),forest:new THREE.Color(0x3d6b2c),rock:new THREE.Color(0x7c746a),ash:new THREE.Color(0x55504c),town:new THREE.Color(0xb3a98f),rice:new THREE.Color(0x9fd24a),rice2:new THREE.Color(0x7dbf3c),bed:new THREE.Color(0x8a7a5a),dry:new THREE.Color(0xa3ab4e),dirt:new THREE.Color(0x9c8a5e),wet:new THREE.Color(0xb8a57a)};
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=H(x,z,true),inl=inland(x,z);pos.setY(i,h);
    const dv=Math.hypot(x-VOL.x,z-VOL.z),dt=Math.hypot(x-TERR.x,z-TERR.z),n=fbm(x*.03,z*.03);
    if(lastCarve>.4)c.copy(C.bed);
    else if(h<SEA+1.3&&inl<90)c.copy(C.sand);
    else if(rd(x,z,TOWN,10)<1)c.copy(C.town).lerp(C.grass,n*.35);
    else if(dt<TERR.r-30)c.copy((Math.floor(h/2.4)&1)?C.rice:C.rice2);
    else if(h>115||dv<45)c.copy(dv<30?C.ash:C.rock).lerp(C.forest,sstep(140,110,h)*.5);
    else if(h>14)c.copy(C.forest).lerp(C.grass2,n*.5);
    else c.copy(C.grass).lerp(C.grass2,n);
    if(h>SEA+1.3&&h<60&&lastCarve<.4){const dp=sstep(.55,.75,fbm(x*.008+3,z*.008));c.lerp(C.dry,dp*.6)} // sun-dried grass patches
    if(h<SEA+.7&&inl<90)c.lerp(C.wet,.5); // wet sand at the waterline
    const q=nearRoad(x,z);if(q&&lastCarve<.4){const k=1-sstep(q.w/2,q.w/2+2.6,q.d);if(k>0)c.lerp(C.dirt,k*.65)} // worn dirt shoulders
    col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b}
  MH=new Float32Array(pos.count);for(let i=0;i<pos.count;i++)MH[i]=pos.getY(i);
  // baked AO: valleys and gullies (lower than the ground ~10 m around) darker, ridges a touch brighter
  {const W=N+1,ao=new Float32Array(pos.count);for(let j=0;j<W;j++)for(let i=0;i<W;i++){const k=i+W*j;let s=0,c=0;for(const[a,b]of[[-2,0],[2,0],[0,-2],[0,2],[-2,-2],[2,2],[-2,2],[2,-2]]){const ii=i+a,jj=j+b;if(ii>=0&&jj>=0&&ii<W&&jj<W){s+=MH[ii+W*jj];c++}}
    ao[k]=clamp(1-(s/c-MH[k])*.07,.7,1.08)}for(let i=0;i<pos.count;i++){col[i*3]*=ao[i];col[i*3+1]*=ao[i];col[i*3+2]*=ao[i]}}
  geo.computeVertexNormals();
  // Drawn as 7x7 tiles of 200 m (frustum-culled), each at 3 detail levels (5/10/20 m grid) picked by distance.
  // Coarse levels sample the full-res vertices (same heights, colours, normals, uvs), and every tile hangs a skirt
  // down from its edges so the cracks between neighbours at different levels are never see-through.
  const P=pos.array,NM=geo.attributes.normal.array,UV=geo.attributes.uv.array,W=N+1,TT=TILE/TS,tmat=new THREE.MeshStandardMaterial({vertexColors:true,map:tDet,roughness:.95});
  function tile(i0,j0,st){const n=TT/st,V=n+1,p=[],cc=[],nr=[],uv=[],ix=[];
    const put=(gi,gj,dy)=>{const k=gi+W*gj;p.push(P[k*3],P[k*3+1]-dy,P[k*3+2]);cc.push(col[k*3],col[k*3+1],col[k*3+2]);nr.push(NM[k*3],NM[k*3+1],NM[k*3+2]);uv.push(UV[k*2],UV[k*2+1])};
    for(let j=0;j<=n;j++)for(let i=0;i<=n;i++)put(i0+i*st,j0+j*st,0);
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){const a=i+V*j,b=i+V*(j+1),c2=i+1+V*(j+1),d=i+1+V*j;ix.push(a,b,d,b,c2,d)}
    const drop=2+st*2;
    for(const[ai,aj,di,dj]of[[0,0,1,0],[n,0,0,1],[n,n,-1,0],[0,n,0,-1]])for(let k=0;k<n;k++){const i1=ai+di*k,j1=aj+dj*k,i2=i1+di,j2=j1+dj,v=p.length/3;
      put(i0+i2*st,j0+j2*st,drop);put(i0+i1*st,j0+j1*st,drop);const a=i1+V*j1,b=i2+V*j2;ix.push(a,b,v,a,v,v+1,a,v,b,a,v+1,v)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(nr,3));
    g.setAttribute('color',new THREE.Float32BufferAttribute(cc,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(ix);
    const m=new THREE.Mesh(g,tmat);m.receiveShadow=true;freeze(m);scene.add(m);return m}
  for(let tj=0;tj<N/TT;tj++)for(let ti=0;ti<N/TT;ti++){const x0=ti*TT*TS-SZ/2+GX,z0=tj*TT*TS-SZ/2+GZ;addLOD([1,2,4].map(st=>tile(ti*TT,tj*TT,st)),x0,z0,x0+TT*TS,z0+TT*TS)}
  geo.dispose();
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(8000,8000).rotateX(-PI/2),new THREE.MeshStandardMaterial({color:0x2a88a6,map:mkTex(T.sea(),400),roughness:.2,metalness:.15,transparent:true,opacity:.9}));sea.position.y=SEA;scene.add(freeze(sea));
  // rice paddies: patchwork texture with dikes
  for(let k=0;k<80;k++)rand(); // the old paddy texture drew 80 rand() values; keep the island layout identical
  const tPad=mkTex(T.paddy());
  const pd=new THREE.Mesh(new THREE.PlaneGeometry(PADDY.x1-PADDY.x0,PADDY.z1-PADDY.z0).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tPad,roughness:.6}));pd.position.set((PADDY.x0+PADDY.x1)/2,.63,(PADDY.z0+PADDY.z1)/2);pd.receiveShadow=true;scene.add(freeze(pd));
  // road ribbons
  const rb={hwy:{p:[],u:[],i:[]},st:{p:[],u:[],i:[]},strip:{p:[],u:[],i:[]}},rwy=[],rail=[],deck=[],pil=[],poles=[],wires=[];
  for(const r of ROADS){const SR=r.kind==='strip',B=SR?rb.strip:r.hwy?rb.hwy:rb.st,base=B.p.length/3;let L=0;
    r.s.forEach((s,i)=>{if(i)L+=Math.hypot(s.x-r.s[i-1].x,s.z-r.s[i-1].z);const nx=-s.tz,nz=s.tx,hw=r.w/2;B.p.push(s.x+nx*hw,s.h+.04,s.z+nz*hw,s.x-nx*hw,s.h+.04,s.z-nz*hw);if(SR)B.u.push(0,L/6,r.w/6,L/6);else B.u.push(0,L/4.5,1,L/4.5);
      if(i)B.i.push(base+(i-1)*2,base+i*2,base+(i-1)*2+1,base+(i-1)*2+1,base+i*2,base+i*2+1);
      const ry=Math.atan2(-s.tz,s.tx);
      if(!SR&&i%2===0&&terr(s.x,s.z)<s.h-1.2){deck.push({x:s.x,y:s.h-.3,z:s.z,ry,sx:2.2,sy:.6,sz:r.w+.6});
        for(const sd of[-1,1]){rail.push({x:s.x+nx*sd*(hw+.15),y:s.h+.55,z:s.z+nz*sd*(hw+.15),ry,sx:2.1,sy:.12,sz:.15},{x:s.x+nx*sd*(hw+.15),y:s.h+.3,z:s.z+nz*sd*(hw+.15),ry,sx:.15,sy:.6,sz:.15});addOBB(s.x+nx*sd*(hw+.2),s.z+nz*sd*(hw+.2),1.1,.12,ry)}
        if(i%10===0)pil.push({x:s.x,y:SEA-2,z:s.z,sy:s.h-SEA+1.6})}
      if(SR){const ry=Math.atan2(-s.tz,s.tx),E=r.s.length-1,ed=Math.min(i,E-i)*2; // runway paint: centre dashes, threshold bars near both ends
        if(ed>30&&i%15===0)rwy.push({x:s.x,y:s.h+.06,z:s.z,ry,sx:12,sz:.9,g:1});
        if(ed>=8&&ed<10)for(let k=-5;k<=5;k++)if(k)rwy.push({x:s.x,y:s.h+.06,z:s.z+0,ry,sx:22,sz:1.5,...(o=>({x:s.x+nx*o,z:s.z+nz*o}))(k*2.3)})}
      if(!SR&&(r.hwy||r.w===7)&&i%16===0&&i>0&&i<r.s.length-1&&lastCarve<.2){const px=s.x+nx*(hw+1.8),pz=s.z+nz*(hw+1.8),ph=H(px,pz);if(!nearLM(px,pz)){poles.push({x:px,y:ph,z:pz,ry,r});addOBB(px,pz,.2,.2)}}});
    B.base=0}
  // road ribbons split into terrain-tile-sized chunks so they get frustum + distance culled like everything else
  for(const[k,B]of Object.entries(rb)){const mat=new THREE.MeshStandardMaterial({map:k==='hwy'?tHwy:k==='strip'?tCon:tRoad,roughness:.85,polygonOffset:true,polygonOffsetFactor:-2}),ch=new Map();
    for(let t=0;t<B.i.length;t+=3){const a=B.i[t],b=B.i[t+1],c=B.i[t+2],key=Math.floor((B.p[a*3]+B.p[b*3]+B.p[c*3])/3/TILE)*1000+Math.floor((B.p[a*3+2]+B.p[b*3+2]+B.p[c*3+2])/3/TILE);
      let C=ch.get(key);if(!C)ch.set(key,C={p:[],u:[],i:[],map:new Map()});for(const v of[a,b,c]){let n=C.map.get(v);if(n===undefined){n=C.p.length/3;C.map.set(v,n);C.p.push(B.p[v*3],B.p[v*3+1],B.p[v*3+2]);C.u.push(B.u[v*2],B.u[v*2+1])}C.i.push(n)}}
    for(const C of ch.values()){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(C.p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(C.u,2));g.setIndex(C.i);g.computeVertexNormals();
      const m=new THREE.Mesh(g,mat);m.receiveShadow=true;scene.add(freeze(m));cullFar(m,FAR.big)}}
  inst(new THREE.BoxGeometry(1,1,1),std(0xb5b1a8,.8),deck);inst(new THREE.BoxGeometry(1,1,1),std(0xe8e4da,.6),rail,true,FAR.mid);inst(aoGeo(new THREE.CylinderGeometry(.6,.7,1,8).translate(0,.5,0),.55),vstd(0x9a968c,.8),pil);
  // power poles + sagging wires
  inst(aoGeo(mergeGeometries([new THREE.CylinderGeometry(.11,.15,8,6).translate(0,4,0),new THREE.BoxGeometry(.12,.12,1.7).translate(0,7.6,0)]),.55,0,4),vstd(0x8d887e,.8),poles,false,FAR.mid);
  for(let i=1;i<poles.length;i++){const a=poles[i-1],b=poles[i];if(a.r!==b.r||Math.hypot(a.x-b.x,a.z-b.z)>45)continue;
    for(const off of[-.75,0,.75]){const ox=Math.sin(a.ry)*off,oz=Math.cos(a.ry)*off,ox2=Math.sin(b.ry)*off,oz2=Math.cos(b.ry)*off;let px=a.x+ox,py=a.y+7.7,pz=a.z+oz;
      for(let k=1;k<=6;k++){const t=k/6,x=a.x+ox+(b.x+ox2-a.x-ox)*t,z=a.z+oz+(b.z+oz2-a.z-oz)*t,y=a.y+7.7+(b.y-a.y)*t-Math.sin(PI*t)*.7;wires.push(px,py,pz,x,y,z);px=x;py=y;pz=z}}}
  {const wm=new THREE.LineBasicMaterial({color:0x1a1a1a}),wc=new Map();for(let i=0;i<wires.length;i+=6){const k=Math.floor(wires[i]/CELL)*1000+Math.floor(wires[i+2]/CELL);if(!wc.has(k))wc.set(k,[]);wc.get(k).push(...wires.slice(i,i+6))}
    for(const w of wc.values()){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(w,3));const l=freeze(new THREE.LineSegments(g,wm));scene.add(l);cullFar(l,FAR.mid)}}
  for(const o of rwy)o.y=H(o.x,o.z)+.03; // on the drawn surface (the strip end meets the taxiway ribbon)
  if(rwy.length)inst(new THREE.BoxGeometry(1,.012,1),new THREE.MeshBasicMaterial({color:0xeeeeea}),rwy,false,FAR.mid);
  inst(new THREE.BoxGeometry(7,.07,.7),std(0xe0b41a,.7),BUMPS.map(b=>({x:b.x,y:.06,z:b.z,ry:b.ax==='z'?0:PI/2})),false,FAR.small);
  // ----- town (población): shophouses with tin roofs, plaza + church, market, jeepneys -----
  const bl=[[],[],[]],roofs=[],awn=[];
  function shop(x,z,w,d,ry){const fl=rand()<.3?0:rand()<.65?1:2,h=[3.2,6,8.8][fl];bl[fl].push({x,y:0,z,ry,sx:w,sy:h,sz:d,c:pastel()});roofs.push({x,y:h,z,ry,sx:w+.6,sy:.22,sz:d+.8,c:TIN[(rand()*TIN.length)|0]});
    if(fl===0&&rand()<.7)awn.push({x:x+Math.sin(ry)*(d/2+.9),y:2.5,z:z+Math.cos(ry)*(d/2+.9),ry,sx:w*.9,sy:.1,sz:1.8,c:new THREE.Color().setHSL(rand(),.7,.5)});addOBB(x,z,w/2,d/2,ry)}
  function edge(ax,az,bx,bz,ry){const L=Math.hypot(bx-ax,bz-az),ux=(bx-ax)/L,uz=(bz-az)/L;let s=0;while(s<L-6){const w=6+rand()*4.5,d=8+rand()*3;if(s+w>L)break;
    const back=d/2;shop(ax+ux*(s+w/2)-Math.sin(ry)*back,az+uz*(s+w/2)-Math.cos(ry)*back,w,d,ry);s+=w+.6+rand()*1.6}}
  function block(x0,z0,x1,z1,sides='nsew'){const I=4.6;
    if(sides.includes('n'))edge(x0+I,z1-I,x1-I,z1-I,0);if(sides.includes('s'))edge(x0+I,z0+I,x1-I,z0+I,PI);
    if(sides.includes('e'))edge(x1-I,z0+I+12,x1-I,z1-I-12,PI/2);if(sides.includes('w'))edge(x0+I,z0+I+12,x0+I,z1-I-12,-PI/2)}
  // ry convention: front of a shop faces +z rotated by ry (front normal = (sin ry, cos ry))
  for(const b of TOWN.blocks)block(...b);
  // placed shophouses (no rand: colours from a hash of the position, so editing one doesn't reshuffle the island)
  const hcol=(q,q2)=>new THREE.Color().setHSL(q,.35+q2*.3,.62+((q*7.31)%1)*.18),hq=(x,z)=>[hash2(Math.round(x*10),Math.round(z*10)),hash2(Math.round(z*10)+7,Math.round(x*10)-3)];
  for(const b of BLD)if(b[0]==='shop'){const[,x,z,ry=0,w=8,d=9.5,fl=1]=b,[q,q2]=hq(x,z),f=foot(x,z,w/2,d/2,ry),sl=f.hi-f.lo,F=clamp(Math.round(fl)-1,0,2),h=[3.2,6,8.8][F]+sl+.25,y=f.lo-.25;
    bl[F].push({x,y,z,ry,sx:w,sy:h,sz:d,c:hcol(q,q2)});roofs.push({x,y:y+h,z,ry,sx:w+.6,sy:.22,sz:d+.8,c:TIN[(q2*TIN.length)|0]});
    if(F===0&&q<.7)awn.push({x:x+Math.sin(ry)*(d/2+.9),y:f.lo+2.5,z:z+Math.cos(ry)*(d/2+.9),ry,sx:w*.9,sy:.1,sz:1.8,c:new THREE.Color().setHSL(q2,.7,.5)});addOBB(x,z,w/2,d/2,ry)}
  [1,2,3].forEach((n,i)=>inst(aoGeo(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),.62,0,.6/(n)),glowMat(vstd(0xffffff,.85,0,tW[i]),tWG[i]),bl[i]));
  inst(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({map:tTin,roughness:.5,metalness:.4}),roofs);inst(new THREE.BoxGeometry(1,1,1),std(0xffffff,.7),awn,false,FAR.small);
  // landmarks: original coordinates, mapped through each one's frame F (W = world position, F.y = levelled ground)
  const mesh=(g,m,X,Y,Z,F,r0=0)=>{const o=new THREE.Mesh(g,m),w=F.W(X,Z);o.position.set(w.x,F.y+Y,w.z);o.rotation.y=F.ry+r0;return o};
  const tCourt=mkTex(T.court()),stone=std(0xcdbb98,.95);
  for(const F of LMF.plaza){const{W,obb,ry,y}=F;
    const pz=mesh(new THREE.PlaneGeometry(62,40).rotateX(-PI/2),std(0x6fae4a,.9),118,.02,28,F);pz.receiveShadow=true;scene.add(freeze(pz));
    const ct=mesh(new THREE.PlaneGeometry(15,28).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tCourt,roughness:.7}),98,.03,28,F);scene.add(freeze(ct));
    inst(mergeGeometries([new THREE.CylinderGeometry(.1,.1,3.2,6).translate(0,1.6,0),new THREE.BoxGeometry(1.8,1.1,.08).translate(0,3.4,.3)]),std(0xdedede,.5),[{...W(98,14.6),y,ry},{...W(98,41.4),y,ry:ry+PI}],true,FAR.small);obb(98,14.6,.2,.2);obb(98,41.4,.2,.2)}
  for(const F of LMF.church){const ch=new THREE.Group(),w=F.W(128,62);ch.position.set(w.x,F.y,w.z);ch.rotation.y=F.ry;scene.add(ch);
    const cm=(g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;ch.add(o);return o};
    cm(new THREE.BoxGeometry(13,10,24).translate(0,5,0),stone,0,0,0);cm(prism(14,5,25),std(0x8a3b2b,.7),0,10,0);
    cm(new THREE.BoxGeometry(15,14,1.6).translate(0,7,0),stone,0,0,-12.6);cm(prism(15,4,1.6),stone,0,14,-12.6);
    cm(new THREE.BoxGeometry(2.6,4.5,.4).translate(0,2.25,0),std(0x4a2f1f,.8),0,0,-13.5);
    cm(new THREE.BoxGeometry(5,20,5).translate(0,10,0),stone,-9.5,0,-11);cm(new THREE.ConeGeometry(3.6,4,4).rotateY(PI/4).translate(0,2,0),std(0x8a3b2b,.7),-9.5,20,-11);
    cm(new THREE.BoxGeometry(.25,2.2,.25),std(0x333333,.5),0,17,-12.6);cm(new THREE.BoxGeometry(1.2,.25,.25),std(0x333333,.5),0,17.4,-12.6);
    cm(new THREE.BoxGeometry(1.6,2,5.2),std(0x222222,.8),-9.5,15,-11);mergeByMaterial(ch,mergeGeometries);freeze(ch);cullFar(ch,FAR.big);
    F.obb(128,62,6.5,12);F.obb(128,49.4,7.5,.8);F.obb(118.5,51,2.5,2.5)}
  // market shed
  const tMr=mkTex(T.tin(),[8,1]);
  for(const F of LMF.market){const{W,obb,ry,y}=F,mk2=[],stall=[];
    for(let i=0;i<4;i++)for(let j=0;j<3;j++){mk2.push({...W(96+i*16,-60+j*20),y,ry});obb(96+i*16,-60+j*20,.25,.25)}
    inst(aoGeo(new THREE.CylinderGeometry(.2,.2,6,6).translate(0,3,0),.5,0,3),vstd(0x777777,.6),mk2,true,FAR.mid);
    const mr=mesh(prism(56,4,46),new THREE.MeshStandardMaterial({color:0x9aa0a6,map:tMr,roughness:.5,metalness:.5}),120,6,-40,F,PI/2);mr.castShadow=true;scene.add(freeze(mr));cullFar(mr,FAR.big);
    for(let i=0;i<8;i++)for(let j=0;j<2;j++){const x=100+i*5.5,z=-52+j*22;stall.push({...W(x,z),y,ry,sx:3.6,sy:1,sz:2.2,c:new THREE.Color().setHSL(rand(),.6,.55)});obb(x,z,1.8,1.1)}
    inst(aoGeo(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),.55),vstd(0xffffff,.8),stall,true,FAR.small)}
  // airstrip hangars (island.json 'hangars': [x, z, ry]; front faces +z rotated by ry): tin shed + dark doorway
  const hg=(MD.hangars||[]).map(([x,z,ry])=>{const f=foot(x,z,13,11,ry);addOBB(x,z,13,11,ry);return{x,y:f.lo-.2,z,ry,sy:1+(f.hi-f.lo)/7.5}});
  if(hg.length){const tH=mkTex(T.tin(),[4,1]);inst(aoGeo(mergeGeometries([new THREE.BoxGeometry(26,7.5,22).translate(0,3.75,0).toNonIndexed(),prism(26.6,3.5,22.6).translate(0,7.5,0)]),.6,0,6),vstd(0xc4c8cc,.5,.4,tH),hg,true,FAR.big);
    inst(new THREE.BoxGeometry(18,6,.2).translate(0,3,11.05),std(0x1d1f22,.9),hg.map(o=>({...o,y:H(o.x+Math.sin(o.ry)*11,o.z+Math.cos(o.ry)*11)-.1,sy:1})),false,FAR.mid)}
  // jeepneys + tricycles parked along streets
  const jeep=[],tri=[];
  const jbody=mergeGeometries([new THREE.BoxGeometry(2,1.25,4.6).translate(0,1.1,.4),new THREE.BoxGeometry(1.8,.75,1.4).translate(0,.85,-2.5),new THREE.BoxGeometry(2.15,.12,5.2).translate(0,2.05,.3),new THREE.BoxGeometry(1.6,.3,.25).translate(0,.5,-3.3)]);
  const jd=mergeGeometries([...[[-.95,-2.2],[.95,-2.2],[-.95,1.9],[.95,1.9]].map(([x,z])=>new THREE.CylinderGeometry(.38,.38,.28,12).rotateZ(PI/2).translate(x,.38,z)),new THREE.BoxGeometry(1.7,.6,.05).translate(0,1.55,-1.85)]);
  for(const[x,z,ry]of TOWN.jeeps){const c=new THREE.Color().setHSL(rand(),.85,.5);jeep.push({x,z,ry,c});addOBB(x,z,1.05,3.4,ry)}
  inst(...pair({g:aoGeo(jbody,.6,.3,2.1),m:vstd(0xffffff,.35,.4,tJeep)},{g:jd,m:std(0x111111,.8)}),jeep,true,FAR.mid); // dark parts now get the instance tint too (×0.07: still black)
  const trig=mergeGeometries([new THREE.BoxGeometry(1.2,1.2,1.6).translate(.75,.95,0),new THREE.BoxGeometry(1.4,.08,2).translate(.6,1.6,0),new THREE.BoxGeometry(.25,.6,1.4).translate(-.2,.7,0)]);
  for(const[x,z,ry]of TOWN.trikes){tri.push({x,z,ry,c:new THREE.Color().setHSL(rand(),.7,.45)});addOBB(x+Math.cos(ry)*.4,z,1.2,1.1,ry)}
  const tw=(x,z,r)=>new THREE.CylinderGeometry(r,r,.12,10).rotateZ(PI/2).translate(x,r,z);
  inst(...pair({g:aoGeo(trig,.6),m:vstd(0xffffff,.45,.3)},{g:mergeGeometries([tw(-.2,.72,.3),tw(-.2,-.72,.3),tw(1.42,0,.3)]),m:std(0x111111,.8)}),tri,true,FAR.small); // wheels: bike front/rear + sidecar
  // houses along the roads outside town: concrete bungalows and nipa huts
  const hb=[],hr=[],nipa=[],GH=PROPS.houses||{every:0};
  const hut=(x,z,ry)=>{const f=foot(x,z,2.25,2.1,ry);if(f.hi-f.lo<.9){nipa.push({x,y:f.lo,z,ry,sx:4.5,sy:2.6,sz:4.2,c:0xb59a5e});addOBB(x,z,2.3,2.2,ry);return true}}; // stilts (1 m) absorb up to .9 m of slope
  const house=(x,z,ry,w,d,c,rc)=>{const f=foot(x,z,w/2,d/2,ry),sl=f.hi-f.lo;if(sl<2.4){hb.push({x,y:f.lo-.25,z,ry,sx:w,sy:3.35+sl,sz:d,c});hr.push({x,y:f.hi+3.1,z,ry,sx:w+.8,sy:1,sz:d+.9,c:rc});addOBB(x,z,w/2,d/2,ry);return true}}; // walls reach down to the low corner
  const R1=v=>Math.round(v*10)/10,R4=v=>Math.round(v*1e4)/1e4;
  if(GH.every>0)for(const r of ROADS){if(!r.hwy&&r.w!==6)continue;for(let i=6;i<r.s.length-6;i+=Math.max(2,Math.round(GH.every))){const s=r.s[i];for(const sd of[-1,1]){if(rand()>GH.chance)continue;
    const off=r.w/2+8+rand()*5,x=s.x-s.tz*off*sd,z=s.z+s.tx*off*sd;if(rd(x,z,TOWN,10)<1)continue;const q=nearRoad(x,z);if(q&&q.d<r.w/2+5)continue;
    const h=terr(x,z);if(h<SEA+1.2||lastCarve>.05||h>45||rd(x,z,PADDY)<2)continue;
    const ry=Math.atan2(-s.tz,s.tx)+(sd>0?PI:0);
    if(rand()<.35){if(hut(x,z,ry))GEN.push(['nipa',R1(x),R1(z),R4(ry)])}
    else{const w=6+rand()*3,d=6+rand()*2.5,c=pastel(),rc=TIN[(rand()*TIN.length)|0];if(house(x,z,ry,w,d,c,rc))GEN.push(['house',R1(x),R1(z),R4(ry),R1(w),R1(d)])}}}}
  for(const b of BLD){const[t,x,z,ry=0,w=7,d=7]=b;if(t==='nipa')hut(x,z,ry);else if(t==='house'){const[q,q2]=hq(x,z);house(x,z,ry,w,d,hcol(q,q2),TIN[(q2*TIN.length)|0])}}
  inst(aoGeo(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),.62,0,.6),glowMat(vstd(0xffffff,.85,0,tW[0]),tWG[0]),hb,true,FAR.tree);
  inst(prism(1,1.6,1),new THREE.MeshStandardMaterial({map:tTin,roughness:.5,metalness:.4}),hr,true,FAR.tree);
  // roof in the hut's instance space (hut scale 4.5/2.6/4.2, roof 4.4/2.4/4.4 sitting 2.6 m up); its colour divided by the
  // hut's instance tint, which now multiplies it too
  const NT=new THREE.Color(0xb59a5e),nrm=std(new THREE.Color(0x9c8350).multiply(new THREE.Color(1/NT.r,1/NT.g,1/NT.b)),1);
  inst(...pair({g:aoGeo(mergeGeometries([new THREE.BoxGeometry(1,.62,1).translate(0,.69,0),...[[-.42,-.42],[.42,-.42],[-.42,.42],[.42,.42]].map(([a,b])=>new THREE.BoxGeometry(.05,.4,.05).translate(a,.2,b))]),.55),m:vstd(0xffffff,.9)},
    {g:new THREE.ConeGeometry(.78,1,4).rotateY(PI/4).translate(0,.5,0).scale(4.4/4.5,2.4/2.6,4.4/4.2).translate(0,1,0),m:nrm}),nipa,true,FAR.tree);
  // palms on the beaches and lowlands, rainforest on the hills
  const trunk=new THREE.CylinderGeometry(.14,.22,8,6,4).translate(0,4,0);{const p=trunk.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i);p.setX(i,p.getX(i)+(y/8)**2*1.3)}}
  const fronds=mergeGeometries(Array.from({length:8},(_,i)=>new THREE.BoxGeometry(.55,.04,3.6).translate(0,0,1.8).rotateX(.45+(i%2)*.25).rotateY(i*PI/4).translate(1.3,8,0)));
  const palms=[],trees=[];
  const PP=PROPS.palms,TP=PROPS.trees;
  for(let i=0;i<PP.tries&&palms.length<PP.max;i++){const th=rand()*2*PI,r=coastR(th)-8-rand()*rand()*PP.band,x=ICX+Math.cos(th)*r,z=ICZ+Math.sin(th)*r,h=terr(x,z);
    if(h<SEA+.4||h>12||lastCarve>.05)continue;if(hg.some(o=>Math.hypot(x-o.x,z-o.z)<22))continue;const q=nearRoad(x,z);if(q&&q.d<q.w/2+2.5)continue;if(rd(x,z,TOWN)<1&&rand()<.85)continue;
    palms.push({x,y:foot(x,z,.3,.3).lo-.1,z,ry:rand()*2*PI,sx:.8+rand()*.4,sy:.8+rand()*.5,sz:.8+rand()*.4});addOBB(x,z,.25,.25)}
  // extra islands: palms along each outline (trees below); only when the map has islands, so rand's sequence is unchanged otherwise
  for(const I of ISL){const n=Math.round(PP.max*I.per/(2*PI*CMAX));for(let k=0,c=0;k<n*6&&c<n;k++){const p=I.S[(rand()*I.S.length)|0],dx=I.cx-p[0],dz=I.cz-p[1],l=Math.hypot(dx,dz)||1,o=8+rand()*rand()*PP.band,x=p[0]+dx/l*o,z=p[1]+dz/l*o,h=terr(x,z);
      if(islD(x,z,I.S)<4||h<SEA+.4||h>12||lastCarve>.05)continue;const q=nearRoad(x,z);if(q&&q.d<q.w/2+2.5)continue;c++;
      palms.push({x,y:foot(x,z,.3,.3).lo-.1,z,ry:rand()*2*PI,sx:.8+rand()*.4,sy:.8+rand()*.5,sz:.8+rand()*.4});addOBB(x,z,.25,.25)}
  }
  inst(...pair({g:aoGeo(trunk,.55,0,5),m:vstd(0xd8c8b0,.9,0,tBark)},{g:aoGeo(fronds,.7,6.4,8.4),m:vstd(0xffffff,.8,0,tFrond)}),palms,false,FAR.tree);
  for(let i=0;i<TP.tries&&trees.length<TP.max;i++){const x=ICX+(rand()-.5)*2*CMAX,z=ICZ+(rand()-.5)*2*CMAX,h=terr(x,z);if(h<10||h>150||lastCarve>.05)continue;
    if(Math.hypot(x-TERR.x,z-TERR.z)<TERR.r-20)continue;if(hg.some(o=>Math.hypot(x-o.x,z-o.z)<22))continue;const q=nearRoad(x,z);if(q&&q.d<q.w/2+3)continue;const s=.7+rand()*.8;
    trees.push({x,y:foot(x,z,.3*s,.3*s).lo-.2,z,sx:s,sy:s*(.8+rand()*.5),sz:s,c:new THREE.Color().setHSL(.24+rand()*.08,.5,.3+rand()*.14)});if(q&&q.d<20)addOBB(x,z,.3,.3)}
  // extra islands: trees inland
  for(const I of ISL){
    const fr=(I.x1-I.x0)*(I.z1-I.z0)/(4*CMAX*CMAX),nt=Math.round(TP.max*fr);for(let k=0,c=0;k<TP.tries*fr&&c<nt;k++){const x=I.x0+rand()*(I.x1-I.x0),z=I.z0+rand()*(I.z1-I.z0),h=terr(x,z);if(h<10||h>150||lastCarve>.05||islD(x,z,I.S)<0)continue;
      const q=nearRoad(x,z);if(q&&q.d<q.w/2+3)continue;const sc=.7+rand()*.8;c++;trees.push({x,y:foot(x,z,.3*sc,.3*sc).lo-.2,z,sx:sc,sy:sc*(.8+rand()*.5),sz:sc,c:new THREE.Color().setHSL(.24+rand()*.08,.5,.3+rand()*.14)});if(q&&q.d<20)addOBB(x,z,.3,.3)}}
  inst(...pair({g:aoGeo(new THREE.CylinderGeometry(.2,.28,3,5).translate(0,1.5,0),.45),m:vstd(0x9a7a5a,.9,0,tBark)},{g:aoGeo(new THREE.IcosahedronGeometry(2.4,0).translate(0,4.4,0),.45,2.2,6.8,.8),m:vstd(0xffffff,.9,0,tLeaf)}),trees,false,FAR.tree);
  // lot + gas station paving
  const tLot=tAsph.clone();tLot.repeat.set(17,17);tLot.needsUpdate=true;
  for(const F of LMF.lot){const lot=mesh(new THREE.PlaneGeometry(70,70).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tLot,roughness:.9}),40,.015,40,F);lot.receiveShadow=true;scene.add(freeze(lot));cullFar(lot,FAR.mid)}
  const tGas=tCon.clone();tGas.repeat.set(10,10);tGas.needsUpdate=true;
  for(const F of LMF.gas){const gp=mesh(new THREE.PlaneGeometry(40,40).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tGas,roughness:.9}),-40,.015,40,F);gp.receiveShadow=true;scene.add(freeze(gp));cullFar(gp,FAR.mid)}
  // ----- night lights (lights.js): emissive lamp heads + additive light pools + halos; everything comes on at sunset -----
  {
    const LPO=[],LA=[],LH=[],LS=[],LP=[],LHA=[];
    const poolY=(x,z,r)=>{let y=H(x,z);for(const[a,b]of[[r,0],[-r,0],[0,r],[0,-r]])y=Math.max(y,H(x+a,z+b));return y+.07};
    const pool=(x,z,r,c=0xffd9a0,rz=r,ry=0)=>LP.push({x,y:poolY(x,z,Math.min(r,rz)*.6),z,ry,sx:r*2,sz:rz*2,c});
    // landmark helpers: original coordinates through frame F
    const fpost=(F,x,z,hgt,cx,cz,len,rad,c)=>{const w=F.W(x,z),t=F.W(cx,cz);post(w.x,w.z,hgt,t.x-w.x,t.z-w.z,len,rad,c)},fpool=(F,x,z,r,c,rz=r)=>{const w=F.W(x,z);pool(w.x,w.z,r,c,rz,F.ry)},
      fbox=(F,L,x,y,z,o)=>L.push({...F.W(x,z),y:F.y+y,ry:F.ry,...o}),fhalo=(F,x,y,z,s,c)=>{const w=F.W(x,z);halo(w.x,F.y+y,w.z,s,c)};
    const halo=(x,y,z,s,c=0xffd890)=>LHA.push({x,y,z,sx:s,sy:s,sz:s,c});
    // free-standing post: arm of length len pointing along (tx, tz), head over its tip, pool under the head
    function post(x,z,hgt,tx,tz,len,rad,c){const gy=H(x,z),L=Math.hypot(tx,tz)||1,dx=tx/L,dz=tz/L,ra=Math.atan2(-dz,dx),hx=x+dx*len,hz=z+dz*len;
      LPO.push({x,y:gy,z,sy:hgt});LA.push({x,y:gy+hgt-.05,z,ry:ra,sx:len});LH.push({x:hx,y:gy+hgt-.2,z:hz,ry:ra,sx:.7,sy:.16,sz:.4});halo(hx,gy+hgt-.3,hz,3.4,c);pool(hx,hz,rad,c);addOBB(x,z,.18,.18)}
    // lamp on an existing power pole (arm across the road, towards the road centre)
    function polamp(p,rad){const dx=-Math.sin(p.ry),dz=-Math.cos(p.ry),ra=Math.atan2(-dz,dx),hx=p.x+dx*2.6,hz=p.z+dz*2.6;
      LA.push({x:p.x,y:p.y+7.55,z:p.z,ry:ra,sx:2.6});LH.push({x:hx,y:p.y+7.4,z:hz,ry:ra,sx:.7,sy:.16,sz:.4});halo(hx,p.y+7.3,hz,3.4,0xffc070);pool(hx,hz,rad,0xffc070)}
    // 1) streets: every power pole in town, every 3rd along the highways
    const cnt=new Map();
    for(const p of poles){if(rd(p.x,p.z,TOWN,10)<1){polamp(p,8);continue}if(p.r.hwy){const k=(cnt.get(p.r)||0)+1;cnt.set(p.r,k);if(k%3===1)polamp(p,8)}}
    // 2) parking lot: tall posts in the aisles and around the edge, arms pointing to the middle
    for(const F of LMF.lot)for(const[x,z]of[[8,29],[8,57],[46,13],[46,43],[46,70],[70,20],[70,60]])fpost(F,x,z,7.5,40,40,1.8,12,0xe6efff);
    // 3) gas station: lit canopy (panels + coloured trim + a big pool), roadside price pylon
    for(const F of LMF.gas){const gx=-40,gz=40;for(const sx of[-5,5])for(const sz of[-4.5,4.5])fbox(F,LH,gx+sx,5.3,gz+sz,{sx:1.6,sy:.08,sz:1.6});
      for(const[x,z,w,d]of[[gx,gz-9,20,.1],[gx,gz+9,20,.1],[gx-10,gz,.1,18],[gx+10,gz,.1,18]])fbox(F,LS,x,5.45,z,{sx:w,sy:.16,sz:d,c:0x35e07a});
      fpool(F,gx,gz,12,0xf4f8ff,11);fpool(F,gx,gz,9,0xf4f8ff,8);fhalo(F,gx,5.0,gz,9,0xe8f0ff);
      const P=F.W(gx+20.6,gz-9),px=P.x,pz=P.z,gy=H(px,pz),Q=F.W(gx+17.6,gz-9);LPO.push({x:px,y:gy,z:pz,sy:9});LS.push({x:px,y:gy+9.4,z:pz,ry:F.ry,sx:.5,sy:3,sz:2.4,c:0xd03028},{x:px,y:gy+11.2,z:pz,ry:F.ry,sx:.5,sy:.9,sz:2.4,c:0xffc830});halo(px,gy+9.6,pz,7,0xffb060);pool(Q.x,Q.z,6,0xff9a60);addOBB(px,pz,.25,.25)}
    // 4) plaza: lamp posts around the lawn; basketball court: four floodlight masts and one bright pool
    for(const F of LMF.plaza){for(const x of[91,118,145])for(const z of[10,46])fpost(F,x,z,5.5,118,28,1.3,9.5,0xfff0d0);
      for(const[x,z]of[[91.2,13],[104.8,13],[91.2,43],[104.8,43]]){fpost(F,x,z,9,98,28,1.1,5,0xe8f0ff);const w=F.W(x,z);LH.push({...F.W(x+(98-x)*.12,z+(28-z)*.05),y:H(w.x,w.z)+8.7,ry:F.ry,sx:1.3,sy:.3,sz:.7})}
      fpool(F,98,28,10,0xe8f0ff,17);fpool(F,98,28,8,0xe8f0ff,14)}
    // 5) church: floodlit facade, glowing door, stained-glass nave windows, lit belfry
    for(const F of LMF.church){fpool(F,128,44.5,10,0xffe4b0,6);fpool(F,118.5,45,5,0xffe4b0);fbox(F,LS,128,.4,48.2,{sx:2,sy:3.8,sz:.1,c:0xffb060});
      const SG=[0xffc880,0xff6a4a,0x6aa0ff,0xffd36a];[54,59,64,69].forEach((z,i)=>{for(const x of[121.4,134.6])fbox(F,LS,x,3.4,z,{sx:.12,sy:3.8,sz:1.3,c:SG[(i+(x>128?1:0))%4]})});
      fbox(F,LS,118.5,14.2,48.25,{sx:1.1,sy:1.5,sz:.1,c:0xffc070});fbox(F,LS,116.9,14.2,52,{sx:.1,sy:1.5,sz:1.1,c:0xffc070});fbox(F,LS,120.1,14.2,52,{sx:.1,sy:1.5,sz:1.1,c:0xffc070});fhalo(F,118.5,15,47,5,0xffc070)}
    // 6) market shed: strings of bulbs over both stall rows, lamp posts at the corners
    for(const F of LMF.market){for(const z of[-52,-30]){for(let x=100;x<=140;x+=3.6){fbox(F,LH,x,4.4,z,{sx:.4,sy:.4,sz:.4});fhalo(F,x,4.3,z,3.2,0xffcf88)}fpool(F,120,z,24,0xffd9a0,6)}
      for(const[x,z]of[[94,-62],[146,-62],[94,-18],[146,-18]])fpost(F,x,z,6.5,120,-40,1.4,10,0xffd9a0)}
    // 7) airstrip: white edge lights every 30 m, green threshold bars, red end bars; hangar floodlights
    {const r=ROADS.find(q=>q.kind==='strip');if(r){const E=r.s.length-1,hw=r.w/2-.7;
      for(let i=0;i<=E;i+=15){const s=r.s[i];for(const sd of[-1,1]){const x=s.x-s.tz*hw*sd,z=s.z+s.tx*hw*sd,y=H(x,z)+.25;LS.push({x,y,z,sx:.45,sy:.3,sz:.45,c:0xdbe8ff});halo(x,y+.1,z,2.6,0xcfe0ff)}}
      for(const[i,c]of[[0,0xff3030],[E,0xff3030],[4,0x30ff60],[E-4,0x30ff60]]){const s=r.s[clamp(i,0,E)];for(let k=-6;k<=6;k+=2){const x=s.x-s.tz*k*2.2,z=s.z+s.tx*k*2.2,y=H(x,z)+.25;LS.push({x,y,z,sx:.5,sy:.3,sz:.5,c});halo(x,y+.1,z,3,c)}}}
      for(const o of hg){const dx=Math.sin(o.ry),dz=Math.cos(o.ry),x=o.x+dx*11.7,z=o.z+dz*11.7,y=H(o.x+dx*11,o.z+dz*11);LH.push({x,y:y+6.6,z,ry:o.ry,sx:1.2,sy:.2,sz:.6});halo(x,y+6.4,z,6,0xe8f0ff);pool(x+dx*5,z+dz*5,11,0xe8f0ff,9)}}
    // 8) nipa huts: a lantern on the porch
    for(const o of nipa){const x=o.x+Math.sin(o.ry)*2.5,z=o.z+Math.cos(o.ry)*2.5;LH.push({x,y:o.y+1.6,z,sx:.28,sy:.34,sz:.28});halo(x,o.y+1.6,z,2.6,0xffb870);pool(x,z,5,0xffb870)}
    const add=(g,m,L,sh,far)=>{if(L.length)inst(g,m,L,sh,far)};
    add(new THREE.CylinderGeometry(.07,.11,1,6).translate(0,.5,0),std(0x8d887e,.8),LPO,false,FAR.mid);
    add(new THREE.BoxGeometry(1,.1,.1).translate(.5,0,0),std(0x6e6a62,.8),LA,false,FAR.mid);
    add(new THREE.BoxGeometry(1,1,1),lampMat(),LH,false,FAR.mid);
    add(new THREE.BoxGeometry(1,1,1),lampMat([1.9,1.9,1.9],[.5,.5,.5]),LS,false,FAR.mid);
    add(HALO_GEO(),haloMat(.55),LHA,false,FAR.mid);
    add(POOL_GEO(),poolMat(.6),LP,false,FAR.small);
  }
}
/* minimap base image */
// ~9.3 m per pixel (the old 140 px over 1300 m), sized to the island; hud.js maps world -> pixels with MAPV
const MPN=Math.ceil((2*EXT+120)/(1300/140)),MAPV={cx:ICX,cz:ICZ,w:MPN*1300/140,n:MPN};
MAPV.gas=LMF.gas.map(F=>[F.x,F.z]); // red dots on the minimap (hud.js)
const MAP=document.createElement('canvas');MAP.width=MAP.height=MPN;
{const g=MAP.getContext('2d'),img=g.createImageData(MPN,MPN),W=MAPV.w;for(let j=0;j<MPN;j++)for(let i=0;i<MPN;i++){const x=ICX+(i/MPN-.5)*W,z=ICZ+(j/MPN-.5)*W,h=terr(x,z),k=(j*MPN+i)*4;
  const c=lastCarve>.4||h<SEA?[31,120,150]:h<SEA+1.3?[226,210,162]:rd(x,z,TOWN)<1?[170,160,140]:h>115?[124,116,106]:h>14?[61,107,44]:[118,168,69];img.data.set([...c,235],k)}
  g.putImageData(img,0,0);g.strokeStyle='#f4f1e8';g.lineCap='round';
  for(const r of ROADS){g.lineWidth=r.kind==='strip'?3:r.hwy?2:1.3;g.strokeStyle=r.kind==='strip'?'#c9c6bd':'#f4f1e8';g.beginPath();r.s.forEach((s,i)=>{const u=((s.x-ICX)/W+.5)*MPN,v=((s.z-ICZ)/W+.5)*MPN;i?g.lineTo(u,v):g.moveTo(u,v)});g.stroke()}}

/* parking lot (block 0,0) + gas station (block -1,0) */
const freeBays=[];
{
  const bw=(r,z)=>new THREE.CylinderGeometry(r,r,.09,14).rotateZ(PI/2).translate(0,r,z);
  const bikeGeo=mergeGeometries([bw(.29,.64),bw(.29,-.64),new THREE.BoxGeometry(.24,.35,1.1).translate(0,.55,0),new THREE.BoxGeometry(.3,.22,.5).translate(0,.85,-.1),new THREE.BoxGeometry(.22,.08,.5).translate(0,.84,.35),new THREE.BoxGeometry(.66,.03,.03).translate(0,1.05,-.5)]);
  for(const F of LMF.lot){const{W,box,ry,y}=F,lines=[],pb=[],cars=[];
    for(const rz of[22,36,50]){lines.push({...W(27.2,rz-1.2),y:y+.025,ry,sx:32,sz:.08});
      for(let k=0;k<=20;k++)lines.push({...W(11.2+k*1.6,rz),y:y+.025,ry,sx:.08,sz:2.4});
      for(let k=0;k<20;k++){const x=12+k*1.6;if(Math.random()<.45){pb.push({...W(x,rz),y,ry:ry+(Math.random()<.5?0:PI),c:new THREE.Color().setHSL(Math.random(),.6,.4)});box(x-.25,rz-.95,x+.25,rz+.95)}else freeBays.push({...W(x,rz),ry})}}
    for(let k=0;k<=15;k++)lines.push({...W(10.65+k*2.7,64),y:y+.025,ry,sx:.1,sz:5});
    for(let k=0;k<15;k++){const x=12+k*2.7;if(Math.random()<.6){cars.push({...W(x,64),y,ry,c:new THREE.Color().setHSL(Math.random(),.5,.45)});box(x-.95,62-.2,x+.95,66.2)}}
    inst(new THREE.BoxGeometry(1,.012,1),new THREE.MeshBasicMaterial({color:0xf2f2f2}),lines,false,FAR.small);
    inst(bikeGeo,std(0xffffff,.5,.2),pb,true,FAR.small);
    inst(...pair({g:mergeGeometries([new THREE.BoxGeometry(1.8,.7,4.3).translate(0,.55,0),new THREE.BoxGeometry(1.6,.55,2.2).translate(0,1.17,.2)]),m:std(0xffffff,.4,.3)},
      {g:mergeGeometries([[-.8,-1.35],[.8,-1.35],[-.8,1.35],[.8,1.35]].map(([x,z])=>new THREE.CylinderGeometry(.32,.32,.22,12).rotateZ(PI/2).translate(x,.32,z))),m:std(0x111111,.8)}),cars,true,FAR.mid)}
  // gas stations
  for(const F of LMF.gas){const{W,box,ry,y}=F,gx=-40,gz=40;
    inst(new THREE.BoxGeometry(1,1,1),std(0xb8bcc2,.6),[{...W(gx,gz-5),y:y+.12,ry,sx:6,sy:.24,sz:1.2},{...W(gx,gz+5),y:y+.12,ry,sx:6,sy:.24,sz:1.2}],false,FAR.small);
    inst(new THREE.BoxGeometry(.8,1.8,.6).translate(0,.9,0),std(0xd03028,.5),[[-1.6,-5],[1.6,-5],[-1.6,5],[1.6,5]].map(([a,b])=>({...W(gx+a,gz+b),y:y+.24,ry})),true,FAR.small);
    box(gx-3,gz-5.6,gx+3,gz-4.4);box(gx-3,gz+4.4,gx+3,gz+5.6);
    const pil=[[-9,-8],[9,-8],[-9,8],[9,8]].map(([a,b])=>{box(gx+a-.3,gz+b-.3,gx+a+.3,gz+b+.3);return{...W(gx+a,gz+b),y,ry}});
    inst(new THREE.CylinderGeometry(.3,.3,5.4,8).translate(0,2.7,0),std(0xdddddd,.5),pil,true,FAR.mid);
    inst(new THREE.BoxGeometry(20,.5,18),std(0xf4f4f0,.6),[{...W(gx,gz),y:y+5.6,ry}],true,FAR.mid);
    inst(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x43e07a,transparent:true,opacity:.25,depthWrite:false}),[{...W(gx,gz),y:y+.03,ry,sx:12,sy:.01,sz:7}],false,FAR.small)}
}
const marker=new THREE.Mesh(new THREE.BoxGeometry(1.4,.02,2.4),new THREE.MeshBasicMaterial({color:0x43e07a,transparent:true,opacity:.45,depthWrite:false}));
const arrow=new THREE.Mesh(new THREE.ConeGeometry(.35,.8,4).rotateX(PI),new THREE.MeshBasicMaterial({color:0x43e07a}));
export const GPU_TYPES=finishGpuInst(scene);
marker.visible=arrow.visible=false;liteMaterials(scene);scene.add(marker,arrow);

// ambience weights for audio.js (0..1 each) plus direction vectors to the sea (sx, sz) and the nearest river point (rx, rz)
function zones(x,z,o){const inl=inland(x,z),dx=x-ICX,dz=z-ICZ,l=Math.hypot(dx,dz)||1;o.coast=1-sstep(10,170,inl);o.sx=dx/l;o.sz=dz/l;
  let bd=1e18,bx=0,bz=0;for(let i=1;i<RIVER.length;i++){const[ax,az]=RIVER[i-1],[cx,cz]=RIVER[i],ex=cx-ax,ez=cz-az,t=clamp(((x-ax)*ex+(z-az)*ez)/(ex*ex+ez*ez),0,1),px=ax+ex*t,pz=az+ez*t,d=(px-x)**2+(pz-z)**2;if(d<bd){bd=d;bx=px-x;bz=pz-z}}
  o.river=1-sstep(8,90,Math.sqrt(bd));o.rx=bx;o.rz=bz;o.town=1-sstep(0,130,rd(x,z,TOWN));
  o.paddy=1-sstep(0,90,rd(x,z,PADDY));
  const dv=Math.hypot(x-VOL.x,z-VOL.z);o.volc=1-sstep(60,420,dv);o.wild=(1-o.town)*sstep(0,50,inl)*(1-sstep(90,160,VOL.h*Math.exp(-Math.pow(dv/VOL.r,1.8))));return o}
export { zones, atGas, LMF, GEN, SEA, ICX, ICZ, terr, H, roadH, nearRoad, ROADS, OBBS, addBox, addOBB, freeBays, marker, arrow, MAP, MAPV };
