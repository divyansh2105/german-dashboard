import fs from 'fs';

const filePath = '/Users/divyanshdahiya/Desktop/Studies - MSc/German/B1/german-dashboard/public/b1_vocab_data.json';
const vocabData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

const getActualWordFirstLetter = (word) => {
  let w = word.trim();
  w = w.replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
       .replace(/\(sich(\s+etwas)?\)\s+/i, '')
       .replace(/^["(]*/, '')
       .trim();
       
  if (w.length === 0) return '';
  const firstChar = w.charAt(0).toUpperCase();
  if (firstChar === 'Ä') return 'A';
  if (firstChar === 'Ö') return 'O';
  if (firstChar === 'Ü') return 'U';
  
  return /[A-Z]/.test(firstChar) ? firstChar : '';
};

const normalizeCategory = (cat) => {
  if (!cat) return '';
  return cat.toLowerCase()
            .replace(/&amp;/g, '&')
            .replace(/&/g, 'and')
            .replace(/[^a-z0-9]/g, '')
            .trim();
};

function testFilter(activeCategory, selectedPriorityFilter, selectedClassFilter, selectedLetter) {
  const activeWords = vocabData[activeCategory] || [];
  
  // availableLetters computation
  const letters = new Set();
  activeWords.forEach(item => {
    if ((activeCategory === 'nouns' || activeCategory === 'verbs') && selectedClassFilter !== 'all') {
      const target = normalizeCategory(selectedClassFilter);
      const matchesClass = normalizeCategory(item.primaryCategory) === target || normalizeCategory(item.secondaryCategory) === target;
      if (!matchesClass) return;
    }
    if (selectedPriorityFilter !== 'all') {
      const pVal = parseInt(selectedPriorityFilter);
      if (item.priority !== pVal) return;
    }
    const firstLetter = getActualWordFirstLetter(item.word);
    if (firstLetter) {
      letters.add(firstLetter);
    }
  });
  const availableLetters = Array.from(letters).sort();

  // If selectedLetter is not available, default to first available
  let activeLetter = selectedLetter;
  if (availableLetters.length > 0) {
    if (!availableLetters.includes(activeLetter)) {
      activeLetter = availableLetters[0];
    }
  } else {
    activeLetter = '';
  }

  // Filter
  const filtered = activeWords.filter(item => {
    if ((activeCategory === 'nouns' || activeCategory === 'verbs') && selectedClassFilter !== 'all') {
      const target = normalizeCategory(selectedClassFilter);
      const matchesClass = normalizeCategory(item.primaryCategory) === target || normalizeCategory(item.secondaryCategory) === target;
      if (!matchesClass) return false;
    }

    if (selectedPriorityFilter !== 'all') {
      const pVal = parseInt(selectedPriorityFilter);
      if (item.priority !== pVal) return false;
    }

    if ((activeCategory === 'nouns' || activeCategory === 'verbs') && selectedClassFilter !== 'all') {
      return true;
    }
    
    const firstLetter = getActualWordFirstLetter(item.word);
    return activeLetter ? firstLetter === activeLetter : true;
  });

  console.log(`[Category: ${activeCategory}, Priority: ${selectedPriorityFilter}]`);
  console.log('Available letters count:', availableLetters.length, 'Letters:', availableLetters.join(', '));
  console.log('Snapped Letter:', activeLetter);
  console.log('Filtered words count:', filtered.length);
  if (filtered.length > 0) {
    console.log('Sample filtered word:', filtered[0].word, 'Priority:', filtered[0].priority);
  }
  console.log('----------------------------------------------------');
}

testFilter('verbs', '1', 'all', 'A');
testFilter('verbs', '2', 'all', 'A');
testFilter('verbs', '3', 'all', 'A');
testFilter('nouns', '1', 'all', 'A');
testFilter('nouns', '2', 'all', 'A');
testFilter('nouns', '3', 'all', 'A');
