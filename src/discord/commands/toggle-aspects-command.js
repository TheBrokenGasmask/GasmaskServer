const {config} = require('../../core/config');
const {SlashCommandBuilder} = require('discord.js');
const {getPlayerUUID, getGuild, getPlayerByUUID, toggleNeedsAspects} = require('../../core/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('toggle-aspects')
        .setDescription('Toggles whether a player needs aspects or not')    
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

        //temp restriction
        const alertConfig = config.get('alert-command');
            const requiredRoleId = alertConfig['required-role-id'];

        if (requiredRoleId && !interaction.member.roles.cache.has(requiredRoleId)) {
            const noPermissionEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Permission Denied')
                .setDescription('You do not have permission to use this command.')
                .setTimestamp();
            await interaction.editReply({ embeds: [noPermissionEmbed] });
            return;
         }


        let toggleResult = await toggleNeedsAspects(uuid);
        console.log(`Toggled needs_aspects for player ${playerName} (UUID: ${uuid}): ${toggleResult}`);

        if (toggleResult) {
            await interaction.reply(`Successfully toggled needs_aspects for player ${playerName}`);
        } else {
            await interaction.reply(`Failed to toggle needs_aspects for player ${playerName}`);
        }
    },
};