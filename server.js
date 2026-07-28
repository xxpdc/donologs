const express = require('express');
const { createCanvas, loadImage, registerFont } = require('canvas');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json());

registerFont(path.join(__dirname, 'Baloo2-ExtraBold.ttf'), { family: 'Baloo2' });

const WIDTH = 2048;
const HEIGHT = 576;
const AVATAR_RADIUS = 145;
const RING_WIDTH = 10;
const AVATAR_Y = 210;
const LEFT_X = 400;
const RIGHT_X = WIDTH - 400;
const CENTER_X = WIDTH / 2;

function getTier(amount) {
	if (amount >= 10000) return { color: '#FF0000' };
	if (amount >= 1000) return { color: '#FF1493' };
	return { color: '#FF00FF' };
}

async function getAvatarUrl(userId) {
	const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
	const data = await res.json();
	if (!data.data || !data.data[0] || !data.data[0].imageUrl) {
		throw new Error(`Failed to resolve avatar for userId ${userId}`);
	}
	return data.data[0].imageUrl;
}

function drawBackground(ctx, tier) {
	const gradient = ctx.createRadialGradient(
		CENTER_X, HEIGHT * 0.35, 0,
		CENTER_X, HEIGHT * 0.35, WIDTH * 0.75
	);
	gradient.addColorStop(0, '#000000');
	gradient.addColorStop(0.55, '#000000');
	gradient.addColorStop(1, tier.color);

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawOutlinedText(ctx, text, x, y, fillColor, fontSize, align = 'center') {
	ctx.font = `${fontSize}px Baloo2`;
	ctx.textAlign = align;
	ctx.textBaseline = 'middle';
	ctx.lineWidth = fontSize * 0.16;
	ctx.lineJoin = 'round';
	ctx.strokeStyle = '#000000';
	ctx.strokeText(text, x, y);
	ctx.fillStyle = fillColor;
	ctx.fillText(text, x, y);
}

async function drawAvatarCircle(ctx, imgUrl, cx, cy, ringColor) {
	const img = await loadImage(imgUrl);

	ctx.beginPath();
	ctx.arc(cx, cy, AVATAR_RADIUS + RING_WIDTH / 2, 0, Math.PI * 2);
	ctx.lineWidth = RING_WIDTH;
	ctx.strokeStyle = ringColor;
	ctx.stroke();

	ctx.save();
	ctx.beginPath();
	ctx.arc(cx, cy, AVATAR_RADIUS, 0, Math.PI * 2);
	ctx.closePath();
	ctx.clip();
	ctx.drawImage(img, cx - AVATAR_RADIUS, cy - AVATAR_RADIUS, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
	ctx.restore();
}

function drawRobuxIcon(ctx, cx, cy, size, color) {
	ctx.save();
	ctx.translate(cx, cy);
	const r = size / 2;
	ctx.beginPath();
	for (let i = 0; i < 6; i++) {
		const angle = (Math.PI / 3) * i - Math.PI / 6;
		const px = r * Math.cos(angle);
		const py = r * Math.sin(angle);
		if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
	}
	ctx.closePath();
	ctx.lineWidth = size * 0.16;
	ctx.strokeStyle = '#000000';
	ctx.stroke();
	ctx.fillStyle = color;
	ctx.fill();
	ctx.strokeStyle = '#000000';
	ctx.lineWidth = size * 0.08;
	ctx.stroke();

	const sq = size * 0.22;
	ctx.fillStyle = '#000000';
	ctx.fillRect(-sq / 2, -sq / 2, sq, sq);
	ctx.restore();
}

async function renderDonationImage({ donatorName, donatorUserId, raiserName, raiserUserId, amount }) {
	const canvas = createCanvas(WIDTH, HEIGHT);
	const ctx = canvas.getContext('2d');
	const tier = getTier(amount);

	const [donatorAvatarUrl, raiserAvatarUrl] = await Promise.all([
		getAvatarUrl(donatorUserId),
		getAvatarUrl(raiserUserId)
	]);

	drawBackground(ctx, tier);

	await drawAvatarCircle(ctx, donatorAvatarUrl, LEFT_X, AVATAR_Y, tier.color);
	await drawAvatarCircle(ctx, raiserAvatarUrl, RIGHT_X, AVATAR_Y, tier.color);

	drawOutlinedText(ctx, '@' + donatorName, LEFT_X, AVATAR_Y + AVATAR_RADIUS + 70, '#FFFFFF', 56);
	drawOutlinedText(ctx, '@' + raiserName, RIGHT_X, AVATAR_Y + AVATAR_RADIUS + 70, '#FFFFFF', 56);

	const amountText = Number(amount).toLocaleString('en-US');
	ctx.font = '96px Baloo2';
	const amountWidth = ctx.measureText(amountText).width;
	const iconSize = 90;
	const rowWidth = iconSize + 20 + amountWidth;
	const rowStartX = CENTER_X - rowWidth / 2;

	drawRobuxIcon(ctx, rowStartX + iconSize / 2, 150, iconSize, tier.color);
	drawOutlinedText(ctx, amountText, rowStartX + iconSize + 20 + amountWidth / 2, 150, tier.color, 96, 'center');

	drawOutlinedText(ctx, 'donated to', CENTER_X, 260, '#FFFFFF', 72);

	return canvas.toBuffer('image/png');
}

app.post('/donation-image', async (req, res) => {
	try {
		const { donatorName, donatorUserId, raiserName, raiserUserId, amount, webhookUrl, contentMessage } = req.body;

		if (!donatorName || !donatorUserId || !raiserName || !raiserUserId || !amount || !webhookUrl) {
			return res.status(400).json({ error: 'Missing required fields' });
		}

		const buffer = await renderDonationImage({
			donatorName,
			donatorUserId,
			raiserName,
			raiserUserId,
			amount: Number(amount)
		});

		const tierColorHex = parseInt(getTier(Number(amount)).color.replace('#', ''), 16);

		const form = new FormData();
		form.append('file', buffer, { filename: 'donation.png', contentType: 'image/png' });
		form.append('payload_json', JSON.stringify({
			content: contentMessage || '',
			embeds: [{
				image: { url: 'attachment://donation.png' },
				color: tierColorHex,
				footer: { text: 'Donated on' },
				timestamp: new Date().toISOString()
			}]
		}));

		const discordRes = await fetch(webhookUrl, {
			method: 'POST',
			body: form
		});

		if (!discordRes.ok) {
			const errText = await discordRes.text();
			console.error('Discord webhook error:', errText);
			return res.status(502).json({ error: 'Discord webhook failed', details: errText });
		}

		res.json({ success: true });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: err.message });
	}
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Renderer listening on port ${PORT}`));
