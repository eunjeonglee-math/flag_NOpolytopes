(function(){
  'use strict';
  const $=id=>document.getElementById(id),refs=window.NOBY_STRING_WORDS;
  let worker=null,request=0,result=null;
  const viewer=NObyStringPlot.mount($('string-plot'),{slider:$('string-rotation'),reset:$('string-view-reset'),info:$('string-point-info'),note:$('string-plot-note')});
  const format=a=>'['+a.join(', ')+']',sub=n=>String(n).replace(/\d/g,d=>'₀₁₂₃₄₅₆₇₈₉'[d]);
  function list(text){text=text.trim();if(!text||text==='[]')return [];let a;if(text.startsWith('['))a=JSON.parse(text);else a=text.split(/[\s,]+/).map(x=>Number(x));if(!Array.isArray(a)||!a.every(Number.isSafeInteger))throw new Error('Use a list of integers, for example [1, 2, 1].');return a;}
  function natural(n){return Array.from({length:n-1},(_,j)=>Array.from({length:j+1},(_,k)=>j+1-k)).flat();}
  function setupRank(){const n=Number($('string-n').value);$('string-word-help').textContent='Any reduced word is allowed; [] represents the identity.';$('string-weight-help').textContent='Enter '+(n-1)+' nonnegative integer coefficients.';$('original-word-options').hidden=n!==5;$('string-word').value=format(natural(n));$('string-weight').value=format(Array(n-1).fill(1));}
  function formula(row){const terms=[];row.slice(1).forEach((a,j)=>{if(a)terms.push({a,label:(Math.abs(a)===1?'':Math.abs(a)+' ')+'x'+sub(j+1)});});if(row[0])terms.push({a:row[0],label:String(Math.abs(row[0]))});return (terms.map((t,i)=>(t.a<0?(i?' − ':'−'):(i?' + ':''))+t.label).join('')||'0')+' ≥ 0';}
  function reference(word,rank){if(rank!==4||word.length!==10)return 'BLMM reference: applies only to the SL(5) longest-element representatives.';const target=word.join(',');for(const [label,start] of Object.entries(refs.references)){const todo=[start,start.map(a=>5-a)],seen=new Set();for(let i=0;i<todo.length;i++){const w=todo[i],key=w.join(',');if(seen.has(key))continue;seen.add(key);if(key===target)return 'BLMM reference: '+label+(start.join(',')===target?' · exact Table 6 word.':' · same commutation/Dynkin orbit as the Table 6 word.');for(let j=0;j<w.length-1;j++)if(Math.abs(w[j]-w[j+1])>1){const v=w.slice();[v[j],v[j+1]]=[v[j+1],v[j]];todo.push(v);}}}return 'No BLMM reference label found.';}
  function rows(target,data){target.replaceChildren();if(!data.length){target.textContent='No inequalities (zero string coordinates).';return;}for(const row of data){const el=document.createElement('div');el.className='string-row';el.textContent=formula(row);target.append(el);}}
  function render(record){result=record;$('string-result').hidden=false;const g=record.geometry;
    $('string-result-title').textContent=record.longest?'Full flag · SL('+(record.rank+1)+')':'Schubert variety X(w) · SL('+(record.rank+1)+')';
    $('string-dimension').textContent=record.dimension+' string coordinates';$('string-input-summary').textContent='Word '+format(record.word)+' · λ = '+format(record.weight);$('string-permutation').textContent='w = '+format(record.permutation)+' · ℓ(w) = '+record.word.length;
    $('string-reference').textContent=reference(record.word,record.rank);
    $('string-geometry-summary').textContent=g.status==='complete'?'Dimension '+g.dimension+' · '+g.vertices.length+(g.vertices.length===1?' vertex':' vertices')+(g.f_vector?' · f-vector '+format(g.f_vector):''):g.dimension!=null?'Dimension '+g.dimension:'';
    $('string-geometry-summary').hidden=!$('string-geometry-summary').textContent;
    $('string-geometry-note').textContent=g.status==='complete'?'Vertices use exact rational arithmetic. The defining rows below may include redundant inequalities.':g.dimension>3?'':g.reason;
    $('string-geometry-note').hidden=!$('string-geometry-note').textContent;
    $('string-plot-wrap').hidden=g.status!=='complete'||g.dimension>3;$('string-rotation-label').hidden=g.dimension!==3;
    const lattice=record.lattice;
    $('string-lattice-summary').textContent=lattice?.status==='complete'?lattice.total+' lattice points · '+lattice.interior+' interior · '+lattice.boundary+' boundary':lattice?.reason||'';
    $('string-lattice-legend').hidden=lattice?.status!=='complete';
    $('string-lattice-details').hidden=lattice?.status!=='complete';
    $('string-lattice-points').textContent=lattice?.status==='complete'?lattice.points.map((p,i)=>format(p)+'  '+lattice.kinds[i]).join('\n'):'';
    $('string-vertices-details').hidden=g.status!=='complete';$('string-vertices').textContent=g.status==='complete'?g.vertices.map(format).join('\n'):'';
    $('string-row-count').textContent=record.cone_H.length+' cone + '+record.weight_H.length+' weight';rows($('string-cone-rows'),record.cone_H,record.paths);rows($('string-weight-rows'),record.weight_H);
    $('string-completion').textContent='Completed word '+format(record.completion_word);$('string-face-note').textContent=record.longest?'The input already represents w₀. Each cone row comes directly from a GP path.':'Set added coordinates '+format(record.zero_coordinates)+' to zero. Each displayed cone row is restricted from a GP path in the completed diagram; the path labels use that completed diagram.';
    $('string-path-witnesses').textContent=record.paths.map(p=>formula([0,...p.normal])+'  |  k='+p.k+'; turns '+format(p.turn_nodes)+'; wires '+format(p.wires)).join('\n')||'No nonzero path inequalities.';
    $('string-H').textContent=record.H.map(format).join('\n');$('string-sage-input').textContent='word = '+format(record.word)+'\nweight = '+format(record.weight)+'\nP = string_polytope(word, weight)\nP.vertices_list(), P.f_vector()';
    viewer.set(record);
  }
  function finish(data){if(data.id!==request)return;$('string-compute').disabled=false;$('string-status').className='status'+(data.error?' error':'');if(data.error){$('string-status').textContent=data.error+(result?' Previous result remains below.':'');return;}render(data.record);$('string-status').textContent='';}
  function compute(event){if(event)event.preventDefault();let word,weight;try{word=list($('string-word').value);weight=list($('string-weight').value);if(weight.length!==Number($('string-n').value)-1)throw new Error('λ needs exactly '+(Number($('string-n').value)-1)+' coefficients.');}catch(e){$('string-status').className='status error';$('string-status').textContent=e.message+(result?' Previous result remains below.':'');return;}
    if(worker)worker.terminate();worker=null;const id=++request;$('string-compute').disabled=true;$('string-status').className='status busy';$('string-status').textContent='Generating GP paths and inequalities…';
    if(location.protocol!=='file:'&&typeof Worker!=='undefined'){try{worker=new Worker('string-worker.js');worker.onmessage=e=>finish(e.data);worker.onerror=()=>finish({id,error:'The computation worker could not load. Open the complete folder or use the Sage notebook.'});worker.postMessage({id,word,weight});return;}catch(_){}}
    setTimeout(()=>{try{const record=NObyStrings.compute(word,weight);record.geometry=NObyStrings.geometry(record);record.lattice=NObyStrings.latticePoints(record,record.geometry);finish({id,record});}catch(e){finish({id,error:e.message});}},20);
  }
  $('string-form').onsubmit=compute;$('string-n').onchange=setupRank;
  for(const [id,value] of [['weight-rho',1],['weight-2rho',2],['weight-zero',0]])$(id).onclick=()=>{$('string-weight').value=format(Array(Number($('string-n').value)-1).fill(value));};
  function example(n,word){$('string-n').value=String(n);setupRank();$('string-word').value=format(word);compute();}
  $('example-schubert').onclick=()=>example(3,[1,2]);$('example-flag').onclick=()=>example(3,[1,2,1]);$('example-sl5').onclick=()=>example(5,natural(5));
  refs.originals.forEach((w,i)=>{const option=document.createElement('option');option.value=String(i);option.textContent=(i+1)+' · '+w.join('');$('original-word').append(option);});$('original-word').onchange=()=>{$('string-word').value=format(refs.originals[Number($('original-word').value)]);};
  setupRank();compute();
})();
