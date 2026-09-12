use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single cell on the game board
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Cell {
    /// Player ID that owns this cell (None = unclaimed)
    pub owner: Option<String>,
    /// Number of particles in this cell (0-4)
    pub particle_count: u8,
}

impl Cell {
    pub fn new() -> Self {
        Cell {
            owner: None,
            particle_count: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.particle_count == 0 && self.owner.is_none()
    }
}

impl Default for Cell {
    fn default() -> Self {
        Self::new()
    }
}

/// Represents an explosion event for animations
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Explosion {
    pub row: usize,
    pub col: usize,
    pub particles_sent: u8,
    pub owner: Option<String>,
}

/// Represents the complete game state
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GameState {
    /// The game board grid (6x6 by default)
    pub board: Vec<Vec<Cell>>,
    /// Player information
    pub players: HashMap<String, Player>,
    /// Current player's turn
    pub current_turn: Option<String>,
    /// Deterministic turn order of player IDs
    pub turn_order: Vec<String>,
    /// Players that have been eliminated
    pub eliminated: Vec<String>,
    /// Total moves made
    pub move_count: u32,
    /// Game over flag
    pub is_over: bool,
    /// Winner ID (if game is over)
    pub winner: Option<String>,
    /// Dimensions
    pub width: usize,
    pub height: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Player {
    pub id: String,
    pub color: String,
    pub is_alive: bool,
    pub has_played: bool,
}

impl GameState {
    /// Create a new game with specified players in deterministic turn order
    pub fn new(players: Vec<(String, String)>, width: usize, height: usize) -> Self {
        let board = vec![vec![Cell::new(); width]; height];
        let mut player_map = HashMap::new();
        let mut turn_order = Vec::new();

        // Assign players and colors in the order provided
        for (id, color) in players {
            turn_order.push(id.clone());
            player_map.insert(id.clone(), Player {
                id: id.clone(),
                color: color.clone(),
                is_alive: true,
                has_played: false,
            });
        }

        let first_player = turn_order.first().cloned();

        GameState {
            board,
            players: player_map,
            current_turn: first_player,
            turn_order,
            eliminated: vec![],
            move_count: 0,
            is_over: false,
            winner: None,
            width,
            height,
        }
    }

    /// Get the critical mass threshold for a cell at (row, col)
    fn get_critical_mass(&self, row: usize, col: usize) -> u8 {
        let mut adjacent_count = 0;

        // Count adjacent cells
        if row > 0 { adjacent_count += 1; }                    // top
        if row < self.height - 1 { adjacent_count += 1; }      // bottom
        if col > 0 { adjacent_count += 1; }                    // left
        if col < self.width - 1 { adjacent_count += 1; }       // right

        adjacent_count
    }

    /// Apply a player's move and return the exact ordered explosion events.
    pub fn apply_move(
        &mut self,
        player_id: String,
        row: usize,
        col: usize,
    ) -> Result<Vec<Explosion>, String> {
        if self.is_over {
            return Err("Game is over".to_string());
        }

        if self.current_turn != Some(player_id.clone()) {
            return Err("Not your turn".to_string());
        }

        if row >= self.height || col >= self.width {
            return Err("Move out of bounds".to_string());
        }

        let player = self.players.get_mut(&player_id)
            .ok_or("Player not found")?;

        if !player.is_alive {
            return Err("Player is eliminated".to_string());
        }

        player.has_played = true;

        let cell = &mut self.board[row][col];
        // Enforce rule: Cannot place particle on an opponent's cell!
        // Capturing opponent cells is only possible through chain reaction explosions.
        if let Some(ref owner) = cell.owner {
            if owner != &player_id {
                return Err("Cannot place particle on an opponent's cell".to_string());
            }
        }

        if cell.owner.is_none() {
            cell.owner = Some(player_id.clone());
            cell.particle_count = 1;
        } else {
            cell.particle_count += 1;
        }

        self.move_count += 1;

        let mut explosions = Vec::new();
        let mut cells_to_check = vec![(row, col)];

        while let Some((r, c)) = cells_to_check.pop() {
            let critical_mass = self.get_critical_mass(r, c);

            if self.board[r][c].particle_count < critical_mass {
                continue;
            }

            let owner = self.board[r][c].owner.clone();
            let particles = self.board[r][c].particle_count;

            explosions.push(Explosion {
                row: r,
                col: c,
                particles_sent: particles,
                owner: owner.clone(),
            });

            // The exploding cell disappears.
            self.board[r][c].particle_count = 0;
            self.board[r][c].owner = None;

            let directions = [
                (r as i32 - 1, c as i32),
                (r as i32 + 1, c as i32),
                (r as i32, c as i32 - 1),
                (r as i32, c as i32 + 1),
            ];

            for (nr, nc) in directions {
                if nr < 0
                    || nr >= self.height as i32
                    || nc < 0
                    || nc >= self.width as i32
                {
                    continue;
                }

                if let Some(ref owner) = owner {
                    let nr = nr as usize;
                    let nc = nc as usize;
                    let target = &mut self.board[nr][nc];

                    // This is the important takeover rule: the colour of the
                    // exploding cell owns the neighbour immediately.
                    target.owner = Some(owner.clone());
                    target.particle_count += 1;
                    cells_to_check.push((nr, nc));
                }
            }
        }

        self.advance_turn();
        self.check_win_condition();

        Ok(explosions)
    }

    /// Advance to next player's turn using deterministic turn order
    pub fn advance_turn(&mut self) {
        if let Some(current) = self.current_turn.clone() {
            if self.turn_order.is_empty() {
                self.current_turn = None;
                return;
            }

            let current_index = self
                .turn_order
                .iter()
                .position(|id| id == &current)
                .unwrap_or(0);
            let mut next_index = (current_index + 1) % self.turn_order.len();

            // Skip eliminated players
            let mut attempts = 0;
            while attempts < self.turn_order.len() {
                let candidate_id = &self.turn_order[next_index];
                if let Some(candidate) = self.players.get(candidate_id) {
                    if candidate.is_alive {
                        self.current_turn = Some(candidate_id.clone());
                        return;
                    }
                }
                next_index = (next_index + 1) % self.turn_order.len();
                attempts += 1;
            }

            self.current_turn = None;
        }
    }

    /// Handle player leaving or disconnecting cleanly
    pub fn remove_player_from_game(&mut self, player_id: &str) {
        if let Some(player) = self.players.get_mut(player_id) {
            player.is_alive = false;
        }
        if !self.eliminated.contains(&player_id.to_string()) {
            self.eliminated.push(player_id.to_string());
        }

        // If it was this player's turn, advance immediately
        if self.current_turn.as_deref() == Some(player_id) {
            self.advance_turn();
        }

        self.check_win_condition();
    }

    /// Check which players are eliminated.
    fn check_elimination(&mut self) {
        for (player_id, player) in self.players.iter_mut() {
            // A player cannot be eliminated before their first move.
            if !player.is_alive || !player.has_played {
                continue;
            }

            let has_particles = self.board.iter().any(|row| {
                row.iter().any(|cell| cell.owner.as_ref() == Some(player_id))
            });

            if !has_particles {
                player.is_alive = false;
                if !self.eliminated.contains(player_id) {
                    self.eliminated.push(player_id.clone());
                }
            }
        }
    }

    /// Check win condition.
    fn check_win_condition(&mut self) {
        self.check_elimination();

        // Everyone gets one chance to enter the game before elimination can
        // decide the winner.
        if !self.players.values().all(|p| p.has_played) {
            return;
        }

        let alive_players: Vec<_> = self.players
            .iter()
            .filter(|(_, p)| p.is_alive)
            .map(|(id, _)| id.clone())
            .collect();

        if alive_players.len() == 1 {
            self.is_over = true;
            self.winner = alive_players.first().cloned();
            self.current_turn = None;
        } else if alive_players.is_empty() {
            self.is_over = true;
        }
    }

    /// Get game state as JSON for clients
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "board": self.board,
            "players": self.players,
            "current_turn": self.current_turn,
            "turn_order": self.turn_order,
            "eliminated": self.eliminated,
            "move_count": self.move_count,
            "is_over": self.is_over,
            "winner": self.winner,
            "width": self.width,
            "height": self.height,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn player_cannot_place_on_opponent_cell() {
        let players = vec![
            ("p1".to_string(), "#FF6B6B".to_string()),
            ("p2".to_string(), "#4ECDC4".to_string()),
        ];
        let mut game = GameState::new(players, 6, 6);

        // p1 moves to (0, 0)
        assert!(game.apply_move("p1".to_string(), 0, 0).is_ok());

        // Now it's p2's turn. p2 attempts to place particle directly on p1's cell (0, 0)
        let result = game.apply_move("p2".to_string(), 0, 0);
        assert!(result.is_err(), "p2 must not be allowed to place on p1's cell");
        assert_eq!(result.unwrap_err(), "Cannot place particle on an opponent's cell");

        // p2 places on an empty cell (0, 1) instead -> succeeds!
        assert!(game.apply_move("p2".to_string(), 0, 1).is_ok());
    }

    #[test]
    fn capturing_occurs_via_chain_reaction_explosion() {
        let players = vec![
            ("p1".to_string(), "#FF6B6B".to_string()),
            ("p2".to_string(), "#4ECDC4".to_string()),
        ];
        let mut game = GameState::new(players, 6, 6);

        // Turn 1: p1 places on corner (0, 0) -> 1 particle
        assert!(game.apply_move("p1".to_string(), 0, 0).is_ok());

        // Turn 2: p2 places on adjacent cell (0, 1) -> 1 particle owned by p2
        assert!(game.apply_move("p2".to_string(), 0, 1).is_ok());
        assert_eq!(game.board[0][1].owner.as_deref(), Some("p2"));

        // Turn 3: p1 places on corner (0, 0) again (critical mass for corner is 2) -> explodes!
        let exp = game.apply_move("p1".to_string(), 0, 0).unwrap();
        assert!(!exp.is_empty(), "Explosion should occur at corner");

        // Corner cell exploded and emptied
        assert_eq!(game.board[0][0].particle_count, 0);

        // Adjacent cell (0, 1) was captured by p1 via explosion!
        assert_eq!(game.board[0][1].owner.as_deref(), Some("p1"));
        assert_eq!(game.board[0][1].particle_count, 2);
    }

    #[test]
    fn deterministic_turn_order_and_disconnect() {
        let players = vec![
            ("p1".to_string(), "#FF6B6B".to_string()),
            ("p2".to_string(), "#4ECDC4".to_string()),
            ("p3".to_string(), "#FFE66D".to_string()),
        ];
        let mut game = GameState::new(players, 6, 6);
        assert_eq!(game.current_turn.as_deref(), Some("p1"));

        // p1 moves -> turn advances to p2
        game.apply_move("p1".to_string(), 0, 0).unwrap();
        assert_eq!(game.current_turn.as_deref(), Some("p2"));

        // If p2 disconnects while it is p2's turn
        game.remove_player_from_game("p2");

        // Turn must immediately and cleanly advance to p3 without freezing!
        assert_eq!(game.current_turn.as_deref(), Some("p3"));
        assert!(game.apply_move("p3".to_string(), 1, 1).is_ok());
    }
}
