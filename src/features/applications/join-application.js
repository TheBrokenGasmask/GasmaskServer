const { PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getWynnUserFull } = require('../player/wynn-api');
const {createApplication, setApplicationMessageIds, getApplicationByThread, getApplicationById, getApplicationByReviewMessage, upsertVote, getVotes, setApplicationStatus, getPendingApplications, saveApplicationAnswers, saveApplicationResumeData,updateApplicationIgn } = require('../../core/database');;
const { config } = require('../../core/config');
const { requestUUID } = require('../../core/utilities');

const MINIMUM_LEVEL = config.get('required-level') ?? 100;
const REQUIRED_VOTES = config.get('required-votes') ?? 1;

// --- Helpers ---

function getHighestClassLevel(playerData) {
    const characters = Object.values(playerData.characters || {});
    if (characters.length === 0) return 0;
    return Math.max(...characters.map(c => c.level ?? 0));
}

function getGuildInfo(playerData) {
    if (!playerData.guild) return { name: null, prefix: null };
    return { name: playerData.guild.name, prefix: playerData.guild.prefix };
}

function buildVoteBar(accepts, declines) {
    const filled = '█';
    const empty = '░';
    const bar = filled.repeat(accepts) + empty.repeat(Math.max(0, REQUIRED_VOTES - accepts));
    return `✅ \`${bar}\` ${accepts}/${REQUIRED_VOTES} accepted  |  ❌ ${declines} declined`;
}

function buildVoteBarEmbed(accepts, declines) {
    const status = accepts >= REQUIRED_VOTES ? '✅ Accepted' : declines >= REQUIRED_VOTES ? '❌ Declined' : '⏳ Pending';

    return new EmbedBuilder()
        .setColor(accepts >= REQUIRED_VOTES ? 0x00AA00 : declines >= REQUIRED_VOTES ? 0xFF4444 : 0xAA0000)
        .setTitle('Staff Vote')
        .setDescription(buildVoteBar(accepts, declines))
        .addFields({ name: 'Status', value: status })
        .setTimestamp();
}

async function awaitAnswer(thread, memberId) {
    const collected = await thread.awaitMessages({
        filter: m => m.author.id === memberId,
        max: 1,
    });
    return collected.first()?.content ?? null;
}

async function askForLevelManually(thread, member, answers, reason) {
    await thread.send({
        embeds: [new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle(reason === 'api_down' ? '⚠️ API Unavailable' : '⚠️ Could not read levels')
            .setDescription('What is your highest class level?')
        ]
    });

    const answer = await awaitAnswer(thread, member.id);
    if (answer === null) return null;

    const parsed = parseInt(answer);
    const level = isNaN(parsed) ? 0 : parsed;
    answers.push({ question: 'Highest Class Level (self reported)', answer: `${level}` });
    return level;
}

function truncate(str, max = 1024) {
    if (!str) return 'No answer';
    return str.length > max ? str.slice(0, 1021) + '...' : str;
}

// --- Q&A ---

async function runApplicationQuestions(thread, member, type, applicationId, resumeFrom = null) {
    // Load existing answers if resuming, otherwise start fresh
    console.log(`[QA] resumeFrom:`, JSON.stringify(resumeFrom, null, 2));
    console.log(`[QA] answers from resume:`, resumeFrom?.answers);

    const answers = resumeFrom?.answers ?? [{ question: 'Wynncraft IGN', answer: '' }];

    let ign = resumeFrom?.ign ?? '';
    let guildName = resumeFrom?.guildName ?? null;
    let guildPrefix = resumeFrom?.guildPrefix ?? null;
    let highestLevel = resumeFrom?.highestLevel ?? 0;
    let apiDown = false;
    let playerData = null;
    let confirmed = false;
    let firstQuestion = true;    
    let ignAttempts = 0;
    let MAX_IGN_ATTEMPTS = 3;
    // Skip IGN verification if we already have it
    if (resumeFrom?.ign && !resumeFrom?.confirmSent) {
            // IGN confirmed AND confirm embed already answered — skip straight to questions
            confirmed = true;
            guildName = resumeFrom.guildName;
            guildPrefix = resumeFrom.guildPrefix;
            highestLevel = resumeFrom.highestLevel;
        } else if (resumeFrom?.ign && resumeFrom?.confirmSent) {
            // IGN looked up but confirm embed not yet answered — re-enter loop to wait for button
            guildName = resumeFrom.guildName;
            guildPrefix = resumeFrom.guildPrefix;
            highestLevel = resumeFrom.highestLevel;
            // confirmed stays false — loop runs, skips sending embed, waits for button
        }

    const ignAlreadySent = resumeFrom?.ignQuestionSent ?? false;
    const confirmAlreadySent = resumeFrom?.confirmSent ?? false;


    while (!confirmed && !apiDown && ignAttempts < MAX_IGN_ATTEMPTS) {
        ignAttempts++;

        const currentIgn = resumeFrom?.ign ?? null;
        const ignAlreadySent = resumeFrom?.ignQuestionSent ?? false;

        if (currentIgn) {
            // IGN was confirmed before restart — skip straight to lookup
            ign = currentIgn;
            answers[0] = { question: 'Wynncraft IGN', answer: ign };
            resumeFrom = null;
        } else {
            // Only send the question if it wasn't already sent before restart
            if (!ignAlreadySent) {
                await saveApplicationResumeData(applicationId, {
                    ign: null, guildName: null, guildPrefix: null,
                    highestLevel: 0, ignQuestionSent: true
                });
                await thread.send({
                    embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription('❓ What is your Wynncraft IGN?')]
                });
            }

            const ignAnswer = await awaitAnswer(thread, member.id);
            if (ignAnswer === null) return null;

            ign = ignAnswer.trim();
            answers[0] = { question: 'Wynncraft IGN', answer: ign };
            await saveApplicationAnswers(applicationId, answers, 'ign');
            resumeFrom = null;

            await thread.send({
                embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription(`🔍 Looking up **${ign}**...`)]
            });
        }

        const mojang = await requestUUID(ign);
        if (!mojang) {
            await thread.send({
                embeds: [new EmbedBuilder().setColor(0xFF4444).setDescription(`❌ No Minecraft account found for **${ign}**. Please double check and try again.`)]
            });
            continue;
        }

        let wynnNotFound = false;
        try {
            playerData = await getWynnUserFull(mojang.uuid);
        } catch (err) {
            if (err.type === 'NOT_FOUND') {
                wynnNotFound = true;
            } else {
                console.error('[WynnAPI] Failed:', err);
                apiDown = true;
                break;
            }
        }

        if (wynnNotFound) {
            if (ignAttempts >= MAX_IGN_ATTEMPTS) {
                await thread.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0xFFAA00)
                        .setTitle('⚠️ Could not verify account')
                        .setDescription('We were unable to find your Wynncraft account after 3 attempts. We\'ll ask for your level manually instead.')
                    ]
                });
                break;
            }
            await thread.send({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setDescription(`❌ **${ign}** has never played Wynncraft. Please enter the correct IGN. (Attempt ${ignAttempts}/${MAX_IGN_ATTEMPTS})`)
                ]
            });
            playerData = null;
            continue;
        }

        const guildInfo = getGuildInfo(playerData);
        guildName = guildInfo.name;
        guildPrefix = guildInfo.prefix;
        highestLevel = getHighestClassLevel(playerData);

        await saveApplicationResumeData(applicationId, {
            ign, guildName, guildPrefix, highestLevel,
            confirmSent: true
        });


        const { wars, totalLevel, raids } = playerData.globalData;
        const playtime = playerData.playtime;
        let confirmMsg;
            if (!confirmAlreadySent) {
             confirmMsg = await thread.send({
                embeds: [new EmbedBuilder()
                    .setColor(0xAA0000)
                    .setTitle('Is this your account?')
                    .addFields(
                        { name: 'IGN', value: ign, inline: true },
                        { name: 'Highest Level', value: highestLevel > 0 ? `${highestLevel}` : 'Unknown', inline: true },
                        { name: 'Total Levels', value: `${totalLevel}`, inline: true },
                        { name: 'Guild', value: guildName ? `[${guildPrefix}] ${guildName}` : 'None', inline: true },
                        { name: 'Wars', value: `${wars}`, inline: true },
                        { name: 'Raids', value: `${raids.total}`, inline: true },
                        { name: 'Playtime', value: `${Math.floor(playtime)}h`, inline: true },
                    )
                ],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('confirm_ign:yes').setLabel('✅ Yes, that\'s me').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('confirm_ign:no').setLabel('❌ No, wrong account').setStyle(ButtonStyle.Danger)
                )]
            });
        }
        const confirmCollected = await thread.awaitMessageComponent({
            filter: i => i.user.id === member.id && i.customId.startsWith('confirm_ign:'),
            time: 0
        }).catch(() => null);

        if (confirmCollected?.customId === 'confirm_ign:yes') {
            await confirmCollected.reply({ content: '✅ Account confirmed, continuing...', ephemeral: true });
            confirmed = true;
            await saveApplicationAnswers(applicationId, answers, 'questions');
            await saveApplicationResumeData(applicationId, {
                ign, guildName, guildPrefix, highestLevel
            });
        } else {
            await confirmCollected?.reply({ content: '❌ No problem, let\'s try a different IGN.', ephemeral: true });
            playerData = null;
        }
    }

    if (apiDown) {
        const manualLevel = await askForLevelManually(thread, member, answers, 'api_down');
        if (manualLevel === null) return null;
        highestLevel = manualLevel;
    } else if (highestLevel === 0) {
        const manualLevel = await askForLevelManually(thread, member, answers, 'unreadable');
        if (manualLevel === null) return null;
        highestLevel = manualLevel;
    }

    if (highestLevel < MINIMUM_LEVEL) {
        await thread.send({
            embeds: [new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Application Rejected')
                .setDescription(`Your highest class level is **${highestLevel}**, but we require at least **${MINIMUM_LEVEL}**.`)
            ]
        });
        return null;
    }

    const dynamicQuestions = [
        ...(type === 'join' ? [
            'What is your Age?',
            'What is your Timezone?',
            'What is your activity level like? (How often do you play?)',
            'What is your reason for joining and how will you contribute to the guild?',
            'Are you interested in participating in guild raids? If so, rate from 1-10',
            'Are you interested in participating in guild warring? If so, rate from 1-10',
            'What languages do you speak?',
            'Are there any things done by online people that may irritate you? (i.e pet peeve)',
            'Do you accept our general rules in https://discord.com/channels/983006019850469406/1211390009916264509 and our [guild rules](https://docs.google.com/document/d/1RT4Uz0gEzVwFuJ9nZP4sd2tXEhI99j7aAB_cuwQAGFU/edit?usp=sharing)',
        ] : type === 'veteran' ? [
            'Why did you leave the guild?',
            'Why do you want to return?',
            'Do you accept our general rules in https://discord.com/channels/983006019850469406/1211390009916264509 and our [guild rules](https://docs.google.com/document/d/1RT4Uz0gEzVwFuJ9nZP4sd2tXEhI99j7aAB_cuwQAGFU/edit?usp=sharing)',
        ] : [
            'Why do you feel you deserve a promotion?',
            'What are your recent achievements?',
        ]),
        ...(guildName ? [`We can see you are in **[${guildPrefix}] ${guildName}**. Why are you looking to leave?`] : []),
    ];

    // Figure out how many questions already answered so we can skip them
    const alreadyAnswered = answers.filter(a => dynamicQuestions.includes(a.question)).length;
    const remainingQuestions = dynamicQuestions.slice(alreadyAnswered);

    const lastSentQuestion = resumeFrom?.lastSentQuestion ?? null;
        console.log(`[QA] lastSentQuestion: ${lastSentQuestion}`);

        // ... then in the loop:
        for (const question of remainingQuestions) {
            console.log(`[QA] Processing question: "${question}", firstQuestion: ${firstQuestion}, matches: ${lastSentQuestion === question}`);

            await saveApplicationResumeData(applicationId, {
                ign, guildName, guildPrefix, highestLevel,
                lastSentQuestion: question
            });

            if (firstQuestion && lastSentQuestion === question) {
                firstQuestion = false;
                console.log(`[QA] Skipping send — already in chat`);
            } else {
                await thread.send({
                    embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription(`❓ ${question}`)]
                });
                firstQuestion = false;
            }

        const answer = await awaitAnswer(thread, member.id);
        if (answer === null) return null;

        answers.push({ question, answer });
        await saveApplicationAnswers(applicationId, answers, 'questions');
    }
    return { answers, playerData, ign, highestLevel };
}

// --- Main button handler ---

async function handleApplicationButton(interaction, type) {

    const guild = interaction.guild;
    const member = interaction.member;

    await interaction.deferReply({ ephemeral: true });

    const threadPrefix = type === 'veteran' ? 'veteran-application' : 'application';

    const existingThread = guild.channels.cache.find(
        c => c.name === `${threadPrefix}-${member.user.username.toLowerCase()}` && c.isThread() && !c.archived
    );

    if (existingThread) {
        return interaction.editReply({ content: `❌ You already have an open ticket: ${existingThread}` });
    }

    const ticketThread = await interaction.channel.threads.create({
        name: `${threadPrefix}-${member.user.username.toLowerCase()}`,
        type: 12,
        invitable: false,
        reason: `Application ticket for ${member.user.username}`
    });

    const ticketAccessRoles = config.get('votesystem')['ticket-access-roles'] ?? [];
    await interaction.guild.members.fetch();

    await ticketThread.members.add(member.id);

    for (const roleId of ticketAccessRoles) {
        const role = interaction.guild.roles.cache.get(roleId);
        if (!role) continue;

        // Add each member of that role to the thread
        const membersWithRole = interaction.guild.members.cache.filter(m => m.roles.cache.has(roleId));
        for (const [, roleMember] of membersWithRole) {
            await ticketThread.members.add(roleMember.id).catch(console.error);
        }
    }

    const closeButton = new ButtonBuilder()
        .setCustomId(`close_application:${member.id}`)
        .setLabel('🔒 Close Ticket')
        .setStyle(ButtonStyle.Secondary);

    await ticketThread.send({
        content: `Welcome! I'll ask you a few questions one at a time.`,
        components: [new ActionRowBuilder().addComponents(closeButton)]
    });

    await interaction.editReply({ content: `✅ Your ticket has been created: ${ticketThread}` });

    // ✅ Save to DB immediately — before Q&A starts
    const applicationId = await createApplication(ticketThread.id, member.id, 'pending_ign', type);

    const result = await runApplicationQuestions(ticketThread, member, type, applicationId);
    if (!result) return;

    const { answers, ign, highestLevel } = result;

    // Update IGN now that we have it
    await updateApplicationIgn(applicationId, ign);

    const voteBarMsg = await ticketThread.send({ embeds: [buildVoteBarEmbed(0, 0)] });

    const reviewChannelConfig = config.get('votesystem');
    const reviewChannel = guild.channels.cache.get(reviewChannelConfig['review-channel-id']);
    if (!reviewChannel) {
        console.error('Review channel not found');
        return;
    }

    const summaryEmbed = new EmbedBuilder()
        .setColor(0xAA0000)
        .setTitle(`📋 New Application — ${ign}`)
        .addFields(
            { name: 'Discord', value: `${member}`, inline: true },
            { name: 'Highest Level', value: `${highestLevel}`, inline: true },
            { name: 'Ticket', value: `${ticketThread}`, inline: true },
            ...answers.map(a => ({ name: truncate(a.question, 256), value: truncate(a.answer) }))
        )
        .setTimestamp();

    const reviewMsg = await reviewChannel.send({
        embeds: [summaryEmbed],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vote_application:accept').setLabel('✅ Accept').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('vote_application:decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
        )]
    });

    await setApplicationMessageIds(applicationId, voteBarMsg.id, reviewMsg.id);

    // Auto archive after 24 hours
    setTimeout(async () => {
        const app = await getApplicationById(applicationId);
        if (app?.status === 'pending') {
            await setApplicationStatus(applicationId, 'expired');
            await ticketThread.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x888888)
                    .setTitle('🕐 Ticket Expired')
                    .setDescription('This ticket has been automatically archived after 24 hours.')
                ]
            });
            await ticketThread.setArchived(true).catch(console.error);
        }
    }, 24 * 60 * 60 * 1000);
}

// --- Vote button handler ---

async function handleApplicationVote(interaction, voteType) {
    const member = interaction.member;

    if (!member.permissions.has(PermissionFlagsBits.ManageThreads)) {
        return interaction.reply({ content: '❌ You do not have permission to vote.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Find application by review message
    const application = await getApplicationByReviewMessage(interaction.message.id);
    if (!application) {
        return interaction.editReply({ content: '❌ Could not find this application in the database.' });
    }

    // Save/update vote (upsert handles vote changes)
    await upsertVote(application.id, member.id, voteType);

    const { accepts, declines } = await getVotes(application.id);

    // Update the vote bar in the ticket thread
    const thread = interaction.guild.channels.cache.get(application.thread_id);
    if (thread) {
        try {
            const voteBarMsg = await thread.messages.fetch(application.vote_bar_message_id);
            await voteBarMsg.edit({ embeds: [buildVoteBarEmbed(accepts, declines)] });
        } catch (err) {
            console.error('Could not update vote bar:', err);
        }
    }

    await interaction.editReply({ content: `✅ Your vote has been recorded as **${voteType}**. You can change it at any time.` });

    // Check threshold
    if (accepts >= REQUIRED_VOTES) {
        await setApplicationStatus(application.id, 'accepted');
        if (thread) {
            await thread.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x00AA00)
                    .setTitle('✅ Application Accepted')
                    .setDescription('This application has reached the required votes. Staff will follow up shortly.')
                ]
            });
        }
    } else if (declines >= REQUIRED_VOTES) {
        await setApplicationStatus(application.id, 'declined');
        if (thread) {
            await thread.send({
                embeds: [new EmbedBuilder()
                    .setColor(0xFF4444)
                    .setTitle('❌ Application Declined')
                    .setDescription('This application has been declined.')
                ]
            });
        }
    }
}

// --- Close handler ---

async function handleCloseApplication(interaction) {
    const thread = interaction.channel;
    const member = interaction.member;

    const isTicketOwner = thread.name.endsWith(member.user.username.toLowerCase());
    const isStaff = member.permissions.has(PermissionFlagsBits.ManageThreads);

    if (!isTicketOwner && !isStaff) {
        return interaction.reply({ content: '❌ You do not have permission to close this ticket.', ephemeral: true });
    }

    await interaction.reply({
        embeds: [new EmbedBuilder()
            .setColor(0xAA0000)
            .setTitle('🔒 Closing Ticket')
            .setDescription('This ticket will be archived in 5 seconds.')
            .setTimestamp()
        ]
    });

    setTimeout(async () => {
        await thread.setArchived(true).catch(console.error);
    }, 5000);
}

async function restoreApplications(client) {
    const pending = await getPendingApplications();
    console.log(`[Restore] Found ${pending.length} pending applications`);
    if (pending.length === 0) return;

    for (const app of pending) {  // ✅ app is defined here
        console.log(`[Restore] Processing app ID ${app.id}, thread ${app.thread_id}`);

        const savedAnswers = app.answers ?? null;
        const savedIgn = savedAnswers?.find(a => a.question === 'Wynncraft IGN')?.answer ?? null;

        const resumeFrom = app.resume_data ? {
            ...app.resume_data,
            answers: savedAnswers,
        } : savedIgn ? {
            ign: null,
            answers: savedAnswers,
            guildName: null,
            guildPrefix: null,
            highestLevel: 0,
            lastSentQuestion: null,
        } : null;

        let thread;
        try {
            thread = await client.channels.fetch(app.thread_id);
        } catch (err) {
            console.log(`[Restore] Thread fetch failed: ${err.message}`);
            await setApplicationStatus(app.id, 'expired');
            continue;
        }

        if (!thread || thread.archived) {
            await setApplicationStatus(app.id, 'expired');
            continue;
        }

        let member;
        try {
            member = await thread.guild.members.fetch(app.applicant_id);
        } catch (err) {
            console.log(`[Restore] Member fetch failed: ${err.message}`);
            await setApplicationStatus(app.id, 'expired');
            continue;
        }



        // Reschedule auto-archive
        const createdAt = new Date(app.created_at).getTime();
        const remaining = (createdAt + 24 * 60 * 60 * 1000) - Date.now();

        if (remaining <= 0) {
            await setApplicationStatus(app.id, 'expired');
            await thread.send({
                embeds: [new EmbedBuilder()
                    .setColor(0x888888)
                    .setTitle('🕐 Ticket Expired')
                    .setDescription('This ticket has been automatically archived.')
                ]
            });
            await thread.setArchived(true).catch(console.error);
            continue;
        }

        setTimeout(async () => {
            const current = await getApplicationById(app.id);
            if (current?.status === 'pending') {
                await setApplicationStatus(app.id, 'expired');
                await thread.send({
                    embeds: [new EmbedBuilder()
                        .setColor(0x888888)
                        .setTitle('🕐 Ticket Expired')
                        .setDescription('This ticket has been automatically archived after 24 hours.')
                    ]
                });
                await thread.setArchived(true).catch(console.error);
            }
        }, remaining);

        try {
            const result = await runApplicationQuestions(thread, member, app.type ?? 'join', app.id, resumeFrom);
            if (!result) continue;

            const { answers, ign, highestLevel } = result;

            const reviewChannelConfig = config.get('votesystem');
            const reviewChannel = thread.guild.channels.cache.get(reviewChannelConfig['review-channel-id']);

            if (reviewChannel) {
                const summaryEmbed = new EmbedBuilder()
                    .setColor(0xAA0000)
                    .setTitle(`📋 New Application — ${ign}`)
                    .addFields(
                        { name: 'Discord', value: `${member}`, inline: true },
                        { name: 'Highest Level', value: `${highestLevel}`, inline: true },
                        { name: 'Ticket', value: `${thread}`, inline: true },
                        ...answers.map(a => ({ name: truncate(a.question, 256), value: truncate(a.answer) }))
                    )
                    .setTimestamp();

                const reviewMsg = await reviewChannel.send({
                    embeds: [summaryEmbed],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId('vote_application:accept').setLabel('✅ Accept').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId('vote_application:decline').setLabel('❌ Decline').setStyle(ButtonStyle.Danger)
                    )]
                });

                const voteBarMsg = await thread.send({ embeds: [buildVoteBarEmbed(0, 0)] });
                await setApplicationMessageIds(app.id, voteBarMsg.id, reviewMsg.id);
            }
        } catch (err) {
            console.error(`[Restore] Error restoring application ${app.id}:`, err);
        }
    }
}

module.exports = { handleApplicationButton, handleApplicationVote, handleCloseApplication, restoreApplications };