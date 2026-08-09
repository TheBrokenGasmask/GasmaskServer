const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, inlineCode } = require("discord.js");
const { getPlayerUsername, getPlayersByGuild, getGuildRaids } = require("../../core/database");
const {raids, daysToTimestamp, getLastPoolReset} = require("../../core/utilities");
const {getGuildCache} = require("../../features/player/guild-cache");
const { rankService } = require("../../features/ranks/rank-service");
const { config } = require("../../core/config");
const {createRaidPayoutCard} = require("../../discord/image-generation/raid-payout-card");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('raidpayout')
        .setDescription('Creates a list of raid payouts from the past week')
        .addStringOption(option =>
            option.setName('base')
                .setDescription('Base LE payout per raid completed')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('raidcaptain')
                .setDescription('Raid Captain LE bonus per raid')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('commander')
                .setDescription('Commander LE bonus per raid')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('advisor')
                .setDescription('Advisor LE bonus per raid')
                .setRequired(true)
        ),
    async execute(interaction) {
        const basePay = parseFloat(interaction.options.getString('base'));
        const raidCaptainPay = parseFloat(interaction.options.getString('raidcaptain'));
        const commanderPay = parseFloat(interaction.options.getString('commander'));
        const advisorPay = parseFloat(interaction.options.getString('advisor'));
        try {
            await interaction.deferReply({ ephemeral: true });

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

            let guildCache = getGuildCache();

            if (!guildCache || !guildCache.members) {
                await interaction.editReply({
                    content: 'Guild cache is empty or unavailable.'
                });
                return;
            }

            const guildTag = config.get("guild-tag");
            const guildPlayers = await getPlayersByGuild(guildTag);

            const uuidToDiscordMap = new Map();
            guildPlayers.forEach(player => {
                if (player.discord_id) {
                    uuidToDiscordMap.set(player.uuid, player.discord_id);
                }
            });

            const discordIds = Array.from(uuidToDiscordMap.values());
            const rankMap = discordIds.length > 0 ? await rankService.getBatchMemberRanks(discordIds) : new Map();

            const getGuildRankString = (rankNumber) => {
                switch (rankNumber) {
                    case 1: return "Recruit";
                    case 2: return "Recruiter";
                    case 3: return "War Captain";
                    case 4: return "Strategist";
                    case 5: return "Chief";
                    case 6: return "Owner";
                    default: return "Recruit";
                }
            };

        
            const ignoredUuids = new Set([
                '497f38f5-14ae-4eff-842a-64deb8c34ccf'
            ]);

            const processedMembers = [];

            for (const member of guildCache.members) {
                if (ignoredUuids.has(member.uuid)) {
                    continue;
                }

                const discordId = uuidToDiscordMap.get(member.uuid);
                let finalRankString = getGuildRankString(member.rank);
                let rankSource = "guild";

                if (discordId) {
                    const memberRank = rankMap.get(discordId);
                    if (memberRank && memberRank.identifier) {
                        const discordRankString = memberRank.identifier.trim();

                        if (discordRankString.toLowerCase() === 'recruit') {
                            continue;
                        }

                        if (discordRankString.toLowerCase() !== finalRankString.toLowerCase()) {
                            finalRankString = discordRankString;
                            rankSource = "discord";
                        }
                    }
                }

                if (finalRankString.toLowerCase()) {
                    processedMembers.push({
                        ...member,
                        rankString: finalRankString,
                        rankSource: rankSource,
                        hasDiscord: !!discordId
                    });
                }
            }

            const calculateResetRange = () => {
                const now = new Date();
                const currentUTC = new Date(Date.UTC(
                    now.getUTCFullYear(),
                    now.getUTCMonth(),
                    now.getUTCDate(),
                    now.getUTCHours(),
                    now.getUTCMinutes(),
                    now.getUTCSeconds(),
                    now.getUTCMilliseconds()
                ));

                const endFriday = new Date(currentUTC);
                const currentDay = endFriday.getUTCDay();
                const daysToSubtract = currentDay <= 5 ? (currentDay + 2) % 7 : 1;
                endFriday.setUTCDate(endFriday.getUTCDate() - daysToSubtract);
                endFriday.setUTCHours(18, 10, 0, 0);

                const startFriday = new Date(endFriday);
                startFriday.setUTCDate(startFriday.getUTCDate() - 7);

                const formatForMySQL = (date) =>
                    date.toISOString().slice(0, 19).replace('T', ' ');

                return {
                    startTimestamp: formatForMySQL(startFriday),
                    endTimestamp: formatForMySQL(endFriday),
                };
            };
            
            const { startTimestamp, endTimestamp } = calculateResetRange();
            console.log(`Calculating raid payouts from ${startTimestamp} to ${endTimestamp}`);

            const raidDiffs = await getGuildRaids(null, startTimestamp, endTimestamp);
            const raidDiffMap = new Map(raidDiffs.map(row => [row.uuid, row.total]));

            const membersWithRaids = processedMembers.map(member => ({
                ...member,
                raidCount: raidDiffMap.get(member.uuid) ?? 0
            }));

            const membersWithPayouts = membersWithRaids.map(member => {
                const baseLE = member.raidCount * basePay;

                let rankBonus = 0;
                const rankLower = member.rankString.toLowerCase();

                if (rankLower === 'raid captain') {
                    rankBonus = member.raidCount * raidCaptainPay;
                } else if (rankLower === 'commander' || rankLower === 'strategist') {
                    rankBonus = member.raidCount * commanderPay;
                } else if (['advisor', 'chief', 'council', 'owner'].includes(rankLower)) {
                    rankBonus = member.raidCount * advisorPay;
                }

                const totalLE = Math.floor(baseLE + rankBonus);

                return {
                    ...member,
                    baseLE: Math.floor(baseLE),
                    rankBonus: Math.floor(rankBonus),
                    totalLE: totalLE
                };
            });

            const sortedByRaids = [...membersWithPayouts].sort((a, b) => b.raidCount - a.raidCount);
            const top3Raiders = sortedByRaids.slice(0, 3);
            const top3Uuids = new Set(top3Raiders.map(member => member.uuid));

            const membersWithFinalPayouts = membersWithPayouts.map(member => {
                if (top3Uuids.has(member.uuid)) {
                    return {
                        ...member,
                        top3Bonus: 20,
                        totalLE: member.totalLE + 20,
                        isTop3: true
                    };
                }
                return {
                    ...member,
                    top3Bonus: 0,
                    isTop3: false
                };
            });

            membersWithFinalPayouts.sort((a, b) => {
                if (a.isTop3 && !b.isTop3) return -1;
                if (!a.isTop3 && b.isTop3) return 1;
                if (a.totalLE !== b.totalLE) return b.totalLE - a.totalLE;
                if (a.raidCount !== b.raidCount) return b.raidCount - a.raidCount;
                return a.username.localeCompare(b.username);
            });

            const totalRaids = Math.round(raidDiffs.reduce((sum, row) => sum + row.total, 0) / 4);
            const totalLE = membersWithFinalPayouts.reduce((sum, member) => sum + member.totalLE, 0);

            const memberPayouts = membersWithFinalPayouts
                .filter(member => member.raidCount >= 10)
                .map(member => inlineCode(`${member.username} - ${member.totalLE}le`))
                .join('\n');

            const topUuids = top3Raiders.map(member => member.uuid);
            const topName = top3Raiders.map(member => member.username);
            const cardBuffer = await createRaidPayoutCard(topUuids, topName);
            const plaintextList = `This week TBGM completed a total of ${totalRaids} raids!\nContact a chief to claim your payouts!\n---------------------------------\n${memberPayouts}\n---------------------------------`;

            const attachment = new AttachmentBuilder(cardBuffer, {
                name: 'raid-card.png'
            });

            await interaction.deleteReply();

            await interaction.channel.send({ content: `<@&1220555684362457138>` });
            await interaction.channel.send({ files: [attachment] });
            await interaction.channel.send({ content: plaintextList });

            const formatLEToStacks = (totalLE) => {
                const stacks = Math.floor(totalLE / 64);
                const remainder = totalLE % 64;
                if (stacks === 0) return `${remainder}le`;
                else if (remainder === 0) return `${stacks}stx`;
                else return `${stacks}stx ${remainder}le`;
            };

            const formattedLE = formatLEToStacks(totalLE);

            try {
                await interaction.user.send({
                    content: `Raid payout completed successfully!\n**Total LE Given:** ${formattedLE}`
                });
            } catch (error) {
                console.error('Could not send DM to user:', error);
            }
        } catch (error) {
            console.error('Error in raidpayout command:', error);
            try {
                if (interaction.deferred) {
                    await interaction.editReply({
                        content: 'An error occurred while processing the raid payout list'
                    });
                } else if (!interaction.replied) {
                    await interaction.reply({
                        content: 'An error occurred while processing the raid payout list',
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('Could not send error message to user:', replyError);
            }
        }
    },
};