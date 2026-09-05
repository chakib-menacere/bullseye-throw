// Fill these in with your own Firebase project's web app config
// (Firebase console -> Project settings -> Your apps -> SDK setup and config).
// These values are not secret -- they're meant to be public in client code.
// Access control is enforced by Firestore Security Rules, not by hiding this.
const firebaseConfig = {
  apiKey: 'AIzaSyDiprEosdbNBoccdcQ5tFFpiClPHpAi_hE',
  authDomain: 'bullseye-throw.firebaseapp.com',
  projectId: 'bullseye-throw',
  storageBucket: 'bullseye-throw.firebasestorage.app',
  messagingSenderId: '858340241927',
  appId: '1:858340241927:web:29c55e4d7c87d28f0cb0a2',
  measurementId: 'G-V607ZQCK99',
};

let leaderboardDb = null;
if (firebaseConfig.apiKey !== 'YOUR_API_KEY') {
  firebase.initializeApp(firebaseConfig);
  leaderboardDb = firebase.firestore();
}
