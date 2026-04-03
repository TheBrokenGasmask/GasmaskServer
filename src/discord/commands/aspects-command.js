const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const {getPlayerUUID, getRaids, getPlayerUsername, getAspects, getGuild, getPlayerByUUID} = require("../../core/database");
const { config } = require("../../core/config");
const {createAspectsCard} = require("../../discord/image-generation/aspects-card");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('aspects')
        .setDescription('Returns data on the given player\'s received guild aspects')
        .addStringOption(option =>
            option.setName('player')
                .setDescription('The name of the player')
                .setRequired(true)),
    async execute(interaction) {
        let playerName = interaction.options.getString('player');
        let uuid = await getPlayerUUID(playerName);

        if (!uuid) {
            await interaction.reply(`Unable to find player with the name ${playerName}`);
            return;
        }

        let guild = await getGuild(uuid);

        if (!guild || guild !== config.get("guild-tag")) {
            await interaction.reply(`Player is not in the guild`);
            return;
        }

        playerName = await getPlayerUsername(uuid);

        let aspectData = await getAspects(uuid);
        let raidData = await getRaids(uuid);
        let playerData = await getPlayerByUUID(uuid);

        let totalAspects = aspectData.length;
        let owedAspects = Math.max(Math.floor(raidData.length / 2) - totalAspects, 0);
        let needsAspects = playerData?.needs_aspects ?? true;

        const cardBuffer = await createAspectsCard(uuid, playerName, raidData.length, totalAspects, owedAspects, needsAspects);

        const attachment = new AttachmentBuilder(cardBuffer, {
            name: 'aspects-card.png'
        });

        await interaction.reply({ files: [attachment] });
    },
};
