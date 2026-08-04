import fs from 'fs';
import path from 'path';

const filePath = '/Users/divyanshdahiya/Desktop/Studies - MSc/German/B1/german-dashboard/public/b1_vocab_data.json';
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

// Keywords or substrings to identify Priority 3 (niche, technical, specialized)
const priority3Keywords = [
  'runterfahren', 'herunterfahren', 'herstellen', 'verurteilen', 'herunterladen', 'installieren', 'software',
  'datenbank', 'netzwerk', 'exportieren', 'importieren', 'justiz', 'urteil', 'straftat', 'gericht', 'anklagen',
  'verschmutzen', 'abgas', 'industrie', 'kraftwerk', 'produzieren', 'produktion', 'fabrik', 'technisch',
  'umweltschutz', 'klimawandel', 'wissenschaft', 'forscher', 'forschung', 'labor', 'chemie', 'physik', 'biologie',
  'import', 'export', 'tastatur', 'bildschirm', 'leitung', 'strom', 'energie', 'kopieren', 'speichern', 'verhaften',
  'anklage', 'gestehen', 'richter', 'zeuge', 'beweis', 'gefängnis', 'haft', 'strafbar', 'kriminell', 'justizbehörde',
  'cyber', 'prozessor', 'digitalisierung', 'konfigurieren', 'programmierer', 'programmieren', 'webseite', 'link',
  'server', 'hardware', 'system', 'technologie', 'ingenieur', 'konstruieren', 'konstruktion', 'analyse', 'analysieren'
];

// Keywords or substrings to identify Priority 2 (functional B1 situational - bureaucracy, medical, finance, office)
const priority2Keywords = [
  'beantragen', 'verschreiben', 'vereinbaren', 'überweisen', 'anmelden', 'abmelden', 'eintragen', 'ausfüllen',
  'unterschreiben', 'kündigen', 'abholen', 'versicherung', 'bescheinigung', 'formular', 'antrag', 'arzt',
  'medizin', 'tablette', 'apotheke', 'krankenhaus', 'krankenkasse', 'rezept', 'fieber', 'schmerz', 'pflaster',
  'verband', 'termin', 'besprechung', 'chef', 'kollege', 'konferenz', 'büro', 'konto', 'gebühr', 'bank',
  'kredit', 'zinsen', 'steuer', 'sparen', 'geldautomat', 'abheben', 'quittung', 'rechnung', 'pass', 'ausweis',
  'behörde', 'amt', 'dokument', 'vertrag', 'arbeitsvertrag', 'mietvertrag', 'kaution', 'überweisung', 'arztpraxis',
  'überweisen', 'patient', 'behandlung', 'therapie', 'diagnose', 'symptom', 'krankmeldung', 'personalabteilung',
  'bewerbung', 'lebenslauf', 'zeugnis', 'quittung', 'kontoauszug', 'zoll', 'steuererklärung', 'visum', 'konsulat'
];

// Core words that are explicitly Priority 1 (essential core)
const priority1Words = [
  'verstehen', 'brauchen', 'arbeiten', 'mieten', 'anrufen', 'wohnen', 'leben', 'essen', 'trinken', 'schlafen',
  'gehen', 'kommen', 'sehen', 'sprechen', 'sagen', 'fragen', 'antworten', 'hören', 'schreiben', 'lesen',
  'kaufen', 'zahlen', 'kosten', 'suchen', 'finden', 'denken', 'glauben', 'wissen', 'kennen', 'reisen',
  'haben', 'sein', 'werden', 'können', 'müssen', 'wollen', 'sollen', 'dürfen', 'mögen', 'gut', 'schlecht',
  'groß', 'klein', 'neu', 'alt', 'jung', 'schön', 'billig', 'teuer', 'warm', 'kalt', 'schnell', 'langsam',
  'tag', 'nacht', 'jahr', 'monat', 'woche', 'zeit', 'haus', 'wohnung', 'zimmer', 'freund', 'familie',
  'eltern', 'kind', 'mann', 'frau', 'auto', 'bus', 'zug', 'brot', 'wasser', 'geld', 'aber', 'weil',
  'obwohl', 'wenn', 'dass', 'und', 'oder', 'sondern', 'denn', 'deshalb', 'trotzdem'
];

function getCleanWord(word) {
  return word.toLowerCase()
    .replace(/^(der\/die\/das|der|die|das|ein|eine|sich)\s+/i, '')
    .replace(/\(.*\)/g, '')
    .replace(/,.*$/, '')
    .trim();
}

function determineCEFRPriority(item) {
  const clean = getCleanWord(item.word);

  // 1. Check if it's explicitly in the Priority 1 core list
  for (let core of priority1Words) {
    if (clean === core || clean.startsWith(core) || clean.endsWith(core)) {
      return 1;
    }
  }

  // 2. Check if it contains Priority 3 technical/specialized terms
  for (let kw of priority3Keywords) {
    if (clean.includes(kw)) {
      return 3;
    }
  }

  // 3. Check if it contains Priority 2 situational bureaucracy/medical/finance terms
  for (let kw of priority2Keywords) {
    if (clean.includes(kw)) {
      return 2;
    }
  }

  // 4. Default categories mapping if category matches
  // Bureaucracy / Finance / Medical categories are heavily functional Priority 2 situational
  const isPriority2Category = 
    item.primaryCategory === 'Gesundheit, Körper & Medizin' ||
    item.primaryCategory === 'Einkaufen, Geld & Finanzen' ||
    item.primaryCategory === 'Staat, Gesellschaft & Recht' ||
    item.primaryCategory === 'Zeit, Datum & Dokumente';

  if (isPriority2Category) {
    return 2;
  }

  // Niche science or abstract categories can default to 3
  const isPriority3Category =
    item.primaryCategory === 'Ausbildung, Schule & Wissenschaft' ||
    item.primaryCategory === 'Kommunikation, Medien & Technik';
  
  if (isPriority3Category) {
    return 3;
  }

  // 5. General fallback: short words are usually Priority 1, medium are Priority 2, long words are Priority 3
  if (clean.length <= 6) {
    return 1;
  } else if (clean.length <= 11) {
    return 2;
  } else {
    return 3;
  }
}

function processList(list) {
  return list.map(item => {
    const priority = determineCEFRPriority(item);
    return {
      ...item,
      priority
    };
  });
}

// Re-classify all categories
data.nouns = processList(data.nouns);
data.verbs = processList(data.verbs);
data.adjectives = processList(data.adjectives);
data.connectors = processList(data.connectors);

// Save updated JSON
fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

console.log('Successfully re-classified vocabulary based on accurate CEFR priority rules!');
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
