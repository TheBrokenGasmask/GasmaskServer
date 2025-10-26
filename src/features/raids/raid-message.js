const { EmbedBuilder } = require('discord.js');
const { config } = require("../../core/config");
const { getRaidCount } = require("../../core/database");
const { client } = require("../../discord/discord-bot")
const {formatTime} = require("../../core/utilities");

const raids = ["Nest of the Grootslangs",
    "Orphion's Nexus of Light",
    "The Canyon Colossus",
    "The Nameless Anomaly"
]

const raidsAbbr = [
    "NOTG",
    "NOL",
    "TCC",
    "TNA",
]

function getWeeklyTimestamp() {
    const now = new Date();
    const estNow = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
    const currentDay = estNow.getDay();
    
    let daysToSubtract;
    if (currentDay === 5) {
        if (estNow.getHours() < 12) {
            daysToSubtract = 7;
        } else {
            daysToSubtract = 0;
        }
    } else if (currentDay === 6) {
        daysToSubtract = 1;
    } else if (currentDay === 0) {
        daysToSubtract = 2;
    } else {
        daysToSubtract = currentDay + 2;
    }
    
    const targetDate = new Date(estNow);
    targetDate.setDate(estNow.getDate() - daysToSubtract);
    targetDate.setHours(12, 0, 0, 0);
    return targetDate;
}

async function sendRaidEmbed(raidID, player1, player2, player3, player4, time) {
    this.config = config.get('chat-bridge');
    const channelId = this.config['channel-id'];
    try {
        const channel = await client.channels.fetch(channelId);
        const weeklyTimestamp = getWeeklyTimestamp();
        const mysqlTimestamp = weeklyTimestamp.toISOString().slice(0, 19).replace('T', ' ');
        const specificRaidCount = await getRaidCount(raidID);
        const totalRaidCount = await getRaidCount();
        const weeklyRaidCount = await getRaidCount(null, mysqlTimestamp);

        const durationString = `Duration: ${formatTime(time)}\n`;

        const embed = new EmbedBuilder()
            .setTitle(`${player1}, ${player2}, ${player3}, & ${player4} Completed ${raids[raidID]}`)
            .setDescription((time === null ? '' : durationString) + `All time ${raidsAbbr[raidID]}'s: ${specificRaidCount}\nAll time guild raids: ${totalRaidCount}\nGuild raids this week: ${weeklyRaidCount}`)
            .setColor(0x0099FF)

        const messageOptions = { embeds: [embed] };

        await channel.send(messageOptions);
        console.log(`Embed sent successfully to channel ${channelId}`);
        return true;

    } catch (error) {
        console.error(`Failed to send embed to channel ${channelId}:`, error.message);
        return false;
    }
}

module.exports = {sendRaidEmbed}