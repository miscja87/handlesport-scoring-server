// Initial state
let scores = null;

export function initScores(referees, score) {
    scores = {};
    for (let i = 1; i <= referees; i++) {
        scores[i] = { score: { red: score, blue: score }};
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