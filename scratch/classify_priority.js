import fs from 'fs';
import path from 'path';

const filePath = '/Users/divyanshdahiya/Desktop/Studies - MSc/German/B1/german-dashboard/public/b1_vocab_data.json';
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const commonRoots = new Set([
  // Verbs
  'sein', 'haben', 'werden', 'machen', 'tun', 'gehen', 'kommen', 'sehen', 'sprechen', 'sagen', 'fragen', 'antworten',
  'schreiben', 'lesen', 'hören', 'verstehen', 'lernen', 'arbeiten', 'wohnen', 'leben', 'essen', 'trinken', 'schlafen',
  'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'mögen', 'wissen', 'kennen', 'glauben', 'denken', 'finden',
  'geben', 'nehmen', 'bringen', 'holen', 'kaufen', 'verkaufen', 'helfen', 'suchen', 'fahren', 'fliegen',
  'laufen', 'stehen', 'liegen', 'sitzen', 'legen', 'stellen', 'setzen', 'bleiben', 'zeigen', 'öffnen', 'schließen',
  // Adjectives
  'gut', 'schlecht', 'groß', 'klein', 'neu', 'alt', 'jung', 'schön', 'hässlich', 'billig', 'teuer', 'warm', 'kalt',
  'schnell', 'langsam', 'einfach', 'schwer', 'leicht', 'wichtig', 'richtig', 'falsch', 'frei', 'besetzt', 'ganz',
  'viel', 'wenig', 'hoch', 'tief', 'nah', 'weit', 'kurz', 'lang', 'hell', 'dunkel', 'glücklich', 'traurig', 'müde',
  'krank', 'gesund', 'früh', 'spät', 'sicher', 'klar', 'bereit', 'fertig',
  // Nouns
  'tag', 'nacht', 'jahr', 'monat', 'woche', 'zeit', 'arbeit', 'schule', 'freund', 'familie', 'haus', 'wohnung',
  'zimmer', 'auto', 'bus', 'zug', 'weg', 'straße', 'wasser', 'brot', 'essen', 'kaffee', 'tee', 'geld', 'buch',
  'computer', 'handy', 'telefon', 'mann', 'frau', 'kind', 'stadt', 'land', 'leute', 'eltern', 'freundin', 'name',
  'nummer', 'bild', 'uhr', 'morgen', 'abend', 'arzt', 'hilfe', 'frage', 'antwort', 'spiel', 'sport'
]);

function getCleanWord(word) {
  return word.toLowerCase()
    .replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
    .replace(/\(.*\)/g, '')
    .replace(/,.*$/, '')
    .trim();
}

function classifyCategory(list) {
  // 1. Identify common root words first (pre-assigned to High priority)
  const items = list.map((item, index) => {
    const clean = getCleanWord(item.word);
    let isCommon = false;
    for (let root of commonRoots) {
      if (clean === root || clean.startsWith(root) || clean.endsWith(root)) {
        isCommon = true;
        break;
      }
    }
    return {
      originalIndex: index,
      item: { ...item },
      clean,
      isCommon,
      length: clean.length
    };
  });

  // Separate common roots
  const highPriorityItems = items.filter(x => x.isCommon);
  const remainingItems = items.filter(x => !x.isCommon);

  // Sort remaining by length (shorter = more common)
  remainingItems.sort((a, b) => a.length - b.length);

  const totalSize = list.length;
  const targetHigh = Math.round(totalSize * 0.6);
  const targetMed = Math.round(totalSize * 0.3);
  const targetLow = totalSize - targetHigh - targetMed;

  // We need highPriorityItems.length + remainingHighCount = targetHigh
  const highNeeded = Math.max(0, targetHigh - highPriorityItems.length);
  
  // Distribute remaining
  const remainingHigh = remainingItems.slice(0, highNeeded);
  const remainingMedAndLow = remainingItems.slice(highNeeded);

  // Of the med/low pool, take targetMed for medium, rest for low
  const medNeeded = Math.min(targetMed, remainingMedAndLow.length);
  const remainingMed = remainingMedAndLow.slice(0, medNeeded);
  const remainingLow = remainingMedAndLow.slice(medNeeded);

  // Assign priorities
  highPriorityItems.forEach(x => x.item.priority = 1);
  remainingHigh.forEach(x => x.item.priority = 1);
  remainingMed.forEach(x => x.item.priority = 2);
  remainingLow.forEach(x => x.item.priority = 3);

  // Re-assemble in original order
  const finalItems = [...highPriorityItems, ...remainingHigh, ...remainingMed, ...remainingLow];
  finalItems.sort((a, b) => a.originalIndex - b.originalIndex);

  return finalItems.map(x => x.item);
}

// Classify each category
data.nouns = classifyCategory(data.nouns);
data.verbs = classifyCategory(data.verbs);
data.adjectives = classifyCategory(data.adjectives);
data.connectors = classifyCategory(data.connectors);

// Save updated JSON
fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

console.log('Successfully classified vocabulary with priority fields!');
console.log('Nouns distribution:', {
  high: data.nouns.filter(x => x.priority === 1).length,
  medium: data.nouns.filter(x => x.priority === 2).length,
  low: data.nouns.filter(x => x.priority === 3).length
});
console.log('Verbs distribution:', {
  high: data.verbs.filter(x => x.priority === 1).length,
  medium: data.verbs.filter(x => x.priority === 2).length,
  low: data.verbs.filter(x => x.priority === 3).length
});
console.log('Adjectives distribution:', {
  high: data.adjectives.filter(x => x.priority === 1).length,
  medium: data.adjectives.filter(x => x.priority === 2).length,
  low: data.adjectives.filter(x => x.priority === 3).length
});
console.log('Connectors distribution:', {
  high: data.connectors.filter(x => x.priority === 1).length,
  medium: data.connectors.filter(x => x.priority === 2).length,
  low: data.connectors.filter(x => x.priority === 3).length
});
