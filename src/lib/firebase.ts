import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
export { onAuthStateChanged };
import { getFirestore, doc, getDocFromServer, updateDoc, setDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { toast } from 'sonner';
import firebaseConfig from '../../firebase-applet-config.json';

// Initialize Firebase with the explicit config from the JSON file
console.log("[FIREBASE_INIT]: Project ID:", firebaseConfig.projectId);
console.log("[FIREBASE_INIT]: Browser Firebase Console URL: https://console.firebase.google.com/project/" + firebaseConfig.projectId + "/firestore");
console.log("[FIREBASE_INIT]: Database ID:", firebaseConfig.firestoreDatabaseId || "(default)");
const app = initializeApp(firebaseConfig);

// Initialize services
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);

// Export everything needed to ensure consistent versions/imports
export { doc, getDocFromServer, updateDoc, setDoc, collection, addDoc, query, where, onSnapshot, serverTimestamp };

// Monitor auth state for debugging
onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("[AUTH_MONITOR]: User logged in", {
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified
    });
  } else {
    console.log("[AUTH_MONITOR]: No user logged in");
  }
});

// Validate Connection with a standard check
async function testConnection() {
  try {
    // Attempting a server-side fetch to verify credentials and connectivity
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firebase connection established successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Firebase is offline. Check credentials or internet connection.");
    } else {
      console.warn("Firestore connection check produced an expected permission error or connectivity issue:", error);
    }
  }
}
testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
  UPLOAD = 'upload'
}

/**
 * Standardized error handler for better debugging of rules and permissions
 */
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const message = error instanceof Error ? error.message : String(error);
  const errInfo = {
    error: error instanceof Error ? error.name : 'UnknownError',
    message,
    operationType,
    path,
    authInfo: {
      isLoggedIn: !!auth.currentUser,
      userId: auth.currentUser?.uid || 'anonymous',
      email: auth.currentUser?.email || 'none',
      emailVerified: auth.currentUser?.emailVerified || false,
    },
    timestamp: new Date().toISOString()
  };
  
  console.error('[FIREBASE_DEBUG_REPORT]:', JSON.stringify(errInfo, null, 2));
  
  // Provide user feedback
  if (message.includes('permission-denied') || message.includes('insufficient permissions')) {
    toast.error("You don't have permission to perform this action. If you're an admin, please verify your status.");
  } else if (message.includes('quota-exceeded')) {
    toast.error("Firebase quota exceeded. Please try again later.");
  } else {
    toast.error(`Operation failed: ${message}`);
  }

  throw new Error(JSON.stringify(errInfo));
}
