import fs from 'fs';

const filePath = '/Users/divyanshdahiya/Desktop/Studies - MSc/German/B1/german-dashboard/public/b1_vocab_data.json';
const vocabData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const shuffleArray = (array) => {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

const buildPrioritizedQueue = (words) => {
  const high = shuffleArray(words.filter(w => w.priority === 1 || !w.priority));
  const med = shuffleArray(words.filter(w => w.priority === 2));
  const low = shuffleArray(words.filter(w => w.priority === 3));

  const finalQueue = [];
  let hIndex = 0, mIndex = 0, lIndex = 0;

  while (hIndex < high.length || mIndex < med.length || lIndex < low.length) {
    const batch = [];
    for (let i = 0; i < 6; i++) {
      if (hIndex < high.length) batch.push(high[hIndex++]);
    }
    for (let i = 0; i < 3; i++) {
      if (mIndex < med.length) batch.push(med[mIndex++]);
    }
    for (let i = 0; i < 1; i++) {
      if (lIndex < low.length) batch.push(low[lIndex++]);
    }
    while (batch.length < 10 && (hIndex < high.length || mIndex < med.length || lIndex < low.length)) {
      if (hIndex < high.length) batch.push(high[hIndex++]);
      else if (mIndex < med.length) batch.push(med[mIndex++]);
      else if (lIndex < low.length) batch.push(low[lIndex++]);
    }
    finalQueue.push(...shuffleArray(batch));
  }
  return finalQueue;
};

// Test with all nouns
const nouns = vocabData.nouns.map(x => ({ ...x }));
const queue = buildPrioritizedQueue(nouns);

console.log('Total queue size:', queue.length);
console.log('First 20 items priorities:', queue.slice(0, 20).map(x => x.priority).join(', '));

// Check ratio in batches of 10
for (let b = 0; b < 5; b++) {
  const batch = queue.slice(b * 10, (b + 1) * 10);
  const counts = {
    high: batch.filter(x => x.priority === 1).length,
    med: batch.filter(x => x.priority === 2).length,
    low: batch.filter(x => x.priority === 3).length
  };
  console.log(`Batch ${b + 1} distribution (High/Med/Low):`, `${counts.high}h / ${counts.med}m / ${counts.low}l`);
}
