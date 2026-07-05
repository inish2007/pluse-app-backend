import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';

const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

let firebaseApp: App | null = null;
let firebaseAuth: Auth | null = null;
let firebaseMessaging: Messaging | null = null;

if (!credentialsPath) {
  console.warn(
    '[Firebase Admin] GOOGLE_APPLICATION_CREDENTIALS is not set. Firebase Admin SDK will be initialized using application default credentials if available.'
  );
}

try {
  firebaseApp = getApps().length > 0 ? getApp() : initializeApp();
  firebaseAuth = getAuth(firebaseApp);
  firebaseMessaging = getMessaging(firebaseApp);
  console.log('[Firebase Admin] initialized successfully.');
} catch (error) {
  console.error('[Firebase Admin] initialization failed:', error);
  firebaseApp = null;
  firebaseAuth = null;
  firebaseMessaging = null;
}

export const ensureFirebaseAdminInitialized = (): { app: App; auth: Auth; messaging: Messaging } => {
  if (!firebaseApp || !firebaseAuth || !firebaseMessaging) {
    throw new Error('Firebase Admin initialization failed. Startup cannot continue.');
  }

  return {
    app: firebaseApp,
    auth: firebaseAuth,
    messaging: firebaseMessaging
  };
};

export { firebaseApp, firebaseAuth, firebaseMessaging };
