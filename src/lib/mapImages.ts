import { supabase } from './db';

/*
 * Level map images. Uploaded to the "maps" storage bucket when it exists;
 * otherwise (demo mode, or storage not set up yet) the image is shrunk and kept with the region itself.
 */
function shrink(file: File, max: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export async function uploadMapImage(regionId: string, file: File): Promise<string> {
  if (supabase) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${regionId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from('maps').upload(path, file, { upsert: true, contentType: file.type });
    if (!error) return supabase.storage.from('maps').getPublicUrl(path).data.publicUrl;
  }
  // Kept with the region: shrink until it is small enough to store (the data layer refuses very large rows).
  for (const [max, q] of [[2000, 0.8], [1600, 0.75], [1280, 0.7], [1024, 0.65]] as const) {
    const url = await shrink(file, max, q);
    if (url.length < 380_000) return url;
  }
  return shrink(file, 800, 0.6);
}
