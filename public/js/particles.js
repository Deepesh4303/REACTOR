/**
 * Visual particle/explosion animation system.
 *
 * The server is authoritative for game state. A move-result contains the exact
 * ordered explosions that happened, so the client can animate the same chain
 * reaction on every screen without trying to simulate it a second time.
 */

class ParticleAnimation {
    constructor(fromRow, fromCol, toRow, toCol, color, startDelay = 0, duration = 260, phase = 0) {
        this.fromRow = fromRow;
        this.fromCol = fromCol;
        this.toRow = toRow;
        this.toCol = toCol;
        this.color = color;
        this.startDelay = startDelay;
        this.duration = duration;
        this.phase = phase;
        this.startTime = performance.now() + startDelay;
        this.progress = 0;
        this.isComplete = false;
    }

    getProgress(now = performance.now()) {
        if (now < this.startTime) {
            this.progress = 0;
            return 0;
        }

        this.progress = Math.min(
            (now - this.startTime) / this.duration,
            1
        );

        if (this.progress >= 1) {
            this.isComplete = true;
        }

        return this.progress;
    }

    complete() {
        return this.isComplete;
    }
}

class ExplosionVisual {
    constructor(row, col, color, delay = 0, duration = 420) {
        this.row = row;
        this.col = col;
        this.color = color;
        this.delay = delay;
        this.duration = duration;
        this.startTime = performance.now() + delay;
        this.done = false;
    }

    getProgress(now = performance.now()) {
        if (now < this.startTime) return 0;

        const p = Math.min(
            (now - this.startTime) / this.duration,
            1
        );

        if (p >= 1) this.done = true;
        return p;
    }
}

class AnimationManager {
    constructor(renderer) {
        this.renderer = renderer;
        this.animations = [];
        this.explosions = [];
    }

    /**
     * Play the exact chain reaction returned by the Rust game engine.
     */
    playExplosions(explosions = []) {
        const STEP = 105;

        explosions.forEach((explosion, index) => {
            const color = this.renderer.getPlayerColor(explosion.owner);

            // The source cell flashes first.
            this.explosions.push(
                new ExplosionVisual(
                    explosion.row,
                    explosion.col,
                    color,
                    index * STEP
                )
            );

            // Then one particle travels to each valid neighbour.
            const adjacent = [
                { row: explosion.row - 1, col: explosion.col },
                { row: explosion.row + 1, col: explosion.col },
                { row: explosion.row, col: explosion.col - 1 },
                { row: explosion.row, col: explosion.col + 1 }
            ];

            adjacent.forEach((adj, directionIndex) => {
                if (
                    adj.row >= 0 &&
                    adj.row < this.renderer.gameState.height &&
                    adj.col >= 0 &&
                    adj.col < this.renderer.gameState.width
                ) {
                    this.animations.push(
                        new ParticleAnimation(
                            explosion.row,
                            explosion.col,
                            adj.row,
                            adj.col,
                            color,
                            index * STEP + 25,
                            260,
                            directionIndex * 0.9 + index
                        )
                    );
                }
            });
        });
    }

    update() {
        const now = performance.now();

        this.animations = this.animations.filter(animation => {
            animation.getProgress(now);
            return !animation.complete();
        });

        this.explosions = this.explosions.filter(effect => {
            effect.getProgress(now);
            return !effect.done;
        });

        return this.animations.length > 0 || this.explosions.length > 0;
    }

    draw() {
        const now = performance.now();

        // Explosion rings first, travelling particles on top.
        for (const effect of this.explosions) {
            this.renderer.drawExplosion(effect);
        }

        for (const animation of this.animations) {
            animation.getProgress(now);

            // Do not draw a delayed animation before its start.
            if (now < animation.startTime) continue;

            this.renderer.drawAnimationFrame(animation);
        }
    }

    addParticleAnimation(fromRow, fromCol, toRow, toCol, color) {
        const animation = new ParticleAnimation(
            fromRow,
            fromCol,
            toRow,
            toCol,
            color
        );
        this.animations.push(animation);
        return animation;
    }

    clear() {
        this.animations = [];
        this.explosions = [];
    }

    isAnimating() {
        return this.animations.length > 0 || this.explosions.length > 0;
    }
}

/*
 * Kept as a small compatibility wrapper for older callers.
 */
class ExplosionEffect {
    constructor(row, col, color) {
        this.effect = new ExplosionVisual(row, col, color);
        this.complete = false;
    }

    getProgress() {
        const p = this.effect.getProgress();
        this.complete = this.effect.done;
        return p;
    }

    draw(ctx) {
        // New renderer owns the pseudo-3D explosion drawing.
    }
}

class EffectsManager {
    constructor(renderer) {
        this.renderer = renderer;
        this.effects = [];
    }

    addExplosion(row, col, color = '#ffffff') {
        this.effects.push(new ExplosionVisual(row, col, color));
    }

    update() {
        const now = performance.now();
        this.effects = this.effects.filter(effect => {
            effect.getProgress(now);
            return !effect.done;
        });
        return this.effects.length > 0;
    }

    draw() {
        for (const effect of this.effects) {
            this.renderer.drawExplosion(effect);
        }
    }

    clear() {
        this.effects = [];
    }

    isActive() {
        return this.effects.length > 0;
    }
}
