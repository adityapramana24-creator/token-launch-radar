// Launch Radar v4 — entry point for the token-radar-01 bounty.
// Node 22, standard library only. No network, no clock, no unseeded
// randomness: the same sealed snapshot always produces the same bytes.
//
// The build, in order:
//   1. read the sealed DefiLlama snapshot (--input, default /input)
//   2. fit the comps curve and score every rankable pre-token protocol
//      (the model lives in lib/model.ts)
//   3. write board.json and data.js, copy dashboard/ through, decode the
//      base64 screenshots back into PNGs, and write dossier.json last
//      (the scorer rebuilds the dossier from /output and compares bytes)
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json

import { fileURLToPath } from 'node:url';
import { join as joinPath } from 'node:path';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { buildRadar, boardIssue, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier as makeDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const LABEL = 'launch radar v4';

/** Caps from the gate: dossier text, screenshots, dashboard. */
const DOSSIER_TEXT_CAP = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const DASH_CAP = { max_files: 400, max_bytes: 4_194_304 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print a failure to stderr and exit 1. */
function die(reason: string): never {
  process.stderr.write(`${LABEL}: ${reason}\n`);
  process.exit(1);
}

/** The value of `--name <value>` or `--name=<value>`, or `fallback`. */
function cliFlag(name: string, fallback: string): string {
  const slot = process.argv.indexOf(`--${name}`);
  if (slot !== -1 && slot + 1 < process.argv.length) {
    return process.argv[slot + 1] as string;
  }
  const attached = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (attached === undefined) return fallback;
  return attached.slice(`--${name}=`.length);
}

/** Copy a directory's top-level regular files into `dest`, skipping dot-names. */
function copyDirFlat(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const names: string[] = [];
  for (const entry of readdirSync(src).sort()) {
    if (entry.startsWith('.')) continue;
    const full = joinPath(src, entry);
    if (!statSync(full).isFile()) continue;
    copyFileSync(full, joinPath(dest, entry));
    names.push(entry);
  }
  return names;
}

/**
 * Decode every `<name>.png.b64` / `<name>.jpg.b64` in `src` into a real image
 * in `dest`. Each decoded file is checked for a PNG/JPEG signature, the
 * 512 KiB cap and, for PNGs, the gate's dimension bounds before it is
 * written. Returns the decoded image names.
 */
function decodeScreenshots(src: string, dest: string): string[] {
  if (!existsSync(src)) return [];
  mkdirSync(dest, { recursive: true });
  const images: string[] = [];
  for (const entry of readdirSync(src).sort()) {
    if (entry.startsWith('.')) continue;
    const found = /^(.*\.(?:png|jpg|jpeg))\.b64$/.exec(entry);
    if (found === null) continue;
    const image = found[1] as string;
    if (!SHOT_NAME.test(image)) {
      die(`screenshots/${image}: a name is letters, digits and . _ -, 1 to 128 characters`);
    }
    const raw = readFileSync(joinPath(src, entry), 'utf8').replace(/\s+/g, '');
    const bytes = Buffer.from(raw, 'base64');
    if (bytes.length > SHOT_CAP.max_bytes) {
      die(`screenshots/${image}: ${bytes.length} bytes, over the 512 KiB cap`);
    }
    const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const jpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!png && !jpeg) die(`screenshots/${image}: not a PNG or JPEG once decoded`);
    if (png) {
      const w = bytes.readUInt32BE(16);
      const h = bytes.readUInt32BE(20);
      const long = Math.max(w, h);
      const short = Math.min(w, h);
      if (long > 1440 || short < 800) {
        die(`screenshots/${image}: ${w}x${h}, outside the gate's 1440x800 bounds`);
      }
    }
    writeFileSync(joinPath(dest, image), bytes);
    images.push(image);
  }
  return images;
}

// --- main flow ---

const inputGiven = cliFlag('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : joinPath(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  die(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outputDir = cliFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
} catch (error) {
  die(error instanceof Error ? error.message : 'cannot parse the snapshot');
}

const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) die(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(joinPath(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(joinPath(outputDir, 'data.js'), dataScript(radar));

const dashNames = copyDirFlat(joinPath(ROOT, 'dashboard'), joinPath(outputDir, 'dashboard'));
if (!dashNames.includes('index.html')) die('dashboard/ holds no index.html');
if (!dashNames.some((name) => name.endsWith('.css'))) die('dashboard/ holds no .css file');
if (!dashNames.some((name) => name.endsWith('.js'))) die('dashboard/ holds no .js file');

const shots = decodeScreenshots(joinPath(ROOT, 'screenshots'), joinPath(outputDir, 'screenshots'));
if (shots.length < 3) {
  die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  joinPath(outputDir, 'dossier.json'),
  makeDossier(outputDir, { text_max_bytes: DOSSIER_TEXT_CAP, screenshots: SHOT_CAP, dashboard: DASH_CAP }),
);

process.stdout.write(
  `${LABEL}: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.comps_size} traded comps fitted)\n` +
    `${LABEL}: wrote board.json, data.js, dashboard/ (${dashNames.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json into ${outputDir}\n`,
);
