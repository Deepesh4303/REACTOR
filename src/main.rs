mod game_state;
mod room;

use axum::{
    extract::{ws::WebSocketUpgrade, ConnectInfo, State},
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use futures::{SinkExt, StreamExt};
use room::{Message, RoomManager};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use tracing::{error, info};

/// Application state shared across handlers
#[derive(Clone)]
pub struct AppState {
    pub room_manager: Arc<RoomManager>,
}

/// Health check endpoint
async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "chain-reaction-relay"
    }))
}

/// WebSocket handler
async fn ws_handler(
    ws: WebSocketUpgrade,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    info!("New WebSocket connection from {}", addr);
    ws.on_upgrade(move |socket| handle_socket(socket, state, addr))
}

/// Handle individual WebSocket connection
async fn handle_socket(
    socket: axum::extract::ws::WebSocket,
    state: AppState,
    addr: SocketAddr,
) {
    let (sender, mut receiver) = socket.split();
    let sender = Arc::new(Mutex::new(sender));
    let mut player_id = String::new();
    let mut room_id = String::new();
    let mut room = None;

    // Handle incoming messages
    while let Some(msg) = receiver.next().await {
        match msg {
            Ok(axum::extract::ws::Message::Text(text)) => {
                // Try to parse as JSON message
                match serde_json::from_str::<Message>(&text) {
                    Ok(msg) => {
                        match msg {
                            Message::JoinRoom {
                                room_id: rid,
                                player_id: pid,
                                color,
                            } => {
                                info!("Player {} joining room {}", pid, rid);
                                player_id = pid.clone();
                                room_id = rid.clone();

                                let r = state.room_manager.get_or_create_room(rid);
                                room = Some(r.clone());

                                let assigned_color = match r.add_player(pid.clone(), color.clone()).await {
                                    Ok(color) => color,
                                    Err(e) => {
                                        error!("Failed to add player: {}", e);
                                        let _ = sender
                                            .lock()
                                            .await
                                            .send(axum::extract::ws::Message::Text(
                                                serde_json::to_string(&Message::MoveResult {
                                                    player_id: pid,
                                                    success: false,
                                                    error: Some(e),
                                                    game_state: None,
                                                    explosions: vec![],
                                                })
                                                .unwrap(),
                                            ))
                                            .await;
                                        break;
                                    }
                                };

                                // Send room state to joining player
                                let players = r.get_players();
                                let game_state = r.get_state().await;

                                if let Ok(response) = serde_json::to_string(&Message::RoomState {
                                    player_id: pid.clone(),
                                    players,
                                    game_state,
                                }) {
                                    let _ = sender
                                        .lock()
                                        .await
                                        .send(axum::extract::ws::Message::Text(response))
                                        .await;
                                }

                                if let Ok(response) = serde_json::to_string(&Message::PlayerJoined {
                                    player_id: pid.clone(),
                                    color: assigned_color.clone(),
                                }) {
                                    let _ = sender
                                        .lock()
                                        .await
                                        .send(axum::extract::ws::Message::Text(response))
                                        .await;
                                }

                                // Subscribe to room broadcasts
                                let mut rx = r.tx.subscribe();
                                let sender_clone = Arc::clone(&sender);
                                let subscribed_player_id = player_id.clone();

                                tokio::spawn(async move {
                                    while let Ok(msg) = rx.recv().await {
                                        let should_send = match &msg {
                                            Message::Signal { to, .. }
                                            | Message::IceCandidate { to, .. } => {
                                                to == &subscribed_player_id
                                            }
                                            _ => true,
                                        };

                                        if should_send {
                                            if let Ok(text) = serde_json::to_string(&msg) {
                                                let _ = sender_clone
                                                    .lock()
                                                    .await
                                                    .send(axum::extract::ws::Message::Text(text))
                                                    .await;
                                            }
                                        }
                                    }
                                });
                            }

                            Message::Move {
                                player_id: pid,
                                row,
                                col,
                            } => {
                                if let Some(ref r) = room {
                                    match r.apply_move(pid.clone(), row, col).await {
                                        Ok(_) => {
                                            info!("Player {} moved to ({}, {})", pid, row, col);
                                        }
                                        Err(e) => {
                                            error!("Invalid move: {}", e);
                                            if let Ok(response) = serde_json::to_string(
                                                &Message::MoveResult {
                                                    player_id: pid,
                                                    success: false,
                                                    error: Some(e),
                                                    game_state: None,
                                                    explosions: vec![],
                                                },
                                            ) {
                                                let _ = sender
                                                    .lock()
                                                    .await
                                                    .send(axum::extract::ws::Message::Text(
                                                        response,
                                                    ))
                                                    .await;
                                            }
                                        }
                                    }
                                }
                            }

                            Message::Chat { from, text } => {
                                if let Some(ref r) = room {
                                    let msg = Message::Chat { from, text };
                                    let _ = r.tx.send(msg);
                                }
                            }

                            Message::Signal { to, signal, .. } => {
                                if let Some(ref r) = room {
                                    let msg = Message::Signal {
                                        from: Some(player_id.clone()),
                                        to,
                                        signal,
                                    };
                                    let _ = r.tx.send(msg);
                                }
                            }

                            Message::IceCandidate { to, candidate, .. } => {
                                if let Some(ref r) = room {
                                    let msg = Message::IceCandidate {
                                        from: Some(player_id.clone()),
                                        to,
                                        candidate,
                                    };
                                    let _ = r.tx.send(msg);
                                }
                            }

                            Message::Ping => {
                                let _ = sender
                                    .lock()
                                    .await
                                    .send(axum::extract::ws::Message::Text(
                                        serde_json::to_string(&Message::Pong).unwrap(),
                                    ))
                                    .await;
                            }

                            _ => {}
                        }
                    }
                    Err(e) => {
                        error!("Failed to parse message: {}", e);
                    }
                }
            }
            Ok(axum::extract::ws::Message::Close(_)) => {
                info!("Connection closed from {}", addr);
                if let Some(r) = room {
                    r.remove_player(&player_id).await;
                    if r.is_empty() {
                        state.room_manager.delete_room(&room_id);
                        info!("Room {} deleted (empty)", room_id);
                    }
                }
                break;
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
            _ => {}
        }
    }
}

#[tokio::main]
async fn main() {
    // Initialize tracing
    tracing_subscriber::fmt::init();

    let state = AppState {
        room_manager: Arc::new(RoomManager::new()),
    };

    // Build router
    let app = Router::new()
        .route("/health", get(health))
        .route("/ws", get(ws_handler))
        .fallback_service(ServeDir::new("public"))
        .with_state(state.clone());

    // Start cleanup task
    let state_clone = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(300));
        loop {
            interval.tick().await;
            state_clone.room_manager.cleanup_empty_rooms().await;
            info!("Cleaned up empty rooms");
        }
    });

    // Get port from environment or use default
    let port = std::env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse::<u16>()
        .unwrap_or(3000);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(&addr)
        .await
        .expect("Failed to bind address");

    info!("🚀 Chain Reaction server listening on {}", addr);

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .expect("Server error");
}
