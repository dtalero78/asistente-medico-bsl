import state from './state.js';

const beepSound = new Audio('/static/assets/beep.mp3');
const holaSound = new Audio('/static/assets/hola.mp3');

export function startBeeping() {
    beepSound.currentTime = 0;
    beepSound.play();
    state.beepInterval = setInterval(() => {
        beepSound.currentTime = 0;
        beepSound.play();
    }, 2000);
}

export function stopBeeping() {
    if (state.beepInterval) {
        clearInterval(state.beepInterval);
        state.beepInterval = null;
    }
    beepSound.pause();
    beepSound.currentTime = 0;
}

export function playHola() {
    holaSound.currentTime = 0;
    return holaSound.play();
}
