const { getPlayersByGuild } = require("../../core/database");
const { rankService } = require("../ranks/rank-service");
const { badgesService } = require("../badges/badges-service");
const { config } = require("../../core/config");

class PlayersEndpoint {
    async call(req, res) {
        try {
            // Get all players in the guild from config
            const guildTag = config.get("guild-tag");
            const guildPlayers = await getPlayersByGuild(guildTag);
            
            // Extract Discord IDs from players data for batch rank fetching
            const discordIds = guildPlayers
                .filter(player => player.discord_id)
                .map(player => player.discord_id);
            
            // Batch fetch all Discord ranks at once
            const rankMap = await rankService.getBatchMemberRanks(discordIds);

            // Build response data
            const playersWithData = [];
            
            for (const player of guildPlayers) {
                try {
                    let rankInfo = null;
                    const discordId = player.discord_id;

                    if (discordId) {
                        const memberRank = rankMap.get(discordId);
                        if (memberRank) rankInfo = memberRank.identifier;
                    } else {
                        rankInfo = this.getGuildRankString(player.guild_rank);
                    }

                    // Get badges for this player
                    const playerBadges = await badgesService.getPlayerBadges(player.uuid, {
                        uuid: player.uuid,
                        username: player.username,
                        guild: player.guild,
                        needs_aspects: player.needs_aspects
                    });

                    console.log(player.username, player.guild_rank);

                    const playerData = {
                        uuid: player.uuid,
                        username: player.username,
                        guild: player.guild,
                        rank: rankInfo,
                        multiple_ranks: (discordId ? player.guild_rank.star : false),
                        needs_aspects: player.needs_aspects,
                        badges: playerBadges,
                        has_discord_link: !!discordId
                    };

                    playersWithData.push(playerData);
                } catch (error) {
                    console.error(`Error processing player ${player.username}:`, error);
                }
            }

            res.status(200).json(playersWithData);
        } catch (error) {
            console.error("Error in players endpoint:", error);
            res.status(500).json({ error: "Internal server error" });
        }
    }

     getGuildRankString(stars) {
        switch (stars) {
            case 0: return "Recruit";
            case 1: return "Recruiter";
            case 2: return "Captain";
            case 3: return "Strategist";
            case 4: return "Chief";
            case 5: return "Owner";
            default: return "Recruit";
        }
    }
}

module.exports = { PlayersEndpoint };