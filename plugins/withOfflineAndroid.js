const { withAndroidManifest, withDangerousMod, withMainActivity } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

module.exports = config => {
  config = withMainActivity(config, config => {
    if (config.modResults.language !== 'kt') throw new Error('Offline activity guard requires the Kotlin template');
    const marker = '// Offline app: external URLs never enter the JavaScript router.';
    let code = config.modResults.contents;
    if (!code.includes(marker)) {
      const signature = 'override fun onCreate(savedInstanceState: Bundle?) {';
      if (!code.includes(signature) || code.includes('override fun onNewIntent('))
        throw new Error('MainActivity template changed; review external intent guard');
      code = code.replace(signature, `${signature}\n    ${marker}\n    intent?.data = null`);
      code = code.replace('class MainActivity : ReactActivity() {',
        `class MainActivity : ReactActivity() {\n  override fun onNewIntent(intent: android.content.Intent) {\n    intent.data = null\n    super.onNewIntent(intent)\n  }\n`);
    }
    config.modResults.contents = code;
    return config;
  });
  config = withAndroidManifest(config, config => {
    const manifest = config.modResults.manifest;
    delete manifest.queries;
    const app = manifest.application[0];
    Object.assign(app.$, {
      'android:allowBackup': 'false',
      'android:fullBackupContent': '@xml/music_backup_rules',
      'android:dataExtractionRules': '@xml/music_data_extraction_rules',
      'android:usesCleartextTraffic': 'false',
    });
    // No external URL navigation is a product feature; keep only the launcher entry.
    for (const activity of app.activity ?? []) {
      activity['intent-filter'] = (activity['intent-filter'] ?? []).filter(filter =>
        (filter.action ?? []).some(action => action.$['android:name'] === 'android.intent.action.MAIN'));
    }
    app['meta-data'] = (app['meta-data'] ?? []).filter(meta =>
      !meta.$['android:name'].startsWith('expo.modules.updates.'));
    return config;
  });
  return withDangerousMod(config, ['android', async config => {
    const directory = path.join(config.modRequest.platformProjectRoot, 'app/src/main/res/xml');
    fs.mkdirSync(directory, { recursive: true });
    const excludes = ['root', 'file', 'database', 'sharedpref', 'external',
      'device_root', 'device_file', 'device_database', 'device_sharedpref']
      .map(domain => `    <exclude domain="${domain}" path="." />`).join('\n');
    fs.writeFileSync(path.join(directory, 'music_backup_rules.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<full-backup-content>\n${excludes}\n</full-backup-content>\n`);
    fs.writeFileSync(path.join(directory, 'music_data_extraction_rules.xml'),
      `<?xml version="1.0" encoding="utf-8"?>\n<data-extraction-rules>\n  <cloud-backup>\n${excludes}\n  </cloud-backup>\n  <device-transfer>\n${excludes}\n  </device-transfer>\n</data-extraction-rules>\n`);
    return config;
  }]);
};
