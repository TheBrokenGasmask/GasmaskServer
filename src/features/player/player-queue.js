const {updateGuild, getPlayers, updateUsername} = require("../../core/database");
let playerQueue = [];
let isProcessing = false;

function processQueue() {
    if (isProcessing || playerQueue.length === 0) return;

    isProcessing = true;
    const uuid = playerQueue.shift();

    updateGuild(uuid)
        .then(() => updateUsername(uuid))
        .then(() => {
            isProcessing = false;
            playerQueue.push(uuid);
        });
}

function addPlayerToQueue(uuid) {
    playerQueue.push(uuid);
}

function initQueue() {
    setInterval(processQueue, 10000);

    getPlayers().then(players => {
        players.forEach(player => {
            addPlayerToQueue(player.uuid);
        })
    });
}

module.exports = {initQueue};