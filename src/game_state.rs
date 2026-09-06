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
    /// Create a new game with specified players
    pub fn new(players: Vec<(String, String)>, width: usize, height: usize) -> Self {
        let board = vec![vec![Cell::new(); width]; height];
        let mut player_map = HashMap::new();

        // Assign players and colors
        for (id, color) in players {
            player_map.insert(id.clone(), Player {
                id: id.clone(),
                color: color.clone(),
                is_alive: true,
                has_played: false,
            });
        }

        let first_player = player_map.keys().next().cloned();

        GameState {
            board,
            players: player_map,
            current_turn: first_player,
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
        if cell.owner.as_ref() != Some(&player_id) {
            // Taking an opponent's cell replaces its contents with one particle.
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

    /// Advance to next player's turn
    fn advance_turn(&mut self) {
        if let Some(current) = self.current_turn.clone() {
            let player_ids: Vec<_> = self.players.keys().cloned().collect();
            let current_index = player_ids.iter().position(|id| id == &current).unwrap_or(0);
            let mut next_index = (current_index + 1) % player_ids.len();

            // Skip eliminated players
            let mut attempts = 0;
            while attempts < player_ids.len() {
                let next_player = &player_ids[next_index];
                if self.players[next_player].is_alive {
                    self.current_turn = Some(next_player.clone());
                    return;
                }
                next_index = (next_index + 1) % player_ids.len();
                attempts += 1;
            }

            self.current_turn = None;
        }
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
            "eliminated": self.eliminated,
            "move_count": self.move_count,
            "is_over": self.is_over,
            "winner": self.winner,
            "width": self.width,
            "height": self.height,
        })
    }
}
