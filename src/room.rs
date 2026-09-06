use crate::game_state::{Explosion, GameState};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;

/// Message types for WebSocket communication
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Message {
    #[serde(rename = "join-room")]
    JoinRoom {
        room_id: String,
        player_id: String,
        color: String,
    },
    #[serde(rename = "room-state")]
    RoomState {
        player_id: String,
        players: Vec<PlayerInfo>,
        game_state: serde_json::Value,
    },
    #[serde(rename = "player-joined")]
    PlayerJoined {
        player_id: String,
        color: String,
    },
    #[serde(rename = "player-left")]
    PlayerLeft {
        player_id: String,
    },
    #[serde(rename = "move")]
    Move {
        player_id: String,
        row: usize,
        col: usize,
    },
    #[serde(rename = "move-result")]
    MoveResult {
        player_id: String,
        success: bool,
        error: Option<String>,
        game_state: Option<serde_json::Value>,
        #[serde(default)]
        explosions: Vec<Explosion>,
    },
    #[serde(rename = "chat")]
    Chat {
        from: String,
        text: String,
    },
    #[serde(rename = "signal")]
    Signal {
        #[serde(default)]
        from: Option<String>,
        to: String,
        signal: serde_json::Value,
    },
    #[serde(rename = "ice-candidate")]
    IceCandidate {
        #[serde(default)]
        from: Option<String>,
        to: String,
        candidate: serde_json::Value,
    },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "pong")]
    Pong,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlayerInfo {
    pub id: String,
    pub color: String,
}

/// A single game room with players and game state
pub struct Room {
    pub id: String,
    pub game: Arc<tokio::sync::Mutex<GameState>>,
    pub players: Arc<DashMap<String, PlayerInfo>>,
    pub tx: broadcast::Sender<Message>,
    pub max_players: usize,
}

impl Room {
    const DEFAULT_COLORS: [&'static str; 5] = [
        "#FF6B6B",
        "#4ECDC4",
        "#FFE66D",
        "#95E1D3",
        "#C7CEEA",
    ];

    /// Create a new room
    pub fn new(id: String, max_players: usize) -> Self {
        let (tx, _) = broadcast::channel(100);
        
        Room {
            id,
            game: Arc::new(tokio::sync::Mutex::new(
                GameState::new(vec![], 6, 6)
            )),
            players: Arc::new(DashMap::new()),
            tx,
            max_players,
        }
    }

    /// Choose a color that is not already used in the room.
    pub fn resolve_color(&self, preferred_color: &str) -> Result<String, String> {
        let used_colors: std::collections::HashSet<String> = self
            .players
            .iter()
            .map(|ref_multi| ref_multi.value().color.clone())
            .collect();

        if !used_colors.contains(preferred_color) {
            return Ok(preferred_color.to_string());
        }

        for color in Self::DEFAULT_COLORS {
            if !used_colors.contains(color) {
                return Ok(color.to_string());
            }
        }

        Err("No available colors left in this room".to_string())
    }

    /// Add a player to the room
    pub async fn add_player(&self, player_id: String, color: String) -> Result<String, String> {
        if self.players.len() >= self.max_players {
            return Err("Room is full".to_string());
        }

        let assigned_color = self.resolve_color(&color)?;

        let player_info = PlayerInfo {
            id: player_id.clone(),
            color: assigned_color.clone(),
        };

        self.players.insert(player_id.clone(), player_info);

        // Update game state if this is the first player
        if self.players.len() == 1 {
            let mut game = self.game.lock().await;
            *game = GameState::new(
                self.players
                    .iter()
                    .map(|ref_multi| (ref_multi.key().clone(), ref_multi.value().color.clone()))
                    .collect(),
                6,
                6,
            );
        } else {
            // Reinitialize game with updated players
            let mut game = self.game.lock().await;
            *game = GameState::new(
                self.players
                    .iter()
                    .map(|ref_multi| (ref_multi.key().clone(), ref_multi.value().color.clone()))
                    .collect(),
                6,
                6,
            );
        }

        // Broadcast player joined
        let msg = Message::PlayerJoined {
            player_id: player_id.clone(),
            color: assigned_color.clone(),
        };
        let _ = self.tx.send(msg);

        Ok(assigned_color)
    }

    /// Remove a player from the room
    pub async fn remove_player(&self, player_id: &str) {
        self.players.remove(player_id);

        let msg = Message::PlayerLeft {
            player_id: player_id.to_string(),
        };
        let _ = self.tx.send(msg);
    }

    /// Apply a player's move
    pub async fn apply_move(
        &self,
        player_id: String,
        row: usize,
        col: usize,
    ) -> Result<(), String> {
        let mut game = self.game.lock().await;
        let explosions = game.apply_move(player_id.clone(), row, col)?;

        let msg = Message::MoveResult {
            player_id,
            success: true,
            error: None,
            game_state: Some(game.to_json()),
            explosions,
        };
        let _ = self.tx.send(msg);

        Ok(())
    }

    /// Get room state
    pub async fn get_state(&self) -> serde_json::Value {
        let game = self.game.lock().await;
        game.to_json()
    }

    /// Get list of players in room
    pub fn get_players(&self) -> Vec<PlayerInfo> {
        self.players
            .iter()
            .map(|ref_multi| ref_multi.value().clone())
            .collect()
    }

    /// Check if room is full
    pub fn is_full(&self) -> bool {
        self.players.len() >= self.max_players
    }

    /// Check if room is empty
    pub fn is_empty(&self) -> bool {
        self.players.is_empty()
    }
}

/// Global room manager
pub struct RoomManager {
    pub rooms: Arc<DashMap<String, Arc<Room>>>,
}

impl RoomManager {
    pub fn new() -> Self {
        RoomManager {
            rooms: Arc::new(DashMap::new()),
        }
    }

    /// Get or create a room
    pub fn get_or_create_room(&self, room_id: String) -> Arc<Room> {
        self.rooms
            .entry(room_id.clone())
            .or_insert_with(|| Arc::new(Room::new(room_id, 5)))
            .clone()
    }

    /// Get a room if it exists
    pub fn get_room(&self, room_id: &str) -> Option<Arc<Room>> {
        self.rooms.get(room_id).map(|r| r.clone())
    }

    /// Delete a room
    pub fn delete_room(&self, room_id: &str) {
        self.rooms.remove(room_id);
    }

    /// Clean up empty rooms (call periodically)
    pub async fn cleanup_empty_rooms(&self) {
        let mut to_delete = vec![];
        for ref_multi in self.rooms.iter() {
            if ref_multi.is_empty() {
                to_delete.push(ref_multi.key().clone());
            }
        }
        for room_id in to_delete {
            self.delete_room(&room_id);
        }
    }
}

impl Default for RoomManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn assigns_a_free_color_when_selected_color_is_taken() {
        let room = Room::new("test-room".to_string(), 5);

        room.add_player("p1".to_string(), "#FF6B6B".to_string()).await.unwrap();

        let result = room.add_player("p2".to_string(), "#FF6B6B".to_string()).await;

        assert!(result.is_ok(), "player should still join with a free color");
        assert_eq!(room.get_players().len(), 2);
        assert_ne!(result.unwrap(), "#FF6B6B");
    }
}
