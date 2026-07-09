const mysql = require('mysql2/promise');
const {getPlayerGuildInfo} = require("../features/player/wynn-api");
const { config } = require("./config");
const {removeToken} = require("../features/auth/authentication");
const {requestUsername} = require("./utilities");


let pool;



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

        const createMessageTrackerTableQuery = `
            CREATE TABLE IF NOT EXISTS trackers (
            channel_id  VARCHAR(20)  NOT NULL,
            type        VARCHAR(20)  NOT NULL,
            message_id  VARCHAR(20)  NOT NULL,
            PRIMARY KEY (channel_id, type)
        );`;
        await connection.execute(createMessageTrackerTableQuery);
        
        const createApplicationTableQuery =`
        CREATE TABLE IF NOT EXISTS applications (
            id            INT AUTO_INCREMENT PRIMARY KEY,
            thread_id     VARCHAR(20) NOT NULL,
            vote_bar_message_id  VARCHAR(20),
            review_message_id    VARCHAR(20),
            applicant_id  VARCHAR(20) NOT NULL,
            ign           VARCHAR(32) NOT NULL,
            status        VARCHAR(20) DEFAULT 'pending',
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            type          VARCHAR(20) DEFAULT 'join',
            answers JSON DEFAULT NULL,
            stage VARCHAR(20) DEFAULT 'ign',
            resume_data JSON DEFAULT NULL
        );`
        await connection.execute(createApplicationTableQuery);
        
        const createApplicationVotesTableQuery =`
        CREATE TABLE IF NOT EXISTS application_votes (
            application_id  INT NOT NULL,
            voter_id        VARCHAR(20) NOT NULL,
            vote            VARCHAR(10) NOT NULL, -- 'accept' or 'decline'
            PRIMARY KEY (application_id, voter_id),
            FOREIGN KEY (application_id) REFERENCES applications(id)
        );`
        await connection.execute(createApplicationVotesTableQuery);

        const CreateRaidTrackerTableQuery = `
        CREATE TABLE IF NOT EXISTS guild_raids (
            id          INT AUTO_INCREMENT PRIMARY KEY,
            uuid        VARCHAR(36) NOT NULL,
            raid0       INT NOT NULL DEFAULT 0,
            raid1       INT NOT NULL DEFAULT 0,
            raid2       INT NOT NULL DEFAULT 0,
            raid3       INT NOT NULL DEFAULT 0,
            raid4       INT NOT NULL DEFAULT 0,
            total       INT NOT NULL DEFAULT 0,
            captured_at TIMESTAMP NOT NULL,
            INDEX idx_time (captured_at),
            INDEX idx_uuid (uuid)
        );`
        await connection.execute(CreateRaidTrackerTableQuery);
        await ensureIndex(connection, 'guild_raids', 'idx_guild_raids_captured_uuid', '(captured_at, uuid)');



        connection.release();
    } catch (err) {
        console.error("Error creating table: ", err);
    }
}

async function ensureIndex(connection, table, indexName, columns) {
    const [rows] = await connection.query(
        `SELECT COUNT(1) as cnt
         FROM information_schema.statistics
         WHERE table_schema = DATABASE()
           AND table_name = ?
           AND index_name = ?`,
        [table, indexName]
    );

    if (rows[0].cnt === 0) {
        await connection.query(`CREATE INDEX ${indexName} ON ${table} ${columns}`);
        console.log(`Created index ${indexName} on ${table}`);
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

async function insertRaidSnapshot(uuid, raidCounts, total, capturedAt) {
    try {
        const connection = await pool.getConnection();
        const insertQuery = `
            INSERT INTO guild_raids (uuid, raid0, raid1, raid2, raid3, raid4, total, captured_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?);
        `;
        await connection.execute(insertQuery, [uuid, ...raidCounts, total, capturedAt]);
        connection.release();
    } catch (err) {
        console.error('Error inserting raid snapshot: ', err);
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
            const rows = await getLatestGuildRaids(uuid);
            const raids = rows.length ? rows[0] : null;
            if (!raids) continue; // ✅ skip players with no raid data yet
            let totalAspects = aspects.length;
            let owedAspects = Math.max(Math.floor(raids.total / 2) - totalAspects, 0);

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
        const raidColumn = raid === -1 ? 'total' : `raid${raid}`;

        let query;
        let params;

        if (timestamp) {
            // diff between closest snapshot to timestamp and latest
            query = `
                SELECT
                    a.uuid,
                    (a.${raidColumn} - COALESCE(b.${raidColumn}, 0)) as raidCount
                FROM guild_raids a
                LEFT JOIN guild_raids b
                    ON a.uuid = b.uuid
                    AND b.captured_at = (
                        SELECT MAX(captured_at) FROM guild_raids
                        WHERE captured_at <= ?
                        AND uuid = a.uuid
                    )
                WHERE a.captured_at = (SELECT MAX(captured_at) FROM guild_raids)
                HAVING raidCount > 0
                ORDER BY raidCount DESC
            `;
            params = [timestamp];
        } else {
            query = `
                SELECT uuid, ${raidColumn} as raidCount
                FROM guild_raids
                WHERE captured_at = (SELECT MAX(captured_at) FROM guild_raids)
                HAVING raidCount > 0
                ORDER BY raidCount DESC
            `;
            params = [];
        }

        const [rows] = await pool.query(query, params);
        return new Map(rows.map(row => [row.uuid, row.raidCount]));
    } catch (err) {
        console.error('Error getting leaderboard:', err);
        return new Map();
    }
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

async function getPlayerByUUID(uuid) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT * FROM players
            WHERE uuid = ?;
        `;

        const [rows] = await connection.execute(query, [uuid]);
        connection.release();

        return rows[0] || null;
    } catch (err) {
        console.error("Error getting player by UUID: ", err);
        return null;
    }
}

// Tracker-related functions

async function setTrackerEnabled(channelId, trackerType, enabled) {
    try {
        const connection = await pool.getConnection();

        const query = `
            INSERT INTO tracker_channel_config (channel_id, tracker_type, enabled)
            VALUES (?, ?, ?)
                ON DUPLICATE KEY UPDATE enabled = VALUES(enabled);
        `;

        await connection.execute(query, [channelId, trackerType, enabled ? 1 : 0]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error setting tracker enabled: ", err);
        return false;
    }
}

async function getEnabledChannelsForTracker(trackerType) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT channel_id FROM tracker_channel_config
            WHERE tracker_type = ? AND enabled = TRUE;
        `;

        const [rows] = await connection.execute(query, [trackerType]);
        connection.release();

        return rows.map(row => row.channel_id);
    } catch (err) {
        console.error("Error getting enabled channels for tracker: ", err);
        return [];
    }
}

async function insertTerritoryEvent(territory, eventType) {
    try {
        const connection = await pool.getConnection();

        const query = `
            INSERT INTO territory_events (territory, event_type)
            VALUES (?, ?);
        `;

        await connection.execute(query, [territory, eventType]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error inserting territory event: ", err);
        return false;
    }
}

async function insertMemberEvent(uuid, username, eventType, oldRank, newRank) {
    try {
        const connection = await pool.getConnection();

        const query = `
            INSERT INTO guild_member_events (uuid, username, event_type, old_rank, new_rank)
            VALUES (?, ?, ?, ?, ?);
        `;

        await connection.execute(query, [uuid, username, eventType, oldRank, newRank]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error inserting member event: ", err);
        return false;
    }
}

async function getTrackerState(channelId, trackerType) {
    try {
        const connection = await pool.getConnection();

        const query = `
            SELECT enabled FROM tracker_channel_config
            WHERE channel_id = ? AND tracker_type = ?;
        `;

        const [rows] = await connection.execute(query, [channelId, trackerType]);
        connection.release();

        return rows.length > 0 ? rows[0].enabled === 1 : false;
    } catch (err) {
        console.error("Error getting tracker state: ", err);
        return false;
    }
}
async function saveTrackerMessage(channelId, type, messageId) {
    try {
        const connection = await pool.getConnection();
        const query = `
            INSERT INTO trackers (channel_id, type, message_id)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE message_id = ?;
        `;
        await connection.execute(query, [channelId, type, messageId, messageId]);
        connection.release();
        return true;
    } catch (err) {
        console.error("Error saving tracker message: ", err);
        return false;
    }
}

async function getTrackerMessage(channelId, type) {
    try {
        const connection = await pool.getConnection();
        const query = `
            SELECT message_id FROM trackers
            WHERE channel_id = ? AND type = ?;
        `;
        const [rows] = await connection.execute(query, [channelId, type]);
        connection.release();
        return rows.length > 0 ? rows[0].message_id : null;
    } catch (err) {
        console.error("Error fetching tracker message: ", err);
        return null;
    }
}


async function createApplication(threadId, applicantId, ign, type) {
    try {
        console.log(`[CreateApp] thread=${threadId} member=${applicantId} type=${type}`); // ✅
        console.trace();
        const connection = await pool.getConnection();
        const query = `
            INSERT INTO applications (thread_id, applicant_id, ign, type)
            VALUES (?, ?, ?, ?);
        `;
        const [result] = await connection.execute(query, [threadId, applicantId, ign, type]);
        connection.release();
        return result.insertId;
    } catch (err) {
        console.error('Error creating application:', err);
        return null;
    }
}

async function setApplicationMessageIds(applicationId, voteBarMessageId, reviewMessageId) {
    try {
        const connection = await pool.getConnection();
        const query = `
            UPDATE applications
            SET vote_bar_message_id = ?, review_message_id = ?
            WHERE id = ?;
        `;
        await connection.execute(query, [voteBarMessageId, reviewMessageId, applicationId]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error setting application message ids:', err);
        return false;
    }
}

async function getApplicationByThread(threadId) {
    try {
        const connection = await pool.getConnection();
        const query = `
            SELECT * FROM applications WHERE thread_id = ? AND status = 'pending';
        `;
        const [rows] = await connection.execute(query, [threadId]);
        connection.release();
        return rows.length > 0 ? rows[0] : null;
    } catch (err) {
        console.error('Error fetching application:', err);
        return null;
    }
}

async function getApplicationById(applicationId) {
    try {
        const connection = await pool.getConnection();
        const query = `SELECT * FROM applications WHERE id = ?;`;
        const [rows] = await connection.execute(query, [applicationId]);
        connection.release();
        return rows.length > 0 ? rows[0] : null;
    } catch (err) {
        console.error('Error fetching application by id:', err);
        return null;
    }
}

async function upsertVote(applicationId, voterId, vote) {
    try {
        const connection = await pool.getConnection();
        const query = `
            INSERT INTO application_votes (application_id, voter_id, vote)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE vote = ?;
        `;
        await connection.execute(query, [applicationId, voterId, vote, vote]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error upserting vote:', err);
        return false;
    }
}

async function getVotes(applicationId) {
    try {
        const connection = await pool.getConnection();
        const query = `
            SELECT vote, COUNT(*) as count
            FROM application_votes
            WHERE application_id = ?
            GROUP BY vote;
        `;
        const [rows] = await connection.execute(query, [applicationId]);
        connection.release();
        const accepts = rows.find(r => r.vote === 'accept')?.count ?? 0;
        const declines = rows.find(r => r.vote === 'decline')?.count ?? 0;
        return { accepts, declines };
    } catch (err) {
        console.error('Error fetching votes:', err);
        return { accepts: 0, declines: 0 };
    }
}

async function setApplicationStatus(applicationId, status) {
    try {
        console.log(`[StatusChange] App ${applicationId} → ${status} at ${new Date().toISOString()}`);
        const connection = await pool.getConnection();
        const query = `UPDATE applications SET status = ? WHERE id = ?;`;
        await connection.execute(query, [status, applicationId]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error setting application status:', err);
        return false;
    }
}

async function getApplicationByReviewMessage(messageId) {
    try {
        const connection = await pool.getConnection();
        const query = `SELECT * FROM applications WHERE review_message_id = ?;`;
        const [rows] = await connection.execute(query, [messageId]);
        connection.release();
        return rows.length > 0 ? rows[0] : null;
    } catch (err) {
        console.error('Error fetching application by review message:', err);
        return null;
    }
}


async function databaseInit() {
    const host = config.get("sql.host");
    const user = config.get("sql.user");
    const password = config.get("sql.password");
    const database = config.get("sql.database");

    console.log(`Connecting to SQL with: host=${host}, user=${user}, database=${database}`);

    pool = mysql.createPool({
        host: host,
        user: user,
        password: password,
        database: database,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        timezone: 'Z'
    });

    await createTables();
}

async function deleteTrackerMessage(channelId, type) {
    try {
        const connection = await pool.getConnection();
        const query = `
            DELETE FROM trackers
            WHERE channel_id = ? AND type = ?;
        `;
        await connection.execute(query, [channelId, type]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error deleting tracker message:', err);
        return false;
    }
}

async function getPendingApplications() {
    try {
        const connection = await pool.getConnection();
        const query = `SELECT * FROM applications WHERE status = 'pending';`;
        const [rows] = await connection.execute(query);
        connection.release();
        return rows;
    } catch (err) {
        console.error('Error fetching pending applications:', err);
        return [];
    }
}

async function updateApplicationIgn(applicationId, ign) {
    try {
        const connection = await pool.getConnection();
        const query = `UPDATE applications SET ign = ? WHERE id = ?;`;
        await connection.execute(query, [ign, applicationId]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error updating application IGN:', err);
        return false;
    }
}

async function saveApplicationAnswers(applicationId, answers, stage) {
    try {
        const connection = await pool.getConnection();
        const query = `
            UPDATE applications SET answers = ?, stage = ? WHERE id = ?;
        `;
        await connection.execute(query, [JSON.stringify(answers), stage, applicationId]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error saving application answers:', err);
        return false;
    }
}

async function saveApplicationResumeData(applicationId, data) {
    try {
        const connection = await pool.getConnection();
        const query = `UPDATE applications SET resume_data = ? WHERE id = ?;`;
        await connection.execute(query, [JSON.stringify(data), applicationId]);
        connection.release();
        return true;
    } catch (err) {
        console.error('Error saving resume data:', err);
        return false;
    }
}

async function getLatestGuildRaids(uuid = null, fromTimestamp = null) {
    try {
        if (fromTimestamp) {
            // diff between closest snapshot to fromTimestamp and latest
            const [rows] = await pool.query(`
                SELECT 
                    a.uuid,
                    (a.raid0 - COALESCE(b.raid0, 0)) as raid0,
                    (a.raid1 - COALESCE(b.raid1, 0)) as raid1,
                    (a.raid2 - COALESCE(b.raid2, 0)) as raid2,
                    (a.raid3 - COALESCE(b.raid3, 0)) as raid3,
                    (a.raid4 - COALESCE(b.raid4, 0)) as raid4,
                    (a.total - COALESCE(b.total, 0)) as total
                FROM guild_raids a
                LEFT JOIN guild_raids b
                    ON a.uuid = b.uuid
                    AND b.captured_at = (
                        SELECT MAX(captured_at) FROM guild_raids
                        WHERE captured_at <= ?
                        ${uuid ? 'AND uuid = ?' : ''}
                    )
                WHERE a.captured_at = (SELECT MAX(captured_at) FROM guild_raids)
                ${uuid ? 'AND a.uuid = ?' : ''}
            `, uuid ? [fromTimestamp, uuid, uuid] : [fromTimestamp]);
            return rows;
        }

        const [rows] = await pool.query(`
            SELECT uuid, raid0, raid1, raid2, raid3, raid4, total
            FROM guild_raids
            WHERE captured_at = (SELECT MAX(captured_at) FROM guild_raids)
            ${uuid ? 'AND uuid = ?' : ''}
            ORDER BY total DESC
        `, uuid ? [uuid] : []);
        return rows;
    } catch (err) {
        console.error('Error fetching latest guild raids:', err);
        return [];
    }
}

async function getRaidsDiff(startTimestamp, endTimestamp) {
    try {
        const [[{ endTs }]] = await pool.query(
            `SELECT MAX(captured_at) as endTs FROM guild_raids WHERE captured_at <= ?`,
            [endTimestamp]
        );
        const [[{ startTs }]] = await pool.query(
            `SELECT MAX(captured_at) as startTs FROM guild_raids WHERE captured_at <= ?`,
            [startTimestamp]
        );

        if (!endTs) return [];

        const [rows] = await pool.query(`
            SELECT
                a.uuid,
                (a.raid0 - COALESCE(b.raid0, 0)) as raid0,
                (a.raid1 - COALESCE(b.raid1, 0)) as raid1,
                (a.raid2 - COALESCE(b.raid2, 0)) as raid2,
                (a.raid3 - COALESCE(b.raid3, 0)) as raid3,
                (a.raid4 - COALESCE(b.raid4, 0)) as raid4,
                (a.total - COALESCE(b.total, 0)) as total
            FROM guild_raids a
            LEFT JOIN guild_raids b
                ON a.uuid = b.uuid
                AND b.captured_at = ?
            WHERE a.captured_at = ?
            HAVING total > 0
            ORDER BY total DESC
        `, [startTs, endTs]);

        return rows;
    } catch (err) {
        console.error('Error getting raids diff:', err);
        return [];
    }
}

module.exports = { databaseInit, insertRaid, insertWar, insertAspect, getGXPLeaderboard, getPlayerUUID,
    getPlayerUsername, insertPlayer, getRaids, getWars, getRaidCount, getAspects, getOwedAspects, getRaidLeaderboard, getWarLeaderboard, updateGuild, updateUsername, getPlayers, getPlayersByGuild, getGuild, toggleNeedsAspects,
    createAccountLink, verifyAccountLink, getAccountLink, getAccountLinkByMinecraft, getPlayerByUUID, removeAccountLink, removeAccountLinkByMinecraft, getUnverifiedAccountLink, cleanupExpiredLinks, getPlayersWithVerifiedLinks, getAccountLinksForPlayers, getPlayerByDiscordId,
    setTrackerEnabled, getEnabledChannelsForTracker, insertTerritoryEvent, insertMemberEvent, getTrackerState, saveTrackerMessage, getTrackerMessage, createApplication, setApplicationMessageIds, getApplicationByThread,
    getApplicationById, upsertVote, getVotes, setApplicationStatus, getApplicationByReviewMessage, deleteTrackerMessage, getPendingApplications, saveApplicationAnswers, saveApplicationResumeData, updateApplicationIgn,insertRaidSnapshot,
    getLatestGuildRaids, getRaidsDiff, getPlayerByUUID};
