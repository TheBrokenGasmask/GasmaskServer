const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const { setTrackerEnabled, getApplicationState } = require("../../core/database");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('joinapplication')
        .setDescription('Create a application to join the guild')
        .addSubcommand(subcommand =>
            subcommand
                .setName('join')
                .setDescription('Create a application to join the guild'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('rank')
                .setDescription('Create a application to apply for a rank promotion')),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const channelId = interaction.channelId;

        // Check if user has required permissions
        if (!interaction.member.permissions.has('MANAGE_CHANNELS')) {
            const noPermissionEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Permission Denied')
                .setDescription('You need the "Manage Channels" permission to use this command.')
                .setTimestamp();
            
            await interaction.reply({ embeds: [noPermissionEmbed], ephemeral: true });
            return;
        }

        try { 
            const currentState = await getApplicationState(channelId, subcommand);
            const newState = !currentState;
            
            await setTrackerEnabled(channelId, subcommand, newState);
            
            const statusText = newState ? '✅ Enabled' : '❌ Disabled';
            const trackerName = subcommand === 'territory' ? 'Territory Tracker' : 'Guild Member Tracker';
            
            const embed = new EmbedBuilder()
                .setColor(newState ? 0x00AA00 : 0xAA0000)
                .setTitle(`${trackerName} ${statusText}`)
                .setDescription(`${trackerName} is now **${newState ? 'enabled' : 'disabled'}** in this channel.`)
                .addFields(
                    { name: 'Tracker Type', value: subcommand.charAt(0).toUpperCase() + subcommand.slice(1), inline: true },
                    { name: 'Status', value: newState ? '✅ Active' : '❌ Inactive', inline: true },
                    { 
                        name: 'Updates', 
                        value: subcommand === 'territory' 
                            ? 'You will receive notifications about territory gains and losses.' 
                            : 'You will receive notifications about guild member joins, leaves, and rank changes.', 
                        inline: false 
                    }
                )
                .setFooter({ text: 'Tracker System' })
                .setTimestamp();
            
            await interaction.reply({ embeds: [embed], ephemeral: false });
        } catch (error) {
            console.error('Error executing application command:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Error')
                .setDescription('An error occurred while processing your request.')
                .setTimestamp();
            
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
};