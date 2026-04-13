const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getWynnUserFull } = require('../player/wynn-api');

const MINIMUM_LEVEL = 100;

function getHighestClassLevel(playerData) {
    const characters = Object.values(playerData.characters || {});
    if (characters.length === 0) return 0;
    return Math.max(...characters.map(c => c.level ?? 0));
}

function getGuildInfo(playerData) {
    if (!playerData.guild) return { name: null, prefix: null };
    return {
        name: playerData.guild.name,
        prefix: playerData.guild.prefix,
    };
}

async function runApplicationQuestions(thread, member, type) {
    const answers = [];

    // Step 1 — Ask for IGN
    await thread.send({
        embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription('❓ What is your Wynncraft IGN?')]
    });

    const ignCollected = await thread.awaitMessages({
        filter: m => m.author.id === member.id,
        max: 1,
    });

    const ign = ignCollected.first().content.trim();
    answers.push({ question: 'Wynncraft IGN', answer: ign });

    // Step 2 — Look up player
    await thread.send({
        embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription(`🔍 Looking up **${ign}**...`)]
    });

    let playerData;
    try {
        playerData = await getWynnUserFull(ign);
    } catch (err) {
        await thread.send({
            embeds: [new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Application Rejected')
                .setDescription(`Could not find a Wynncraft account with IGN **${ign}**. Please close this ticket and try again with the correct IGN.`)
            ]
        });
        return null;
    }

    const highestLevel = getHighestClassLevel(playerData);
    const { name: guildName, prefix: guildPrefix } = getGuildInfo(playerData);

    // Step 3 — Auto reject if below level threshold
    if (highestLevel < MINIMUM_LEVEL) {
        await thread.send({
            embeds: [new EmbedBuilder()
                .setColor(0xFF4444)
                .setTitle('❌ Application Rejected')
                .setDescription(`Your highest class level is **${highestLevel}**, but we require at least **${MINIMUM_LEVEL}**. Feel free to apply again once you meet the requirement.`)
            ]
        });
        return null;
    }

    // Step 4 — Show stats summary
    await thread.send({
        embeds: [new EmbedBuilder()
            .setColor(0x00AA00)
            .setTitle(`✅ Found: ${ign}`)
            .addFields(
                { name: 'Highest Level', value: `${highestLevel}`, inline: true },
                { name: 'Current Guild', value: guildName ? `[${guildPrefix}] ${guildName}` : 'None', inline: true },
            )
        ]
    });

    // Step 5 — Build dynamic question list
    const dynamicQuestions = [
        ...(type === 'join' ? [
            'How did you find us?',
            'Why do you want to join?',
        ] : [
            'Why do you feel you deserve a promotion?',
            'What are your recent achievements?',
        ]),
        ...(guildName ? [`We can see you are currently in **[${guildPrefix}] ${guildName}**. Why are you looking to leave?`] : []),
    ];

    // Step 6 — Ask questions one by one
    for (const question of dynamicQuestions) {
        await thread.send({
            embeds: [new EmbedBuilder().setColor(0xAA0000).setDescription(`❓ ${question}`)]
        });

        const collected = await thread.awaitMessages({
            filter: m => m.author.id === member.id,
            max: 1,
        });

        answers.push({ question, answer: collected.first().content });
    }

    return { answers, playerData, ign, highestLevel };
}

async function handleApplicationButton(interaction, type) {
    const guild = interaction.guild;
    const member = interaction.member;

    // ✅ Defer immediately before any async work
    await interaction.deferReply({ ephemeral: true });

    const existingThread = guild.channels.cache.find(
        c => c.name === `application-${member.user.username.toLowerCase()}` && c.isThread()
    );

    if (existingThread) {
        return interaction.editReply({
            content: `❌ You already have an open ticket: ${existingThread}`,
        });
    }

    const ticketThread = await interaction.channel.threads.create({
        name: `application-${member.user.username.toLowerCase()}`,
        type: 12,
        invitable: false,
        reason: `Application ticket for ${member.user.username}`
    });

    await ticketThread.members.add(member.id);

    const closeButton = new ButtonBuilder()
        .setCustomId(`close_application:${member.id}`)
        .setLabel('🔒 Close Ticket')
        .setStyle(ButtonStyle.Secondary);

    const closeRow = new ActionRowBuilder().addComponents(closeButton);

    await ticketThread.send({
        content: `Welcome ${member}! I'll ask you a few questions one at a time.`,
        components: [closeRow]
    });

    // ✅ editReply instead of reply
    await interaction.editReply({
        content: `✅ Your ticket has been created: ${ticketThread}`,
    });

    const result = await runApplicationQuestions(ticketThread, member, type);

    if (result) {
        const { answers, ign, highestLevel } = result;

        const summaryEmbed = new EmbedBuilder()
            .setColor(0x00AA00)
            .setTitle(`✅ Application Complete — ${ign}`)
            .addFields(
                { name: 'Highest Level', value: `${highestLevel}`, inline: true },
                ...answers.map(a => ({ name: a.question, value: a.answer }))
            )
            .setTimestamp();

        await ticketThread.send({ embeds: [summaryEmbed] });
    }
}

async function handleCloseApplication(interaction) {
    const thread = interaction.channel;
    const member = interaction.member;

    const isTicketOwner = thread.name.endsWith(member.user.username.toLowerCase());
    const isStaff = member.permissions.has('MANAGE_THREADS');

    if (!isTicketOwner && !isStaff) {
        return interaction.reply({
            content: '❌ You do not have permission to close this ticket.',
            ephemeral: true
        });
    }

    const confirmEmbed = new EmbedBuilder()
        .setColor(0xAA0000)
        .setTitle('🔒 Closing Ticket')
        .setDescription('This ticket will be archived in 5 seconds.')
        .setTimestamp();

    await interaction.reply({ embeds: [confirmEmbed] });

    setTimeout(async () => {
        await thread.setArchived(true).catch(console.error);
    }, 5000);
}

module.exports = { handleApplicationButton, handleCloseApplication };