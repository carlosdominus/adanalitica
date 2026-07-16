import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBdGBtXNGWUpr8GFB-jJUhFDrSj7v8ImeE",
  authDomain: "gen-lang-client-0254253171.firebaseapp.com",
  projectId: "gen-lang-client-0254253171",
  storageBucket: "gen-lang-client-0254253171.firebasestorage.app",
  messagingSenderId: "1012412258634",
  appId: "1:1012412258634:web:8d847454c03ef2048049b3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "ai-studio-adanalyticaai-328daa3d-7b9c-4dcf-ac21-566db5984cd0");

export { app, auth, db };
