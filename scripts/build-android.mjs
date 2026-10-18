import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export const write = (file, value) => {
  const temporary = file + '.tmp-' + process.pid;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(temporary, file);
};
export function safeFile(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..'))
    throw new Error('Unsafe relative path: ' + relative);
  const result = path.resolve(root, relative);
  if (!result.startsWith(path.resolve(root) + path.sep)) throw new Error('Path escapes workspace');
  for (let current = result; current !== path.dirname(current); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
      throw new Error('Linked paths are not allowed: ' + current);
  }
  return result;
}
export function sameDependencies(a, b) {
  return ['dependencies', 'devDependencies', 'optionalDependencies'].every(key =>
    JSON.stringify(Object.entries(a[key] || {}).sort()) === JSON.stringify(Object.entries(b[key] || {}).sort()));
}
const rootFiles = new Set(['package.json', 'package-lock.json', 'app.json', 'app.config.js',
  'app.config.ts', 'tsconfig.json', 'babel.config.js', 'metro.config.js', 'index.ts', 'App.tsx',
  'build-toolchain.json']);
export function isBuildInput(file) {
  if (file.split('/').some(part => part.startsWith('.') || part === 'node_modules' ||
      part === 'build' || part.startsWith('build.before-'))) return false;
  return rootFiles.has(file) || /^(app|src|assets|modules|plugins|scripts)\//.test(file);
}
export function sourceManifest(root) {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('Cannot enumerate source files with Git');
  const files = [...new Set(result.stdout.split('\0').filter(Boolean))].sort().filter(isBuildInput);
  const manifest = {};
  for (const file of files) {
    const absolute = safeFile(root, file);
    if (fs.existsSync(absolute)) manifest[file] = sha(fs.readFileSync(absolute));
  }
  for (const required of ['package.json', 'package-lock.json', 'app.json', 'build-toolchain.json',
    'modules/music-platform/android/build.gradle', 'modules/music-platform/expo-module.config.json'])
    if (!manifest[required]) throw new Error('Missing build input: ' + required);
  return manifest;
}
export function synchronize(root, stage, current, previous = {}) {
  // Delete only individual source files recorded by this workflow. Never mirror/purge a directory.
  for (const file of Object.keys(previous)) {
    if (!(file in current)) {
      const destination = safeFile(stage, file);
      if (!isBuildInput(file)) throw new Error('Invalid stored source path: ' + file);
      if (fs.existsSync(destination)) fs.unlinkSync(destination);
    }
  }
  for (const [file, hash] of Object.entries(current)) {
    const destination = safeFile(stage, file);
    if (!fs.existsSync(destination) || sha(fs.readFileSync(destination)) !== hash) {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(safeFile(root, file), destination);
    }
    if (sha(fs.readFileSync(destination)) !== hash) throw new Error('Source changed while copying: ' + file);
  }
}
export function acquireLock(stage) {
  const file = path.join(stage, '.workflow.lock');
  const descriptor = fs.openSync(file, 'wx');
  fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
  return () => { fs.closeSync(descriptor); fs.unlinkSync(file); };
}
export function buildPackage(pkg, standalone) {
  if (!standalone) return pkg;
  return { ...pkg, expo: { ...pkg.expo, autolinking: { ...pkg.expo?.autolinking,
    exclude: [...new Set([...(pkg.expo?.autolinking?.exclude ?? []),
      'expo-dev-client', 'expo-dev-launcher', 'expo-dev-menu', 'expo-dev-menu-interface'])],
  } } };
}
export function verifyStandaloneMetadata(badging, entries, registration) {
  const allowed = new Set(['android.permission.READ_MEDIA_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK',
    'android.permission.WAKE_LOCK', 'com.local.musicplayer.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION']);
  const permissions = [...badging.matchAll(/uses-permission[^:]*: name='([^']+)'/g)].map(match => match[1]);
  for (const permission of permissions) if (!allowed.has(permission)) throw new Error('Unexpected standalone permission: ' + permission);
  if (badging.includes('application-debuggable')) throw new Error('Standalone artifact must not be debuggable');
  if (!entries.split(/\r?\n/).includes('assets/index.android.bundle')) throw new Error('Standalone JavaScript bundle missing');
  if (/devlauncher|devmenu|devclient/i.test(registration)) throw new Error('Development module present in standalone registration');
  return permissions;
}
export function runBuild(args = process.argv.slice(2)) {
  const allowed = new Set(['--check', '--reinstall', '--standalone']);
  if (args.some(arg => !allowed.has(arg))) throw new Error('Supported options: --check, --reinstall, --standalone');
  const standalone = args.includes('--standalone');
  const variant = standalone ? 'release' : 'debug';
  if (process.platform !== 'win32') throw new Error('This entry point is for Windows Android builds');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const config = json(path.join(root, 'build-toolchain.json'));
  const manifest = sourceManifest(root);
  const pkg = json(path.join(root, 'package.json'));
  const lock = json(path.join(root, 'package-lock.json'));
  if (!sameDependencies(pkg, lock.packages[''])) throw new Error('package.json and lockfile disagree');
  if (process.version !== 'v' + config.node) throw new Error('Use Node ' + config.node);
  const npmCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const npmVersion = spawnSync(process.execPath, [npmCli, '--version'], { encoding: 'utf8' });
  if (npmVersion.status !== 0 || npmVersion.stdout.trim() !== config.npm)
    throw new Error('Use npm ' + config.npm);
  const sdk = process.env.ANDROID_HOME || path.join(process.env.LOCALAPPDATA, 'Android/Sdk');
  const jdk = process.env.MUSIC_JAVA_HOME || path.join(process.env.ProgramFiles, 'Android/Android Studio/jbr');
  const java = spawnSync(path.join(jdk, 'bin/java.exe'), ['-version'], { encoding: 'utf8' });
  const javaText = (java.stdout || '') + (java.stderr || '');
  if (java.status !== 0 || !new RegExp('version "' + config.javaMajor + '\\.').test(javaText))
    throw new Error('Java 21 required; set MUSIC_JAVA_HOME to the Android Studio JBR directory');
  for (const relative of config.sdkFiles)
    if (!fs.existsSync(path.join(sdk, relative))) throw new Error('Missing SDK tool: ' + relative);
  const stage = path.resolve(process.env.MUSIC_BUILD_ROOT || config.buildRoot);
  if (!/^[A-Za-z]:\\[^\\]+/.test(stage) || stage.length > 32 || /[\s&|<>^%!"]/.test(stage))
    throw new Error('Build workspace must be a short physical Windows path without shell metacharacters');
  if (root.startsWith(stage + path.sep) || stage.startsWith(root + path.sep) || stage === root)
    throw new Error('Build workspace must be separate from the source repository');
  safeFile(stage, 'package.json');
  const ownerPath = path.join(stage, '.music-build-owner.json');
  if (fs.existsSync(stage)) {
    if (!fs.existsSync(ownerPath) || json(ownerPath).source !== root)
      throw new Error('Refusing to use a directory not owned by this workflow: ' + stage);
  }
  console.log('Preflight passed. Source: ' + root + '\nBuild workspace: ' + stage);
  if (args.includes('--check')) return;
  fs.mkdirSync(stage, { recursive: true });
  if (!fs.existsSync(ownerPath)) write(ownerPath, { source: root, workflow: 1 });
  let release;
  try { release = acquireLock(stage); } catch { throw new Error('Build workspace locked; another build may be running. Inspect .workflow.lock before recovery.'); }
  const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const output = path.join(root, 'artifacts', runId);
  fs.mkdirSync(output, { recursive: true });
  const log = path.join(output, 'build.log');
  const report = { runId, status: 'running', source: root, stage, sourceDigest: sha(JSON.stringify(manifest)),
    lockDigest: manifest['package-lock.json'], files: manifest, node: process.version, npm: config.npm,
    java: javaText.trim(), sdk, configuration: variant, standalone, signing: 'local-test-only', abi: 'arm64-v8a', steps: [], started: new Date().toISOString() };
  const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, NODE_ENV: standalone ? 'production' : 'development',
    MUSIC_STANDALONE: standalone ? '1' : '0',
    CI: '1', EXPO_NO_TELEMETRY: '1', Path: path.join(jdk, 'bin') + ';' + process.env.Path };
  const step = (label, executable, arguments_, cwd = stage) => {
    console.log('[' + label + '] Details: ' + log);
    report.activeStep = label;
    write(path.join(output, 'report.json'), report);
    const started = Date.now();
    const fd = fs.openSync(log, 'a');
    fs.writeSync(fd, '\n--- ' + label + ' ---\n');
    let result;
    try { result = spawnSync(executable, arguments_, { cwd, env, stdio: ['ignore', fd, fd] }); }
    finally { fs.closeSync(fd); }
    report.steps.push({ label, exitCode: result.status, milliseconds: Date.now() - started });
    if (result.error || result.status !== 0) {
      console.error(fs.readFileSync(log, 'utf8').split('\n').slice(-25).join('\n'));
      throw new Error(label + ' failed; no APK published. ' + (result.error?.message || ''));
    }
  };
  try {
    const sourceList = path.join(stage, '.music-sources.json');
    synchronize(root, stage, manifest, fs.existsSync(sourceList) ? json(sourceList) : {});
    write(sourceList, manifest);
    const dependencyStamp = path.join(stage, '.music-dependencies.json');
    const dependencyKey = sha(manifest['package-lock.json'] + config.node + config.npm);
    if (args.includes('--reinstall') || !fs.existsSync(dependencyStamp) ||
        json(dependencyStamp).key !== dependencyKey || !fs.existsSync(path.join(stage, 'node_modules/expo/package.json'))) {
      if (fs.existsSync(dependencyStamp)) fs.unlinkSync(dependencyStamp);
      step('Locked dependency installation', process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund']);
      write(dependencyStamp, { key: dependencyKey });
    }
    step('Dependency tree validation', process.execPath, [npmCli, 'ls', '--all', '--offline']);
    step('TypeScript', process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']);
    step('Host regression tests', process.execPath, ['--test', 'scripts/playback-state-order.test.mjs',
      'scripts/library.test.mjs', 'scripts/ui-format.test.mjs', 'scripts/player-motion.test.mjs', 'scripts/ui-performance.test.mjs']);
    // Change native autolinking only in the recorded build projection; lockfile/dependencies stay fixed.
    write(path.join(stage, 'package.json'), buildPackage(pkg, standalone));
    report.autolinkingExclusions = buildPackage(pkg, standalone).expo?.autolinking?.exclude ?? [];
    const nativeKey = sha(variant + JSON.stringify(Object.entries(manifest).filter(([file]) =>
      /^(app\.|package|build-toolchain|plugins\/|modules\/)/.test(file))));
    const nativeStamp = path.join(stage, '.music-native.json');
    if (!fs.existsSync(nativeStamp) || json(nativeStamp).key !== nativeKey ||
        !fs.existsSync(path.join(stage, 'android/gradlew.bat'))) {
      if (fs.existsSync(nativeStamp)) fs.unlinkSync(nativeStamp);
      const testKeyPath = path.join(stage, 'android/app/debug.keystore');
      const testKey = fs.existsSync(testKeyPath) ? fs.readFileSync(testKeyPath) : null;
      step('Generate Android project', process.execPath, ['node_modules/expo/bin/cli', 'prebuild', '--platform', 'android', '--no-install', '--clean']);
      if (testKey) fs.writeFileSync(testKeyPath, testKey);
      if (!sameDependencies(pkg, json(path.join(stage, 'package.json'))))
        throw new Error('Prebuild changed dependencies; review required');
      write(path.join(stage, 'package.json'), buildPackage(pkg, standalone));
      write(nativeStamp, { key: nativeKey });
    }
    if (sha(fs.readFileSync(path.join(stage, 'package-lock.json'))) !== report.lockDigest)
      throw new Error('Lockfile changed in build workspace');
    step('JavaScript bundle validation', process.execPath,
      ['node_modules/expo/bin/cli', 'export', '--platform', 'android', '--output-dir', '.music-metro']);
    step('Compile ' + variant + ' APK', process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
      ['/d', '/s', '/c', `gradlew.bat :music-platform:test${standalone ? 'Release' : 'Debug'}UnitTest :app:assemble${standalone ? 'Release' : 'Debug'} --no-daemon -PreactNativeArchitectures=arm64-v8a --console=plain`],
      path.join(stage, 'android'));
    const registrationFile = path.join(stage, 'node_modules/expo/android/build/generated/expo/src/main/java/expo/modules/ExpoModulesPackageList.kt');
    if (!fs.existsSync(registrationFile) || !fs.readFileSync(registrationFile, 'utf8').includes('expo.modules.musicplatform.MusicPlatformModule'))
      throw new Error('MusicPlatform is missing from the generated Expo native module registration');
    report.nativeModuleRegistrationVerified = true;
    const apk = path.join(stage, `android/app/build/outputs/apk/${variant}/app-${variant}.apk`);
    if (!fs.existsSync(apk) || fs.statSync(apk).size === 0) throw new Error('Build returned without an APK');
    step('APK metadata', path.join(sdk, 'build-tools/36.0.0/aapt.exe'), ['dump', 'badging', apk]);
    if (!fs.readFileSync(log, 'utf8').includes("uses-permission: name='android.permission.READ_MEDIA_AUDIO'"))
      throw new Error('Required native audio permission is absent from the APK');
    if (standalone) {
      const aapt = path.join(sdk, 'build-tools/36.0.0/aapt.exe');
      const inspect = args => {
        const result = spawnSync(aapt, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
        if (result.status !== 0) throw new Error('Standalone APK inspection failed');
        return result.stdout;
      };
      const badging = inspect(['dump', 'badging', apk]);
      report.verifiedPermissions = verifyStandaloneMetadata(badging, inspect(['list', apk]), fs.readFileSync(registrationFile, 'utf8'));
      fs.writeFileSync(path.join(output, 'manifest.txt'), inspect(['dump', 'xmltree', apk, 'AndroidManifest.xml']));
      step('Verify APK signature', path.join(jdk, 'bin/java.exe'),
        ['-jar', path.join(sdk, 'build-tools/36.0.0/lib/apksigner.jar'), 'verify', '--print-certs', apk]);
    }
    if (sha(JSON.stringify(sourceManifest(root))) !== report.sourceDigest)
      throw new Error('Source changed during build; rerun to publish a current APK');
    const name = standalone ? 'music-player-standalone-test.apk' : 'music-player-debug.apk';
    fs.copyFileSync(apk, path.join(output, name));
    report.apk = { path: path.join(output, name), sha256: sha(fs.readFileSync(apk)), bytes: fs.statSync(apk).size };
    report.status = 'success';
    report.finished = new Date().toISOString();
    write(path.join(output, 'report.json'), report);
    write(path.join(root, standalone ? 'artifacts/latest-standalone.json' : 'artifacts/latest-success.json'), { runId, apk: report.apk, report: path.join(output, 'report.json') });
    console.log('BUILD VERIFIED: ' + report.apk.path);
  } catch (error) {
    report.status = 'failed';
    report.error = error.message;
    report.finished = new Date().toISOString();
    write(path.join(output, 'report.json'), report);
    throw error;
  } finally { release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { runBuild(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
