/**
 * WebRTC peer-to-peer connections using SimplePeer
 */

class WebRTCClient {
    constructor(myPlayerId) {
        this.myPlayerId = myPlayerId;
        this.peers = new Map(); // peerId -> SimplePeer
        this.callbacks = {
            onGameMessage: null,
            onChatMessage: null,
            onPeerConnected: null,
            onPeerDisconnected: null,
            onSignal: null,
        };
    }

    /**
     * Set callback for when a game message is received
     */
    onGameMessage(callback) {
        this.callbacks.onGameMessage = callback;
    }

    /**
     * Set callback for chat messages
     */
    onChatMessage(callback) {
        this.callbacks.onChatMessage = callback;
    }

    /**
     * Set callback for peer connection
     */
    onPeerConnected(callback) {
        this.callbacks.onPeerConnected = callback;
    }

    /**
     * Set callback for peer disconnection
     */
    onPeerDisconnected(callback) {
        this.callbacks.onPeerDisconnected = callback;
    }

    /**
     * Set callback for signaling messages that must go through the server
     */
    onSignal(callback) {
        this.callbacks.onSignal = callback;
    }

    /**
     * Initiate connection to a peer
     */
    connectToPeer(peerId, isInitiator = true) {
        if (this.peers.has(peerId)) {
            console.log(`Already connected to peer ${peerId}`);
            return;
        }

        console.log(`Connecting to peer ${peerId} (initiator: ${isInitiator})`);

        const peer = new SimplePeer({
            initiator: isInitiator,
            trickle: true,
            config: {
                iceServers: [
                    { urls: ['stun:stun.l.google.com:19302'] },
                    { urls: ['stun:stun1.l.google.com:19302'] },
                    { urls: ['stun:stun2.l.google.com:19302'] },
                    { urls: ['stun:stun3.l.google.com:19302'] },
                    { urls: ['stun:stun4.l.google.com:19302'] }
                ]
            }
        });

        peer.on('signal', (signal) => {
            console.log(`Signal from peer ${peerId}:`, signal.type);
            this.handleSignal(peerId, signal);
        });

        peer.on('connect', () => {
            console.log(`Connected to peer ${peerId}`);
            if (this.callbacks.onPeerConnected) {
                this.callbacks.onPeerConnected(peerId);
            }
        });

        peer.on('data', (data) => {
            this.handlePeerData(peerId, data);
        });

        peer.on('error', (err) => {
            console.error(`Error with peer ${peerId}:`, err);
        });

        peer.on('close', () => {
            console.log(`Disconnected from peer ${peerId}`);
            this.peers.delete(peerId);
            if (this.callbacks.onPeerDisconnected) {
                this.callbacks.onPeerDisconnected(peerId);
            }
        });

        this.peers.set(peerId, peer);
        return peer;
    }

    /**
     * Handle incoming signal from signaling server
     */
    handleSignal(fromPeerId, signal) {
        if (this.callbacks.onSignal) {
            this.callbacks.onSignal(fromPeerId, signal);
        }
    }

    /**
     * Receive signal from peer (via signaling server)
     */
    receiveSignal(fromPeerId, signal) {
        let peer = this.peers.get(fromPeerId);

        if (!peer) {
            // Peer initiated connection to us
            console.log(`Receiving signal from initiator ${fromPeerId}`);
            peer = this.connectToPeer(fromPeerId, false);
        }

        try {
            peer.signal(signal);
        } catch (err) {
            console.error(`Error signaling peer ${fromPeerId}:`, err);
        }
    }

    /**
     * Handle data received from peer
     */
    handlePeerData(fromPeerId, data) {
        try {
            const message = JSON.parse(data.toString());

            if (message.type === 'move') {
                if (this.callbacks.onGameMessage) {
                    this.callbacks.onGameMessage({
                        type: 'move',
                        from: fromPeerId,
                        playerId: message.playerId,
                        row: message.row,
                        col: message.col,
                        timestamp: message.timestamp
                    });
                }
            } else if (message.type === 'chat') {
                if (this.callbacks.onChatMessage) {
                    this.callbacks.onChatMessage({
                        from: message.from,
                        text: message.text
                    });
                }
            } else if (message.type === 'sync') {
                if (this.callbacks.onGameMessage) {
                    this.callbacks.onGameMessage(message);
                }
            }
        } catch (err) {
            console.error(`Error handling peer data:`, err);
        }
    }

    /**
     * Broadcast a game move to all connected peers
     */
    broadcastMove(row, col) {
        const message = JSON.stringify({
            type: 'move',
            playerId: this.myPlayerId,
            row,
            col,
            timestamp: Date.now()
        });

        this.peers.forEach((peer, peerId) => {
            if (peer.connected) {
                try {
                    peer.send(message);
                } catch (err) {
                    console.error(`Error sending to peer ${peerId}:`, err);
                }
            } else {
                console.warn(`Peer ${peerId} not connected`);
            }
        });
    }

    /**
     * Send chat message to all peers
     */
    broadcastChat(text) {
        const message = JSON.stringify({
            type: 'chat',
            from: this.myPlayerId,
            text
        });

        this.peers.forEach((peer, peerId) => {
            if (peer.connected) {
                try {
                    peer.send(message);
                } catch (err) {
                    console.error(`Error sending chat to peer ${peerId}:`, err);
                }
            }
        });
    }

    /**
     * Send game state sync
     */
    syncGameState(gameState) {
        const message = JSON.stringify({
            type: 'sync',
            board: gameState.board,
            currentTurn: gameState.currentTurn,
            moveCount: gameState.moveCount,
            eliminated: gameState.eliminated,
            players: Array.from(gameState.players.entries())
        });

        this.peers.forEach((peer, peerId) => {
            if (peer.connected) {
                try {
                    peer.send(message);
                } catch (err) {
                    console.error(`Error syncing with peer ${peerId}:`, err);
                }
            }
        });
    }

    /**
     * Get list of connected peers
     */
    getConnectedPeers() {
        return Array.from(this.peers.entries())
            .filter(([_, peer]) => peer.connected)
            .map(([id, _]) => id);
    }

    /**
     * Check if all peers are connected
     */
    areAllPeersConnected(expectedPeerCount) {
        return this.getConnectedPeers().length === expectedPeerCount;
    }

    /**
     * Disconnect all peers
     */
    disconnectAll() {
        this.peers.forEach((peer, peerId) => {
            try {
                peer.destroy();
            } catch (err) {
                console.error(`Error destroying peer ${peerId}:`, err);
            }
        });
        this.peers.clear();
    }
}
