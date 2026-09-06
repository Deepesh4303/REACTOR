/**
 * Main game controller - ties everything together
 */

class ChainReactionGame {
    constructor() {
        this.gameState = new GameState(6, 6);
        this.canvas = document.getElementById('gameBoard');
        this.renderer = new Renderer(this.canvas, this.gameState);
        this.animationManager = new AnimationManager(this.renderer);
        this.effectsManager = new EffectsManager(this.renderer);
        
        this.signalingClient = null;
        this.webrtcClient = null;
        
        this.myPlayerId = null;
        this.myColor = null;
        this.roomId = null;
        
        this.isMyTurn = false;
        this.gameStarted = false;
        this.connectedPeers = new Set();
        
        this.setupUI();
        this.setupAnimationLoop();
    }

    /**
     * Setup UI event listeners
     */
    setupUI() {
        // Setup screen
        document.getElementById('joinBtn').addEventListener('click', () => this.joinGame());
        document.getElementById('leaveBtn').addEventListener('click', () => this.leaveGame());
        document.getElementById('sendBtn').addEventListener('click', () => this.sendChat());
        document.getElementById('playAgainBtn').addEventListener('click', () => this.leaveGame());
        
        // Color picker
        document.querySelectorAll('.color-option').forEach(option => {
            option.addEventListener('click', (e) => {
                document.querySelectorAll('.color-option').forEach(o => o.classList.remove('selected'));
                e.target.classList.add('selected');
            });
        });

        // Canvas click
        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleCanvasHover(e));

        // Chat input
        document.getElementById('chatInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendChat();
            }
        });

        // Select first color by default
        document.querySelector('.color-option')?.classList.add('selected');
    }

    /**
     * Setup animation loop
     */
    setupAnimationLoop() {
        const loop = () => {
            this.update();
            this.draw();
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /**
     * Join a game
     */
    getAvailableColor(preferredColor = null) {
        const defaultColors = ['#FF6B6B', '#4ECDC4', '#FFE66D', '#95E1D3', '#C7CEEA'];
        const usedColors = new Set(Array.from(this.gameState.players.values()).map(player => player.color.toLowerCase()));

        const candidate = preferredColor || document.querySelector('.color-option.selected')?.dataset.color || '#FF6B6B';
        if (!usedColors.has(candidate.toLowerCase())) {
            return candidate;
        }

        for (const color of defaultColors) {
            if (!usedColors.has(color.toLowerCase())) {
                return color;
            }
        }

        return candidate;
    }

    async joinGame() {
        const serverUrl = document.getElementById('serverUrl').value.trim();
        const roomId = document.getElementById('roomId').value.trim() || this.generateRoomId();
        const playerName = document.getElementById('playerName').value.trim() || `Player_${Math.random().toString(36).substring(7)}`;
        const selectedColor = this.getAvailableColor();

        if (!serverUrl) {
            this.showStatus('Please enter server URL', 'error');
            return;
        }

        this.updateStatus('Connecting...');

        try {
            // Initialize signaling client
            this.signalingClient = new SignalingClient(serverUrl);
            await this.signalingClient.connect();

            this.myPlayerId = `${playerName}_${Math.random().toString(36).substring(7)}`;
            this.myColor = selectedColor;
            this.roomId = roomId;

            // Setup signaling callbacks
            this.setupSignalingCallbacks();

            // Join room
            this.signalingClient.joinRoom(this.roomId, this.myPlayerId, this.myColor);

        } catch (err) {
            console.error('Failed to join game:', err);
            this.showStatus('Failed to connect to server', 'error');
        }
    }

    /**
     * Setup signaling client callbacks
     */
    setupSignalingCallbacks() {
        this.signalingClient.onRoomState((message) => {
            this.handleRoomState(message);
        });

        this.signalingClient.onPlayerJoined((message) => {
            this.handlePlayerJoined(message);
        });

        this.signalingClient.onPlayerLeft((message) => {
            this.handlePlayerLeft(message);
        });

        this.signalingClient.onMoveResult((message) => {
            this.handleMoveResult(message);
        });

        this.signalingClient.onChat((message) => {
            this.addChatMessage(message.from, message.text);
        });

        this.signalingClient.onSignal((message) => {
            if (message.to !== this.myPlayerId || !message.from) {
                return;
            }

            this.webrtcClient?.receiveSignal(message.from, message.signal);
        });

        this.signalingClient.onICECandidate((message) => {
            if (message.to !== this.myPlayerId || !message.from) {
                return;
            }

            this.webrtcClient?.receiveSignal(message.from, message.candidate);
        });

        this.signalingClient.onConnectionChange((connected) => {
            console.log('Signaling server connection:', connected);
        });
    }

    /**
     * Handle room state message
     */
    handleRoomState(message) {
        console.log('Room state:', message);

        // Initialize WebRTC client
        this.webrtcClient = new WebRTCClient(this.myPlayerId);
        this.setupWebRTCCallbacks();

        // Update game state from server
        this.gameState.initializeFromServer(message.game_state);
        
        // Add all players
        for (const player of message.players) {
            this.gameState.addPlayer(player.id, player.color);
            if (player.id === this.myPlayerId) {
                this.myColor = player.color;
            }
        }

        // Connect to other players
        for (const player of message.players) {
            if (player.id !== this.myPlayerId) {
                console.log(`Initiating WebRTC connection to ${player.id}`);
                const isInitiator = this.myPlayerId > player.id;
                this.webrtcClient.connectToPeer(player.id, isInitiator);
            }
        }

        // Show game screen
        document.getElementById('setup').style.display = 'none';
        document.getElementById('gameScreen').style.display = 'block';
        document.getElementById('roomDisplay').textContent = `Room: ${this.roomId}`;
        document.getElementById('playerDisplay').textContent = `Player: ${this.myPlayerId}`;

        this.updatePlayersList();
        this.updateStatus(`Room ready with ${message.players.length} players`);
    }

    /**
     * Setup WebRTC callbacks
     */
    setupWebRTCCallbacks() {
        this.webrtcClient.onSignal((peerId, signal) => {
            this.signalingClient?.relaySignal(peerId, signal);
        });

        this.webrtcClient.onGameMessage((message) => {
            if (message.type === 'move') {
                // Server is authoritative. Do not apply the same move a second
                // time here; MoveResult contains the authoritative final state.
                console.log(`Received peer move from ${message.playerId}: (${message.row}, ${message.col})`);
            }
        });

        this.webrtcClient.onChatMessage((message) => {
            this.addChatMessage(message.from, message.text);
        });

        this.webrtcClient.onPeerConnected((peerId) => {
            console.log(`Peer connected: ${peerId}`);
            this.connectedPeers.add(peerId);
            this.checkGameStart();
        });

        this.webrtcClient.onPeerDisconnected((peerId) => {
            console.log(`Peer disconnected: ${peerId}`);
            this.connectedPeers.delete(peerId);
        });
    }

    /**
     * Handle player joined
     */
    handlePlayerJoined(message) {
        console.log(`Player joined: ${message.player_id}`);
        this.gameState.addPlayer(message.player_id, message.color);
        
        // Initiate connection to new player
        const isInitiator = this.myPlayerId > message.player_id;
        this.webrtcClient?.connectToPeer(message.player_id, isInitiator);
        
        this.updatePlayersList();
    }

    /**
     * Handle player left
     */
    handlePlayerLeft(message) {
        console.log(`Player left: ${message.player_id}`);
        this.gameState.players.delete(message.player_id);
        this.connectedPeers.delete(message.player_id);
        this.updatePlayersList();
    }

    /**
     * Handle move result
     */
    handleMoveResult(message) {
        if (!message.success) {
            console.error('Move failed:', message.error);
            this.showStatus(`Move failed: ${message.error}`, 'error');
            return;
        }

        if (message.game_state) {
            this.gameState.initializeFromServer(message.game_state);
            this.renderer.setGameState(this.gameState);
        }

        // Rust sends the exact ordered explosion list. Animate it rather than
        // trying to reconstruct a chain reaction from the final board.
        if (Array.isArray(message.explosions) && message.explosions.length) {
            this.animationManager.playExplosions(message.explosions);
        }

        this.updateUI();

        if (this.gameState.isOver) {
            this.showGameOver();
        }
    }

    /**
     * Check if game should start
     */
    checkGameStart() {
        if (!this.gameStarted && this.gameState.players.size >= 2) {
            const allPlayers = this.gameState.players.size;
            const connectedCount = this.connectedPeers.size + 1; // +1 for self

            if (connectedCount >= allPlayers) {
                console.log('All peers connected! Game starting.');
                this.gameStarted = true;
                this.updateStatus(`Game started! ${this.gameState.currentTurn}'s turn`);
            }
        }
    }

    /**
     * Handle canvas click (make a move)
     */
    handleCanvasClick(e) {
        if (this.gameState.isOver) {
            return;
        }

        const canPlay = this.gameStarted || (this.gameState.players.size > 0 && this.gameState.currentTurn === this.myPlayerId);
        if (!canPlay) {
            return;
        }

        if (this.gameState.currentTurn !== this.myPlayerId) {
            this.showStatus('Not your turn', 'error');
            return;
        }

        const coords = this.renderer.getGridCoordinates(e.clientX, e.clientY);
        if (!coords) return;

        const { row, col } = coords;
        const validation = this.gameState.isValidMove(row, col, this.myPlayerId);

        if (!validation.valid) {
            this.showStatus(`Invalid move: ${validation.reason}`, 'error');
            return;
        }

        // Send one authoritative move. Rust resolves the complete chain
        // reaction and broadcasts the resulting state to every client.
        this.signalingClient?.sendMove(this.myPlayerId, row, col);
    }

    /**
     * Handle canvas hover
     */
    handleCanvasHover(e) {
        const coords = this.renderer.getGridCoordinates(e.clientX, e.clientY);
        this.renderer.setHover(coords);
        if (coords) {
            this.canvas.style.cursor = 'pointer';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }

    /**
     * Update game state
     */
    update() {
        // Update animations
        const animating = this.animationManager.update();
        const effectsActive = this.effectsManager.update();

        // Check if game is over
        if (
            this.gameState.isOver &&
            document.getElementById('gameOverScreen').style.display === 'none'
        ) {
            this.showGameOver();
        }
    }

    /**
     * Draw game state
     */
    draw() {
        // Draw board
        this.renderer.draw();

        // Draw animations
        this.animationManager.draw();

        // Draw effects
        this.effectsManager.draw(this.renderer.ctx);
    }

    /**
     * Update player list UI
     */
    updatePlayersList() {
        const playersList = document.getElementById('playersList');
        playersList.innerHTML = '';

        for (const [id, player] of this.gameState.players.entries()) {
            const div = document.createElement('div');
            div.className = 'player-item';
            if (id === this.myPlayerId) div.classList.add('current');

            const color = document.createElement('div');
            color.className = 'player-color';
            color.style.background = player.color;

            const info = document.createElement('div');
            info.className = 'player-info';

            const name = document.createElement('div');
            name.className = 'player-name';
            name.textContent = id;

            const status = document.createElement('div');
            status.className = 'player-status';
            status.textContent = player.is_alive ? 'Alive' : 'Eliminated';
            if (!player.is_alive) status.style.color = '#999';

            info.appendChild(name);
            info.appendChild(status);

            div.appendChild(color);
            div.appendChild(info);

            playersList.appendChild(div);
        }
    }

    /**
     * Send chat message
     */
    sendChat() {
        const input = document.getElementById('chatInput');
        const text = input.value.trim();

        if (!text) return;

        this.addChatMessage(this.myPlayerId, text);
        this.webrtcClient?.broadcastChat(text);
        this.signalingClient?.sendChat(this.myPlayerId, text);

        input.value = '';
    }

    /**
     * Add chat message to display
     */
    addChatMessage(from, text) {
        const chatBox = document.getElementById('chatBox');
        const msg = document.createElement('div');
        msg.className = 'chat-message';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'name';
        nameSpan.textContent = from + ': ';

        const textSpan = document.createElement('span');
        textSpan.className = 'text';
        textSpan.textContent = text;

        msg.appendChild(nameSpan);
        msg.appendChild(textSpan);
        chatBox.appendChild(msg);

        // Scroll to bottom
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    /**
     * Update UI elements
     */
    updateUI() {
        document.getElementById('moveCount').textContent = this.gameState.moveCount;

        const currentPlayer = this.gameState.getCurrentPlayer();
        if (currentPlayer) {
            const turnText = currentPlayer.id === this.myPlayerId 
                ? 'Your turn!' 
                : `${currentPlayer.id}'s turn`;
            document.getElementById('turnIndicator').textContent = turnText;
            document.getElementById('turnIndicator').style.color = currentPlayer.color;
        }

        this.updatePlayersList();
    }

    /**
     * Show game over screen
     */
    showGameOver() {
        const screen = document.getElementById('gameOverScreen');
        const title = document.getElementById('gameOverTitle');
        const message = document.getElementById('gameOverMessage');

        if (this.gameState.winner === this.myPlayerId) {
            title.textContent = '🎉 You Won!';
            message.textContent = 'Congratulations!';
        } else if (this.gameState.winner) {
            const winner = this.gameState.players.get(this.gameState.winner);
            title.textContent = '😢 Game Over';
            message.textContent = `${this.gameState.winner} won the game!`;
        } else {
            title.textContent = '😢 Game Over';
            message.textContent = 'The game ended.';
        }

        screen.style.display = 'flex';
    }

    /**
     * Leave game
     */
    leaveGame() {
        document.getElementById('setup').style.display = 'flex';
        document.getElementById('gameScreen').style.display = 'none';
        document.getElementById('gameOverScreen').style.display = 'none';

        this.webrtcClient?.disconnectAll();
        this.signalingClient?.disconnect();

        this.gameStarted = false;
        this.connectedPeers.clear();
        this.gameState = new GameState(6, 6);

        document.getElementById('chatBox').innerHTML = '';
        document.getElementById('chatInput').value = '';
    }

    /**
     * Update status message
     */
    updateStatus(message, type = 'info') {
        this.showStatus(message, type);
    }

    /**
     * Show status message
     */
    showStatus(message, type = 'info') {
        const statusEl = document.getElementById('status');
        statusEl.textContent = message;
        statusEl.className = 'status ' + type;
    }

    /**
     * Generate random room ID
     */
    generateRoomId() {
        return 'room-' + Math.random().toString(36).substring(2, 9);
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    window.game = new ChainReactionGame();
    console.log('Chain Reaction game initialized');
});
