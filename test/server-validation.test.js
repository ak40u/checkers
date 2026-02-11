/**
 * Tests for server-side move validation
 * Simulates the actual server validation logic
 */

const assert = require('assert');

// ============== SERVER VALIDATION LOGIC (from server.js) ==============

function createEmptyBoard() {
  const board = [];
  for (let row = 0; row < 8; row++) {
    board[row] = [];
    for (let col = 0; col < 8; col++) {
      board[row][col] = null;
    }
  }
  return board;
}

function hasCaptures(board, row, col, color) {
  const piece = board[row][col];
  if (!piece) return false;

  const isKing = piece.includes('King');
  const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  if (isKing) {
    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = col + dc;
      let foundEnemy = false;

      while (r >= 0 && r < 8 && c >= 0 && c < 8) {
        const cell = board[r][c];
        if (cell) {
          if (cell.startsWith(color)) break;
          else if (foundEnemy) break;
          else foundEnemy = true;
        } else if (foundEnemy) {
          return true;
        }
        r += dr;
        c += dc;
      }
    }
  } else {
    for (const [dr, dc] of directions) {
      const midRow = row + dr;
      const midCol = col + dc;
      const endRow = row + dr * 2;
      const endCol = col + dc * 2;

      if (endRow >= 0 && endRow < 8 && endCol >= 0 && endCol < 8) {
        const midPiece = board[midRow]?.[midCol];
        const endCell = board[endRow]?.[endCol];
        if (midPiece && !midPiece.startsWith(color) && !endCell) {
          return true;
        }
      }
    }
  }
  return false;
}

function anyPieceCanCapture(board, color) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const piece = board[row][col];
      if (piece && piece.startsWith(color)) {
        if (hasCaptures(board, row, col, color)) {
          return true;
        }
      }
    }
  }
  return false;
}

// Simulates server makeMove validation
function validateMove(board, from, to, playerColor, mustCapture = null) {
  const piece = board[from.row][from.col];

  if (!piece || !piece.startsWith(playerColor)) {
    return { valid: false, error: 'Это не ваша шашка!' };
  }

  // Check if must continue capture with specific piece
  if (mustCapture) {
    if (from.row !== mustCapture.row || from.col !== mustCapture.col) {
      return { valid: false, error: 'Нужно продолжить бить этой шашкой!' };
    }
  }

  const rowDiff = to.row - from.row;
  const colDiff = to.col - from.col;
  const isKing = piece.includes('King');

  // Check diagonal movement
  if (Math.abs(rowDiff) !== Math.abs(colDiff) || rowDiff === 0) {
    return { valid: false, error: 'Неверный ход!' };
  }

  // Check if destination is empty
  if (board[to.row][to.col]) {
    return { valid: false, error: 'Клетка занята!' };
  }

  // Check path and find captured piece
  let isCapture = false;
  let capturedRow, capturedCol;
  const dr = rowDiff > 0 ? 1 : -1;
  const dc = colDiff > 0 ? 1 : -1;
  const distance = Math.abs(rowDiff);

  let enemyFound = null;
  for (let i = 1; i < distance; i++) {
    const r = from.row + dr * i;
    const c = from.col + dc * i;
    const pathPiece = board[r][c];

    if (pathPiece) {
      if (pathPiece.startsWith(playerColor)) {
        return { valid: false, error: 'Путь заблокирован!' };
      }
      if (enemyFound) {
        return { valid: false, error: 'Нельзя перепрыгнуть две шашки!' };
      }
      enemyFound = { row: r, col: c };
    }
  }

  if (enemyFound) {
    isCapture = true;
    capturedRow = enemyFound.row;
    capturedCol = enemyFound.col;
  }

  // Check mandatory capture rule
  if (!isCapture && anyPieceCanCapture(board, playerColor)) {
    return { valid: false, error: 'Нужно бить!' };
  }

  // Validate move based on piece type
  if (!isKing) {
    if (distance === 1) {
      if (playerColor === 'white' && rowDiff > 0) {
        return { valid: false, error: 'Шашки ходят только вперёд!' };
      }
      if (playerColor === 'black' && rowDiff < 0) {
        return { valid: false, error: 'Шашки ходят только вперёд!' };
      }
    } else if (distance === 2) {
      if (!isCapture) {
        return { valid: false, error: 'Неверный ход!' };
      }
    } else {
      return { valid: false, error: 'Неверный ход!' };
    }
  }

  return {
    valid: true,
    isCapture,
    capturedRow,
    capturedCol
  };
}

// Execute a move and return new state
function executeMove(board, from, to, playerColor) {
  const validation = validateMove(board, from, to, playerColor);
  if (!validation.valid) {
    return { success: false, error: validation.error };
  }

  const newBoard = board.map(row => [...row]);
  const piece = newBoard[from.row][from.col];
  const isKing = piece.includes('King');

  newBoard[from.row][from.col] = null;

  // Check for king promotion
  let newPiece = piece;
  if (!isKing) {
    if (playerColor === 'white' && to.row === 0) {
      newPiece = 'whiteKing';
    } else if (playerColor === 'black' && to.row === 7) {
      newPiece = 'blackKing';
    }
  }
  newBoard[to.row][to.col] = newPiece;

  // Remove captured piece
  if (validation.isCapture) {
    newBoard[validation.capturedRow][validation.capturedCol] = null;
  }

  // Check for additional captures
  const canCaptureMore = validation.isCapture &&
    hasCaptures(newBoard, to.row, to.col, playerColor);

  return {
    success: true,
    board: newBoard,
    isCapture: validation.isCapture,
    canCaptureMore,
    mustContinueFrom: canCaptureMore ? to : null
  };
}

// ============== TESTS ==============

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function printBoard(board) {
  console.log('    0 1 2 3 4 5 6 7');
  for (let r = 0; r < 8; r++) {
    let row = `  ${r} `;
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) row += '. ';
      else if (p === 'whiteKing') row += 'W ';
      else if (p === 'blackKing') row += 'B ';
      else if (p === 'white') row += 'w ';
      else if (p === 'black') row += 'b ';
    }
    console.log(row);
  }
}

// ============== TEST CASES ==============

console.log('\n=== SERVER VALIDATION TESTS ===\n');

test('King simple move accepted', () => {
  const board = createEmptyBoard();
  board[4][4] = 'whiteKing';

  const result = executeMove(board, { row: 4, col: 4 }, { row: 2, col: 2 }, 'white');

  assert(result.success, 'Move should be accepted');
  assert(result.board[2][2] === 'whiteKing', 'King should be at new position');
  assert(result.board[4][4] === null, 'Old position should be empty');
});

test('King capture move accepted', () => {
  const board = createEmptyBoard();
  board[4][4] = 'whiteKing';
  board[3][3] = 'black';

  const result = executeMove(board, { row: 4, col: 4 }, { row: 2, col: 2 }, 'white');

  assert(result.success, 'Capture should be accepted');
  assert(result.isCapture, 'Should be marked as capture');
  assert(result.board[3][3] === null, 'Captured piece should be removed');
});

test('King long-distance capture accepted', () => {
  const board = createEmptyBoard();
  board[7][0] = 'whiteKing';
  board[4][3] = 'black';

  const result = executeMove(board, { row: 7, col: 0 }, { row: 3, col: 4 }, 'white');

  assert(result.success, 'Long capture should be accepted');
  assert(result.isCapture, 'Should be marked as capture');
  assert(result.board[4][3] === null, 'Captured piece should be removed');
});

test('Mandatory capture enforced', () => {
  const board = createEmptyBoard();
  board[4][4] = 'whiteKing';
  board[3][3] = 'black';  // Can be captured

  // Try to move without capturing
  const result = executeMove(board, { row: 4, col: 4 }, { row: 3, col: 5 }, 'white');

  assert(!result.success, 'Move should be rejected');
  assert(result.error === 'Нужно бить!', `Error should be "Нужно бить!", got "${result.error}"`);
});

test('Must continue multi-capture', () => {
  const board = createEmptyBoard();
  board[6][1] = 'whiteKing';
  board[4][3] = 'black';
  board[2][3] = 'black';

  // First capture
  const result1 = executeMove(board, { row: 6, col: 1 }, { row: 3, col: 4 }, 'white');

  assert(result1.success, 'First capture should succeed');
  assert(result1.canCaptureMore, 'Should indicate more captures available');
  assert(result1.mustContinueFrom.row === 3 && result1.mustContinueFrom.col === 4,
    'Must continue from landing position');

  // Second capture
  const result2 = executeMove(
    result1.board,
    { row: 3, col: 4 },
    { row: 1, col: 2 },
    'white'
  );

  assert(result2.success, 'Second capture should succeed');
  assert(!result2.canCaptureMore, 'No more captures should be available');
});

test('Cannot move different piece during multi-capture', () => {
  const board = createEmptyBoard();
  board[6][1] = 'whiteKing';
  board[4][3] = 'black';
  board[2][3] = 'black';
  board[6][5] = 'whiteKing';  // Another king

  // First capture with first king
  const result1 = executeMove(board, { row: 6, col: 1 }, { row: 3, col: 4 }, 'white');
  assert(result1.success && result1.canCaptureMore);

  // Try to move the OTHER king
  const validation = validateMove(
    result1.board,
    { row: 6, col: 5 },
    { row: 5, col: 6 },
    'white',
    result1.mustContinueFrom  // Must continue with first king
  );

  assert(!validation.valid, 'Should not allow moving different piece');
  assert(validation.error === 'Нужно продолжить бить этой шашкой!');
});

test('Complete zigzag multi-capture sequence', () => {
  //   0 1 2 3 4 5 6 7
  // 0 . . . . . . . .
  // 1 . . . . . . . .
  // 2 . . . b . . . .  <- black at (2,3)
  // 3 . . . . . . . .
  // 4 . . . b . . . .  <- black at (4,3)
  // 5 . . . . . . . .
  // 6 . W . . . . . .  <- white king at (6,1)
  // 7 . . . . . . . .

  const board = createEmptyBoard();
  board[6][1] = 'whiteKing';
  board[4][3] = 'black';
  board[2][3] = 'black';

  console.log('    Initial:');
  printBoard(board);

  // Move 1: (6,1) -> capture (4,3) -> land (3,4)
  const move1 = executeMove(board, { row: 6, col: 1 }, { row: 3, col: 4 }, 'white');

  assert(move1.success, 'Move 1 should succeed');
  assert(move1.isCapture, 'Move 1 should be capture');
  assert(move1.board[4][3] === null, 'Black at (4,3) should be captured');
  assert(move1.canCaptureMore, 'Should have more captures');

  console.log('    After move 1:');
  printBoard(move1.board);

  // Move 2: (3,4) -> capture (2,3) -> land (1,2)
  const move2 = executeMove(move1.board, { row: 3, col: 4 }, { row: 1, col: 2 }, 'white');

  assert(move2.success, 'Move 2 should succeed');
  assert(move2.isCapture, 'Move 2 should be capture');
  assert(move2.board[2][3] === null, 'Black at (2,3) should be captured');
  assert(!move2.canCaptureMore, 'Should have no more captures');

  console.log('    After move 2 (final):');
  printBoard(move2.board);

  // Verify final state
  assert(move2.board[1][2] === 'whiteKing', 'King should be at final position');
  assert(move2.board[6][1] === null, 'Starting position should be empty');
});

test('King cannot jump over two pieces', () => {
  const board = createEmptyBoard();
  board[7][0] = 'whiteKing';
  board[5][2] = 'black';
  board[3][4] = 'black';  // Second piece on path

  // Try to jump over both
  const result = executeMove(board, { row: 7, col: 0 }, { row: 2, col: 5 }, 'white');

  assert(!result.success, 'Should not allow jumping two pieces');
  assert(result.error === 'Нельзя перепрыгнуть две шашки!');
});

test('King blocked by own piece', () => {
  const board = createEmptyBoard();
  board[7][0] = 'whiteKing';
  board[5][2] = 'white';  // Own piece

  // Try to move through own piece
  const result = executeMove(board, { row: 7, col: 0 }, { row: 4, col: 3 }, 'white');

  assert(!result.success, 'Should not allow moving through own piece');
  assert(result.error === 'Путь заблокирован!');
});

test('King can land on any square after capture', () => {
  const board = createEmptyBoard();
  board[7][0] = 'whiteKing';
  board[5][2] = 'black';

  // Landing at different positions after capture
  const positions = [
    { row: 4, col: 3 },
    { row: 3, col: 4 },
    { row: 2, col: 5 },
    { row: 1, col: 6 },
    { row: 0, col: 7 }
  ];

  for (const pos of positions) {
    const testBoard = board.map(r => [...r]);
    const result = executeMove(testBoard, { row: 7, col: 0 }, pos, 'white');
    assert(result.success, `Should be able to land at (${pos.row},${pos.col})`);
  }
});

test('Regular piece backward capture allowed', () => {
  const board = createEmptyBoard();
  board[3][3] = 'white';  // Regular piece
  board[4][4] = 'black';  // Behind it

  // Capture backward
  const result = executeMove(board, { row: 3, col: 3 }, { row: 5, col: 5 }, 'white');

  assert(result.success, 'Backward capture should be allowed');
  assert(result.isCapture);
});

test('Regular piece backward move NOT allowed', () => {
  const board = createEmptyBoard();
  board[3][3] = 'white';

  // Try to move backward
  const result = executeMove(board, { row: 3, col: 3 }, { row: 4, col: 4 }, 'white');

  assert(!result.success, 'Backward move should not be allowed');
  assert(result.error === 'Шашки ходят только вперёд!');
});

test('Piece promotion to king', () => {
  const board = createEmptyBoard();
  board[1][1] = 'white';

  const result = executeMove(board, { row: 1, col: 1 }, { row: 0, col: 0 }, 'white');

  assert(result.success);
  assert(result.board[0][0] === 'whiteKing', 'Should be promoted to king');
});

test('Promotion during capture', () => {
  const board = createEmptyBoard();
  board[2][2] = 'white';
  board[1][1] = 'black';

  const result = executeMove(board, { row: 2, col: 2 }, { row: 0, col: 0 }, 'white');

  assert(result.success);
  assert(result.isCapture);
  assert(result.board[0][0] === 'whiteKing', 'Should be promoted after capture');
});

test('Promotion during capture STOPS turn (Russian checkers rule)', () => {
  // Russian checkers: if a piece becomes a king during a capture, it STOPS
  // It cannot continue capturing in the same turn
  const board = createEmptyBoard();
  board[2][2] = 'white';  // Regular piece
  board[1][1] = 'black';  // First enemy - capturing this promotes white
  board[1][3] = 'black';  // Second enemy - should NOT be capturable this turn

  //   0 1 2 3 4 5 6 7
  // 0 . . . . . . . .  <- white lands here and becomes king
  // 1 . b . b . . . .  <- two black pieces
  // 2 . . w . . . . .  <- white starts here

  const result = executeMove(board, { row: 2, col: 2 }, { row: 0, col: 0 }, 'white');

  assert(result.success, 'Capture should succeed');
  assert(result.isCapture, 'Should be marked as capture');
  assert(result.board[0][0] === 'whiteKing', 'Should be promoted to king');
  assert(!result.canCaptureMore, 'Should NOT be able to continue capturing after promotion');
  assert(result.mustContinueFrom === null, 'mustContinueFrom should be null after promotion');
});

// ============== RESULTS ==============

console.log('\n=== RESULTS ===\n');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
