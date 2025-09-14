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
        
        this.startCleanup();
    }

    generateReportKey(player1, player2, player3, player4, raid) {
        return `${player1}:${player2}:${player3}:${player4}:${raid}`;
    }

    generateRaidHash(reportKey, timestamp = null) {
        return reportKey;
    }

    async processRaidSafely(reportKey, client, timestamp = null) {
        const hash = this.generateRaidHash(reportKey, timestamp);
        
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

    async _processRaidInternal(hash, reportKey, client) {
        const now = Date.now();
        
        if (!this.raidData.has(hash)) {
            this.raidData.set(hash, {
                status: 'pending',
                count: 0,
                clients: new Set(),
                firstSeen: now
            });
        }
        
        const data = this.raidData.get(hash);
        
        if (now - data.firstSeen > this.cacheExpiry) {
            data.status = 'pending';
            data.count = 0;
            data.clients.clear();
            data.firstSeen = now;
        }
        
        if (data.status === 'processed') {
            return { shouldProcess: false, isDuplicate: true };
        }
        
        if (!data.clients.has(client)) {
            data.clients.add(client);
            data.count++;
        }
        
        const threshold = config.get("minimum-client-threshold");
        if (data.count >= threshold && data.status === 'pending') {
            data.status = 'processed';
            return { shouldProcess: true, isDuplicate: false };
        }
        
        return { shouldProcess: false, isDuplicate: false };
    }

    async shouldProcessRaid(reportKey, client, timestamp = null) {
        const result = await this.processRaidSafely(reportKey, client, timestamp);
        return result.shouldProcess;
    }

    async isDuplicateRaid(reportKey, timestamp = null) {
        const hash = this.generateRaidHash(reportKey, timestamp);
        const now = Date.now();
        
        if (!this.raidData.has(hash)) {
            return false;
        }
        
        const data = this.raidData.get(hash);
        
        if (now - data.firstSeen > this.cacheExpiry) {
            return false;
        }
        
        return data.status === 'processed';
    }

    async handleRaidReport(client, packet) {
        let { raid, player1, player2, player3, player4, reporter, seasonRating, guildXP} = packet.data;
        if (!raid || !player1 || !player2 || !player3 || !player4  || !guildXP) {
            console.warn(`Invalid raid report packet: missing required fields from client ${client.uuid}`);
            return null;
        }

        if (!seasonRating) seasonRating = 0;

        const reportKey = this.generateReportKey(player1, player2, player3, player4, raid);
        
        const result = await this.processRaidSafely(reportKey, client);
        
        if (!result.shouldProcess) {
            if (result.isDuplicate) {
                console.log(`Duplicate raid filtered: ${reportKey}`);
            }
            return null;
        }

        this.processRaidReport(raid, player1, player2, player3, player4, seasonRating, guildXP, reporter);

        return {
            type: 'raid_report_ack',
            data: {
                success: true,
                timestamp: Date.now()
            }
        };
    }

    async processRaidReport(raid, player1, player2, player3, player4, seasonRating, guildXP, reporter) {

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

        console.log(`Processing raid report: ${raid} with players [${players.join(', ')}] reported by ${reporter}`);

        console.log(`Raid Report Log: raid - ${raid} players - ${resolvedUUIDs[0]} ${resolvedUUIDs[1]} ${resolvedUUIDs[2]} ${resolvedUUIDs[3]} reporter - ${reporter} season rating - ${seasonRating} guild XP - ${guildXP}`)
        await insertRaid(raid, resolvedUUIDs[0], resolvedUUIDs[1], resolvedUUIDs[2], resolvedUUIDs[3], reporter, seasonRating, guildXP);
        
        try {
            console.log(`Sent Discord notification for raid: ${raid}`);
            await sendRaidEmbed(raid, player1, player2, player3, player4);
        } catch (error) {
            console.error(`Failed to send Discord notification for raid ${raid}:`, error);
        }

        console.log(`Successfully reported raid: ${raid} with players [${players.join(', ')}] reported by ${reporter}`);
        return;
    }

    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredHashes = [];
            
            for (const [hash, data] of this.raidData.entries()) {
                if (now - data.firstSeen > this.cacheExpiry) {
                    expiredHashes.push(hash);
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
            pendingReportsCount: this.pendingReports.size,
            cacheExpiry: this.cacheExpiry,
            cleanupInterval: this.cleanupInterval
        };
    }
}

const raidReport = new RaidReportService();

module.exports = { RaidReportService, raidReport };