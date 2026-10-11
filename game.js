/** 
 * PIANO FIRE ENGINE
 * Logic divided into: Audio, Hand Tracking, and Game Loop
 */

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const videoElement = document.getElementById('webcam');
const previewCanvas = document.getElementById('webcam-view');
const previewCtx = previewCanvas.getContext('2d');

// --- 1. AUDIO ENGINE (Web Audio API with ADSR) ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const activeNotes = new Map(); // Store playing oscillators

function playPianoNote(laneIndex) {
    if (activeNotes.has(laneIndex)) return;

    const freqs = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25, 587.33, 659.25];
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqs[laneIndex], audioCtx.currentTime);

    // ADSR Envelope: Attack
    gain.gain.setValueAtTime(0, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
    // Sustain
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime + 0.1);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();

    activeNotes.set(laneIndex, { osc, gain });
}

function stopPianoNote(laneIndex) {
    const note = activeNotes.get(laneIndex);
    if (note) {
        // ADSR Envelope: Release
        const releaseTime = 0.2;
        note.gain.gain.cancelScheduledValues(audioCtx.currentTime);
        note.gain.gain.setValueAtTime(note.gain.gain.value, audioCtx.currentTime);
        note.gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + releaseTime);
        
        setTimeout(() => {
            note.osc.stop();
            note.osc.disconnect();
        }, releaseTime * 1000);
        activeNotes.delete(laneIndex);
    }
}

// --- 2. HAND TRACKING & GESTURE DETECTION ---
let fingerStates = new Array(10).fill(false); // [L-Thumb...L-Pinky, R-Thumb...R-Pinky]
let handsDetected = { Left: false, Right: false };

const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 1,
    minDetectionConfidence: 0.8,
    minTrackingConfidence: 0.8
});

hands.onResults((results) => {
    previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewCtx.drawImage(results.image, 0, 0, previewCanvas.width, previewCanvas.height);
    
    let currentDetection = { Left: false, Right: false };
    let newFingerStates = new Array(10).fill(false);

    if (results.multiHandLandmarks && results.multiHandedness) {
        results.multiHandLandmarks.forEach((landmarks, idx) => {
            const handedness = results.multiHandedness[idx].label; // "Left" or "Right"
            currentDetection[handedness] = true;

            // Finger Tips: Thumb(4), Index(8), Middle(12), Ring(16), Pinky(20)
            const tips = [4, 8, 12, 16, 20];
            const wrist = landmarks[0];

            tips.forEach((tipIdx, fingerIdx) => {
                const tip = landmarks[tipIdx];
                const mcp = landmarks[tipIdx - 2]; // Joint below tip
                
                // GESTURE LOGIC: "Press" is detected when the distance between fingertip 
                // and wrist is significantly smaller than the distance from knuckle to wrist.
                // Or more simply: tip.y is below a threshold relative to the hand position.
                const isPressed = tip.y > mcp.y + 0.02; // Simple "curl" detection

                // LOCK HANDS TO SIDES:
                // Mirroring: MediaPipe Left is screen Right.
                const laneOffset = handedness === "Right" ? 0 : 5; 
                newFingerStates[laneOffset + fingerIdx] = isPressed;
            });
        });
    }

    handsDetected = currentDetection;
    updateInput(newFingerStates);
    
    const btn = document.getElementById('start-btn');
    if (handsDetected.Left && handsDetected.Right) {
        btn.disabled = false;
        document.getElementById('status-text').innerText = "Hands Ready!";
    }
});

function updateInput(newStates) {
    newStates.forEach((isPressed, i) => {
        if (isPressed && !fingerStates[i]) {
            playPianoNote(i);
            checkHit(i);
        } else if (!isPressed && fingerStates[i]) {
            stopPianoNote(i);
            checkRelease(i);
        }
        fingerStates[i] = isPressed;
    });
}

// --- 3. GAME ENGINE ---
let score = 0;
let combo = 0;
let tiles = [];
let gameRunning = false;
const HIT_ZONE_Y = window.innerHeight * 0.85;

class Tile {
    constructor(lane) {
        this.lane = lane;
        this.y = -50;
        this.isLong = Math.random() > 0.8;
        this.length = this.isLong ? 200 : 40;
        this.hit = false;
        this.held = false;
    }
}

function spawnTile() {
    if (!gameRunning) return;
    if (Math.random() < 0.05) {
        tiles.push(new Tile(Math.floor(Math.random() * 10)));
    }
}

function checkHit(lane) {
    tiles.forEach(tile => {
        if (tile.lane === lane && !tile.hit) {
            const dist = Math.abs(tile.y - HIT_ZONE_Y);
            if (dist < 60) {
                tile.hit = true;
                if (tile.isLong) tile.held = true;
                score += (dist < 30) ? 100 : 50;
                combo++;
                updateUI(dist < 30 ? "PERFECT" : "GOOD");
            }
        }
    });
}

function checkRelease(lane) {
    tiles.forEach(tile => {
        if (tile.lane === lane && tile.held) {
            tile.held = false; // Finished long note
        }
    });
}

function updateUI(rating) {
    document.getElementById('score').innerText = score;
    document.getElementById('combo-count').innerText = combo;
    document.getElementById('rating').innerText = rating;
}

function gameLoop() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const laneWidth = canvas.width / 10;

    // Draw Lanes
    for (let i = 0; i < 10; i++) {
        ctx.strokeStyle = '#222';
        ctx.strokeRect(i * laneWidth, 0, laneWidth, canvas.height);
        if (fingerStates[i]) {
            ctx.fillStyle = i < 5 ? 'rgba(0, 242, 255, 0.2)' : 'rgba(255, 0, 85, 0.2)';
            ctx.fillRect(i * laneWidth, 0, laneWidth, canvas.height);
        }
    }

    // Hit Zone
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, HIT_ZONE_Y - 10, canvas.width, 20);

    // Update Tiles
    tiles.forEach((tile, index) => {
        if (!tile.held) tile.y += 5;

        ctx.fillStyle = tile.lane < 5 ? '#00f2ff' : '#ff0055';
        ctx.shadowBlur = 15;
        ctx.shadowColor = ctx.fillStyle;
        ctx.fillRect(tile.lane * laneWidth + 10, tile.y - tile.length, laneWidth - 20, tile.length);
        ctx.shadowBlur = 0;

        if (tile.y - tile.length > canvas.height) {
            if (!tile.hit) {
                combo = 0;
                updateUI("MISS");
            }
            tiles.splice(index, 1);
        }
    });

    spawnTile();
    if (gameRunning) requestAnimationFrame(gameLoop);
}

// --- Start ---
const camera = new Camera(videoElement, {
    onFrame: async () => { await hands.send({image: videoElement}); },
    width: 640, height: 480
});
camera.start();

document.getElementById('start-btn').onclick = () => {
    audioCtx.resume();
    gameRunning = true;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    document.getElementById('overlay').style.display = 'none';
    gameLoop();
};