const axios = require('axios');
const { config } = require('./config');

class DiscordWebhook {
    constructor() {
        this.config = config.get('chat-bridge');
        this.webhookUrl = null;
        this.enabled = this.config.enabled;
        this.discordClient = null;
        this.requestQueue = [];
        this.isProcessing = false;
        this.lastRequestTime = 0;
        this.minRequestInterval = 100; // Minimum 100ms between requests
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

    async processQueue() {
        if (this.isProcessing || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessing = true;

        while (this.requestQueue.length > 0) {
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;

            if (timeSinceLastRequest < this.minRequestInterval) {
                await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - timeSinceLastRequest));
            }

            const { resolve, reject, payload, retries = 0 } = this.requestQueue.shift();

            try {
                await axios.post(this.webhookUrl, payload, {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000,
                    maxRedirects: 5,
                    httpAgent: null,
                    httpsAgent: null
                });
                this.lastRequestTime = Date.now();
                const messageType = typeof payload.content === 'string' && payload.embeds?.length === 0 ? 'message' : 'embed';
                console.log(`Discord webhook ${messageType} sent successfully for ${payload.username}`);
                resolve(true);
            } catch (error) {
                const errorMessage = error.response?.data || error.message;
                const shouldRetry = retries < 3 && (
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ECONNREFUSED' ||
                    error.code === 'ENOTFOUND' ||
                    error.message.includes('timeout') ||
                    error.message.includes('connect') ||
                    error.message.includes('socket') ||
                    error.response?.status === 429 ||
                    (error.response?.status >= 500 && error.response?.status < 600)
                );

                if (error.response?.status === 404) {
                    console.error('Webhook appears to be invalid (404), clearing cache...');
                    this.webhookUrl = null;
                    resolve(false);
                } else if (shouldRetry) {
                    const retryDelay = error.response?.status === 429
                        ? (error.response?.headers?.['retry-after'] || 1000)
                        : Math.min(1000 * Math.pow(2, retries), 5000);

                    console.warn(`Discord webhook failed (${errorMessage}), retrying in ${retryDelay}ms (attempt ${retries + 1}/3)`);
                    await new Promise(r => setTimeout(r, retryDelay));
                    this.requestQueue.unshift({ resolve, reject, payload, retries: retries + 1 });
                    continue;
                } else {
                    console.error('Failed to send Discord webhook message:', errorMessage);
                    resolve(false);
                }
            }
        }

        this.isProcessing = false;
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

        console.log(avatarUrl)

        let payload = {
            username: username,
            avatar_url: avatarUrl,
            allowed_mentions: { "parse": [] }
        };

        if (typeof messageData === 'string') {
            payload.content = messageData;
            payload.embeds = [];
        } else if (typeof messageData === 'object' && messageData !== null) {
            payload.content = messageData.content || '';
            payload.embeds = messageData.embeds || [];
            payload.attachments = messageData.attachments || [];
        } else {
            throw new Error('Invalid messageData format');
        }

        return new Promise((resolve, reject) => {
            this.requestQueue.push({ resolve, reject, payload });
            this.processQueue();
        });
    }

    async sendMinecraftSkinMessage(username, message, uuid = null) {
        let avatarUrl = `https://nmsr.nickac.dev/headiso/${uuid}`;
        return await this.sendMessage(username, message, avatarUrl);
    }
}

module.exports = { DiscordWebhook };