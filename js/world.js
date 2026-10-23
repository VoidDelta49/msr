// The island: terrain, roads, town, props, collision grid, minimap image, parking lot.
// (Philippine-flavoured, not a real place.) Built once at load; physics reads H() and GRID.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PI, clamp, sstep, angd, fbm, rand } from './util.js';
import { scene, ctex, speck, std } from './renderer.js';

const tAsph=ctex(256,256,(g,w,h)=>speck(g,w,h,'#3c3e41',.5,9000),225);
const tCon=ctex(256,256,(g,w,h)=>{speck(g,w,h,'#9b988f',.35,5000);g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=2;for(let i=0;i<=256;i+=64){g.beginPath();g.moveTo(i,0);g.lineTo(i,256);g.moveTo(0,i);g.lineTo(256,i);g.stroke()}});
const tGrass=ctex(256,256,(g,w,h)=>speck(g,w,h,'#4e7a35',.45,9000));
const tWin=ctex(128,256,(g)=>{g.fillStyle='#bdb8ae';g.fillRect(0,0,128,256);for(let y=0;y<8;y++)for(let x=0;x<4;x++){g.fillStyle=Math.random()<.15?'#e8d9a0':'#34485c';g.fillRect(8+x*30,10+y*31,20,20)}});
const SEA=-2.2,ICX=0,ICZ=-100,VX=-60,VZ=-300;
function coastR(th){return 520+70*Math.sin(2*th+.6)+45*Math.sin(5*th+2)+18*Math.sin(11*th)-160*Math.exp(-(((angd(th,PI/2))/.45)**2))}
const inland=(x,z)=>coastR(Math.atan2(z-ICZ,x-ICX))-Math.hypot(x-ICX,z-ICZ);
const TOWN={x:210,z:110},PADDY={x0:230,x1:420,z0:-190,z1:10},TERR={x:160,z:-320,r:120};
const rectD=(x,z,hx,hz,cx=0,cz=0)=>Math.hypot(Math.max(Math.abs(x-cx)-hx,0),Math.max(Math.abs(z-cz)-hz,0));
function terrBase(x,z){
  const inl=inland(x,z);
  let h=inl>0?SEA+.2+Math.min(inl,60)*.045:Math.max(-10,SEA-.2+inl*.06);
  const hl=sstep(60,320,inl);h+=(fbm(x*.006+7,z*.006)*40-6)*hl;
  const dv=Math.hypot(x-VX,z-VZ);h+=200*Math.exp(-Math.pow(dv/150,1.8))-22*Math.exp(-((dv/22)**2));
  const dt=Math.hypot(x-TERR.x,z-TERR.z);if(dt<TERR.r+40){h+=32*Math.exp(-((dt/100)**2));const w=1-sstep(TERR.r-40,TERR.r,dt),q=h/2.4,f=q-Math.floor(q);h+=((Math.floor(q)+sstep(.7,1,f))*2.4-h)*w*.85}
  const pf=1-sstep(0,60,rectD(x,z,(PADDY.x1-PADDY.x0)/2,(PADDY.z1-PADDY.z0)/2,(PADDY.x0+PADDY.x1)/2,(PADDY.z0+PADDY.z1)/2));h+=(.6-h)*pf*hl;
  const tf=1-sstep(0,110,rectD(x,z,TOWN.x,TOWN.z));h+=(0-h)*tf;
  return h}
const RIVER=[[-230,-150],[-250,-60],[-275,20],[-300,110],[-330,200],[-360,290],[-380,360]];
const RLEN=[0];for(let i=1;i<RIVER.length;i++)RLEN.push(RLEN[i-1]+Math.hypot(RIVER[i][0]-RIVER[i-1][0],RIVER[i][1]-RIVER[i-1][1]));
let lastCarve=0;
function riverAmt(x,z){if(x>-200||z<-190)return 0;let bd=1e9,bs=0;for(let i=1;i<RIVER.length;i++){const[ax,az]=RIVER[i-1],[bx,bz]=RIVER[i],ex=bx-ax,ez=bz-az,l2=ex*ex+ez*ez,t=clamp(((x-ax)*ex+(z-az)*ez)/l2,0,1),dx=ax+ex*t-x,dz=az+ez*t-z,d=dx*dx+dz*dz;if(d<bd){bd=d;bs=(RLEN[i-1]+t*Math.sqrt(l2))/RLEN[RLEN.length-1]}}
  return(1-sstep(6,18,Math.sqrt(bd)))*sstep(0,.15,bs)}
function terr(x,z){const h=terrBase(x,z);lastCarve=riverAmt(x,z);return h+(SEA-1.4-h)*lastCarve}

/* roads: Catmull-Rom splines, heights smoothed from the terrain and grade-limited */
const ROADS=[],SEGG=new Map(),BUMPS=[];
{const p=[];for(let i=0;i<40;i++){const th=i/40*2*PI,R=coastR(th)-55;p.push([ICX+Math.cos(th)*R,ICZ+Math.sin(th)*R])}ROADS.push({pts:p,w:8,closed:true,hwy:true})}
for(const x of[-160,-80,0,80,160])ROADS.push({pts:[[x,-80],[x,80]],w:7});
for(const z of[-80,0,80])ROADS.push({pts:[[-160,z],[160,z]],w:7});
ROADS.push({pts:[[0,80],[0,ICZ+coastR(PI/2)-50]],w:7});
ROADS.push({pts:[[-160,40],[-230,40],[-290,30],[-360,0],[-420,-50],[-462,-100]],w:7,hwy:true});
ROADS.push({pts:[[160,0],[230,-10],[300,-60],[380,-80],[470,-90],[556,-100]],w:7,hwy:true});
ROADS.push({pts:[[80,-80],[90,-130],[60,-170],[110,-200],[90,-240],[140,-262],[160,-300]],w:6});
function crSample(r){const P=r.pts,n=P.length,out=[];const get=i=>r.closed?P[(i+n)%n]:P[clamp(i,0,n-1)];
  for(let i=0;i<(r.closed?n:n-1);i++){const p0=get(i-1),p1=get(i),p2=get(i+1),p3=get(i+2),L=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]),k=Math.max(1,Math.round(L/2));
    for(let j=0;j<k;j++){const t=j/k,t2=t*t,t3=t2*t,f=(a,b,c,d)=>.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3);out.push([f(p0[0],p1[0],p2[0],p3[0]),f(p0[1],p1[1],p2[1],p3[1])])}}
  out.push(r.closed?out[0]:P[n-1]);return out}
for(const r of ROADS){const S=crSample(r);let h=S.map(([x,z])=>terrBase(x,z));
  for(let pass=0;pass<3;pass++){const a=h.slice();for(let i=0;i<h.length;i++){let s=0,c=0;for(let j=-12;j<=12;j++){const k=i+j;if(k>=0&&k<h.length){s+=a[k];c++}}h[i]=s/c}}
  for(let i=1;i<h.length;i++)h[i]=clamp(h[i],h[i-1]-.26,h[i-1]+.26);for(let i=h.length-2;i>=0;i--)h[i]=clamp(h[i],h[i+1]-.26,h[i+1]+.26);
  r.s=S.map(([x,z],i)=>({x,z,h:Math.max(h[i],.05)}));
  for(let i=0;i<r.s.length;i++){const a=r.s[Math.max(0,i-1)],b=r.s[Math.min(r.s.length-1,i+1)],l=Math.hypot(b.x-a.x,b.z-a.z)||1;r.s[i].tx=(b.x-a.x)/l;r.s[i].tz=(b.z-a.z)/l}
  for(let i=1;i<r.s.length;i++){const A=r.s[i-1],B=r.s[i],sg={ax:A.x,az:A.z,bx:B.x,bz:B.z,ha:A.h,hb:B.h,w:r.w,l2:Math.max(1e-6,(B.x-A.x)**2+(B.z-A.z)**2)},m=r.w/2+9;
    for(let gx=Math.floor((Math.min(A.x,B.x)-m)/20);gx<=Math.floor((Math.max(A.x,B.x)+m)/20);gx++)for(let gz=Math.floor((Math.min(A.z,B.z)-m)/20);gz<=Math.floor((Math.max(A.z,B.z)+m)/20);gz++){const k=gx*1000+gz;if(!SEGG.has(k))SEGG.set(k,[]);SEGG.get(k).push(sg)}}}
for(const[x,z,ax]of[[0,-40,'z'],[0,40,'z'],[-80,40,'z'],[120,0,'x'],[-120,0,'x'],[40,-80,'x'],[-40,80,'x']])BUMPS.push({x,z,ax});
const NR={d:0,h:0,w:0};
function nearRoad(x,z){const L=SEGG.get(Math.floor(x/20)*1000+Math.floor(z/20));if(!L)return null;let bd=1e18,bh=0,bw=0;
  for(const s of L){const ex=s.bx-s.ax,ez=s.bz-s.az,t=clamp(((x-s.ax)*ex+(z-s.az)*ez)/s.l2,0,1),px=s.ax+ex*t-x,pz=s.az+ez*t-z,d=px*px+pz*pz;if(d<bd){bd=d;bh=s.ha+(s.hb-s.ha)*t;bw=s.w}}
  NR.d=Math.sqrt(bd);NR.h=bh;NR.w=bw;return NR}
function bumpAt(x,z){for(const b of BUMPS){const al=b.ax==='z'?z-b.z:x-b.x,cr=b.ax==='z'?x-b.x:z-b.z;if(Math.abs(al)<.35&&Math.abs(cr)<3.6)return .075*(1+Math.cos(PI*al/.35))/2}return 0}
function H(x,z,mesh){const t=terr(x,z),q=nearRoad(x,z);if(!q)return t;const hw=q.w/2;
  if(q.d<hw)return mesh?q.h-.25:q.h+bumpAt(x,z);if(lastCarve>.25)return t;
  const b=sstep(hw,hw+8,q.d);return q.h-.05+(t-q.h+.05)*b}
const roadH=(x,z)=>H(x,z);

/* collision: oriented boxes in a 20 m grid */
const GRID=new Map();
function addOBB(cx,cz,hx,hz,ry=0){const b={cx,cz,hx,hz,c:Math.cos(ry),s:-Math.sin(ry)},rr=Math.hypot(hx,hz)+.5;
  for(let gx=Math.floor((cx-rr)/20);gx<=Math.floor((cx+rr)/20);gx++)for(let gz=Math.floor((cz-rr)/20);gz<=Math.floor((cz+rr)/20);gz++){const k=gx*1000+gz;if(!GRID.has(k))GRID.set(k,[]);GRID.get(k).push(b)}}
function addBox(x0,z0,x1,z1){addOBB((x0+x1)/2,(z0+z1)/2,(x1-x0)/2,(z1-z0)/2)}
const dummy=new THREE.Object3D();
function inst(geo,mat,list,shadow=true){const m=new THREE.InstancedMesh(geo,mat,Math.max(1,list.length));m.count=list.length;list.forEach((o,i)=>{dummy.position.set(o.x,o.y||0,o.z);dummy.rotation.set(0,o.ry||0,0);dummy.scale.set(o.sx||1,o.sy||1,o.sz||1);dummy.updateMatrix();m.setMatrixAt(i,dummy.matrix);if(o.c!==undefined)m.setColorAt(i,new THREE.Color(o.c))});
  m.castShadow=shadow;m.receiveShadow=true;m.frustumCulled=false;scene.add(m);return m}
function prism(w,h,len){const s=new THREE.Shape();s.moveTo(-w/2,0);s.lineTo(w/2,0);s.lineTo(0,h);s.lineTo(-w/2,0);return new THREE.ExtrudeGeometry(s,{depth:len,bevelEnabled:false}).translate(0,0,-len/2)}
const pastel=()=>new THREE.Color().setHSL(rand(),.35+rand()*.3,.62+rand()*.18);
const TIN=[0xa8492f,0x2f5f9a,0x3d7a4a,0xb9bcc0,0x8a2f2f,0xc96f2a];
const tDet=ctex(256,256,(g,w,h)=>speck(g,w,h,'#d6d6d6',.5,9000),260);
const tRoad=ctex(128,256,(g)=>{speck(g,128,256,'#a9a6a0',.35,3500);g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,0,128,2);g.fillRect(63,0,2,256)});
const tHwy=ctex(128,256,(g)=>{speck(g,128,256,'#a9a6a0',.35,3500);g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,0,128,2);g.fillStyle='#f1efe6';g.fillRect(4,0,4,256);g.fillRect(120,0,4,256);g.fillStyle='#e6c229';g.fillRect(62,40,4,130)});
const tW=[1,2,3].map(n=>ctex(64,64*n,(g)=>{g.fillStyle='#e8e2d6';g.fillRect(0,0,64,64*n);for(let y=0;y<n;y++){g.fillStyle='#3a4a52';g.fillRect(8,y*64+14,18,24);g.fillRect(38,y*64+14,18,24);g.fillStyle='rgba(0,0,0,.25)';g.fillRect(0,y*64+60,64,4)}if(n===1){g.fillStyle='#5a3b26';g.fillRect(24,26,16,38)}}));
{
  // terrain mesh with vertex colours
  const N=280,SZ=1400,geo=new THREE.PlaneGeometry(SZ,SZ,N,N).rotateX(-PI/2),pos=geo.attributes.position,col=new Float32Array(pos.count*3),c=new THREE.Color();
  const C={sand:new THREE.Color(0xe2d2a2),grass:new THREE.Color(0x76a845),grass2:new THREE.Color(0x5e9438),forest:new THREE.Color(0x3d6b2c),rock:new THREE.Color(0x7c746a),ash:new THREE.Color(0x55504c),town:new THREE.Color(0xb3a98f),rice:new THREE.Color(0x9fd24a),rice2:new THREE.Color(0x7dbf3c),bed:new THREE.Color(0x8a7a5a)};
  for(let i=0;i<pos.count;i++){const x=pos.getX(i),z=pos.getZ(i),h=H(x,z,true),inl=inland(x,z);pos.setY(i,h);
    const dv=Math.hypot(x-VX,z-VZ),dt=Math.hypot(x-TERR.x,z-TERR.z),n=fbm(x*.03,z*.03);
    if(lastCarve>.4)c.copy(C.bed);
    else if(h<SEA+1.3&&inl<90)c.copy(C.sand);
    else if(rectD(x,z,TOWN.x+10,TOWN.z+10)<1)c.copy(C.town).lerp(C.grass,n*.35);
    else if(dt<TERR.r-30)c.copy((Math.floor(h/2.4)&1)?C.rice:C.rice2);
    else if(h>115||dv<45)c.copy(dv<30?C.ash:C.rock).lerp(C.forest,sstep(140,110,h)*.5);
    else if(h>14)c.copy(C.forest).lerp(C.grass2,n*.5);
    else c.copy(C.grass).lerp(C.grass2,n);
    col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b}
  geo.setAttribute('color',new THREE.BufferAttribute(col,3));geo.computeVertexNormals();
  geo.attributes.uv.array.forEach((v,i,a)=>a[i]=v);
  const tm=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({vertexColors:true,map:tDet,roughness:.95}));tm.receiveShadow=true;scene.add(tm);
  const sea=new THREE.Mesh(new THREE.PlaneGeometry(8000,8000).rotateX(-PI/2),new THREE.MeshStandardMaterial({color:0x1f7896,roughness:.2,metalness:.15,transparent:true,opacity:.9}));sea.position.y=SEA;scene.add(sea);
  // rice paddies: patchwork texture with dikes
  const tPad=ctex(512,512,(g)=>{g.fillStyle='#6b5a3a';g.fillRect(0,0,512,512);for(let y=0;y<10;y++)for(let x=0;x<8;x++){const r=rand();g.fillStyle=r<.45?'#8fcf45':r<.75?'#a9dd5a':r<.9?'#6fa3ad':'#c6c35a';g.fillRect(x*64+3,y*51.2+3,58,45)}});tPad.repeat.set(1,1);
  const pd=new THREE.Mesh(new THREE.PlaneGeometry(PADDY.x1-PADDY.x0,PADDY.z1-PADDY.z0).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tPad,roughness:.6}));pd.position.set((PADDY.x0+PADDY.x1)/2,.63,(PADDY.z0+PADDY.z1)/2);pd.receiveShadow=true;scene.add(pd);
  // road ribbons
  const rb={hwy:{p:[],u:[],i:[]},st:{p:[],u:[],i:[]}},rail=[],deck=[],pil=[],poles=[],wires=[];
  for(const r of ROADS){const B=r.hwy?rb.hwy:rb.st,base=B.p.length/3;let L=0;
    r.s.forEach((s,i)=>{if(i)L+=Math.hypot(s.x-r.s[i-1].x,s.z-r.s[i-1].z);const nx=-s.tz,nz=s.tx,hw=r.w/2;B.p.push(s.x+nx*hw,s.h+.04,s.z+nz*hw,s.x-nx*hw,s.h+.04,s.z-nz*hw);B.u.push(0,L/4.5,1,L/4.5);
      if(i)B.i.push(base+(i-1)*2,base+i*2,base+(i-1)*2+1,base+(i-1)*2+1,base+i*2,base+i*2+1);
      const ry=Math.atan2(-s.tz,s.tx);
      if(i%2===0&&terr(s.x,s.z)<s.h-1.2){deck.push({x:s.x,y:s.h-.3,z:s.z,ry,sx:2.2,sy:.6,sz:r.w+.6});
        for(const sd of[-1,1]){rail.push({x:s.x+nx*sd*(hw+.15),y:s.h+.55,z:s.z+nz*sd*(hw+.15),ry,sx:2.1,sy:.12,sz:.15},{x:s.x+nx*sd*(hw+.15),y:s.h+.3,z:s.z+nz*sd*(hw+.15),ry,sx:.15,sy:.6,sz:.15});addOBB(s.x+nx*sd*(hw+.2),s.z+nz*sd*(hw+.2),1.1,.12,ry)}
        if(i%10===0)pil.push({x:s.x,y:SEA-2,z:s.z,sy:s.h-SEA+1.6})}
      if((r.hwy||r.w===7)&&i%16===0&&i>0&&i<r.s.length-1&&lastCarve<.2){const px=s.x+nx*(hw+1.8),pz=s.z+nz*(hw+1.8),ph=H(px,pz);if(rectD(px,pz,30,30,40,40)>2&&rectD(px,pz,22,22,-40,40)>2){poles.push({x:px,y:ph,z:pz,ry,r});addOBB(px,pz,.2,.2)}}});
    B.base=0}
  for(const[k,B]of Object.entries(rb)){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(B.p,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(B.u,2));g.setIndex(B.i);g.computeVertexNormals();
    const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map:k==='hwy'?tHwy:tRoad,roughness:.85,polygonOffset:true,polygonOffsetFactor:-2}));m.receiveShadow=true;scene.add(m)}
  inst(new THREE.BoxGeometry(1,1,1),std(0xb5b1a8,.8),deck);inst(new THREE.BoxGeometry(1,1,1),std(0xe8e4da,.6),rail);inst(new THREE.CylinderGeometry(.6,.7,1,10).translate(0,.5,0),std(0x9a968c,.8),pil);
  // power poles + sagging wires
  inst(mergeGeometries([new THREE.CylinderGeometry(.11,.15,8,6).translate(0,4,0),new THREE.BoxGeometry(.12,.12,1.7).translate(0,7.6,0)]),std(0x8d887e,.8),poles,false);
  for(let i=1;i<poles.length;i++){const a=poles[i-1],b=poles[i];if(a.r!==b.r||Math.hypot(a.x-b.x,a.z-b.z)>45)continue;
    for(const off of[-.75,0,.75]){const ox=Math.sin(a.ry)*off,oz=Math.cos(a.ry)*off,ox2=Math.sin(b.ry)*off,oz2=Math.cos(b.ry)*off;let px=a.x+ox,py=a.y+7.7,pz=a.z+oz;
      for(let k=1;k<=6;k++){const t=k/6,x=a.x+ox+(b.x+ox2-a.x-ox)*t,z=a.z+oz+(b.z+oz2-a.z-oz)*t,y=a.y+7.7+(b.y-a.y)*t-Math.sin(PI*t)*.7;wires.push(px,py,pz,x,y,z);px=x;py=y;pz=z}}}
  {const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(wires,3));scene.add(new THREE.LineSegments(g,new THREE.LineBasicMaterial({color:0x1a1a1a})))}
  for(const b of BUMPS)inst(new THREE.BoxGeometry(7,.07,.7),std(0xe0b41a,.7),[{x:b.x,y:.06,z:b.z,ry:b.ax==='z'?0:PI/2}],false);
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
  block(-160,0,-80,80);block(-160,-80,-80,0);block(-80,-80,0,0);block(0,-80,80,0);block(-80,0,0,80,'nw');block(80,0,160,80,'e');
  [1,2,3].forEach((n,i)=>inst(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshStandardMaterial({map:tW[i],roughness:.85}),bl[i]));
  inst(new THREE.BoxGeometry(1,1,1),std(0xffffff,.5,.4),roofs);inst(new THREE.BoxGeometry(1,1,1),std(0xffffff,.7),awn,false);
  // plaza + church
  const tCourt=ctex(256,512,(g)=>{g.fillStyle='#2f7d5b';g.fillRect(0,0,256,512);g.strokeStyle='#f2f2f2';g.lineWidth=4;g.strokeRect(8,8,240,496);g.beginPath();g.moveTo(8,256);g.lineTo(248,256);g.stroke();g.beginPath();g.arc(128,256,40,0,7);g.stroke();g.beginPath();g.arc(128,8,80,0,PI);g.stroke();g.beginPath();g.arc(128,504,80,PI,0);g.stroke()});
  const pz=new THREE.Mesh(new THREE.PlaneGeometry(62,40).rotateX(-PI/2),std(0x6fae4a,.9));pz.position.set(118,.02,28);pz.receiveShadow=true;scene.add(pz);
  const ct=new THREE.Mesh(new THREE.PlaneGeometry(15,28).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tCourt,roughness:.7}));ct.position.set(98,.03,28);scene.add(ct);
  inst(mergeGeometries([new THREE.CylinderGeometry(.1,.1,3.2,6).translate(0,1.6,0),new THREE.BoxGeometry(1.8,1.1,.08).translate(0,3.4,.3)]),std(0xdedede,.5),[{x:98,z:14.6},{x:98,z:41.4,ry:PI}]);addOBB(98,14.6,.2,.2);addOBB(98,41.4,.2,.2);
  const stone=std(0xcdbb98,.95);
  const ch=new THREE.Group();ch.position.set(128,0,62);scene.add(ch);
  const cm=(g,m,x,y,z)=>{const o=new THREE.Mesh(g,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;ch.add(o);return o};
  cm(new THREE.BoxGeometry(13,10,24).translate(0,5,0),stone,0,0,0);cm(prism(14,5,25),std(0x8a3b2b,.7),0,10,0);
  cm(new THREE.BoxGeometry(15,14,1.6).translate(0,7,0),stone,0,0,-12.6);cm(prism(15,4,1.6),stone,0,14,-12.6);
  cm(new THREE.BoxGeometry(2.6,4.5,.4).translate(0,2.25,0),std(0x4a2f1f,.8),0,0,-13.5);
  cm(new THREE.BoxGeometry(5,20,5).translate(0,10,0),stone,-9.5,0,-11);cm(new THREE.ConeGeometry(3.6,4,4).rotateY(PI/4).translate(0,2,0),std(0x8a3b2b,.7),-9.5,20,-11);
  cm(new THREE.BoxGeometry(.25,2.2,.25),std(0x333333,.5),0,17,-12.6);cm(new THREE.BoxGeometry(1.2,.25,.25),std(0x333333,.5),0,17.4,-12.6);
  cm(new THREE.BoxGeometry(1.6,2,5.2),std(0x222222,.8),-9.5,15,-11);
  addOBB(128,62,6.5,12);addOBB(128,49.4,7.5,.8);addOBB(118.5,51,2.5,2.5);
  // market shed
  const mk2=[],stall=[];for(let i=0;i<4;i++)for(let j=0;j<3;j++){mk2.push({x:96+i*16,y:0,z:-60+j*20});addOBB(96+i*16,-60+j*20,.25,.25)}
  inst(new THREE.CylinderGeometry(.2,.2,6,6).translate(0,3,0),std(0x777777,.6),mk2);
  const mr=new THREE.Mesh(prism(56,4,46),std(0x9aa0a6,.5,.5));mr.rotation.y=PI/2;mr.position.set(120,6,-40);mr.castShadow=true;scene.add(mr);
  for(let i=0;i<8;i++)for(let j=0;j<2;j++){const x=100+i*5.5,z=-52+j*22;stall.push({x,y:0,z,sx:3.6,sy:1,sz:2.2,c:new THREE.Color().setHSL(rand(),.6,.55)});addOBB(x,z,1.8,1.1)}
  inst(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),std(0xffffff,.8),stall);
  // jeepneys + tricycles parked along streets
  const jeep=[],jdark=[],tri=[];
  const jbody=mergeGeometries([new THREE.BoxGeometry(2,1.25,4.6).translate(0,1.1,.4),new THREE.BoxGeometry(1.8,.75,1.4).translate(0,.85,-2.5),new THREE.BoxGeometry(2.15,.12,5.2).translate(0,2.05,.3),new THREE.BoxGeometry(1.6,.3,.25).translate(0,.5,-3.3)]);
  const jd=mergeGeometries([...[[-.95,-2.2],[.95,-2.2],[-.95,1.9],[.95,1.9]].map(([x,z])=>new THREE.CylinderGeometry(.38,.38,.28,12).rotateZ(PI/2).translate(x,.38,z)),new THREE.BoxGeometry(1.7,.6,.05).translate(0,1.55,-1.85)]);
  for(const[x,z,ry]of[[3.2,-30,0],[3.2,-18,0],[-3.2,52,PI],[-50,3.2,PI/2],[-110,-3.2,-PI/2],[-3.2,-55,PI],[83.2,-20,0],[-123,3.2,PI/2]]){const c=new THREE.Color().setHSL(rand(),.85,.5);jeep.push({x,z,ry,c});jdark.push({x,z,ry});addOBB(x,z,1.05,3.4,ry)}
  inst(jbody,std(0xffffff,.35,.4),jeep);inst(jd,std(0x111111,.8),jdark);
  const trig=mergeGeometries([new THREE.BoxGeometry(1.2,1.2,1.6).translate(.75,.95,0),new THREE.BoxGeometry(1.4,.08,2).translate(.6,1.6,0),new THREE.BoxGeometry(.25,.6,1.4).translate(-.2,.7,0)]);
  for(const[x,z,ry]of[[-3,-10,PI],[-3,-14,PI],[83,40,0],[-77,-40,0],[3,62,0]]){tri.push({x,z,ry,c:new THREE.Color().setHSL(rand(),.7,.45)});addOBB(x+Math.cos(ry)*.4,z,1.2,1.1,ry)}
  inst(trig,std(0xffffff,.45,.3),tri);
  // houses along the roads outside town: concrete bungalows and nipa huts
  const hb=[],hr=[],nipa=[],nroof=[];
  for(const r of ROADS){if(!r.hwy&&r.w!==6)continue;for(let i=6;i<r.s.length-6;i+=14){const s=r.s[i];for(const sd of[-1,1]){if(rand()>.42)continue;
    const off=r.w/2+8+rand()*5,x=s.x-s.tz*off*sd,z=s.z+s.tx*off*sd;if(rectD(x,z,TOWN.x+10,TOWN.z+10)<1)continue;const q=nearRoad(x,z);if(q&&q.d<r.w/2+5)continue;
    const h=terr(x,z);if(h<SEA+1.2||lastCarve>.05||h>45||rectD(x,z,(PADDY.x1-PADDY.x0)/2,(PADDY.z1-PADDY.z0)/2,(PADDY.x0+PADDY.x1)/2,(PADDY.z0+PADDY.z1)/2)<2)continue;
    const ry=Math.atan2(-s.tz,s.tx)+(sd>0?PI:0);
    if(rand()<.35){nipa.push({x,y:h,z,ry,sx:4.5,sy:2.6,sz:4.2,c:0xb59a5e});nroof.push({x,y:h+2.6,z,ry,sx:4.4,sy:2.4,sz:4.4});addOBB(x,z,2.3,2.2,ry)}
    else{const w=6+rand()*3,d=6+rand()*2.5;hb.push({x,y:h-.2,z,ry,sx:w,sy:3.3,sz:d,c:pastel()});hr.push({x,y:h+3.1,z,ry,sx:w+.8,sy:1,sz:d+.9,c:TIN[(rand()*TIN.length)|0]});addOBB(x,z,w/2,d/2,ry)}}}}
  inst(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),new THREE.MeshStandardMaterial({map:tW[0],roughness:.85}),hb);
  inst(prism(1,1.6,1),std(0xffffff,.5,.4),hr);
  inst(mergeGeometries([new THREE.BoxGeometry(1,.62,1).translate(0,.69,0),...[[-.42,-.42],[.42,-.42],[-.42,.42],[.42,.42]].map(([a,b])=>new THREE.BoxGeometry(.05,.4,.05).translate(a,.2,b))]),std(0xffffff,.9),nipa);
  inst(new THREE.ConeGeometry(.78,1,4).rotateY(PI/4).translate(0,.5,0),std(0x9c8350,1),nroof);
  // palms on the beaches and lowlands, rainforest on the hills
  const trunk=new THREE.CylinderGeometry(.14,.22,8,6,4).translate(0,4,0);{const p=trunk.attributes.position;for(let i=0;i<p.count;i++){const y=p.getY(i);p.setX(i,p.getX(i)+(y/8)**2*1.3)}}
  const fronds=mergeGeometries(Array.from({length:8},(_,i)=>new THREE.BoxGeometry(.55,.04,3.6).translate(0,0,1.8).rotateX(.45+(i%2)*.25).rotateY(i*PI/4).translate(1.3,8,0)));
  const palms=[],trees=[];
  for(let i=0;i<2600&&palms.length<520;i++){const th=rand()*2*PI,r=coastR(th)-8-rand()*rand()*160,x=ICX+Math.cos(th)*r,z=ICZ+Math.sin(th)*r,h=terr(x,z);
    if(h<SEA+.4||h>12||lastCarve>.05)continue;const q=nearRoad(x,z);if(q&&q.d<q.w/2+2.5)continue;if(rectD(x,z,TOWN.x,TOWN.z)<1&&rand()<.85)continue;
    palms.push({x,y:h-.1,z,ry:rand()*2*PI,sx:.8+rand()*.4,sy:.8+rand()*.5,sz:.8+rand()*.4});addOBB(x,z,.25,.25)}
  inst(trunk,std(0x7a6247,.9),palms,false);inst(fronds,std(0x4f8f2e,.8),palms,false);
  for(let i=0;i<9000&&trees.length<1900;i++){const x=(rand()-.5)*1300,z=ICZ+(rand()-.5)*1200,h=terr(x,z);if(h<10||h>150||lastCarve>.05)continue;
    if(Math.hypot(x-TERR.x,z-TERR.z)<TERR.r-20)continue;const q=nearRoad(x,z);if(q&&q.d<q.w/2+3)continue;const s=.7+rand()*.8;
    trees.push({x,y:h-.2,z,sx:s,sy:s*(.8+rand()*.5),sz:s,c:new THREE.Color().setHSL(.24+rand()*.08,.45,.22+rand()*.12)});if(q&&q.d<20)addOBB(x,z,.3,.3)}
  inst(new THREE.CylinderGeometry(.2,.28,3,5).translate(0,1.5,0),std(0x5a3d26,.9),trees,false);
  inst(new THREE.IcosahedronGeometry(2.4,0).translate(0,4.4,0),new THREE.MeshStandardMaterial({roughness:.9}),trees,false);
  // lot + gas station paving
  const tLot=tAsph.clone();tLot.repeat.set(17,17);tLot.needsUpdate=true;
  const lot=new THREE.Mesh(new THREE.PlaneGeometry(70,70).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tLot,roughness:.9}));lot.position.set(40,.015,40);lot.receiveShadow=true;scene.add(lot);
  const tGas=tCon.clone();tGas.repeat.set(10,10);tGas.needsUpdate=true;
  const gp=new THREE.Mesh(new THREE.PlaneGeometry(40,40).rotateX(-PI/2),new THREE.MeshStandardMaterial({map:tGas,roughness:.9}));gp.position.set(-40,.015,40);gp.receiveShadow=true;scene.add(gp);
}
/* minimap base image */
const MAP=document.createElement('canvas');MAP.width=MAP.height=140;
{const g=MAP.getContext('2d'),img=g.createImageData(140,140);for(let j=0;j<140;j++)for(let i=0;i<140;i++){const x=(i/140-.5)*1300,z=ICZ+(j/140-.5)*1300,h=terr(x,z),k=(j*140+i)*4;
  const c=lastCarve>.4||h<SEA?[31,120,150]:h<SEA+1.3?[226,210,162]:rectD(x,z,TOWN.x,TOWN.z)<1?[170,160,140]:h>115?[124,116,106]:h>14?[61,107,44]:[118,168,69];img.data.set([...c,235],k)}
  g.putImageData(img,0,0);g.strokeStyle='#f4f1e8';g.lineCap='round';
  for(const r of ROADS){g.lineWidth=r.hwy?2:1.3;g.beginPath();r.s.forEach((s,i)=>{const u=(s.x/1300+.5)*140,v=((s.z-ICZ)/1300+.5)*140;i?g.lineTo(u,v):g.moveTo(u,v)});g.stroke()}}

/* parking lot (block 0,0) + gas station (block -1,0) */
const freeBays=[];
{
  const lines=[],pb=[],cars=[];
  for(const rz of[22,36,50]){lines.push({x:27.2,y:.025,z:rz-1.2,sx:32,sz:.08});
    for(let k=0;k<=20;k++)lines.push({x:11.2+k*1.6,y:.025,z:rz,sx:.08,sz:2.4});
    for(let k=0;k<20;k++){const x=12+k*1.6;if(Math.random()<.45){pb.push({x,z:rz,ry:Math.random()<.5?0:PI,c:new THREE.Color().setHSL(Math.random(),.6,.4)});addBox(x-.25,rz-.95,x+.25,rz+.95)}else freeBays.push({x,z:rz})}}
  for(let k=0;k<=15;k++)lines.push({x:10.65+k*2.7,y:.025,z:64,sx:.1,sz:5});
  for(let k=0;k<15;k++){const x=12+k*2.7;if(Math.random()<.6){cars.push({x,z:64,c:new THREE.Color().setHSL(Math.random(),.5,.45)});addBox(x-.95,62-.2,x+.95,66.2)}}
  inst(new THREE.BoxGeometry(1,.012,1),new THREE.MeshBasicMaterial({color:0xf2f2f2}),lines,false);
  const bw=(r,z)=>new THREE.CylinderGeometry(r,r,.09,14).rotateZ(PI/2).translate(0,r,z);
  const bikeGeo=mergeGeometries([bw(.29,.64),bw(.29,-.64),new THREE.BoxGeometry(.24,.35,1.1).translate(0,.55,0),new THREE.BoxGeometry(.3,.22,.5).translate(0,.85,-.1),new THREE.BoxGeometry(.22,.08,.5).translate(0,.84,.35),new THREE.BoxGeometry(.66,.03,.03).translate(0,1.05,-.5)]);
  inst(bikeGeo,std(0xffffff,.5,.2),pb);
  inst(mergeGeometries([new THREE.BoxGeometry(1.8,.7,4.3).translate(0,.55,0),new THREE.BoxGeometry(1.6,.55,2.2).translate(0,1.17,.2)]),std(0xffffff,.4,.3),cars);
  // gas station
  const gx=-40,gz=40;
  inst(new THREE.BoxGeometry(1,1,1),std(0xb8bcc2,.6),[{x:gx,y:.12,z:gz-5,sx:6,sy:.24,sz:1.2},{x:gx,y:.12,z:gz+5,sx:6,sy:.24,sz:1.2}],false);
  inst(new THREE.BoxGeometry(.8,1.8,.6).translate(0,.9,0),std(0xd03028,.5),[{x:gx-1.6,y:.24,z:gz-5},{x:gx+1.6,y:.24,z:gz-5},{x:gx-1.6,y:.24,z:gz+5},{x:gx+1.6,y:.24,z:gz+5}]);
  addBox(gx-3,gz-5.6,gx+3,gz-4.4);addBox(gx-3,gz+4.4,gx+3,gz+5.6);
  const pil=[[-9,-8],[9,-8],[-9,8],[9,8]].map(([a,b])=>{addBox(gx+a-.3,gz+b-.3,gx+a+.3,gz+b+.3);return{x:gx+a,y:0,z:gz+b}});
  inst(new THREE.CylinderGeometry(.3,.3,5.4,8).translate(0,2.7,0),std(0xdddddd,.5),pil);
  inst(new THREE.BoxGeometry(20,.5,18),std(0xf4f4f0,.6),[{x:gx,y:5.6,z:gz}]);
  inst(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0x43e07a,transparent:true,opacity:.25,depthWrite:false}),[{x:gx,y:.03,z:gz,sx:12,sy:.01,sz:7}],false);
}
const marker=new THREE.Mesh(new THREE.BoxGeometry(1.4,.02,2.4),new THREE.MeshBasicMaterial({color:0x43e07a,transparent:true,opacity:.45,depthWrite:false}));
const arrow=new THREE.Mesh(new THREE.ConeGeometry(.35,.8,4).rotateX(PI),new THREE.MeshBasicMaterial({color:0x43e07a}));
marker.visible=arrow.visible=false;scene.add(marker,arrow);

export { SEA, ICX, ICZ, terr, H, roadH, nearRoad, ROADS, GRID, addBox, addOBB, freeBays, marker, arrow, MAP };
