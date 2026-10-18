// Converts the raw iPhone HEIC photos into web-friendly WebP + JPG at 1600px and 800px wide.
// Usage: npm run images   (reads from "CmPS Assets copy/", writes to public/images/)
// On a Mac we first use the built-in `sips` tool to decode HEIC, then `sharp` to resize/encode.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';

const SRC = process.argv[2] ?? 'CmPS Assets copy';
const OUT = 'public/images';
const WIDTHS = [1600, 800];

// Friendly output names for each photo
const NAMES = {
  IMG_7868: 'booth-wide',      // wide shot of the booth (no faces)
  IMG_7872: 'banner-closeup',  // hand-painted banner (no faces)
  IMG_7856: 'team-at-table',   // TODO: confirm photo permission with sponsor before launch
  IMG_3765: 'team-handing-out',// TODO: confirm photo permission with sponsor before launch
};

mkdirSync(OUT, { recursive: true });
const tmp = join(tmpdir(), 'cmps-heic');
mkdirSync(tmp, { recursive: true });

for (const file of readdirSync(SRC)) {
  if (!/\.heic$/i.test(file)) continue;
  const id = basename(file, extname(file));
  const name = NAMES[id] ?? id.toLowerCase();
  const png = join(tmp, `${id}.png`);
  execFileSync('sips', ['-s', 'format', 'png', join(SRC, file), '--out', png], { stdio: 'ignore' });

  for (const w of WIDTHS) {
    // .rotate() bakes in the phone's EXIF orientation; metadata (GPS etc.) is dropped by default.
    const base = sharp(png).rotate().resize({ width: w, withoutEnlargement: true });
    await base.clone().webp({ quality: 74 }).toFile(join(OUT, `${name}-${w}.webp`));
    await base.clone().jpeg({ quality: 78, mozjpeg: true }).toFile(join(OUT, `${name}-${w}.jpg`));
  }
  console.log(`✓ ${file} -> ${name}-{1600,800}.{webp,jpg}`);
}
rmSync(tmp, { recursive: true, force: true });
