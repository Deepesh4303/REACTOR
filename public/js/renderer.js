/**
 * Canvas renderer for the Chain Reaction board.
 *
 * IMPORTANT GEOMETRY:
 * The playable face is a TRUE front-facing square grid.  It is not an
 * isometric/parallelogram projection.  A second copy of that square is drawn
 * behind it and connected with diagonal depth lines, matching the supplied
 * reference image.
 */
class Renderer {
    constructor(canvas, gameState) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.gameState = gameState;
        this.hovered = null;
        this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

        this.designWidth = 1200;
        this.designHeight = 700;
        this.canvas.width = this.designWidth * this.dpr;
        this.canvas.height = this.designHeight * this.dpr;
        this.ctx.scale(this.dpr, this.dpr);

        // FRONT FACE — deliberately axis aligned.
        // This is the face the player clicks and the face particles sit on.
        this.cellSize = 58;
        this.origin = { x: 250, y: 205 };

        // BACK FACE / EXTRUSION — diagonal up/right, like the reference.
        this.depthVector = { x: 36, y: -36 };
        this.depth = 1;
    }

    setGameState(gameState) {
        this.gameState = gameState;
    }

    // depth=0 -> front/playable face
    // depth=1 -> rear face
    project(col, row, depth = 0) {
        return {
            x: this.origin.x + col * this.cellSize + depth * this.depthVector.x,
            y: this.origin.y + row * this.cellSize + depth * this.depthVector.y
        };
    }

    cellCorners(row, col, depth = 0) {
        return [
            this.project(col, row, depth),
            this.project(col + 1, row, depth),
            this.project(col + 1, row + 1, depth),
            this.project(col, row + 1, depth)
        ];
    }

    cellCenter(row, col, depth = -0.035) {
        return this.project(col + 0.5, row + 0.5, depth);
    }

    clear() {
        this.ctx.clearRect(0, 0, this.designWidth, this.designHeight);
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(0, 0, this.designWidth, this.designHeight);
    }

    draw() {
        this.clear();
        this.drawFloorGlow();
        this.drawDepthFrame();
        this.drawBackGrid();
        this.drawFrontGrid();
        this.drawCells();
        if (this.hovered) this.drawCellHighlight(this.hovered.row, this.hovered.col);
    }

    drawFloorGlow() {
        const ctx = this.ctx;
        const center = this.project(
            this.gameState.width / 2,
            this.gameState.height / 2,
            0
        );
        const gradient = ctx.createRadialGradient(
            center.x, center.y, 20,
            center.x, center.y, 430
        );
        gradient.addColorStop(0, 'rgba(0,255,153,0.055)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, this.designWidth, this.designHeight);
    }

    drawBackGrid() {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = 1.0;
        ctx.strokeStyle = 'rgba(220,255,248,0.52)';
        ctx.shadowColor = 'rgba(0,255,180,0.18)';
        ctx.shadowBlur = 4;

        for (let row = 0; row <= this.gameState.height; row++) {
            this.line(
                this.project(0, row, this.depth),
                this.project(this.gameState.width, row, this.depth)
            );
        }

        for (let col = 0; col <= this.gameState.width; col++) {
            this.line(
                this.project(col, 0, this.depth),
                this.project(col, this.gameState.height, this.depth)
            );
        }
        ctx.restore();
    }

    drawDepthFrame() {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = 1.1;
        ctx.strokeStyle = 'rgba(235,255,252,0.62)';
        ctx.shadowColor = 'rgba(0,255,180,0.22)';
        ctx.shadowBlur = 4;

        // Every front vertex is connected to its corresponding rear vertex.
        // This is what creates the box/extruded look in the reference.
        for (let row = 0; row <= this.gameState.height; row++) {
            for (let col = 0; col <= this.gameState.width; col++) {
                this.line(
                    this.project(col, row, 0),
                    this.project(col, row, this.depth)
                );
            }
        }

        // Strong outer silhouette on the rear face.
        ctx.lineWidth = 1.7;
        ctx.strokeStyle = 'rgba(240,255,253,0.82)';
        const w = this.gameState.width;
        const h = this.gameState.height;
        const outer = [
            [[0, 0], [w, 0]],
            [[w, 0], [w, h]],
            [[w, h], [0, h]],
            [[0, h], [0, 0]]
        ];
        for (const [a, b] of outer) {
            this.line(
                this.project(a[0], a[1], this.depth),
                this.project(b[0], b[1], this.depth)
            );
        }
        ctx.restore();
    }

    drawFrontGrid() {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = 1.25;
        ctx.strokeStyle = 'rgba(220,255,248,0.82)';
        ctx.shadowColor = 'rgba(0,255,180,0.30)';
        ctx.shadowBlur = 5;

        // These lines are perfectly horizontal/vertical.
        for (let row = 0; row <= this.gameState.height; row++) {
            this.line(
                this.project(0, row, 0),
                this.project(this.gameState.width, row, 0)
            );
        }

        for (let col = 0; col <= this.gameState.width; col++) {
            this.line(
                this.project(col, 0, 0),
                this.project(col, this.gameState.height, 0)
            );
        }

        // Strong front silhouette.
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = 'rgba(240,255,253,0.90)';
        const w = this.gameState.width;
        const h = this.gameState.height;
        const outer = [
            [[0, 0], [w, 0]],
            [[w, 0], [w, h]],
            [[w, h], [0, h]],
            [[0, h], [0, 0]]
        ];
        for (const [a, b] of outer) {
            this.line(
                this.project(a[0], a[1], 0),
                this.project(b[0], b[1], 0)
            );
        }
        ctx.restore();
    }

    drawCells() {
        for (let row = 0; row < this.gameState.height; row++) {
            for (let col = 0; col < this.gameState.width; col++) {
                const cell = this.gameState.getCell(row, col);
                if (!cell?.owner || cell.particle_count <= 0) continue;

                // Slightly toward the camera so particles render over the grid.
                const center = this.cellCenter(row, col, -0.045);
                this.drawParticles(
                    center.x,
                    center.y,
                    cell.particle_count,
                    this.getPlayerColor(cell.owner)
                );
            }
        }
    }

    drawParticles(x, y, count, color) {
        const offsets = {
            1: [[0, 0]],
            2: [[-15, 0], [15, 0]],
            3: [[-15, -11], [15, -11], [0, 14]],
            4: [[-14, -14], [14, -14], [-14, 14], [14, 14]]
        }[Math.min(count, 4)] || [];

        const radius = 13;
        const now = performance.now() * 0.001;

        for (let i = 0; i < offsets.length; i++) {
            const [dx, dy] = offsets[i];
            this.drawLowPolySphere(
                x + dx,
                y + dy,
                radius,
                color,
                now * 2.2 + i * 1.35
            );
        }
    }

    drawLowPolySphere(cx, cy, radius, color, rotation) {
        const rgb = this.hexToRgb(color);
        const bands = 5;
        const segments = 10;
        const faces = [];

        for (let band = 0; band < bands; band++) {
            const lat0 = -Math.PI / 2 + band * Math.PI / bands;
            const lat1 = -Math.PI / 2 + (band + 1) * Math.PI / bands;

            for (let segment = 0; segment < segments; segment++) {
                const a0 = rotation + segment * Math.PI * 2 / segments;
                const a1 = rotation + (segment + 1) * Math.PI * 2 / segments;
                const p = [
                    this.spherePoint(lat0, a0, radius),
                    this.spherePoint(lat0, a1, radius),
                    this.spherePoint(lat1, a1, radius),
                    this.spherePoint(lat1, a0, radius)
                ];
                faces.push({
                    p,
                    depth: p.reduce((sum, q) => sum + q.depth, 0) / 4
                });
            }
        }

        const ctx = this.ctx;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 11;
        faces.sort((a, b) => a.depth - b.depth);

        for (const face of faces) {
            const brightness = 0.45 + 0.55 * Math.max(0, face.depth);
            ctx.fillStyle =
                `rgb(${Math.min(255, Math.round(rgb.r * brightness))},` +
                `${Math.min(255, Math.round(rgb.g * brightness))},` +
                `${Math.min(255, Math.round(rgb.b * brightness))})`;

            ctx.beginPath();
            face.p.forEach((q, i) => {
                if (i === 0) ctx.moveTo(cx + q.x, cy + q.y);
                else ctx.lineTo(cx + q.x, cy + q.y);
            });
            ctx.closePath();
            ctx.fill();
        }

        // Moving highlight makes rotation readable even at small particle size.
        const highlightX = cx + Math.cos(rotation * 0.85) * radius * 0.30;
        const highlightY = cy - radius * 0.38;
        const highlight = ctx.createRadialGradient(
            highlightX, highlightY, 0,
            highlightX, highlightY, radius * 0.46
        );
        highlight.addColorStop(0, 'rgba(255,255,255,0.82)');
        highlight.addColorStop(0.35, 'rgba(255,255,255,0.20)');
        highlight.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = highlight;
        ctx.beginPath();
        ctx.arc(highlightX, highlightY, radius * 0.46, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    spherePoint(latitude, longitude, radius) {
        const h = Math.cos(latitude);
        const depth = h * Math.sin(longitude);
        return {
            x: radius * h * Math.cos(longitude),
            y: radius * Math.sin(latitude) - depth * radius * 0.12,
            depth
        };
    }

    drawCellHighlight(row, col) {
        const points = this.cellCorners(row, col, -0.01);
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = 'rgba(0,255,153,0.10)';
        ctx.strokeStyle = 'rgba(0,255,153,0.75)';
        ctx.shadowColor = 'rgba(0,255,153,0.65)';
        ctx.shadowBlur = 12;
        this.polygon(points, true);
        this.polygon(points, false);
        ctx.restore();
    }

    drawAnimationFrame(animation) {
        const from = this.cellCenter(animation.fromRow, animation.fromCol, -0.055);
        const to = this.cellCenter(animation.toRow, animation.toCol, -0.055);
        const t = animation.progress;
        const eased = t * t * (3 - 2 * t);
        const x = from.x + (to.x - from.x) * eased;
        const y = from.y + (to.y - from.y) * eased;

        this.drawLowPolySphere(
            x,
            y,
            animation.radius || 8,
            animation.color,
            performance.now() * 0.003 + animation.phase
        );
    }

    drawExplosion(effect) {
        const center = this.cellCenter(effect.row, effect.col, -0.07);
        const p = Math.min(
            1,
            (performance.now() - effect.startTime) / effect.duration
        );
        const ctx = this.ctx;

        ctx.save();
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = effect.color;
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 24;
        ctx.lineWidth = 3 + (1 - p) * 3;
        ctx.beginPath();
        ctx.arc(center.x, center.y, 12 + p * 44, 0, Math.PI * 2);
        ctx.stroke();

        ctx.globalAlpha = (1 - p) * 0.65;
        ctx.fillStyle = effect.color;
        ctx.beginPath();
        ctx.arc(center.x, center.y, 8 + (1 - p) * 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    getGridCoordinates(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.designWidth / rect.width;
        const scaleY = this.designHeight / rect.height;
        const sx = (clientX - rect.left) * scaleX;
        const sy = (clientY - rect.top) * scaleY;

        // The clickable face is a simple axis-aligned rectangle.
        // DO NOT include the rear extrusion in hit testing.
        const colFloat = (sx - this.origin.x) / this.cellSize;
        const rowFloat = (sy - this.origin.y) / this.cellSize;

        if (
            colFloat < 0 ||
            rowFloat < 0 ||
            colFloat >= this.gameState.width ||
            rowFloat >= this.gameState.height
        ) {
            return null;
        }

        return {
            row: Math.floor(rowFloat),
            col: Math.floor(colFloat)
        };
    }

    setHover(coords) {
        this.hovered = coords;
    }

    getPlayerColor(playerId) {
        return this.gameState.getPlayer(playerId)?.color || '#ffffff';
    }

    hexToRgb(color) {
        const raw = String(color || '#ffffff').replace('#', '');
        const value = raw.length === 3
            ? raw.split('').map(x => x + x).join('')
            : raw.padEnd(6, 'f');
        const n = parseInt(value.slice(0, 6), 16) || 0xffffff;
        return {
            r: (n >> 16) & 255,
            g: (n >> 8) & 255,
            b: n & 255
        };
    }

    line(a, b) {
        this.ctx.beginPath();
        this.ctx.moveTo(a.x, a.y);
        this.ctx.lineTo(b.x, b.y);
        this.ctx.stroke();
    }

    polygon(points, fill) {
        this.ctx.beginPath();
        points.forEach((p, i) =>
            i ? this.ctx.lineTo(p.x, p.y) : this.ctx.moveTo(p.x, p.y)
        );
        this.ctx.closePath();
        fill ? this.ctx.fill() : this.ctx.stroke();
    }
}
