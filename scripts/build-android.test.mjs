import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { safeFile, isBuildInput, synchronize, sameDependencies, acquireLock, write, sourceManifest, buildPackage, verifyStandaloneMetadata } from './build-android.mjs';
import { fileURLToPath } from 'node:url';

test('standalone projection excludes development modules without changing dependencies or source package', () => {
  const pkg = { dependencies: { 'expo-dev-client': '57.0.19' }, expo: { autolinking: { nativeModulesDir: './modules' } } };
  const before = JSON.stringify(pkg);
  const projected = buildPackage(pkg, true);
  assert.equal(sameDependencies(pkg, projected), true);
  assert.ok(projected.expo.autolinking.exclude.includes('expo-dev-launcher'));
  assert.equal(projected.expo.autolinking.nativeModulesDir, './modules');
  assert.equal(JSON.stringify(pkg), before);
  assert.deepEqual(buildPackage(pkg, false), pkg);
});

test('standalone artifact gate rejects network permission, debug mode, missing bundle and dev modules', () => {
  const permission = "uses-permission: name='android.permission.READ_MEDIA_AUDIO'";
  const bundle = 'assets/index.android.bundle\n';
  assert.deepEqual(verifyStandaloneMetadata(permission, bundle, 'MusicPlatformModule'), ['android.permission.READ_MEDIA_AUDIO']);
  for (const forbidden of ['INTERNET', 'RECORD_AUDIO', 'SYSTEM_ALERT_WINDOW']) {
    assert.throws(() => verifyStandaloneMetadata(`${permission}\nuses-permission: name='android.permission.${forbidden}'`, bundle, ''), /Unexpected/);
  }
  assert.throws(() => verifyStandaloneMetadata(`${permission}\napplication-debuggable`, bundle, ''), /debuggable/);
  assert.throws(() => verifyStandaloneMetadata(permission, '', ''), /bundle/);
  assert.throws(() => verifyStandaloneMetadata(permission, bundle, 'expo.modules.devlauncher.DevLauncher'), /Development/);
});

test('actual Git rules retain the custom module Gradle source and registration configuration', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const manifest = sourceManifest(root);
  assert.ok(manifest['modules/music-platform/android/build.gradle']);
  assert.ok(manifest['modules/music-platform/expo-module.config.json']);
});

test('unsafe paths and generated/secret files are excluded', () => {
  assert.throws(() => safeFile(os.tmpdir(), '../outside'));
  assert.throws(() => safeFile(os.tmpdir(), path.resolve(os.tmpdir(), 'outside')));
  for (const file of ['.env', 'android/app/src/main/AndroidManifest.xml',
    'modules/music-platform/android/build/file', 'modules/music-platform/android/.cxx/file',
    'node_modules/foo/index.js', 'artifacts/app.apk']) assert.equal(isBuildInput(file), false, file);
  assert.equal(isBuildInput('modules/music-platform/android/src/main/中文.kt'), true);
});
test('dependency mismatch is rejected, key order does not matter', () => {
  assert.equal(sameDependencies({ dependencies: { a: '1', b: '2' } }, { dependencies: { b: '2', a: '1' } }), true);
  assert.equal(sameDependencies({ dependencies: { a: '1' } }, { dependencies: { a: '2' } }), false);
});
test('removed source is removed from staging without deleting unrelated output; concurrent builds are blocked', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'music-workflow-test-'));
  const source = path.join(temporary, 'source');
  const stage = path.join(temporary, 'stage');
  fs.mkdirSync(source); fs.mkdirSync(stage);
  fs.mkdirSync(path.join(stage, 'src'));
  fs.writeFileSync(path.join(stage, 'src/removed.ts'), 'old');
  fs.writeFileSync(path.join(stage, 'keep-output'), 'cache');
  synchronize(source, stage, {}, { 'src/removed.ts': 'old-hash' });
  assert.equal(fs.existsSync(path.join(stage, 'src/removed.ts')), false);
  assert.equal(fs.readFileSync(path.join(stage, 'keep-output'), 'utf8'), 'cache');
  const release = acquireLock(stage);
  try { assert.throws(() => acquireLock(stage)); } finally { release(); }
  const again = acquireLock(stage); again();
  // All paths here belong to this test's freshly created temporary directory.
  fs.rmSync(temporary, { recursive: true });
});

test('report updates replace valid JSON and leave no partial file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'music-report-test-'));
  const file = path.join(directory, 'latest.json');
  write(file, { run: 'first' });
  write(file, { run: 'second' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { run: 'second' });
  assert.deepEqual(fs.readdirSync(directory), ['latest.json']);
  fs.rmSync(directory, { recursive: true });
});
