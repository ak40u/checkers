const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store active games
const games = new Map();

// Generate simple room code (4 digits)
function generateRoomCode() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

// Create initial board state
function createInitialBoard() {
  const board = [];
  for (let row = 0; row < 8; row++) {
    board[row] = [];
    for (let col = 0; col < 8; col++) {
      if ((row + col) % 2 === 1) {
        if (row < 3) {
          board[row][col] = 'black'; // Black pieces at top
        } else if (row > 4) {
          board[row][col] = 'white'; // White pieces at bottom
        } else {
          board[row][col] = null;
        }
      } else {
        board[row][col] = null;
      }
    }
  }
  return board;
}

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);

  // Create new game
  socket.on('createGame', (playerName) => {
    const roomCode = generateRoomCode();
    const game = {
      roomCode,
      board: createInitialBoard(),
      currentTurn: 'white',
      players: {
        white: { id: socket.id, name: playerName || 'Игрок 1' },
        black: null
      },
      mustCapture: null // Track if player must continue capturing
    };
    games.set(roomCode, game);
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerColor = 'white';

    socket.emit('gameCreated', {
      roomCode,
      color: 'white',
      board: game.board
    });
    console.log('Game created:', roomCode);
  });

  // Join existing game
  socket.on('joinGame', ({ roomCode, playerName }) => {
    const game = games.get(roomCode);

    if (!game) {
      socket.emit('error', 'Игра не найдена. Проверьте код.');
      return;
    }

    if (game.players.black) {
      socket.emit('error', 'Игра уже заполнена.');
      return;
    }

    game.players.black = { id: socket.id, name: playerName || 'Игрок 2' };
    socket.join(roomCode);
    socket.roomCode = roomCode;
    socket.playerColor = 'black';

    socket.emit('gameJoined', {
      roomCode,
      color: 'black',
      board: game.board,
      opponentName: game.players.white.name
    });

    // Notify first player that opponent joined
    io.to(game.players.white.id).emit('opponentJoined', {
      opponentName: playerName || 'Игрок 2'
    });

    // Start the game
    io.to(roomCode).emit('gameStart', {
      board: game.board,
      currentTurn: 'white',
      whiteName: game.players.white.name,
      blackName: game.players.black.name
    });

    console.log('Player joined game:', roomCode);
  });

  // Handle move
  socket.on('makeMove', ({ from, to }) => {
    const game = games.get(socket.roomCode);
    if (!game) return;

    // Check if it's this player's turn
    if (game.currentTurn !== socket.playerColor) {
      socket.emit('error', 'Сейчас не ваш ход!');
      return;
    }

    const piece = game.board[from.row][from.col];
    if (!piece || !piece.startsWith(socket.playerColor)) {
      socket.emit('error', 'Это не ваша шашка!');
      return;
    }

    // Calculate move
    const rowDiff = to.row - from.row;
    const colDiff = to.col - from.col;
    const isKing = piece.includes('King');

    // Check if move is valid
    let isCapture = false;
    let capturedRow, capturedCol;

    if (Math.abs(rowDiff) === 2 && Math.abs(colDiff) === 2) {
      // Capture move
      capturedRow = from.row + rowDiff / 2;
      capturedCol = from.col + colDiff / 2;
      const capturedPiece = game.board[capturedRow][capturedCol];

      if (!capturedPiece || capturedPiece.startsWith(socket.playerColor)) {
        socket.emit('error', 'Неверный ход!');
        return;
      }
      isCapture = true;
    } else if (Math.abs(rowDiff) === 1 && Math.abs(colDiff) === 1) {
      // Simple move - check direction for non-kings
      if (!isKing) {
        if (socket.playerColor === 'white' && rowDiff > 0) {
          socket.emit('error', 'Шашки ходят только вперёд!');
          return;
        }
        if (socket.playerColor === 'black' && rowDiff < 0) {
          socket.emit('error', 'Шашки ходят только вперёд!');
          return;
        }
      }
    } else {
      socket.emit('error', 'Неверный ход!');
      return;
    }

    // Check if destination is empty
    if (game.board[to.row][to.col]) {
      socket.emit('error', 'Клетка занята!');
      return;
    }

    // Make the move
    game.board[from.row][from.col] = null;

    // Check for king promotion
    let newPiece = piece;
    if (!isKing) {
      if (socket.playerColor === 'white' && to.row === 0) {
        newPiece = 'whiteKing';
      } else if (socket.playerColor === 'black' && to.row === 7) {
        newPiece = 'blackKing';
      }
    }
    game.board[to.row][to.col] = newPiece;

    // Remove captured piece
    if (isCapture) {
      game.board[capturedRow][capturedCol] = null;
    }

    // Check for additional captures
    let canCaptureMore = false;
    if (isCapture) {
      canCaptureMore = hasCaptures(game.board, to.row, to.col, socket.playerColor);
    }

    // Switch turn if no more captures
    if (!canCaptureMore) {
      game.currentTurn = game.currentTurn === 'white' ? 'black' : 'white';
      game.mustCapture = null;
    } else {
      game.mustCapture = { row: to.row, col: to.col };
    }

    // Check for win
    const winner = checkWinner(game.board);

    // Broadcast updated state
    io.to(socket.roomCode).emit('gameUpdate', {
      board: game.board,
      currentTurn: game.currentTurn,
      lastMove: { from, to },
      captured: isCapture ? { row: capturedRow, col: capturedCol } : null,
      mustContinue: canCaptureMore ? { row: to.row, col: to.col } : null,
      winner
    });
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    if (socket.roomCode) {
      const game = games.get(socket.roomCode);
      if (game) {
        io.to(socket.roomCode).emit('opponentLeft');
        games.delete(socket.roomCode);
      }
    }
  });
});

// Check if piece at position can capture
function hasCaptures(board, row, col, color) {
  const piece = board[row][col];
  if (!piece) return false;

  const isKing = piece.includes('King');
  const directions = isKing
    ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
    : color === 'white'
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]] // Allow backward captures
      : [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  for (const [dr, dc] of directions) {
    const midRow = row + dr;
    const midCol = col + dc;
    const endRow = row + dr * 2;
    const endCol = col + dc * 2;

    if (endRow >= 0 && endRow < 8 && endCol >= 0 && endCol < 8) {
      const midPiece = board[midRow][midCol];
      const endCell = board[endRow][endCol];

      if (midPiece && !midPiece.startsWith(color) && !endCell) {
        return true;
      }
    }
  }
  return false;
}

// Check for winner
function checkWinner(board) {
  let whiteCount = 0;
  let blackCount = 0;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.startsWith('white')) whiteCount++;
      if (piece && piece.startsWith('black')) blackCount++;
    }
  }

  if (whiteCount === 0) return 'black';
  if (blackCount === 0) return 'white';
  return null;
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
