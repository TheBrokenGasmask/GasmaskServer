const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlayerUsername, getGuildRaids} = require("../../core/database");
const {raids, daysToTimestamp, getLastPoolReset} = require("../../core/utilities");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raid-leaderboard')
        .setDescription('Returns guild raid leaderboard rankings')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('The type of leaderboard to display')
                .setRequired(true)
                .addChoices(...getChoices())
        )
        .addStringOption(option =>
            option.setName('period')
                .setDescription('The time period for the leaderboard')
                .addChoices(
                    { name: 'All Time', value: 'all' },
                    { name: 'This Week', value: 'thisweek' },
                    { name: 'Last Week', value: 'lastweek' },
                    { name: 'Custom Days', value: 'custom' }
                )
                .setRequired(false)
        )
        .addStringOption(option =>
            option.setName('days')
                .setDescription('Number of days (only used when period is "Custom Days")')
        ),
    async execute(interaction) {
        await interaction.deferReply();

        const period = interaction.options.getString('period') || 'all';
        let days = interaction.options.getString('days');
        let startTimestamp = null;
        let endTimestamp = null;
        let periodDescription;

        if (period === 'thisweek') {
            startTimestamp = getLastPoolReset()
            periodDescription = 'This Week';
        } else if (period === 'lastweek') {
            startTimestamp = getLastPoolReset(1);
            endTimestamp = getLastPoolReset()
            periodDescription = 'Last Week';
        } else if (period === 'custom' && days) {
            days = parseInt(days);
            startTimestamp = daysToTimestamp(days);
            periodDescription = `Last ${days} Day${days !== 1 ? "s" : ""}`;
        }

        let raid = interaction.options.getString('type');
        raid = parseInt(raid);
        
        const raidColumn = raid === -1 ? 'total' : `raid${raid}`;

        const rows = await getGuildRaids(null, startTimestamp, endTimestamp);

        const leaderData = rows
            .map(row => ({ uuid: row.uuid, raidCount: row[raidColumn] }))
            .filter(row => row.raidCount > 0)
            .sort((a, b) => b.raidCount - a.raidCount);

        const fields = await Promise.all(
            leaderData.map(async ({ uuid, raidCount }) => {
                const playerName = await getPlayerUsername(uuid);
                return { name: playerName, value: `\`\`\`${raidCount}\`\`\`` };
            })
        );

        const itemsPerPage = 10;
        const totalPages = Math.ceil(fields.length / itemsPerPage);

        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const currentFields = fields.slice(start, start + itemsPerPage);

            return new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(getRaidName(raid))
                .setAuthor({ name: 'Guild Raid Leaderboard' })
                .setDescription(`*${periodDescription}*`)
                .addFields(...currentFields)
                .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
        };

        let currentPage = 0;
        const embedMessage = await interaction.editReply({ embeds: [generateEmbed(currentPage)], fetchReply: true });

        if (totalPages > 1) {
            const generateActionRow = (page) => {
                return new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId('prev')
                            .setLabel('Previous')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === 0),
                        new ButtonBuilder()
                            .setCustomId('next')
                            .setLabel('Next')
                            .setStyle(ButtonStyle.Primary)
                            .setDisabled(page === totalPages - 1)
                    );
            };

            await interaction.editReply({ components: [generateActionRow(currentPage)] });

            const filter = i => i.customId === 'prev' || i.customId === 'next';
            const collector = embedMessage.createMessageComponentCollector({ filter, time: 600000 });

            collector.on('collect', async i => {
                if (i.customId === 'prev' && currentPage > 0) currentPage--;
                else if (i.customId === 'next' && currentPage < totalPages - 1) currentPage++;

                await i.update({ embeds: [generateEmbed(currentPage)], components: [generateActionRow(currentPage)] });
            });

            collector.on('end', () => {
                interaction.editReply({ components: [] });
            });
        }
    },
};

function getChoices() {
    let choices = [];
    raids.forEach(raid => choices.push({ name: raid.name, value: `${raid.id}` }));
    return choices;
}

function getRaidName(raid) {
    return raids.find(r => r.id === raid).name;
}