const request = require('request');
const { config } = require("../../core/config");

function getWynnGuild() {
    return new Promise((resolve, reject) => {
        const makeRequest = (retries = 3) => {
            const options = {
                method: 'GET',
                url: `https://api.wynncraft.com/v3/guild/prefix/${config.get("guild-tag")}?identifier=uuid`,
                headers: {
                    Authorization: `Bearer ${config.get("wynncraft-token")}`
                },
                timeout: 10000,
                json: true,
                forever: false,
                pool: {maxSockets: 100}
            };

            request(options, function (error, response, body) {
                if (error) {
                    console.error('WynnAPI network error:', error.message);

                    // Retry on network errors
                    if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
                        console.log(`Retrying guild request after error (${retries} retries left)`);
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }

                    return reject(new Error(`WynnAPI network error: ${error.message}`));
                }

                if (response.statusCode !== 200) {
                    console.error(`WynnAPI request failed: Status ${response.statusCode}, Body:`, body);

                    if (retries > 0 && response.statusCode >= 500) {
                        console.log(`Retrying guild request after ${response.statusCode} (${retries} retries left)`);
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }

                    return reject(new Error(`WynnAPI request failed: Status ${response.statusCode}`));
                }

                resolve(body);
            });
        };

        makeRequest();
    });
}

function getWynnUser(uuid) {
    return new Promise((resolve, reject) => {
        const makeRequest = (retries = 3) => {
            const options = {
                method: 'GET',
                url: `https://api.wynncraft.com/v3/player/${uuid}`,
                headers: {
                    Authorization: `Bearer ${config.get("wynncraft-token")}`
                },
                timeout: 10000,
                json: true,
                forever: false,
                pool: {maxSockets: 100}
            };

            request(options, function (error, response, body) {
                if (error) {
                    console.error('WynnAPI network error:', error.message);

                    if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
                        console.log(`Retrying user request after error (${retries} retries left)`);
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }

                    return reject(new Error(`WynnAPI network error: ${error.message}`));
                }

                if (response.statusCode !== 200) {
                    console.error(`WynnAPI request failed: Status ${response.statusCode}, Body:`, body);

                    if (retries > 0 && response.statusCode >= 500) {
                        console.log(`Retrying user request after ${response.statusCode} (${retries} retries left)`);
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }

                    return reject(new Error(`WynnAPI request failed: Status ${response.statusCode}`));
                }

                resolve(body);
            });
        };

        makeRequest();
    });
}

function getGuildRank(uuid) {
    return new Promise((resolve, reject) => {
        getWynnUser(uuid).then((wynnUser) => {
            if (!wynnUser.guild || wynnUser.guild === "NULL") {
                resolve(0);
                return;
            }
            resolve(wynnUser.guild.rankStars.length);
        }).catch(error => {
            console.error('Error getting guild rank:', error);
            reject(error);
        });
    });
}

async function getPlayerGuild(uuid) {
    try {
        let player = await getWynnUser(uuid);
        if (!player.guild || player.guild === "NULL") return null;
        return player.guild.prefix;
    } catch (error) {
        console.error('Error fetching player guild:', error);
        return null;
    }
}

async function getPlayerGuildInfo(uuid) {
    console.log(`[getPlayerGuildInfo] Called for ${uuid}`);
    console.trace(); // ✅ prints the full call stack
    try {
        let player = await getWynnUser(uuid);
        if (!player.guild || player.guild === "NULL") return { guild: null, guildRank: null };

        const guildPrefix = player.guild.prefix;
        let guildRank = null;

        if (guildPrefix === config.get("guild-tag")) {
            guildRank = player.guild.rankStars ? player.guild.rankStars.length : 0;
        }

        return { guild: guildPrefix, guildRank };
    } catch (error) {
        console.error('Error fetching player guild info:', error);
        return { guild: null, guildRank: null };
    }
}

async function isPlayerInGuild(uuid) {
    try {
        let player = await getWynnUser(uuid);
        let guild = player.guild;

        if (!guild || guild === "NULL") return false;

        return guild.prefix === config.get("guild-tag");
    } catch (error) {
        console.error('Error checking if player is in guild:', error);
        return false;
    }
}

function getTerritoryList() {
    return new Promise((resolve, reject) => {
        const makeRequest = (retries = 3) => {
            const options = {
                method: 'GET',
                url: 'https://api.wynncraft.com/v3/guild/list/territory',
                headers: {
                    Authorization: `Bearer ${config.get("wynncraft-token")}`
                },
                timeout: 10000,
                json: true,
                forever: false,
                pool: {maxSockets: 100}
            };

            request(options, (error, response, body) => {
                if (error) {
                    console.error('Territory list fetch failed:', error.message);
                    if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }
                    return reject(new Error(`Territory list API failed: ${error.message}`));
                }

                if (response.statusCode !== 200) {
                    console.error(`Territory list API returned ${response.statusCode}`);
                    if (retries > 0 && response.statusCode >= 500) {
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }
                    return reject(new Error(`Territory list API: Status ${response.statusCode}`));
                }

                resolve(body);
            });
        };

        makeRequest();
    });
}

function getWynnUserFull(uuid) {
    return new Promise((resolve, reject) => {
        const makeRequest = (retries = 3) => {
            const token = config.get("wynncraft-token");
            const url = `https://api.wynncraft.com/v3/player/${uuid}?fullResult`;

            const options = {
                method: 'GET',
                url,
                // Only include auth header if token is actually set
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                timeout: 10000,
                json: true,
                forever: false,
                pool: { maxSockets: 100 }
            };

            request(options, function (error, response, body) {
                if (error) {
                    if (retries > 0 && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }
                    return reject(new Error(`WynnAPI network error: ${error.message}`));
                }

                // ✅ 404 check must come BEFORE the generic statusCode !== 200 check
                if (response.statusCode === 404) {
                    const err = new Error(`Player not found on Wynncraft: ${uuid}`);
                    err.type = 'NOT_FOUND';
                    return reject(err);
                }

                if (response.statusCode >= 500) {
                    if (retries > 0) {
                        return setTimeout(() => makeRequest(retries - 1), 1000);
                    }
                    return reject(new Error(`WynnAPI server error: ${response.statusCode}`));
                }

                if (response.statusCode !== 200) {
                    return reject(new Error(`WynnAPI unexpected status: ${response.statusCode}`));
                }

                resolve(body);
            });
        };
        makeRequest();
    });
}

module.exports = { getGuildRank, isPlayerInGuild, getPlayerGuild, getPlayerGuildInfo, getWynnGuild, getWynnUser, getWynnUserFull, getTerritoryList };