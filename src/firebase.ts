import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, User } from 'firebase/auth';

// Public by design — security is enforced by Firestore rules (firestore.rules).
const firebaseConfig = {
  apiKey: 'AIzaSyAaEzER9GP9Ce2qD_Cmk4rP70V7q-u_leE',
  authDomain: 'secrethitler-97006.firebaseapp.com',
  projectId: 'secrethitler-97006',
  storageBucket: 'secrethitler-97006.firebasestorage.app',
  messagingSenderId: '747688079363',
  appId: '1:747688079363:web:05f534dd98e3825b75de36',
  measurementId: 'G-624JQ0QPPX',
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

let signInPromise: Promise<User> | null = null;

/** Ensure the browser is signed in anonymously; resolves with the stable uid. */
export function ensureSignedIn(): Promise<User> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (signInPromise) return signInPromise;
  signInPromise = new Promise<User>((resolve, reject) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) { unsub(); resolve(user); }
    });
    signInAnonymously(auth).catch((err) => { unsub(); signInPromise = null; reject(err); });
  });
  return signInPromise;
}
