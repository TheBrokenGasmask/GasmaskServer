const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getWynnUserFull } = require('../player/wynn-api');
const {createApplication, setApplicationMessageIds, getApplicationByThread, getApplicationById, getApplicationByReviewMessage, upsertVote, getVotes, setApplicationStatus } = require('../../core/database');;
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

// --- Q&A ---

async function runApplicationQuestions(thread, member, type) {
    const answers = [];

    
    
    let guildName = null;
    let guildPrefix = null; 
    
let highestLevel = 0;
let apiDown = false;
let playerData = null;
let confirmed = false;

while (!confirmed && !apiDown) {
    // Ask for IGN
    await thread.send({
        embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription('❓ What is your Wynncraft IGN?')]
    });

    const ignCollected = await awaitAnswer(thread, member.id);
        if (ignCollected === null) return null;
    const currentIgn = ignCollected.trim();
    ign = currentIgn; // set the main ign variable to the current attempt
    answers[0] = { question: 'Wynncraft IGN', answer: currentIgn }; // always update the IGN answer

    await thread.send({
        embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription(`🔍 Looking up **${currentIgn}**...`)]
    });

    const mojang = await requestUUID(currentIgn);

    if (!mojang) {
        await thread.send({
            embeds: [new EmbedBuilder()
                .setColor(0xFF4444)
                .setDescription(`❌ No Minecraft account found for **${currentIgn}**. Please double check and try again.`)
            ]
        });
        continue; // loop back and ask for IGN again
    }

    try {
        playerData = await getWynnUserFull(mojang.uuid);
    } catch (err) {
        console.error('[WynnAPI] Failed:', err);
        apiDown = true;
        break;
    }

    // Ask for confirmation
    const guildInfo = getGuildInfo(playerData);
    guildName = guildInfo.name;
    guildPrefix = guildInfo.prefix;
    highestLevel = getHighestClassLevel(playerData);
    console.log(`Fetched player data for ${currentIgn}: Level ${highestLevel}, Guild: ${guildName ? `[${guildPrefix}] ${guildName}` : 'None'}`);
    const confirmMsg = await thread.send({
        embeds: [new EmbedBuilder()
            .setColor(0xAA0000)
            .setTitle('Is this your account?')
            .addFields(
                { name: 'IGN', value: currentIgn, inline: true },
                { name: 'Highest Level', value: highestLevel > 0 ? `${highestLevel}` : 'Unknown', inline: true },
                { name: 'Guild', value: guildName ? `[${guildPrefix}] ${guildName}` : 'None', inline: true },
            )
        ],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_ign:yes').setLabel('✅ Yes, that\'s me').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('confirm_ign:no').setLabel('❌ No, wrong account').setStyle(ButtonStyle.Danger)
        )]
    });

    const confirmCollected = await thread.awaitMessageComponent({
        filter: i => i.user.id === member.id && i.customId.startsWith('confirm_ign:'),
        time: 0
    }).catch(() => null);

    await confirmMsg.edit({ components: [] });

    if (confirmCollected?.customId === 'confirm_ign:yes') {
        await confirmCollected.reply({ content: '✅ Account confirmed, continuing...', ephemeral: true });
        confirmed = true;
    } else {
        await confirmCollected?.reply({ content: '❌ No problem, let\'s try a different IGN.', ephemeral: true });
        playerData = null;
        // loop continues — asks for IGN again
    }

if (highestLevel === 0) {
    await thread.send({
        embeds: [new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle('⚠️ Could not read levels')
            .setDescription('We weren\'t able to read your character levels. What is your highest class level?')
        ]
    });


        const levelCollected = await awaitAnswer(thread, member.id);
            if (answer === null) return null; // ticket was closed mid-question
            aanswers.push({ question: 'Highest Class Level (self reported)', answer: `${highestLevel}` });
        }


}

// Only reach here if API is down
if (apiDown) {
    await thread.send({
        embeds: [new EmbedBuilder()
            .setColor(0xFFAA00)
            .setTitle('⚠️ API Unavailable')
            .setDescription('We couldn\'t verify your account automatically. What is your highest class level?')
        ]
    });

    const levelCollected = await awaitAnswer(thread, member.id);
            if (answer === null) return null; // ticket was closed mid-question
            aanswers.push({ question: 'Highest Class Level (self reported)', answer: `${highestLevel}` });
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
        ...(type === 'join' ?  
            ['what is your Age?',
            'What is your Timezone?',
            'What is your activity level like? (How often do you play?)',
            'What is your reason for joining and how will you contribute to the guild?', 
            'Are you intrested in participating in guild raids? If so, rate from 1-10',
            'Are you intrested in participating in guild warring? If so, rate from 1-10',
            'What languages do you speak?',
            'Are there any things done by online people that may irritates you? (i.e pet peeve)',
            'Accept our rules in #rules aswell as in https://imgur.com/a/cmWApkT'
            ] : type === 'veteran' ? [
            'What is your activity level like? (How often do you play?)',
            'what was the reason you left the guild previously?',
            'Accept our rules in #rules aswell as in [Guild Rules](https://docs.google.com/document/d/1RT4Uz0gEzVwFuJ9nZP4sd2tXEhI99j7aAB_cuwQAGFU/edit?usp=sharing)'
            ]
            
            : ['Why do you feel you deserve a promotion?', 'What are your recent achievements?']),
        ...(guildName ? [`We can see you are in **[${guildPrefix}] ${guildName}**. Why are you looking to leave?`] : []),
    
    ];

    for (const question of dynamicQuestions) {
        await thread.send({
            embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription(`❓ ${question}`)]
        });
        const answer = await awaitAnswer(thread, member.id);
            if (answer === null) return null; // ticket was closed mid-question
            answers.push({ question, answer });
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

    await ticketThread.members.add(member.id);

    const closeButton = new ButtonBuilder()
        .setCustomId(`close_application:${member.id}`)
        .setLabel('🔒 Close Ticket')
        .setStyle(ButtonStyle.Secondary);

    await ticketThread.send({
        content: `Welcome! I'll ask you a few questions one at a time.`,
        components: [new ActionRowBuilder().addComponents(closeButton)]
    });

    await interaction.editReply({ content: `✅ Your ticket has been created: ${ticketThread}` });

    const result = await runApplicationQuestions(ticketThread, member, type);
    if (!result) return;

    const { answers, ign, highestLevel } = result;

    // Post vote bar in ticket
    const voteBarMsg = await ticketThread.send({
        embeds: [buildVoteBarEmbed(0, 0)]
    });

    // Build review channel summary
    const reviewChannelConfig = config.get('votesystem');
    const reviewChannel = guild.channels.cache.get(reviewChannelConfig[`review-channel-id`]);
    if (!reviewChannel) {
        console.error('Review channel not found — check review-channel-id in config.json');
        return;
    }

    const summaryEmbed = new EmbedBuilder()
        .setColor(0xAA0000)
        .setTitle(`📋 New Application — ${ign}`)
        .addFields(
            { name: 'Discord', value: `${member}`, inline: true },
            { name: 'Highest Level', value: `${highestLevel}`, inline: true },
            { name: 'Ticket', value: `${ticketThread}`, inline: true },
            ...answers.map(a => ({ name: a.question, value: a.answer }))
        )
        .setTimestamp();

    const acceptButton = new ButtonBuilder()
        .setCustomId(`vote_application:accept`)
        .setLabel('✅ Accept')
        .setStyle(ButtonStyle.Success);

    const declineButton = new ButtonBuilder()
        .setCustomId(`vote_application:decline`)
        .setLabel('❌ Decline')
        .setStyle(ButtonStyle.Danger);

    const reviewMsg = await reviewChannel.send({
        embeds: [summaryEmbed],
        components: [new ActionRowBuilder().addComponents(acceptButton, declineButton)]
    });

    // Save to DB
    const applicationId = await createApplication(ticketThread.id, member.id, ign);
    await setApplicationMessageIds(applicationId, voteBarMsg.id, reviewMsg.id);

    // Auto archive after 24 hours if still pending
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

    if (!member.permissions.has('MANAGE_THREADS')) {
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
    const isStaff = member.permissions.has('MANAGE_THREADS');

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

module.exports = { handleApplicationButton, handleApplicationVote, handleCloseApplication };