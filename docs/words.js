/* Reduced words of w0 -> actual chamber-minor seeds, via Coxeter moves.
 * Vertex labels stay fixed in the initial seed throughout the path. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NObyWords = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const assert = (test, message) => { if (!test) throw new Error(message); };
  function initialWord(n) {
    return Array.from({length:n-1}, (_,i) => Array.from({length:i+1}, (_,j)=>i+1-j)).flat();
  }
  function validate(n, word) {
    assert(Number.isInteger(n) && n >= 3 && n <= 6, 'Reduced-word input supports SL3 through SL6.');
    assert(Array.isArray(word) && word.length === n*(n-1)/2,
      'A reduced word for w₀ in SL' + n + ' must have exactly ' + n*(n-1)/2 + ' entries.');
    assert(word.every(k => Number.isInteger(k) && k >= 1 && k < n),
      'Reduced-word entries are simple-reflection indices from 1 to ' + (n-1) + '.');
    const p = Array.from({length:n}, (_,i)=>i+1);
    for (const k of word) {
      assert(p[k-1] < p[k], 'This word is not reduced: a step decreases the inversion number.');
      [p[k-1],p[k]] = [p[k],p[k-1]];
    }
    assert(p.every((v,i)=>v===n-i), 'The word must represent the longest permutation w₀.');
    return word;
  }
  // A position k carries the flag minor with row set w_<=k({1,...,i_k}).
  function chambers(n, word) {
    const p = Array.from({length:n}, (_,i)=>i+1);
    return word.map(k => {
      [p[k-1],p[k]] = [p[k],p[k-1]];
      return p.slice(0,k).sort((a,b)=>a-b).join(',');
    });
  }
  function neighbors(key) {
    const result = [];
    for (let i=0; i<key.length-1; i++) {
      if (Math.abs(Number(key[i])-Number(key[i+1]))>1)
        result.push(key.slice(0,i)+key[i+1]+key[i]+key.slice(i+2));
      if (i+2<key.length && key[i]===key[i+2] && Math.abs(Number(key[i])-Number(key[i+1]))===1)
        result.push(key.slice(0,i)+key[i+1]+key[i]+key[i+1]+key.slice(i+3));
    }
    return result;
  }
  // Bidirectional search in the finite reduced-word graph, not in the cluster
  // exchange graph (the latter is infinite for SL6).
  function wordPath(n, target) {
    validate(n,target);
    const start=initialWord(n).join(''), end=target.join('');
    if (start===end) return [initialWord(n)];
    const parents=[new Map([[start,null]]),new Map([[end,null]])];
    const fronts=[[start],[end]];
    let meeting=null;
    while (fronts[0].length && fronts[1].length && !meeting) {
      const side=fronts[0].length<=fronts[1].length?0:1, next=[];
      outer: for (const key of fronts[side]) for (const child of neighbors(key)) {
        if (parents[side].has(child)) continue;
        parents[side].set(child,key); next.push(child);
        if (parents[1-side].has(child)) { meeting=child; break outer; }
      }
      fronts[side]=next;
    }
    assert(meeting, 'Could not connect the reduced word to the initial word.');
    const left=[],right=[];
    for(let key=meeting; key!==null; key=parents[0].get(key)) left.push(key);
    for(let key=parents[1].get(meeting); key!==null; key=parents[1].get(key)) right.push(key);
    return left.reverse().concat(right).map(key=>Array.from(key,Number));
  }
  function resolve(n, target) {
    const path=wordPath(n,target), slots=chambers(n,path[0]), sequence=[], moves=[];
    const mutableCount=(n-1)*(n-2)/2;
    for (let i=1;i<path.length;i++) {
      const before=chambers(n,path[i-1]), after=chambers(n,path[i]);
      const removed=before.filter(x=>!after.includes(x)), added=after.filter(x=>!before.includes(x));
      assert(removed.length===added.length && removed.length<=1, 'Invalid chamber transition.');
      let direction=null;
      if (removed.length) {
        const slot=slots.indexOf(removed[0]);
        assert(slot>=0 && slot<mutableCount, 'A braid move attempted to mutate a frozen chamber.');
        direction=slot+1; sequence.push(direction); slots[slot]=added[0];
      }
      moves.push({word:path[i],direction});
    }
    return {word:target.slice(), sequence, chamberLabels:slots,
      wordPositionToVertex:chambers(n,target).map(x=>slots.indexOf(x)+1), moves};
  }
  // Independent word quiver: successor edges and interlacing adjacent roots.
  function wordMatrix(n, word, slots) {
    const labels=chambers(n,word), N=word.length, r=(n-1)*(n-2)/2;
    const vertices=labels.map(x=>slots.indexOf(x));
    assert(vertices.every(x=>x>=0), 'Missing chamber label.');
    const next=word.map((a,p)=>{const q=word.indexOf(a,p+1);return q<0?N:q;});
    const B=Array.from({length:N},()=>Array(r).fill(0));
    function arrow(p,q) {
      const a=vertices[p],b=vertices[q];
      if(b<r) B[a][b]--;
      if(a<r) B[b][a]++;
    }
    for(let p=0;p<N;p++) {
      if(next[p]<N) arrow(next[p],p);
      for(let q=p+1;q<N;q++) if(Math.abs(word[p]-word[q])===1 && q<next[p] && next[p]<next[q]) arrow(p,q);
    }
    return B;
  }
  return {initialWord, validate, chambers, neighbors, wordPath, resolve, wordMatrix};
});
