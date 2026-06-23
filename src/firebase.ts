import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

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
