const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getPlayerUsername, getWarLeaderboard} = require("../../core/database");
const {daysToTimestamp, getLastPoolReset} = require("../../core/utilities");
const {warService, Difficulty} = require("../../features/wars/report-war-endpoint");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('war-leaderboard')
        .setDescription('Returns war leaderboard rankings')
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
        const period = interaction.options.getString('period') || 'all';
        let days = interaction.options.getString('days');
        let timestamp;
        let periodDescription;

        if (period === 'thisweek') {
            timestamp = getLastPoolReset()
            periodDescription = 'This Week';
        } else if (period === 'lastweek') {
            timestamp = getLastPoolReset(1);
            periodDescription = 'Last Week';
        } else if (period === 'custom' && days) {
            days = parseInt(days);
            timestamp = daysToTimestamp(days);
            periodDescription = `Last ${days} Day${days !== 1 ? "s" : ""}`;
        } else {
            timestamp = daysToTimestamp(-1);
            periodDescription = 'All Time';
        }

        let difficultyIndex = interaction.options.getString('type');
        difficultyIndex = parseInt(difficultyIndex);

        let leaderData = await getWarLeaderboard(difficultyIndex, timestamp);
        let fields = [];

        for (const [uuid, warCount] of leaderData) {
            let playerName = await getPlayerUsername(uuid);
            fields.push({ name: playerName, value: `\`\`\`${warCount}\`\`\``});
        }

        const itemsPerPage = 10;
        const totalPages = Math.ceil(fields.length / itemsPerPage);

        const generateEmbed = (page) => {
            const start = page * itemsPerPage;
            const currentFields = fields.slice(start, start + itemsPerPage);

            return new EmbedBuilder()
                .setColor(0x0099FF)
                .setTitle(getDifficultyName(difficultyIndex))
                .setAuthor({ name: 'War Leaderboard' })
                .setDescription(`*${periodDescription}*`)
                .addFields(...currentFields)
                .setFooter({ text: `Page ${page + 1} of ${totalPages}` });
        };

        let currentPage = 0;
        const embedMessage = await interaction.reply({ embeds: [generateEmbed(currentPage)], fetchReply: true });

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

    Object.values(Difficulty).reverse().forEach((choice) => {
        let index = warService.getDifficultyIndex(choice);
        choices.push({ name: choice, value: `${index}` });
    })

    return choices;
}

function getDifficultyName(difficulty) {
    return warService.getDifficultyFromIndex(difficulty)
}