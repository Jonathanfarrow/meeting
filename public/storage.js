/**
 * Keeps the most recent meeting recordings in the browser (IndexedDB) so they
 * can be opened in the Studio without re-uploading the downloaded file.
 * Everything stays on this device.
 */
const RecordingStore = (() => {
  const DB = 'meeting-studio';
  const STORE = 'recordings';
  const KEEP = 5;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const result = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(result?.result ?? result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }).finally(() => db.close());
  }

  async function list() {
    const items = await tx('readonly', (s) => s.getAll());
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  async function save({ name, blob }) {
    const id = await tx('readwrite', (s) => s.add({ name, blob, size: blob.size, createdAt: Date.now() }));
    const all = await list();
    for (const old of all.slice(KEEP)) await remove(old.id);
    return id;
  }

  const get = (id) => tx('readonly', (s) => s.get(id));
  const remove = (id) => tx('readwrite', (s) => s.delete(id));

  return { list, save, get, remove };
})();
