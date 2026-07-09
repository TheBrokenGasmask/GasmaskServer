const {getMemberByUuid} = require('../player/guild-cache')
const {generateTokenWithServerId, getToken, removeToken, authenticateServerId} = require("./authentication");
const {sleep} = require("../../core/utilities");
const request = require('request');
const {getPlayerUsername, insertPlayer} = require("../../core/database");
const { config } = require("../../core/config");

class AuthenticateEndpoint {

    async call(req, res) {
        if (!req.query.uuid) return res.status(400).send("Missing parameters");
        let {uuid} = req.query;

        console.log(`[Auth] Authentication endpoint called for UUID: ${uuid}`);

        try {
            if (!await getMemberByUuid(uuid)) {
                console.log(`[Auth] Player ${uuid} is not in the guild - rejecting`);
                return res.status(403).send("Player is not in the guild");
            }

            const existingToken = getToken(uuid);
            if (existingToken) {
                const age = existingToken.getAge();
                if (age > 60 * 60 * 1000 || !existingToken.isAuthenticated()) {
                    removeToken(uuid);
                } else {
                    return res.status(200).send(existingToken.serverId || 'existing-session');
                }
            }

            const tokens = generateTokenWithServerId(uuid);
            console.log(`[Auth] Generated new serverId for ${uuid}, starting Mojang verification`);
            res.status(200).send(tokens.serverId);

            await sleep(2000);
            await this.checkForAuthentication(uuid, tokens.serverId);

        } catch (error) {
            console.error(`Authentication endpoint error for UUID ${uuid}:`, error);
            res.status(500).send("Internal server error");
        }
    }

    async checkForAuthentication(uuid, serverId, retry = false, attempt = 1) {
        const MAX_ATTEMPTS = 3;
        const RETRY_DELAY = 5000;

        try {
            let username = retry ? await this.getUsername(uuid) : await getPlayerUsername(uuid);
            
            if (!retry && !username) {
                await this.checkForAuthentication(uuid, serverId, true, attempt);
                return;
            }

            if (!username) {
                return;
            }

            const url = `https://sessionserver.mojang.com/session/minecraft/hasJoined?username=${username}&serverId=${serverId}`;

            console.log(`[Auth] Checking Mojang authentication for ${username} (${uuid}), attempt ${attempt}/${MAX_ATTEMPTS}`);

            request({
                url: url,
                timeout: 10000
            }, async (error, response, body) => {
                try {
                    if (!error && response.statusCode === 200) {
                        console.log(`[Auth] Mojang auth successful for ${username}`);
                        let authData;
                        try {
                            authData = JSON.parse(body);
                        } catch (parseError) {
                            this.retryAuthentication(uuid, serverId, retry, attempt);
                            return;
                        }

                        if (!authData.id || !authData.name) {
                            this.retryAuthentication(uuid, serverId, retry, attempt);
                            return;
                        }

                        const responseUuid = authData.id.replace(/-/g, '').toLowerCase();
                        const expectedUuid = uuid.replace(/-/g, '').toLowerCase();
                        
                        if (responseUuid !== expectedUuid) {
                            this.retryAuthentication(uuid, serverId, retry, attempt);
                            return;
                        }

                        if (authenticateServerId(serverId)) {
                            try {
                                const { wsManager } = require('../websocket/websocket');
                                wsManager.sendToUuid(uuid, 'authentication_success', {
                                    message: 'Authentication completed successfully',
                                    username: authData.name,
                                    timestamp: new Date().toISOString()
                                });
                            } catch (wsError) {
                                // WebSocket manager not available
                            }
                        }
                    } else {
                        console.log(`[Auth] Mojang auth failed for ${username}: status=${response?.statusCode}, error=${error?.message || 'none'}`);
                        this.retryAuthentication(uuid, serverId, retry, attempt);
                    }
                } catch (processError) {
                    console.log(`[Auth] Error processing Mojang response for ${username}:`, processError.message);
                    this.retryAuthentication(uuid, serverId, retry, attempt);
                }
            });
            
        } catch (error) {
            if (attempt >= MAX_ATTEMPTS) {
                removeToken(uuid);
            }
        }
    }

    retryAuthentication(uuid, serverId, retry, attempt) {
        const MAX_ATTEMPTS = 3;
        const RETRY_DELAY = 5000;

        if (attempt < MAX_ATTEMPTS) {
            console.log(`[Auth] Retrying Mojang auth for ${uuid} in ${RETRY_DELAY}ms (attempt ${attempt + 1}/${MAX_ATTEMPTS})`);
            setTimeout(async () => {
                await this.checkForAuthentication(uuid, serverId, retry, attempt + 1);
            }, RETRY_DELAY);
        } else {
            console.log(`[Auth] Max authentication attempts reached for ${uuid}, removing token`);
            removeToken(uuid);
        }
    }

    async getUsername(uuid) {
        return new Promise((resolve) => {
            const url = `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`;
            
            request({
                url: url,
                timeout: 10000
            }, function (error, response, body) {
                if (!error && response.statusCode === 200) {
                    try {
                        let data = JSON.parse(body);
                        
                        if (data && data.name) {
                            insertPlayer(uuid, data.name).catch(() => {});
                            resolve(data.name);
                        } else {
                            resolve(null);
                        }
                    } catch (parseError) {
                        resolve(null);
                    }
                } else {
                    resolve(null);
                }
            });
        });
    }
}

module.exports = { AuthenticateEndpoint }