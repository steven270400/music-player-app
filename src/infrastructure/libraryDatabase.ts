import { openDatabaseAsync } from 'expo-sqlite';
import { createLibraryStore, type LibraryStore } from '../features/library/libraryStore';

let store: Promise<LibraryStore> | undefined;
export function openLibrary() {
  if (!store) store = openDatabaseAsync('music-library.db')
    .then(createLibraryStore)
    .catch(error => { store = undefined; throw error; });
  return store;
}
