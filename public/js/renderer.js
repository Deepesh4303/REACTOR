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
        this.shake = { x: 0, y: 0 };
    }

    setGameState(gameState) {
        this.gameState = gameState;
    }

    setShake(x, y) {
        this.shake = { x, y };
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
        this.ctx.save();
        if (this.shake.x !== 0 || this.shake.y !== 0) {
            this.ctx.translate(this.shake.x, this.shake.y);
        }
        this.drawFloorGlow();
        this.drawDepthFrame();
        this.drawBackGrid();
        this.drawFrontGrid();
        this.drawCells();
        if (this.hovered) this.drawCellHighlight(this.hovered.row, this.hovered.col);
        this.ctx.restore();
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
                    this.getPlayerColor(cell.owner),
                    row,
                    col
                );
            }
        }
    }

    drawParticles(x, y, count, color, row = 0, col = 0) {
        const radius = 12.5;
        const now = performance.now() * 0.001;
        const cellPhase = (row * 13 + col * 17) * 0.4;
        const criticalMass = this.gameState.getCriticalMass(row, col);
        const isCritical = count >= criticalMass - 1;
        const baseSpeed = isCritical ? 4.2 : 2.5;

        // Build list of particle positions with z-depth for 3D orbital sorting
        const particles = [];

        if (count === 1) {
            // Single sphere: rotating around its own 3D axis at cell center, gently breathing
            const floatScale = 1 + Math.sin(now * 2.8 + cellPhase) * 0.04;
            particles.push({
                x,
                y,
                z: 0,
                r: radius * floatScale,
                rotation: now * 2.5 + cellPhase
            });
        } else if (count === 2) {
            // Two spheres: circular binary orbit revolving around cell center
            const orbitRadius = 11.5;
            const orbitAngle = now * baseSpeed + cellPhase;
            const tilt = 0.68; // 3D orbital inclination

            for (let i = 0; i < 2; i++) {
                const a = orbitAngle + i * Math.PI;
                particles.push({
                    x: x + Math.cos(a) * orbitRadius,
                    y: y + Math.sin(a) * orbitRadius * tilt,
                    z: Math.sin(a),
                    r: radius,
                    rotation: now * 3.4 + i * 1.8
                });
            }
        } else if (count === 3) {
            // Three spheres: revolving equilateral triangle
            const orbitRadius = 12.8;
            const orbitAngle = now * (baseSpeed * 1.1) + cellPhase;
            const tilt = 0.70;

            for (let i = 0; i < 3; i++) {
                const a = orbitAngle + i * (2 * Math.PI / 3);
                particles.push({
                    x: x + Math.cos(a) * orbitRadius,
                    y: y + Math.sin(a) * orbitRadius * tilt,
                    z: Math.sin(a),
                    r: radius * 0.96,
                    rotation: now * 3.8 + i * 1.5
                });
            }
        } else {
            // 4+ spheres: high-energy rapid revolution with critical mass vibration!
            const orbitRadius = 13.5;
            const orbitAngle = now * 5.2 + cellPhase;
            const vibe = Math.sin(now * 32 + cellPhase) * 1.3;
            const tilt = 0.72;

            for (let i = 0; i < Math.min(count, 4); i++) {
                const a = orbitAngle + i * (Math.PI / 2);
                particles.push({
                    x: x + Math.cos(a) * (orbitRadius + vibe),
                    y: y + Math.sin(a) * (orbitRadius + vibe) * tilt,
                    z: Math.sin(a),
                    r: radius * 0.93,
                    rotation: now * 5.0 + i * 1.3
                });
            }
        }

        // Depth-sort particles so rear spheres render before front spheres
        particles.sort((a, b) => a.z - b.z);

        for (const p of particles) {
            this.draw3DSphere(p.x, p.y, p.r, color, p.rotation, isCritical);
        }
    }

    draw3DSphere(cx, cy, radius, color, rotation, isCritical = false) {
        const rgb = this.hexToRgb(color);
        const ctx = this.ctx;

        ctx.save();

        // 1. Soft glowing outer energy aura
        const auraRadius = radius * (isCritical ? 1.9 : 1.5);
        const aura = ctx.createRadialGradient(cx, cy, radius * 0.4, cx, cy, auraRadius);
        aura.addColorStop(0, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isCritical ? 0.45 : 0.28})`);
        aura.addColorStop(0.7, `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${isCritical ? 0.15 : 0.07})`);
        aura.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.arc(cx, cy, auraRadius, 0, Math.PI * 2);
        ctx.fill();

        // 2. 3D sphere volume with directional specular lighting
        const lightX = cx - radius * 0.32;
        const lightY = cy - radius * 0.35;
        const sphereGrad = ctx.createRadialGradient(lightX, lightY, 1, cx, cy, radius);

        // Specular apex to deep rim
        sphereGrad.addColorStop(0, '#ffffff');
        sphereGrad.addColorStop(0.22, `rgb(${Math.min(255, rgb.r + 85)}, ${Math.min(255, rgb.g + 85)}, ${Math.min(255, rgb.b + 85)})`);
        sphereGrad.addColorStop(0.60, `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
        sphereGrad.addColorStop(0.88, `rgb(${Math.round(rgb.r * 0.45)}, ${Math.round(rgb.g * 0.45)}, ${Math.round(rgb.b * 0.45)})`);
        sphereGrad.addColorStop(1.0, `rgb(${Math.round(rgb.r * 0.2)}, ${Math.round(rgb.g * 0.2)}, ${Math.round(rgb.b * 0.2)})`);

        ctx.shadowColor = color;
        ctx.shadowBlur = isCritical ? 14 : 9;
        ctx.fillStyle = sphereGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();

        // 3. Rotating 3D energy rings (giving realistic spinning particle appearance)
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.clip(); // Keep rings strictly within sphere boundary

        ctx.shadowBlur = 0;
        ctx.lineWidth = 1.1;

        // Rotating equatorial energy ring
        const ringScaleY = Math.sin(rotation);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.40 + 0.35 * Math.abs(ringScaleY)})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius * 0.94, Math.max(1, Math.abs(ringScaleY) * radius * 0.94), 0.35, 0, Math.PI * 2);
        ctx.stroke();

        // Rotating meridian energy ring
        const ringScaleX = Math.cos(rotation);
        ctx.strokeStyle = `rgba(${Math.min(255, rgb.r + 100)}, ${Math.min(255, rgb.g + 100)}, ${Math.min(255, rgb.b + 100)}, ${0.35 + 0.30 * Math.abs(ringScaleX)})`;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, Math.abs(ringScaleX) * radius * 0.94), radius * 0.94, -0.35, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();

        // 4. Bright specular glint
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.beginPath();
        ctx.arc(lightX, lightY, radius * 0.22, 0, Math.PI * 2);
        ctx.fill();

        // 5. Critical mass pulsation corona
        if (isCritical) {
            const coronaR = radius * (1.1 + Math.sin(performance.now() * 0.015) * 0.08);
            ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.75)`;
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.arc(cx, cy, coronaR, 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.restore();
    }

    // Retained for backward compatibility
    drawLowPolySphere(cx, cy, radius, color, rotation) {
        this.draw3DSphere(cx, cy, radius, color, rotation, false);
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
        const cell = this.gameState.getCell(row, col);
        const myId = window.game?.myPlayerId;
        const isOpponent = cell && cell.owner && cell.owner !== myId;

        ctx.save();
        if (isOpponent) {
            // Opponent-occupied: invalid move indicator (red neon warning)
            ctx.fillStyle = 'rgba(255, 45, 65, 0.14)';
            ctx.strokeStyle = 'rgba(255, 55, 75, 0.88)';
            ctx.shadowColor = 'rgba(255, 45, 65, 0.75)';
            ctx.shadowBlur = 14;
            this.polygon(points, true);
            this.polygon(points, false);

            // Subtle red cross indicator
            const center = this.cellCenter(row, col, -0.02);
            const crossR = 9;
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(center.x - crossR, center.y - crossR);
            ctx.lineTo(center.x + crossR, center.y + crossR);
            ctx.moveTo(center.x + crossR, center.y - crossR);
            ctx.lineTo(center.x - crossR, center.y + crossR);
            ctx.stroke();
        } else {
            // Valid cell: glowing neon green/cyan
            ctx.fillStyle = 'rgba(0, 255, 153, 0.13)';
            ctx.strokeStyle = 'rgba(0, 255, 153, 0.88)';
            ctx.shadowColor = 'rgba(0, 255, 153, 0.75)';
            ctx.shadowBlur = 14;
            this.polygon(points, true);
            this.polygon(points, false);
        }
        ctx.restore();
    }

    drawAnimationFrame(animation) {
        const from = this.cellCenter(animation.fromRow, animation.fromCol, -0.055);
        const to = this.cellCenter(animation.toRow, animation.toCol, -0.055);
        const t = animation.progress;
        const eased = t * t * (3 - 2 * t);
        const x = from.x + (to.x - from.x) * eased;
        const y = from.y + (to.y - from.y) * eased;
        const ctx = this.ctx;

        // Laser motion blur trail
        if (t > 0.05 && t < 0.98) {
            ctx.save();
            const trailStartX = from.x + (to.x - from.x) * Math.max(0, eased - 0.28);
            const trailStartY = from.y + (to.y - from.y) * Math.max(0, eased - 0.28);

            const trailGrad = ctx.createLinearGradient(trailStartX, trailStartY, x, y);
            trailGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
            trailGrad.addColorStop(0.5, animation.color);
            trailGrad.addColorStop(1, '#ffffff');

            ctx.strokeStyle = trailGrad;
            ctx.shadowColor = animation.color;
            ctx.shadowBlur = 16;
            ctx.lineWidth = 4.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(trailStartX, trailStartY);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.restore();
        }

        // Flying glowing plasma orb
        this.draw3DSphere(
            x,
            y,
            animation.radius || 9.5,
            animation.color,
            performance.now() * 0.006 + animation.phase,
            true
        );

        // Impact flash on arrival
        if (t >= 0.85) {
            const impactProgress = (t - 0.85) / 0.15;
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.shadowColor = animation.color;
            ctx.shadowBlur = 18;
            ctx.lineWidth = 2 * (1 - impactProgress);
            ctx.beginPath();
            ctx.arc(to.x, to.y, 4 + impactProgress * 16, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    drawExplosion(effect) {
        const center = this.cellCenter(effect.row, effect.col, -0.07);
        const p = effect.getProgress ? effect.getProgress() : Math.min(
            1,
            (performance.now() - effect.startTime) / effect.duration
        );
        const ctx = this.ctx;

        ctx.save();

        // 1. Center Epicenter Flash (rapid decay)
        if (p < 0.45) {
            const flashAlpha = Math.max(0, 1 - p * 2.2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = effect.color;
            ctx.shadowBlur = 28;
            ctx.beginPath();
            ctx.arc(center.x, center.y, 14 * (1 - p * 0.5), 0, Math.PI * 2);
            ctx.fill();
        }

        // 2. Primary Fast Shockwave Ring
        ctx.globalAlpha = Math.max(0, 1 - p);
        ctx.strokeStyle = '#ffffff';
        ctx.shadowColor = effect.color;
        ctx.shadowBlur = 26;
        ctx.lineWidth = 3.5 * (1 - p);
        ctx.beginPath();
        ctx.arc(center.x, center.y, 10 + p * 52, 0, Math.PI * 2);
        ctx.stroke();

        // 3. Secondary Outer Neon Ripple
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2.0 * (1 - p);
        ctx.beginPath();
        ctx.arc(center.x, center.y, 6 + p * 38, 0, Math.PI * 2);
        ctx.stroke();

        // 4. Laser Energy Spikes in 4 orthogonal directions
        const spikeLen = (1 - p) * 32;
        if (spikeLen > 2) {
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = 2.5 * (1 - p);
            ctx.beginPath();
            // North, South, West, East
            ctx.moveTo(center.x, center.y - 6);
            ctx.lineTo(center.x, center.y - 6 - spikeLen);
            ctx.moveTo(center.x, center.y + 6);
            ctx.lineTo(center.x, center.y + 6 + spikeLen);
            ctx.moveTo(center.x - 6, center.y);
            ctx.lineTo(center.x - 6 - spikeLen, center.y);
            ctx.moveTo(center.x + 6, center.y);
            ctx.lineTo(center.x + 6 + spikeLen, center.y);
            ctx.stroke();
        }

        // 5. Bursting Sparks
        if (effect.sparks && effect.sparks.length > 0) {
            for (const s of effect.sparks) {
                const sx = center.x + Math.cos(s.angle) * s.speed * p * 55;
                const sy = center.y + Math.sin(s.angle) * s.speed * p * 55;
                ctx.fillStyle = s.color || '#ffffff';
                ctx.shadowColor = effect.color;
                ctx.shadowBlur = 8;
                ctx.beginPath();
                ctx.arc(sx, sy, Math.max(0.5, s.size * (1 - p)), 0, Math.PI * 2);
                ctx.fill();
            }
        }

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
