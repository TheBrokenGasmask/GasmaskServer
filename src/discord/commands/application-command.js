const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { saveTrackerMessage, getTrackerMessage } = require("../../core/database");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Manage application trackers')
        .addSubcommand(sub =>
            sub.setName('join').setDescription('Post a join application tracker'))
        .addSubcommand(sub =>
            sub.setName('rank').setDescription('Post a rank promotion tracker')),

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        const channelId = interaction.channelId;

        if (!interaction.member.permissions.has('MANAGE_CHANNELS')) {
            return interaction.reply({
                content: '❌ You need **Manage Channels** permission.',
                ephemeral: true
            });
        }

        // Prevent duplicate trackers in the same channel
        const existing = await getTrackerMessage(channelId, subcommand);
        if (existing) {
            return interaction.reply({
                content: `⚠️ A **${subcommand}** tracker already exists in this channel.`,
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor(0xAA0000)
            .setTitle(`📋 TBGM — ${subcommand === 'join' ? 'Guild Application' : 'Rank Promotion'}`)
            .setDescription(
                subcommand === 'join'
                    ? 'Want to join the guild? Click the button below to open an application ticket.'
                    : 'Ready for a rank promotion? Click the button below to start your application.'
            )
            .setFooter({ text: 'TBGM Application System' })
            .setTimestamp();

        // Button with a custom_id that encodes the type
        const button = new ButtonBuilder()
            .setCustomId(`open_application:${subcommand}`)
            .setLabel(subcommand === 'join' ? '📩 Apply to Join' : '⬆️ Apply for Promotion')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(button);

        // Send the tracker message publicly
        await interaction.reply({ embeds: [embed], components: [row] });

        // Fetch the reply so we have the message ID to store
        const sent = await interaction.fetchReply();
        await saveTrackerMessage(channelId, subcommand, sent.id);
    }
};