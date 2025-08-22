const { PACKET_TYPES, PACKET_HANDLERS } = require('./packets');

class PacketHandler {
    constructor() {
        this.packets = new Map();
        this.registerDefaultPackets();
    }

    registerPacket(packetType, handler) {
        this.packets.set(packetType, handler);
    }

    handlePacket(client, packet) {
        const handler = this.packets.get(packet.type);

        console.log("Incoming packet:", packet.type, "from client:", client.uuid);

        if (handler) return handler(client, packet);
        else throw new Error(`Unknown packet type: ${packet.type}`);
    }

    registerDefaultPackets() {
        // Register all default packet handlers from the packets module
        Object.entries(PACKET_HANDLERS).forEach(([packetType, handler]) => {
            this.registerPacket(packetType, handler);
        });
    }
}

module.exports = { PacketHandler, PACKET_TYPES };