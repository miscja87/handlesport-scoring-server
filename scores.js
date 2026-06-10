// Initial state
let scores = null;
let startScore = null;

export function initScores(referees, score) {
    scores = {};
    startScore = score;
    for (let i = 1; i <= referees; i++) {
        scores[i] = { score: { red: score, blue: score }};
    }
    console.log("Score initialized:", scores);
}

export function getScores() {
    return scores;
}

export function getStartScore() {
    return startScore;
}

export function deleteScore(refereeId) {
    scores[refereeId] = { red: startScore, blue: startScore };
}

export function updateScore(refereeId, action, red, blue) {
    if (!scores?.[refereeId]) return null;
    if (red !== undefined) scores[refereeId].score.red = red;
    if (blue !== undefined) scores[refereeId].score.blue = blue;
    if (action !== undefined) scores[refereeId].action = action;
    return scores[refereeId];
}