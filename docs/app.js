(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const E = window.NObyEngine;
  const C = window.NObyCatalogue;
  const W = window.NObyWords;
  const I = window.NObyIdentity;
  const F = window.NObyAffine;
  const T = window.NObyTypeB;
  const initialSeed = (n, family=state.family) => family === 'B' ? T.initialSeed(n) : E.initialSeed(n);
  const affineLoads = new Map();
  function loadAffine(n) {
    if (n > 5) return Promise.resolve(null);
    if (window.NOBY_AFFINE?.[n]) return Promise.resolve(window.NOBY_AFFINE[n]);
    if (affineLoads.has(n)) return affineLoads.get(n);
    const promise = new Promise(resolve => {
      const script = document.createElement('script'); script.src = 'data/affine-n' + n + '.js';
      script.onload = () => resolve(window.NOBY_AFFINE?.[n] || null);
      script.onerror = () => { affineLoads.delete(n); resolve(null); }; document.head.append(script);
    });
    affineLoads.set(n, promise); return promise;
  }
  const knownPaths = new Map(), wordIdentityCache = new Map();
  let displayedIdentityWords = [], wordPageSize = 30;
  const state = { family: 'A', n: 4, seed: null, match: null, data: null, busy: false, request: 0, hMode: 'formula', zoom: 1, worker: null, cache: new Map(), elapsed: 0 };
  window.NOBY_DATA = window.NOBY_DATA || {};
  const loaded = new Map();
  const format = x => '[' + x.join(', ') + ']';
  const subscript = n => String(n).replace(/\d/g, d => '₀₁₂₃₄₅₆₇₈₉'[d]);
  function svg(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (text != null) el.textContent = text;
    return el;
  }
  function status(text, kind = '') { $('status').textContent = text; $('status').className = 'status ' + kind; }
  function busy(value) {
    state.busy = value;
    for (const id of ['apply', 'export']) $(id).disabled = value || !state.seed;
    $('undo').disabled = value || !state.seed || !state.seed.sequence.length;
    $('quiver').setAttribute('aria-busy', String(value));
  }
  function loadData(n) {
    if (![3, 4, 5].includes(n)) return Promise.resolve(null);
    if (window.NOBY_DATA[n]) return Promise.resolve(window.NOBY_DATA[n]);
    if (loaded.has(n)) return loaded.get(n);
    const promise = new Promise(resolve => {
      const script = document.createElement('script');
      script.src = 'data/n' + n + '.js';
      script.onload = () => resolve(window.NOBY_DATA[n] || null);
      script.onerror = () => { loaded.delete(n); resolve(null); };
      document.head.append(script);
    });
    loaded.set(n, promise);
    return promise;
  }
  function matchRecord(seed, data) {
    return data ? C.match(seed, data) : null;
  }
  function equivalentRecords() {
    const record = state.match?.record;
    if (!record || !state.data) return [];
    const ids = new Set(record.equivalentSeeds || [record.id]);
    return state.data.seeds.filter(candidate => ids.has(candidate.id)).sort((a, b) => {
      if (a.sequence.length !== b.sequence.length) return a.sequence.length - b.sequence.length;
      for (let i = 0; i < a.sequence.length; i++) if (a.sequence[i] !== b.sequence[i]) return a.sequence[i] - b.sequence[i];
      return 0;
    });
  }
  function initWorker() {
    if (state.worker) state.worker.terminate();
    state.worker = null;
    if (location.protocol === 'file:' || typeof Worker === 'undefined') return;
    try {
      const worker = new Worker('worker.js');
      worker.onmessage = ({ data }) => {
        if (data.id !== state.request) return;
        if (data.error) { failure(data.error); return; }
        if (data.seed) complete(data.seed, data.milliseconds);
        else if (data.resolvingWord) status('Connecting the reduced word to the initial chamber seed…', 'busy');
        else status('Calculating mutation ' + data.progress + ' of ' + data.total + ' with exact arithmetic…', 'busy');
      };
      worker.onerror = () => {
        if (worker !== state.worker) return;
        worker.terminate(); state.worker = null;
        if (state.pending) calculateFallback(state.pending.n, state.pending.sequence, state.request, state.pending.reducedWord, state.pending.family);
      };
      state.worker = worker;
    } catch (_) { state.worker = null; }
  }
  function remember(seed) {
    state.cache.set((seed.family || 'A') + seed.n + ':' + seed.sequence.join(','), seed);
    if (state.cache.size > 80) state.cache.delete(state.cache.keys().next().value);
    return seed;
  }
  async function calculateFallback(n, sequence, id, reducedWord, family=state.family) {
    try {
      const started = performance.now();
      let wordInfo = null;
      if (reducedWord) {
        if (family !== 'A') throw new Error('Reduced-word routing is available only for type A.');
        await new Promise(resolve => setTimeout(resolve, 16));
        if (id !== state.request) return;
        wordInfo = W.resolve(n, reducedWord); sequence = wordInfo.sequence;
      }
      let seed, length = sequence.length;
      while (length >= 0) { seed = state.cache.get(family + n + ':' + sequence.slice(0, length).join(',')); if (seed) break; length--; }
      if (!seed) { seed = remember(initialSeed(n, family)); length = 0; }
      for (let i = length; i < sequence.length; i++) {
        if (id !== state.request) return;
        status('Calculating mutation ' + (i + 1) + ' of ' + sequence.length + ' with exact arithmetic…', 'busy');
        await new Promise(resolve => setTimeout(resolve, 16));
        if (id !== state.request) return;
        seed = remember(E.mutate(seed, sequence[i] - 1));
      }
      if (wordInfo && JSON.stringify(seed.B) !== JSON.stringify(W.wordMatrix(n, reducedWord, wordInfo.chamberLabels))) throw new Error('The computed matrix does not match the reduced-word chamber seed.');
      if (id === state.request) complete({ ...seed, reducedWordInfo: wordInfo }, Math.round(performance.now() - started));
    } catch (error) { if (id === state.request) failure(error.message); }
  }
  function calculate(sequence, reducedWord = null) {
    const id = ++state.request;
    state.pending = { family: state.family, n: state.n, sequence: sequence.slice(), reducedWord };
    busy(true);
    status(reducedWord ? 'Connecting the reduced word to seed 0…' : sequence.length ? 'Calculating the selected path…' : 'Preparing seed 0…', 'busy');
    if (state.worker) state.worker.postMessage({ id, family: state.family, n: state.n, sequence, reducedWord });
    else calculateFallback(state.n, sequence, id, reducedWord);
  }
  function failure(message) {
    state.pending = null; busy(false);
    status(message + ' The displayed seed has not changed.', 'error');
  }
  function complete(seed, milliseconds) {
    state.seed = seed; state.pending = null; state.elapsed = milliseconds;
    state.match = matchRecord(seed, state.data);
    if (state.family === 'B' && state.n === 2) {
      const record = T.b2Record(seed.sequence, state.data);
      if (!state.match || state.match.record.id !== record.id) { failure('The B2 path does not match the certified catalogue.'); return; }
    }
    render(); busy(false);
    const sameLabels = !state.match || state.match.permutation.every((v, i) => v === i);
    let msg = seed.reducedWordInfo ? 'Reduced-word chamber seed computed and its B-matrix independently verified. ' : seed.sequence.length ? 'Mutation path computed exactly. ' : 'Click a blue vertex to start a mutation path. ';
    if (!sameLabels) msg += 'Stored seed matched after relabeling; your coordinate labels are preserved. ';
    msg += seed.H.length + ' facets · ' + milliseconds + ' ms';
    status(msg);
  }
  async function changeN(n) {
    ++state.request; const request = state.request;
    state.n = n; state.zoom = 1; state.match = null; state.pending = null; state.seed = null;
    $('reset').disabled = true;
    busy(true); initWorker();
    const isB = state.family === 'B', finite = isB ? n === 2 : n <= 5;
    const initial = initialSeed(n);
    $('finite').textContent = finite ? 'Yes' : 'No';
    $('finite').classList.toggle('infinite', !finite);
    $('graph-panel').hidden = isB ? n !== 2 : n > 4;
    $('context').textContent = 'Type ' + state.family + subscript(isB ? n : n-1) + ' · dimension ' + initial.dimension + ' · ' + initial.mutableCount + ' mutable / ' + (initial.dimension-initial.mutableCount) + ' frozen';
    $('input-mode').querySelector('[value="word"]').disabled = isB;
    $('input-mode').value = 'mutation';
    $('b-input-note').hidden = !isB;
    status('Loading the selected dimension…', 'busy');
    const [data, affineData] = isB ? [n === 2 ? window.NOBY_B2.catalogue : null, n === 2 ? window.NOBY_B2.affine : null] : await Promise.all([loadData(n), loadAffine(n)]);
    if (request !== state.request) return;
    state.data = data;
    state.affineData = affineData;
    $('reset').disabled = false;
    calculate([]);
  }
  function graphPositions(records, edges) {
    if (records.every(r => Array.isArray(r.position))) return records.map(r => ({ id: r.id, x: 32 + r.position[0] * 296, y: 38 + r.position[1] * 330 }));
    if (records.length === 2) return records.map((r, i) => ({ id: r.id, x: 105 + 150 * i, y: 205 }));
    const positions = records.map((r, i) => ({ id: r.id, x: 180 + 140 * Math.cos(2 * Math.PI * i / records.length), y: 200 + 160 * Math.sin(2 * Math.PI * i / records.length) }));
    const map = new Map(positions.map(p => [p.id, p]));
    for (let iteration = 0; iteration < 700; iteration++) {
      const delta = new Map(positions.map(p => [p.id, { x: 0, y: 0 }]));
      for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i], b = positions[j], dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 1), f = 1800 / d2;
        delta.get(a.id).x += dx * f; delta.get(a.id).y += dy * f; delta.get(b.id).x -= dx * f; delta.get(b.id).y -= dy * f;
      }
      for (const edge of edges) {
        const a = map.get(edge.source), b = map.get(edge.target); if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y, dist = Math.hypot(dx, dy), f = (dist - 78) * .03 / Math.max(dist, 1);
        delta.get(a.id).x += dx * f; delta.get(a.id).y += dy * f; delta.get(b.id).x -= dx * f; delta.get(b.id).y -= dy * f;
      }
      const step = .3 * (1 - iteration / 800);
      for (const p of positions) { p.x = Math.max(28, Math.min(332, p.x + delta.get(p.id).x * step)); p.y = Math.max(34, Math.min(376, p.y + delta.get(p.id).y * step)); }
    }
    return positions;
  }
  function renderGraph() {
    const graph = $('graph'); graph.replaceChildren();
    const isA2 = state.family === 'A' && state.n === 3;
    const isA3 = state.family === 'A' && state.n === 4;
    const isB2 = state.family === 'B' && state.n === 2;
    const combinatorial = $('b2-graph-color').value === 'combinatorial';
    const symmetric = isA2 || isA3 || isB2;
    graph.classList.toggle('symmetric', symmetric);
    graph.classList.toggle('b2-graph', isB2);
    $('graph-default-legend').hidden = symmetric;
    $('graph-symmetry-note').hidden = !(isA2 || isA3);
    $('graph-symmetry-caption').textContent = isA2
      ? 'ℤ₂ · reflection across the dashed axis swaps the two seeds'
      : 'ℤ₂ × ℤ₂ · reflections across the dashed axes';
    $('graph-citation').hidden = !isA3;
    $('b2-graph-note').hidden = !isB2;
    if ($('graph-panel').hidden) return;
    if (!state.data || !state.data.completeGraph) { graph.append(svg('text', { x: 30, y: 80, 'font-size': 14 }, 'Exchange graph data unavailable.')); return; }
    const { seeds, edges } = state.data;
    $('graph-class-swatches').replaceChildren(...[...new Set(seeds.map(s => s.polytopeClass))].map(type => {
      const swatch = document.createElement('i'); swatch.dataset.polytopeClass = type; return swatch;
    }));
    $('b2-word-seeds').replaceChildren();
    if (isB2) for (const record of seeds.filter(s=>s.chamberSeeds?.length)) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'seed-chip';
      button.textContent = 'Seed ' + record.id + ' · ' + format(record.chamberSeeds[0].word);
      button.onclick = () => { if (!state.busy) calculate(record.sequence); };
      $('b2-word-seeds').append(button);
    }
    $('graph-count').textContent = seeds.length + ' seeds';
    const positions = graphPositions(seeds, edges), map = new Map(positions.map(p => [p.id, p]));
    if (isA2) {
      const y = (positions[0].y + positions[1].y) / 2;
      const axes = svg('g', { class: 'symmetry-axes', 'aria-hidden': 'true' });
      axes.append(svg('line', { x1: 14, y1: y, x2: 346, y2: y }), svg('text', { x: 348, y: y - 9, 'text-anchor': 'end' }, 'σ'));
      graph.append(axes);
    }
    if (isA3) {
      const axes = svg('g', { class: 'symmetry-axes', 'aria-hidden': 'true' });
      axes.append(svg('line', { x1: 180, y1: 23, x2: 180, y2: 383 }), svg('line', { x1: 14, y1: 203, x2: 346, y2: 203 }));
      axes.append(svg('text', { x: 180, y: 16, 'text-anchor': 'middle' }, 'ι'), svg('text', { x: 348, y: 194, 'text-anchor': 'end' }, 'ι′'));
      graph.append(axes);
    }
    if (isB2) {
      // Horizontal reflection σ(i)=5−i preserves every affine class.
      // Vertical reflection τ(i)=2−i (mod 6) also preserves both combinatorial classes.
      const axes = svg('g', { class: 'symmetry-axes', 'aria-hidden': 'true' });
      axes.append(svg('line', {x1:14,y1:203,x2:346,y2:203}),svg('text',{x:348,y:194,'text-anchor':'end'},'σ'));
      if (combinatorial) axes.append(svg('line',{x1:180,y1:23,x2:180,y2:383}),svg('text',{x:180,y:16,'text-anchor':'middle'},'τ'));
      graph.append(axes);
      $('b2-symmetry-caption').textContent = combinatorial ? 'ℤ₂ × ℤ₂ · each combinatorial class is preserved' : 'ℤ₂ · each unimodular class is preserved';
      $('b2-symmetry-pairs').textContent = combinatorial
        ? 'Classes: {0, 2, 3, 5}, {1, 4}.\nσ = (0 5)(1 4)(2 3).\nτ = (0 2)(3 5).'
        : 'Classes: {0, 5}, {1, 4}, {2, 3}.\nσ = (0 5)(1 4)(2 3).';
    }
    for (const edge of edges) {
      const a = map.get(edge.source), b = map.get(edge.target); if (!a || !b) continue;
      const line = svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'graph-edge' });
      line.append(svg('title', {}, 'Seed ' + edge.source + ' — ' + edge.target + ' (directions ' + (edge.sourceK + 1) + ' / ' + (edge.targetK + 1) + ')')); graph.append(line);
    }
    const current = state.match?.record;
    const equivalent = isB2 && combinatorial && current ? seeds.filter(s=>s.combinatorialClass === current.combinatorialClass).map(s=>s.id) : current?.equivalentSeeds || [];
    for (const record of seeds) {
      const p = map.get(record.id), selected = current?.id === record.id;
      const node = svg('g', { class: 'graph-node' + (equivalent.includes(record.id) ? ' equivalent' : '') + (selected ? ' current' : ''), transform: 'translate(' + p.x + ',' + p.y + ')', role: 'button', tabindex: 0, 'aria-label': 'Open seed ' + record.id, 'aria-pressed': selected, 'data-seed-id': record.id });
      if (symmetric) node.setAttribute('data-polytope-class', isB2 && combinatorial ? record.combinatorialClass : record.polytopeClass);
      node.append(svg('circle', { r: 16 }), svg('text', { 'text-anchor': 'middle', dy: '0.35em' }, record.id), svg('title', {}, 'Seed ' + record.id + ' · ' + format(record.sequence)));
      let chamberWords = isB2 ? (record.chamberSeeds || []).map(seed => seed.word) : [];
      if (isA2 || isA3) {
        const identity = I.describe(state.n, record.sequence);
        if (!wordIdentityCache.has(identity.key)) wordIdentityCache.set(identity.key, I.reducedWords(identity, window.NOBY_MINOR_G?.[state.n], W));
        chamberWords = wordIdentityCache.get(identity.key) || [];
      }
      if (chamberWords.length) {
        node.setAttribute('data-reduced-word', chamberWords[0].join(','));
        node.setAttribute('aria-label', 'Open seed ' + record.id + ', seed from a reduced word');
        node.querySelector('title').textContent += ' · Reduced words: ' + chamberWords.map(format).join('; ');
        const badge = svg('g', {class:'word-seed-badge','aria-hidden':'true'});
        // Keep the badges clear of the closely spaced inner diamonds in A3.
        const badgeX = isA3 && p.x < 180 ? -37 : isA3 && record.id === 9 ? 20 : 10;
        const badgeY = isA3 && record.id === 9 ? -8 : -29;
        badge.append(svg('rect',{x:badgeX,y:badgeY,width:27,height:16,rx:4}),svg('text',{x:badgeX+13.5,y:badgeY+12,'text-anchor':'middle'},'RW'));
        node.append(badge);
      }
      const open = () => { if (!state.busy) calculate(record.sequence); };
      node.addEventListener('click', open); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }); graph.append(node);
    }
  }
  function renderQuiver() {
    const q = $('quiver'), s = state.seed, r = s.mutableCount;
    q.replaceChildren();
    const isB = state.family === 'B', rows = isB ? s.n : s.n - 1, spacing = 88, rowHeight = 78;
    const columns = isB ? Math.max(...s.positions.map(p => p.occurrence))+1 : rows;
    const width = (columns - 1) * spacing + 124, height = rows * rowHeight + 28;
    // Put the initial s1 brick row at the bottom (1,3,6,10,15 for n=6),
    // with higher simple roots above it and every frozen vertex on the right.
    const brickPoint = (column, level) => ({ x: 70 + column * spacing, y: 14 + (rows - level - .5) * rowHeight });
    q.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    // Fixed SVG units keep 12px labels comparable to the B-matrix text.
    // Wide diagrams scroll instead of enlarging every vertex to fill a panel.
    q.style.width = width * state.zoom + 'px'; q.style.height = height * state.zoom + 'px';
    const defs = svg('defs'); const marker = svg('marker', { id: 'arrowhead', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' }); marker.append(svg('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: '#8b9eb0' })); defs.append(marker); q.append(defs);
    const positions = s.positions.map(p => isB ? brickPoint(p.occurrence + columns - s.positions.filter(q => q.root === p.root).length, p.root-1) : brickPoint(p.row, p.row - p.col));
    if (!s.sequence.length && isB) {
      for (let root = 1; root <= rows; root++) {
        const nodes = s.positions.map((p,i)=>p.root===root ? positions[i] : null).filter(Boolean);
        const a = nodes[0], b = nodes[nodes.length-1];
        q.append(svg('rect',{x:a.x-39,y:a.y-34,width:b.x-a.x+78,height:68,rx:5,class:'brick-row'}));
        const label = svg('text',{x:a.x-49,y:a.y+4,'text-anchor':'end',class:'brick-label'},'s'+subscript(root));
        label.append(svg('title',{},root===rows ? 'Short simple root' : 'Long simple root')); q.append(label);
      }
    }
    if (!s.sequence.length && !isB) {
      const guides = svg('g', { class: 'brick-guides', 'aria-hidden': 'true' });
      for (let level = 0; level < rows; level++) {
        const corners = [[level - .5, level - .5], [rows - .5, level - .5], [rows - .5, level + .5], [level - .5, level + .5]].map(([column, row]) => brickPoint(column, row));
        guides.append(svg('polygon', { points: corners.map(p => p.x + ',' + p.y).join(' '), class: 'brick-row' }));
        for (let column = level + 1; column < rows; column++) {
          const a = brickPoint(column - .5, level - .5), b = brickPoint(column - .5, level + .5);
          guides.append(svg('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'brick-joint' }));
        }
        const label = brickPoint(level - .78, level);
        guides.append(svg('text', { x: label.x, y: label.y, 'text-anchor': 'middle', dy: '.35em', class: 'brick-label' }, 's' + subscript(level + 1)));
      }
      q.append(guides);
    }
    for (let i = 0; i < s.dimension; i++) for (let j = 0; j < Math.min(i, r); j++) {
      const b = s.B[i][j]; if (!b) continue;
      // Match the notebook's quiver convention: arrow i -> j iff B[i,j] < 0.
      const from = positions[b < 0 ? i : j], to = positions[b < 0 ? j : i];
      const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy), ux = dx / length, uy = dy / length;
      const bend = length > spacing * 1.6 ? 13 : 0;
      const path = svg('path', { d: 'M' + (from.x + 21 * ux) + ',' + (from.y + 21 * uy) + ' Q' + ((from.x + to.x) / 2 - bend * uy) + ',' + ((from.y + to.y) / 2 + bend * ux) + ' ' + (to.x - 25 * ux) + ',' + (to.y - 25 * uy), class: 'quiver-edge' + (i >= r ? ' frozen-edge' : ''), 'marker-end': 'url(#arrowhead)' }); q.append(path);
      const valuation = isB && i < r ? Math.abs(b) + ':' + Math.abs(s.B[j][i]) : Math.abs(b);
      path.append(svg('title',{},'Vertices '+(i+1)+' / '+(j+1)+': '+b+(i<r?' / '+s.B[j][i]:'')));
      if (Math.abs(b) > 1 || (isB && i < r && Math.abs(s.B[j][i]) > 1)) q.append(svg('text', { x: (from.x + to.x) / 2 - (bend + 8) * uy, y: (from.y + to.y) / 2 + (bend + 8) * ux, 'text-anchor': 'middle', class: 'arrow-label' }, valuation));
    }
    const last = s.sequence[s.sequence.length - 1];
    for (let i = 0; i < s.dimension; i++) {
      const p = positions[i], frozen = i >= r;
      const node = svg('g', { transform: 'translate(' + p.x + ',' + p.y + ')', class: 'quiver-node' + (frozen ? ' frozen' : '') + (last === i + 1 ? ' last' : ''), 'data-vertex': i + 1, role: frozen ? 'img' : 'button', 'aria-label': frozen ? 'Frozen variable ' + (i + 1) : 'Mutate vertex ' + (i + 1) });
      if (!frozen) node.setAttribute('tabindex', '0');
      node.append(frozen ? svg('rect', { x: -18, y: -18, width: 36, height: 36, rx: 7 }) : svg('circle', { r: 19 }));
      node.append(svg('text', { 'text-anchor': 'middle', dy: '.35em' }, i + 1), svg('title', {}, (frozen ? 'Frozen' : 'Mutable') + ' · position ' + (i + 1) + ' · ' + s.clusterVariables[i]));
      if (!frozen) {
        const mutate = () => { if (!state.busy) calculate([...s.sequence, i + 1]); };
        node.addEventListener('click', mutate); node.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); mutate(); } });
      }
      q.append(node);
    }
  }
  function renderWiring() {
    const s=state.seed, canvas=$('wiring-diagram');
    canvas.replaceChildren();
    $('wiring-panel').hidden=true;
    $('quiver-scroll').hidden=false;
    if(state.family!=='A') return;
    try {
      let word, labels, current=false;
      if(s.reducedWordInfo) {
        word=s.reducedWordInfo.word; labels=s.reducedWordInfo.chamberLabels; current=true;
      } else if(!s.sequence.length) {
        word=W.initialWord(s.n); labels=W.chambers(s.n,word); current=true;
      } else {
        const live=I.describe(s.n,s.sequence);
        if(!wordIdentityCache.has(live.key))wordIdentityCache.set(live.key,I.reducedWords(live,window.NOBY_MINOR_G?.[s.n],W));
        const words=wordIdentityCache.get(live.key);
        if(words?.length) {
          word=words[0]; const plan=W.resolve(s.n,word);
          const match=I.compare(live,I.describe(s.n,plan.sequence));
          if(match) {labels=match.permutation.map(i=>plan.chamberLabels[i]);current=true;}
        }
      }
      if(!current) return;
      const g=window.NObyWiring.geometry(s.n,word,labels,s.mutableCount);
      const B=s.B;
      if(JSON.stringify(g.B)!==JSON.stringify(B))throw new Error('Chamber arrows do not agree with the exchange matrix.');
      $('wiring-source').textContent='Reduced word · '+format(word);
      $('wiring-context').textContent='Chamber numbers are the current quiver vertices and B-matrix rows. Arrows reconstructed from chamber endpoints agree with B. Click a mutable chamber to mutate, or hide the arrows to read the wiring alone.';
      const width=(word.length+1)*62+64,height=(s.n-1)*58+92;
      const point=p=>({x:32+p.x*62,y:32+p.y*58});
      canvas.setAttribute('viewBox','0 0 '+width+' '+height);
      canvas.style.width=width*state.zoom+'px';canvas.style.height=height*state.zoom+'px';
      const defs=svg('defs'),marker=svg('marker',{id:'wiring-arrowhead',viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:5,markerHeight:5,orient:'auto'});
      marker.append(svg('path',{d:'M0 0L10 5L0 10Z',fill:'#506b83'}));defs.append(marker);canvas.append(defs);
      for(const wire of g.wires) {
        const pts=wire.points.map(point);
        canvas.append(svg('polyline',{points:pts.map(p=>p.x+','+p.y).join(' '),class:'wiring-strand'}));
        for(const [p,offset] of [[pts[0],-16],[pts[pts.length-1],16]])canvas.append(svg('text',{x:p.x+offset,y:p.y+4,'text-anchor':'middle',class:'wiring-label'},wire.label));
      }
      for(const c of g.crossings)canvas.append(svg('text',{x:point(c).x,y:height-14,'text-anchor':'middle',class:'wiring-label'},'s'+subscript(c.generator)));
      const positions=[];g.chambers.forEach(c=>positions[c.vertex]=point(c));
      const arrows=svg('g',{class:'wiring-arrows'});
      for(let i=0;i<B.length;i++)for(let j=0;j<Math.min(i,s.mutableCount);j++) {
        const b=B[i][j];if(!b)continue;
        const a=positions[b<0?i:j],z=positions[b<0?j:i],dx=z.x-a.x,dy=z.y-a.y,d=Math.hypot(dx,dy);
        arrows.append(svg('path',{d:'M'+(a.x+16*dx/d)+','+(a.y+16*dy/d)+'L'+(z.x-18*dx/d)+','+(z.y-18*dy/d),class:'wiring-edge','marker-end':'url(#wiring-arrowhead)'}));
      }
      canvas.append(arrows);canvas.classList.toggle('hide-arrows',!$('wiring-arrows').checked);
      const link=vertex=>{
        document.querySelectorAll('#quiver [data-vertex], #matrix [data-vertex]').forEach(el=>el.classList.toggle('wiring-linked',current&&el.dataset.vertex===String(vertex)));
      };
      for(const c of g.chambers) {
        const p=positions[c.vertex],label='Vertex '+(c.vertex+1)+' · Δ_{'+c.key+'} · '+(c.frozen?'frozen':'mutable');
        const node=svg('g',{transform:'translate('+p.x+','+p.y+')',class:'wiring-node'+(c.frozen?' frozen':''),tabindex:0,role:c.frozen?'img':'button','aria-label':label});
        node.append(c.frozen?svg('rect',{x:-14,y:-14,width:28,height:28,rx:4}):svg('circle',{r:14}),svg('text',{'text-anchor':'middle',dy:'.35em'},c.vertex+1),svg('title',{},label));
        node.addEventListener('mouseenter',()=>link(c.vertex+1));node.addEventListener('mouseleave',()=>link(null));
        node.addEventListener('focus',()=>link(c.vertex+1));node.addEventListener('blur',()=>link(null));
        if(!c.frozen) {
          const mutate=()=>{if(!state.busy)calculate([...s.sequence,c.vertex+1]);};
          node.addEventListener('click',mutate);
          node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();mutate();}});
        }
        canvas.append(node);
      }
      $('wiring-panel').hidden=false;$('quiver-scroll').hidden=true;
    } catch(error) {
      canvas.replaceChildren(); console.warn('Wiring view unavailable:',error.message);
    }
  }
  function renderMatrix() {
    const s = state.seed, last = s.sequence[s.sequence.length - 1] - 1, table = document.createElement('table'), head = table.createTHead(), header = head.insertRow();
    header.append(document.createElement('th'));
    for (let j = 0; j < s.mutableCount; j++) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = j + 1; header.append(th); }
    const body = table.createTBody();
    s.B.forEach((row, i) => {
      const tr = body.insertRow(); tr.dataset.vertex=i+1; if (i === s.mutableCount) tr.classList.add('frozen-start'); if (i === last) tr.classList.add('last-mutated');
      const th = document.createElement('th'); th.scope = 'row'; th.textContent = i + 1; tr.append(th);
      row.forEach((b, j) => { const td = tr.insertCell(); td.textContent = b; td.className = (b < 0 ? 'negative' : b > 0 ? 'positive' : 'zero') + (j === last ? ' column-mutated' : ''); });
    });
    $('matrix').replaceChildren(table); $('matrix-shape').textContent = s.dimension + ' × ' + s.mutableCount;
  }
  function renderInvariants() {
    const record = state.match?.record;
    const fVector = record?.fVector || (!state.seed.sequence.length && state.seed.initialInvariants?.f_vector);
    $('f-vector').textContent = fVector ? format(fVector) : 'Not computed for this seed';
    renderIdentical();
    $('equivalent').replaceChildren();
    $('equivalent').className = '';
    $('equivalent-note').hidden = state.family !== 'A' || state.n !== 5;
    $('equivalent-note').textContent = '';
    if (state.n <= 4 && record?.equivalentSeeds) {
      for (const id of record.equivalentSeeds) { const button = document.createElement('button'); button.className = 'seed-chip'; button.textContent = id; button.dataset.seedId = id; button.setAttribute('aria-label', 'Open equivalent seed ' + id); button.onclick = () => openEquivalent(state.data.seeds.find(s => s.id === id)); $('equivalent').append(button); }
    } else if (state.family === 'A' && state.n === 5 && record) {
      const equivalent = equivalentRecords();
      $('equivalent').className = 'sequence-list';
      $('equivalent-note').textContent = equivalent.length + ' representative sequences from seed 0. Select a sequence to open it.';
      for (const candidate of equivalent) {
        const button = document.createElement('button');
        button.className = 'seed-chip sequence-chip';
        button.textContent = format(candidate.sequence);
        button.dataset.sequence = JSON.stringify(candidate.sequence);
        button.dataset.seedId = candidate.id;
        button.setAttribute('aria-label', 'Open mutation sequence ' + format(candidate.sequence));
        button.setAttribute('aria-pressed', String(candidate.id === record.id));
        button.onclick = () => openEquivalent(candidate);
        $('equivalent').append(button);
      }
    } else {
      $('equivalent').textContent = state.family === 'B' ? 'Not classified for this mutation path' : state.n === 5 ? 'No exact match in the stored catalogue for this seed.' : state.n >= 6 ? 'Not enumerated in on-demand mode' : 'Not classified';
      $('equivalent').className = 'muted';
    }
    renderAffineControls();
    renderB2ReducedWords();
    $('reduced-section').hidden = state.family !== 'A' || state.n > 4;
    $('reduced-words').replaceChildren();
    if (record?.reducedWords?.length) {
      for (const word of record.reducedWords) { const tag = document.createElement('span'); tag.className = 'reduced-word'; tag.textContent = format(word); $('reduced-words').append(tag); }
    } else $('reduced-words').textContent = 'No reduced-word match recorded';
    $('blmm-section').hidden = state.family !== 'A' || state.n !== 5;
    $('blmm-labels').replaceChildren();
    if (state.family === 'A' && state.n === 5) {
      const labels = window.NOBY_BLMM_LABELS?.[record?.id];
      if (!window.NOBY_BLMM_LABELS) $('blmm-labels').textContent = 'BLMM reference data could not be loaded.';
      else if (!record) $('blmm-labels').textContent = 'Not determined: no exact catalogue match.';
      else if (!labels?.length) $('blmm-labels').textContent = 'No equivalent string polytope in BLMM Table 6 (at 2ρ).';
      else for (const name of labels) {
        const link = document.createElement('a'); link.href = 'blmm.html#' + name;
        link.textContent = 'S' + subscript(name.slice(1)); $('blmm-labels').append(link);
      }
    }
  }
  function renderB2ReducedWords() {
    const isB2 = state.family === 'B' && state.n === 2;
    $('b2-reduced-section').hidden = !isB2;
    if (!isB2) return;
    $('b2-reduced-words').replaceChildren(); $('b2-word-coordinate-note').textContent = '';
    const record = state.match?.record;
    if (!record) { $('b2-reduced-note').textContent = 'Seed identity has not been matched to the verified B₂ catalogue.'; return; }
    const exact = record.chamberSeeds || [];
    const related = exact.length ? [record] : equivalentRecords().filter(s=>s.chamberSeeds?.length);
    $('b2-reduced-note').textContent = exact.length
      ? 'Yes. This is the chamber seed of the reduced word below. Chamber minor functions, the B-matrix and facet inequalities have been verified exactly.'
      : related.length ? 'No. This seed is not from a reduced word. Its polytope is affine unimodularly equivalent to the reduced-word polytope linked below.'
      : 'No. Neither this seed nor its affine unimodular polytope class is represented by either of the two reduced-word seeds.';
    for (const candidate of related) for (const item of candidate.chamberSeeds) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'seed-chip sequence-chip';
      button.textContent = format(item.word) + ' · Seed ' + candidate.id;
      button.onclick = () => { if (!state.busy) calculate(candidate.sequence); };
      $('b2-reduced-words').append(button);
      if (exact.length) {
        const mapping = item.wordPositionToVertex.map(v => state.match.permutation.indexOf(v-1)+1);
        $('b2-word-coordinate-note').textContent = 'Reduced-word positions 1–4 → displayed quiver vertices: ' + format(mapping) + '. Frozen variables keep their identities; the word lists them in its own order.';
      }
    }
  }
  function openEquivalent(record) {
    if (state.busy) return;
    if (!state.comparing) { calculate(record.sequence); return; }
    const field = state.affinePick || 'source';
    $('affine-' + field).value = String(record.id);
    state.affinePick = field === 'source' ? 'target' : 'source';
    renderAffineMap();
  }
  function renderAffineControls() {
    const record = state.match?.record, group = equivalentRecords();
    const key = state.family + state.n + ':' + (record?.polytopeClass ?? 'none');
    if (key !== state.affineGroup) { state.affineGroup = key; state.comparing = false; state.affinePick = 'source'; $('affine-source').replaceChildren(); $('affine-target').replaceChildren(); }
    const available = !!(F && record && state.affineData?.maps?.[record.id]);
    $('affine-toggle').disabled = !available;
    $('affine-toggle').textContent = state.comparing ? 'Close affine comparison' : 'Select two & view affine map';
    $('affine-toggle').setAttribute('aria-expanded', String(!!state.comparing));
    $('affine-panel').hidden = !state.comparing || !available;
    if (state.family === 'A' && state.n === 5 && record) $('equivalent-note').textContent = group.length + ' representative sequences from seed 0. ' + (state.comparing ? 'Click a source, then a target to compare their polytopes.' : 'Select a sequence to open it.');
    for (const button of $('equivalent').querySelectorAll('[data-seed-id]')) {
      const item = state.data?.seeds.find(s => String(s.id) === button.dataset.seedId);
      if (item) button.setAttribute('aria-label', (state.comparing ? 'Select ' : 'Open ') + (state.n <= 4 ? 'equivalent seed ' + item.id : 'mutation sequence ' + format(item.sequence)) + (state.comparing ? ' for affine map' : ''));
    }
    if (!state.comparing) for (const button of $('equivalent').querySelectorAll('button')) button.classList.remove('affine-source-chip','affine-target-chip');
    if (!available) { state.affineExport = null; return; }
    for (const side of ['source','target']) {
      const select = $('affine-' + side), old = select.value; select.replaceChildren();
      const current = document.createElement('option'); current.value = 'current'; current.textContent = 'Current displayed seed · ' + format(state.seed.sequence); select.append(current);
      for (const item of group) {
        const option = document.createElement('option'); option.value = item.id;
        option.textContent = (state.n <= 4 ? 'Seed ' + item.id + ' · ' : '') + format(item.sequence); select.append(option);
      }
      const valid = old === 'current' || group.some(s => String(s.id) === old);
      select.value = valid ? old : side === 'source' ? 'current' : String(group.find(s => s.id !== record.id)?.id ?? record.id);
    }
    if (state.comparing) renderAffineMap();
  }
  function affineEndpoint(value) {
    const current = value === 'current';
    const record = current ? state.match.record : state.data.seeds.find(s => String(s.id) === value);
    if (!record) throw new Error('Select a source and a target seed.');
    let certificate = state.affineData.maps[record.id];
    if (!certificate) throw new Error('No verified affine certificate is available for this seed.');
    if (current) certificate = F.relabel(certificate, state.match.permutation);
    return {certificate, H: current ? state.seed.H : record.H, sequence: current ? state.seed.sequence : record.sequence,
      storedSeedId: record.id, currentDisplayedCoordinates: current};
  }
  function renderAffineMap() {
    $('affine-result').hidden = true; state.affineExport = null;
    $('affine-pick-note').textContent = 'Next click in the list selects the ' + (state.affinePick || 'source') + '.';
    for (const button of $('equivalent').querySelectorAll('[data-seed-id]')) {
      button.classList.toggle('affine-source-chip', state.comparing && button.dataset.seedId === $('affine-source').value);
      button.classList.toggle('affine-target-chip', state.comparing && button.dataset.seedId === $('affine-target').value);
    }
    try {
      const source = affineEndpoint($('affine-source').value), target = affineEndpoint($('affine-target').value);
      const map = F.between(source.certificate, target.certificate);
      F.verify(source.H, target.H, map);
      $('affine-status').textContent = 'det(A) = ' + map.determinant + ' · Verified against every facet inequality.';
      $('affine-convention').textContent = 'Centered 2ρ cluster coordinates. Source x: ' + format(source.sequence) + ' → target y: ' + format(target.sequence) + '. ' + (map.b.every(x => x === 0) ? 'Both lattice centers are 0, so b = 0.' : 'The translation vector is shown below.');
      $('affine-formulas').replaceChildren();
      map.A.forEach((row,i) => {
        const terms = row.flatMap((a,j) => a ? [{a,text:(Math.abs(a)===1?'':Math.abs(a)+' ')+'x'+subscript(j+1)}] : []);
        if(map.b[i]) terms.push({a:map.b[i],text:String(Math.abs(map.b[i]))});
        const value = terms.map((t,k)=>(t.a<0?(k?' − ':'−'):(k?' + ':''))+t.text).join('') || '0';
        const line = document.createElement('div'); line.textContent = 'y' + subscript(i+1) + ' = ' + value; $('affine-formulas').append(line);
      });
      $('affine-b').textContent = 'b = ' + format(map.b);
      const width = Math.max(...map.A.flat().map(x=>String(x).length));
      $('affine-matrix').textContent = map.A.map(row=>'[ '+row.map(x=>String(x).padStart(width)).join(' ')+' ]').join('\n');
      state.affineExport = {schemaVersion:1,family:state.family,n:state.n,convention:'target column y = A * source column x + b',coordinates:'centered 2rho cluster coordinates',source:{sequence:source.sequence,storedSeedId:source.storedSeedId,currentDisplayedCoordinates:source.currentDisplayedCoordinates},target:{sequence:target.sequence,storedSeedId:target.storedSeedId,currentDisplayedCoordinates:target.currentDisplayedCoordinates},...map,allFacetPullbacksVerified:true,certificateSource:state.affineData.source,certificateSourceSHA256:state.affineData.sourceSHA256};
      $('affine-result').hidden = false;
    } catch(error) { $('affine-status').textContent = error.message; }
  }
  function renderIdentityWords() {
    const container = $('identical-words'); container.replaceChildren();
    if (!displayedIdentityWords.length) { container.textContent = 'No reduced-word seed match found.'; }
    for (const word of displayedIdentityWords.slice(0, wordPageSize)) {
      const button = document.createElement('button'); button.className = 'seed-chip sequence-chip';
      button.textContent = format(word); button.setAttribute('aria-label', 'Open same-seed reduced word ' + format(word));
      button.onclick = () => { if (!state.busy) calculate([], word); }; container.append(button);
    }
    $('identical-more').hidden = wordPageSize >= displayedIdentityWords.length;
  }
  function renderIdentical() {
    $('identical-paths').replaceChildren();
    displayedIdentityWords = []; wordPageSize = 30;
    $('identical-words-details').hidden = state.family === 'B';
    if (state.family === 'B') {
      if (state.n === 2) {
        const record = T.b2Record(state.seed.sequence,state.data);
        $('identical-note').textContent = 'Exact labeled seed ' + record.id + '. Representative from seed 0: ' + format(record.sequence) + '. Identity follows the six-seed catalogue verified with rational cluster variables.';
      } else $('identical-note').textContent = 'Same-seed classification is not computed for type B beyond rank 2. The displayed mutation path is ' + format(state.seed.sequence) + '.';
      return;
    }
    try {
      if (!I) throw new Error('Seed identity data could not be loaded.');
      const s = state.seed, live = I.describe(state.n, s.sequence);
      if (JSON.stringify(live.B) !== JSON.stringify(s.B)) throw new Error('The identity calculation does not match the displayed B-matrix.');
      const pathKey = s.sequence.join(','), key = live.key;
      if (!knownPaths.has(key)) knownPaths.set(key, new Map());
      knownPaths.get(key).set(pathKey, s.sequence.slice());
      const paths = new Map(knownPaths.get(key));
      for (const record of state.data?.seeds || []) {
        if (I.compare(live, I.describe(state.n, record.sequence))) paths.set(record.sequence.join(','), record.sequence);
      }
      const sorted = [...paths.values()].sort((a,b)=>a.length-b.length || a.join(',').localeCompare(b.join(',')));
      $('identical-note').textContent = '';
      for (const sequence of sorted) {
        const match = I.compare(live, I.describe(state.n, sequence));
        if (!match) continue;
        const button = document.createElement('button'); button.className = 'seed-chip sequence-chip';
        button.textContent = format(sequence) + (match.sameLabels ? ' · same labels' : ' · relabeled');
        button.setAttribute('aria-label','Open same-seed mutation path ' + format(sequence));
        button.title = match.sameLabels ? 'Identical labeled seed' : 'Current vertex → representative vertex: ' + format(match.permutation.map(x=>x+1));
        button.onclick = () => { if (!state.busy) calculate(sequence); }; $('identical-paths').append(button);
      }
      if (!wordIdentityCache.has(key)) wordIdentityCache.set(key, I.reducedWords(live, window.NOBY_MINOR_G?.[state.n], W));
      const words = wordIdentityCache.get(key);
      if (words === null) throw new Error('The reduced-word identity dictionary could not be loaded.');
      displayedIdentityWords = words;
      $('identical-words-summary').textContent = 'Reduced words in this commutation class (' + words.length + ')';
      renderIdentityWords();
    } catch (error) {
      $('identical-note').textContent = error.message;
      $('identical-words-summary').textContent = 'Reduced words: not determined';
      $('identical-words').textContent = 'Identity has not been certified.'; $('identical-more').hidden = true;
    }
  }
  function renderH() {
    if (!state.seed) return;
    const fragment = document.createDocumentFragment();
    state.seed.H.forEach((row, index) => {
      const line = document.createElement('div'); line.className = 'inequality';
      const number = document.createElement('span'); number.className = 'row-number'; number.textContent = String(index + 1).padStart(2, '0'); line.append(number);
      const content = document.createElement('span');
      if (state.hMode === 'coefficients') content.textContent = '(' + row.slice(1).join(', ') + ') · y + ' + row[0] + ' ≥ 0';
      else {
        let expression = '';
        row.slice(1).forEach((a, j) => { if (!a) return; expression += (!expression ? (a < 0 ? '−' : '') : (a < 0 ? ' − ' : ' + ')) + (Math.abs(a) === 1 ? '' : Math.abs(a)) + 'y' + subscript(j + 1); });
        expression += (row[0] < 0 ? ' − ' : ' + ') + Math.abs(row[0]) + ' ≥ 0'; content.textContent = expression;
      }
      line.append(content); fragment.append(line);
    });
    $('inequalities').replaceChildren(fragment); $('h-count').textContent = state.seed.H.length + ' facets';
    $('h-note').textContent = state.seed.sequence.length ? 'Computed from the current seed by tropical mutation; redundant inequalities removed using exact rational arithmetic.' : state.family === 'B' ? 'Initial string cone obtained by folding type A₂ₙ₋₁, then transformed to cluster coordinates. Mutable coordinates come first; each facet has constant 1.' : '';
    for (const mode of ['formula', 'coefficients']) { $('h-' + mode).classList.toggle('active', mode === state.hMode); $('h-' + mode).setAttribute('aria-pressed', String(mode === state.hMode)); }
  }
  function renderVariables() {
    const s = state.seed, fragment = document.createDocumentFragment(), matched = state.match?.record.cluster?.length >= s.mutableCount ? state.match : null;
    function row(label, text) { const el = document.createElement('div'); el.className = 'variable-row'; const name = document.createElement('span'); name.textContent = label; const value = document.createElement('span'); value.textContent = text; el.append(name, value); fragment.append(el); }
    for (let i = 0; i < s.mutableCount; i++) row('A' + subscript(i + 1), matched?.record.cluster?.[matched.permutation[i]] || s.clusterVariables[i]);
    if (!matched && s.relations.length) {
      const product = factors => factors.length ? factors.map(t => t.variable + (t.power === 1 ? '' : '^' + t.power)).join(' · ') : '1';
      for (const relation of s.relations) row(relation.variable, '(' + product(relation.positive) + ' + ' + product(relation.negative) + ') / ' + relation.divisor);
    }
    $('variables').replaceChildren(fragment);
    $('variable-note').textContent = 'Frozen: ' + s.clusterVariables.slice(s.mutableCount).join(', ') + '. ' + (!matched && s.relations.length ? 'The u-symbols are defined above in mutation order, so expressions remain exact without expanding exponentially.' : 'Aᵢ is the current variable at vertex i.');
  }
  let classListData=null, classListRelation=null;
  function renderClasses() {
    const data=state.data, relation=$('class-relation').value;
    if(classListData===data&&classListRelation===relation)return;
    classListData=data;classListRelation=relation;
    const list=$('class-list');list.replaceChildren();
    $('class-relation').disabled=!data?.seeds?.length;
    if(!data?.seeds?.length){$('class-count').textContent='Not enumerated';$('class-list-note').textContent='No complete classification is available for this rank. Individual mutation paths can be explored below.';return;}
    const groups=new Map();
    for(const seed of data.seeds){
      const key=relation==='unimodular'?(seed.equivalentSeeds||[seed.id]).slice().sort((a,b)=>a-b).join(','):String(seed.combinatorialClass??seed.polytopeClass);
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(seed);
    }
    const ordered=[...groups.values()].map(g=>g.sort((a,b)=>a.id-b.id)).sort((a,b)=>a[0].id-b[0].id);
    $('class-count').textContent=ordered.length+' classes · '+data.seeds.length+' seeds';
    $('class-list-note').textContent='Each row lists one '+relation+' class, identified by its smallest seed ID. Select a seed to inspect its polytope below.';
    const table=document.createElement('table'),head=document.createElement('thead'),header=document.createElement('tr');
    for(const text of ['Representative','Member seeds']){const th=document.createElement('th');th.scope='col';th.textContent=text;header.append(th);}head.append(header);table.append(head);
    const body=document.createElement('tbody');
    for(const group of ordered){const row=document.createElement('tr'),label=document.createElement('th'),members=document.createElement('td');label.scope='row';label.textContent='Seed '+group[0].id;row.append(label,members);
      for(const seed of group){const button=document.createElement('button');button.className='seed-chip';button.textContent=seed.id;button.title='Mutation sequence '+format(seed.sequence);button.setAttribute('aria-label','Inspect seed '+seed.id);button.onclick=()=>{if(state.busy)return;calculate(seed.sequence);$('seed-title').scrollIntoView({block:'start'});};members.append(button);}body.append(row);
    }
    table.append(body);list.append(table);
  }
  function render() {
    const s = state.seed;
    renderClasses();
    $('seed-title').textContent = state.match && s.n <= 4 ? 'Seed ' + state.match.record.id : !s.sequence.length ? 'Seed 0' : 'Seed · step ' + s.sequence.length;
    $('input-mode').value = s.reducedWordInfo ? 'word' : 'mutation';
    $('sequence').value = format(s.reducedWordInfo?.word || s.sequence);
    renderInputHelp();
    renderGraph(); renderQuiver(); renderMatrix(); renderWiring(); renderInvariants(); renderH(); renderVariables();
  }
  function renderInputHelp() {
    const wordMode = $('input-mode').value === 'word', s = state.seed;
    $('sequence').setAttribute('aria-label', wordMode ? 'Reduced word' : 'Mutation sequence');
    $('sequence').placeholder = wordMode ? format(W.initialWord(state.n)) : '[1, 2, 3]';
    $('input-help').textContent = wordMode
      ? 'Enter a reduced word for w₀ using simple-reflection indices 1–' + (state.n-1) + ' (' + state.n*(state.n-1)/2 + ' entries). Apply opens its chamber-minor seed; inequalities remain in cluster coordinates.'
      : 'Apply starts from seed 0 (t₀), not the currently displayed seed. For [i₁, …, iₖ], mutate vertex i₁ first, then i₂, …, iₖ. Clicking the quiver continues from the displayed seed.';
    $('path-formula').replaceChildren();
    const formula = document.createElement('span');
    formula.innerHTML = 'Δ<sub>t</sub> = μ<sup>trop</sup><sub>iₖ</sub> ∘ ⋯ ∘ μ<sup>trop</sup><sub>i₂</sub> ∘ μ<sup>trop</sup><sub>i₁</sub>(Δ<sub>t₀</sub>)';
    const origin = document.createElement('span');
    origin.textContent = '   t₀: ' + format(initialSeed(state.n).word) + ' · λ = 2ρ';
    $('path-formula').append(formula, origin);
    $('word-route').replaceChildren();
    $('word-route').hidden = !s?.reducedWordInfo;
    if (s?.reducedWordInfo) {
      const path = document.createElement('p');
      path.textContent = 'Mutation path from t₀: ' + format(s.sequence) + (s.sequence.length ? ' (applied left to right)' : ' (no mutations; the chamber variables are the same)');
      const mapping = document.createElement('p');
      mapping.textContent = 'Reduced-word positions 1–' + s.dimension + ' → current quiver vertices: ' + format(s.reducedWordInfo.wordPositionToVertex);
      const detail = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = 'Word-to-quiver correspondence'; detail.append(summary, mapping);
      $('word-route').append(path, detail);
    }
  }
  function parseSequence(text, wordMode = false) {
    let input = text.trim(), values;
    if (!input) { if (wordMode) W.validate(state.n, []); return []; }
    if (input.startsWith('[')) { try { values = JSON.parse(input); } catch (_) { throw new Error('Enter a list such as [1, 2, 3].'); } }
    else { if (!/^\d+(?:[\s,]+\d+)*$/.test(input)) throw new Error('Use positive integer vertex labels separated by commas or spaces.'); values = input.split(/[\s,]+/).map(Number); }
    if (wordMode) {
      if (state.family !== 'A') throw new Error('Use mutation directions for type B. Other reduced words can be calculated in the SageMath notebook.');
      return W.validate(state.n, values);
    }
    const r = state.family === 'B' ? state.n*(state.n-1) : (state.n - 1) * (state.n - 2) / 2;
    if (!Array.isArray(values) || values.some(k => !Number.isInteger(k) || k < 1 || k > r)) throw new Error('Every mutation direction must be an integer from 1 to ' + r + '. Frozen vertices cannot be mutated.');
    if (values.length > 200) throw new Error('Enter at most 200 mutations at a time.');
    return values;
  }
  function dimensionOptions() {
    $('dimension').replaceChildren();
    for (let n = state.family === 'B' ? 2 : 3; n <= 6; n++) { const option = document.createElement('option'); option.value = n; option.textContent = 'n = ' + n; $('dimension').append(option); }
    $('dimension-label').textContent = state.family === 'B' ? 'B rank' : 'Flag(ℂⁿ)';
  }
  dimensionOptions();
  $('b2-graph-color').onchange = renderGraph;
  $('family').onchange = () => { state.family = $('family').value; dimensionOptions(); const n = state.family === 'B' ? 2 : 4; $('dimension').value = n; changeN(n); };
  $('dimension').value = '4'; $('dimension').onchange = () => changeN(Number($('dimension').value));
  $('input-mode').onchange = () => {
    $('sequence').value = format($('input-mode').value === 'word' ? (state.seed?.reducedWordInfo?.word || W.initialWord(state.n)) : (state.seed?.sequence || []));
    renderInputHelp();
  };
  $('identical-more').onclick = () => { wordPageSize += 30; renderIdentityWords(); };
  $('class-relation').onchange=renderClasses;
  $('affine-toggle').onclick = () => { state.comparing = !state.comparing; state.affinePick = 'source'; renderAffineControls(); };
  for (const side of ['source','target']) $('affine-' + side).onchange = renderAffineMap;
  $('affine-swap').onclick = () => { const source = $('affine-source').value; $('affine-source').value = $('affine-target').value; $('affine-target').value = source; renderAffineMap(); };
  $('affine-export').onclick = () => {
    if (!state.affineExport) return;
    const json = JSON.stringify(state.affineExport,null,2), url = URL.createObjectURL(new Blob([json],{type:'application/json'}));
    state.exportURL = url; $('export-title').textContent = 'Affine map JSON'; $('export-json').value = json; $('export-feedback').textContent = '';
    $('export-description').textContent = 'Save or copy the exact affine map, its direction, coordinate convention and verification result.';
    $('export-download').href = url; $('export-download').download = 'noby-'+state.family+state.n+'-affine-map.json'; $('export-dialog').showModal();
  };
  $('sequence-form').onsubmit = event => {
    event.preventDefault(); if (state.busy) return;
    try {
      const wordMode = $('input-mode').value === 'word', input = parseSequence($('sequence').value, wordMode);
      calculate(wordMode ? [] : input, wordMode ? input : null);
    } catch (error) { status(error.message, 'error'); }
  };
  $('undo').onclick = () => { if (!state.busy && state.seed) calculate(state.seed.sequence.slice(0, -1)); };
  $('reset').onclick = () => { ++state.request; initWorker(); calculate([]); };
  $('export').onclick = () => {
    if (!state.seed || state.busy) return;
    $('export-title').textContent = 'Export current seed';
    $('export-description').textContent = 'Save or copy this exact seed, including its mutation path and coordinate convention.';
    const content = { schemaVersion: 1, generator: 'NOBY ' + E.version, polarization: '2rho', centered: true, ...state.seed, storedSeedId: state.match?.record.id ?? null, storedRepresentativeSequence: state.match?.record.sequence ?? null, storedCoordinatePermutation: state.match?.permutation ?? null, storedMatchScope: state.match ? 'B-and-H-up-to-mutable-permutation' : null, fVector: state.match?.record.fVector ?? null, combinatoriallyEquivalentSequences: state.match ? equivalentRecords().map(record => record.sequence) : null };
    const json = JSON.stringify(content, null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    state.exportURL = url;
    $('export-json').value = json; $('export-feedback').textContent = '';
    $('export-download').href = url;
    $('export-download').download = 'noby-' + (state.family === 'B' ? 'B' : 'SL') + state.n + '-' + (state.seed.sequence.join('-') || 'seed0') + '.json';
    $('export-dialog').showModal();
  };
  $('export-close').onclick = () => $('export-dialog').close();
  $('export-dialog').addEventListener('close', () => { const url = state.exportURL; if (url) setTimeout(() => URL.revokeObjectURL(url), 30000); });
  $('export-copy').onclick = async () => {
    try { await navigator.clipboard.writeText($('export-json').value); $('export-feedback').textContent = 'Copied.'; }
    catch (_) { $('export-json').focus(); $('export-json').select(); $('export-feedback').textContent = 'JSON selected. Use your browser’s Copy command.'; }
  };
  for (const mode of ['formula', 'coefficients']) $('h-' + mode).onclick = () => { state.hMode = mode; renderH(); };
  $('quiver-plus').onclick = () => { state.zoom = Math.min(5, state.zoom * 1.3); renderQuiver(); renderWiring(); };
  $('quiver-minus').onclick = () => { state.zoom = Math.max(.6, state.zoom / 1.3); renderQuiver(); renderWiring(); };
  $('quiver-fit').onclick = () => { state.zoom = 1; renderQuiver(); renderWiring(); };
  $('wiring-arrows').onchange=()=>{$('wiring-diagram').classList.toggle('hide-arrows',!$('wiring-arrows').checked);};
  // A small, read-only interface for reproducible inspection of the displayed state.
  window.NOBY = { getState: () => JSON.parse(JSON.stringify({ family: state.family, n: state.n, seed: state.seed, match: state.match, busy: state.busy })), parseSequence };
  if (!E) { failure('The calculation engine did not load. Keep engine.js beside index.html.'); return; }
  if (!C) { failure('The catalogue matcher did not load. Keep catalogue.js beside index.html.'); return; }
  changeN(4);
})();
