const mysql = require('mysql2/promise');
const {getPlayerGuildInfo} = require("../features/player/wynn-api");
const { config } = require("./config");
const {removeToken} = require("../features/auth/authentication");
const {requestUsername} = require("./utilities");


let pool;

function databaseInit() {

    pool = mysql.createPool({
        host: config.get("sql.host"),
        user: config.get("sql.user"),
        password: config.get("sql.password"),
        database: config.get("sql.database"),
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: 'Z' // Force UTC timezone
    });

    createTables();
}

async function createTables() {
    try {
        const connection = await pool.getConnection();

        const createRaidTableQuery = `
            CREATE TABLE IF NOT EXISTS raids (
                id INT AUTO_INCREMENT PRIMARY KEY,
                raid INT NOT NULL,
                player_1 VARCHAR(36) NOT NULL,
                player_2 VARCHAR(36) NOT NULL,
                player_3 VARCHAR(36) NOT NULL,
                player_4 VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reporter VARCHAR(36) NOT NULL,
                season_rating INT(5) DEFAULT 0 NOT NULL,
                guild_xp INT(11) DEFAULT 0 NOT NULL
            );
        `;

        await connection.execute(createRaidTableQuery);

        const createWarTableQuery = `
            CREATE TABLE IF NOT EXISTS wars (
                id INT AUTO_INCREMENT PRIMARY KEY,
                player VARCHAR(36) NOT NULL,
                time_in_war DOUBLE NOT NULL,
                tower_ehp DOUBLE NOT NULL,
                tower_dps DOUBLE NOT NULL,
                territory VARCHAR(100) NOT NULL,
                owner_guild VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        await connection.execute(createWarTableQuery);

        const createPlayerTableQuery = `
            CREATE TABLE IF NOT EXISTS players (
                uuid VARCHAR(36) NOT NULL PRIMARY KEY,
                username VARCHAR(16) NOT NULL,
                guild VARCHAR(4) DEFAULT NULL,
                guild_rank INT DEFAULT NULL,
                needs_aspects BOOLEAN DEFAULT 1 NOT NULL,
                discord_id VARCHAR(20) DEFAULT NULL,
                INDEX idx_discord_id (discord_id)
            );
        `;

        await connection.execute(createPlayerTableQuery);

        const createAspectTableQuery = `
            CREATE TABLE IF NOT EXISTS aspects (
                id INT AUTO_INCREMENT PRIMARY KEY,
                giver VARCHAR(36) NOT NULL,
                receiver VARCHAR(36) NOT NULL,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reporter VARCHAR(36) NOT NULL
            );
        `;

        await connection.execute(createAspectTableQuery);

        const createAccountLinksTableQuery = `
            CREATE TABLE IF NOT EXISTS account_links (
                id INT AUTO_INCREMENT PRIMARY KEY,
                discord_id VARCHAR(20) NOT NULL,
                minecraft_uuid VARCHAR(36) NOT NULL,
                minecraft_username VARCHAR(16) NOT NULL,
                verification_code VARCHAR(10) NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                verified_at TIMESTAMP NULL DEFAULT NULL,
                expires_at TIMESTAMP NOT NULL,
                UNIQUE KEY unique_discord (discord_id),
                UNIQUE KEY unique_minecraft (minecraft_uuid),
                INDEX idx_verification_code (verification_code),
                INDEX idx_verified (verified)
            );
        `;

        await connection.execute(createAccountLinksTableQuery);

        // Add discord_id column to players table if it doesn't exist
        try {
            await connection.execute(`
                ALTER TABLE players 
                ADD COLUMN IF NOT EXISTS discord_id VARCHAR(20) DEFAULT NULL,
                ADD INDEX IF NOT EXISTS idx_discord_id (discord_id);
            `);
        } catch (alterErr) {
            // Ignore errors if column already exists
            console.log("Discord_id column may already exist, continuing...");
        }

        // Add guild_rank column to players table if it doesn't exist
        try {
            await connection.execute(`
                ALTER TABLE players 
                ADD COLUMN IF NOT EXISTS guild_rank INT DEFAULT NULL;
            `);
        } catch (alterErr) {
            // Ignore errors if column already exists
            console.log("Guild_rank column may already exist, continuing...");
        }

        // Migrate existing verified links to players table
        try {
            const migrationQuery = `
                UPDATE players p
                INNER JOIN account_links al ON p.uuid = al.minecraft_uuid
                SET p.discord_id = al.discord_id
                WHERE al.verified = TRUE AND p.discord_id IS NULL;
            `;
            
            const [migrationResult] = await connection.execute(migrationQuery);
            if (migrationResult.affectedRows > 0) {
                console.log(`Migrated ${migrationResult.affectedRows} verified account links to players table`);
            }
        } catch (migrationErr) {
            console.log("Migration may have already been completed or no verified links exist");
        }

        // Create tracker tables
        const createGuildMemberEventsTableQuery = `
            CREATE TABLE IF NOT EXISTS guild_member_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uuid VARCHAR(36) NOT NULL,
                username VARCHAR(16) NOT NULL,
                event_type ENUM('joined', 'left', 'rank_changed') NOT NULL,
                old_rank INT DEFAULT NULL,
                new_rank INT DEFAULT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_uuid (uuid),
                INDEX idx_event_type (event_type),
                INDEX idx_timestamp (timestamp)
            );
        `;
        await connection.execute(createGuildMemberEventsTableQuery);

        const createTerritoryEventsTableQuery = `
            CREATE TABLE IF NOT EXISTS territory_events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                territory VARCHAR(100) NOT NULL,
                event_type ENUM('gained', 'lost') NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_territory (territory),
                INDEX idx_event_type (event_type),
                INDEX idx_timestamp (timestamp)
            );
        `;
        await connection.execute(createTerritoryEventsTableQuery);

        const createTrackerChannelConfigTableQuery = `
            CREATE TABLE IF NOT EXISTS tracker_channel_config (
                id INT AUTO_INCREMENT PRIMARY KEY,
                channel_id VARCHAR(20) NOT NULL,
                tracker_type ENUM('territory', 'members') NOT NULL,
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_channel_tracker (channel_id, tracker_type),
                INDEX idx_channel (channel_id),
                INDEX idx_enabled (enabled)
            );
        `;
        await connection.execute(createTrackerChannelConfigTableQuery);

        connection.release();
    } catch (err) {
        console.error("Error creating table: ", err);
    }
}

async function insertRaid(raid, player1, player2, player3, player4, reporter, seasonRating, guildXP, time) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO raids (raid, player_1, player_2, player_3, player_4, reporter, season_rating, guild_xp, duration)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);
        `;

        await connection.execute(insertQuery, [raid, player1, player2, player3, player4, reporter, seasonRating, guildXP, time]);
        connection.release();
    } catch (err) {
        console.error("Error inserting raid: ", err);
    }
}

async function insertWar(player, timeInWar, towerEhp, towerDps, territory, ownerGuild) {
    try {
        const connection =  await pool.getConnection();

        const insertQuery = `
            INSERT INTO wars (player, time_in_war, tower_ehp, tower_dps, territory, owner_guild)
            VALUES (?, ?, ?, ?, ?, ?);
            
        `;

        await connection.execute(insertQuery, [player, timeInWar, towerEhp, towerDps, territory, ownerGuild]);
    } catch (err) {
        console.error("Error inserting war: ", err);
    }
}

async function insertAspect(giver, receiver, reporter) {
    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO aspects (giver, receiver, reporter)
            VALUES (?, ?, ?);
        `;

        await connection.execute(insertQuery, [giver, receiver, reporter]);
        connection.release();
    } catch (err) {
        console.error("Error inserting aspect: ", err);
    }
}

async function checkForRecentRaid(player) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM raids
            WHERE (player_1 = ? OR player_2 = ? OR player_3 = ? OR player_4 = ?)
            AND time > DATE_SUB(NOW(), INTERVAL 1 MINUTE);
        `;

        const [rows] = await connection.execute(query, [player, player, player, player]);
        connection.release();
        return rows.length > 0;
    } catch (err) {
        console.error("Error checking for recent raid: ", err);
    }

    return true;
}

async function getPlayerUUID(username) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT uuid FROM players
            WHERE username = ?;
        `;

        const [rows] = await connection.execute(query, [username]);
        connection.release();
        return rows[0].uuid;
    } catch (err) {
        return null;
    }
}

async function getPlayerUsername(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT username FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows[0].username;
    } catch (err) {
        return null;
    }
}

async function insertPlayer(uuid, username) {
    let { guild, guildRank } = await getPlayerGuildInfo(uuid);

    try {
        const connection = await pool.getConnection();

        const insertQuery = `
            INSERT INTO players (uuid, username, guild, guild_rank, needs_aspects)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE username = VALUES(username), guild = VALUES(guild), guild_rank = VALUES(guild_rank);
        `;

        await connection.execute(insertQuery, [uuid, username, guild, guildRank, 1]);
        connection.release();
    } catch (err) {
        console.error("Error inserting player: ", err);
    }
}

async function getGuild(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT guild FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows[0].guild;
    } catch (err) {
        console.error("Error getting player guild: ", err);
    }

    return null;
}

async function updateGuild(uuid) {
    let { guild, guildRank } = await getPlayerGuildInfo(uuid);
    
    const guildTag = config.get("guild-tag")

    if (!guild || guild !== guildTag) {
        removeToken(uuid);
    }

    try {
        const connection = await pool.getConnection();

        const updateQuery = `
            UPDATE players
            SET guild = ?, guild_rank = ?
            WHERE uuid = ?;
        `;

        await connection.execute(updateQuery, [guild, guildRank, uuid]);
        connection.release();
    } catch (err) {
        console.error("Error updating guild: ", err);
    }
}

async function updateUsername(uuid) {
    let username = await requestUsername(uuid);

    let previousUsername = await getPlayerUsername(uuid);
    if (username === previousUsername) return;

    try {
        const connection = await pool.getConnection();

        const updateQuery = `
            UPDATE players
            SET username = ?
            WHERE uuid = ?;
        `;

        await connection.execute(updateQuery, [username, uuid]);
        connection.release();
    } catch (err) {
        console.error("Error updating guild: ", err);
    }
}

async function getRaids(uuid, startTimestamp = null, endTimestamp = null) {
    try {
        const connection = await pool.getConnection();

        let query = `
            SELECT * FROM raids
            WHERE (player_1 = ? OR player_2 = ? OR player_3 = ? OR player_4 = ?)
        `;

        const params = [uuid, uuid, uuid, uuid];

        if (startTimestamp && endTimestamp) {
            query += ` AND time BETWEEN ? AND ?`;
            params.push(startTimestamp, endTimestamp);
        } else if (startTimestamp) {
            query += ` AND time > ?`;
            params.push(startTimestamp);
        }

        const [rows] = await connection.execute(query, params);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting raids: ", err);
    }

    return [];
}

async function getWars(uuid, startTimestamp = null, endTimestamp = null) {
    try {
        const connection = await pool.getConnection();

        let query = `SELECT * FROM wars WHERE (player = ?)`;

        const params = [uuid];

        if (startTimestamp && endTimestamp) {
            query += ` AND time BETWEEN ? AND ?`;
            params.push(startTimestamp, endTimestamp);
        } else if (startTimestamp) {
            query += ` AND time > ?`;
            params.push(startTimestamp);
        }

        const [rows] = await connection.execute(query, params);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting raids: ", err);
    }

    return [];
}

async function getRaidCount(raidId = null, startTimestamp = null, endTimestamp = null) {
    try {
        const connection = await pool.getConnection();
                
        let query = `SELECT COUNT(*) as count FROM raids`;
        const params = [];
        const conditions = [];
                
        if (raidId !== null) {
            conditions.push(`raid = ?`);
            params.push(raidId);
        }
                
        if (startTimestamp && endTimestamp) {
            conditions.push(`time BETWEEN ? AND ?`);
            params.push(startTimestamp, endTimestamp);
        } else if (startTimestamp) {
            conditions.push(`time > ?`);
            params.push(startTimestamp);
        }
                
        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }
                
        const [rows] = await connection.execute(query, params);
                
        connection.release();
        return rows[0].count;
    } catch (err) {
        console.error("Error getting raid count: ", err);
        return 0;
    }
}

async function getAspects(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM aspects
            WHERE receiver = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting aspects: ", err);
    }

    return [];
}

async function getOwedAspects() {

    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT * FROM players WHERE guild = ?;
        `;

        const [rows] = await connection.execute(query, [config.get("guild-tag")]);

        for (const row of rows) {
            let uuid = row.uuid;
            let needsAspects = row.needs_aspects;

            if (!needsAspects) continue;

            let aspects = await getAspects(uuid);
            let raids = await getRaids(uuid);

            let totalAspects = aspects.length;
            let owedAspects = Math.max(Math.floor(raids.length / 2) - totalAspects, 0);

            playerMap.set(uuid, owedAspects);
        }

        connection.release();


        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let playerArray = [...playerMap.entries()];
        playerArray = playerArray.filter(([key, value]) => value > 0);
        playerMap = new Map(playerArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting owed aspects: ", err);
    }

    return [];
}

async function getRaidLeaderboard(raid, timestamp = null) {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT uuid FROM players;
        `;

        const [rows] = await connection.execute(query);

        for (const row of rows) {
            let uuid = row.uuid;
            let raids = await getRaids(uuid, timestamp);

            let raidCount = 0;
            for (const raidRow of raids) {
                if (raid === -1 || raidRow.raid === raid) raidCount++;
            }

            playerMap.set(uuid, raidCount);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting leaderboard: ", err);
    }

    return [];
}

async function getWarLeaderboard(difficultyIndex, timestamp = null) {
    const {warService} = require("../features/wars/report-war-endpoint");
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        const query = `
            SELECT uuid FROM players;
        `;

        const [rows] = await connection.execute(query);

        for (const row of rows) {
            let uuid = row.uuid;
            let wars = await getWars(uuid, timestamp);

            let warCount = 0;
            for (const warRow of wars) {
                let towerEhp = warRow['tower_ehp'];
                let towerDps = warRow['tower_dps'];

                let difficulty = warService.getWarDifficulty(towerEhp, towerDps);
                let difficultyIndexRow = warService.getDifficultyIndex(difficulty);

                if (difficultyIndex === -1 || difficultyIndexRow === difficultyIndex) warCount++;
            }

            playerMap.set(uuid, warCount);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting leaderboard: ", err);
    }

    return [];
}

async function getGXPLeaderboard(timestamp = null) {
    try {
        let playerMap = new Map();

        const connection = await pool.getConnection();
        let query = `SELECT player_1, player_2, player_3, player_4, guild_xp FROM raids`;
        let params = [];

        if (timestamp) {
            query += ` WHERE time > ?`;
            params.push(timestamp);
        }

        const [rows] = await connection.execute(query, params);

        for (const row of rows) {
            let guildXP = row.guild_xp / 4;

            if (row.player_1) playerMap.set(row.player_1, (playerMap.get(row.player_1) || 0) + guildXP);
            if (row.player_2) playerMap.set(row.player_2, (playerMap.get(row.player_2) || 0) + guildXP);
            if (row.player_3) playerMap.set(row.player_3, (playerMap.get(row.player_3) || 0) + guildXP);
            if (row.player_4) playerMap.set(row.player_4, (playerMap.get(row.player_4) || 0) + guildXP);
        }

        connection.release();

        playerMap = new Map([...playerMap.entries()].sort((a, b) => b[1] - a[1]));

        let leaderArray = [...playerMap.entries()];
        leaderArray = leaderArray.filter(([key, value]) => value > 0);
        playerMap = new Map(leaderArray);

        return playerMap;
    } catch (err) {
        console.error("Error getting GXP leaderboard: ", err);
    }

    return [];
}


async function getPlayers() {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM players;
        `;

        const [rows] = await connection.execute(query);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting players: ", err);
    }

    return [];
}

async function getPlayersByGuild(guildTag) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM players WHERE guild = ?;
        `;

        const [rows] = await connection.execute(query, [guildTag]);
        connection.release();
        return rows;
    } catch (err) {
        console.error("Error getting players by guild: ", err);
    }

    return [];
}

async function toggleNeedsAspects(uuid) {
    try {
        const connection = await pool.getConnection();

        const updateQuery = `
            UPDATE players
            SET needs_aspects = NOT needs_aspects
            WHERE uuid = ?;
        `;

        await connection.execute(updateQuery, [uuid]);

        const selectQuery = `
            SELECT needs_aspects
            FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(selectQuery, [uuid]);
        connection.release();

        return rows[0];
    } catch (err) {
        console.error("Error toggling needs aspects: ", err);
        return null;
    }
}

// Account linking functions
async function createAccountLink(discordId, minecraftUuid, minecraftUsername, verificationCode, expiresAt) {
    try {
        const connection = await pool.getConnection();
        
        // Delete any existing unverified link for this discord user
        await connection.execute(
            'DELETE FROM account_links WHERE discord_id = ? AND verified = FALSE', 
            [discordId]
        );
        
        // Convert JavaScript Date to MySQL timestamp format
        const mysqlExpiresAt = expiresAt.toISOString().slice(0, 19).replace('T', ' ');
        
        const insertQuery = `
            INSERT INTO account_links (discord_id, minecraft_uuid, minecraft_username, verification_code, expires_at)
            VALUES (?, ?, ?, ?, ?);
        `;
        
        await connection.execute(insertQuery, [discordId, minecraftUuid, minecraftUsername, verificationCode, mysqlExpiresAt]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error creating account link: ", err);
        return false;
    }
}

async function verifyAccountLink(verificationCode) {
    try {
        const connection = await pool.getConnection();
        
        // Check if code exists and hasn't expired
        const selectQuery = `
            SELECT * FROM account_links 
            WHERE verification_code = ? AND verified = FALSE AND expires_at > NOW();
        `;
        
        const [rows] = await connection.execute(selectQuery, [verificationCode]);
        
        if (rows.length === 0) {
            connection.release();
            return null; // Code not found or expired
        }
        
        const link = rows[0];
        
        // Update to verified
        const updateQuery = `
            UPDATE account_links 
            SET verified = TRUE, verified_at = UTC_TIMESTAMP() 
            WHERE id = ?;
        `;
        
        await connection.execute(updateQuery, [link.id]);
        
        // Add or update the player with discord_id
        await insertPlayer(link.minecraft_uuid, link.minecraft_username);
        
        const updatePlayerQuery = `
            UPDATE players 
            SET discord_id = ? 
            WHERE uuid = ?;
        `;
        
        await connection.execute(updatePlayerQuery, [link.discord_id, link.minecraft_uuid]);
        
        connection.release();
        
        return {
            discordId: link.discord_id,
            minecraftUuid: link.minecraft_uuid,
            minecraftUsername: link.minecraft_username
        };
    } catch (err) {
        console.error("Error verifying account link: ", err);
        return null;
    }
}

async function getAccountLink(discordId) {
    try {
        const connection = await pool.getConnection();
        
        const selectQuery = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id, al.verified_at
            FROM players p
            LEFT JOIN account_links al ON p.uuid = al.minecraft_uuid AND al.verified = TRUE
            WHERE p.discord_id = ?;
        `;
        
        const [rows] = await connection.execute(selectQuery, [discordId]);
        connection.release();
        
        if (rows.length === 0) return null;
        
        const player = rows[0];
        return {
            discord_id: player.discord_id,
            minecraft_uuid: player.uuid,
            minecraft_username: player.username,
            verified: true,
            verified_at: player.verified_at
        };
    } catch (err) {
        console.error("Error getting account link: ", err);
        return null;
    }
}

async function getAccountLinkByMinecraft(minecraftUuid) {
    try {
        const connection = await pool.getConnection();
        
        const selectQuery = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id
            FROM players p
            WHERE p.uuid = ? AND p.discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(selectQuery, [minecraftUuid]);
        connection.release();
        
        if (rows.length === 0) return null;
        
        const player = rows[0];
        return {
            discord_id: player.discord_id,
            minecraft_uuid: player.uuid,
            minecraft_username: player.username,
            verified: true
        };
    } catch (err) {
        console.error("Error getting account link by minecraft: ", err);
        return null;
    }
}

async function removeAccountLink(discordId) {
    try {
        const connection = await pool.getConnection();
        
        // Remove from account_links table
        const deleteQuery = `
            DELETE FROM account_links WHERE discord_id = ?;
        `;
        
        await connection.execute(deleteQuery, [discordId]);
        
        // Clear discord_id from players table
        const updatePlayerQuery = `
            UPDATE players 
            SET discord_id = NULL 
            WHERE discord_id = ?;
        `;
        
        const [result] = await connection.execute(updatePlayerQuery, [discordId]);
        connection.release();
        
        return result.affectedRows > 0;
    } catch (err) {
        console.error("Error removing account link: ", err);
        return false;
    }
}

async function removeAccountLinkByMinecraft(minecraftUuid) {
    try {
        const connection = await pool.getConnection();
        
        // Remove from account_links table
        const deleteQuery = `
            DELETE FROM account_links WHERE minecraft_uuid = ?;
        `;
        
        await connection.execute(deleteQuery, [minecraftUuid]);
        
        // Clear discord_id from players table
        const updatePlayerQuery = `
            UPDATE players 
            SET discord_id = NULL 
            WHERE uuid = ?;
        `;
        
        const [result] = await connection.execute(updatePlayerQuery, [minecraftUuid]);
        connection.release();
        
        return result.affectedRows > 0;
    } catch (err) {
        console.error("Error removing account link by minecraft: ", err);
        return false;
    }
}

async function getUnverifiedAccountLink(verificationCode) {
    try {
        const connection = await pool.getConnection();
        
        // Get unverified link without marking it as verified
        const selectQuery = `
            SELECT * FROM account_links 
            WHERE verification_code = ? AND verified = FALSE AND expires_at > NOW();
        `;
        
        const [rows] = await connection.execute(selectQuery, [verificationCode]);
        connection.release();
        
        if (rows.length === 0) {
            return null; // Code not found or expired
        }
        
        return rows[0];
    } catch (err) {
        console.error("Error getting unverified account link: ", err);
        return null;
    }
}

async function cleanupExpiredLinks() {
    try {
        const connection = await pool.getConnection();
        
        const deleteQuery = `
            DELETE FROM account_links 
            WHERE verified = FALSE AND expires_at < NOW();
        `;
        
        const [result] = await connection.execute(deleteQuery);
        connection.release();
        
        return result.affectedRows;
    } catch (err) {
        console.error("Error cleaning up expired links: ", err);
        return 0;
    }
}

async function getPlayersWithVerifiedLinks() {
    try {
        const connection = await pool.getConnection();
        
        const query = `
            SELECT p.uuid, p.username, p.guild, p.needs_aspects, p.discord_id
            FROM players p
            WHERE p.discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(query);
        connection.release();
        
        // Transform to match expected format
        return rows.map(row => ({
            ...row,
            minecraft_username: row.username
        }));
    } catch (err) {
        console.error("Error getting players with verified links: ", err);
        return [];
    }
}

async function getAccountLinksForPlayers(playerUuids) {
    try {
        if (playerUuids.length === 0) return {};
        
        const connection = await pool.getConnection();
        
        // Create placeholders for IN clause
        const placeholders = playerUuids.map(() => '?').join(',');
        
        const query = `
            SELECT uuid, discord_id, username
            FROM players 
            WHERE uuid IN (${placeholders}) AND discord_id IS NOT NULL;
        `;
        
        const [rows] = await connection.execute(query, playerUuids);
        connection.release();
        
        // Convert to map for quick lookup
        const linkMap = {};
        for (const row of rows) {
            linkMap[row.uuid] = {
                discord_id: row.discord_id,
                minecraft_username: row.username
            };
        }
        
        return linkMap;
    } catch (err) {
        console.error("Error getting account links for players: ", err);
        return {};
    }
}

async function getPlayerByDiscordId(discordId) {
    try {
        const connection = await pool.getConnection();
        
        const query = `
            SELECT * FROM players
            WHERE discord_id = ?;
        `;
        
        const [rows] = await connection.execute(query, [discordId]);
        connection.release();
        
        return rows[0] || null;
    } catch (err) {
        console.error("Error getting player by discord ID: ", err);
        return null;
    }
}

module.exports = { databaseInit, insertRaid, insertWar, insertAspect, getGXPLeaderboard, getPlayerUUID,
    getPlayerUsername, insertPlayer, getRaids, getWars, getRaidCount, getAspects, getOwedAspects, getRaidLeaderboard, getWarLeaderboard, updateGuild, updateUsername, getPlayers, getPlayersByGuild, getGuild, toggleNeedsAspects,
    createAccountLink, verifyAccountLink, getAccountLink, getAccountLinkByMinecraft, removeAccountLink, removeAccountLinkByMinecraft, getUnverifiedAccountLink, cleanupExpiredLinks, getPlayersWithVerifiedLinks, getAccountLinksForPlayers, getPlayerByDiscordId };
