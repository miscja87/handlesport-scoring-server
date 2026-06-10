import { createStatus, updateStatus, createDetails, updateDetails } from "./firestore.js";
import { STATUS, COLORS, DEFAULT_PHOTO } from "./constants.js";

// Initial state
let match = null;

export async function createMatch(event, ring, specialty) {

    // Set initial match state
    match = {
        state : STATUS.STOP,
        details: {
            category: "",
            specialty: specialty,
            red: {
                name: COLORS.RED,
                country: "",
                photo: DEFAULT_PHOTO,
            },
            blue: {
                name: COLORS.BLUE,
                country: "",
                photo: DEFAULT_PHOTO,
            }
        }
    };

    // Create status document in Firestore
    await createStatus(event, ring, STATUS.STOP);

    // Create details document in Firestore
    await createDetails(event, ring, match.details);    
}

export async function updateMatchState(event, ring, newState) {

    // Update match state
    match.state = newState;
    console.log("Current match state:", JSON.stringify(match));

    // Update status document in Firestore
    await updateStatus(event, ring, { state: match.state });
}

export function getMatchState() {

    return match ? match.state : null;
}

export async function updateMatchDetails(event, ring, newDetails) {

    // Update match details
    match.details = { ...match.details, ...newDetails };
    console.log("Current match state:", JSON.stringify(match));

    // Update details document in Firestore
    await updateDetails(event, ring, match.details);    
}