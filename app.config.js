module.exports = ({ config }) => {
  if (process.env.MUSIC_STANDALONE !== '1') return config;
  return {
    ...config,
    scheme: undefined,
    updates: { enabled: false, checkAutomatically: 'NEVER' },
    plugins: config.plugins.filter(plugin => plugin !== 'expo-dev-client').concat('./plugins/withOfflineAndroid'),
    android: {
      ...config.android,
      blockedPermissions: [...config.android.blockedPermissions,
        'android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE',
        'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.VIBRATE'],
    },
  };
};
