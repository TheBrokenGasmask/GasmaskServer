const { getGuildRaids } = require("../../core/database");

class BadgeCacheService {
    constructor() {
        this.playerBadgeCache = new Map(); // Stores player badges by UUID
        this.leaderboardCache = new Map();
        this.isCalculating = false;
        this.isInitialized = false;
    }

    /**
     * Initialize the cache service (call after database is ready)
     */
    async initialize() {
        if (this.isInitialized) return;
        
        console.log('Initializing badge cache service...');
        try {
            await this.updateCache();


            // Set up periodic cache refresh (every 5 minutes)
            setInterval(() => this.updateCache(), 5 * 60 * 1000);
            
            this.isInitialized = true;
            console.log('Badge cache service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize badge cache service:', error);
            this.isInitialized = false;
        }
    }

    /**
     * Update badge cache
     */
    async updateCache() {
    if (this.isCalculating) return;

    this.isCalculating = true;
    try {
        console.log('Updating badge cache...');
        const shadowPlayerBadgeCache = new Map();
        const shadowLeaderboardCache = new Map();

        const addPlayerBadgeToCache = (uuid, badgeId) => {
            if (!shadowPlayerBadgeCache.has(uuid)) {
                shadowPlayerBadgeCache.set(uuid, []);
            }
            const playerBadges = shadowPlayerBadgeCache.get(uuid);
            if (!playerBadges.includes(badgeId)) {
                playerBadges.push(badgeId);
            }
        };

        const rows = await getGuildRaids(null, null, null); // raw-latest branch

        // Process each raid leaderboard
        for (let raidId = -1; raidId <= 3; raidId++) {
            try {
                const raidColumn = raidId === -1 ? 'total' : `raid${raidId}`;

                const leaderboardArray = rows
                    .filter(row => row[raidColumn] > 0)
                    .sort((a, b) => b[raidColumn] - a[raidColumn])
                    .map(row => row.uuid);

                shadowLeaderboardCache.set(raidId, leaderboardArray);

                // Top 3 for each raid
                for (let position = 0; position < 3 && position < leaderboardArray.length; position++) {
                    const uuid = leaderboardArray[position];
                    if (uuid) {
                        addPlayerBadgeToCache(uuid, this.getRaidBadgeId(raidId, position + 1));
                    }
                }
            } catch (error) {
                console.error(`Error caching leaderboard for raid ${raidId}:`, error);
            }
        }

        this.playerBadgeCache = shadowPlayerBadgeCache;
        this.leaderboardCache = shadowLeaderboardCache;

        console.log('Badge cache updated successfully');
    } catch (error) {
        console.error('Error updating badge cache:', error);
    } finally {
        this.isCalculating = false;
    }
}


    /**
     * Get raid badge ID based on raid and position
     */
    getRaidBadgeId(raidId, position) {
        const raidNames = ['NOTG', 'NOL', 'TCC', 'TNA'];
        if (raidId === -1) {
            return `ALL_TOP_${position}`;
        }
        const raidName = raidNames[raidId] || 'UNKNOWN';
        return `${raidName}_TOP_${position}`;
    }

    /**
     * Get cached badges for a player (instant response)
     */
    getPlayerBadges(uuid) {
        return this.playerBadgeCache.get(uuid) || [];
    }

    /**
     * Get cached leaderboard for a raid (instant response)
     */
    getCachedLeaderboard(raidId) {
        return this.leaderboardCache.get(raidId) || [];
    }
}

const badgeCacheService = new BadgeCacheService();

module.exports = { BadgeCacheService, badgeCacheService };