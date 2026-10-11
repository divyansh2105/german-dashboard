// Persistent File System Access & Backup Utility
// Directly overwrites deleted_words_backup.json and my_list_backup.json
// in the project folder without repeatedly asking the user to choose directories.

const DB_NAME = 'GermanDashboardBackupDB';
const STORE_NAME = 'handles';
const DIR_KEY = 'project_backup_directory';

let inMemoryDirHandle = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !('indexedDB' in window)) {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getStoredDirectoryHandle() {
  if (inMemoryDirHandle) return inMemoryDirHandle;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DIR_KEY);
      req.onsuccess = () => {
        if (req.result) inMemoryDirHandle = req.result;
        resolve(req.result || null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to retrieve directory handle from IndexedDB:', err);
    return null;
  }
}

export async function saveDirectoryHandle(handle) {
  inMemoryDirHandle = handle;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(handle, DIR_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to save directory handle to IndexedDB:', err);
    return false;
  }
}

export async function clearStoredDirectoryHandle() {
  inMemoryDirHandle = null;
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(DIR_KEY);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return false;
  }
}

// Preload stored directory handle into memory on initial script load
if (typeof window !== 'undefined' && 'indexedDB' in window) {
  getStoredDirectoryHandle().catch(() => {});
}

/**
 * Attempts silent real-time background sync to the remembered project directory
 * if permission is already granted.
 */
export async function tryAutoSyncToDirectory(filename, data) {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) return false;
  try {
    let dirHandle = inMemoryDirHandle || (await getStoredDirectoryHandle());
    if (!dirHandle) return false;

    const perm = await dirHandle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return false;

    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(data, null, 2));
    await writable.close();
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Connect/select the project directory explicitly
 */
export async function chooseBackupDirectory() {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    alert("Your browser does not support folder selection. Please use Chrome or Edge on desktop to directly connect your project folder.");
    return null;
  }

  try {
    const dirHandle = await window.showDirectoryPicker({
      id: 'german-dashboard-project',
      mode: 'readwrite'
    });
    await saveDirectoryHandle(dirHandle);
    alert(`✅ Project folder "${dirHandle.name}" connected! Backups will now automatically overwrite here without asking again.`);
    return dirHandle;
  } catch (err) {
    if (err.name === 'AbortError') return null;
    console.error('Directory selection failed:', err);
    throw err;
  }
}

/**
 * Universal export function that saves directly to the project folder
 * without prompting the user to select the directory every time.
 */
export async function exportBackupFile(filename, data) {
  const jsonString = JSON.stringify(data, null, 2);

  // 1. File System Access API (Chrome / Edge on macOS / Windows)
  // Preserves transient user gesture by NOT placing any alert() or slow network calls before the picker
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      let dirHandle = inMemoryDirHandle || (await getStoredDirectoryHandle());

      // If we already have a remembered directory handle, verify or request permission
      if (dirHandle) {
        let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          dirHandle = null; // permission denied, will re-prompt picker below
        }
      }

      // If no directory handle remembered yet, open the folder picker immediately
      // (NO alert() before this, so browser user activation is 100% valid!)
      if (!dirHandle) {
        dirHandle = await window.showDirectoryPicker({
          id: 'german-dashboard-project',
          mode: 'readwrite'
        });
        await saveDirectoryHandle(dirHandle);
      }

      // Overwrite the file directly inside the remembered folder
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonString);
      await writable.close();

      alert(`✅ Automatically overwritten ${filename} in "${dirHandle.name}"!\nFolder is remembered — future exports will overwrite without asking.`);
      return { success: true, method: 'directory-handle' };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
      console.warn('Directory handle write error, attempting fallback:', err);
    }
  }

  // 2. Try local dev server API if available (running on localhost)
  try {
    const endpoint = filename === 'deleted_words_backup.json' ? '/api/backup-deleted' : '/api/backup-mylist';
    const localRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonString
    });
    if (localRes.ok) {
      alert(`✅ Automatically updated ${filename} directly in your project folder!`);
      return { success: true, method: 'local-api' };
    }
  } catch (err) {}

  // 3. Fallback: Browser download
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = filename;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  URL.revokeObjectURL(url);
  alert(`✅ Downloaded ${filename}.\nTip: Use Chrome or Edge on your Mac to automatically overwrite your project folder without download dialogs!`);
  return { success: true, method: 'download' };
}
