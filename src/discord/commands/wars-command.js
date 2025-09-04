const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require("discord.js");
const axios = require('axios');
const {getPlayerUUID, getPlayerUsername, getWars} = require("../../core/database");
const {daysToTimestamp} = require("../../core/utilities");
const {createWarCard} = require("../image-generation/wars-card");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wars')
        .setDescription('Returns data on the given player\'s won wars')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The name of the player')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('days')
                .setDescription('The time period to check for wars')
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

        let warCounts = [0, 0, 0, 0]
        let warsData = await getWars(uuid, daysToTimestamp((days) ? days : -1));
        let totalWars = 0

        let warService = require('../../features/wars/report-war-endpoint').warService;

        for (let i = 0; i < warsData.length; i++) {
            let towerEhp = warsData[i]['tower_ehp'];
            let towerDps = warsData[i]['tower_dps'];

            let difficulty = warService.getWarDifficulty(towerEhp, towerDps);
            console.log(difficulty);
            let difficultyIndex = warService.getDifficultyIndex(difficulty);
            console.log(difficultyIndex);

            warCounts[difficultyIndex]++;
            totalWars++;
        }
        
        const cardBuffer = await createWarCard(uuid, playerName, warCounts, totalWars, days);

        const attachment = new AttachmentBuilder(cardBuffer, { 
            name: 'war-card.png'
        });

        await interaction.reply({files: [attachment] });
    },
};