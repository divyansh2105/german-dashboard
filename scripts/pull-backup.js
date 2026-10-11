import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const deletedWordsFile = path.resolve(projectRoot, 'deleted_words_backup.json');
const myListFile = path.resolve(projectRoot, 'my_list_backup.json');

const codeArg = process.argv[2];

if (!codeArg || codeArg.trim().length < 3) {
  console.log(`
Usage:
  npm run pull-backup <your-sync-code>

Example:
  npm run pull-backup mycode123

This fetches your latest cloud data from https://german-dashboard-five.vercel.app
and updates both deleted_words_backup.json and my_list_backup.json locally.
`);
  process.exit(1);
}

const cleanCode = codeArg.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const baseUrl = 'https://german-dashboard-five.vercel.app';

async function syncBackup() {
  console.log(`Connecting to cloud database with sync code: "${cleanCode}"...`);
  
  try {
    // 1. Fetch Deleted Words
    const deletedRes = await fetch(`${baseUrl}/api/sync?code=${cleanCode}&type=ankii_deleted&t=${Date.now()}`);
    if (!deletedRes.ok) throw new Error(`Failed to fetch deleted words: ${await deletedRes.text()}`);
    const deletedList = await deletedRes.json();
    
    if (Array.isArray(deletedList)) {
      fs.writeFileSync(deletedWordsFile, JSON.stringify(deletedList, null, 2), 'utf-8');
      console.log(`✅ Updated deleted_words_backup.json (${deletedList.length} words):`, deletedList);
    }

    // 2. Fetch My List Words
    const myListRes = await fetch(`${baseUrl}/api/sync?code=${cleanCode}&t=${Date.now()}`);
    if (!myListRes.ok) throw new Error(`Failed to fetch My List words: ${await myListRes.text()}`);
    const myListData = await myListRes.json();
    
    if (Array.isArray(myListData)) {
      fs.writeFileSync(myListFile, JSON.stringify(myListData, null, 2), 'utf-8');
      console.log(`✅ Updated my_list_backup.json (${myListData.length} words)`);
    }

    console.log(`\n🎉 All local backup files in ${projectRoot} are up to date!`);
  } catch (err) {
    console.error('❌ Sync failed:', err.message);
  }
}

syncBackup();
