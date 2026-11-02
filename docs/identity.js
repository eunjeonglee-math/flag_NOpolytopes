/* Identity is certified in the principal-coefficient lift. It is not inferred
 * from an f-vector, the polytope, or the exchange matrix alone. */
(function(root,factory){
  const api=factory(typeof module==='object'&&module.exports?require('./engine.js'):root.NObyEngine);
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.NObyIdentity=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(E){
  'use strict';
  const cache=new Map();
  const columns=M=>M[0].map((_,j)=>M.map(row=>row[j]).join(','));
  function describe(n,sequence){
    const key=n+':'+sequence.join(',');
    if(cache.has(key))return cache.get(key);
    const initial=E.initialSeed(n),N=initial.dimension,r=initial.mutableCount;
    const unit=()=>Array.from({length:r},(_,i)=>Array.from({length:r},(_,j)=>Number(i===j)));
    let extended=initial.B.concat(unit()),G=unit();
    for(const direction of sequence){
      const k=direction-1;
      if(!Number.isInteger(k)||k<0||k>=r)throw new Error('Invalid mutation direction in seed identity.');
      const col=extended.slice(N).map(row=>row[k]);
      const sign=col.find(x=>x!==0)>0?1:-1;
      if(!col.every(x=>sign*x>=0))throw new Error('Principal coefficients lost sign coherence.');
      const g=G.map(row=>{
        const exact=-BigInt(row[k])+row.reduce((s,x,i)=>s+BigInt(x)*BigInt(Math.max(-sign*extended[i][k],0)),0n);
        const value=Number(exact);
        if(!Number.isSafeInteger(value)||BigInt(value)!==exact)throw new Error('Seed identity exceeds the exact integer range.');
        return value;
      });
      G=G.map((row,i)=>row.map((x,j)=>j===k?g[i]:x));
      extended=E.mutateMatrix(extended,k);
    }
    const C=extended.slice(N),keys=columns(C),B=extended.slice(0,N);
    const result={n,sequence:sequence.slice(),B,C,G,columns:keys,key:n+'|'+keys.slice().sort().join(';')};
    cache.set(key,result);if(cache.size>1600)cache.delete(cache.keys().next().value);
    return result;
  }
  // permutation[i] is the candidate's vertex for live vertex i; frozen fixed.
  function compare(live,candidate){
    if(live.key!==candidate.key)return null;
    const r=live.C.length,N=live.B.length;
    const permutation=live.columns.map(x=>candidate.columns.indexOf(x));
    if(new Set(permutation).size!==r||permutation.includes(-1))return null;
    for(let i=r;i<N;i++)permutation.push(i);
    if(!live.B.every((row,i)=>row.every((x,j)=>x===candidate.B[permutation[i]][permutation[j]])))return null;
    return {permutation,sameLabels:permutation.every((x,i)=>x===i)};
  }
  function reconstructWord(n,chambers){
    const remaining=new Set(chambers),p=Array.from({length:n},(_,i)=>i+1),word=[];
    function visit(){
      if(!remaining.size)return p.every((v,i)=>v===n-i);
      for(let k=1;k<n;k++){
        if(p[k-1]>p[k])continue;
        [p[k-1],p[k]]=[p[k],p[k-1]];
        const label=p.slice(0,k).sort((a,b)=>a-b).join(',');
        if(remaining.has(label)){
          remaining.delete(label);word.push(k);
          if(visit())return true;
          word.pop();remaining.add(label);
        }
        [p[k-1],p[k]]=[p[k],p[k-1]];
      }
      return false;
    }
    return visit()?word:null;
  }
  function commutationWords(word){
    const start=word.join(''),seen=new Set([start]),queue=[start];
    for(let i=0;i<queue.length;i++){
      const key=queue[i];
      for(let j=0;j<key.length-1;j++)if(Math.abs(Number(key[j])-Number(key[j+1]))>1){
        const next=key.slice(0,j)+key[j+1]+key[j]+key.slice(j+2);
        if(!seen.has(next)){seen.add(next);queue.push(next);}
      }
    }
    return queue.sort().map(key=>Array.from(key,Number));
  }
  function reducedWords(live,minorData,W){
    if(!minorData)return null;
    const mutable=columns(live.G).map(key=>minorData[key]);
    if(mutable.some(x=>!x))return [];
    const r=live.C.length,initial=W.chambers(live.n,W.initialWord(live.n));
    const chambers=mutable.concat(initial.slice(r));
    const word=reconstructWord(live.n,chambers);
    if(!word)return [];
    const plan=W.resolve(live.n,word);
    if(!compare(live,describe(live.n,plan.sequence)))return [];
    return commutationWords(word);
  }
  return {describe,compare,columns,reconstructWord,commutationWords,reducedWords};
});
