/**
 * WebSocket signaling client for WebRTC setup
 * Communicates with Rust backend server
 */

class SignalingClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.connected = false;
        this.callbacks = {
            onRoomState: null,
            onPlayerJoined: null,
            onPlayerLeft: null,
            onMoveResult: null,
            onChat: null,
            onConnectionChange: null,
            onSignal: null,
            onICECandidate: null,
        };
    }

    /**
     * Connect to signaling server
     */
    connect() {
        return new Promise((resolve, reject) => {
            try {
                const websocketUrl = this.getWebSocketUrl();
                console.log(`Connecting to signaling server: ${websocketUrl}`);
                this.ws = new WebSocket(websocketUrl);

                this.ws.onopen = () => {
                    console.log('Connected to signaling server');
                    this.connected = true;
                    if (this.callbacks.onConnectionChange) {
                        this.callbacks.onConnectionChange(true);
                    }
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    this.handleMessage(event.data);
                };

                this.ws.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    reject(error);
                };

                this.ws.onclose = () => {
                    console.log('Disconnected from signaling server');
                    this.connected = false;
                    if (this.callbacks.onConnectionChange) {
                        this.callbacks.onConnectionChange(false);
                    }
                };
            } catch (err) {
                console.error('Connection error:', err);
                reject(err);
            }
        });
    }

    /**
     * Normalize a server origin into the WebSocket endpoint exposed by Rust
     */
    getWebSocketUrl() {
        let parsedUrl;
        try {
            parsedUrl = new URL(this.serverUrl, window.location.href);
        } catch (e) {
            const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            parsedUrl = new URL(`${proto}//${window.location.host}/ws`);
        }

        if (parsedUrl.protocol === 'http:') {
            parsedUrl.protocol = 'ws:';
        } else if (parsedUrl.protocol === 'https:') {
            parsedUrl.protocol = 'wss:';
        }

        if (!parsedUrl.pathname || parsedUrl.pathname === '/') {
            parsedUrl.pathname = '/ws';
        }

        return parsedUrl.toString();
    }

    /**
     * Join a game room
     */
    joinRoom(roomId, playerId, color) {
        const message = {
            type: 'join-room',
            room_id: roomId,
            player_id: playerId,
            color: color
        };

        this.send(message);
    }

    /**
     * Send a move to the room
     */
    sendMove(playerId, row, col) {
        const message = {
            type: 'move',
            player_id: playerId,
            row: row,
            col: col
        };

        this.send(message);
    }

    /**
     * Send chat message
     */
    sendChat(from, text) {
        const message = {
            type: 'chat',
            from: from,
            text: text
        };

        this.send(message);
    }

    /**
     * Relay ICE candidate to peer
     */
    relayICECandidate(toPlayerId, candidate) {
        const message = {
            type: 'ice-candidate',
            to: toPlayerId,
            candidate: candidate
        };

        this.send(message);
    }

    /**
     * Relay WebRTC signal to peer
     */
    relaySignal(toPlayerId, signal) {
        const message = {
            type: 'signal',
            to: toPlayerId,
            signal: signal
        };

        this.send(message);
    }

    /**
     * Send message to server
     */
    send(message) {
        if (!this.connected || !this.ws) {
            console.error('Not connected to signaling server');
            return;
        }

        try {
            this.ws.send(JSON.stringify(message));
        } catch (err) {
            console.error('Error sending message:', err);
        }
    }

    /**
     * Handle incoming message
     */
    handleMessage(data) {
        try {
            const message = JSON.parse(data);

            switch (message.type) {
                case 'room-state':
                    console.log('Received room state:', message);
                    if (this.callbacks.onRoomState) {
                        this.callbacks.onRoomState(message);
                    }
                    break;

                case 'player-joined':
                    console.log(`Player ${message.player_id} joined`);
                    if (this.callbacks.onPlayerJoined) {
                        this.callbacks.onPlayerJoined(message);
                    }
                    break;

                case 'player-left':
                    console.log(`Player ${message.player_id} left`);
                    if (this.callbacks.onPlayerLeft) {
                        this.callbacks.onPlayerLeft(message);
                    }
                    break;

                case 'move-result':
                    console.log('Move result:', message);
                    if (this.callbacks.onMoveResult) {
                        this.callbacks.onMoveResult(message);
                    }
                    break;

                case 'chat':
                    console.log(`Chat from ${message.from}:`, message.text);
                    if (this.callbacks.onChat) {
                        this.callbacks.onChat(message);
                    }
                    break;

                case 'signal':
                    // WebRTC signal from peer (via relay)
                    console.log('Received WebRTC signal from peer');
                    // Forward to game.js to handle
                    if (this.callbacks.onSignal) {
                        this.callbacks.onSignal(message);
                    }
                    break;

                case 'ice-candidate':
                    // ICE candidate from peer
                    console.log('Received ICE candidate');
                    if (this.callbacks.onICECandidate) {
                        this.callbacks.onICECandidate(message);
                    }
                    break;

                default:
                    console.warn('Unknown message type:', message.type);
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    }

    /**
     * Set callback for room state
     */
    onRoomState(callback) {
        this.callbacks.onRoomState = callback;
    }

    /**
     * Set callback for player joined
     */
    onPlayerJoined(callback) {
        this.callbacks.onPlayerJoined = callback;
    }

    /**
     * Set callback for player left
     */
    onPlayerLeft(callback) {
        this.callbacks.onPlayerLeft = callback;
    }

    /**
     * Set callback for move result
     */
    onMoveResult(callback) {
        this.callbacks.onMoveResult = callback;
    }

    /**
     * Set callback for chat
     */
    onChat(callback) {
        this.callbacks.onChat = callback;
    }

    /**
     * Set callback for connection changes
     */
    onConnectionChange(callback) {
        this.callbacks.onConnectionChange = callback;
    }

    /**
     * Set callback for WebRTC signals
     */
    onSignal(callback) {
        this.callbacks.onSignal = callback;
    }

    /**
     * Set callback for ICE candidates
     */
    onICECandidate(callback) {
        this.callbacks.onICECandidate = callback;
    }

    /**
     * Disconnect from server
     */
    disconnect() {
        if (this.ws) {
            this.ws.close();
        }
    }

    /**
     * Check if connected
     */
    isConnected() {
        return this.connected && this.ws && this.ws.readyState === WebSocket.OPEN;
    }
}
