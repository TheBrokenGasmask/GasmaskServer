const Canvas = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');

Canvas.GlobalFonts.registerFromPath(
    path.join(__dirname, 'images', 'ascii.ttf'), 
    'WynnFont'
);

async function createRaidPayoutCard(topUuids, topName){
    const canvas = Canvas.createCanvas(1150, 450);
    const context = canvas.getContext('2d');

    const backgroundPath = path.join(__dirname, 'images', 'raid_payout_background.png');
    const background = await Canvas.loadImage(backgroundPath);
    context.drawImage(background, 0, 0, canvas.width, canvas.height);

    let response = await axios.get(`https://nmsr.nickac.dev/bust/${topUuids[1]}`, { responseType: 'arraybuffer' });
    let playerModelBuffer = Buffer.from(response.data, 'binary');

    let playerModel = await Canvas.loadImage(playerModelBuffer);
    context.drawImage(playerModel, 190, 70, 190, 190);

    response = await axios.get(`https://nmsr.nickac.dev/bust/${topUuids[0]}`, { responseType: 'arraybuffer' });
    playerModelBuffer = Buffer.from(response.data, 'binary');

    playerModel = await Canvas.loadImage(playerModelBuffer);
    context.drawImage(playerModel, 477, 17, 190, 190);

    response = await axios.get(`https://nmsr.nickac.dev/bust/${topUuids[2]}`, { responseType: 'arraybuffer' });
    playerModelBuffer = Buffer.from(response.data, 'binary');

    playerModel = await Canvas.loadImage(playerModelBuffer);
    context.drawImage(playerModel, 773, 70, 190, 190);

    const bannerPath = path.join(__dirname, 'images', 'raid_payout_ribbon.png');
    const banner = await Canvas.loadImage(bannerPath);
    context.drawImage(banner, 0, 0, canvas.width, canvas.height);

    context.shadowOffsetX = 4;
    context.shadowOffsetY = 4;

    context.shadowColor = '#472a2a'
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    const maxWidth = canvas.width * 0.2;
    await drawScaledFont(context, topName[0], canvas.width/2, 315, maxWidth);

    await drawScaledFont(context, topName[1], 280, 360, maxWidth);
    await drawScaledFont(context, topName[2], canvas.width-280, 360, maxWidth);

    return canvas.toBuffer('image/png');
}

async function drawScaledFont(context, text, x, y, maxWidth, initialFontSize = 40) {
    let fontSize = initialFontSize;
    context.shadowColor = '#472a2a'
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    
    do {
        context.font = `${fontSize}px WynnFont`;
        const textMetrics = context.measureText(text);
        const textWidth = textMetrics.width;
        
        if (textWidth <= maxWidth) {
            break;
        }
        
        fontSize--;
    } while (fontSize > 1);
    
    context.fillText(text, x, y);
    
    return fontSize;
}

module.exports = {createRaidPayoutCard};