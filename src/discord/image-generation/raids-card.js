const Canvas = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');

Canvas.GlobalFonts.registerFromPath(
    path.join(__dirname, 'images', 'ascii.ttf'), 
    'WynnFont'
);

async function createRaidCard(uuid, playerName, raidCounts, totalRaids, days = null){

    let raidsText;
    if (days === null || days === undefined) {
        raidsText = `${totalRaids} All-time Guild Raids`;
    } else {
        const dayText = days === 1 ? 'day' : 'days';
        raidsText = `${totalRaids} Guild Raids Last ${days} ${dayText}`;
    }

    const canvas = Canvas.createCanvas(700, 350);
    const context = canvas.getContext('2d');

    const backgroundPath = path.join(__dirname, 'images', 'raid_card_background.png');
    const background = await Canvas.loadImage(backgroundPath);
    context.drawImage(background, 0, 0, canvas.width, canvas.height);

    const response = await axios.get(`https://nmsr.nickac.dev/bust/${uuid}`, { responseType: 'arraybuffer' });
    const playerModelBuffer = Buffer.from(response.data, 'binary');

    const playerModel = await Canvas.loadImage(playerModelBuffer);
    context.drawImage(playerModel, 25, 50, 300, 300);

    context.shadowOffsetX = 2;
    context.shadowOffsetY = 2;

    context.font = '33px WynnFont';
    context.shadowColor = '#363636'
    context.fillStyle = '#ffffff';
    context.fillText(`${playerName}`, 310, 85);

    context.font = '18px WynnFont';
    context.fillText(`${raidsText}`, 310, 125);

    context.font = '25px WynnFont';
    context.fillText(`NOTG:`, 310, 170);
    context.fillText(`TCC:`, 310, 260);
    context.fillText(`NOL:`, 430, 170);
    context.fillText(`TNA:`, 430, 260);
    context.fillText(`TWP:`, 550,170)

    context.shadowColor = '#544a00'
    context.fillStyle = '#fcdf00';
    context.fillText(`${raidCounts[0] ?? 0}`, 310, 215);
    context.fillText(`${raidCounts[2] ?? 0}`, 310, 305);
    context.fillText(`${raidCounts[1] ?? 0}`, 430, 215);
    context.fillText(`${raidCounts[3] ?? 0}`, 430, 305);
    context.fillText(`${raidCounts[4 ?? 0]}`, 550, 215);
    return canvas.toBuffer('image/png');
}

module.exports = {createRaidCard};