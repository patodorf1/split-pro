/**
 * Almacén clave/valor mínimo sobre IndexedDB (sin dependencias).
 *
 * Todo es "best effort": si IndexedDB no existe o falla (modo privado, cuota
 * llena, Safari raro), las lecturas devuelven `undefined` y las escrituras no
 * hacen nada. La app sigue andando igual, sólo que sin caché en el dispositivo.
 */

const DB_NAME = 'casa';
const STORE_NAME = 'kv';

let dbPromise: Promise<IDBDatabase | null> | null = null;

const openDb = (): Promise<IDBDatabase | null> => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if ('undefined' === typeof indexedDB) {
        resolve(null);
        return;
      }

      const request = indexedDB.open(DB_NAME, 1);

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });

  return dbPromise;
};

const run = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> => {
  const db = await openDb();

  if (!db) {
    return undefined;
  }

  return new Promise<T | undefined>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));

      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => resolve(undefined);
      transaction.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
};

export const deviceStoreGet = (key: string) => run<unknown>('readonly', (store) => store.get(key));

export const deviceStoreSet = async (key: string, value: unknown) => {
  await run('readwrite', (store) => store.put(value, key));
};

export const deviceStoreDelete = async (key: string) => {
  await run('readwrite', (store) => store.delete(key));
};
