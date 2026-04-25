const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const axios = require('axios');
const {getPlayerUUID, getRaids, getPlayerUsername} = require("../../core/database");
const {daysToTimestamp} = require("../../core/utilities");
const {createRaidCard} = require("../../discord/image-generation/raids-card");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raids')
        .setDescription('Returns data on the given player\'s completed guild raids')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The name of the player')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('days')
                .setDescription('The time period to check for raids')
        ),
    async execute(interaction) {
        let playerName = interaction.options.getString('player');
        let uuid = await getPlayerUUID(playerName);

        let days = interaction.options.getString('days');
        if (days) days = parseInt(days);

        if (!uuid) {
            await interaction.reply(`Unable to find player with the name ${playerName}`);
            return;
        }

        playerName = await getPlayerUsername(uuid);

        let raidCounts = [0, 0, 0, 0, 0]
        let raidsData = await getRaids(uuid, daysToTimestamp((days) ? days : -1));
        let totalRaids = 0
        for (let i = 0; i < raidsData.length; i++) {
            let raidIndex = raidsData[i].raid;
            raidCounts[raidIndex]++;
            totalRaids++;
        }
        
        const cardBuffer = await createRaidCard(uuid, playerName, raidCounts, totalRaids, days);

        const attachment = new AttachmentBuilder(cardBuffer, { 
            name: 'raid-card.png' 
        });

        await interaction.reply({files: [attachment] });
    },
};