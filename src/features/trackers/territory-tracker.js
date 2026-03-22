const { getWynnGuild, getTerritoryList } = require("../player/wynn-api");
const { insertTerritoryEvent, getEnabledChannelsForTracker } = require("../../core/database");
const { EmbedBuilder } = require("discord.js");
const { config } = require("../../core/config");

let discordClient = null;
let updateInterval = null;
let isUpdating = false;
let cachedTerritories = [];
let cachedAllTerritories = {}; // Track ALL territories to see who owns them
let isFirstRun = true;

async function initializeTerritoryTracker(client) {
    discordClient = client;
    console.log('Initializing Territory Tracker...');
    
    try {
        await updateTerritoryTracking();
        updateInterval = setInterval(updateTerritoryTracking, 60 * 1000);
        console.log('Territory tracker initialized with 1-minute refresh interval.');
    } catch (error) {
        console.error('Failed to initialize territory tracker:', error);
    }
}

async function updateTerritoryTracking() {
    if (isUpdating) return;
    isUpdating = true;
    
    try {
        const territoriesObj = await getTerritoryList();
        const guildTag = config.get("guild-tag");
        
        // Keep all territories for lookup
        const allTerritories = Object.entries(territoriesObj).map(([name, data]) => ({
            name,
            ...data
        }));
        
        // Filter only our guild's territories
        const guildTerritories = allTerritories
            .filter(t => t.guild?.prefix === guildTag)
            .map(t => ({
                name: t.name,
                guild: t.guild
            }));
        
        console.log(`Found ${guildTerritories.length} territories for guild ${guildTag}`);
        
        await compareAndRecordTerritoryChanges(guildTerritories, allTerritories);
        cachedTerritories = guildTerritories;
        cachedAllTerritories = Object.fromEntries(allTerritories.map(t => [t.name, t]));
        
        if (isFirstRun) {
            isFirstRun = false;
        }
    } catch (error) {
        console.error('Error updating territory tracking:', error);
    } finally {
        isUpdating = false;
    }
}

async function compareAndRecordTerritoryChanges(currentTerritories, allTerritories) {
    // Skip on initial run to avoid spam
    if (isFirstRun && currentTerritories.length > 0) {
        console.log(`Territory tracker: Initial state set with ${currentTerritories.length} territories`);
        return;
    }
    
    const currentNames = new Set(currentTerritories.map(t => t.name));
    const cachedNames = new Set(cachedTerritories.map(t => t.name));
    
    // Build maps for quick lookup
    const currentMap = Object.fromEntries(currentTerritories.map(t => [t.name, t]));
    const allTerritoriesMap = Object.fromEntries(allTerritories.map(t => [t.name, t]));
    
    // Detect gained territories
    for (const territory of currentNames) {
        if (!cachedNames.has(territory)) {
            const previousOwner = cachedAllTerritories[territory]?.guild;
            console.log(`Territory gained: ${territory} (from ${previousOwner?.prefix || 'Unknown'})`);
            await insertTerritoryEvent(territory, 'gained');
            await broadcastTerritoryEvent(territory, 'gained', previousOwner);
        }
    }
    
    // Detect lost territories
    for (const territory of cachedNames) {
        if (!currentNames.has(territory)) {
            const newOwner = allTerritoriesMap[territory]?.guild;
            console.log(`Territory lost: ${territory} (to ${newOwner?.prefix || 'Unknown'})`);
            await insertTerritoryEvent(territory, 'lost');
            await broadcastTerritoryEvent(territory, 'lost', newOwner);
        }
    }
}

async function broadcastTerritoryEvent(territory, eventType, guild) {
    if (!discordClient) {
        console.warn('Discord client not available for broadcasting');
        return;
    }
    
    try {
        const enabledChannels = await getEnabledChannelsForTracker('territory');
        
        if (enabledChannels.length === 0) {
            console.log('No channels subscribed to territory events');
            return;
        }
        
        const color = eventType === 'gained' ? 0x05ff00 : 0xff0000;
        const title = eventType === 'gained' ? 'Territory Gained' : 'Territory Lost';
        
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .addFields(
                { name: 'Territory', value: territory, inline: true },
                { name: eventType === 'gained' ? 'Taken From' : 'Taken By', value: guild?.prefix || 'Unknown', inline: true },
            )
            .setTimestamp();
        
        for (const channelId of enabledChannels) {
            try {
                const channel = await discordClient.channels.fetch(channelId);
                if (channel && channel.isTextBased()) {
                    await channel.send({ embeds: [embed] });
                }
            } catch (error) {
                console.error(`Failed to send to channel ${channelId}:`, error);
            }
        }
    } catch (error) {
        console.error('Error broadcasting territory event:', error);
    }
}

function getTerritoryTrackerState() {
    return {
        isRunning: updateInterval !== null,
        cachedTerritories: cachedTerritories.map(t => t.name),
        isUpdating: isUpdating
    };
}

module.exports = { initializeTerritoryTracker, getTerritoryTrackerState };