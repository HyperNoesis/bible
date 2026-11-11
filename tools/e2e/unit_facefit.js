const vm=require('vm'),fs=require('fs'),path=require('path');const ctx={self:{}};ctx.self=ctx;vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../../js/face-fit-core.js'),'utf8'),ctx);const F=ctx.VS.FaceFit;let bad=0;
const t=(n,ok,x)=>{if(!ok)bad++;console.log((ok?'PASS ':'FAIL ')+n+(x!==undefined?' -> '+x:''))};
// synthetic 468-pt face: forehead(10) top, chin(152) bottom, eyes at 38% of the way down
function face(cx,top,h){const lm=Array.from({length:468},()=>({x:cx,y:top+h/2}));lm[10]={x:cx,y:top};lm[152]={x:cx,y:top+h};
  const ey=top+h*0.38;lm[33]={x:cx-0.05*h,y:ey};lm[263]={x:cx+0.05*h,y:ey};lm[133]={x:cx-0.02*h,y:ey};lm[362]={x:cx+0.02*h,y:ey};lm[234]={x:cx-0.4*h,y:ey};lm[454]={x:cx+0.4*h,y:ey};return lm}
// replicate CompositionEngine.computeFrame to check the RESULT really lands the face where we want it
function frame(w,h,ratio,zoom,px,py){let cw,ch;if(w/h>ratio){ch=h;cw=h*ratio}else{cw=w;ch=w/ratio}cw/=zoom;ch/=zoom;
  let sx=Math.min(Math.max(px*w-cw/2,0),w-cw),sy=Math.min(Math.max(py*h-ch/2,0),h-ch);return{sx,sy,sw:cw,sh:ch}}
const W=1280,H=720,R=9/16;
const m=F.faceMetrics(face(0.5,0.30,0.20));t('metrics read',m&&Math.abs(m.h-0.20)<1e-9);
const r=F.fitHead(F.combine([m,m,m,m,m]),W,H,R);const fr=frame(W,H,R,r.zoom,r.panX,r.panY);
t('face ends ~30% of frame height',Math.abs((m.h*H)/fr.sh-0.30)<0.03,((m.h*H)/fr.sh).toFixed(3));
t('eyes end ~38% from top',Math.abs((m.eyeY*H-fr.sy)/fr.sh-0.38)<0.03,((m.eyeY*H-fr.sy)/fr.sh).toFixed(3));
t('zoom within limits',r.zoom>=1&&r.zoom<=3,r.zoom);
const big=F.fitHead(F.combine([F.faceMetrics(face(0.5,0.1,0.6))].concat([0,0,0,0].map(()=>F.faceMetrics(face(0.5,0.1,0.6))))),W,H,R);
t('too close: zoom 1 and says move back',big.zoom===1&&/move back/.test(big.note),big.note);
const far=F.fitHead(F.combine(Array(5).fill(F.faceMetrics(face(0.5,0.4,0.04)))),W,H,R);
t('too far: zoom 3 and says move closer',far.zoom===3&&/closer/.test(far.note),far.note);
const edge=F.fitHead(F.combine(Array(5).fill(F.faceMetrics(face(0.93,0.3,0.2)))),W,H,R);
t('face at the edge is clamped, flagged',edge.clamped===true&&edge.panX<=1&&edge.panX>=0);
t('too few samples -> null',F.combine([m,null,null,m])===null);
t('median ignores one bad frame',Math.abs(F.combine([m,m,m,F.faceMetrics(face(0.5,0.3,0.5)),m]).h-0.20)<1e-9);
t('no face -> null',F.faceMetrics(null)===null&&F.faceMetrics([])===null);
t('bad size -> null',F.fitHead(m,0,720,0.5)===null);
process.exit(bad?1:0);
