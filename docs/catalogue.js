/* Exact catalogue lookup, allowing mutable labels to change and fixing frozen labels. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NObyCatalogue = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const cache = new WeakMap();
  const sorted = values => values.sort().join(';');
  const hSignature = H => sorted(H.map(row => row.join(',')));

  function validShape(seed, dimension, mutableCount) {
    return Array.isArray(seed.B) && seed.B.length === dimension &&
      seed.B.every(row => Array.isArray(row) && row.length === mutableCount && row.every(Number.isSafeInteger)) &&
      Array.isArray(seed.H) && seed.H.every(row => Array.isArray(row) && row.length === dimension + 1 && row.every(Number.isSafeInteger));
  }

  // These fingerprints are necessary conditions, never proof of a match. H rows
  // retain their constants and frozen coefficients while mutable coefficients
  // are sorted, so arbitrary mutable relabeling leaves the fingerprint intact.
  function describe(seed, dimension, mutableCount) {
    const { B, H } = seed;
    const rowKeys = H.map(row => [row[0], ...row.slice(mutableCount + 1)].join(',') + ':' +
      row.slice(1, mutableCount + 1).sort((a, b) => a - b).join(','));
    const frozenColumns = Array.from({ length: mutableCount }, (_, j) =>
      B.slice(mutableCount).map(row => row[j]).join(','));
    const vertexKeys = frozenColumns.map((frozen, j) => frozen + '|' +
      B[j].slice().sort((a, b) => a - b).join(',') + '|' +
      sorted(H.map((row, i) => rowKeys[i] + ':' + row[j + 1])));
    return {
      seed,
      vertexKeys,
      key: dimension + '/' + mutableCount + '|' + sorted(rowKeys.slice()) + '|' + sorted(frozenColumns.slice()),
      hSignature: hSignature(H)
    };
  }

  function findPermutation(live, stored, dimension, mutableCount) {
    const source = live.seed, target = stored.seed;
    const choices = live.vertexKeys.map(key => stored.vertexKeys.flatMap((candidate, i) => candidate === key ? [i] : []));
    if (choices.some(list => !list.length)) return null;
    // Assign the most constrained vertex first. In these catalogues the frozen
    // rows and H columns usually determine every mutable image immediately.
    const order = Array.from({ length: mutableCount }, (_, i) => i).sort((a, b) => choices[a].length - choices[b].length);
    const permutation = Array.from({ length: dimension }, (_, i) => i < mutableCount ? -1 : i);
    const used = new Set();
    function visit(depth) {
      if (depth === mutableCount) {
        // Check the complete matrices, including frozen rows, and every H row.
        if (!source.B.every((row, i) => row.every((value, j) => value === target.B[permutation[i]][permutation[j]]))) return null;
        const transformed = target.H.map(row => [row[0], ...permutation.map(i => row[i + 1])]);
        return hSignature(transformed) === live.hSignature ? permutation.slice() : null;
      }
      const i = order[depth];
      for (const candidate of choices[i]) {
        if (used.has(candidate) || source.B[i][i] !== target.B[candidate][candidate]) continue;
        let compatible = true;
        for (let earlier = 0; earlier < depth; earlier++) {
          const j = order[earlier], image = permutation[j];
          if (source.B[i][j] !== target.B[candidate][image] || source.B[j][i] !== target.B[image][candidate]) {
            compatible = false;
            break;
          }
        }
        if (!compatible) continue;
        permutation[i] = candidate;
        used.add(candidate);
        const result = visit(depth + 1);
        if (result) return result;
        used.delete(candidate);
        permutation[i] = -1;
      }
      return null;
    }
    return visit(0);
  }

  function createMatcher(data) {
    const records = data && Array.isArray(data.seeds) ? data.seeds : [];
    const dimension = data && (data.dimension || records[0]?.B.length);
    const mutableCount = data && (data.mutableCount || records[0]?.B[0]?.length);
    const buckets = new Map();
    if (Number.isInteger(dimension) && Number.isInteger(mutableCount)) {
      for (const record of records) {
        if (!validShape(record, dimension, mutableCount)) continue;
        const description = describe(record, dimension, mutableCount);
        if (!buckets.has(description.key)) buckets.set(description.key, []);
        buckets.get(description.key).push(description);
      }
    }
    return {
      match(seed) {
        if (!seed || !data || !Number.isInteger(dimension) || !Number.isInteger(mutableCount) || seed.dimension !== dimension || seed.mutableCount !== mutableCount ||
            (seed.n != null && data.n != null && seed.n !== data.n) || (seed.family||'A') !== (data.family||'A') || !validShape(seed, dimension, mutableCount)) return null;
        const live = describe(seed, dimension, mutableCount), matches = [];
        for (const candidate of buckets.get(live.key) || []) {
          const permutation = findPermutation(live, candidate, dimension, mutableCount);
          if (permutation) matches.push({ record: candidate.seed, permutation });
        }
        // A B/H match can prove archived invariants, but does not by itself
        // distinguish two archived seed identities. Keep ambiguity explicit.
        if (matches.length === 1) return matches[0];
        if (matches.length > 1 && matches[0].record.polytopeClass != null &&
            matches.every(match => match.record.polytopeClass === matches[0].record.polytopeClass)) {
          return { ...matches[0], invariantsOnly: true, ambiguous: true, records: matches.map(match => match.record) };
        }
        return null;
      }
    };
  }

  function match(seed, data) {
    if (!data || typeof data !== 'object') return null;
    if (!cache.has(data)) cache.set(data, createMatcher(data));
    return cache.get(data).match(seed);
  }

  return { createMatcher, match };
});
