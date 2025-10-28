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

        try {
            if (!await getMemberByUuid(uuid)) {
                return res.status(403).send("Player is not in the guild");
            }

            const existingToken = getToken(uuid);
            if (existingToken && existingToken.isAuthenticated() && existingToken.getAge() < 60 * 60 * 1000) {
                return res.status(200).send(existingToken.serverId || 'existing-session');
            }

            // Always remove old token before creating new one
            if (existingToken) {
                removeToken(uuid);
            }

            const tokens = generateTokenWithServerId(uuid);
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
            
            request({
                url: url,
                timeout: 10000
            }, async (error, response, body) => {
                try {
                    if (!error && response.statusCode === 200) {
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
                        this.retryAuthentication(uuid, serverId, retry, attempt);
                    }
                } catch (processError) {
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
            setTimeout(async () => {
                await this.checkForAuthentication(uuid, serverId, retry, attempt + 1);
            }, RETRY_DELAY);
        } else {
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