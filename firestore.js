import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getAuth, signInWithCustomToken, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
    apiKey: "AIzaSyDeZGGdAEZ8yWOTm4GnZsWehpApjnXhOYQ",
    authDomain: "handlesport-2k25.firebaseapp.com",
    projectId: "handlesport-2k25",
    storageBucket: "handlesport-2k25.firebasestorage.app",
    messagingSenderId: "199277353127",
    appId: "1:199277353127:web:6fe36096f315eba357e382",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const functions = getFunctions(app);
console.log("Firebase initialized", JSON.stringify(app));

// Server login
async function loginAsServer(event, ring)
{
    const uid = `server`
    const getCustomToken = httpsCallable(functions, "getCustomToken");

    // getCustomToken occasionally fails with a transient "functions/internal"
    // error (Cloud Function cold start) — retry a few times with backoff
    // before giving up, instead of forcing the admin to restart the app.
    const maxAttempts = 3;
    let result;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            result = await getCustomToken({ tokenId : uid, role : "server", event : `event_${event}`, ring : `ring_${ring}` });
            break;
        } catch (err) {
            const isLastAttempt = attempt === maxAttempts;
            console.warn(`getCustomToken attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
            if (isLastAttempt) throw err;
            await new Promise(resolve => setTimeout(resolve, 800 * attempt));
        }
    }

    const token = result.data.token;

    await signInWithCustomToken(auth, token);
    await waitForAuthInitialized(auth);
    console.log("Logged server successful as", auth.currentUser.uid);
}

// Update referee document in Firestore
async function createRefereeDoc(event, ring, refereeId, initialScore, initialStatus = 'pending') {
    const refereeDocName = `event_${event}/ring_${ring}/referee_${refereeId}`;
    const refereeRef = doc(db, "score", refereeDocName);
    const refereeDocSnap = await getDoc(refereeRef);
    if (!refereeDocSnap.exists()) {
        console.log("✅ Creating document " + refereeDocName);
        await setDoc(refereeRef, {
            id: refereeId,
            status: initialStatus,
            score: initialScore
        });
    } else {
        console.log("⚠️ Document " + refereeDocName + " already exists, update with new values");
        await updateDoc(refereeRef, {
            id: refereeId,
            status: initialStatus,
            score: initialScore
        });
    }
}

// Update referee document in Firestore
async function updateRefereeDoc(event, ring, refereeId, updateData) {
    try {
        const refereeDocName = `event_${event}/ring_${ring}/referee_${refereeId}`;
        const refereeRef = doc(db, "score", refereeDocName);
        const refereeDocSnap = await getDoc(refereeRef);
        if (refereeDocSnap.exists()) {
            console.log("✅ Updating document " + refereeDocName + " with data:", JSON.stringify(updateData));
            await updateDoc(refereeRef, updateData);
        }
    } catch (error) {
        if (error.code === "permission-denied") {
            console.log("⚠️ Error in updating referee document " + refereeId + ": authentication not ready");
        } else {
            console.log("❌ Error in updating referee document " + refereeId, error);
        }
    }
}

// Delete referee document in Firestore
async function deleteRefereeDoc(event, ring, refereeId) {
    const refereeDocName = `event_${event}/ring_${ring}/referee_${refereeId}`;
    const refereeRef = doc(db, "score", refereeDocName);
    await deleteDoc(refereeRef);
    console.log("✅ Deleted document " + refereeDocName); 
}

// Create status document in Firestore
async function createStatus(event, ring, state) {
    const statusDocName = `event_${event}/ring_${ring}/status`;
    const statusRef = doc(db, "score", statusDocName);
    const statusDocSnap = await getDoc(statusRef);
    if (!statusDocSnap.exists()) {
        console.log("❌ Document " + statusDocName + " not found, creating new document");
        await setDoc(statusRef, { state: state });        
    }
}

// Update status document in Firestore
async function updateStatus(event, ring, updateData) {
    try {
        const statusDocName = `event_${event}/ring_${ring}/status`;
        const statusRef = doc(db, "score", statusDocName);
        console.log("✅ Updating status with data:", JSON.stringify(updateData));
        await updateDoc(statusRef, updateData);
    } catch (error) {
        if (error.code === "permission-denied") {
            console.log("⚠️ Error in updating status for document " + statusDocName + ": authentication not ready");
        } else {
            console.log("❌ Error in updating status for document " + statusDocName, error);
        }
    }
}

// Create details document in Firestore
async function createDetails(event, ring, details) {
    const detailsDocName = `event_${event}/ring_${ring}/details`;
    const detailsRef = doc(db, "score", detailsDocName);
    const detailsDocSnap = await getDoc(detailsRef);
    if (!detailsDocSnap.exists()) {
        console.log("❌ Document " + detailsDocName + " not found, creating new document");
        await setDoc(detailsRef, details);        
    }
}

// Update details document in Firestore
async function updateDetails(event, ring, updateData) {
    try {
        const detailsDocName = `event_${event}/ring_${ring}/details`;
        const detailsRef = doc(db, "score", detailsDocName);
        console.log("✅ Updating details with data:", JSON.stringify(updateData));
        await updateDoc(detailsRef, updateData);
    } catch (error) {
        if (error.code === "permission-denied") {
            console.log("⚠️ Error in updating details for document " + detailsDocName + ": authentication not ready");
        } else {
            console.log("❌ Error in updating details for document " + detailsDocName, error);
        }
    }
}

// GLOBAL mode: referees write their score straight to Firestore instead of
// POSTing to the local server (which they may not even be able to reach if
// they're not on the same network). This listens to the whole ring_Y
// subcollection at once — cheaper than one onSnapshot per referee, and it
// picks up every referee_* doc without needing to know refereeCount ahead
// of time. onUpdate(refereeId, data) fires once per changed referee doc;
// status/details docs living in the same subcollection are filtered out.
// Returns the unsubscribe function so the caller can tear the listener down.
function listenToRefereeScores(event, ring, onUpdate) {
    const ringCollection = collection(db, "score", `event_${event}`, `ring_${ring}`);

    return onSnapshot(ringCollection, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === "removed") return;
            if (!change.doc.id.startsWith("referee_")) return;

            const refereeId = parseInt(change.doc.id.replace("referee_", ""));
            if (Number.isNaN(refereeId)) return;

            onUpdate(refereeId, change.doc.data());
        });
    }, (error) => {
        console.log("❌ Error listening to referee scores", error);
    });
}

// Waiting for auth initialization
function waitForAuthInitialized(auth) {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(
        auth,
        user => {
            unsubscribe();
            resolve(user);
        },
        error => {
            unsubscribe();
            reject(error);
        }
        );
    });
}

export { loginAsServer, createRefereeDoc, updateRefereeDoc, deleteRefereeDoc, createStatus, updateStatus, createDetails, updateDetails, listenToRefereeScores, onSnapshot, auth };