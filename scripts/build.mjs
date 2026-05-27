import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const chromeManifest = JSON.parse(await readJson('manifest.json'));
const version = chromeManifest.version;
const distRoot = path.join(root, 'dist');
const buildRoot = path.join(distRoot, 'build');
const releaseRoot = path.join(distRoot, 'release');

const runtimeFiles = [
  'README.md',
  'compat.js',
  'content.js',
  'popup.html',
  'popup.js',
  'options.html',
  'options.js'
];

const assetFiles = [
  'assets/floating-icon.png',
  'assets/icon-16.png',
  'assets/icon-32.png',
  'assets/icon-48.png',
  'assets/icon-128.png'
];

await rm(distRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });
await mkdir(releaseRoot, { recursive: true });

await buildTarget('chrome', 'manifest.json');
await buildTarget('firefox', 'manifest.firefox.json');
await zipTarget('chrome');
await zipTarget('firefox');

console.log(`Built do-trash v${version}`);
console.log(`- dist/release/do-trash-v${version}-chrome.zip`);
console.log(`- dist/release/do-trash-v${version}-firefox.zip`);

async function readJson(file) {
  return await import('node:fs/promises').then(({ readFile }) => readFile(path.join(root, file), 'utf8'));
}

async function buildTarget(target, manifestFile) {
  const targetDir = path.join(buildRoot, `do-trash-v${version}-${target}`);
  await mkdir(targetDir, { recursive: true });

  for (const file of runtimeFiles) {
    await copy(file, path.join(targetDir, file));
  }

  for (const file of assetFiles) {
    await copy(file, path.join(targetDir, file));
  }

  const manifest = await readJson(manifestFile);
  await writeFile(path.join(targetDir, 'manifest.json'), manifest);
}

async function zipTarget(target) {
  const folderName = `do-trash-v${version}-${target}`;
  const zipPath = path.join(releaseRoot, `${folderName}.zip`);
  await execFileAsync('zip', ['-qr', zipPath, folderName], { cwd: buildRoot });
}

async function copy(source, destination) {
  if (!existsSync(path.join(root, source))) {
    throw new Error(`Missing file: ${source}`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(path.join(root, source), destination, { recursive: true });
}
