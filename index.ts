import { registerRootComponent } from 'expo';
import * as Sentry from '@sentry/react-native';
import App from './App';
import { initializeMonitoring } from './src/monitoring';

initializeMonitoring();
registerRootComponent(Sentry.wrap(App));
