const express = require('express');
const { createCanvas, loadImage, GlobalFonts, Path2D } = require('@napi-rs/canvas');
const path = require('path');
const fetch = require('node-fetch');
const FormData = require('form-data');

const app = express();
app.use(express.json());

try {
	GlobalFonts.registerFromPath(path.join(__dirname, 'Montserrat-Black.ttf'), 'Montserrat');
	console.log('Font registered successfully');
} catch (err) {
	console.error('FONT REGISTRATION FAILED:', err);
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

// Draws the current Robux icon: a faceted gem (rounded octagon split into
// triangular facets, each shaded a bit lighter/darker than the base color
// to fake a 3D beveled coin), instead of a flat shape with a punched hole.
function drawRobuxIcon(ctx, cx, cy, size, color) {
	ctx.save();
	ctx.translate(cx, cy);
	const r = size / 2;
	const sides = 8;
	const cornerRadius = r * 0.22;
	const rotationOffset = -Math.PI / 8;

	// Outer rounded-octagon outline (clip boundary + stroke).
	const outerPath = new Path2D();
	const verts = [];
	for (let i = 0; i <= sides; i++) {
		const angle = (Math.PI * 2 / sides) * i + rotationOffset;
		verts.push([r * Math.cos(angle), r * Math.sin(angle)]);
	}
	for (let i = 0; i < sides; i++) {
		const [x1, y1] = verts[i];
		const [x2, y2] = verts[i + 1];
		if (i === 0) outerPath.moveTo(x1, y1);
		outerPath.arcTo(x1, y1, x2, y2, cornerRadius);
		outerPath.lineTo(x2, y2);
	}
	outerPath.closePath();

	// Base fill so there are no gaps between facets at the clipped edges.
	ctx.fillStyle = color;
	ctx.fill(outerPath);

	// Clip to the gem shape, then draw shaded triangular facets fanning out
	// from the center to each pair of adjacent vertices. Alternating shades
	// (lighter toward the upper-left "light source", darker toward the
	// lower-right) create the faceted, beveled-gem look.
	ctx.save();
	ctx.clip(outerPath);

	const lightAngle = rotationOffset + Math.PI * 1.25; // upper-left-ish
	for (let i = 0; i < sides; i++) {
		const [x1, y1] = verts[i];
		const [x2, y2] = verts[i + 1];
		const midAngle = (Math.PI * 2 / sides) * (i + 0.5) + rotationOffset;

		let diff = midAngle - lightAngle;
		diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // normalize to [-PI, PI]
		const facing = Math.cos(diff); // 1 = facing light, -1 = facing away

		const shade = facing * 0.32; // positive lightens, negative darkens
		ctx.fillStyle = shadeColor(color, shade);

		ctx.beginPath();
		ctx.moveTo(0, 0);
		ctx.lineTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.closePath();
		ctx.fill();
	}

	// Soft highlight near the top to sell the "polished gem" reflection.
	const highlightGradient = ctx.createRadialGradient(
		-r * 0.25, -r * 0.35, 0,
		-r * 0.25, -r * 0.35, r * 0.9
	);
	highlightGradient.addColorStop(0, 'rgba(255,255,255,0.35)');
	highlightGradient.addColorStop(1, 'rgba(255,255,255,0)');
	ctx.fillStyle = highlightGradient;
	ctx.fillRect(-r, -r, size, size);

	ctx.restore();

	// Outline on top.
	ctx.lineWidth = size * 0.09;
	ctx.strokeStyle = OUTLINE_COLOR;
	ctx.stroke(outerPath);

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
