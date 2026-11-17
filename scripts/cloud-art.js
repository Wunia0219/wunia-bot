import { writeFile } from 'node:fs/promises';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

const assets = new URL('../assets/', import.meta.url);
const variants = {
  month: ['month-mascot.png', [307, 120, 1229, 830], 360, 244],
  detail: ['detail-mascot.png', [40, 280, 1174, 752], 200, 128],
  app: ['app-icon.png', [0, 0, 1024, 1024], 256, 256],
};
const art = {};
for (const [kind, [file, area, width, height]] of Object.entries(variants)) {
  const image = await loadImage(fileURLToPath(new URL(file, assets)));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(image, ...area, 0, 0, width, height);
  const format = kind === 'app' ? 'png' : 'webp';
  art[kind] = `data:image/${format};base64,${canvas.toBuffer(`image/${format}`).toString('base64')}`;
}
await writeFile(new URL('../src/.cloud-art.js', import.meta.url), `export default ${JSON.stringify(art)};\n`);
