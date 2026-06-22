const {Client, GatewayIntentBits, Collection, Events} = require("discord.js");
const {join} = require("path");
const {token} = require("../../config.json");
const {readdirSync} = require("fs");
const { chatBridge } = require('../features/chat-bridge/chat-bridge-service');
const { rankService } = require('../features/ranks/rank-service');
const { initializeTerritoryTracker } = require('../features/trackers/territory-tracker');
const { initializeGuildMemberTracker } = require('../features/trackers/guild-tracker');
const { InitializeGuildRaidTracker } = require('../features/raids/raid-tracker');
const { handleApplicationButton, handleApplicationVote, handleCloseApplication, restoreApplications } = require('../features/applications/join-application');require('./deploy-commands');

const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ] 
});

client.on(Events.InteractionCreate, async interaction => {
    if (interaction.isButton()) {
        const [action, type] = interaction.customId.split(':');

        if (action === 'open_application') {
            await handleApplicationButton(interaction, type);
        }

        if (action === 'close_application') {
            await handleCloseApplication(interaction, type);
        }
        
        if (action === 'vote_application')  {
            await handleApplicationVote(interaction, type);
        }


        return;
    }

    if (!interaction.isChatInputCommand()) return; // this was killing buttons before
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }
    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
            }
        } catch (replyError) {
            console.error('Could not send error response to user (interaction may have expired):', replyError.message);
        }
    }
});

client.commands = new Collection();

const foldersPath = join(__dirname, 'commands');
const commandFiles = readdirSync(foldersPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = join(foldersPath, file);
    const command = require(filePath);
    // Set a new item in the Collection with the key as the command name and the value as the exported module
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

client.login(token).then(r => {
    console.log("Discord Bot Logged in")
}).catch(console.error);

// Initialize role manager when client is ready
client.once('ready', () => {
    console.log(`Discord bot ready as ${client.user.tag}`);
    
    // Initialize the role manager now that the client is ready
    const roleManager = require('../features/account-linking/role-manager');
    roleManager.init(client);
    
    // Initialize the chat bridge with Discord client
    chatBridge.setDiscordClient(client);
    console.log('Chat bridge initialized with Discord client');
    
    // Initialize the rank service with Discord client
    rankService.setDiscordClient(client);
    console.log('Rank service initialized with Discord client');
    
    // Initialize the trackers with Discord client
    initializeTerritoryTracker(client);
    initializeGuildMemberTracker(client);
    InitializeGuildRaidTracker(client);
    console.log('Event trackers initialized');
    setTimeout(() => restoreApplications(client), 5000);
});

client.on(Events.MessageCreate, async message => {
    let body = message.content
    if (message.attachments.size > 0) {
        const attachment = message.attachments.first();
        console.log(`accept`);
        if (attachment.contentType && attachment.contentType.startsWith('image/')) {
            body = `${attachment.url} ${message.content}`;
        }
    }
    await chatBridge.handleDiscordMessage(message.author, body, message.channel.id);
});

module.exports = { client, handleApplicationButton  };