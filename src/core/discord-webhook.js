const axios = require('axios');
const { config } = require('./config');

class DiscordWebhook {
    constructor() {
        this.config = config.get('chat-bridge');
        this.webhookUrl = null;
        this.enabled = this.config.enabled;
        this.discordClient = null;
    }

    setDiscordClient(client) {
        this.discordClient = client;
    }

    async ensureWebhook() {
        if (this.webhookUrl) {
            return true;
        }

        if (!this.discordClient) {
            console.warn('Discord client not available for webhook creation');
            return false;
        }

        const channelId = this.config['channel-id'];
        if (!channelId) {
            console.warn('No channel ID configured for chat bridge');
            return false;
        }

        try {
            const channel = await this.discordClient.channels.fetch(channelId);
            if (!channel) {
                console.error(`Channel ${channelId} not found`);
                return false;
            }

            const existingWebhooks = await channel.fetchWebhooks();
            let webhook = existingWebhooks.find(w => w.name === 'WynnTracker Chat Bridge');

            if (!webhook) {
                webhook = await channel.createWebhook({
                    name: 'WynnTracker Chat Bridge',
                    reason: 'Chat bridge between Minecraft and Discord'
                });
                console.log(`Created new webhook for channel ${channel.name}: ${webhook.name}`);
            } else {
                console.log(`Using existing webhook for channel ${channel.name}: ${webhook.name}`);
            }

            this.webhookUrl = webhook.url;
            return true;
        } catch (error) {
            console.error('Failed to create/fetch webhook:', error.message);
            return false;
        }
    }

    async sendMessage(username, messageData, avatarUrl) {
        if (!this.enabled) {
            console.log('Chat bridge is disabled');
            return false;
        }

        if (!(await this.ensureWebhook())) {
            console.warn('Webhook not available');
            return false;
        }

        try {
        console.log(avatarUrl)
        
        let payload = {
            username: username,
            avatar_url: avatarUrl,
            allowed_mentions: { "parse": [] }
        };

        if (typeof messageData === 'string') {
            // Regular message
            payload.content = messageData;
        } else if (typeof messageData === 'object' && messageData !== null) {
            // Embed data object
            payload.content = messageData.content || '';
            payload.embeds = messageData.embeds || [];
            payload.attachments = messageData.attachments || [];
        } else {
            throw new Error('Invalid messageData format');
        }

        await axios.post(this.webhookUrl, payload, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const messageType = typeof messageData === 'string' ? 'message' : 'embed';
        console.log(`Discord webhook ${messageType} sent successfully for ${username}`);
        return true;
    } catch (error) {
        console.error('Failed to send Discord webhook message:', error.response?.data || error.message);
        
        if (error.response?.status === 404) {
            console.log('Webhook appears to be invalid, clearing cache...');
            this.webhookUrl = null;
        }
        
        return false;
    }
}

    async sendMinecraftSkinMessage(username, message, uuid = null) {
        let avatarUrl = `https://images.weserv.nl/?url=crafatar.com/renders/head/${uuid}?overlay=true&w=64&h=64&output=png&we`;
        return await this.sendMessage(username, message, avatarUrl);
    }
}

module.exports = { DiscordWebhook };