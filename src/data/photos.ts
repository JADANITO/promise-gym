import { createStore, del, get, set } from 'idb-keyval';

// Photos live in their own IndexedDB store so the main app state stays small and fast to save.
const photoStore = typeof indexedDB !== 'undefined' ? createStore('promise-photos', 'photos') : undefined;

export const savePhotoBlob = (id: string, blob: Blob) => set(id, blob, photoStore);
export const loadPhotoBlob = (id: string) => get<Blob>(id, photoStore);
export const deletePhotoBlob = (id: string) => del(id, photoStore);

/** Shrink a camera photo to ≤1280px JPEG so dozens fit comfortably on the phone. */
export async function compressImage(file: Blob, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Could not process photo'))), 'image/jpeg', 0.82));
}
