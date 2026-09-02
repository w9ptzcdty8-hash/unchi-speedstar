// ========================================
// うんちスピードスター
// Main JavaScript (ES Module)
// ========================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
    getDatabase,
    ref,
    set,
    get,
    remove,
    onValue,
    off,
    runTransaction,
    onDisconnect,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

import {
    CORRECT_WORD,
    UNIQUE_FAKE_WORDS,
    ALL_WORDS,
    CORRECT_WORD_INDEX
} from "./words.js";

// ========================================
// Firebase設定
// ========================================
const firebaseConfig = {
  apiKey: "AIzaSyCHcw78cImehf65vogNXPyxm2C4LpJlciU",
  authDomain: "unch-speedstar.firebaseapp.com",
  databaseURL: "https://unch-speedstar-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "unch-speedstar",
  storageBucket: "unch-speedstar.firebasestorage.app",
  messagingSenderId: "158427272547",
  appId: "1:158427272547:web:97ab36d4ef3b7681f3ef56",
  measurementId: "G-PZ75BED8KQ"
};

let firebaseApp = null;
let db = null;
let firebaseReady = false;

try {
    firebaseApp = initializeApp(firebaseConfig);
    db = getDatabase(firebaseApp);
    firebaseReady = true;
} catch (err) {
    console.warn("Firebase初期化に失敗しました（設定値を確認してください）", err);
    firebaseReady = false;
}

// ========================================
// 定数：単語リスト・難易度設定
// ========================================

const DIFFICULTY_SETTINGS = {
    1: { name: "EASY", min: 1000, max: 1300, fakeRate: 0.60 },
    2: { name: "NORMAL", min: 600, max: 1300, fakeRate: 0.70 },
    3: { name: "HARD", min: 400, max: 1300, fakeRate: 0.80 },
    4: { name: "CHAOS", min: 100, max: 1300, fakeRate: 0.85 }
};

const SINGLE_LEVEL_PROGRESSION = [1, 2, 2, 3, 4];
const MISS_PENALTY_MS = 500;
const LOCAL_HIGHSCORE_LIST_KEY = "unchiSpeedstar_highscore_list_ms";
const EFFECT_WAIT_MS = 2000;

const ANIMATION_CLASSES = [
    "anim-pop",
    "anim-slide-left",
    "anim-slide-right",
    "anim-fade-blur",
    "anim-rotate-tilt"
];

// ========================================
// 効果音
// ========================================

const sounds = {
    word: new Audio("assets/sounds/word.mp3"),
    correct: new Audio("assets/sounds/correct.mp3"),
    miss: new Audio("assets/sounds/miss.mp3"),
    win: new Audio("assets/sounds/win.mp3"),
    highscore: new Audio("assets/sounds/highscore.mp3")
};

function playSound(key) {
    const src = sounds[key];
    if (!src) return;
    try {
        src.currentTime = 0;
        src.play().catch(() => {});
    } catch (err) {}
}

// ========================================
// DOM参照
// ========================================

const screens = {
    title: document.getElementById("screen-title"),
    single: document.getElementById("screen-single"),
    singleResult: document.getElementById("screen-single-result"),
    multiSetup: document.getElementById("screen-multi-setup"),
    roomWait: document.getElementById("screen-room-wait"),
    multiPlay: document.getElementById("screen-multi-play"),
    multiResult: document.getElementById("screen-multi-result"),
    highscore: document.getElementById("screen-highscore")
};

function showScreen(key) {
    Object.values(screens).forEach((el) => el.classList.remove("is-active"));
    if (screens[key]) {
        screens[key].classList.add("is-active");
    }
}

// ========================================
// 共通ユーティリティ
// ========================================

function randomPlayerName() {
    const n = Math.floor(Math.random() * 900) + 100;
    return `Player${n}`;
}

function randomRoomId() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let id = "";
    for (let i = 0; i < 6; i++) {
        id += chars[Math.floor(Math.random() * chars.length)];
    }
    return id;
}

function randomPlayerId() {
    return `p_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function formatSeconds(ms) {
    return (ms / 1000).toFixed(2) + "秒";
}

function resetFeedback(feedbackBadgeEl, stageEl) {
    if (feedbackBadgeEl) {
        feedbackBadgeEl.classList.remove("badge-good", "badge-bad");
        feedbackBadgeEl.textContent = "";
    }
    if (stageEl) {
        stageEl.classList.remove("shake-stage");
    }
}

function triggerFeedback(overlayEl, feedbackBadgeEl, stageEl, type, customText = "") {
    if (type === "good" || type === "bad") {
        overlayEl.classList.remove("flash-good", "flash-bad");
        void overlayEl.offsetWidth;
        overlayEl.classList.add(type === "good" ? "flash-good" : "flash-bad");
        window.setTimeout(() => {
            overlayEl.classList.remove("flash-good", "flash-bad");
        }, 220);
    }

    if (feedbackBadgeEl) {
        feedbackBadgeEl.classList.remove("badge-good", "badge-bad", "badge-pending");
        void feedbackBadgeEl.offsetWidth;
        if (type === "good") {
            feedbackBadgeEl.textContent = customText || "〇せいかい";
            feedbackBadgeEl.classList.add("badge-good");
        } else if (type === "pending") {
            feedbackBadgeEl.textContent = customText || "⏳ はんてい中…";
            feedbackBadgeEl.classList.add("badge-pending");
        } else {
            feedbackBadgeEl.textContent = customText || "✕ お手つき！";
            feedbackBadgeEl.classList.add("badge-bad");
        }
    }

    if (type === "bad" && stageEl) {
        stageEl.classList.remove("shake-stage");
        void stageEl.offsetWidth;
        stageEl.classList.add("shake-stage");
    }
}

function pickWord(difficultyLevel) {
    const settings = DIFFICULTY_SETTINGS[difficultyLevel] || DIFFICULTY_SETTINGS[2];
    const isFake = Math.random() < settings.fakeRate;
    if (!isFake) {
        return { word: CORRECT_WORD, isCorrect: true };
    }
    const fake = UNIQUE_FAKE_WORDS[Math.floor(Math.random() * UNIQUE_FAKE_WORDS.length)];
    return { word: fake, isCorrect: false };
}

function pickInterval(difficultyLevel) {
    const settings = DIFFICULTY_SETTINGS[difficultyLevel] || DIFFICULTY_SETTINGS[2];
    return Math.floor(settings.min + Math.random() * (settings.max - settings.min));
}

function setWordTextWithAnimation(element, newText) {
    element.textContent = "";
    ANIMATION_CLASSES.forEach(cls => element.classList.remove(cls));

    if (!newText) return;

    void element.offsetWidth;
    element.textContent = newText;
    const animClass = ANIMATION_CLASSES[Math.floor(Math.random() * ANIMATION_CLASSES.length)];
    element.classList.add(animClass);
}

function getTitleInfo(totalMs) {
    const sec = totalMs / 1000;
    if (sec < 2.50) return { rank: "ss", name: "👑 神速のうんち神" };
    if (sec < 3.00) return { rank: "s", name: "⚡ 光速のうんちマスター" };
    if (sec < 4.00) return { rank: "a", name: "💩 ベテランうんちハンター" };
    if (sec < 6.00) return { rank: "b", name: "🏃 見習いうんちハンター" };
    if (sec < 8.00) return { rank: "c", name: "🐢 のんびりうんち鑑賞家" };
    return { rank: "d", name: "💤 うんち初心者" };
}

function startCountdown(wordElement, onComplete) {
    setWordTextWithAnimation(wordElement, "れでぃ？");
    playSound("word");

    window.setTimeout(() => {
        setWordTextWithAnimation(wordElement, "ごー！");
        playSound("correct");

        window.setTimeout(() => {
            setWordTextWithAnimation(wordElement, "");
            if (onComplete) onComplete();
        }, 600);
    }, 800);
}

// ========================================
// ひとりであそぶ
// ========================================

const singleEls = {
    flash: document.getElementById("single-flash"),
    feedback: document.getElementById("single-feedback"),
    stage: document.getElementById("single-stage"),
    roundTimes: document.getElementById("single-round-times"),
    wordBlob: document.getElementById("single-word-blob"),
    wordText: document.getElementById("single-word-text"),
    wordElapsed: document.getElementById("single-word-elapsed"),
    quitBtn: document.getElementById("btn-single-quit"),
    resultTotal: document.getElementById("single-result-total"),
    resultDetail: document.getElementById("single-result-detail"),
    resultNewRecord: document.getElementById("single-result-newrecord"),
    retryBtn: document.getElementById("btn-single-retry"),
    toTitleBtn: document.querySelector(".btn-single-to-title")
};

let singleState = null;

function createSingleState() {
    return {
        roundIndex: 0,
        roundTimesMs: [0, 0, 0, 0, 0],
        roundTapTimesMs: [0, 0, 0, 0, 0],
        roundMissedTimesMs: [0, 0, 0, 0, 0],
        roundMissCounts: [0, 0, 0, 0, 0],
        wordTimeoutId: null,
        wordStartedAt: 0,
        waitingForCorrectTap: false,
        wordIsActive: false,
        finished: false,
        isPaused: true,
        isCountingDown: true,
        elapsedTimerAnimId: null
    };
}

function renderSingleRoundChips() {
    singleEls.roundTimes.innerHTML = "";
    for (let i = 0; i < 5; i++) {
        const chip = document.createElement("span");
        chip.className = "round-chip";
        if (i < singleState.roundIndex) {
            chip.classList.add("is-done");
            chip.textContent = `${i + 1}: ${formatSeconds(singleState.roundTapTimesMs[i])}`;
        } else if (i === singleState.roundIndex) {
            chip.classList.add("is-current");
            chip.textContent = `${i + 1}回目`;
        } else {
            chip.textContent = `${i + 1}`;
        }
        singleEls.roundTimes.appendChild(chip);
    }
}

function updateWordElapsedDisplay() {
    if (!singleState || singleState.finished) return;

    if (!singleState.isPaused && singleState.wordIsActive && singleState.wordStartedAt > 0) {
        const now = performance.now();
        const elapsed = (now - singleState.wordStartedAt) / 1000;
        singleEls.wordElapsed.textContent = `単語経過: ${elapsed.toFixed(2)}秒`;
    } else if (!singleState.isPaused) {
        singleEls.wordElapsed.textContent = "単語経過: 0.00秒";
    }

    singleState.elapsedTimerAnimId = requestAnimationFrame(updateWordElapsedDisplay);
}

function startSinglePlay() {
    stopSinglePlay();
    singleState = createSingleState();
    resetFeedback(singleEls.feedback, singleEls.stage);
    renderSingleRoundChips();

    if (singleEls.wordElapsed) {
        singleEls.wordElapsed.textContent = "単語経過: 0.00秒";
    }

    showScreen("single");

    startCountdown(singleEls.wordText, () => {
        if (!singleState) return;
        singleState.isCountingDown = false;
        singleState.isPaused = false;
        scheduleSingleWord();
        updateWordElapsedDisplay();
    });
}

function scheduleSingleWord() {
    if (!singleState || singleState.finished || singleState.isPaused || singleState.isCountingDown) return;

    const level = SINGLE_LEVEL_PROGRESSION[singleState.roundIndex];
    const interval = pickInterval(level);

    singleState.wordTimeoutId = window.setTimeout(() => {
        showSingleWord(level);
    }, interval);
}

function showSingleWord(level) {
    if (!singleState || singleState.finished || singleState.isPaused || singleState.isCountingDown) return;

    if (singleState.wordIsActive && singleState.waitingForCorrectTap && singleState.wordStartedAt > 0) {
        const missedTime = performance.now() - singleState.wordStartedAt;
        singleState.roundMissedTimesMs[singleState.roundIndex] += missedTime;
        singleState.roundTimesMs[singleState.roundIndex] += missedTime;
    }

    resetFeedback(singleEls.feedback, singleEls.stage);
    const { word, isCorrect } = pickWord(level);
    setWordTextWithAnimation(singleEls.wordText, word);

    singleState.wordIsActive = true;
    singleState.waitingForCorrectTap = isCorrect;
    singleState.wordStartedAt = performance.now();
    playSound("word");

    scheduleSingleWord();
}

function handleSingleTap() {
    if (!singleState || singleState.finished || singleState.isPaused || singleState.isCountingDown) return;

    const isCorrectTap = singleState.wordIsActive && singleState.waitingForCorrectTap;

    singleState.isPaused = true;
    if (singleState.wordTimeoutId) {
        window.clearTimeout(singleState.wordTimeoutId);
        singleState.wordTimeoutId = null;
    }

    if (isCorrectTap) {
        const reaction = performance.now() - singleState.wordStartedAt;
        singleState.roundTapTimesMs[singleState.roundIndex] = reaction;

        singleEls.wordElapsed.textContent = `単語経過: ${(reaction / 1000).toFixed(2)}秒`;

        const missPenalty = singleState.roundMissCounts[singleState.roundIndex] * MISS_PENALTY_MS;
        singleState.roundTimesMs[singleState.roundIndex] += (reaction + missPenalty);

        playSound("correct");
        triggerFeedback(singleEls.flash, singleEls.feedback, singleEls.stage, "good");

        singleState.wordIsActive = false;
        singleState.waitingForCorrectTap = false;
        singleState.wordStartedAt = 0;

        window.setTimeout(() => {
            if (!singleState) return;
            singleState.isPaused = false;
            resetFeedback(singleEls.feedback, singleEls.stage);
            setWordTextWithAnimation(singleEls.wordText, "");
            advanceSingleRound();
        }, EFFECT_WAIT_MS);
    } else {
        singleState.roundMissCounts[singleState.roundIndex] += 1;
        playSound("miss");
        triggerFeedback(singleEls.flash, singleEls.feedback, singleEls.stage, "bad");

        singleState.wordIsActive = false;
        singleState.waitingForCorrectTap = false;
        singleState.wordStartedAt = 0;

        window.setTimeout(() => {
            if (!singleState) return;
            singleState.isPaused = false;
            resetFeedback(singleEls.feedback, singleEls.stage);
            setWordTextWithAnimation(singleEls.wordText, "");
            scheduleSingleWord();
        }, EFFECT_WAIT_MS);
    }
}

function advanceSingleRound() {
    singleState.roundIndex += 1;
    renderSingleRoundChips();

    if (singleState.roundIndex >= 5) {
        singleState.finished = true;
        finishSinglePlay();
        return;
    }

    scheduleSingleWord();
}

function getLocalHighscores() {
    const raw = window.localStorage.getItem(LOCAL_HIGHSCORE_LIST_KEY);
    if (!raw) {
        const oldVal = window.localStorage.getItem("unchiSpeedstar_highscore_ms");
        if (oldVal) {
            const parsedOld = parseFloat(oldVal);
            if (!isNaN(parsedOld)) return [parsedOld];
        }
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveLocalHighscore(totalMs) {
    const list = getLocalHighscores();
    list.push(totalMs);
    list.sort((a, b) => a - b);
    const best5 = list.slice(0, 5);
    window.localStorage.setItem(LOCAL_HIGHSCORE_LIST_KEY, JSON.stringify(best5));
    return best5[0] === totalMs;
}

function finishSinglePlay() {
    if (singleState.elapsedTimerAnimId) {
        cancelAnimationFrame(singleState.elapsedTimerAnimId);
        singleState.elapsedTimerAnimId = null;
    }

    const totalMs = singleState.roundTimesMs.reduce((a, b) => a + b, 0);
    const isNewTopRecord = saveLocalHighscore(totalMs);

    playSound("win");

    if (isNewTopRecord) {
        window.setTimeout(() => playSound("highscore"), 300);
        saveHighscoreToFirebase(totalMs).catch(() => {});
    }

    singleEls.resultNewRecord.classList.toggle("is-hidden", !isNewTopRecord);
    singleEls.resultTotal.textContent = formatSeconds(totalMs);

    const titleInfo = getTitleInfo(totalMs);
    const titleBadge = document.getElementById("single-result-title-badge");
    if (titleBadge) {
        titleBadge.textContent = titleInfo.name;
        titleBadge.className = `title-badge rank-${titleInfo.rank}`;
        titleBadge.classList.remove("is-hidden");
    }

    singleEls.resultDetail.innerHTML = "";

    for (let i = 0; i < 5; i++) {
        const row = document.createElement("div");
        row.className = "result-row";
        const level = SINGLE_LEVEL_PROGRESSION[i];
        const levelName = DIFFICULTY_SETTINGS[level].name;

        const roundTotal = singleState.roundTimesMs[i];
        const tapTime = singleState.roundTapTimesMs[i];
        const missedTime = singleState.roundMissedTimesMs[i];
        const missCount = singleState.roundMissCounts[i];

        row.innerHTML = `
            <div class="result-row-header">
                <span>${i + 1}回目（${levelName}）</span>
                <span>${formatSeconds(roundTotal)}</span>
            </div>
            <div class="result-row-breakdown">
                <span>タップ: ${formatSeconds(tapTime)}</span>
                ${missedTime > 0 ? `<span>見逃し: +${formatSeconds(missedTime)}</span>` : ""}
                ${missCount > 0 ? `<span>お手つき: ${missCount}回(+${formatSeconds(missCount * MISS_PENALTY_MS)})</span>` : ""}
            </div>
        `;
        singleEls.resultDetail.appendChild(row);
    }

    showScreen("singleResult");
}

function stopSinglePlay() {
    if (singleState) {
        if (singleState.wordTimeoutId) {
            window.clearTimeout(singleState.wordTimeoutId);
            singleState.wordTimeoutId = null;
        }
        if (singleState.elapsedTimerAnimId) {
            cancelAnimationFrame(singleState.elapsedTimerAnimId);
            singleState.elapsedTimerAnimId = null;
        }
    }
    singleState = null;
}

singleEls.wordBlob.addEventListener("click", handleSingleTap);
singleEls.quitBtn.addEventListener("click", () => {
    stopSinglePlay();
    showScreen("title");
});
singleEls.retryBtn.addEventListener("click", startSinglePlay);
if (singleEls.toTitleBtn) {
    singleEls.toTitleBtn.addEventListener("click", () => showScreen("title"));
}

document.getElementById("btn-goto-single").addEventListener("click", startSinglePlay);

// ========================================
// ハイスコア画面
// ========================================

const highscoreEls = {
    localList: document.getElementById("highscore-local-list"),
    ranking: document.getElementById("highscore-ranking"),
    toTitleBtn: document.getElementById("btn-highscore-to-title")
};

async function saveHighscoreToFirebase(totalMs) {
    if (!firebaseReady) return;
    const name = getStoredPlayerName() || randomPlayerName();
    const id = getOrCreateLocalPlayerId();
    try {
        await set(ref(db, `highscores/${id}`), {
            name,
            totalMs,
            updatedAt: serverTimestamp()
        });
    } catch (err) {
        console.warn("ハイスコアのFirebase保存に失敗しました", err);
    }
}

function getOrCreateLocalPlayerId() {
    let id = window.localStorage.getItem("unchiSpeedstar_playerId");
    if (!id) {
        id = randomPlayerId();
        window.localStorage.setItem("unchiSpeedstar_playerId", id);
    }
    return id;
}

function getStoredPlayerName() {
    return window.localStorage.getItem("unchiSpeedstar_playerName") || "";
}

function renderHighscoreScreen() {
    const localBest = getLocalHighscores();
    highscoreEls.localList.innerHTML = "";
    if (localBest.length === 0) {
        highscoreEls.localList.innerHTML = '<li class="highscore-loading">記録なし</li>';
    } else {
        localBest.forEach((ms, index) => {
            const titleInfo = getTitleInfo(ms);
            const li = document.createElement("li");
            li.innerHTML = `
                <span class="hs-rank">${index + 1}位</span>
                <span class="hs-title rank-${titleInfo.rank}">${titleInfo.name}</span>
                <span class="hs-time">${formatSeconds(ms)}</span>
            `;
            highscoreEls.localList.appendChild(li);
        });
    }

    highscoreEls.ranking.innerHTML = '<li class="highscore-loading">読み込み中…</li>';

    if (!firebaseReady) {
        highscoreEls.ranking.innerHTML = '<li class="highscore-loading">オンラインランキングは利用できません</li>';
        return;
    }

    get(ref(db, "highscores"))
        .then((snapshot) => {
            const data = snapshot.val();
            if (!data) {
                highscoreEls.ranking.innerHTML = '<li class="highscore-loading">まだ記録がありません</li>';
                return;
            }
            const list = Object.values(data)
                .filter((entry) => typeof entry.totalMs === "number")
                .sort((a, b) => a.totalMs - b.totalMs)
                .slice(0, 10);

            highscoreEls.ranking.innerHTML = "";
            list.forEach((entry, index) => {
                const li = document.createElement("li");
                li.innerHTML = `<span>${index + 1}. ${escapeHtml(entry.name || "名無し")}</span><span>${formatSeconds(
                    entry.totalMs
                )}</span>`;
                highscoreEls.ranking.appendChild(li);
            });
        })
        .catch(() => {
            highscoreEls.ranking.innerHTML = '<li class="highscore-loading">読み込みに失敗しました</li>';
        });
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
}

function joinNames(names) {
    if (!names || names.length === 0) return "";
    if (names.length === 1) return names[0];
    if (names.length === 2) return names.join("と");
    return names.slice(0, -1).join("・") + "と" + names[names.length - 1];
}

document.getElementById("btn-goto-highscore").addEventListener("click", () => {
    renderHighscoreScreen();
    showScreen("highscore");
});
highscoreEls.toTitleBtn.addEventListener("click", () => showScreen("title"));

// ========================================
// みんなであそぶ（通信対戦）
// ========================================

const multiSetupEls = {
    nameInput: document.getElementById("input-player-name"),
    roomIdInput: document.getElementById("input-room-id"),
    joinBtn: document.getElementById("btn-join-room"),
    errorText: document.getElementById("multi-setup-error"),
    toTitleBtn: document.getElementById("btn-multi-to-title")
};

const roomWaitEls = {
    idDisplay: document.getElementById("room-id-display"),
    players: document.getElementById("room-players"),
    leaveBtn: document.getElementById("btn-room-leave")
};

const multiPlayEls = {
    flash: document.getElementById("multi-flash"),
    feedback: document.getElementById("multi-feedback"),
    stage: document.getElementById("multi-stage"),
    scoreboard: document.getElementById("multi-scoreboard"),
    wordBlob: document.getElementById("multi-word-blob"),
    wordText: document.getElementById("multi-word-text"),
    difficultyBadge: document.getElementById("multi-difficulty-badge"),
    penaltyText: document.getElementById("multi-penalty-text")
};

const multiResultEls = {
    title: document.getElementById("multi-result-title"),
    ranking: document.getElementById("multi-result-ranking"),
    retryBtn: document.getElementById("btn-multi-retry"),
    toTitleBtn: document.getElementById("btn-multi-result-to-title")
};

const WIN_SCORE = 3;

let multi = {
    roomId: null,
    playerId: null,
    playerName: null,
    maxPlayers: null,
    isHost: false,
    listeners: [],
    penaltyUntil: 0,
    penaltyAnimFrameId: null,
    hostLoopTimeoutId: null,
    retryIntervalId: null,
    lastPlayersData: {}
};

function multiWatch(path, callback) {
    const r = ref(db, path);
    onValue(r, callback);
    multi.listeners.push({ ref: r, callback });
}

function multiUnwatchAll() {
    multi.listeners.forEach(({ ref: r, callback }) => {
        if (r) off(r, "value", callback);
        if (typeof callback === "function") callback();
    });
    multi.listeners = [];
    if (multi.hostLoopTimeoutId) {
        window.clearTimeout(multi.hostLoopTimeoutId);
        multi.hostLoopTimeoutId = null;
    }
    if (multi.penaltyAnimFrameId) {
        cancelAnimationFrame(multi.penaltyAnimFrameId);
        multi.penaltyAnimFrameId = null;
    }
    if (multi.retryIntervalId) {
        window.clearInterval(multi.retryIntervalId);
        multi.retryIntervalId = null;
    }
}

function requireFirebase() {
    if (!firebaseReady) {
        multiSetupEls.errorText.textContent =
            "Firebaseが設定されていないため、みんなであそぶモードは利用できません。script.js内のfirebaseConfigを設定してください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
        return false;
    }
    return true;
}

document.getElementById("btn-goto-multi").addEventListener("click", () => {
    multiSetupEls.errorText.classList.add("is-hidden");
    const stored = getStoredPlayerName();
    if (stored) multiSetupEls.nameInput.value = stored;
    showScreen("multiSetup");
});
multiSetupEls.toTitleBtn.addEventListener("click", () => showScreen("title"));

document.querySelectorAll(".btn-playercount").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (!requireFirebase()) return;
        const count = parseInt(btn.dataset.count, 10);
        createRoom(count);
    });
});

multiSetupEls.joinBtn.addEventListener("click", () => {
    if (!requireFirebase()) return;
    const roomId = multiSetupEls.roomIdInput.value.trim().toUpperCase();
    if (roomId.length !== 6) {
        multiSetupEls.errorText.textContent = "6桁のルームIDを入力してください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
        return;
    }
    joinRoom(roomId);
});

function resolvePlayerName() {
    const typed = multiSetupEls.nameInput.value.trim();
    const name = typed || randomPlayerName();
    window.localStorage.setItem("unchiSpeedstar_playerName", name);
    return name;
}

async function createRoom(maxPlayers) {
    multiUnwatchAll();
    const roomId = randomRoomId();
    const playerId = randomPlayerId();
    const playerName = resolvePlayerName();

    multi.roomId = roomId;
    multi.playerId = playerId;
    multi.playerName = playerName;
    multi.maxPlayers = maxPlayers;
    multi.lastPlayersData = {};

    try {
        await set(ref(db, `rooms/${roomId}`), {
            maxPlayers,
            playerCount: 1,
            state: "waiting",
            createdAt: serverTimestamp()
        });
        await set(ref(db, `rooms/${roomId}/players/${playerId}`), {
            name: playerName,
            score: 0,
            joinedAt: Date.now(),
            ready: false
        });

        onDisconnect(ref(db, `rooms/${roomId}/players/${playerId}`)).remove();
        enterRoomWaitScreen();
    } catch (err) {
        console.error(err);
        multiSetupEls.errorText.textContent = "ルーム作成に失敗しました。時間をおいて再度お試しください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
    }
}

async function joinRoom(roomId) {
    multiUnwatchAll();
    try {
        const snap = await get(ref(db, `rooms/${roomId}`));
        const room = snap.val();
        if (!room) {
            multiSetupEls.errorText.textContent = "そのルームIDは見つかりませんでした。";
            multiSetupEls.errorText.classList.remove("is-hidden");
            return;
        }
        if (room.state !== "waiting") {
            multiSetupEls.errorText.textContent = "このルームはすでに開始しています。";
            multiSetupEls.errorText.classList.remove("is-hidden");
            return;
        }
        if ((room.playerCount || 0) >= room.maxPlayers) {
            multiSetupEls.errorText.textContent = "このルームは満員です。";
            multiSetupEls.errorText.classList.remove("is-hidden");
            return;
        }

        const playerId = randomPlayerId();
        const playerName = resolvePlayerName();

        multi.roomId = roomId;
        multi.playerId = playerId;
        multi.playerName = playerName;
        multi.maxPlayers = room.maxPlayers;
        multi.lastPlayersData = {};

        await set(ref(db, `rooms/${roomId}/players/${playerId}`), {
            name: playerName,
            score: 0,
            joinedAt: Date.now(),
            ready: false
        });

        await runTransaction(ref(db, `rooms/${roomId}/playerCount`), (current) => (current || 0) + 1);

        onDisconnect(ref(db, `rooms/${roomId}/players/${playerId}`)).remove();
        enterRoomWaitScreen();
    } catch (err) {
        console.error(err);
        multiSetupEls.errorText.textContent = "参加に失敗しました。ルームIDをご確認ください。";
        multiSetupEls.errorText.classList.remove("is-hidden");
    }
}

function renderRoomQrCode(roomId) {
    const container = document.getElementById("room-qr");
    if (!container) return;
    container.innerHTML = "";

    if (typeof QRCode === "undefined") {
        console.warn("QRコードライブラリの読み込みに失敗しました");
        return;
    }

    const joinUrl = `${location.origin}${location.pathname}?room=${roomId}`;
    try {
        new QRCode(container, {
            text: joinUrl,
            width: 140,
            height: 140,
            colorDark: "#3A2C1D",
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.M
        });
    } catch (err) {
        console.warn("QRコードの生成に失敗しました", err);
    }
}

function enterRoomWaitScreen() {
    roomWaitEls.idDisplay.textContent = multi.roomId;
    renderRoomQrCode(multi.roomId);
    showScreen("roomWait");

    multiWatch(`rooms/${multi.roomId}/players`, (snapshot) => {
        const players = snapshot.val() || {};
        multi.lastPlayersData = { ...players };
        renderRoomWaitPlayers(players);
        renderMultiScoreboard(multiPlayEls.scoreboard, players);
        checkAndUpdateHost(players);
    });

    multiWatch(`rooms/${multi.roomId}/state`, (snapshot) => {
        const state = snapshot.val();
        if (state === "playing") {
            enterMultiPlayScreen();
        } else if (state === "finished") {
            enterMultiResultScreen();
        }
    });

    multiWatch(`rooms/${multi.roomId}/round`, (snapshot) => {
        const round = snapshot.val();
        if (round) handleRoundUpdate(round);
    });

    watchAutoStart();
}

function checkAndUpdateHost(players) {
    const entries = Object.entries(players);
    if (entries.length === 0) return;
    entries.sort((a, b) => (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
    multi.isHost = (entries[0][0] === multi.playerId);
}

function watchAutoStart() {
    multiWatch(`rooms/${multi.roomId}/players`, async (snapshot) => {
        const players = snapshot.val() || {};
        const count = Object.keys(players).length;

        if (!multi.maxPlayers || count < multi.maxPlayers) return;

        try {
            const result = await runTransaction(ref(db, `rooms/${multi.roomId}/state`), (current) => {
                if (current === "waiting") return "playing";
                return;
            });

            if (result.committed) {
                // 自動開始トリガー
            }
        } catch (err) {
            console.warn("自動開始処理に失敗しました", err);
        }
    });
}

function renderRoomWaitPlayers(players) {
    roomWaitEls.players.innerHTML = "";
    Object.entries(players).forEach(([id, p]) => {
        const row = document.createElement("div");
        row.className = "room-player-row";
        row.textContent = id === multi.playerId ? `${p.name}（あなた）` : p.name;
        roomWaitEls.players.appendChild(row);
    });
}

// 【修正】離脱処理：リスナー解約を先に行うことで自分削除時のリスナー誤作動・フリーズを防ぎ、指定画面へ遷移
async function leaveRoom(targetScreen = "multiSetup") {
    const rId = multi.roomId;
    const pId = multi.playerId;

    // 1. まずリスナーを全て解約（自分自身の削除イベントに反応してフリーズするのを防ぐ）
    multiUnwatchAll();

    // 2. Firebaseから削除・更新
    if (rId && pId) {
        try {
            await remove(ref(db, `rooms/${rId}/players/${pId}`));
            await runTransaction(ref(db, `rooms/${rId}/playerCount`), (current) =>
                Math.max((current || 1) - 1, 0)
            );
        } catch (err) {
            console.warn("離脱処理中にエラーが発生しました:", err);
        }
    }

    // 3. 内部状態をクリア
    multi.roomId = null;
    multi.playerId = null;
    multi.maxPlayers = null;
    multi.lastPlayersData = {};
    currentRoundId = null;

    // 4. 画面を目的の画面へ戻す（待機画面から「やめる」なら multiSetup へ）
    showScreen(targetScreen);
}

roomWaitEls.leaveBtn.addEventListener("click", () => leaveRoom("multiSetup"));

let currentRoundId = null;
let currentRoundIsCorrectWord = false;
let lastProcessedWinnerId = null;
let currentWordId = null;
let wordShownAtLocal = 0;
let hasSubmittedTapForWord = false;

function enterMultiPlayScreen() {
    multi.penaltyUntil = 0;
    
    currentRoundId = null;
    lastProcessedWinnerId = null;
    currentWordId = null;
    hasSubmittedTapForWord = false;
    wordShownAtLocal = 0;
    
    resetFeedback(multiPlayEls.feedback, multiPlayEls.stage);
    multiPlayEls.penaltyText.textContent = "";

    if (multi.lastPlayersData) {
        renderMultiScoreboard(multiPlayEls.scoreboard, multi.lastPlayersData);
    }

    showScreen("multiPlay");
    updateMultiPenaltyDisplay();

    startCountdown(multiPlayEls.wordText, () => {
        if (multi.isHost) {
            startNextMultiScoreRound();
        }
    });
}

function updateMultiPenaltyDisplay() {
    if (!screens.multiPlay.classList.contains("is-active")) return;

    const now = Date.now();
    if (multi.penaltyUntil > now) {
        const remainingSec = ((multi.penaltyUntil - now) / 1000).toFixed(2);
        multiPlayEls.penaltyText.textContent = `お手つき！ペナルティ ${remainingSec}秒！`;
    } else {
        multiPlayEls.penaltyText.textContent = "";
    }

    multi.penaltyAnimFrameId = requestAnimationFrame(updateMultiPenaltyDisplay);
}

async function startNextMultiScoreRound() {
    if (!multi.roomId || !multi.isHost) return;
    const newLevel = Math.floor(Math.random() * 3) + 2;
    await set(ref(db, `rooms/${multi.roomId}/currentDifficulty`), newLevel);
    scheduleNextMultiWord(newLevel, true);
}

async function scheduleNextMultiWord(level, isNewRound = false) {
    if (!multi.roomId || !multi.isHost) return;

    if (multi.hostLoopTimeoutId) {
        window.clearTimeout(multi.hostLoopTimeoutId);
        multi.hostLoopTimeoutId = null;
    }

    const { word, isCorrect } = pickWord(level);
    const interval = pickInterval(level);
    const wordIdToSet = Date.now();

    try {
        const roundIdToSet = isNewRound ? wordIdToSet : (currentRoundId || wordIdToSet);

        if (isNewRound) {
            await set(ref(db, `rooms/${multi.roomId}/round`), {
                roundId: roundIdToSet,
                wordId: wordIdToSet,
                difficultyLevel: level,
                word: word,
                isCorrect: isCorrect,
                winnerId: null,
                winnerName: null,
                winners: null,
                updatedAt: Date.now()
            });
        } else {
            await runTransaction(ref(db, `rooms/${multi.roomId}/round`), (current) => {
                if (!current || current.winnerId || current.roundId !== roundIdToSet) return;
                return {
                    ...current,
                    wordId: wordIdToSet,
                    word: word,
                    isCorrect: isCorrect,
                    updatedAt: Date.now()
                };
            });
        }

        multi.hostLoopTimeoutId = window.setTimeout(async () => {
            let decided = false;
            if (isCorrect) {
                decided = await judgeCorrectWordTaps(roundIdToSet, wordIdToSet);
            }
            if (!decided) {
                scheduleNextMultiWord(level, false);
            }
        }, interval);

    } catch (err) {
        console.warn("マルチワード進行に失敗しました", err);
    }
}

async function judgeCorrectWordTaps(roundId, wordId) {
    if (!multi.roomId || !multi.isHost) return false;

    try {
        const tapsSnap = await get(ref(db, `rooms/${multi.roomId}/roundTaps/${wordId}`));
        const tapsData = tapsSnap.val();

        remove(ref(db, `rooms/${multi.roomId}/roundTaps/${wordId}`)).catch(() => {});

        if (!tapsData) return false;

        let bestTime = Infinity;
        Object.values(tapsData).forEach((ms) => {
            if (typeof ms === "number" && ms < bestTime) bestTime = ms;
        });

        const winnerIds = Object.entries(tapsData)
            .filter(([, ms]) => ms === bestTime)
            .map(([id]) => id);

        if (winnerIds.length === 0) return false;

        const playersSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
        const playersData = playersSnap.val() || {};

        const winners = winnerIds.map((id) => ({
            id,
            name: (playersData[id] && playersData[id].name) || "プレイヤー"
        }));

        await Promise.all(
            winnerIds.map((id) =>
                runTransaction(ref(db, `rooms/${multi.roomId}/players/${id}/score`), (current) => (current || 0) + 1)
            )
        );

        await runTransaction(ref(db, `rooms/${multi.roomId}/round`), (current) => {
            if (!current || current.winnerId || current.roundId !== roundId) return;
            return {
                ...current,
                winnerId: winners[0].id,
                winnerName: winners.map((w) => w.name).join("・"),
                winners: winners
            };
        });

        return true;
    } catch (err) {
        console.warn("判定処理に失敗しました", err);
        return false;
    }
}

function handleRoundUpdate(round) {
    if (!round) return;

    const isRoundChanged = round.roundId !== currentRoundId;
    if (isRoundChanged) {
        currentRoundId = round.roundId;
        lastProcessedWinnerId = null;
    }

    const settings = DIFFICULTY_SETTINGS[round.difficultyLevel] || DIFFICULTY_SETTINGS[2];
    multiPlayEls.difficultyBadge.textContent = settings.name;

    if (round.winnerId) {
        if (round.winnerId === lastProcessedWinnerId) return;
        lastProcessedWinnerId = round.winnerId;

        if (multi.hostLoopTimeoutId) {
            window.clearTimeout(multi.hostLoopTimeoutId);
            multi.hostLoopTimeoutId = null;
        }

        const winners = Array.isArray(round.winners) && round.winners.length > 0
            ? round.winners
            : [{ id: round.winnerId, name: round.winnerName || "相手" }];

        const amIWinner = winners.some((w) => w.id === multi.playerId);

        if (amIWinner) {
            playSound("correct");
            const label = winners.length > 1 ? "〇 せいかい！(同着)" : "〇 せいかい！";
            triggerFeedback(multiPlayEls.flash, multiPlayEls.feedback, multiPlayEls.stage, "good", label);
        } else {
            playSound("miss");
            const names = joinNames(winners.map((w) => w.name));
            triggerFeedback(
                multiPlayEls.flash,
                multiPlayEls.feedback,
                multiPlayEls.stage,
                "bad",
                `✕ ${names} にとられた！`
            );
        }

        if (multi.isHost) {
            window.setTimeout(async () => {
                const playersSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
                const playersData = playersSnap.val() || {};
                const hasWinner = Object.values(playersData).some((p) => (p.score || 0) >= WIN_SCORE);

                if (hasWinner) {
                    await set(ref(db, `rooms/${multi.roomId}/state`), "finished");
                } else {
                    startNextMultiScoreRound();
                }
            }, EFFECT_WAIT_MS);
        }
        return;
    }

    const isNewWord = round.wordId !== currentWordId;
    if (!isNewWord) return;

    currentWordId = round.wordId;
    currentRoundIsCorrectWord = !!round.isCorrect;
    hasSubmittedTapForWord = false;
    wordShownAtLocal = performance.now();

    const displayWord = round.word || CORRECT_WORD;

    setWordTextWithAnimation(multiPlayEls.wordText, displayWord);
    playSound("word");
}

function renderMultiScoreboard(targetEl, players) {
    if (!targetEl) return;
    targetEl.innerHTML = "";
    Object.entries(players)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0))
        .forEach(([id, p]) => {
            const pill = document.createElement("div");
            pill.className = "score-pill" + (id === multi.playerId ? " is-me" : "");
            pill.innerHTML = `<span>${escapeHtml(p.name)}</span><span class="score-value">${p.score || 0}</span>`;
            targetEl.appendChild(pill);
        });
}

multiPlayEls.wordBlob.addEventListener("click", async () => {
    if (!multi.roomId || !currentRoundId || !currentWordId) return;

    if (Date.now() < multi.penaltyUntil) return;

    const currentWordText = multiPlayEls.wordText.textContent;
    if (!currentWordText || currentWordText === "れでぃ？" || currentWordText === "ごー！") return;

    const isCorrectTap = currentRoundIsCorrectWord;

    if (!isCorrectTap) {
        setWordTextWithAnimation(multiPlayEls.wordText, "");
        multi.penaltyUntil = Date.now() + 5000;
        playSound("miss");
        triggerFeedback(multiPlayEls.flash, multiPlayEls.feedback, multiPlayEls.stage, "bad", "✕ お手つき！(5秒ストップ)");
        return;
    }

    if (hasSubmittedTapForWord) return;
    hasSubmittedTapForWord = true;

    const reactionMs = Math.max(0, Math.round(performance.now() - wordShownAtLocal));
    const wordIdAtTap = currentWordId;

    triggerFeedback(multiPlayEls.flash, multiPlayEls.feedback, multiPlayEls.stage, "pending", "⏳ はんてい中…");

    try {
        await set(ref(db, `rooms/${multi.roomId}/roundTaps/${wordIdAtTap}/${multi.playerId}`), reactionMs);
    } catch (err) {
        console.warn("反応時間の送信に失敗しました", err);
    }
});

// ========================================
// リザルト画面＆再戦（待機・10秒タイマー・離脱連携）
// ========================================

function computeCompetitionRanks(sortedPlayers) {
    const ranks = [];
    let prevScore = null;
    let prevRank = 0;
    sortedPlayers.forEach(([, p], idx) => {
        const score = p.score || 0;
        if (prevScore === null || score !== prevScore) {
            prevRank = idx + 1;
            prevScore = score;
        }
        ranks.push(prevRank);
    });
    return ranks;
}

function enterMultiResultScreen() {
    playSound("win");

    multiResultEls.ranking.innerHTML = "";
    const sortedPlayers = Object.entries(multi.lastPlayersData)
        .sort((a, b) => (b[1].score || 0) - (a[1].score || 0));

    const ranks = computeCompetitionRanks(sortedPlayers);
    const topWinners = sortedPlayers.filter((_, idx) => ranks[idx] === 1);

    if (topWinners.length === 1) {
        const [winnerId, winnerData] = topWinners[0];
        multiResultEls.title.textContent =
            winnerId === multi.playerId ? "🎉 あなたの勝ち！" : `🎉 ${winnerData.name} の勝ち！`;
    } else if (topWinners.length > 1) {
        const names = topWinners.map(([id, p]) => (id === multi.playerId ? "あなた" : p.name));
        multiResultEls.title.textContent = `🎉 ${joinNames(names)}の引き分け！`;
    } else {
        multiResultEls.title.textContent = "けっか発表！";
    }

    sortedPlayers.forEach(([id, p], idx) => {
        const li = document.createElement("li");
        if (ranks[idx] === 1) li.classList.add("rank-1");
        const isMe = id === multi.playerId ? "（あなた）" : "";
        li.innerHTML = `
            <span>${ranks[idx]}位: ${escapeHtml(p.name)}${isMe}</span>
            <span class="res-score">${p.score || 0}pt</span>
        `;
        multiResultEls.ranking.appendChild(li);
    });

    if (multi.roomId && multi.playerId) {
        set(ref(db, `rooms/${multi.roomId}/players/${multi.playerId}/ready`), false);
    }

    showScreen("multiResult");
    updateRetryButtonUI(false, 0);

    attachResultRoomWatcher();
}

function updateRetryButtonUI(isReady, remainingSec) {
    if (isReady) {
        multiResultEls.retryBtn.textContent = `キャンセル (待機中 ${remainingSec}s)`;
        multiResultEls.retryBtn.classList.remove("btn-main");
        multiResultEls.retryBtn.classList.add("btn-sub-wide");
    } else {
        multiResultEls.retryBtn.textContent = "もう一度あそぶ";
        multiResultEls.retryBtn.classList.remove("btn-sub-wide");
        multiResultEls.retryBtn.classList.add("btn-main");
    }
}

function attachResultRoomWatcher() {
    multiUnwatchAll();

    // プレイヤー変更監視
    multiWatch(`rooms/${multi.roomId}/players`, async (snapshot) => {
        const players = snapshot.val() || {};
        const playerKeys = Object.keys(players);

        if (playerKeys.length === 0 || (playerKeys.length === 1 && playerKeys[0] !== multi.playerId)) {
            leaveRoom("multiSetup");
            return;
        }

        multi.lastPlayersData = { ...players };
        checkAndUpdateHost(players);

        const allReady = playerKeys.length > 0 && playerKeys.every(k => players[k].ready === true);
        if (allReady && multi.isHost) {
            startMultiGameAgain();
        }
    });

    // タイマー監視（10秒タイマーカウントダウン）
    multiWatch(`rooms/${multi.roomId}/retryTimerEnd`, (snapshot) => {
        const timerEnd = snapshot.val();
        
        if (multi.retryIntervalId) {
            window.clearInterval(multi.retryIntervalId);
            multi.retryIntervalId = null;
        }

        if (!timerEnd) {
            const me = multi.lastPlayersData[multi.playerId];
            updateRetryButtonUI(me?.ready || false, 0);
            return;
        }

        multi.retryIntervalId = window.setInterval(async () => {
            const now = Date.now();
            const remaining = Math.max(0, Math.ceil((timerEnd - now) / 1000));
            const me = multi.lastPlayersData[multi.playerId];

            if (me?.ready) {
                updateRetryButtonUI(true, remaining);
            } else {
                updateRetryButtonUI(false, 0);
            }

            if (remaining <= 0) {
                window.clearInterval(multi.retryIntervalId);
                multi.retryIntervalId = null;

                if (multi.isHost) {
                    const playersSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
                    const players = playersSnap.val() || {};
                    
                    let kickedCount = 0;
                    for (const [pId, pData] of Object.entries(players)) {
                        if (!pData.ready) {
                            await remove(ref(db, `rooms/${multi.roomId}/players/${pId}`));
                            kickedCount++;
                        }
                    }

                    if (kickedCount > 0) {
                        await runTransaction(ref(db, `rooms/${multi.roomId}/playerCount`), (current) =>
                            Math.max(0, (current || 1) - kickedCount)
                        );
                    }

                    const updatedSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
                    const updatedPlayers = updatedSnap.val() || {};
                    if (Object.keys(updatedPlayers).length > 0) {
                        startMultiGameAgain();
                    }
                }
            }
        }, 200);

        multi.listeners.push({
            ref: null,
            callback: () => {
                if (multi.retryIntervalId) {
                    window.clearInterval(multi.retryIntervalId);
                    multi.retryIntervalId = null;
                }
            }
        });
    });
}

// 「もう一度あそぶ」/「キャンセル」トグルイベント
multiResultEls.retryBtn.addEventListener("click", async () => {
    if (!multi.roomId || !multi.playerId) return;

    const me = multi.lastPlayersData[multi.playerId];
    const isCurrentlyReady = me?.ready || false;
    const nextReadyState = !isCurrentlyReady;

    try {
        await set(ref(db, `rooms/${multi.roomId}/players/${multi.playerId}/ready`), nextReadyState);

        const timerSnap = await get(ref(db, `rooms/${multi.roomId}/retryTimerEnd`));
        if (nextReadyState && !timerSnap.val()) {
            const endTime = Date.now() + 10000;
            await set(ref(db, `rooms/${multi.roomId}/retryTimerEnd`), endTime);
        } else if (!nextReadyState) {
            const playersSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
            const players = playersSnap.val() || {};
            const anyReady = Object.entries(players).some(([id, p]) => p.ready && id !== multi.playerId);
            if (!anyReady) {
                await remove(ref(db, `rooms/${multi.roomId}/retryTimerEnd`));
            }
        }
    } catch (err) {
        console.warn("再戦状態更新に失敗しました", err);
    }
});

async function startMultiGameAgain() {
    if (!multi.roomId) return;
    try {
        await remove(ref(db, `rooms/${multi.roomId}/retryTimerEnd`));
        const playersSnap = await get(ref(db, `rooms/${multi.roomId}/players`));
        const players = playersSnap.val() || {};

        for (const pId of Object.keys(players)) {
            await set(ref(db, `rooms/${multi.roomId}/players/${pId}/score`), 0);
            await set(ref(db, `rooms/${multi.roomId}/players/${pId}/ready`), false);
        }

        await set(ref(db, `rooms/${multi.roomId}/state`), "playing");
    } catch (err) {
        console.warn("再戦スタートに失敗しました", err);
    }
}

multiResultEls.toTitleBtn.addEventListener("click", () => leaveRoom("title"));

// ========================================
// 初期化
// ========================================

function applyRoomIdFromUrl() {
    const params = new URLSearchParams(location.search);
    const roomIdFromUrl = params.get("room");
    if (!roomIdFromUrl) return;

    const normalized = roomIdFromUrl.trim().toUpperCase().slice(0, 6);

    multiSetupEls.errorText.classList.add("is-hidden");
    const stored = getStoredPlayerName();
    if (stored) multiSetupEls.nameInput.value = stored;
    multiSetupEls.roomIdInput.value = normalized;
    showScreen("multiSetup");

    const cleanUrl = location.origin + location.pathname;
    history.replaceState(null, "", cleanUrl);
}

function init() {
    console.log("うんちスピードスター initialized");
    showScreen("title");
    applyRoomIdFromUrl();
}

document.addEventListener("DOMContentLoaded", init);