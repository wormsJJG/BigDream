import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDGTvT4En8iXJENDU3miHSJnD_n6MUF10M",
  authDomain: "bigdream-216cb.firebaseapp.com",
  projectId: "bigdream-216cb",
  storageBucket: "bigdream-216cb.firebasestorage.app",
  messagingSenderId: "495577029138",
  appId: "1:495577029138:web:23c815b526932fc71196cb",
  measurementId: "G-TEQ25W7CGZ"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);