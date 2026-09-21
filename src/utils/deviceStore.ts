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

/** Varias lecturas en una sola transacción (mismo orden que `keys`). */
export const deviceStoreGetMany = async (keys: string[]): Promise<unknown[]> => {
  if (0 === keys.length) {
    return [];
  }

  const db = await openDb();

  if (!db) {
    return keys.map(() => undefined);
  }

  return new Promise<unknown[]>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const requests = keys.map((key) => store.get(key));

      transaction.oncomplete = () => resolve(requests.map((request) => request.result));
      transaction.onerror = () => resolve(keys.map(() => undefined));
      transaction.onabort = () => resolve(keys.map(() => undefined));
    } catch {
      resolve(keys.map(() => undefined));
    }
  });
};

/** Varias escrituras y borrados en una sola transacción. */
export const deviceStoreWriteMany = async (
  puts: [key: string, value: unknown][],
  deletes: string[] = [],
) => {
  const db = await openDb();

  if (!db || (0 === puts.length && 0 === deletes.length)) {
    return;
  }

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      for (const [key, value] of puts) {
        store.put(value, key);
      }
      for (const key of deletes) {
        store.delete(key);
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
};

/** Vacía el almacén entero (todo lo que la app guardó en el dispositivo). */
export const deviceStoreClear = async () => {
  await run('readwrite', (store) => store.clear());
};
