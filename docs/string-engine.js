/* Type A string polytopes: GP paths, a zero-tail face for X(w), and weights.
 * No stored inequalities are input. See notebooks/gp_string_data.py and the
 * independent original SL5 constructor / Demazure-crystal verification.
 */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.NObyStrings=api;})(globalThis,function(){
  'use strict';
  const LP=typeof module==='object'&&module.exports?require('./engine.js'):globalThis.NObyEngine;
  function check(ok,message){if(!ok)throw new Error(message);}
  function compute(word,weight,options={}){
    check(Array.isArray(word)&&Array.isArray(weight),'Enter lists of integer coefficients.');
    const rank=weight.length,N=rank*(rank+1)/2,d=word.length;
    check(rank>=1&&rank<=7,'This browser supports type A ranks 1–7 (SL₂–SL₈).');
    check(weight.every(a=>Number.isSafeInteger(a)&&a>=0&&a<=1000000),'λ must have nonnegative integer coefficients, at most 1,000,000.');
    check(d<=N&&word.every(a=>Number.isSafeInteger(a)&&a>=1&&a<=rank),'Word indices must lie in 1,…,'+rank+' and length must be at most '+N+'.');
    const order=Array.from({length:rank+1},(_,i)=>i+1),extended=word.slice();
    for(const a of word){check(order[a-1]<order[a],'The word is not reduced: a crossing decreases the permutation length.');[order[a-1],order[a]]=[order[a],order[a-1]];}
    const permutation=order.slice();
    while(extended.length<N){const j=order.findIndex((a,i)=>i<rank&&a<order[i+1]);check(j>=0,'Could not complete the reduced word.');[order[j],order[j+1]]=[order[j+1],order[j]];extended.push(j+1);}
    const wiring=Array.from({length:rank+1},(_,i)=>i+1),wires=Array.from({length:rank+2},()=>[]),crossings=[];
    extended.forEach((a,t)=>{const u=wiring[a-1],v=wiring[a];crossings.push([u,v]);wires[u].push(t);wires[v].push(t);[wiring[a-1],wiring[a]]=[v,u];});
    const next=new Map();
    for(let wire=1;wire<=rank+1;wire++)wires[wire].forEach((node,j)=>{next.set(node+','+wire+',-1',j?wires[wire][j-1]:-1);next.set(node+','+wire+',1',j+1<wires[wire].length?wires[wire][j+1]:N);});
    const paths=[],normals=new Map(),started=Date.now();let visits=0;
    const limit=options.maxVisits||1000000,maxTime=options.maxMilliseconds||10000;
    for(let k=1;k<=rank;k++){
      function visit(node,wire,visited,turns,used,coeff){
        check(++visits<=limit,'GP path search reached its size limit. Try a smaller rank; the Sage notebook also supports this input.');
        if(visits%1024===0)check(Date.now()-started<maxTime,'GP path search reached its time limit. Try a smaller rank.');
        if(node===N){if(wire===k+1){const normal=coeff.slice(0,d);if(normal.some(Boolean)){normals.set(normal.join(','),normal);paths.push({k,visited_nodes:visited.map(j=>j+1),turn_nodes:turns.map(j=>j+1),wires:used,ambient_normal:coeff,normal});}}return;}
        if(node<0||visited.includes(node))return;
        const [u,v]=crossings[node],other=wire===u?v:u,same=(u<=k)===(v<=k),forbidden=same&&(wire<=k?wire===u:wire===v);
        for(const dest of [wire,other]){if(dest===wire&&forbidden)continue;const normal=coeff.slice(),turn=dest!==wire;if(turn)normal[node]=wire<dest?1:-1;visit(next.get(node+','+dest+','+(dest<=k?-1:1)),dest,[...visited,node],turn?[...turns,node]:turns,turn?[...used,dest]:used,normal);}
      }
      visit(wires[k].at(-1),k,[],[],[k],Array(N).fill(0));
    }
    const compare=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]-b[i];return 0;};
    const cone_H=[...normals.values()].sort(compare).map(a=>[0,...a]);
    const weight_H=word.map((root,j)=>[weight[root-1],...word.map((a,t)=>t<j?0:t===j?-1:a===root?-2:Math.abs(a-root)===1?1:0)]);
    return {word:word.slice(),weight:weight.slice(),rank,dimension:d,permutation,longest:d===N,completion_word:extended,zero_coordinates:Array.from({length:N-d},(_,i)=>d+i+1),paths,cone_H,weight_H,H:d?[...cone_H,...weight_H]:[[0]],coordinates:'unshifted string coordinates in reduced-word order',H_convention:'constant + normal dot x >= 0',generation:'GP paths and zero-tail Schubert face; no inequality table',milliseconds:Date.now()-started};
  }
  // Exact rational vertex enumeration for small ambient dimension only.
  const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b)[a,b]=[b,a%b];return a;};
  const q=(n,d=1n)=>{n=BigInt(n);d=BigInt(d);if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return [n/g,d/g];};
  const add=(a,b)=>q(a[0]*b[1]+b[0]*a[1],a[1]*b[1]);
  const neg=a=>[-a[0],a[1]],mul=(a,b)=>q(a[0]*b[0],a[1]*b[1]),div=(a,b)=>q(a[0]*b[1],a[1]*b[0]);
  function reduce(rows,cols){const A=rows.map(r=>r.map(x=>x.slice()));let pivot=0;for(let j=0;j<cols&&pivot<A.length;j++){const p=A.findIndex((r,i)=>i>=pivot&&r[j][0]!==0n);if(p<0)continue;[A[p],A[pivot]]=[A[pivot],A[p]];const v=A[pivot][j];A[pivot]=A[pivot].map(x=>div(x,v));for(let i=0;i<A.length;i++)if(i!==pivot){const factor=A[i][j];A[i]=A[i].map((x,t)=>add(x,neg(mul(factor,A[pivot][t]))));}pivot++;}return {A,rank:pivot};}
  const text=x=>x[1]===1n?String(x[0]):x[0]+'/'+x[1];
  function ambientGeometry(record){
    const d=record.dimension,H=record.H;
    if(d>4)return {status:'not-computed',reason:'Vertex enumeration in this browser is limited to at most four string coordinates. Use the SageMath notebook for larger polytopes.'};
    if(!d)return {status:'complete',dimension:0,vertices:[[]],approximate_vertices:[[]],edges:[],f_vector:[1,1]};
    let combinations=1;for(let j=0;j<d;j++)combinations=combinations*(H.length-j)/(j+1);
    if(combinations>50000)return {status:'not-computed',reason:'The exact vertex search exceeds this browser limit. Use the SageMath notebook.'};
    const rows=H.map(h=>h.map(x=>q(x))),vertices=new Map();
    function choose(ids,start){if(ids.length<d){for(let i=start;i<=H.length-(d-ids.length);i++)choose([...ids,i],i+1);return;}
      const solved=reduce(ids.map(i=>[...rows[i].slice(1),neg(rows[i][0])]),d);if(solved.rank!==d)return;
      const v=solved.A.map(r=>r[d]);const values=rows.map(h=>h.slice(1).reduce((s,a,i)=>add(s,mul(a,v[i])),h[0]));
      if(values.some(x=>x[0]<0n))return;vertices.set(v.map(text).join(','),{v,active:values.flatMap((x,i)=>x[0]===0n?[i]:[])});
    }
    choose([],0);const values=[...vertices.values()];check(values.length,'No vertices found for this bounded input.');
    const dimension=reduce(values.slice(1).map(({v})=>v.map((x,j)=>add(x,neg(values[0].v[j])))),d).rank,edges=[];
    for(let i=0;i<values.length;i++)for(let j=i+1;j<values.length;j++){const common=values[i].active.filter(k=>values[j].active.includes(k));if(reduce(common.map(k=>rows[k].slice(1)),d).rank===d-1)edges.push([i,j]);}
    const v=values.length,e=edges.length,f=dimension===0?[1,1]:dimension===1?[1,2,1]:dimension===2?[1,v,e,1]:dimension===3?[1,v,e,e-v+2,1]:null;
    return {status:'complete',dimension,vertices:values.map(({v})=>v.map(text)),approximate_vertices:values.map(({v})=>v.map(x=>Number(x[0])/Number(x[1]))),edges,f_vector:f};
  }
  const parse=x=>{const [a,b='1']=String(x).split('/');return q(a,b);};
  const dot=(a,b)=>a.reduce((s,x,i)=>add(s,mul(x,b[i])),q(0));
  function primitive(row){let den=1n;for(const x of row)den=den/gcd(den,x[1])*x[1];let nums=row.map(x=>x[0]*(den/x[1])),g=nums.reduce((s,x)=>gcd(s,x),0n)||1n;nums=nums.map(x=>x/g);check(nums.every(x=>Number.isSafeInteger(Number(x))),'Reduced coefficients exceed exact integer range.');return nums.map(Number);}
  // An inequality with zero constant is an affine equation exactly when its
  // maximum slack is zero. All these string polytopes contain the origin.
  function geometry(record){
    const d=record.dimension;
    let g,basis,free;
    if(record.weight.every(x=>x===0)){
      g={status:'complete',dimension:0,vertices:[Array(d).fill('0')],approximate_vertices:[Array(d).fill(0)],edges:[],f_vector:[1,1]};
    }else if(d<=4){g=ambientGeometry(record);}
    else if(record.weight.every(x=>x>0)){return {status:'not-computed',dimension:d,reason:'This polytope has more than three dimensions. Exact inequalities are available; use the SageMath notebook for its full geometry.'};}
    else{
      try{
        const started=Date.now(),equations=[];
        for(const h of record.H.filter(h=>h[0]===0)){
          const remaining=15000-(Date.now()-started);check(remaining>0,'Affine-span calculation reached its time limit.');
          const maximum=LP.linearMaximum(record.H,h.slice(1),{maxMilliseconds:remaining,maxPivots:100000});
          if(!maximum.unbounded&&maximum.numerator==='0')equations.push(h.slice(1).map(x=>q(x)));
        }
        const reduced=reduce(equations,d),pivots=reduced.A.slice(0,reduced.rank).map(row=>row.findIndex(x=>x[0]!==0n));
        free=Array.from({length:d},(_,i)=>i).filter(i=>!pivots.includes(i));
        if(free.length>4)return {status:'not-computed',dimension:free.length,reason:'This polytope has '+free.length+' dimensions. Use the SageMath notebook for its full geometry.'};
        basis=Array.from({length:d},()=>free.map(()=>q(0)));
        free.forEach((j,k)=>basis[j][k]=q(1));
        pivots.forEach((j,i)=>free.forEach((t,k)=>basis[j][k]=neg(reduced.A[i][t])));
        const H=record.H.map(h=>primitive([q(h[0]),...free.map((_,k)=>dot(h.slice(1).map(x=>q(x)),basis.map(row=>row[k])))]));
        g=ambientGeometry({dimension:free.length,H});
        if(g.status!=='complete')return g;
        const vertices=g.vertices.map(v=>basis.map(row=>text(dot(row,v.map(parse)))));
        g={...g,vertices,approximate_vertices:vertices.map(v=>v.map(x=>{const a=parse(x);return Number(a[0])/Number(a[1]);}))};
      }catch(error){return {status:'not-computed',reason:error.message+' Use the SageMath notebook for this input.'};}
    }
    if(g.status!=='complete')return g;
    // Choose independent original coordinates, and reconstruct all the others.
    // This enumerates the original lattice, not a projected or saturated lattice.
    const exact=g.vertices.map(v=>v.map(parse));
    const span=reduce(exact.slice(1).map(v=>v.map((x,j)=>add(x,neg(exact[0][j])))),d);
    const spanRows=span.A.slice(0,span.rank);
    free=spanRows.map(row=>row.findIndex(x=>x[0]!==0n));
    basis=Array.from({length:d},(_,j)=>spanRows.map(row=>row[j]));
    g.lattice_coordinates=free;
    g.lattice_basis=basis.map(row=>row.map(text));
    g.lattice_origin=g.vertices[0];
    // Independent normals describe true boundary faces; equations of the affine
    // span must not classify every point of a lower-dimensional polytope as boundary.
    const values=record.H.map(h=>exact.map(v=>add(q(h[0]),dot(h.slice(1).map(x=>q(x)),v))));
    g.boundary_rows=values.flatMap((row,i)=>row.some(x=>x[0]>0n)?[i]:[]);
    g.faces=[];const faceKeys=new Set();
    if(g.dimension>=2&&g.dimension<=3)for(const i of g.boundary_rows){
      const ids=values[i].flatMap((x,j)=>x[0]===0n?[j]:[]);
      if(ids.length<g.dimension)continue;
      const rank=reduce(ids.slice(1).map(j=>exact[j].map((x,k)=>add(x,neg(exact[ids[0]][k])))),d).rank;
      const key=ids.join(',');if(rank===g.dimension-1&&!faceKeys.has(key)){faceKeys.add(key);g.faces.push(ids);}
    }
    return g;
  }
  const floor=x=>x[0]>=0n?x[0]/x[1]:-((-x[0]+x[1]-1n)/x[1]);
  const ceil=x=>-floor(neg(x));
  function latticePoints(record,g,options={}){
    if(g.status!=='complete'||g.dimension>3)return {status:'not-computed',reason:'Lattice points are displayed for polytopes of dimension at most three.'};
    const free=g.lattice_coordinates,basis=g.lattice_basis.map(row=>row.map(parse)),origin=g.lattice_origin.map(parse),H=record.H.map(h=>h.map(x=>q(x)));
    const exact=g.vertices.map(v=>v.map(parse)),bounds=free.map(j=>{
      const vals=exact.map(v=>v[j]).sort((a,b)=>Number(a[0]*b[1]-b[0]*a[1]));return [ceil(vals[0]),floor(vals.at(-1))];
    });
    const offsets=origin.map((v,j)=>add(v,neg(dot(basis[j],free.map(k=>origin[k])))));
    const rows=H.map(h=>[add(h[0],dot(h.slice(1),offsets)),...free.map((_,k)=>dot(h.slice(1),basis.map(row=>row[k])))]).map(primitive).map(row=>row.map(BigInt));
    const points=[],kinds=[],chosen=[],started=Date.now(),maxPoints=options.maxPoints??50000,maxVisits=options.maxVisits??2000000;
    let visits=0,interior=0,boundary=0;
    try{
      function visit(k){
        check(++visits<=maxVisits&&Date.now()-started<(options.maxMilliseconds??10000),'The complete lattice-point search exceeds this browser limit. Use a smaller weight or the SageMath notebook; no partial point set is shown.');
        if(k<free.length){
          let [lo,hi]=bounds[k];
          for(const h of rows){let remainder=h[0];for(let j=0;j<k;j++)remainder+=h[j+1]*chosen[j];for(let j=k+1;j<free.length;j++)remainder+=h[j+1]*(h[j+1]>=0n?bounds[j][1]:bounds[j][0]);
            const a=h[k+1];if(a>0n)lo=lo>ceil(q(-remainder,a))?lo:ceil(q(-remainder,a));else if(a<0n)hi=hi<floor(q(-remainder,a))?hi:floor(q(-remainder,a));else if(remainder<0n)return;
          }
          for(let value=lo;value<=hi;value++){chosen[k]=value;visit(k+1);}return;
        }
        const v=offsets.map((offset,j)=>add(offset,dot(basis[j],chosen.map(x=>q(x)))));
        if(v.some(x=>x[1]!==1n))return;
        const slacks=H.map(h=>add(h[0],dot(h.slice(1),v)));if(slacks.some(x=>x[0]<0n))return;
        check(points.length<maxPoints,'This polytope has more than '+maxPoints.toLocaleString()+' lattice points. Use a smaller weight or the SageMath notebook; no partial point set is shown.');
        const onBoundary=g.boundary_rows.some(i=>slacks[i][0]===0n);
        points.push(v.map(x=>Number(x[0])));kinds.push(onBoundary?'boundary':'interior');if(onBoundary)boundary++;else interior++;
      }
      visit(0);return {status:'complete',points,kinds,total:points.length,interior,boundary,interior_convention:'relative interior in the affine span',milliseconds:Date.now()-started};
    }catch(error){return {status:'not-computed',reason:error.message};}
  }
  return {compute,geometry,latticePoints};
});
