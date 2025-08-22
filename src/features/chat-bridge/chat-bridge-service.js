const { DiscordWebhook } = require('../../core/discord-webhook');
const { wsManager } = require('../websocket/websocket');
const { config } = require('../../core/config');
const accountLinkingService = require('../account-linking/account-linking-service');
const { rankService } = require('../ranks/rank-service');
const {requestUUID} = require("../../core/utilities");
const {analyzeAndFormatItems} = require("./encoded-item");


class ChatBridgeService {
    constructor() {
        this.discordWebhook = new DiscordWebhook();
        this.messageLocks = new Map(); // hash -> Promise (for mutex)
        this.messageData = new Map(); // hash -> { status, count, clients, firstSeen }
        this.cacheExpiry = 8000; // 8 seconds
        this.cleanupInterval = 60000; // 60 seconds

        this.config = config.get('chat-bridge');
        
        this.startCleanup();
    }

    setDiscordClient(client) {
        this.discordWebhook.setDiscordClient(client);
    }

    generateMessageHash(username, message, timestamp = null) {
        return `${username}:${message}`;
    }

    async processMessageSafely(username, message, client, timestamp = null) {
        const hash = this.generateMessageHash(username, message, timestamp);
        
        if (this.messageLocks.has(hash)) {
            await this.messageLocks.get(hash);
        }
        
        let resolveLock;
        const lockPromise = new Promise(resolve => { resolveLock = resolve; });
        this.messageLocks.set(hash, lockPromise);
        
        try {
            return await this._processMessageInternal(hash, username, message, client);
        } finally {
            this.messageLocks.delete(hash);
            resolveLock();
        }
    }

    async _processMessageInternal(hash, username, message, client) {
        const now = Date.now();
        
        if (!this.messageData.has(hash)) {
            this.messageData.set(hash, {
                status: 'pending',
                count: 0,
                clients: new Set(),
                firstSeen: now
            });
        }
        
        const data = this.messageData.get(hash);
        
        if (now - data.firstSeen > this.cacheExpiry) {
            data.status = 'pending';
            data.count = 0;
            data.clients.clear();
            data.firstSeen = now;
        }
        
        if (data.status === 'processed') {
            return { shouldProcess: false, isDuplicate: true };
        }
        
        if (!data.clients.has(client)) {
            data.clients.add(client);
            data.count++;
        }
        
        const threshold = config.get("minimum-client-threshold");
        if (data.count >= threshold && data.status === 'pending') {
            data.status = 'processed';
            return { shouldProcess: true, isDuplicate: false };
        }
        
        return { shouldProcess: false, isDuplicate: false };
    }

    async shouldProcessMessage(username, message, client, timestamp = null) {
        const result = await this.processMessageSafely(username, message, client, timestamp);
        return result.shouldProcess;
    }

    async isDuplicateMessage(username, message, timestamp = null) {
        const hash = this.generateMessageHash(username, message, timestamp);
        const now = Date.now();
        
        if (!this.messageData.has(hash)) {
            return false;
        }
        
        const data = this.messageData.get(hash);
        
        if (now - data.firstSeen > this.cacheExpiry) {
            return false;
        }
        
        return data.status === 'processed';
    }

    async handleMinecraftMessage(client, packet) {
        const { username, message } = packet.data;

        const result = await this.processMessageSafely(username, message, client);
        
        if (!result.shouldProcess) {
            if (result.isDuplicate) {
                console.log(`Duplicate message filtered: ${username}: ${message}`);
            }
            return null;
        }


        const uuidAndName = await requestUUID(username);
        const uuid = uuidAndName.uuid;

        if (!uuid) {
            console.warn(`Could not resolve UUID for username: ${username}`);
            return null;
        }

        if (!username || !message) {
            console.warn('Invalid chat message packet: missing username or message');
            return null;
        }

        console.log(`Processing Minecraft message: ${username}: ${message}: ${uuid}`);
        
        let messageData = message;
        let success = false;

        if (message.includes('󰀀󰄀')) {
            console.log(`Item hash detected in message from ${username}`);
            
            try {
                messageData = await analyzeAndFormatItems(message);
                console.log(`Successfully processed item analysis for ${username}`);
            } catch (error) {
                console.error(`Error processing item hash from ${username}:`, error.message);
                console.log(`Falling back to original message for ${username}`);
            }
        }

        success = await this.discordWebhook.sendMinecraftSkinMessage(username, messageData, uuid);
        
        if (success) {
            console.log(`Bridged message to Discord from ${username}`);
        } else {
            console.error(`Failed to bridge message to Discord from ${username}`);
        }

        return {
            type: 'chat_message_ack',
            data: {
                success: success,
                timestamp: Date.now()
            }
        };
    }

    async handleDiscordMessage(author, content, channelId) {
        if (!this.config.enabled) return;
        
        if (channelId !== this.config['channel-id']) return;

        if (author.bot) return;

        // Check if the Discord user has a linked Minecraft account
        const accountLink = await accountLinkingService.getLink(author.id);
        if (!accountLink) {
            console.log(`Discord user ${author.username} (${author.id}) is not linked to a Minecraft account - message not bridged`);
            return;
        }

        // Use the linked Minecraft username instead of Discord username
        const minecraftUsername = accountLink.minecraft_username;
        const minecraftUuid = accountLink.minecraft_uuid;
        const message = content;

        if (await this.isDuplicateMessage(minecraftUsername, message)) {
            console.log(`Duplicate Discord message filtered: ${minecraftUsername}: ${message}`);
            return;
        }

        // Get the user's rank information
        const userRank = await rankService.getMemberRank(author.id);
        if (!userRank) {
            console.warn(`No rank found for Discord user ${author.username} (${author.id}) - message not bridged`);
            return;
        }

        let rank = userRank.identifier;

        console.log(`Processing Discord message from ${author.username} (linked as ${minecraftUsername}${userRank ? ` - ${userRank.identifier}` : ''}): ${message}`);

        const messageData = {
            type: 'discord_chat_message',
            data: {
                username: minecraftUsername,
                message: message,
                timestamp: Date.now(),
                uuid: minecraftUuid,
                avatarUrl: `https://crafatar.com/avatars/${minecraftUuid}?size=64&default=MHF_Steve&overlay`,
                rank: rank
            }
        };

        wsManager.broadcast(messageData.type, messageData.data);
        console.log(`Bridged message to Minecraft clients from ${minecraftUsername} (Discord: ${author.username}${userRank ? ` - ${userRank.identifier}` : ''})`);
        
    }

    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            const expiredHashes = [];
            
            for (const [hash, data] of this.messageData.entries()) {
                if (now - data.firstSeen > this.cacheExpiry) {
                    expiredHashes.push(hash);
                }
            }
            
            expiredHashes.forEach(hash => {
                this.messageData.delete(hash);
            });
            
            if (expiredHashes.length > 0) {
                console.log(`Cleaned up ${expiredHashes.length} expired message entries`);
            }
        }, this.cleanupInterval);
    }

    getStats() {
        return {
            cacheSize: this.messageCache.size,
            cacheExpiry: this.cacheExpiry,
            cleanupInterval: this.cleanupInterval
        };
    }
}

const chatBridge = new ChatBridgeService();

module.exports = { ChatBridgeService, chatBridge };