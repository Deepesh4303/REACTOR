/**
 * Client-side game state management
 * Mirrors the server-side game state for local computation
 */

class GameState {
    constructor(width = 6, height = 6) {
        // Never use Array.fill(object) for cells: that would make every
        // position reference the same Cell object.
        this.board = Array.from({ length: height }, () =>
            Array.from({ length: width }, () => ({
                owner: null,
                particle_count: 0
            }))
        );
        this.players = new Map();
        this.currentTurn = null;
        this.eliminated = [];
        this.moveCount = 0;
        this.isOver = false;
        this.winner = null;
        this.width = width;
        this.height = height;
    }

    /**
     * Initialize game from server state
     */
    initializeFromServer(state) {
        this.board = state.board || [];
        this.currentTurn = state.current_turn;
        this.eliminated = state.eliminated || [];
        this.moveCount = state.move_count || 0;
        this.isOver = state.is_over || false;
        this.winner = state.winner;
        this.width = state.width || 6;
        this.height = state.height || 6;

        // Initialize players from server
        if (state.players) {
            this.players.clear();
            for (const [id, player] of Object.entries(state.players)) {
                this.players.set(id, player);
            }
        }
    }

    /**
     * Add a player to the game
     */
    addPlayer(id, color) {
        this.players.set(id, {
            id,
            color,
            is_alive: true,
            has_played: false
        });
    }

    /**
     * Get the critical mass for a cell
     */
    getCriticalMass(row, col) {
        let count = 0;
        if (row > 0) count++; // top
        if (row < this.height - 1) count++; // bottom
        if (col > 0) count++; // left
        if (col < this.width - 1) count++; // right
        return count;
    }

    /**
     * Check if a move is valid
     */
    isValidMove(row, col, playerId) {
        // Check bounds
        if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
            return { valid: false, reason: 'Out of bounds' };
        }

        // Check if it's the player's turn
        if (this.currentTurn !== playerId) {
            return { valid: false, reason: 'Not your turn' };
        }

        // Check if game is over
        if (this.isOver) {
            return { valid: false, reason: 'Game is over' };
        }

        // Can place on empty cells or opponent's cells
        const cell = this.board[row][col];
        if (cell.owner === playerId && cell.particle_count >= this.getCriticalMass(row, col)) {
            // Can't add to a cell that would explode (server will handle)
            // But actually we can - server validates
        }

        return { valid: true };
    }

    /**
     * Apply a move locally (after server confirms)
     */
    applyMove(playerId, row, col) {
        const player = this.players.get(playerId);
        if (player) player.has_played = true;

        const cell = this.board[row][col];

        // Overtake if opponent's cell
        if (cell.owner && cell.owner !== playerId) {
            cell.owner = playerId;
            cell.particle_count = 1;
        } else if (cell.owner === playerId) {
            // Add to own cell
            cell.particle_count++;
        } else {
            // Empty cell
            cell.owner = playerId;
            cell.particle_count = 1;
        }

        this.moveCount++;

        // Check for chain reactions
        this.checkChainReactions(row, col);

        // Advance turn
        this.advanceTurn();

        // Check win condition
        this.checkWinCondition();
    }

    /**
     * Check and handle chain reactions
     */
    checkChainReactions(row, col) {
        const toCheck = [{ row, col }];

        while (toCheck.length > 0) {
            const { row: r, col: c } = toCheck.pop();

            if (r < 0 || r >= this.height || c < 0 || c >= this.width) {
                continue;
            }

            const cell = this.board[r][c];
            const criticalMass = this.getCriticalMass(r, c);

            if (cell.particle_count >= criticalMass) {
                const owner = cell.owner;
                const particles = cell.particle_count;

                // Clear cell
                cell.particle_count = 0;
                cell.owner = null;

                // Send to adjacent cells
                const adjacent = [
                    { row: r - 1, col: c },
                    { row: r + 1, col: c },
                    { row: r, col: c - 1 },
                    { row: r, col: c + 1 }
                ];

                for (const adj of adjacent) {
                    if (adj.row >= 0 && adj.row < this.height && 
                        adj.col >= 0 && adj.col < this.width && owner) {
                        const adjCell = this.board[adj.row][adj.col];
                        adjCell.owner = owner;
                        adjCell.particle_count++;
                        toCheck.push(adj);
                    }
                }
            }
        }
    }

    /**
     * Advance to next player's turn
     */
    advanceTurn() {
        if (!this.currentTurn) return;

        const playerIds = Array.from(this.players.keys());
        const currentIndex = playerIds.indexOf(this.currentTurn);
        let nextIndex = (currentIndex + 1) % playerIds.length;

        // Skip eliminated players
        let attempts = 0;
        while (attempts < playerIds.length) {
            const nextPlayer = playerIds[nextIndex];
            if (this.players.get(nextPlayer).is_alive) {
                this.currentTurn = nextPlayer;
                return;
            }
            nextIndex = (nextIndex + 1) % playerIds.length;
            attempts++;
        }

        this.currentTurn = null;
    }

    /**
     * Check win condition
     */
    checkWinCondition() {
        this.checkElimination();

        const everyoneHasPlayed = Array.from(this.players.values())
            .every(player => player.has_played);

        if (!everyoneHasPlayed) {
            return;
        }

        const alivePlayers = Array.from(this.players.entries())
            .filter(([_, p]) => p.is_alive)
            .map(([id, _]) => id);

        if (alivePlayers.length === 1) {
            this.isOver = true;
            this.winner = alivePlayers[0];
            this.currentTurn = null;
        } else if (alivePlayers.length === 0) {
            this.isOver = true;
        }
    }

    /**
     * Check which players are eliminated (have no particles)
     */
    checkElimination() {
        for (const [playerId, player] of this.players.entries()) {
            if (player.is_alive && player.has_played) {
                const hasParticles = this.board.some(row =>
                    row.some(cell => cell.owner === playerId)
                );

                if (!hasParticles && this.moveCount > 0) {
                    player.is_alive = false;
                    if (!this.eliminated.includes(playerId)) {
                        this.eliminated.push(playerId);
                    }
                }
            }
        }
    }

    /**
     * Get cell at position
     */
    getCell(row, col) {
        if (row < 0 || row >= this.height || col < 0 || col >= this.width) {
            return null;
        }
        return this.board[row][col];
    }

    /**
     * Get current turn player info
     */
    getCurrentPlayer() {
        if (!this.currentTurn) return null;
        return this.players.get(this.currentTurn);
    }

    /**
     * Get all alive players
     */
    getAlivePlayers() {
        return Array.from(this.players.values())
            .filter(p => p.is_alive);
    }

    /**
     * Get player by ID
     */
    getPlayer(id) {
        return this.players.get(id);
    }
}
