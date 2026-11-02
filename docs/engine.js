/* Exact, dependency-free calculations for the anticanonical full flag browser.
 * B has N rows and r mutable columns; H rows are [constant, ...inwardNormal].
 * Public mutation directions are zero-based; displayed sequences are one-based.
 * See MATH.md for conventions, the H-mutation proof, and limitations. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.NObyEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const DEFAULT_LIMITS = { maxFacets: 1200, maxPivots: 12000, maxMilliseconds: 25000 };
  function assert(condition, message) { if (!condition) throw new Error(message); }
  function integer(x) { assert(Number.isSafeInteger(x), 'An integer exceeds the exact browser range. Export this path for SageMath.'); return x === 0 ? 0 : x; }
  function asNumber(x) { const n = Number(x); assert(Number.isSafeInteger(n) && BigInt(n) === x, 'An integer exceeds the exact browser range. Export this path for SageMath.'); return n === 0 ? 0 : n; }
  function dot(a, b) { let v = 0n; for (let i = 0; i < a.length; i++) v += BigInt(a[i]) * BigInt(b[i]); return asNumber(v); }
  const zeros = n => Array(n).fill(0);
  const unique = rows => Array.from(new Map(rows.map(row => [row.join(','), row])).values());
  function context(options) { return { ...DEFAULT_LIMITS, ...options, started: Date.now(), pivots: 0, lpCount: 0 }; }
  function check(ctx) {
    assert(ctx.pivots <= ctx.maxPivots && Date.now() - ctx.started <= ctx.maxMilliseconds,
      'Exact polytope calculation reached the browser resource limit. The previous seed is preserved; export the path for SageMath.');
  }

  // Reduced word 1, 2,1, 3,2,1, ... ; frozen vertices form its last row.
  function initialSeed(n) {
    assert(Number.isInteger(n) && n >= 3 && n <= 30, 'Choose an integer n between 3 and 30.');
    const dimension = n * (n - 1) / 2, mutableCount = (n - 1) * (n - 2) / 2;
    const B = Array.from({ length: dimension }, () => zeros(mutableCount));
    const word = [], positions = [], H = [];
    const index = (row, col) => row * (row + 1) / 2 + col;
    function arrow(from, to) { // As in the notebook: a -> b means B[a,b] = -1.
      if (to < mutableCount) B[from][to]--;
      if (from < mutableCount) B[to][from]++;
    }
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col <= row; col++) {
        const id = index(row, col);
        word.push(row - col + 1);
        positions.push({ id, row, col, x: row + col, y: n - 2 - row + col, frozen: id >= mutableCount });
        const positive = zeros(dimension), negative = zeros(dimension);
        for (let next = row; next < n - 1; next++) {
          positive[index(next, col)] = 1;
          negative[index(next, col + next - row)] = -1;
        }
        H.push([1, ...positive], [1, ...negative]);
        if (row < n - 2) {
          arrow(id, index(row + 1, col));
          arrow(index(row + 1, col + 1), id);
          // Horizontal edge within the next mutable row; no frozen-frozen edges.
          if (row + 1 < n - 2) arrow(index(row + 1, col), index(row + 1, col + 1));
        }
      }
    }
    return { n, dimension, mutableCount, word, B, positions, H, sequence: [],
      clusterVariables: Array.from({ length: dimension }, (_, i) => 'x' + (i + 1)),
      relations: [], hStatus: 'exact', convention: 'centered-anticanonical-natural-triangular-order' };
  }

  function validateMatrix(B, k) {
    assert(Array.isArray(B) && B.length && B[0].length, 'B must be an extended exchange matrix.');
    const r = B[0].length;
    assert(Number.isInteger(k) && k >= 0 && k < r, 'Only mutable vertices can be mutated.');
    B.forEach(row => { assert(row.length === r, 'Inconsistent B-matrix row lengths.'); row.forEach(integer); });
    assert(B.length >= r, 'B needs at least as many rows as mutable columns.');
    // Certify a positive diagonal symmetrizer, including consistency on cycles.
    const weights = Array(r).fill(null);
    for (let start = 0; start < r; start++) {
      if (weights[start]) continue;
      weights[start] = fraction(1n);
      const queue = [start];
      while (queue.length) {
        const i = queue.pop();
        assert(B[i][i] === 0, 'The exchange matrix diagonal must vanish.');
        for (let j = 0; j < r; j++) {
          const a = B[i][j], b = B[j][i];
          assert((a === 0 && b === 0) || (a < 0 && b > 0) || (a > 0 && b < 0), 'The principal B-matrix must be skew-symmetrizable.');
          if (!a) continue;
          const w = mul(weights[i], fraction(BigInt(-a), BigInt(b)));
          if (weights[j]) assert(compare(weights[j], w) === 0, 'The principal B-matrix has no positive symmetrizer.');
          else { weights[j] = w; queue.push(j); }
        }
      }
    }
  }
  function mutateMatrix(B, k) {
    validateMatrix(B, k);
    return B.map((row, i) => row.map((v, j) => {
      if (i === k || j === k) return -v || 0;
      const a = BigInt(B[i][k]), b = BigInt(B[k][j]);
      return asNumber(BigInt(v) + (a > 0n && b > 0n ? a * b : a < 0n && b < 0n ? -a * b : 0n));
    }));
  }
  function tropicalPoint(point, B, k) {
    validateMatrix(B, k);
    assert(point.length === B.length, 'Point dimension does not match B.');
    const xk = point[k];
    return point.map((x, j) => j === k ? -xk : x + Math.max(xk >= 0 ? -B[j][k] : B[j][k], 0) * xk);
  }

  // Reduced BigInt fractions, used only by the internal exact LP solver.
  function gcd(a, b) { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) { const t = a % b; a = b; b = t; } return a; }
  const ZERO = { n: 0n, d: 1n }, ONE = { n: 1n, d: 1n };
  function fraction(n, d = 1n) { if (!n) return ZERO; if (d < 0n) { n = -n; d = -d; } const g = gcd(n, d); return { n: n / g, d: d / g }; }
  function neg(a) { return a.n ? { n: -a.n, d: a.d } : ZERO; }
  function sub(a, b) { if (!b.n) return a; if (!a.n) return neg(b); return fraction(a.n * b.d - b.n * a.d, a.d * b.d); }
  function mul(a, b) { if (!a.n || !b.n) return ZERO; const g = gcd(a.n, b.d), h = gcd(b.n, a.d); return { n: (a.n / g) * (b.n / h), d: (a.d / h) * (b.d / g) }; }
  function div(a, b) { assert(b.n !== 0n, 'Zero pivot in exact LP.'); return mul(a, fraction(b.d, b.n)); }
  function compare(a, b) { const z = a.n * b.d - b.n * a.d; return z < 0n ? -1 : z > 0n ? 1 : 0; }

  // Maximize objective.x over H, with free x and the feasible starting point 0.
  // Bland's rule prevents cycling at the tropical splitting wall.
  function maximize(H, objective, ctx, cutoff) {
    ctx.lpCount++;
    check(ctx);
    const m = H.length, d = objective.length, vars = 2 * d;
    const table = H.map(row => {
      assert(row[0] >= 0, 'Exact LP requires the origin to be feasible.');
      return [...row.slice(1).map(a => fraction(BigInt(-a))), ...row.slice(1).map(a => fraction(BigInt(a))), fraction(BigInt(row[0]))];
    });
    table.push([...objective.map(a => fraction(BigInt(-a))), ...objective.map(a => fraction(BigInt(a))), ZERO]);
    const basic = Array.from({ length: m }, (_, i) => vars + i), nonbasic = Array.from({ length: vars }, (_, i) => i);
    const bound = cutoff === undefined ? null : fraction(BigInt(cutoff));
    while (true) {
      if (bound && compare(table[m][vars], bound) > 0) return { value: table[m][vars], exceeds: true };
      let s = -1;
      for (let j = 0; j < vars; j++) if (table[m][j].n < 0n && (s < 0 || nonbasic[j] < nonbasic[s])) s = j;
      if (s < 0) return { value: table[m][vars], unbounded: false };
      let r = -1, ratio;
      for (let i = 0; i < m; i++) if (table[i][s].n > 0n) {
        const candidate = div(table[i][vars], table[i][s]);
        const cmp = r < 0 ? -1 : compare(candidate, ratio);
        if (r < 0 || cmp < 0 || (cmp === 0 && basic[i] < basic[r])) { r = i; ratio = candidate; }
      }
      if (r < 0) return { unbounded: true };
      const pivot = table[r][s], inverse = div(ONE, pivot);
      for (let i = 0; i <= m; i++) if (i !== r && table[i][s].n) {
        const factor = mul(table[i][s], inverse);
        for (let j = 0; j <= vars; j++) if (j !== s && table[r][j].n) table[i][j] = sub(table[i][j], mul(table[r][j], factor));
      }
      for (let j = 0; j <= vars; j++) if (j !== s) table[r][j] = mul(table[r][j], inverse);
      for (let i = 0; i <= m; i++) if (i !== r) table[i][s] = neg(mul(table[i][s], inverse));
      table[r][s] = inverse;
      [basic[r], nonbasic[s]] = [nonbasic[s], basic[r]];
      ctx.pivots++;
      check(ctx);
    }
  }
  function implies(H, row, ctx) {
    const result = maximize(H, row.slice(1).map(x => -x), ctx, row[0]);
    return !result.unbounded && !result.exceeds && compare(result.value, fraction(BigInt(row[0]))) <= 0;
  }
  function removeRedundancy(H, ctx) {
    const rows = unique(H);
    for (let i = rows.length - 1; i >= 0; i--) if (implies(rows.filter((_, j) => j !== i), rows[i], ctx)) rows.splice(i, 1);
    return rows;
  }
  function mutateH(H, B, k, options) {
    validateMatrix(B, k);
    const d = B.length, ctx = context(options);
    assert(H.length <= ctx.maxFacets, 'Too many inequalities for this browser calculation. Export the path for SageMath.');
    H.forEach(row => { assert(row.length === d + 1 && row[0] > 0, 'H must describe a full-dimensional polytope containing the origin in its interior.'); row.forEach(integer); });
    const plus = B.map(row => Math.max(-row[k], 0)), minus = B.map(row => Math.max(row[k], 0));
    const positiveWall = [0, ...zeros(d)], negativeWall = [0, ...zeros(d)];
    positiveWall[k + 1] = 1; negativeWall[k + 1] = -1;
    const candidates = [];
    for (const row of H) {
      const a = row.slice(1), p = dot(a, plus), m = dot(a, minus), q = integer(m - p);
      const aPlus = row.slice(), aMinus = row.slice();
      aPlus[k + 1] = integer(-a[k] + p); aMinus[k + 1] = integer(-a[k] + m);
      if (q <= 0) {
        candidates.push(aPlus, aMinus);
      } else {
        // Test the other half of P; on its own half the candidate is automatic.
        const testPlus = row.slice(), testMinus = row.slice();
        testPlus[k + 1] = integer(a[k] + q); testMinus[k + 1] = integer(a[k] - q);
        if (implies([...H, negativeWall], testPlus, ctx)) candidates.push(aPlus);
        if (implies([...H, positiveWall], testMinus, ctx)) candidates.push(aMinus);
      }
      check(ctx);
    }
    assert(candidates.length > d, 'No bounded convex image was found. Check the B/H coordinate convention.');
    assert(candidates.length <= ctx.maxFacets * 2, 'The inequality count exceeds this browser calculation limit.');
    const result = removeRedundancy(candidates, ctx);
    assert(result.length > d && result.length <= ctx.maxFacets, 'The image exceeds this browser calculation limit.');
    // Certify equality, not just containment. Each half of the result must pull
    // back into P. This also rejects a nonconvex image from inconsistent B/H data.
    for (const row of H) {
      const a = row.slice(1), aPlus = row.slice(), aMinus = row.slice();
      aPlus[k + 1] = integer(-a[k] + dot(a, plus));
      aMinus[k + 1] = integer(-a[k] + dot(a, minus));
      assert(implies([...result, negativeWall], aPlus, ctx) && implies([...result, positiveWall], aMinus, ctx),
        'The tropical image is not convex in the supplied B/H coordinates. Check the seed convention before continuing.');
    }
    return { H: result, stats: { exact: true, lpCount: ctx.lpCount, pivots: ctx.pivots, milliseconds: Date.now() - ctx.started, candidateCount: candidates.length } };
  }
  function mutate(seed, k, options) {
    validateMatrix(seed.B, k);
    const polytope = mutateH(seed.H, seed.B, k, options);
    const variables = seed.clusterVariables.slice(), relations = (seed.relations || []).slice();
    const id = 'u' + (relations.length + 1), positive = [], negative = [];
    seed.B.forEach((row, i) => {
      if (row[k] > 0) positive.push({ variable: variables[i], power: row[k] });
      if (row[k] < 0) negative.push({ variable: variables[i], power: -row[k] });
    });
    relations.push({ variable: id, divisor: variables[k], positive, negative, direction: k + 1 });
    variables[k] = id;
    return { ...seed, B: mutateMatrix(seed.B, k), H: polytope.H, sequence: [...seed.sequence, k + 1],
      clusterVariables: variables, relations, computation: polytope.stats, hStatus: 'exact' };
  }
  function evaluateH(H, point) { return H.map(row => row[0] + row.slice(1).reduce((s, a, i) => s + a * point[i], 0)); }

  function irredundantH(H, options) {
    assert(H.length && H.every(row => row.length === H[0].length && row[0] > 0 && row.every(Number.isSafeInteger)), 'Expected integer H rows containing the origin in their interior.');
    return removeRedundancy(H, context(options));
  }
  function linearMaximum(H, objective, options) {
    assert(H.length && H.every(row => row.length === objective.length + 1 && row[0] >= 0 && row.every(Number.isSafeInteger)) && objective.every(Number.isSafeInteger), 'Expected integer inequalities with feasible origin.');
    const result = maximize(H, objective, context(options));
    return result.unbounded ? {unbounded:true} : {unbounded:false, numerator:String(result.value.n), denominator:String(result.value.d)};
  }
  return { initialSeed, mutate, mutateMatrix, mutateH, tropicalPoint, evaluateH, irredundantH, linearMaximum,
    version: '1.0.0', DEFAULT_LIMITS };
});
