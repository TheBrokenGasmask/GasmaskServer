const {SlashCommandBuilder, EmbedBuilder} = require('discord.js');
const {ranks} = require('../../core/config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rankup') 
        .setDescription('Check your progress towards the next rank!')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Your in-game username')
                .setRequired(true)),

    async execute(interaction) {
        try {
            await interaction.deferReply({ ephemeral: true });
            const username = interaction.options.getString('username');
            
            const embed = new EmbedBuilder()
                .setColor(0x3498db)
                .setTitle(`Rank Progress for ${username}`)
                .addFields(
                    { name: 'Current Rank', value: 'Rank 5', inline: true },
                    { name: 'Next Rank', value: 'Rank 6', inline: true },
                    { name: 'Progress', value: '75%', inline: true }
                )
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } catch (error) {
            console.error(error);
            await interaction.editReply({ content: 'An error occurred while fetching your rank progress.' });
        }
    }
}
