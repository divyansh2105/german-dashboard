import fs from 'fs';
import path from 'path';

const filePath = '/Users/divyanshdahiya/Desktop/Studies - MSc/German/B1/german-dashboard/public/b1_vocab_data.json';
const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

console.log('Nouns count:', data.nouns.length);
console.log('Verbs count:', data.verbs.length);
console.log('Adjectives count:', data.adjectives.length);
console.log('Connectors count:', data.connectors.length);

if (data.nouns.length > 0) console.log('Sample noun:', data.nouns[0]);
if (data.verbs.length > 0) console.log('Sample verb:', data.verbs[0]);
if (data.adjectives.length > 0) console.log('Sample adjective:', data.adjectives[0]);
if (data.connectors.length > 0) console.log('Sample connector:', data.connectors[0]);
