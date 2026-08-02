const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { getGuildRaids, getPlayerUsername, getPlayerUUID } = require("../../core/database");
const { createRaidCard } = require("../../discord/image-generation/raids-card");
const { daysToTimestamp } = require("../../core/utilities");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raids')
        .setDescription('Returns the latest guild raid snapshot')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('Filter by player name')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('days')
                .setDescription('Number of days to look back')
                .setRequired(false)
                .setMinValue(1)),
    async execute(interaction) {
        await interaction.deferReply();

        const playerName = interaction.options.getString('player');
        const days = interaction.options.getInteger('days');
        const uuid = await getPlayerUUID(playerName);

        if (!uuid) {
            await interaction.editReply(`Could not find player ${playerName}.`);
            return;
        }

        const rows = await getGuildRaids(uuid, days ? daysToTimestamp(days) : null, null);

        if (!rows.length) {
            await interaction.editReply(`No raid data found for ${playerName}.`);
            return;
        }

        const row = rows[0];
        const raidCounts = [row.raid0, row.raid1, row.raid2, row.raid3, row.raid4];
        const totalRaids = row.total;

        const resolvedName = await getPlayerUsername(uuid);
        const cardBuffer = await createRaidCard(uuid, resolvedName, raidCounts, totalRaids, days);
        const attachment = new AttachmentBuilder(cardBuffer, { name: 'raid-card.png' });

        await interaction.editReply({ files: [attachment] });
    }
};