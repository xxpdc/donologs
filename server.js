const express = require('express');
const { createCanvas, loadImage, GlobalFonts, Path2D } = require('@napi-rs/canvas');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json());

try {
	GlobalFonts.registerFromPath(path.join(__dirname, 'Montserrat-Black.ttf'), 'Montserrat');
	console.log('Montserrat registered successfully');
} catch (err) {
	console.error('FONT REGISTRATION FAILED (Montserrat):', err);
}

const WIDTH = 2048;
const HEIGHT = 576;
const AVATAR_RADIUS = 145;
const RING_WIDTH = 10;
const AVATAR_Y = 210;
const LEFT_X = 400;
const RIGHT_X = WIDTH - 400;
const CENTER_X = WIDTH / 2;
const OUTLINE_COLOR = '#000000';

function getTier(amount) {
	if (amount >= 10000) return { color: '#FF0000', gradientStrength: 1.0 };
	if (amount >= 1000) return { color: '#FF1493', gradientStrength: 0.5 };
	return { color: '#FF00FF', gradientStrength: 0 };
}

async function getAvatarUrl(userId) {
	const res = await fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${userId}&size=420x420&format=Png&isCircular=false`);
	const data = await res.json();
	if (!data.data || !data.data[0] || !data.data[0].imageUrl) {
		throw new Error(`Failed to resolve avatar for userId ${userId}`);
	}
	return data.data[0].imageUrl;
}

function hexToRgba(hex, alpha) {
	const num = parseInt(hex.replace('#', ''), 16);
	const r = (num >> 16) & 255;
	const g = (num >> 8) & 255;
	const b = num & 255;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Lighten (positive percent) or darken (negative percent) a hex color.
function shadeColor(hex, percent) {
	const num = parseInt(hex.replace('#', ''), 16);
	let r = (num >> 16) & 255;
	let g = (num >> 8) & 255;
	let b = num & 255;

	if (percent >= 0) {
		r = Math.round(r + (255 - r) * percent);
		g = Math.round(g + (255 - g) * percent);
		b = Math.round(b + (255 - b) * percent);
	} else {
		r = Math.round(r * (1 + percent));
		g = Math.round(g * (1 + percent));
		b = Math.round(b * (1 + percent));
	}

	r = Math.max(0, Math.min(255, r));
	g = Math.max(0, Math.min(255, g));
	b = Math.max(0, Math.min(255, b));

	return `rgb(${r}, ${g}, ${b})`;
}

// Radial glow from the bottom center, transparent at edges, strength scaled per tier.
// 100 tier has gradientStrength 0, so it's fully transparent (no gradient).
function drawBackground(ctx, tier) {
	if (tier.gradientStrength === 0) {
		return;
	}

	const gradient = ctx.createRadialGradient(
		CENTER_X, HEIGHT * 1.1, 0,
		CENTER_X, HEIGHT * 1.1, WIDTH * 0.55
	);
	const alpha = tier.gradientStrength;
	gradient.addColorStop(0, hexToRgba(tier.color, 0.85 * alpha));
	gradient.addColorStop(0.5, hexToRgba(tier.color, 0.4 * alpha));
	gradient.addColorStop(1, 'rgba(0,0,0,0)');

	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawOutlinedText(ctx, text, x, y, fillColor, fontSize, align = 'center') {
	ctx.font = `${fontSize}px Montserrat`;
	ctx.textAlign = align;
	ctx.textBaseline = 'middle';
	ctx.lineWidth = fontSize * 0.16;
	ctx.lineJoin = 'round';
	ctx.strokeStyle = OUTLINE_COLOR;
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

// Draws the actual Robux logo as vector shapes: a rounded-corner hexagon,
// a thin rounded-square ring sitting close to the hex's inner edge, and a
// small solid rounded square in the center. Proportions were matched
// directly against reference screenshots of the real icon.
function roundedHexPath(cx, cy, r, cornerRadius, rotationOffset = -Math.PI / 2) {
	const pts = [];
	for (let i = 0; i < 6; i++) {
		const angle = rotationOffset + (Math.PI * 2 / 6) * i;
		pts.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
	}
	const p = new Path2D();
	for (let i = 0; i < 6; i++) {
		const [x1, y1] = pts[i];
		const [x2, y2] = pts[(i + 1) % 6];
		if (i === 0) {
			const [xPrev, yPrev] = pts[5];
			const dx = x1 - xPrev, dy = y1 - yPrev;
			const len = Math.hypot(dx, dy);
			p.moveTo(x1 - (dx / len) * cornerRadius, y1 - (dy / len) * cornerRadius);
		}
		p.arcTo(x1, y1, x2, y2, cornerRadius);
	}
	p.closePath();
	return p;
}

function roundedRectPath(cx, cy, w, h, radius) {
	const x = cx - w / 2;
	const y = cy - h / 2;
	const p = new Path2D();
	p.moveTo(x + radius, y);
	p.lineTo(x + w - radius, y);
	p.arcTo(x + w, y, x + w, y + radius, radius);
	p.lineTo(x + w, y + h - radius);
	p.arcTo(x + w, y + h, x + w - radius, y + h, radius);
	p.lineTo(x + radius, y + h);
	p.arcTo(x, y + h, x, y + h - radius, radius);
	p.lineTo(x, y + radius);
	p.arcTo(x, y, x + radius, y, radius);
	p.closePath();
	return p;
}

function drawRobuxIcon(ctx, cx, cy, size, color) {
	ctx.save();

	const outerR = size / 2;
	const outerCornerRadius = size * 0.15;

	const ringOuterSize = size * 0.56;
	const ringThickness = size * 0.13;
	const ringCornerRadius = ringOuterSize * 0.42;

	const holeSize = size * 0.20;
	const holeCornerRadius = holeSize * 0.3;

	// Outer rounded hexagon (solid).
	const outerHex = roundedHexPath(cx, cy, outerR, outerCornerRadius);
	ctx.fillStyle = color;
	ctx.fill(outerHex);

	// Cut out the middle, leaving a clear visible gap/border before the ring.
	const innerCutHex = roundedHexPath(cx, cy, outerR - size * 0.10, outerCornerRadius * 0.65);
	ctx.save();
	ctx.globalCompositeOperation = 'destination-out';
	ctx.fill(innerCutHex);
	ctx.restore();

	// Re-fill the rounded-square ring (outer part).
	const ringOuter = roundedRectPath(cx, cy, ringOuterSize, ringOuterSize, ringCornerRadius);
	ctx.fillStyle = color;
	ctx.fill(ringOuter);

	// Punch the ring's hole so it reads as a thin frame.
	const ringInnerSize = ringOuterSize - ringThickness * 2;
	const ringInner = roundedRectPath(cx, cy, ringInnerSize, ringInnerSize, ringCornerRadius * (ringInnerSize / ringOuterSize));
	ctx.save();
	ctx.globalCompositeOperation = 'destination-out';
	ctx.fill(ringInner);
	ctx.restore();

	// Solid center square.
	const centerSquare = roundedRectPath(cx, cy, holeSize, holeSize, holeCornerRadius);
	ctx.fillStyle = color;
	ctx.fill(centerSquare);

	// Outline.
	ctx.lineWidth = size * 0.045;
	ctx.strokeStyle = OUTLINE_COLOR;
	ctx.stroke(outerHex);

	ctx.restore();
}

async function renderDonationImage({ donatorName, donatorUserId, raiserName, raiserUserId, amount }) {
	const canvas = createCanvas(WIDTH, HEIGHT);
	const ctx = canvas.getContext('2d');
	const tier = getTier(amount);
	console.log('Tier:', tier);

	console.log('Fetching avatars...');
	const [donatorAvatarUrl, raiserAvatarUrl] = await Promise.all([
		getAvatarUrl(donatorUserId),
		getAvatarUrl(raiserUserId)
	]);
	console.log('Avatars fetched:', donatorAvatarUrl, raiserAvatarUrl);

	console.log('Drawing background...');
	drawBackground(ctx, tier);

	console.log('Drawing avatars...');
	await drawAvatarCircle(ctx, donatorAvatarUrl, LEFT_X, AVATAR_Y, tier.color);
	await drawAvatarCircle(ctx, raiserAvatarUrl, RIGHT_X, AVATAR_Y, tier.color);

	console.log('Drawing usernames...');
	drawOutlinedText(ctx, '@' + donatorName, LEFT_X, AVATAR_Y + AVATAR_RADIUS + 70, '#FFFFFF', 70);
	drawOutlinedText(ctx, '@' + raiserName, RIGHT_X, AVATAR_Y + AVATAR_RADIUS + 70, '#FFFFFF', 70);

	console.log('Drawing amount...');
	const amountText = Number(amount).toLocaleString('en-US');
	ctx.font = '124px Montserrat';
	const amountWidth = ctx.measureText(amountText).width;
	const iconSize = 110;
	const rowWidth = iconSize + 20 + amountWidth;
	const rowStartX = CENTER_X - rowWidth / 2;

	drawRobuxIcon(ctx, rowStartX + iconSize / 2, 150, iconSize, tier.color);
	drawOutlinedText(ctx, amountText, rowStartX + iconSize + 20 + amountWidth / 2, 150, tier.color, 124, 'center');

	drawOutlinedText(ctx, 'donated to', CENTER_X, 268, '#FFFFFF', 92);

	console.log('Render complete');
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
