const {getToken} = require("../auth/authentication");
const {insertRaid, getPlayerUUID, insertPlayer} = require("../../core/database");
const {requestUUID} = require("../../core/utilities");
const {getMemberByUuid} = require('../player/guild-cache');
const {sendRaidEmbed} = require("./raid-message");
const { config } = require("../../core/config");

class RaidReportService {
    constructor() {
        this.recentRaids = new Map();
        this.raidCache = new Map();
        this.raidLocks = new Map();
        this.raidData = new Map();
        this.cacheExpiry = 45000;
        this.cleanupInterval = 90000;
        this.minClientThreshold = 1;
        this.processingTimeouts = new Map();

        this.startCleanup();
    }

    generateReportKey(player1, player2, player3, player4, raid, time = null) {
        return `${player1}:${player2}:${player3}:${player4}:${raid}${time ? ':' + time : ''}`;
    }

    generateBaseKey(player1, player2, player3, player4, raid) {
        return `${player1}:${player2}:${player3}:${player4}:${raid}`;
    }

    generateRaidHash(reportKey) {
        return reportKey.split(':').slice(0, 5).join(':');
    }

    async processRaidSafely(reportKey, client) {
        const hash = this.generateRaidHash(reportKey);

        if (this.raidLocks.has(hash)) {
            await this.raidLocks.get(hash);
        }

        let resolveLock;
        const lockPromise = new Promise(resolve => { resolveLock = resolve; });
        this.raidLocks.set(hash, lockPromise);

        try {
            return await this._processRaidInternal(hash, reportKey, client);
        } finally {
            this.raidLocks.delete(hash);
            resolveLock();
        }
    }

    scheduleProcessing(hash, reportKey, delay) {
        if (this.processingTimeouts.has(hash)) {
            clearTimeout(this.processingTimeouts.get(hash));
        }

        const timeout = setTimeout(async () => {
            this.processingTimeouts.delete(hash);

            const data = this.raidData.get(hash);
            if (data && data.status === 'pending' && data.thresholdMet) {
                const now = Date.now();
                const waitTime = now - data.thresholdMet;

                if (waitTime >= 2000) {
                    data.status = 'processed';

                    const parts = hash.split(':');
                    const [player1, player2, player3, player4, raid] = parts;

                    const finalReportKey = data.timeReport || reportKey;
                    const reportParts = finalReportKey.split(':');
                    const time = reportParts.length > 5 ? reportParts[5] : null;

                    try {
                        await this.processRaidReport(
                            raid,
                            player1,
                            player2,
                            player3,
                            player4,
                            data.seasonRating || 0,
                            data.guildXP,
                            data.reporter,
                            time
                        );
                    } catch (error) {
                        console.error(`Error auto-processing raid:`, error);
                    }
                }
            }
        }, delay);

        this.processingTimeouts.set(hash, timeout);
    }

    async _processRaidInternal(hash, reportKey, client) {
        const now = Date.now();
        const TIME_WAIT = 2000;

        if (!this.raidData.has(hash)) {
            this.raidData.set(hash, {
                status: 'pending',
                count: 0,
                clients: new Set(),
                firstSeen: now,
                timeReport: null,
                thresholdMet: null,
                seasonRating: null,
                guildXP: null,
                reporter: null
            });
        }

        const data = this.raidData.get(hash);

        if (now - data.firstSeen > this.cacheExpiry) {
            if (this.processingTimeouts.has(hash)) {
                clearTimeout(this.processingTimeouts.get(hash));
                this.processingTimeouts.delete(hash);
            }
            data.status = 'pending';
            data.count = 0;
            data.clients.clear();
            data.firstSeen = now;
            data.timeReport = null;
            data.thresholdMet = null;
        }

        if (data.status === 'processed') {
            return { shouldProcess: false, isDuplicate: true };
        }

        const hasTime = reportKey.split(':').length > 5;
        if (hasTime) {
            data.timeReport = reportKey;
        }

        if (!data.clients.has(client)) {
            data.clients.add(client);
            data.count++;
        }

        const threshold = config.get("minimum-client-threshold");

        if (data.count >= threshold && !data.thresholdMet) {
            data.thresholdMet = now;
            this.scheduleProcessing(hash, reportKey, TIME_WAIT + 100);
        }

        if (data.thresholdMet) {
            const waitTime = now - data.thresholdMet;

            if (waitTime > TIME_WAIT) {
                data.status = 'processed';

                if (this.processingTimeouts.has(hash)) {
                    clearTimeout(this.processingTimeouts.get(hash));
                    this.processingTimeouts.delete(hash);
                }

                return {
                    shouldProcess: true,
                    isDuplicate: false,
                    reportKey: data.timeReport || reportKey,
                    seasonRating: data.seasonRating,
                    guildXP: data.guildXP,
                    reporter: data.reporter
                };
            }
        }

        if (!data.seasonRating && client.packet?.data?.seasonRating) {
            data.seasonRating = client.packet.data.seasonRating;
        }
        if (!data.guildXP && client.packet?.data?.guildXP) {
            data.guildXP = client.packet.data.guildXP;
        }
        if (!data.reporter && client.packet?.data?.reporter) {
            data.reporter = client.packet.data.reporter;
        }

        return { shouldProcess: false, isDuplicate: false };
    }

    async handleRaidReport(client, packet) {
        let { raid, player1, player2, player3, player4, reporter, seasonRating, guildXP, durationSeconds } = packet.data;

        if (!raid || !player1 || !player2 || !player3 || !player4 || !guildXP) {
            console.warn(`Invalid raid report packet: missing required fields from client ${client.uuid}`);
            return null;
        }

        if (!seasonRating) seasonRating = 0;

        const baseKey = this.generateBaseKey(player1, player2, player3, player4, raid);
        const reportKey = this.generateReportKey(player1, player2, player3, player4, raid, durationSeconds);

        client.packet = packet;

        const result = await this.processRaidSafely(reportKey, client);

        if (!result.shouldProcess) {
            if (result.isDuplicate) {
                console.log(`Duplicate raid filtered: ${baseKey}`);
            }
            return null;
        }

        const finalReportKey = result.reportKey || reportKey;
        const [finalRaid, p1, p2, p3, p4, finalTime] = finalReportKey.split(':');

        await this.processRaidReport(
            finalRaid,
            p1,
            p2,
            p3,
            p4,
            result.seasonRating || seasonRating,
            result.guildXP || guildXP,
            result.reporter || reporter,
            finalTime
        );

        return {
            type: 'raid_report_ack',
            data: {
                success: true,
                timestamp: Date.now()
            }
        };
    }

    async processRaidReport(raid, player1, player2, player3, player4, seasonRating, guildXP, reporter, time = null) {
        const players = [player1, player2, player3, player4];
        const resolvedUUIDs = [];

        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            let uuid = await getPlayerUUID(player);

            if (!uuid) {
                uuid = await requestUUID(player);
            }

            if (!uuid) {
                throw new Error(`Invalid player: ${player}`);
            }

            if (!await getMemberByUuid(uuid)) {
                console.log(`Player ${player} is not in guild, aborting raid report`);
                throw new Error(`Invalid player: ${player}`);
            }

            resolvedUUIDs[i] = uuid;
        }

        console.log(`Processing raid report: ${raid} with players [${players.join(', ')}] reported by ${reporter}${time ? ' at ' + time : ''}`);

        console.log(`Raid Report Log: raid - ${raid} players - ${resolvedUUIDs[0]} ${resolvedUUIDs[1]} ${resolvedUUIDs[2]} ${resolvedUUIDs[3]} reporter - ${reporter} season rating - ${seasonRating} guild XP - ${guildXP}${time ? ' time - ' + time : ''}`);
        await insertRaid(raid, resolvedUUIDs[0], resolvedUUIDs[1], resolvedUUIDs[2], resolvedUUIDs[3], reporter, seasonRating, guildXP, time);

        try {
            console.log(`Sent Discord notification for raid: ${raid}`);
            await sendRaidEmbed(raid, player1, player2, player3, player4, time);
        } catch (error) {
            console.error(`Failed to send Discord notification for raid ${raid}:`, error);
        }

        console.log(`Successfully reported raid: ${raid} with players [${players.join(', ')}] reported by ${reporter}`);
    }

    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredHashes = [];

            for (const [hash, data] of this.raidData.entries()) {
                if (now - data.firstSeen > this.cacheExpiry) {
                    expiredHashes.push(hash);
                    if (this.processingTimeouts.has(hash)) {
                        clearTimeout(this.processingTimeouts.get(hash));
                        this.processingTimeouts.delete(hash);
                    }
                }
            }

            expiredHashes.forEach(hash => {
                this.raidData.delete(hash);
            });

            if (expiredHashes.length > 0) {
                console.log(`Cleaned up ${expiredHashes.length} expired raid entries`);
            }
        }, this.cleanupInterval);
    }

    getStats() {
        return {
            recentRaidsCount: this.recentRaids.size,
            raidDataCount: this.raidData.size,
            activeLocks: this.raidLocks.size,
            pendingTimeouts: this.processingTimeouts.size,
            cacheExpiry: this.cacheExpiry,
            cleanupInterval: this.cleanupInterval
        };
    }
}

const raidReport = new RaidReportService();

module.exports = { RaidReportService, raidReport };