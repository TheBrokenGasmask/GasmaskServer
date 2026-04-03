const Canvas = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');

Canvas.GlobalFonts.registerFromPath(
    path.join(__dirname, 'images', 'ascii.ttf'),
    'WynnFont'
);

async function createAspectsCard(uuid, playerName, totalRaids, aspectsGiven, owedAspects) {
    const canvas = Canvas.createCanvas(700, 350);
    const context = canvas.getContext('2d');

    const backgroundPath = path.join(__dirname, 'images', 'raid_card_background.png');
    const background = await Canvas.loadImage(backgroundPath);
    context.drawImage(background, 0, 0, canvas.width, canvas.height);

    try {
        const response = await axios.get(`https://nmsr.nickac.dev/bust/${uuid}`, { responseType: 'arraybuffer' });
        const playerModelBuffer = Buffer.from(response.data, 'binary');
        const playerModel = await Canvas.loadImage(playerModelBuffer);
        context.drawImage(playerModel, 25, 50, 300, 300);
    } catch (error) {
        console.error(`Failed to fetch player model for ${playerName} (${uuid}):`, error.message);
        // Continue without player model
    }

    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;

    context.font = '33px WynnFont';
    context.shadowColor = '#363636'
    context.fillStyle = '#ffffff';
    context.fillText(`${playerName}`, 310, 85);

    context.font = '18px WynnFont';
    context.fillText(`Guild Aspects`, 310, 125);

    context.font = '25px WynnFont';
    context.fillStyle = '#ffffff';
    context.fillText(`Raids:`, 310, 190);
    context.fillText(`Aspects:`, 310, 250);
    context.fillText(`Owed:`, 310, 310);

    context.shadowColor = '#544a00'
    context.fillStyle = '#fcdf00';
    context.fillText(`${totalRaids}`, 460, 190);
    context.fillText(`${aspectsGiven}`, 460, 250);

    // Color owed aspects red if > 0, otherwise yellow
    if (owedAspects > 0) {
        context.fillStyle = '#ff5555';
    }
    context.fillText(`${owedAspects}`, 460, 310);

    return canvas.toBuffer('image/png');
}

module.exports = { createAspectsCard };
