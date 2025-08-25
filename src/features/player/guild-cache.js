const {getWynnGuild} = require("./wynn-api");

let guildMemberCache = null;
let updateInterval = null;
let isUpdating = false;

async function parseGuildMembers() {
    try {
        const guildData = await getWynnGuild();
        const members = [];
        
        const rankCategories = [
            { name: 'recruit', value: 1 },
            { name: 'recruiter', value: 2 },
            { name: 'captain', value: 3 },
            { name: 'strategist', value: 4 },
            { name: 'chief', value: 5 },
            { name: 'owner', value: 6 }
        ];
        
        rankCategories.forEach(rank => {
            if (guildData.members[rank.name]) {
                Object.keys(guildData.members[rank.name]).forEach(uuid => {
                    const memberData = guildData.members[rank.name][uuid];
                    
                    members.push({
                        uuid: uuid,
                        username: memberData.username,
                        rank: rank.value
                    });
                });
            }
        });
        
        return {
            members: members,
            totalMembers: guildData.members.total,
            lastUpdated: new Date().toISOString()
        };
        
    } catch (error) {
        console.error('Error parsing guild members:', error);
        throw error;
    }
}

async function updateGuildCache() {
    if (isUpdating) {
        return;
    }
    
    isUpdating = true;
    
    try {
        const newData = await parseGuildMembers();
        guildMemberCache = newData;
        console.log(`Guild cache updated successfully. ${newData.totalMembers} members cached.`);
    } catch (error) {
        console.error('Failed to update guild cache:', error);
    } finally {
        isUpdating = false;
    }
}

async function initializeGuildCache() {
    console.log('Initializing guild member cache...');
    
    try {
        await updateGuildCache();
        
        updateInterval = setInterval(updateGuildCache, 120000);
        
        console.log('Guild cache initialized successfully with 120-second refresh interval.');
        return true;
    } catch (error) {
        console.error('Failed to initialize guild cache:', error);
        return false;
    }
}

function getGuildCache() {
    if (!guildMemberCache) {
        throw new Error('Guild cache not initialized.');
    }
    return guildMemberCache;
}

function getMemberByUuid(uuid) {
    const cache = getGuildCache();
    return cache.members.find(member => member.uuid === uuid) || null;
}

function getMemberByUsername(username) {
    const cache = getGuildCache();
    return cache.members.find(member => 
        member.username.toLowerCase() === username.toLowerCase()
    ) || null;
}

async function forceUpdateCache() {
    await updateGuildCache();
}

module.exports = {
    initializeGuildCache,
    getGuildCache,
    getMemberByUuid,
    getMemberByUsername,
    forceUpdateCache
};