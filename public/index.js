const WORLD_BOUNDS = {
	TOP_LEFT: { x: -23818, y: -10426 },
	BOTTOM_RIGHT: { x: 20504, y: 11377 },
};

const WORLD_WIDTH = WORLD_BOUNDS.BOTTOM_RIGHT.x - WORLD_BOUNDS.TOP_LEFT.x;
const WORLD_HEIGHT = WORLD_BOUNDS.BOTTOM_RIGHT.y - WORLD_BOUNDS.TOP_LEFT.y;
const WORLD_CENTER = {
	x: (WORLD_BOUNDS.TOP_LEFT.x + WORLD_BOUNDS.BOTTOM_RIGHT.x) / 2,
	y: (WORLD_BOUNDS.TOP_LEFT.y + WORLD_BOUNDS.BOTTOM_RIGHT.y) / 2,
};

const STALE_SERVER_TIMEOUT = 30_000;

const MAP_CONFIG = {
	rows: 1,
	columns: 16,
	totalWidth: 28680,
	totalHeight: 13724,
};

const AREA_MARKERS = {
	"Gleethrop End": {
		x: 1274,
		y: 3563,
	},
	Groenewoud: {
		x: -14658,
		y: -3762,
	},
	"Dovedale East": {
		x: 1231,
		y: 534,
	},
	"Fanory Mill": {
		x: -16821,
		y: -3954,
	},
	Mazewood: {
		x: -4650,
		y: 5798,
	},
	Conby: {
		x: -11688,
		y: -3270,
	},
	"Codsall Castle": {
		x: 9991,
		y: 5236,
	},
	Masonfield: {
		x: 10667,
		y: -881,
	},
	"Benyhone Loop": {
		x: -19532,
		y: -5201,
	},
	Perthtyne: {
		x: -490,
		y: 5268,
	},
	Ashburn: {
		x: -22012,
		y: -6729,
	},
	"Cosdale Harbour": {
		x: 4325,
		y: -2518,
	},
	"Glassbury Junction": {
		x: 11592,
		y: 8663,
	},
	"Dovedale Central": {
		x: 3157,
		y: 805,
	},
	"Wington Mount": {
		x: 2922,
		y: -2830,
	},
	"Marigot Crossing": {
		x: 7692,
		y: 2205,
	},
	Satus: {
		x: -7485,
		y: -3055,
	},
};

const COLORS = [
	"#FD2943",
	"#01A2FF",
	"#02B857",
	"#A75EB8",
	"#F58225",
	"#F5CD30",
	"#E8BAC8",
	"#D7C59A",
];

const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");
const elements = {
	players: document.getElementById("players"),
	tooltip: document.getElementById("tooltip"),
	serverSelect: document.getElementById("servers"),
	connectionPopup: document.getElementById("connectionPopup"),
	reconnectBtn: document.getElementById("reconnectBtn"),
	joinBtn: document.getElementById("joinBtn"),
	stationList: document.getElementById("stationList"),
	stationTotal: document.getElementById("stationTotal"),
	pipBtn: document.getElementById("pipBtn"),
};

// Application State
class AppState {
	constructor() {
		this.serverData = {};
		this.currentServer = "all";
		this.hoveredPlayer = null;
		this.isDragging = false;
		this.dragStart = null;
		this.currentScale = 1;
		this.lastTouchDistance = 0;
		this.ws = null;
		this.reconnectAttempts = 0;
		this.maxReconnectAttempts = 3;
		this.reconnectTimeout = null;
		this.mapImages = [];
		this.loadedImages = 0;
		this.totalImages = MAP_CONFIG.rows * MAP_CONFIG.columns;
		this.staleCheckInterval = null;
		this.lastStationSignature = "";
		this.pipWindow = null;
		this.pipCanvas = null;
		this.pipContext = null;
		this.pipLastCssSize = { width: 0, height: 0 };
		this.pipView = {
			scale: 1,
			offsetX: 0,
			offsetY: 0,
			isDragging: false,
			dragStart: { x: 0, y: 0 },
		};
		this.pipHoveredPlayer = null;
		this.pipSelectedPlayer = null;
		this.pipOverlay = null;
	}

	getAllPlayers() {
		if (this.currentServer === "all") {
			return Object.values(this.serverData)
				.map((serverInfo) => serverInfo.players || [])
				.flat();
		}
		return this.serverData[this.currentServer]?.players || [];
	}
}

const state = new AppState();

const supportsDocumentPiP = () => {
	return (
		typeof window !== "undefined" &&
		"documentPictureInPicture" in window &&
		typeof window.documentPictureInPicture?.requestWindow === "function"
	);
};

const getWebSocketUrl = () => {
	const isLocalhost =
		location.hostname === "localhost" ||
		location.hostname === "127.0.0.1" ||
		location.hostname === "[::1]";

	// When running locally, use the public live stream directly.
	if (isLocalhost) return "wss://map.dovedale.wiki/api/ws";

	return (
		(location.protocol === "http:" ? "ws://" : "wss://") +
		`${window.location.host}/api/ws`
	);
};

// Utility Functions
const getCanvasCoordinates = (event) => {
	const rect = canvas.getBoundingClientRect();
	return {
		x: event.clientX - rect.left,
		y: event.clientY - rect.top,
	};
};

const getDistanceBetweenTouches = (touches) => {
	const distanceX = touches[0].clientX - touches[1].clientX;
	const distanceY = touches[0].clientY - touches[1].clientY;
	return Math.hypot(distanceX, distanceY);
};

const getPlayerColor = (name) => {
	if (!name) return "#00FFFF";

	let value = 0;
	for (let index = 0; index < name.length; index++) {
		const charValue = name.charCodeAt(index);
		let reverseIndex = name.length - index;
		if (name.length % 2 === 1) reverseIndex--;
		value += reverseIndex % 4 >= 2 ? -charValue : charValue;
	}

	const colorIndex = ((value % COLORS.length) + COLORS.length) % COLORS.length;
	return COLORS[colorIndex];
};

const worldToCanvas = (worldX, worldY) => {
	const relativeX = (worldX - WORLD_BOUNDS.TOP_LEFT.x) / WORLD_WIDTH;
	const relativeY = (worldY - WORLD_BOUNDS.TOP_LEFT.y) / WORLD_HEIGHT;

	const mapAspectRatio = MAP_CONFIG.totalWidth / MAP_CONFIG.totalHeight;
	const canvasAspectRatio = canvas.width / canvas.height;

	const scaleFactor =
		mapAspectRatio > canvasAspectRatio
			? canvas.width / MAP_CONFIG.totalWidth
			: canvas.height / MAP_CONFIG.totalHeight;

	const scaledMapWidth = MAP_CONFIG.totalWidth * scaleFactor;
	const scaledMapHeight = MAP_CONFIG.totalHeight * scaleFactor;
	const offsetX = (canvas.width - scaledMapWidth) / 2;
	const offsetY = (canvas.height - scaledMapHeight) / 2;

	return {
		x: offsetX + relativeX * scaledMapWidth,
		y: offsetY + relativeY * scaledMapHeight,
	};
};

const canvasToWorld = (canvasX, canvasY) => {
	const mapAspectRatio = MAP_CONFIG.totalWidth / MAP_CONFIG.totalHeight;
	const canvasAspectRatio = canvas.width / canvas.height;

	const scaleFactor =
		mapAspectRatio > canvasAspectRatio
			? canvas.width / MAP_CONFIG.totalWidth
			: canvas.height / MAP_CONFIG.totalHeight;

	const scaledMapWidth = MAP_CONFIG.totalWidth * scaleFactor;
	const scaledMapHeight = MAP_CONFIG.totalHeight * scaleFactor;
	const offsetX = (canvas.width - scaledMapWidth) / 2;
	const offsetY = (canvas.height - scaledMapHeight) / 2;

	const relativeX = (canvasX - offsetX) / scaledMapWidth;
	const relativeY = (canvasY - offsetY) / scaledMapHeight;

	return {
		x: WORLD_BOUNDS.TOP_LEFT.x + relativeX * WORLD_WIDTH,
		y: WORLD_BOUNDS.TOP_LEFT.y + relativeY * WORLD_HEIGHT,
	};
};

const getDestinationFromPlayer = (player) => {
	const trainData = player?.trainData;
	if (!trainData) return null;

	if (Array.isArray(trainData)) {
		return typeof trainData[0] === "string" ? trainData[0] : null;
	}

	if (typeof trainData === "object") {
		return typeof trainData.destination === "string"
			? trainData.destination
			: null;
	}

	return null;
};

const getHeadcodeFromPlayer = (player) => {
	const trainData = player?.trainData;
	if (!trainData) return null;

	if (Array.isArray(trainData)) {
		const headcode = trainData[2];
		return typeof headcode === "string" && headcode.trim() && headcode !== "----"
			? headcode
			: null;
	}

	if (typeof trainData === "object") {
		const headcode = trainData.headcode;
		return typeof headcode === "string" && headcode.trim() && headcode !== "----"
			? headcode
			: null;
	}

	return null;
};

const getTrainClassFromPlayer = (player) => {
	const trainData = player?.trainData;
	if (!trainData) return null;

	if (Array.isArray(trainData)) {
		const trainClass = trainData[1];
		return typeof trainClass === "string" && trainClass.trim() && trainClass !== "Unknown"
			? trainClass
			: null;
	}

	if (typeof trainData === "object") {
		const trainClass = trainData.trainClass;
		return typeof trainClass === "string" && trainClass.trim() && trainClass !== "Unknown"
			? trainClass
			: null;
	}

	return null;
};

const escapeHtml = (value) => {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
};

const updateStationPanel = () => {
	if (!elements.stationList || !elements.stationTotal) return;

	const stationCounts = new Map();
	const playersToShow = state.getAllPlayers();

	playersToShow.forEach((player) => {
		const destination = getDestinationFromPlayer(player);
		if (!destination) return;
		stationCounts.set(destination, (stationCounts.get(destination) || 0) + 1);
	});

	const entries = Array.from(stationCounts.entries()).sort((first, second) => {
		if (second[1] !== first[1]) return second[1] - first[1];
		return first[0].localeCompare(second[0]);
	});

	const signature = JSON.stringify(entries);
	if (signature === state.lastStationSignature) return;
	state.lastStationSignature = signature;

	elements.stationTotal.textContent = `${entries.length} tracked`;

	if (!entries.length) {
		elements.stationList.innerHTML =
			'<div class="text-zinc-400">No station destination data yet.</div>';
		return;
	}

	elements.stationList.innerHTML = entries
		.slice(0, 12)
		.map(
			([station, count]) => `
			<div class="flex items-center justify-between bg-zinc-800/80 rounded-lg px-2 py-1">
				<span class="truncate pr-2">${escapeHtml(station)}</span>
				<span class="text-zinc-300 text-xs">${count}</span>
			</div>
		`,
		)
		.join("");
};

const getPipBaseLayout = (width, height) => {
	const mapAspectRatio = MAP_CONFIG.totalWidth / MAP_CONFIG.totalHeight;
	const canvasAspectRatio = width / height;
	const baseScale =
		mapAspectRatio > canvasAspectRatio
			? width / MAP_CONFIG.totalWidth
			: height / MAP_CONFIG.totalHeight;

	const mapWidth = MAP_CONFIG.totalWidth * baseScale;
	const mapHeight = MAP_CONFIG.totalHeight * baseScale;
	const offsetX = (width - mapWidth) / 2;
	const offsetY = (height - mapHeight) / 2;

	return { baseScale, mapWidth, mapHeight, offsetX, offsetY };
};

const transformPipPoint = (x, y, width, height) => {
	const centerX = width / 2;
	const centerY = height / 2;
	return {
		x: (x - centerX) * state.pipView.scale + centerX + state.pipView.offsetX,
		y: (y - centerY) * state.pipView.scale + centerY + state.pipView.offsetY,
	};
};

const pipScreenToWorld = (screenX, screenY, width, height) => {
	const centerX = width / 2;
	const centerY = height / 2;
	const base = getPipBaseLayout(width, height);

	const unscaledX =
		(screenX - state.pipView.offsetX - centerX) / state.pipView.scale + centerX;
	const unscaledY =
		(screenY - state.pipView.offsetY - centerY) / state.pipView.scale + centerY;

	const relativeX = (unscaledX - base.offsetX) / base.mapWidth;
	const relativeY = (unscaledY - base.offsetY) / base.mapHeight;

	return {
		x: WORLD_BOUNDS.TOP_LEFT.x + relativeX * WORLD_WIDTH,
		y: WORLD_BOUNDS.TOP_LEFT.y + relativeY * WORLD_HEIGHT,
	};
};

const worldToPipScreen = (worldX, worldY, width, height) => {
	const base = getPipBaseLayout(width, height);
	const relativeX = (worldX - WORLD_BOUNDS.TOP_LEFT.x) / WORLD_WIDTH;
	const relativeY = (worldY - WORLD_BOUNDS.TOP_LEFT.y) / WORLD_HEIGHT;

	const baseX = base.offsetX + relativeX * base.mapWidth;
	const baseY = base.offsetY + relativeY * base.mapHeight;

	return transformPipPoint(baseX, baseY, width, height);
};

const getPipPlayerAtPosition = (screenX, screenY, pipWidth, pipHeight) => {
	const playersToCheck = state.getAllPlayers();
	let closestPlayer = null;
	let closestDistance = Number.POSITIVE_INFINITY;

	for (const player of playersToCheck) {
		const worldX = player.position?.x;
		const worldY = player.position?.y;
		if (typeof worldX !== "number" || typeof worldY !== "number") continue;

		const pipPoint = worldToPipScreen(worldX, worldY, pipWidth, pipHeight);
		const hitRadius = player.trainData ? 12 : 9;
		const distance = Math.hypot(pipPoint.x - screenX, pipPoint.y - screenY);

		if (distance <= hitRadius && distance < closestDistance) {
			closestPlayer = player;
			closestDistance = distance;
		}
	}

	return closestPlayer;
};

const getPipPlayerLabel = (player) => {
	if (!player) return "";
	const destination = getDestinationFromPlayer(player);
	if (destination) {
		return `${player.username ?? "Unknown"} → ${destination}`;
	}
	return player.username ?? "Unknown";
};

const updatePipOverlay = () => {
	if (!state.pipOverlay) return;

	const selectedPlayer = state.pipSelectedPlayer || state.pipHoveredPlayer;
	if (!selectedPlayer) {
		state.pipOverlay.hidden = true;
		return;
	}

	const headcode = getHeadcodeFromPlayer(selectedPlayer);
	const destination = getDestinationFromPlayer(selectedPlayer);
	const trainClass = getTrainClassFromPlayer(selectedPlayer);
	const detailLines = [];

	if (destination) {
		detailLines.push(
			`<div style="font-size:12px; color:#cbd5e1;">Destination: ${escapeHtml(destination)}</div>`,
		);
	}

	if (trainClass) {
		detailLines.push(
			`<div style="font-size:12px; color:#cbd5e1;">Class: ${escapeHtml(trainClass)}</div>`,
		);
	}

	if (headcode) {
		detailLines.push(
			`<div style="font-size:12px; color:#cbd5e1;">Headcode: ${escapeHtml(headcode)}</div>`,
		);
	}

	state.pipOverlay.innerHTML = `
		<div style="font-size:13px; font-weight:700; margin-bottom:4px;">${escapeHtml(selectedPlayer.username ?? "Unknown")}</div>
		${detailLines.join("")}
	`;
	state.pipOverlay.hidden = false;
};

const renderPictureInPicture = () => {
	if (!state.pipContext || !state.pipCanvas) return;

	const pipCanvas = state.pipCanvas;
	const pipContext = state.pipContext;
	const dpr = Math.max(
		1,
		state.pipWindow?.devicePixelRatio || window.devicePixelRatio || 1,
	);
	const cssWidth = state.pipLastCssSize.width || 420;
	const cssHeight = state.pipLastCssSize.height || 250;
	const pipWidth = Math.max(1, Math.round(cssWidth * dpr));
	const pipHeight = Math.max(1, Math.round(cssHeight * dpr));
	const base = getPipBaseLayout(pipWidth, pipHeight);

	if (pipCanvas.width !== pipWidth || pipCanvas.height !== pipHeight) {
		pipCanvas.width = pipWidth;
		pipCanvas.height = pipHeight;
	}

	pipContext.clearRect(0, 0, pipWidth, pipHeight);
	pipContext.fillStyle = "#0a0a0a";
	pipContext.fillRect(0, 0, pipWidth, pipHeight);
	pipContext.imageSmoothingEnabled = false;

	for (let row = 0; row < MAP_CONFIG.rows; row++) {
		for (let column = 0; column < MAP_CONFIG.columns; column++) {
			const image = state.mapImages[row]?.[column];
			if (!image?.complete) continue;

			const chunkWidth = base.mapWidth / MAP_CONFIG.columns;
			const chunkHeight = base.mapHeight / MAP_CONFIG.rows;
			const baseX = base.offsetX + column * chunkWidth;
			const baseY = base.offsetY + row * chunkHeight;
			const transformedTopLeft = transformPipPoint(
				baseX,
				baseY,
				pipWidth,
				pipHeight,
			);
			const transformedBottomRight = transformPipPoint(
				baseX + chunkWidth,
				baseY + chunkHeight,
				pipWidth,
				pipHeight,
			);

			pipContext.drawImage(
				image,
				0,
				0,
				image.width,
				image.height,
				transformedTopLeft.x,
				transformedTopLeft.y,
				transformedBottomRight.x - transformedTopLeft.x,
				transformedBottomRight.y - transformedTopLeft.y,
			);
		}
	}
	pipContext.imageSmoothingEnabled = true;

	const playersToShow = state.getAllPlayers();
	for (const player of playersToShow) {
		const worldX = player.position?.x;
		const worldY = player.position?.y;
		if (typeof worldX !== "number" || typeof worldY !== "number") continue;

		const pipPoint = worldToPipScreen(worldX, worldY, pipWidth, pipHeight);
		const isHovered = state.pipHoveredPlayer?.username === player.username;
		const isSelected = state.pipSelectedPlayer?.username === player.username;
		const baseRadius = player.trainData ? 6.5 : 5;
		const markerRadius = baseRadius * dpr;

		pipContext.beginPath();
		pipContext.arc(pipPoint.x, pipPoint.y, markerRadius, 0, Math.PI * 2);
		pipContext.fillStyle = getPlayerColor(player.username ?? "Unknown");
		pipContext.fill();

		pipContext.lineWidth = (isSelected ? 3 : isHovered ? 2.5 : 1.2) * dpr;
		pipContext.strokeStyle = isSelected ? "#ffffff" : isHovered ? "#67e8f9" : "#020617";
		pipContext.stroke();

		if (player.trainData) {
			pipContext.beginPath();
			pipContext.arc(pipPoint.x, pipPoint.y, markerRadius + 3 * dpr, 0, Math.PI * 2);
			pipContext.strokeStyle = isSelected ? "#fde68a" : "rgba(255,255,255,0.22)";
			pipContext.lineWidth = 1.2 * dpr;
			pipContext.stroke();
		}

		if (isHovered || isSelected) {
			const label = getPipPlayerLabel(player);
			pipContext.font = `${12 * dpr}px Inter`;
			const labelMetrics = pipContext.measureText(label);
			const labelWidth = labelMetrics.width + 10 * dpr;
			const labelHeight = 18 * dpr;
			const labelX = Math.min(pipWidth - labelWidth - 8 * dpr, pipPoint.x + 10 * dpr);
			const labelY = Math.max(8 * dpr, pipPoint.y - 24 * dpr);

			pipContext.fillStyle = "rgba(2, 6, 23, 0.88)";
			pipContext.fillRect(labelX, labelY, labelWidth, labelHeight);
			pipContext.strokeStyle = isSelected ? "#22d3ee" : "rgba(255,255,255,0.18)";
			pipContext.strokeRect(labelX, labelY, labelWidth, labelHeight);
			pipContext.fillStyle = "#f8fafc";
			pipContext.fillText(label, labelX + 5 * dpr, labelY + 13 * dpr);
		}
	}

	pipContext.fillStyle = "rgba(3, 7, 18, 0.75)";
	pipContext.fillRect(0, pipHeight - 30 * dpr, pipWidth, 30 * dpr);
	pipContext.fillStyle = "#e5e7eb";
	pipContext.font = `${12 * dpr}px Inter`;
	pipContext.fillText(
		`Players: ${playersToShow.length}  |  Zoom: ${state.pipView.scale.toFixed(2)}x`,
		8 * dpr,
		pipHeight - 10 * dpr,
	);

	updatePipOverlay();
};

const closePictureInPicture = () => {
	if (state.pipWindow && !state.pipWindow.closed) {
		state.pipWindow.close();
	}
	state.pipWindow = null;
	state.pipCanvas = null;
	state.pipContext = null;
	state.pipLastCssSize = { width: 0, height: 0 };
	state.pipView.isDragging = false;

	if (elements.pipBtn) {
		elements.pipBtn.textContent = "PiP";
	}
};

const openPictureInPicture = async () => {
	if (!supportsDocumentPiP()) return;

	if (state.pipWindow && !state.pipWindow.closed) {
		closePictureInPicture();
		return;
	}

	const pipWindow = await window.documentPictureInPicture.requestWindow({
		width: 420,
		height: 250,
	});

	pipWindow.document.body.style.margin = "0";
	pipWindow.document.body.style.background = "#020617";
	pipWindow.document.body.style.overflow = "hidden";

	const pipCanvas = pipWindow.document.createElement("canvas");
	pipCanvas.style.width = "100%";
	pipCanvas.style.height = "100%";
	pipCanvas.style.cursor = "grab";
	pipWindow.document.body.appendChild(pipCanvas);

	state.pipWindow = pipWindow;
	state.pipCanvas = pipCanvas;
	state.pipContext = pipCanvas.getContext("2d");
	state.pipOverlay = pipWindow.document.createElement("div");
	state.pipOverlay.style.position = "absolute";
	state.pipOverlay.style.left = "10px";
	state.pipOverlay.style.top = "10px";
	state.pipOverlay.style.zIndex = "10";
	state.pipOverlay.style.pointerEvents = "none";
	state.pipOverlay.style.background = "rgba(2, 6, 23, 0.88)";
	state.pipOverlay.style.border = "1px solid rgba(103, 232, 249, 0.35)";
	state.pipOverlay.style.borderRadius = "10px";
	state.pipOverlay.style.padding = "8px 10px";
	state.pipOverlay.style.color = "#e2e8f0";
	state.pipOverlay.style.fontFamily = "Inter, sans-serif";
	state.pipOverlay.style.maxWidth = "240px";
	state.pipOverlay.hidden = true;
	pipWindow.document.body.style.position = "relative";
	pipWindow.document.body.appendChild(state.pipOverlay);
	state.pipLastCssSize = {
		width: pipWindow.innerWidth || 420,
		height: pipWindow.innerHeight || 250,
	};
	state.pipView = {
		scale: 1,
		offsetX: 0,
		offsetY: 0,
		isDragging: false,
		dragStart: { x: 0, y: 0 },
	};

	pipWindow.addEventListener("resize", () => {
		state.pipLastCssSize = {
			width: pipWindow.innerWidth || 420,
			height: pipWindow.innerHeight || 250,
		};
		renderPictureInPicture();
	});

	pipCanvas.addEventListener("mousedown", (event) => {
		state.pipView.isDragging = true;
		state.pipView.dragStart = { x: event.clientX, y: event.clientY };
		state.pipSelectedPlayer = null;
		state.pipHoveredPlayer = null;
		updatePipOverlay();
		pipCanvas.style.cursor = "grabbing";
	});

	pipWindow.addEventListener("mouseup", () => {
		state.pipView.isDragging = false;
		pipCanvas.style.cursor = "grab";
	});

	pipCanvas.addEventListener("mouseleave", () => {
		state.pipView.isDragging = false;
		pipCanvas.style.cursor = "grab";
	});

	pipCanvas.addEventListener("mousemove", (event) => {
		if (state.pipView.isDragging) {
			const distanceX = event.clientX - state.pipView.dragStart.x;
			const distanceY = event.clientY - state.pipView.dragStart.y;
			state.pipView.dragStart = { x: event.clientX, y: event.clientY };

			state.pipView.offsetX += distanceX;
			state.pipView.offsetY += distanceY;
			renderPictureInPicture();
			return;
		}

		const rect = pipCanvas.getBoundingClientRect();
		const dpr = Math.max(
			1,
			state.pipWindow?.devicePixelRatio || window.devicePixelRatio || 1,
		);
		const pointerX = (event.clientX - rect.left) * dpr;
		const pointerY = (event.clientY - rect.top) * dpr;
		const hoveredPlayer = getPipPlayerAtPosition(pointerX, pointerY, pipCanvas.width, pipCanvas.height);

		if (hoveredPlayer !== state.pipHoveredPlayer) {
			state.pipHoveredPlayer = hoveredPlayer;
			pipCanvas.style.cursor = hoveredPlayer ? "pointer" : "grab";
			updatePipOverlay();
			renderPictureInPicture();
		}
	});

	pipCanvas.addEventListener("click", (event) => {
		if (state.pipView.isDragging) return;

		const rect = pipCanvas.getBoundingClientRect();
		const dpr = Math.max(
			1,
			state.pipWindow?.devicePixelRatio || window.devicePixelRatio || 1,
		);
		const pointerX = (event.clientX - rect.left) * dpr;
		const pointerY = (event.clientY - rect.top) * dpr;
		const clickedPlayer = getPipPlayerAtPosition(pointerX, pointerY, pipCanvas.width, pipCanvas.height);

		state.pipSelectedPlayer = clickedPlayer;
		state.pipHoveredPlayer = clickedPlayer;
		updatePipOverlay();
		renderPictureInPicture();
	});

	pipCanvas.addEventListener("wheel", (event) => {
		event.preventDefault();

		const rect = pipCanvas.getBoundingClientRect();
		const dpr = Math.max(
			1,
			state.pipWindow?.devicePixelRatio || window.devicePixelRatio || 1,
		);
		const mouseX = (event.clientX - rect.left) * dpr;
		const mouseY = (event.clientY - rect.top) * dpr;
		const beforeWorld = pipScreenToWorld(mouseX, mouseY, pipCanvas.width, pipCanvas.height);

		const zoomIntensity = 0.12;
		const zoomFactor = event.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
		state.pipView.scale = Math.min(
			30,
			Math.max(0.7, state.pipView.scale * zoomFactor),
		);

		const afterScreen = worldToPipScreen(
			beforeWorld.x,
			beforeWorld.y,
			pipCanvas.width,
			pipCanvas.height,
		);

		state.pipView.offsetX += mouseX - afterScreen.x;
		state.pipView.offsetY += mouseY - afterScreen.y;
		renderPictureInPicture();
	}, { passive: false });

	pipWindow.addEventListener("pagehide", () => {
		state.pipWindow = null;
		state.pipCanvas = null;
		state.pipContext = null;
		state.pipOverlay = null;
		state.pipLastCssSize = { width: 0, height: 0 };
		state.pipView.isDragging = false;
		state.pipHoveredPlayer = null;
		state.pipSelectedPlayer = null;
		if (elements.pipBtn) elements.pipBtn.textContent = "PiP";
	});

	if (elements.pipBtn) {
		elements.pipBtn.textContent = "Close PiP";
	}

	renderPictureInPicture();
};

function drawRoundedRectangle(context, x, y, width, height, radius) {
	if (width < 2 * radius) radius = width / 2;
	if (height < 2 * radius) radius = height / 2;
	context.beginPath();
	context.moveTo(x + radius, y);
	context.arcTo(x + width, y, x + width, y + height, radius);
	context.arcTo(x + width, y + height, x, y + height, radius);
	context.arcTo(x, y + height, x, y, radius);
	context.arcTo(x, y, x + width, y, radius);
	context.closePath();
}

const trackTransforms = () => {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	let transform = svg.createSVGMatrix();

	context.getTransform = () => transform;

	const savedTransforms = [];
	const original = {
		save: context.save,
		restore: context.restore,
		scale: context.scale,
		translate: context.translate,
	};

	context.save = function () {
		savedTransforms.push(transform.translate(0, 0));
		return original.save.call(context);
	};

	context.restore = function () {
		transform = savedTransforms.pop();
		return original.restore.call(context);
	};

	context.scale = function (scaleX, scaleY) {
		transform = transform.scaleNonUniform(scaleX, scaleY);
		state.currentScale *= scaleX;
		return original.scale.call(context, scaleX, scaleY);
	};

	context.translate = function (distanceX, distanceY) {
		transform = transform.translate(distanceX, distanceY);
		return original.translate.call(context, distanceX, distanceY);
	};

	const point = svg.createSVGPoint();
	context.transformedPoint = function (x, y) {
		point.x = x;
		point.y = y;
		return point.matrixTransform(transform.inverse());
	};
};

const zoomAt = (screenX, screenY, scaleFactor) => {
	const point = context.transformedPoint(screenX, screenY);
	context.translate(point.x, point.y);
	context.scale(scaleFactor, scaleFactor);
	context.translate(-point.x, -point.y);

	state.currentScale *= scaleFactor;
	drawScene();
};

const getPlayerAtPosition = (canvasX, canvasY) => {
	const playersToCheck = state.getAllPlayers();

	for (const player of playersToCheck) {
		const worldX = player.position?.x ?? 0;
		const worldY = player.position?.y ?? 0;

		const baseCanvasPosition = worldToCanvas(worldX, worldY);
		const transform = context.getTransform();

		const screenX =
			baseCanvasPosition.x * transform.a +
			baseCanvasPosition.y * transform.c +
			transform.e;
		const screenY =
			baseCanvasPosition.x * transform.b +
			baseCanvasPosition.y * transform.d +
			transform.f;

		const baseRadius = 3;
		const scaleFactor = Math.max(0.3, 1 / Math.pow(state.currentScale, 0.4));
		const hitRadius = baseRadius * scaleFactor * Math.abs(transform.a);

		const distance = Math.hypot(screenX - canvasX, screenY - canvasY);

		if (distance <= hitRadius) return player;
	}

	return null;
};

const updateTooltip = (player) => {
	if (!player) {
		elements.tooltip.classList.add("hidden");
		return;
	}

	const name = player.username ?? "Unknown";

	const playerElement = elements.tooltip.querySelector("#player div");
	if (playerElement) playerElement.textContent = name;

	const destinationSection = elements.tooltip.querySelector("#destination");
	const trainNameSection = elements.tooltip.querySelector("#train-name");
	const headcodeSection = elements.tooltip.querySelector("#headcode");
	const trainClassSection = elements.tooltip.querySelector("#train-class");

	if (player.trainData && Object.keys(player.trainData).length > 0) {
		const { destination, trainClass, headcode, trainType } = player.trainData;

		if (destination && destination !== "Unknown" && destinationSection) {
			const destinationDiv = destinationSection.querySelector("div");
			if (destinationDiv) destinationDiv.textContent = destination;
			destinationSection.style.display = "flex";
		} else if (destinationSection) {
			destinationSection.style.display = "none";
		}

		if (trainClass && trainClass !== "Unknown" && trainClassSection) {
			const classDiv = trainClassSection.querySelector("div");
			if (classDiv) classDiv.textContent = trainClass;
			trainClassSection.style.display = "flex";
		} else if (trainClassSection) {
			trainClassSection.style.display = "none";
		}

		if (getHeadcodeFromPlayer(player) && headcodeSection) {
			const headDiv = headcodeSection.querySelector("div");
			if (headDiv) headDiv.textContent = getHeadcodeFromPlayer(player);
			headcodeSection.style.display = "flex";
		} else if (headcodeSection) {
			headcodeSection.style.display = "none";
		}

		if (trainNameSection) trainNameSection.style.display = "none";
	} else {
		[
			destinationSection,
			trainNameSection,
			headcodeSection,
			trainClassSection,
		].forEach((section) => {
			if (section) section.style.display = "none";
		});
	}

	const playerSection = elements.tooltip.querySelector("#player");
	if (playerSection) playerSection.style.display = "flex";

	const serverSection = elements.tooltip.querySelector("#server");
	if (serverSection && state.currentServer === "all") {
		const serverDiv = serverSection.querySelector("div");
		if (serverDiv) {
			let serverName = "Unknown";
			for (const [jobId, serverInfo] of Object.entries(state.serverData)) {
				if (serverInfo.players && serverInfo.players.includes(player)) {
					serverName =
						jobId.length > 6 ? jobId.substring(jobId.length - 6) : jobId;
					break;
				}
			}
			serverDiv.textContent = serverName;
		}
		serverSection.style.display = "flex";
	} else if (serverSection) {
		serverSection.style.display = "none";
	}

	// Position tooltip
	const worldX = player.position?.x ?? 0;
	const worldY = player.position?.y ?? 0;
	const baseCanvasPosition = worldToCanvas(worldX, worldY);
	const transform = context.getTransform();

	const screenX =
		baseCanvasPosition.x * transform.a +
		baseCanvasPosition.y * transform.c +
		transform.e;
	const screenY =
		baseCanvasPosition.x * transform.b +
		baseCanvasPosition.y * transform.d +
		transform.f;

	const canvasRect = canvas.getBoundingClientRect();
	const tooltipX = canvasRect.left + screenX;
	const tooltipY = canvasRect.top + screenY;

	let finalX = tooltipX + 15;
	let finalY = tooltipY - 40;

	elements.tooltip.classList.remove("hidden");
	elements.tooltip.style.visibility = "hidden";

	const tooltipRect = elements.tooltip.getBoundingClientRect();

	if (finalX + tooltipRect.width > window.innerWidth) {
		finalX = tooltipX - tooltipRect.width - 15;
	}
	if (finalY < 0) {
		finalY = tooltipY + 20;
	}
	if (finalY + tooltipRect.height > window.innerHeight) {
		finalY = tooltipY - tooltipRect.height - 20;
	}
	if (finalX < 0) {
		finalX = tooltipX + 15;
	}

	elements.tooltip.style.left = `${finalX}px`;
	elements.tooltip.style.top = `${finalY}px`;
	elements.tooltip.style.visibility = "visible";
};

let resizeTimeout = null;
const handleWindowResize = () => {
	if (resizeTimeout) {
		clearTimeout(resizeTimeout);
	}

	resizeTimeout = setTimeout(() => {
		const currentTransform = context.getTransform();
		canvas.width = window.innerWidth;
		canvas.height = window.innerHeight;
		context.setTransform(currentTransform);
		drawScene();
	}, 16);

	drawScene();
};

const cleanupStaleServers = () => {
	const now = Date.now();
	let hasStaleServers = false;

	for (const [jobId, serverInfo] of Object.entries(state.serverData)) {
		if (now - serverInfo.lastUpdate > STALE_SERVER_TIMEOUT) {
			console.log(`Removing stale server: ${jobId}`);
			delete state.serverData[jobId];
			hasStaleServers = true;
		}
	}

	if (hasStaleServers) {
		updateServerList();
		drawScene();
	}
};

const startStaleServerCleanup = () => {
	if (state.staleCheckInterval) {
		clearInterval(state.staleCheckInterval);
	}
	console.log("Starting stale server cleanup loop");
	state.staleCheckInterval = setInterval(cleanupStaleServers, 5000); // every 5s
};

const stopStaleServerCleanup = () => {
	if (state.staleCheckInterval) {
		console.log("Stopping stale server cleanup loop");
		clearInterval(state.staleCheckInterval);
		state.staleCheckInterval = null;
	}
};

const createWebSocket = () => {
	if (state.reconnectTimeout) {
		clearTimeout(state.reconnectTimeout);
		state.reconnectTimeout = null;
	}

	if (state.ws) {
		state.ws.close();
		state.ws = null;
	}

	state.ws = new WebSocket(
		getWebSocketUrl(),
	);

	state.ws.addEventListener("open", () => {
		console.log("WebSocket connected");
		state.reconnectAttempts = 0;
		hideConnectionPopup();
		startStaleServerCleanup();
	});

	state.ws.addEventListener("message", (event) => {
		try {
			const data = JSON.parse(event.data);
			const jobId = data.jobId;
			const playersArray = Array.isArray(data.players) ? data.players : [];

			if (playersArray.length === 0 && data.serverShutdown) {
				delete state.serverData[jobId];
			} else {
				state.serverData[jobId] = {
					players: playersArray,
					lastUpdate: Date.now(),
				};
			}
			updateServerList(data);
			drawScene();
		} catch (err) {
			console.error("Error parsing data", err);
		}
	});

	state.ws.addEventListener("error", (err) => {
		console.warn("WebSocket error:", err);
	});

	state.ws.addEventListener("close", (event) => {
		console.warn("WebSocket closed:", event.code, event.reason);
		showConnectionPopup();
		stopStaleServerCleanup();

		if (
			state.reconnectAttempts < state.maxReconnectAttempts &&
			!state.reconnectTimeout
		) {
			state.reconnectTimeout = setTimeout(() => {
				state.reconnectTimeout = null;
				attemptReconnect();
			}, 1000);
		}
	});

	return state.ws;
};

const showConnectionPopup = () => {
	elements.connectionPopup.classList.remove(
		"opacity-0",
		"-translate-y-5",
		"pointer-events-none",
	);
	elements.connectionPopup.classList.add("opacity-100", "translate-y-0");
	updateReconnectButton();
};

const hideConnectionPopup = () => {
	elements.connectionPopup.classList.add(
		"opacity-0",
		"-translate-y-5",
		"pointer-events-none",
	);
	elements.connectionPopup.classList.remove("opacity-100", "translate-y-0");

	elements.reconnectBtn.disabled = false;
	elements.reconnectBtn.classList.remove("bg-zinc-600");
	elements.reconnectBtn.classList.add("bg-blue-600", "hover:bg-blue-700");

	const reconnectIcon = document.getElementById("reconnectIcon");
	if (reconnectIcon) {
		reconnectIcon.classList.remove("animate-spin");
	}

	elements.reconnectBtn.innerHTML = `
    <i id="reconnectIcon" class="material-symbols-outlined text-4">refresh</i>
    Reconnect
  `;
};

const updateReconnectButton = () => {
	if (state.reconnectAttempts >= state.maxReconnectAttempts) {
		elements.reconnectBtn.innerHTML = `
      <i id="reconnectIcon" class="material-symbols-outlined text-4">refresh</i>
      Reconnect
    `;
		elements.reconnectBtn.disabled = false;
		elements.reconnectBtn.classList.remove("bg-zinc-600");
		elements.reconnectBtn.classList.add("bg-blue-600", "hover:bg-blue-700");
	}
};

const attemptReconnect = () => {
	if (state.reconnectTimeout) {
		return;
	}

	if (state.reconnectAttempts >= state.maxReconnectAttempts) {
		updateReconnectButton();
		return;
	}

	state.reconnectAttempts++;

	elements.reconnectBtn.disabled = true;
	elements.reconnectBtn.classList.add("bg-zinc-600");
	elements.reconnectBtn.classList.remove("bg-blue-600", "hover:bg-blue-700");

	elements.reconnectBtn.innerHTML = `
		<i id="reconnectIcon" class="material-symbols-outlined text-4 animate-spin">refresh</i>
		Connecting...
	`;

	if (state.ws && state.ws.readyState !== WebSocket.CLOSED) {
		state.ws.close();
	}

	createWebSocket();
};

const resetReconnection = () => {
	state.reconnectAttempts = 0;
	if (state.reconnectTimeout) {
		clearTimeout(state.reconnectTimeout);
		state.reconnectTimeout = null;
	}
};

const updateServerList = (data = null) => {
	const currentServers = Object.keys(state.serverData);
	const existingServers = Array.from(elements.serverSelect.options)
		.slice(1)
		.map((opt) => opt.value);

	if (data?.players) {
		const playersArray = Array.isArray(data.players) ? data.players : [];

		playersArray.forEach((player) => {
			if (!player.trainData || !Array.isArray(player.trainData)) return;
			const trainData = player.trainData;

			if (typeof trainData !== "object" || trainData === null) {
				player.trainData = null;
				return;
			}

			player.trainData = [
				trainData.destination || "Unknown",
				trainData.class || "Unknown",
				trainData.headcode || "----",
				trainData.headcodeClass || "",
			];
		});
	}

	// this will constantly recreate the options which can
	//  make selecting an option difficult on certain browsers
	// TODO: only update when required
	const selectedValue = elements.serverSelect.value;
	const totalPlayersCount = Object.values(state.serverData).reduce(
		(count, serverInfo) =>
			count +
			(Array.isArray(serverInfo.players) ? serverInfo.players.length : 0),
		0,
	);

	let html = `<option value="all">All Servers (${totalPlayersCount} players)</option>`;

	currentServers.forEach((jobId) => {
		const serverName =
			jobId.length > 6
				? `Server ${jobId.substring(jobId.length - 6)}`
				: `Server ${jobId}`;
		const playerCount = Array.isArray(state.serverData[jobId]?.players)
			? state.serverData[jobId].players.length
			: 0;
		const selected = selectedValue === jobId ? " selected" : "";
		html += `<option value="${jobId}"${selected}>${serverName} (${playerCount} / 50 players)</option>`;
	});

	elements.serverSelect.innerHTML = html;

	if (selectedValue !== "all" && !currentServers.includes(selectedValue)) {
		elements.serverSelect.value = "all";
		elements.joinBtn.href = "roblox://experiences/start?placeId=12018816388";
		state.currentServer = "all";
	} else {
		elements.serverSelect.value = selectedValue;
	}
};

const drawScene = () => {
	const transformedPoint1 = context.transformedPoint(0, 0);
	const transformedPoint2 = context.transformedPoint(
		canvas.width,
		canvas.height,
	);
	context.clearRect(
		transformedPoint1.x,
		transformedPoint1.y,
		transformedPoint2.x - transformedPoint1.x,
		transformedPoint2.y - transformedPoint1.y,
	);

	const mapAspectRatio = MAP_CONFIG.totalWidth / MAP_CONFIG.totalHeight;
	const canvasAspectRatio = canvas.width / canvas.height;

	const scaleFactor =
		mapAspectRatio > canvasAspectRatio
			? canvas.width / MAP_CONFIG.totalWidth
			: canvas.height / MAP_CONFIG.totalHeight;

	const scaledMapWidth = MAP_CONFIG.totalWidth * scaleFactor;
	const scaledMapHeight = MAP_CONFIG.totalHeight * scaleFactor;
	const offsetX = (canvas.width - scaledMapWidth) / 2;
	const offsetY = (canvas.height - scaledMapHeight) / 2;

	const chunkWidth = MAP_CONFIG.totalWidth / MAP_CONFIG.columns;
	const chunkHeight = MAP_CONFIG.totalHeight / MAP_CONFIG.rows;
	const scaledChunkWidth = chunkWidth * scaleFactor;
	const scaledChunkHeight = chunkHeight * scaleFactor;

	context.imageSmoothingEnabled = false;

	for (let row = 0; row < MAP_CONFIG.rows; row++) {
		for (let column = 0; column < MAP_CONFIG.columns; column++) {
			const image = state.mapImages[row]?.[column];
			if (image?.complete) {
				const destinationX = offsetX + column * scaledChunkWidth;
				const destinationY = offsetY + row * scaledChunkHeight;

				const overlap = Math.max(0.5, 2 / state.currentScale);
				const drawWidth =
					scaledChunkWidth + (column < MAP_CONFIG.columns - 1 ? overlap : 0);
				const drawHeight =
					scaledChunkHeight + (row < MAP_CONFIG.rows - 1 ? overlap : 0);

				context.drawImage(
					image,
					0,
					0,
					image.width,
					image.height,
					destinationX,
					destinationY,
					drawWidth,
					drawHeight,
				);
			}
		}
	}
	context.imageSmoothingEnabled = true;

	const playersToShow = state.getAllPlayers();
	elements.players.innerHTML = `Players: ${playersToShow.length}`;

	const dotScaleFactor = Math.max(0.3, 1 / Math.pow(state.currentScale, 0.4));

	playersToShow.forEach((player) => {
		const worldX = player.position?.x ?? 0;
		const worldY = player.position?.y ?? 0;
		const name = player.username ?? "Unknown";

		const canvasPosition = worldToCanvas(worldX, worldY);
		const isHovered = state.hoveredPlayer?.username === name;
		const baseRadius = isHovered ? 2.5 : 2;
		const radius = baseRadius * dotScaleFactor;

		context.fillStyle = getPlayerColor(name);
		context.beginPath();
		context.arc(canvasPosition.x, canvasPosition.y, radius, 0, Math.PI * 2);
		context.fill();

		context.strokeStyle = isHovered ? "white" : "black";
		context.lineWidth = Math.max((isHovered ? 0.7 : 0.4) * scaleFactor, 0.25);
		context.stroke();
	});

	if (state.currentScale > 300) return;
	const markerFontSize = Math.max(0.2, 10 / Math.pow(state.currentScale, 0.3));
	Object.entries(AREA_MARKERS).forEach(([name, { x, y }]) => {
		const position = worldToCanvas(x, y);
		context.font = `${markerFontSize}px Inter`;

		const metrics = context.measureText(name);
		const textWidth = metrics.width;
		const ascent = metrics.actualBoundingBoxAscent || markerFontSize * 0.8;
		const descent = metrics.actualBoundingBoxDescent || markerFontSize * 0.2;
		const textHeight = ascent + descent;

		const padX = markerFontSize * 0.6;
		const padY = markerFontSize * 0.4;
		const boxWidth = textWidth + padX * 2;
		const boxHeight = textHeight + padY * 2;

		const boxX = position.x - boxWidth / 2;
		const boxY = position.y - boxHeight / 2;

		const radius = Math.min(boxHeight / 2, markerFontSize * 0.5);
		context.fillStyle = "#00000078";
		context.strokeStyle = "transparent";
		context.lineWidth = Math.max(0.5 * (markerFontSize / 10), 0.4);

		drawRoundedRectangle(context, boxX, boxY, boxWidth, boxHeight, radius);
		context.fill();
		context.stroke();

		context.fillStyle = "#fff";
		context.fillText(name, position.x - textWidth / 2, boxY + padY + ascent);
	});

	updateStationPanel();
	renderPictureInPicture();
};

const loadMapImages = () => {
	for (let row = 0; row < MAP_CONFIG.rows; row++) {
		state.mapImages[row] = [];
		for (let column = 0; column < MAP_CONFIG.columns; column++) {
			const image = new Image();
			image.src = `/images/row-${row + 1}-column-${column + 1}.png`;

			image.onload = () => {
				state.loadedImages++;
				if (state.loadedImages === 1) {
					initializeMap();
				} else {
					drawScene();
				}
			};

			image.onerror = () => {
				console.error(`Failed to load image: ${image.src}`);
				state.loadedImages++;
				drawScene();
			};

			state.mapImages[row][column] = image;
		}
	}
};

const initializeMap = () => {
	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;

	const canvasCenter = worldToCanvas(WORLD_CENTER.x, WORLD_CENTER.y);
	context.translate(
		window.innerWidth / 2 - canvasCenter.x,
		window.innerHeight / 2 - canvasCenter.y,
	);
	drawScene();
};

const handleMouseEvents = () => {
	canvas.addEventListener("mousedown", (event) => {
		const mousePosition = getCanvasCoordinates(event);
		state.dragStart = context.transformedPoint(
			mousePosition.x,
			mousePosition.y,
		);
		state.isDragging = true;
		return false;
	});

	canvas.addEventListener("mousemove", (event) => {
		if (state.isDragging) {
			if (state.hoveredPlayer) {
				state.hoveredPlayer = null;
				elements.tooltip.classList.add("hidden");
			}

			const mousePosition = getCanvasCoordinates(event);
			const currentPoint = context.transformedPoint(
				mousePosition.x,
				mousePosition.y,
			);
			const distanceX = currentPoint.x - state.dragStart.x;
			const distanceY = currentPoint.y - state.dragStart.y;

			context.translate(distanceX, distanceY);
			drawScene();
		} else {
			const mousePosition = getCanvasCoordinates(event);
			const player = getPlayerAtPosition(mousePosition.x, mousePosition.y);

			if (player !== state.hoveredPlayer) {
				state.hoveredPlayer = player;
				updateTooltip(player, event.clientX, event.clientY);
				drawScene();
			}
		}
	});

	canvas.addEventListener("mouseleave", () => {
		state.isDragging = false;
		state.dragStart = null;

		if (state.hoveredPlayer) {
			state.hoveredPlayer = null;
			elements.tooltip.classList.add("hidden");
			drawScene();
		}
	});

	canvas.addEventListener("mouseup", () => {
		state.isDragging = false;
		state.dragStart = null;
	});

	canvas.addEventListener(
		"wheel",
		(event) => {
			event.preventDefault();
			const zoomIntensity = 0.1;
			const scale = event.deltaY < 0 ? 1 + zoomIntensity : 1 - zoomIntensity;
			const mousePosition = getCanvasCoordinates(event);
			zoomAt(mousePosition.x, mousePosition.y, scale);
		},
		{ passive: false },
	);
};

const handleTouchEvents = () => {
	canvas.addEventListener(
		"touchstart",
		(event) => {
			state.hoveredPlayer = null;
			elements.tooltip.classList.add("hidden");

			if (event.touches.length === 1) {
				const touchPosition = getCanvasCoordinates(event.touches[0]);
				state.dragStart = context.transformedPoint(
					touchPosition.x,
					touchPosition.y,
				);
				state.isDragging = true;
			} else if (event.touches.length === 2) {
				state.lastTouchDistance = getDistanceBetweenTouches(event.touches);
			}
		},
		{ passive: false },
	);

	canvas.addEventListener(
		"touchmove",
		(event) => {
			event.preventDefault();

			state.hoveredPlayer = null;
			elements.tooltip.classList.add("hidden");

			if (event.touches.length === 1 && state.isDragging) {
				const touchPosition = getCanvasCoordinates(event.touches[0]);
				const currentPoint = context.transformedPoint(
					touchPosition.x,
					touchPosition.y,
				);
				const distanceX = currentPoint.x - state.dragStart.x;
				const distanceY = currentPoint.y - state.dragStart.y;

				context.translate(distanceX, distanceY);
				drawScene();
			} else if (event.touches.length === 2) {
				const newDistance = getDistanceBetweenTouches(event.touches);
				const scale = newDistance / state.lastTouchDistance;

				const centerX =
					(event.touches[0].clientX + event.touches[1].clientX) / 2;
				const centerY =
					(event.touches[0].clientY + event.touches[1].clientY) / 2;

				zoomAt(centerX, centerY, scale);
				state.lastTouchDistance = newDistance;
			}
		},
		{ passive: false },
	);

	canvas.addEventListener("touchend", (event) => {
		if (event.touches.length < 2) state.lastTouchDistance = 0;
		if (event.touches.length === 0) {
			state.isDragging = false;
			state.dragStart = null;
		}
	});
};

elements.serverSelect.addEventListener("change", () => {
	state.currentServer = elements.serverSelect.value;
	drawScene();

	if (elements.serverSelect.value === "all") {
		elements.joinBtn.href = "roblox://experiences/start?placeId=12018816388";
	} else {
		elements.joinBtn.href =
			"roblox://experiences/start?placeId=12018816388&gameInstanceId=" +
			elements.serverSelect.value;
	}
});

elements.reconnectBtn.addEventListener("click", () => {
	if (state.reconnectTimeout) {
		clearTimeout(state.reconnectTimeout);
		state.reconnectTimeout = null;
	}

	state.reconnectAttempts = 0;
	attemptReconnect();
});

const start = () => {
	if (elements.pipBtn) {
		if (!supportsDocumentPiP()) {
			elements.pipBtn.disabled = true;
			elements.pipBtn.title = "Document Picture-in-Picture is not supported in this browser";
			elements.pipBtn.classList.add("opacity-50", "cursor-not-allowed");
		} else {
			elements.pipBtn.addEventListener("click", () => {
				openPictureInPicture().catch((error) => {
					console.error("Unable to open Picture-in-Picture window", error);
				});
			});
		}
	}

	trackTransforms();
	loadMapImages();
	handleMouseEvents();
	handleTouchEvents();
	window.addEventListener("resize", handleWindowResize);

	canvas.width = window.innerWidth;
	canvas.height = window.innerHeight;

	drawScene();
	elements.serverSelect.innerHTML =
		'<option value="all">All Servers (0 players)</option>';
	createWebSocket();
};

start();
