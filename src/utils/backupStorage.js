// Persistent File System Access & Backup Utility
// Automatically overwrites deleted_words_backup.json and my_list_backup.json
// in the project folder without repeatedly asking the user to choose directories.

const DB_NAME = 'GermanDashboardBackupDB';
const STORE_NAME = 'handles';
const DIR_KEY = 'project_backup_directory';

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
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(DIR_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Failed to retrieve directory handle from IndexedDB:', err);
    return null;
  }
}

export async function saveDirectoryHandle(handle) {
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

/**
 * Attempts silent real-time background sync to the remembered project directory
 * if permission is already granted.
 */
export async function tryAutoSyncToDirectory(filename, data) {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) return false;
  try {
    const dirHandle = await getStoredDirectoryHandle();
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
 * Universal export function that saves directly to the project folder
 * without prompting the user to select the directory every time.
 */
export async function exportBackupFile(filename, data) {
  const jsonString = JSON.stringify(data, null, 2);

  // 1. Try local Vite dev server API first (if running locally on localhost)
  try {
    const endpoint = filename === 'deleted_words_backup.json' ? '/api/backup-deleted' : '/api/backup-mylist';
    const localRes = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonString
    });
    if (localRes.ok) {
      alert(`✅ Successfully updated ${filename} directly in your project folder!`);
      return { success: true, method: 'local-api' };
    }
  } catch (err) {
    // Local server not responding, proceed to File System Access API
  }

  // 2. File System Access API with persistent directory handle
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
    try {
      let dirHandle = await getStoredDirectoryHandle();

      // Check permission on existing handle
      if (dirHandle) {
        let perm = await dirHandle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        }
        if (perm !== 'granted') {
          dirHandle = null;
        }
      }

      // If no directory handle remembered yet, ask once and remember it
      if (!dirHandle) {
        alert("Please select the 'german-dashboard' project directory once. Your browser will remember this folder and automatically overwrite your backup files here without asking again!");
        dirHandle = await window.showDirectoryPicker({
          id: 'german-dashboard-project',
          mode: 'readwrite'
        });
        await saveDirectoryHandle(dirHandle);
      }

      // Write directly and overwrite the file in the remembered directory
      const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(jsonString);
      await writable.close();

      alert(`✅ Successfully saved and updated ${filename} in "${dirHandle.name}"!`);
      return { success: true, method: 'directory-handle' };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, cancelled: true };
      }
      console.warn('Directory handle write failed, falling through to download:', err);
    }
  }

  // 3. Fallback: Standard browser download
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const downloadAnchor = document.createElement('a');
  downloadAnchor.href = url;
  downloadAnchor.download = filename;
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  URL.revokeObjectURL(url);
  alert(`✅ Downloaded ${filename}`);
  return { success: true, method: 'download' };
}
