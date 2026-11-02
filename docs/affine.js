(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.NObyAffine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const inverseCache=new WeakMap();
  const gcd=(a,b)=>{a=a<0n?-a:a;b=b<0n?-b:b;while(b){[a,b]=[b,a%b];}return a;};
  function f(a,b=1n){if(!b)throw new Error('Singular affine matrix.');if(b<0n){a=-a;b=-b;}const d=gcd(a,b);return [a/d,b/d];}
  const sub=(a,b)=>f(a[0]*b[1]-b[0]*a[1],a[1]*b[1]);
  const mul=(a,b)=>f(a[0]*b[0],a[1]*b[1]);
  const div=(a,b)=>f(a[0]*b[1],a[1]*b[0]);
  function number(a){const x=Number(a);if(!Number.isSafeInteger(x)||BigInt(x)!==a)throw new Error('Affine calculation exceeds the exact integer range.');return x;}
  function inverse(A){
    if(inverseCache.has(A))return inverseCache.get(A);
    const n=A.length,M=A.map((row,i)=>row.map(x=>f(BigInt(x))).concat(Array.from({length:n},(_,j)=>f(i===j?1n:0n))));
    let determinant=f(1n);
    for(let k=0;k<n;k++){
      const p=M.findIndex((row,i)=>i>=k&&row[k][0]!==0n);
      if(p<0)throw new Error('Singular affine matrix.');
      if(p!==k){[M[p],M[k]]=[M[k],M[p]];determinant=mul(determinant,f(-1n));}
      const pivot=M[k][k];determinant=mul(determinant,pivot);M[k]=M[k].map(x=>div(x,pivot));
      for(let i=0;i<n;i++)if(i!==k){const factor=M[i][k];M[i]=M[i].map((x,j)=>sub(x,mul(factor,M[k][j])));}
    }
    if(determinant[1]!==1n||(determinant[0]!==1n&&determinant[0]!==-1n))throw new Error('The affine matrix is not unimodular.');
    const result={A:M.map(row=>row.slice(n).map(x=>{if(x[1]!==1n)throw new Error('Nonintegral inverse.');return number(x[0]);})),determinant:number(determinant[0])};
    inverseCache.set(A,result);return result;
  }
  const dot=(a,b)=>number(a.reduce((s,x,i)=>s+BigInt(x)*BigInt(b[i]),0n));
  const multiply=(A,B)=>A.map(row=>B[0].map((_,j)=>dot(row,B.map(r=>r[j]))));
  function between(source,target){
    if(source.representative!==target.representative)throw new Error('The selected polytopes have different unimodular representatives.');
    const inv=inverse(target.A),A=multiply(inv.A,source.A);
    const b=inv.A.map(row=>dot(row,source.b.map((x,i)=>number(BigInt(x)-BigInt(target.b[i])))));
    const determinant=inverse(A).determinant;
    return {A,b,determinant};
  }
  // live coordinate i corresponds to stored coordinate permutation[i].
  function relabel(certificate,permutation){
    if(permutation.length!==certificate.A.length||new Set(permutation).size!==permutation.length||permutation.some(x=>!Number.isInteger(x)||x<0||x>=permutation.length))throw new Error('Invalid coordinate permutation.');
    return {...certificate,A:certificate.A.map(row=>permutation.map(i=>row[i]))};
  }
  function verify(sourceH,targetH,map){
    const key=H=>H.map(row=>row.join(',')).sort().join(';');
    const pullback=targetH.map(row=>[number(BigInt(row[0])+BigInt(dot(row.slice(1),map.b))),...map.A[0].map((_,j)=>dot(row.slice(1),map.A.map(r=>r[j])))]);
    if(key(sourceH)!==key(pullback))throw new Error('The map failed the exact facet-inequality check.');
    inverse(map.A);return true;
  }
  return {inverse,between,relabel,verify,multiply};
});
