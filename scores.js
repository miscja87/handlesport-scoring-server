import { v4 as uuidv4 } from "uuid";

// Initial state
let scores = null;

function generateCode() {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return Array.from({ length: 5 }, () => letters[Math.floor(Math.random() * 26)]).join("");
}

export function initScores(referees, score) {
    scores = {};
    for (let i = 1; i <= referees; i++) {
        const token = uuidv4();
        scores[i] = {
            score: { red: score, blue: score },
            token: uuidv4(),
            code: generateCode(),
        };
    }
    console.log("Score initialized:", scores);
}

export function getScores() {
    return scores;
}

export function deleteScore(refereeId, startScore) {
    scores[refereeId] = { red: startScore, blue: startScore };
}

export function updateScore(refereeId, action, red, blue) {
    if (!scores?.[refereeId]) return null;
    if (red !== undefined) scores[refereeId].score.red = red;
    if (blue !== undefined) scores[refereeId].score.blue = blue;
    if (action !== undefined) scores[refereeId].action = action;
    return scores[refereeId];
}