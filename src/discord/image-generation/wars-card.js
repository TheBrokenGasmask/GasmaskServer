const Canvas = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const path = require('path');

Canvas.GlobalFonts.registerFromPath(
    path.join(__dirname, 'images', 'ascii.ttf'), 
    'WynnFont'
);

async function createWarCard(uuid, playerName, warCounts, totalWars, days = null){

    let warsText;
    if (days === null || days === undefined) {
        warsText = `${totalWars} All-time Wars`;
    } else {
        const dayText = days === 1 ? 'day' : 'days';
        warsText = `${totalWars} Wars Last ${days} ${dayText}`;
    }

    const canvas = Canvas.createCanvas(700, 350);
    const context = canvas.getContext('2d');

    //TODO: Change background
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
    context.fillText(`${warsText}`, 310, 125);

    context.font = '25px WynnFont';
    context.fillStyle = 'green'
    context.fillText(`Easy:`, 310, 170);

    context.fillStyle = 'yellow'
    context.fillText(`Medium:`, 310, 260);

    context.fillStyle = 'orange'
    context.fillText(`Hard:`, 500, 170);

    context.fillStyle = 'red'
    context.fillText(`Extreme:`, 500, 260);

    context.shadowColor = '#544a00'
    context.fillStyle = '#fcdf00';
    context.fillText(`${warCounts[0] ?? 0}`, 310, 215);
    context.fillText(`${warCounts[2] ?? 0}`, 310, 305);
    context.fillText(`${warCounts[1] ?? 0}`, 500, 215);
    context.fillText(`${warCounts[3] ?? 0}`, 500, 305);
    return canvas.toBuffer('image/png');
}

module.exports = {createWarCard};