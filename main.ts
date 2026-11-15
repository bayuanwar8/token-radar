// token-radar-01 entrypoint (radar-4) — Node 22, standard library only.
//
// What it does, in order:
//   1. reads the sealed DefiLlama snapshot (default /input/snapshot.json,
//      or --input <file|dir>), 2. scores every pre-token protocol with the
//      fitted curve in lib/model.ts, 3. writes the ranked board
//      (board.json) and the dashboard's data (data.js), 4. copies this repo's
//      dashboard/ and screenshots/ into the output, 5. writes dossier.json,
//      the summary the judge reads, with the vendored make.fun library.
//
// The dashboard is a static page with no framework and no network calls:
// index.html + app.css + app.js read data.js, which this program writes
// from the same board, so the page and the board can never disagree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

// Caps the gate enforces (see the kit's reference/gate.json): the text cap
// shapes the dossier bytes; the screenshot caps refuse oversized images.
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SHOT_LIMIT = 4;
const SHOT_MAX_BYTES = 524_288;
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Print a message to stderr and stop with a non-zero status. */
function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

/** Value of a `--name <value>` or `--name=<value>` argument, else the fallback. */
function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === `--${name}` && i + 1 < argv.length) return argv[i + 1]!;
    if (a.startsWith(`--${name}=`)) return a.slice(name.length + 3);
  }
  return fallback;
}

const inputArg = flagValue('input', '/input');
const snapshotPath = inputArg.endsWith('.json')
  ? inputArg
  : path.join(inputArg, 'snapshot.json');
if (!fs.existsSync(snapshotPath)) {
  fail(
    `no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory> or mount the sealed /input`,
  );
}

const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(fs.readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
fs.writeFileSync(path.join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping dotfiles; returns the names copied. */
function copyDir(fromDir: string, toDir: string): string[] {
  if (!fs.existsSync(fromDir)) return [];
  fs.mkdirSync(toDir, { recursive: true });
  const names: string[] = [];
  for (const name of fs.readdirSync(fromDir)) {
    if (name.startsWith('.')) continue;
    const from = path.join(fromDir, name);
    if (!fs.statSync(from).isFile()) continue;
    fs.copyFileSync(from, path.join(toDir, name));
    names.push(name);
  }
  return names;
}

copyDir(path.join(repoRoot, 'dashboard'), path.join(outDir, 'dashboard'));
const shots = copyDir(path.join(repoRoot, 'screenshots'), path.join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`,
  );
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier goes last: the scorer rebuilds it from this /output and compares bytes.
fs.writeFileSync(
  path.join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: { max: SHOT_LIMIT, max_bytes: SHOT_MAX_BYTES },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${path.join(outDir, 'board.json')}, ${path.join(outDir, 'data.js')}, ${path.join(outDir, 'dashboard')} (3 files), ${path.join(outDir, 'screenshots')} (${shots.length} images) and ${path.join(outDir, 'dossier.json')}\n`,
);
