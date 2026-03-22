const { getWynnGuild } = require("../player/wynn-api");
const { insertMemberEvent, getEnabledChannelsForTracker } = require("../../core/database");
const { EmbedBuilder } = require("discord.js");

let discordClient = null;
let updateInterval = null;
let isUpdating = false;
let cachedMembers = {};

async function initializeGuildMemberTracker(client) {
    discordClient = client;
    console.log('Initializing Guild Member Tracker...');
    
    try {
        await updateGuildMemberTracking();
        
        updateInterval = setInterval(updateGuildMemberTracking, 30 * 1000); // 30-second polling
        console.log('Guild member tracker initialized with 30-second refresh interval.');
    } catch (error) {
        console.error('Failed to initialize guild member tracker:', error);
    }
}

async function updateGuildMemberTracking() {
    if (isUpdating) {
        return;
    }
    
    isUpdating = true;
    
    try {
        const guildData = await getWynnGuild();
        const currentMembers = parseGuildMembers(guildData);
        
        await compareAndRecordMemberChanges(currentMembers);
        
        cachedMembers = currentMembers;
    } catch (error) {
        console.error('Error updating guild member tracking:', error);
    } finally {
        isUpdating = false;
    }
}

function parseGuildMembers(guildData) {
    const members = {};
    
    const rankCategories = [
        { name: 'recruit', value: 1 },
        { name: 'recruiter', value: 2 },
        { name: 'captain', value: 3 },
        { name: 'strategist', value: 4 },
        { name: 'chief', value: 5 },
        { name: 'owner', value: 6 }
    ];
    
    rankCategories.forEach(rank => {
        if (guildData.members && guildData.members[rank.name]) {
            Object.keys(guildData.members[rank.name]).forEach(uuid => {
                const memberData = guildData.members[rank.name][uuid];
                members[uuid] = {
                    uuid: uuid,
                    username: memberData.username,
                    rank: rank.value
                };
            });
        }
    });
    
    return members;
}

async function compareAndRecordMemberChanges(currentMembers) {
    // Handle initial run - no prior state to compare
    if (Object.keys(cachedMembers).length === 0 && Object.keys(currentMembers).length > 0) {
        console.log('Guild member tracker: Initial state set, no events recorded');
        return;
    }
    
    // Detect joined members
    for (const uuid in currentMembers) {
        if (!cachedMembers[uuid]) {
            const member = currentMembers[uuid];
            console.log(`Member joined: ${member.username} (${uuid})`);
            await insertMemberEvent(uuid, member.username, 'joined', null, member.rank);
            await broadcastMemberEvent(member.username, 'joined', null, member.rank);
        }
    }
    
    // Detect left members and rank changes
    for (const uuid in cachedMembers) {
        if (!currentMembers[uuid]) {
            const member = cachedMembers[uuid];
            console.log(`Member left: ${member.username} (${uuid})`);
            await insertMemberEvent(uuid, member.username, 'left', member.rank, null);
            await broadcastMemberEvent(member.username, 'left', member.rank, null);
        } else if (cachedMembers[uuid].rank !== currentMembers[uuid].rank) {
            const oldMember = cachedMembers[uuid];
            const newMember = currentMembers[uuid];
            const eventType = newMember.rank > oldMember.rank ? 'rank_changed' : 'rank_changed';
            console.log(`Member rank changed: ${newMember.username} (${uuid}) from rank ${oldMember.rank} to ${newMember.rank}`);
            await insertMemberEvent(uuid, newMember.username, eventType, oldMember.rank, newMember.rank);
            await broadcastMemberEvent(newMember.username, eventType, oldMember.rank, newMember.rank);
        }
    }
}

async function broadcastMemberEvent(username, eventType, oldRank, newRank) {
    if (!discordClient) {
        console.warn('Discord client not available for broadcasting');
        return;
    }
    
    try {
        const enabledChannels = await getEnabledChannelsForTracker('members');
        
        if (enabledChannels.length === 0) {
            console.log(`No channels subscribed to member events`);
            return;
        }
        
        let title = '';
        let color = 0x0000AA;
        let description = '';
        
        if (eventType === 'joined') {
            title = 'Member Joined';
            color = 0x00AA00; // Green
            description = `${username} has joined the guild`;
        } else if (eventType === 'left') {
            title = 'Member Left';
            color = 0xAA0000; // Red
            description = `${username} has left the guild`;
        } else if (eventType === 'rank_changed') {
            const rankNames = ['', 'Recruit', 'Recruiter', 'Captain', 'Strategist', 'Chief', 'Owner'];
            const oldRankName = oldRank ? rankNames[oldRank] : 'Unknown';
            const newRankName = newRank ? rankNames[newRank] : 'Unknown';
            
            if (newRank > oldRank) {
                title = 'Member Promoted';
                color = 0x0085ff;
                description = `${username} promoted from **${oldRankName}** to **${newRankName}**`;
            } else {
                title = 'Member Demoted';
                color = 0x0085ff;
                description = `${username} demoted from **${oldRankName}** to **${newRankName}**`;
            }
        }
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp();
        
        for (const channelId of enabledChannels) {
            try {
                const channel = await discordClient.channels.fetch(channelId);
                if (channel && channel.isTextBased()) {
                    await channel.send({ embeds: [embed] });
                    console.log(`Member event broadcast to channel ${channelId}`);
                }
            } catch (error) {
                console.error(`Failed to send member event to channel ${channelId}:`, error);
            }
        }
    } catch (error) {
        console.error('Error broadcasting member event:', error);
    }
}

function getGuildMemberTrackerState() {
    return {
        isRunning: updateInterval !== null,
        cachedMemberCount: Object.keys(cachedMembers).length,
        isUpdating: isUpdating
    };
}

module.exports = { initializeGuildMemberTracker, getGuildMemberTrackerState };
