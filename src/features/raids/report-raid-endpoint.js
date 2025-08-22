const {getToken} = require("../auth/authentication");
const {insertRaid, getPlayerUUID, insertPlayer} = require("../../core/database");
const {requestUUID} = require("../../core/utilities");
const {sendRaidEmbed} = require("./raid-message");
const { config } = require("../../core/config");

class RaidReportService {
    constructor() {
        this.recentRaids = new Map();
        this.raidCache = new Map();
        this.raidStatus = new Map();
        this.raidOccurrences = new Map();
        this.clientRaidMap = new Map();
        this.cacheExpiry = 45000;
        this.cleanupInterval = 90000;
        this.minClientThreshold = 1;
        
        this.startCleanup();
    }

    generateReportKey(player1, player2, player3, player4, raid) {
        return `${player1}:${player2}:${player3}:${player4}:${raid}`;
    }

    generateRaidHash(reportKey, timestamp = null) {
        const time = timestamp || Date.now();
        return `${reportKey}:${Math.floor(time / 1000)}`;
    }

    shouldProcessRaid(reportKey, client, timestamp = null) {
        const hash = this.generateRaidHash(reportKey, timestamp);
        const now = Date.now();
        
        if (this.raidStatus.get(hash) === 'processed') {
            return false;
        }
        
        if (!this.raidOccurrences.has(hash)) {
            this.raidOccurrences.set(hash, {
                count: 0,
                clients: new Set(),
                firstSeen: now,
                processed: false
            });
            this.raidStatus.set(hash, 'pending');
        }
        
        const raidData = this.raidOccurrences.get(hash);
        
        if (now - raidData.firstSeen > this.cacheExpiry) {
            raidData.count = 0;
            raidData.clients.clear();
            raidData.firstSeen = now;
            raidData.processed = false;
            this.raidData.set(hash, 'pending');
        }
        
        if (raidData.processed) {
            return false;
        }
        
        if (!raidData.clients.has(client)) {
            raidData.clients.add(client);
            raidData.count++;
        }
        
        const threshold = config.get("minimum-client-threshold");
        if (raidData.count >= threshold && this.raidStatus.get(hash) === 'pending') {
            this.raidStatus.set(hash, 'processed');
            raidData.processed = true;
            return true;
        }
        
        return false;
    }

    isDuplicateRaid(reportKey, timestamp = null) {
        const hash = this.generateRaidHash(reportKey, timestamp);
        const now = Date.now();
        
        if (this.raidOccurrences.has(hash)) {
            const raidData = this.raidOccurrences.get(hash);
            if (now - raidData.firstSeen > this.cacheExpiry) {
                this.raidOccurrences.delete(hash);
                this.raidStatus.delete(hash);
                return false;
            }
            
            return this.raidStatus.get(hash) === 'processed';
        }
        
        return false;
    }

    async handleRaidReport(client, packet) {
        const { raid, player1, player2, player3, player4, reporter, seasonRating, guildXP} = packet.data;
        if (!raid || !player1 || !player2 || !player3 || !player4 || !seasonRating || !guildXP) {
            console.warn(`Invalid raid report packet: missing required fields from client ${client.uuid}`);
            return null;
        }

        const reportKey = this.generateReportKey(player1, player2, player3, player4, raid);
        
        if (!this.shouldProcessRaid(reportKey, client)) {
            if (this.isDuplicateRaid(reportKey)) {
                console.log(`Duplicate raid filtered: ${reportKey}`);
                return null;
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
            
            // Find expired entries
            for (const [hash, data] of this.raidOccurrences.entries()) {
                if (now - data.firstSeen > this.cacheExpiry) {
                    expiredHashes.push(hash);
                }
            }
            
            // Clean up expired entries
            expiredHashes.forEach(hash => {
                this.raidOccurrences.delete(hash);
                this.raidStatus.delete(hash);
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