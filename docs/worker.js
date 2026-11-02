'use strict';
importScripts('engine.js', 'words.js', 'data/type-b-initial.js', 'type-b.js');
const cache = new Map();
const key = (n, sequence, family='A') => family + n + ':' + sequence.join(',');
function remember(seed) {
  const id = key(seed.n, seed.sequence, seed.family);
  cache.set(id, seed);
  if (cache.size > 80) cache.delete(cache.keys().next().value);
  return seed;
}
self.onmessage = ({ data }) => {
  const { id, n, reducedWord, family='A' } = data;
  let sequence = data.sequence;
  try {
    const started = Date.now();
    let wordInfo = null;
    if (reducedWord) {
      if(family!=='A')throw new Error('Reduced-word routing is currently available only for type A. Use a mutation sequence for type B.');
      self.postMessage({ id, resolvingWord: true });
      wordInfo = NObyWords.resolve(n, reducedWord);
      sequence = wordInfo.sequence;
    }
    let seed, length = sequence.length;
    while (length >= 0) {
      seed = cache.get(key(n, sequence.slice(0, length),family));
      if (seed) break;
      length--;
    }
    if (!seed) { seed = remember(family==='B'?NObyTypeB.initialSeed(n):NObyEngine.initialSeed(n)); length = 0; }
    for (let i = length; i < sequence.length; i++) {
      self.postMessage({ id, progress: i + 1, total: sequence.length });
      seed = remember(NObyEngine.mutate(seed, sequence[i] - 1));
    }
    if (wordInfo && JSON.stringify(seed.B) !== JSON.stringify(NObyWords.wordMatrix(n, reducedWord, wordInfo.chamberLabels)))
      throw new Error('The computed matrix does not match the reduced-word chamber seed.');
    self.postMessage({ id, seed: { ...seed, reducedWordInfo: wordInfo }, milliseconds: Date.now() - started });
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
