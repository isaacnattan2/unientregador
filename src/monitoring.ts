import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';
import appConfig from '../app.json';

export function initializeMonitoring() {
  const channel = Updates.channel ?? (Updates.isEmbeddedLaunch ? 'embedded' : 'unknown');
  Sentry.init({
    dsn: process.env.EXPO_PUBLIC_SENTRY_DSN?.trim() || appConfig.expo.extra.sentryDsn,
    environment: __DEV__ ? 'development' : channel,
    tracesSampleRate: __DEV__ ? 1 : 0.1,
    enableLogs: true,
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    integrations: [Sentry.reactNativeTracingIntegration({ shouldCreateSpanForRequest: () => false })],
    beforeBreadcrumb(breadcrumb) {
      if (['console', 'http', 'fetch', 'xhr', 'touch'].some((category) => breadcrumb.category?.startsWith(category))) return null;
      return breadcrumb;
    },
    beforeSend(event) {
      delete event.user;
      delete event.request;
      return event;
    },
  });
  Sentry.setTags({
    'app.display_version': appConfig.expo.extra.displayVersion,
    'expo.channel': channel,
    'expo.runtime_version': Updates.runtimeVersion ?? appConfig.expo.version,
    'expo.update_id': Updates.updateId ?? 'embedded',
  });
}
