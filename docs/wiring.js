/* Single wiring sweep adapted from the author's cluster_mutation_lab.html.
 * NOBY retains the chambers created after crossings; left boundary minors
 * specialize to 1. Vertex labels come from the current seed, not word order. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NObyWiring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  function geometry(n, word, labels, mutableCount) {
    const order = Array.from({length:n}, (_,i)=>i+1), L=word.length;
    const wires=order.map(label=>({label,points:[{x:0,y:n-label}]}));
    const chambers=[], crossings=[];
    for(let p=0;p<L;p++) {
      const k=word[p], x=p+1;
      order.forEach((label,i)=>wires[label-1].points.push({x:x-.38,y:n-1-i}));
      [order[k-1],order[k]]=[order[k],order[k-1]];
      order.forEach((label,i)=>wires[label-1].points.push({x:x+.38,y:n-1-i}));
      const key=order.slice(0,k).sort((a,b)=>a-b).join(',');
      const vertex=labels.indexOf(key), next=word.indexOf(k,p+1);
      if(vertex<0) throw new Error('Wiring chamber is absent from the seed.');
      chambers.push({vertex,key,gap:k,left:x,right:next<0?L+1:next+1,
        x:(x+(next<0?L+1:next+1))/2,y:n-k-.5,frozen:vertex>=mutableCount});
      crossings.push({x,y:n-k-.5,generator:k});
    }
    order.forEach((label,i)=>wires[label-1].points.push({x:L+1,y:n-1-i}));
    // Geometric chamber endpoints give the arrows independently of mutation.
    const B=Array.from({length:L},()=>Array(mutableCount).fill(0));
    function arrow(a,b) {if(b<mutableCount)B[a][b]--;if(a<mutableCount)B[b][a]++;}
    for(const a of chambers) for(const b of chambers) {
      if(a.vertex===b.vertex || (a.frozen&&b.frozen))continue;
      const ar=a.frozen?Infinity:a.right, br=b.frozen?Infinity:b.right;
      if(a.gap===b.gap && a.right===b.left)arrow(b.vertex,a.vertex);
      if(Math.abs(a.gap-b.gap)===1 && a.left<b.left && b.left<ar && ar<br)arrow(a.vertex,b.vertex);
    }
    return {n,word:word.slice(),wires,chambers,crossings,B};
  }
  return {geometry};
});
