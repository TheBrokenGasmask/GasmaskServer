const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require("discord.js");
const { saveTrackerMessage, getTrackerMessage, setTrackerEnabled, getApplicationState, deleteTrackerMessage } = require("../../core/database");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('application')
        .setDescription('Manage application trackers')
        .addSubcommand(subcommand =>
            subcommand
                .setName('join')
                .setDescription('Post a join application tracker')
                .addBooleanOption(option =>
                    option
                        .setName('include_veteran')
                        .setDescription('Add a returning member button alongside the join button')
                        .setRequired(false)))
        .addSubcommand(sub =>
            sub.setName('rank').setDescription('Post a rank promotion tracker'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove the application tracker from this channel')
                .addStringOption(option =>
                    option
                        .setName('type')
                        .setDescription('Which tracker to remove')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Join', value: 'join' },
                            { name: 'Rank', value: 'rank' },
                            { name: 'All', value: 'all' }
                        ))),

async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const channelId = interaction.channelId;

    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
        return interaction.reply({
            content: '❌ You need **Manage Channels** permission.',
            ephemeral: true
        });
    }

    // ✅ Handle remove before any tracker checks
    if (subcommand === 'remove') {
        const type = interaction.options.getString('type');
        const typesToRemove = type === 'all' ? ['join', 'rank'] : [type];
        let removed = 0;

        for (const t of typesToRemove) {
            const messageId = await getTrackerMessage(channelId, t);
            if (messageId) {
                try {
                    const msg = await interaction.channel.messages.fetch(messageId);
                    await msg.delete();
                } catch {
                    // Message already deleted, still clean up DB
                }
                await deleteTrackerMessage(channelId, t);
                removed++;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(removed > 0 ? 0x00AA00 : 0xFF4444)
            .setTitle(removed > 0 ? '✅ Tracker Removed' : '❌ No Tracker Found')
            .setDescription(
                removed > 0
                    ? `Successfully removed **${removed}** tracker(s) from this channel.`
                    : `No **${type}** tracker was found in this channel.`
            )
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // ✅ Duplicate check only runs for join/rank now
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
                ? 'You have to be lvl 110+ to apply, if you\'re below lvl 110, you cannot join until you reach that level.\n\nClick on the button below to create an application to join [TBGM] The Broken Gasmask and please wait for advisors+ to review your application within a day.\n\nReturning members are former members who used to be part of TBGM before may click the returning members below'
                : 'Ready for a rank promotion? Click the button below to start your application.'
        )
        .setFooter({ text: 'TBGM Application System' })
        .setTimestamp();

    const includeVeteran = interaction.options.getBoolean('include_veteran') ?? false;

    const joinButton = new ButtonBuilder()
        .setCustomId('open_application:join')
        .setLabel('📩 Apply to Join')
        .setStyle(ButtonStyle.Danger);

    const veteranButton = new ButtonBuilder()
        .setCustomId('open_application:veteran')
        .setLabel('🔄 Returning Member')
        .setStyle(ButtonStyle.Secondary);

    const rankButton = new ButtonBuilder()
        .setCustomId('open_application:rank')
        .setLabel('⬆️ Apply for Promotion')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder().addComponents(
        subcommand === 'join'
            ? (includeVeteran ? [joinButton, veteranButton] : [joinButton])
            : [rankButton]
    );

    await interaction.reply({ embeds: [embed], components: [row] });

    const sent = await interaction.fetchReply();
    await saveTrackerMessage(channelId, subcommand, sent.id);
    }
};