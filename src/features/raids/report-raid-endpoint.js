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
        console.log('[RaidReport] Service initialized');
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
        console.log(`[RaidReport] Processing raid safely - hash: ${hash}, client: ${client.uuid}`);

        if (this.raidLocks.has(hash)) {
            console.log(`[RaidReport] Lock exists for ${hash}, waiting...`);
            await this.raidLocks.get(hash);
            console.log(`[RaidReport] Lock released for ${hash}`);
        }

        let resolveLock;
        const lockPromise = new Promise(resolve => { resolveLock = resolve; });
        this.raidLocks.set(hash, lockPromise);
        console.log(`[RaidReport] Lock acquired for ${hash}`);

        try {
            return await this._processRaidInternal(hash, reportKey, client);
        } finally {
            this.raidLocks.delete(hash);
            resolveLock();
            console.log(`[RaidReport] Lock cleaned up for ${hash}`);
        }
    }

    scheduleProcessing(hash, reportKey, delay) {
        // Clear any existing timeout for this hash
        if (this.processingTimeouts.has(hash)) {
            clearTimeout(this.processingTimeouts.get(hash));
        }

        console.log(`[RaidReport] ⏰ Scheduling processing for ${hash} in ${delay}ms`);

        const timeout = setTimeout(async () => {
            console.log(`[RaidReport] ⏰ Timer fired for ${hash}, checking if ready to process`);
            this.processingTimeouts.delete(hash);

            // Process the raid if it still exists and is ready
            const data = this.raidData.get(hash);
            if (data && data.status === 'pending' && data.thresholdMet) {
                const now = Date.now();
                const waitTime = now - data.thresholdMet;

                if (waitTime >= 2000) {
                    console.log(`[RaidReport] 🚀 Auto-processing raid ${hash} after timer`);
                    data.status = 'processed';

                    // Extract raid info from hash
                    const parts = hash.split(':');
                    const [player1, player2, player3, player4, raid] = parts;
                    const finalReportKey = data.timeReport || reportKey;
                    const reportParts = finalReportKey.split(':');
                    const time = reportParts[5] || null;

                    try {
                        // Get the original data
                        const originalData = this.raidData.get(hash);
                        await this.processRaidReport(
                            raid,
                            player1,
                            player2,
                            player3,
                            player4,
                            originalData.seasonRating || 0,
                            originalData.guildXP,
                            originalData.reporter,
                            time
                        );
                        console.log(`[RaidReport] ✅ Auto-processing completed for ${hash}`);
                    } catch (error) {
                        console.error(`[RaidReport] ❌ Error auto-processing raid:`, error);
                    }
                }
            }
        }, delay);

        this.processingTimeouts.set(hash, timeout);
    }

    async _processRaidInternal(hash, reportKey, client) {
        const now = Date.now();
        const TIME_WAIT = 2000;

        console.log(`[RaidReport] Internal processing - hash: ${hash}, reportKey: ${reportKey}`);

        if (!this.raidData.has(hash)) {
            console.log(`[RaidReport] Creating new raid data entry for ${hash}`);
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
        console.log(`[RaidReport] Current data state:`, {
            hash,
            status: data.status,
            count: data.count,
            clientsCount: data.clients.size,
            age: now - data.firstSeen,
            hasTime: data.timeReport !== null,
            thresholdMet: data.thresholdMet !== null
        });

        if (now - data.firstSeen > this.cacheExpiry) {
            console.log(`[RaidReport] Cache expired for ${hash}, resetting`);
            // Clear any pending timeout
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
            console.log(`[RaidReport] Raid already processed: ${hash}`);
            return { shouldProcess: false, isDuplicate: true };
        }

        const hasTime = reportKey.split(':').length > 5;
        if (hasTime) {
            console.log(`[RaidReport] Report has time field, storing: ${reportKey}`);
            data.timeReport = reportKey;
        }

        if (!data.clients.has(client)) {
            data.clients.add(client);
            data.count++;
            console.log(`[RaidReport] New client added. Count: ${data.count}, Client: ${client.uuid}`);
        } else {
            console.log(`[RaidReport] Duplicate client report ignored: ${client.uuid}`);
        }

        const threshold = config.get("minimum-client-threshold");
        console.log(`[RaidReport] Threshold check - current: ${data.count}, required: ${threshold}`);

        if (data.count >= threshold && !data.thresholdMet) {
            data.thresholdMet = now;
            console.log(`[RaidReport] Threshold met for ${hash} at ${now}`);

            // Schedule automatic processing after TIME_WAIT
            this.scheduleProcessing(hash, reportKey, TIME_WAIT + 100);
        }

        if (data.thresholdMet) {
            const waitTime = now - data.thresholdMet;
            console.log(`[RaidReport] Threshold met ${waitTime}ms ago, TIME_WAIT: ${TIME_WAIT}ms`);

            if (waitTime > TIME_WAIT) {
                console.log(`[RaidReport] ✅ Processing raid ${hash} - time wait satisfied`);
                data.status = 'processed';

                // Clear the scheduled timeout since we're processing now
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
            } else {
                console.log(`[RaidReport] ⏳ Waiting ${TIME_WAIT - waitTime}ms more for ${hash}`);
            }
        } else {
            console.log(`[RaidReport] ⏳ Threshold not yet met for ${hash}`);
        }

        // Store data for potential auto-processing
        if (!data.seasonRating && client.packet?.data?.seasonRating) {
            data.seasonRating = client.packet.data.seasonRating;
        }
        if (!data.guildXP && client.packet?.data?.guildXP) {
            data.guildXP = client.packet.data.guildXP;
        }
        if (!data.reporter && client.packet?.data?.reporter) {
            data.reporter = client.packet.data.reporter;
        }

        // Still waiting for time fields or threshold not met
        return { shouldProcess: false, isDuplicate: false };
    }

    async handleRaidReport(client, packet) {
        console.log(`[RaidReport] ====== NEW RAID REPORT RECEIVED ======`);
        console.log(`[RaidReport] Client: ${client.uuid}`);
        console.log(`[RaidReport] Packet data:`, packet.data);

        let { raid, player1, player2, player3, player4, reporter, seasonRating, guildXP, duration } = packet.data;

        if (!raid || !player1 || !player2 || !player3 || !player4 || !guildXP) {
            console.error(`[RaidReport] ❌ Invalid packet - missing fields:`, {
                raid: !!raid,
                player1: !!player1,
                player2: !!player2,
                player3: !!player3,
                player4: !!player4,
                guildXP: !!guildXP
            });
            return null;
        }

        if (!seasonRating) {
            console.log(`[RaidReport] No season rating provided, defaulting to 0`);
            seasonRating = 0;
        }

        const baseKey = this.generateBaseKey(player1, player2, player3, player4, raid);
        const reportKey = this.generateReportKey(player1, player2, player3, player4, raid, duration);

        console.log(`[RaidReport] Generated keys - base: ${baseKey}, report: ${reportKey}`);

        // Store packet data on client for potential use in auto-processing
        client.packet = packet;

        const result = await this.processRaidSafely(baseKey, client);
        console.log(`[RaidReport] Processing result:`, result);

        if (!result.shouldProcess) {
            if (result.isDuplicate) {
                console.log(`[RaidReport] 🔄 Duplicate raid filtered: ${baseKey}`);
            } else {
                console.log(`[RaidReport] ⏸️  Raid not ready to process yet: ${baseKey}`);
            }
            return null;
        }

        // Use the report with time if available
        const finalReportKey = result.reportKey || reportKey;
        const [finalRaid, p1, p2, p3, p4, finalTime] = finalReportKey.split(':');

        console.log(`[RaidReport] 🚀 PROCESSING RAID - finalReportKey: ${finalReportKey}`);

        try {
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
            console.log(`[RaidReport] ✅ Raid processed successfully`);
        } catch (error) {
            console.error(`[RaidReport] ❌ Error processing raid:`, error);
            throw error;
        }

        return {
            type: 'raid_report_ack',
            data: {
                success: true,
                timestamp: Date.now()
            }
        };
    }

    async processRaidReport(raid, player1, player2, player3, player4, seasonRating, guildXP, reporter, time = null) {
        console.log(`[RaidReport] ====== PROCESSING RAID REPORT ======`);
        console.log(`[RaidReport] Raid: ${raid}`);
        console.log(`[RaidReport] Players: ${player1}, ${player2}, ${player3}, ${player4}`);
        console.log(`[RaidReport] Reporter: ${reporter}, Rating: ${seasonRating}, XP: ${guildXP}, Time: ${time}`);

        const players = [player1, player2, player3, player4];
        const resolvedUUIDs = [];

        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            console.log(`[RaidReport] Resolving UUID for player ${i + 1}: ${player}`);

            let uuid = await getPlayerUUID(player);
            console.log(`[RaidReport] Database lookup result: ${uuid || 'not found'}`);

            if (!uuid) {
                console.log(`[RaidReport] Requesting UUID from Mojang API for ${player}`);
                uuid = await requestUUID(player);
                console.log(`[RaidReport] Mojang API result: ${uuid || 'not found'}`);
            }

            if (!uuid) {
                console.error(`[RaidReport] ❌ Could not resolve UUID for player: ${player}`);
                throw new Error(`Invalid player: ${player}`);
            }

            console.log(`[RaidReport] Checking guild membership for ${player} (${uuid})`);
            const memberInfo = await getMemberByUuid(uuid);
            if (!memberInfo) {
                console.error(`[RaidReport] ❌ Player ${player} is not in guild`);
                throw new Error(`Invalid player: ${player}`);
            }
            console.log(`[RaidReport] ✅ Player ${player} is in guild`);

            resolvedUUIDs[i] = uuid;
        }

        console.log(`[RaidReport] All UUIDs resolved:`, resolvedUUIDs);
        console.log(`[RaidReport] Inserting raid into database...`);

        try {
            await insertRaid(raid, resolvedUUIDs[0], resolvedUUIDs[1], resolvedUUIDs[2], resolvedUUIDs[3], reporter, seasonRating, guildXP, time);
            console.log(`[RaidReport] ✅ Raid inserted into database successfully`);
        } catch (error) {
            console.error(`[RaidReport] ❌ Database insertion failed:`, error);
            throw error;
        }

        try {
            console.log(`[RaidReport] Sending Discord notification...`);
            await sendRaidEmbed(raid, player1, player2, player3, player4, time);
            console.log(`[RaidReport] ✅ Discord notification sent`);
        } catch (error) {
            console.error(`[RaidReport] ❌ Discord notification failed:`, error);
        }

        console.log(`[RaidReport] ====== RAID REPORT COMPLETE ======`);
    }

    startCleanup() {
        console.log(`[RaidReport] Starting cleanup interval (${this.cleanupInterval}ms)`);
        setInterval(() => {
            const now = Date.now();
            const expiredHashes = [];

            for (const [hash, data] of this.raidData.entries()) {
                if (now - data.firstSeen > this.cacheExpiry) {
                    expiredHashes.push(hash);
                    // Clear any pending timeouts for expired entries
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
                console.log(`[RaidReport] 🧹 Cleaned up ${expiredHashes.length} expired raid entries`);
            }
        }, this.cleanupInterval);
    }

    getStats() {
        const stats = {
            recentRaidsCount: this.recentRaids.size,
            raidDataCount: this.raidData.size,
            activeLocks: this.raidLocks.size,
            pendingTimeouts: this.processingTimeouts.size,
            cacheExpiry: this.cacheExpiry,
            cleanupInterval: this.cleanupInterval
        };
        console.log(`[RaidReport] Current stats:`, stats);
        return stats;
    }
}

const raidReport = new RaidReportService();

module.exports = { RaidReportService, raidReport };