import { createStatus, updateStatus, createDetails, updateDetails } from "./firestore.js";

// Initial state
let match = null;

// Constants
const STOP_STATUS = "stop";
const PLAY_STATUS = "play";
const COLOR_RED = "RED";
const COLOR_BLUE = "BLUE";
const PLAYER_PHOTO = "default.png";

export async function createMatch(event, ring, specialty) {

    // Set initial match state
    match = {
        state : STOP_STATUS,
        details: {
            category: "",
            specialty: specialty,
            red: {
                name: COLOR_RED,
                country: "",
                photo: PLAYER_PHOTO,
            },
            blue: {
                name: COLOR_BLUE,
                country: "",
                photo: PLAYER_PHOTO,
            }
        }
    };

    // Create status document in Firestore
    await createStatus(event, ring, STOP_STATUS);

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

export async function updateMatchDetails(event, ring, newDetails) {

    // Update match details
    match.details = { ...match.details, ...newDetails };
    console.log("Current match state:", JSON.stringify(match));

    // Update details document in Firestore
    await updateDetails(event, ring, match.details);    
}