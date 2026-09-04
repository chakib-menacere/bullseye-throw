// Fill these in with your own Firebase project's web app config
// (Firebase console -> Project settings -> Your apps -> SDK setup and config).
// These values are not secret -- they're meant to be public in client code.
// Access control is enforced by Firestore Security Rules, not by hiding this.
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.appspot.com',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};

let leaderboardDb = null;
if (firebaseConfig.apiKey !== 'YOUR_API_KEY') {
  firebase.initializeApp(firebaseConfig);
  leaderboardDb = firebase.firestore();
}
