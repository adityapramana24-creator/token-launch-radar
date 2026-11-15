// Launch Radar v2: a token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, fits the comps curve and scores every
// rankable pre-token protocol with the model in lib/model.ts, then writes:
//
//   board.json    the ranked board: rank, implied value, interval and farm
//                 plan per row
//   data.js       the same board in compact form, plus the fit, the
//                 out-of-sample tests and the traded comps, for dashboard/
//   dashboard/    the static page (index.html, ledger.css, ledger.js)
//   screenshots/  the board, a detail view and a filtered view, stored as
//                 base64 text (*.png.b64) so the repository stays text-only;
//                 main.ts decodes them back into real PNGs in /output
//   dossier.json  buildDossier's summary of dashboard/ and screenshots/
//
// The run is fully deterministic: the same snapshot in, the same bytes out,
// every time. No network, no clock, no unseeded randomness.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier's text cap in UTF-8 bytes, and the gate's screenshot and dashboard caps. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Fail with a message on stderr and exit code 1. */
function fail(message: string): never {
  process.stderr.write(`launch radar v2: ${message}\n`);
  process.exit(1);
}

/** The value of --name <value> or --name=<value>, else `fallback`. */
function flag(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

let snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  fail(err instanceof Error ? err.message : 'cannot parse the snapshot');
}

const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

/** Copy a directory's regular files (top level only) into `to`, skipping dot-names. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dashFiles = copyFlat(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html')) fail('dashboard/ holds no index.html');
if (!dashFiles.some((f) => f.endsWith('.css'))) fail('dashboard/ holds no .css file');
if (!dashFiles.some((f) => f.endsWith('.js'))) fail('dashboard/ holds no .js file');

/**
 * Decode the base64 screenshots in `from` into real image files in `to`.
 * Each source is `<name>.png.b64` or `<name>.jpg.b64`; the decoded bytes are
 * checked for a PNG or JPEG signature, the gate's size cap and, for PNGs,
 * the dimension caps, before they are written. Returns the image names.
 */
function decodeShots(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const decoded: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const match = /^(.*\.(?:png|jpg|jpeg))\.b64$/.exec(name);
    if (match === null) continue;
    const imageName = match[1]!;
    if (!IMAGE_NAME.test(imageName)) fail(`screenshots/${imageName}: a name is letters, digits and . _ -, 1 to 128 characters`);
    const bytes = Buffer.from(readFileSync(join(from, name), 'utf8').replace(/\s+/g, ''), 'base64');
    if (bytes.length > SCREENSHOTS.max_bytes) fail(`screenshots/${imageName}: ${bytes.length} bytes, over the 512 KiB cap`);
    const isPng = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const isJpeg = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
    if (!isPng && !isJpeg) fail(`screenshots/${imageName}: not a PNG or JPEG once decoded`);
    if (isPng) {
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      if (Math.max(width, height) > 1440 || Math.min(width, height) < 800) {
        fail(`screenshots/${imageName}: ${width}x${height}, outside the gate's 1440x800 bounds`);
      }
    }
    writeFileSync(join(to, imageName), bytes);
    decoded.push(imageName);
  }
  return decoded;
}

const shots = decodeShots(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOTS, dashboard: DASHBOARD }),
);

process.stdout.write(
  `launch radar v2: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} early, ${radar.comps_size} traded comps fitted)\n` +
    `launch radar v2: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json into ${outDir}\n`,
);
