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
        // Auto-detect server URL and query params
        const serverInput = document.getElementById('serverUrl');
        if (serverInput && window.location.host) {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            serverInput.value = `${proto}//${window.location.host}`;
        }

        const urlParams = new URLSearchParams(window.location.search);
        const roomParam = urlParams.get('room');
        if (roomParam) {
            const roomInput = document.getElementById('roomId');
            if (roomInput) roomInput.value = roomParam;
        }

        // Setup screen
        document.getElementById('joinBtn').addEventListener('click', () => this.joinGame());
        document.getElementById('leaveBtn').addEventListener('click', () => this.leaveGame());
        document.getElementById('sendBtn').addEventListener('click', () => this.sendChat());
        document.getElementById('playAgainBtn').addEventListener('click', () => this.leaveGame());

        // Copy room invite link
        document.getElementById('copyLinkBtn')?.addEventListener('click', () => {
            const shareUrl = `${window.location.origin}${window.location.pathname}?room=${this.roomId}`;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(shareUrl).then(() => {
                    this.showStatus('Room invite link copied to clipboard!', 'success');
                }).catch(() => {
                    prompt('Copy this room URL to share with friends:', shareUrl);
                });
            } else {
                prompt('Copy this room URL to share with friends:', shareUrl);
            }
        });

        // Sound toggle button
        const soundBtn = document.getElementById('soundToggleBtn');
        if (soundBtn) {
            const updateSoundIcon = () => {
                const muted = window.soundManager?.isMuted;
                soundBtn.textContent = muted ? '🔇 Sound Off' : '🔊 Sound On';
                soundBtn.classList.toggle('muted', !!muted);
            };
            updateSoundIcon();
            soundBtn.addEventListener('click', () => {
                window.soundManager?.toggleMute();
                updateSoundIcon();
            });
        }
        
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
        const defaultWs = window.location.host 
            ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`
            : 'ws://localhost:3000';
        const serverUrl = document.getElementById('serverUrl').value.trim() || defaultWs;
        const roomId = document.getElementById('roomId').value.trim() || this.generateRoomId();
        const playerName = document.getElementById('playerName').value.trim() || `Player_${Math.random().toString(36).substring(7)}`;
        const selectedColor = this.getAvailableColor();

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

        // Initialize WebRTC client only once per session
        if (!this.webrtcClient) {
            this.webrtcClient = new WebRTCClient(this.myPlayerId);
            this.setupWebRTCCallbacks();
        }

        // Update game state from server
        if (message.game_state) {
            this.gameState.initializeFromServer(message.game_state);
            this.renderer.setGameState(this.gameState);
        }
        
        // Add all players
        for (const player of message.players) {
            this.gameState.addPlayer(player.id, player.color);
            if (player.id === this.myPlayerId) {
                this.myColor = player.color;
            }
        }

        // Connect to new peers that haven't connected yet
        for (const player of message.players) {
            if (player.id !== this.myPlayerId && !this.webrtcClient.peers.has(player.id)) {
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

        this.checkGameStart();
        this.updateUI();
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
                // Server is authoritative.
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
        if (this.webrtcClient && !this.webrtcClient.peers.has(message.player_id)) {
            const isInitiator = this.myPlayerId > message.player_id;
            this.webrtcClient.connectToPeer(message.player_id, isInitiator);
        }
        
        this.checkGameStart();
        this.updateUI();
    }

    /**
     * Handle player left
     */
    handlePlayerLeft(message) {
        console.log(`Player left: ${message.player_id}`);
        this.gameState.players.delete(message.player_id);
        this.connectedPeers.delete(message.player_id);
        this.checkGameStart();
        this.updateUI();
    }

    /**
     * Handle move result
     */
    handleMoveResult(message) {
        if (!message.success) {
            console.error('Move failed:', message.error);
            this.showStatus(`Move failed: ${message.error}`, 'error');
            window.soundManager?.playInvalidMove();
            return;
        }

        if (message.game_state) {
            this.gameState.initializeFromServer(message.game_state);
            this.renderer.setGameState(this.gameState);
        }

        // Rust sends the exact ordered explosion list. Animate it and trigger laser audio.
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
        if (this.gameState.players.size >= 2) {
            this.gameStarted = true;
            this.updateUI();
        } else {
            this.gameStarted = false;
            this.updateStatus('Waiting for more players to join (need 2+)...');
        }
    }

    /**
     * Handle canvas click (make a move)
     */
    handleCanvasClick(e) {
        if (this.gameState.isOver) {
            return;
        }

        // Game requires at least 2 players to play
        if (this.gameState.players.size < 2) {
            this.showStatus('Waiting for opponents to join (need 2+ players)...', 'info');
            return;
        }

        // Block input while chain reaction animation is playing
        if (this.animationManager.isAnimating()) {
            return;
        }

        if (this.gameState.currentTurn !== this.myPlayerId) {
            this.showStatus('Not your turn', 'error');
            window.soundManager?.playInvalidMove();
            return;
        }

        const coords = this.renderer.getGridCoordinates(e.clientX, e.clientY);
        if (!coords) return;

        const { row, col } = coords;
        const validation = this.gameState.isValidMove(row, col, this.myPlayerId);

        if (!validation.valid) {
            this.showStatus(`Invalid move: ${validation.reason}`, 'error');
            window.soundManager?.playInvalidMove();
            return;
        }

        // Play placement blip sound
        window.soundManager?.playPlaceParticle();

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
            const cell = this.gameState.getCell(coords.row, coords.col);
            const isOpponent = cell && cell.owner && cell.owner !== this.myPlayerId;
            const isMyTurn = this.gameState.currentTurn === this.myPlayerId && this.gameState.players.size >= 2;

            if (isOpponent) {
                this.canvas.style.cursor = 'not-allowed';
            } else if (isMyTurn && !this.animationManager.isAnimating()) {
                this.canvas.style.cursor = 'pointer';
            } else {
                this.canvas.style.cursor = 'default';
            }
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
        const moveCountEl = document.getElementById('moveCount');
        if (moveCountEl) moveCountEl.textContent = this.gameState.moveCount;

        const indicator = document.getElementById('turnIndicator');
        if (indicator) {
            if (this.gameState.players.size < 2) {
                indicator.textContent = '⏳ Waiting for more players to join (need 2+)...';
                indicator.style.color = '#FFE66D';
            } else {
                const currentPlayer = this.gameState.getCurrentPlayer();
                if (currentPlayer) {
                    const isMyTurn = currentPlayer.id === this.myPlayerId;
                    indicator.textContent = isMyTurn 
                        ? '⭐ Your turn! Click an empty or your cell.' 
                        : `${currentPlayer.id}'s turn`;
                    indicator.style.color = currentPlayer.color;
                }
            }
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
            message.textContent = 'Congratulations! You claimed the entire reactor grid!';
            window.soundManager?.playVictory();
        } else if (this.gameState.winner) {
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
