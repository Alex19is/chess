// Self-Replicating Chess Engine for Beagle
// Полная версия с правильными правилами шахмат

class SelfReplicatingChess {
    constructor() {
        console.log('Chess constructor started');
        this.board = null;
        this.currentGame = null;
        this.moves = [];
        this.version = 0;
        this.moveCache = {};
        this.mySide = null;
        this.isSpectator = false;
        this.selectedSquare = null;
        this.validMoves = [];
        this.currentPlayer = 'white';
        this.castlingRights = {
            white: { kingSide: true, queenSide: true },
            black: { kingSide: true, queenSide: true }
        };
        this.enPassantTarget = null; // Клетка для взятия на проходе
        this.halfMoveClock = 0; // Для правила 50 ходов
        this.fullMoveNumber = 1;
        
        // Используем HTML-сущности для шахматных фигур
        this.pieceSymbols = {
            'r': '&#9820;', // ♜
            'n': '&#9822;', // ♞
            'b': '&#9821;', // ♝
            'q': '&#9819;', // ♛
            'k': '&#9818;', // ♚
            'p': '&#9823;', // ♟
            'R': '&#9814;', // ♖
            'N': '&#9816;', // ♘
            'B': '&#9815;', // ♗
            'Q': '&#9813;', // ♕
            'K': '&#9812;', // ♔
            'P': '&#9817;'  // ♙
        };
        
        this.init();
    }

    getSessionId() {
        let id = null;
        try {
            id = localStorage.getItem('chess_session_id');
            if (!id) {
                id = 's_' + Math.random().toString(36).slice(2) + '_' + Date.now();
                localStorage.setItem('chess_session_id', id);
            }
        } catch (e) {}
        return id || 's_' + Date.now();
    }

    async assignSide() {
        const sessionId = this.getSessionId();
        const sideKey = 'chess_side_' + this.currentGame;
        try {
            const cached = localStorage.getItem(sideKey);
            if (cached === 'white' || cached === 'black') {
                const slots = await fetch(`/games/${this.currentGame}/slots.json`).then(r => r.ok ? r.json() : { white: null, black: null }).catch(() => ({ white: null, black: null }));
                if ((slots.white === sessionId && cached === 'white') || (slots.black === sessionId && cached === 'black')) {
                    this.mySide = cached;
                    return;
                }
            }
            let slots = await fetch(`/games/${this.currentGame}/slots.json`).then(r => r.ok ? r.json() : { white: null, black: null }).catch(() => ({ white: null, black: null }));
            if (!slots.white && !slots.black) {
                this.mySide = 'white';
                await fetch(`/games/${this.currentGame}/slots.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ white: sessionId, black: null }) });
            } else if (slots.white && !slots.black) {
                this.mySide = 'black';
                await fetch(`/games/${this.currentGame}/slots.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ white: slots.white, black: sessionId }) });
            } else {
                if (slots.white === sessionId) this.mySide = 'white';
                else if (slots.black === sessionId) this.mySide = 'black';
                else this.isSpectator = true;
            }
            if (this.mySide) localStorage.setItem(sideKey, this.mySide);
        } catch (e) {
            this.mySide = null;
        }
    }

    async init() {
        console.log('Init started');
        const params = new URLSearchParams(window.location.search);
        this.currentGame = params.get('game') || 'template';
        
        await this.loadGame();
        await this.assignSide();
        this.startPolling();
        this.render();
        this.setupEventListeners();
        this.setupMoveSelector();
        this.updateMoveSelector();
    }

    async discoverMoves() {
        const list = [];
        for (let n = 1; n <= 9999; n++) {
            const name = String(n).padStart(4, '0') + '.json';
            const r = await fetch(`/games/${this.currentGame}/moves/${name}`);
            if (!r.ok) break;
            list.push(name);
        }
        return list;
    }

    storageKey() {
        return 'chess_' + this.currentGame;
    }

    saveGameToStorage() {
        try {
            const data = { version: this.version, moveCache: this.moveCache, moves: this.moves };
            localStorage.setItem(this.storageKey(), JSON.stringify(data));
        } catch (e) {
            console.warn('localStorage save failed', e);
        }
    }

    loadGameFromStorage() {
        try {
            const raw = localStorage.getItem(this.storageKey());
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }

    async loadGame(fromServerOnly) {
        try {
            this.moves = await this.discoverMoves();
            const serverVersion = this.moves.length;
            const saved = fromServerOnly ? null : this.loadGameFromStorage();

            if (saved && saved.moveCache && typeof saved.version === 'number') {
                this.moveCache = saved.moveCache;
                if (saved.moves && saved.moves.length > this.moves.length) {
                    this.moves = saved.moves.slice().sort();
                }
                this.version = saved.version;
                if (this.moveCache[this.version]) {
                    this.applyMoveData(this.moveCache[this.version]);
                    this.updateGameUI();
                    this.saveGameToStorage();
                    return;
                }
            }

            this.version = serverVersion;
            if (this.version > 0) {
                const lastFile = this.moves[this.moves.length - 1];
                const lastMove = await fetch(`/games/${this.currentGame}/moves/${lastFile}`).then(r => r.json());
                this.applyMoveData(lastMove);
                this.moveCache[this.version] = lastMove;
            } else {
                this.board = this.getInitialBoard();
            }
            this.saveGameToStorage();
        } catch (e) {
            console.log('Using initial board:', e);
            const saved = fromServerOnly ? null : this.loadGameFromStorage();
            if (saved && saved.moveCache && saved.version > 0 && saved.moveCache[saved.version]) {
                this.moveCache = saved.moveCache;
                this.moves = saved.moves || [];
                this.version = saved.version;
                this.applyMoveData(saved.moveCache[saved.version]);
            } else {
                this.board = this.getInitialBoard();
            }
            this.saveGameToStorage();
        }
        this.updateGameUI();
    }

    async fetchServerMoveCount() {
        try {
            const r = await fetch(`/games/${this.currentGame}/moves/`);
            if (!r.ok) return this.version;
            const text = await r.text();
            const list = (text.match(/\d{4}\.json/g) || []).sort();
            return list.length;
        } catch (e) {
            return this.version;
        }
    }

    startPolling() {
        if (this._pollTimer) return;
        this._pollTimer = setInterval(async () => {
            const serverCount = await this.fetchServerMoveCount();
            if (serverCount > this.version) {
                await this.loadGame(true);
                this.render();
                this.updateMoveSelector();
            }
        }, 3000);
    }

    moveFilename(n) {
        return String(n).padStart(4, '0') + '.json';
    }

    applyMoveData(data) {
        this.board = data.board;
        const v = data.version != null ? data.version : this.version;
        this.currentPlayer = data.nextPlayer || (v % 2 === 1 ? 'black' : 'white');
        this.castlingRights = data.castlingRights || { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } };
        this.enPassantTarget = data.enPassantTarget || null;
    }

    async loadVersion(atVersion) {
        this.selectedSquare = null;
        this.validMoves = [];
        if (atVersion <= 0) {
            this.board = this.getInitialBoard();
            this.currentPlayer = 'white';
            this.castlingRights = { white: { kingSide: true, queenSide: true }, black: { kingSide: true, queenSide: true } };
            this.enPassantTarget = null;
            this.version = 0;
            this.saveGameToStorage();
            this.updateGameUI();
            this.render();
            this.updateMoveSelector();
            return;
        }
        if (this.moveCache[atVersion]) {
            this.applyMoveData(this.moveCache[atVersion]);
            this.version = atVersion;
            this.saveGameToStorage();
            this.updateGameUI();
            this.render();
            this.updateMoveSelector();
            return;
        }
        const moveFile = this.moveFilename(atVersion);
        try {
            const data = await fetch(`/games/${this.currentGame}/moves/${moveFile}`).then(r => {
                if (!r.ok) throw new Error('Move not found');
                return r.json();
            });
            this.moveCache[atVersion] = data;
            this.applyMoveData(data);
            this.version = atVersion;
        } catch (e) {
            console.warn('loadVersion failed:', e);
            this.showMessage('Could not load move ' + atVersion);
            return;
        }
        this.saveGameToStorage();
        this.updateGameUI();
        this.render();
        this.updateMoveSelector();
    }

    updateGameUI() {
        document.getElementById('gameId').textContent = this.currentGame;
        document.getElementById('gameVersion').textContent = this.version;
        const statusEl = document.getElementById('gameStatus');
        if (statusEl) {
            if (this.isSpectator) statusEl.textContent = 'Spectator (view only)';
            else if (this.mySide) {
                const turn = this.currentPlayer === this.mySide ? 'Your turn' : 'Waiting for opponent';
                statusEl.textContent = turn;
            } else statusEl.textContent = this.currentPlayer;
        }
        const sideEl = document.getElementById('mySide');
        if (sideEl) {
            if (this.isSpectator) sideEl.textContent = 'Spectator';
            else if (this.mySide) sideEl.textContent = 'You: ' + (this.mySide === 'white' ? 'White' : 'Black');
            else sideEl.textContent = '';
        }
        const undoBtn = document.getElementById('undoBtn');
        if (undoBtn) undoBtn.disabled = this.version <= 0 || this.isSpectator || !!this.mySide;
        this.updateMoveSelector();
    }

    updateMoveSelector() {
        const sel = document.getElementById('moveSelector');
        const label = document.getElementById('moveSelectorLabel');
        if (!sel) return;
        const maxVer = Math.max(this.version, this.moves.length);
        sel.max = maxVer;
        sel.value = this.version;
        sel.disabled = maxVer <= 0;
        if (label) label.textContent = this.version;
    }

    setupMoveSelector() {
        const sel = document.getElementById('moveSelector');
        if (!sel) return;
        sel.addEventListener('input', () => {
            const v = parseInt(sel.value, 10);
            if (v !== this.version) this.loadVersion(v);
        });
    }

    async undo() {
        if (this.version <= 0) return;
        await this.loadVersion(this.version - 1);
    }

    getInitialBoard() {
        return [
            ['r','n','b','q','k','b','n','r'],
            ['p','p','p','p','p','p','p','p'],
            ['','','','','','','',''],
            ['','','','','','','',''],
            ['','','','','','','',''],
            ['','','','','','','',''],
            ['P','P','P','P','P','P','P','P'],
            ['R','N','B','Q','K','B','N','R']
        ];
    }

    getPieceSymbol(piece) {
        return this.pieceSymbols[piece] || piece;
    }

    render() {
        const boardElement = document.getElementById('chessboard');
        if (!boardElement) return;
        
        boardElement.innerHTML = '';
        boardElement.style.display = 'grid';
        boardElement.style.gridTemplateColumns = 'repeat(8, 70px)';
        boardElement.style.gridTemplateRows = 'repeat(8, 70px)';
        boardElement.style.border = '3px solid #34495e';
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const square = document.createElement('div');
                
                // Базовые стили
                square.style.width = '70px';
                square.style.height = '70px';
                square.style.display = 'flex';
                square.style.alignItems = 'center';
                square.style.justifyContent = 'center';
                square.style.fontSize = '48px';
                square.style.cursor = 'pointer';
                square.style.fontFamily = 'Arial, "Segoe UI", sans-serif';
                
                // Цвет клетки
                square.style.backgroundColor = (row + col) % 2 === 0 ? '#f0d9b5' : '#b58863';
                
                // Дата-атрибуты
                square.dataset.row = row;
                square.dataset.col = col;
                
                // Подсветка выбранной клетки
                if (this.selectedSquare && 
                    this.selectedSquare.row === row && 
                    this.selectedSquare.col === col) {
                    square.style.boxShadow = 'inset 0 0 0 4px #e74c3c';
                }
                
                // Подсветка возможных ходов
                if (this.validMoves.some(m => m.row === row && m.col === col)) {
                    square.style.boxShadow = 'inset 0 0 0 4px #2ecc71';
                }
                
                // Фигура
                const piece = this.board[row][col];
                if (piece) {
                    square.innerHTML = this.getPieceSymbol(piece);
                }
                
                boardElement.appendChild(square);
            }
        }
        
        this.updateGameUI();
    }

    setupEventListeners() {
        const boardElement = document.getElementById('chessboard');
        if (!boardElement) return;
        
        boardElement.addEventListener('click', (e) => {
            const square = e.target.closest('div[data-row]');
            if (!square) return;
            
            const row = parseInt(square.dataset.row);
            const col = parseInt(square.dataset.col);
            this.handleSquareClick(row, col);
        });
    }

    isPieceMine(piece) {
        if (!this.mySide || !piece) return false;
        return this.mySide === 'white' ? piece === piece.toUpperCase() : piece === piece.toLowerCase();
    }

    canIMove() {
        if (this.isSpectator || !this.mySide) return false;
        return this.currentPlayer === this.mySide;
    }

    handleSquareClick(row, col) {
        if (this.isSpectator) return;
        const piece = this.board[row][col];
        
        if (!this.selectedSquare) {
            if (!this.canIMove()) return;
            if (piece && this.isPieceMine(piece)) {
                this.selectedSquare = { row, col };
                this.validMoves = this.getValidMoves(row, col);
                this.render();
            }
            return;
        }
        
        // Если выбрана та же клетка - снять выделение
        if (this.selectedSquare.row === row && this.selectedSquare.col === col) {
            this.selectedSquare = null;
            this.validMoves = [];
            this.render();
            return;
        }
        
        // Проверить, можно ли сходить на выбранную клетку
        if (this.validMoves.some(m => m.row === row && m.col === col)) {
            this.makeMove(this.selectedSquare.row, this.selectedSquare.col, row, col);
        }
        
        // Снять выделение
        this.selectedSquare = null;
        this.validMoves = [];
        this.render();
    }

    isPieceCurrentPlayer(piece) {
        if (this.currentPlayer === 'white') {
            return piece === piece.toUpperCase();
        } else {
            return piece === piece.toLowerCase() && piece !== '';
        }
    }

    getValidMoves(row, col) {
        const piece = this.board[row][col];
        if (!piece) return [];
        
        const isWhite = piece === piece.toUpperCase();
        const pieceType = piece.toLowerCase();
        const moves = [];
        
        switch(pieceType) {
            case 'p': // Пешка
                this.getPawnMoves(row, col, isWhite, moves);
                break;
            case 'n': // Конь
                this.getKnightMoves(row, col, isWhite, moves);
                break;
            case 'b': // Слон
                this.getBishopMoves(row, col, isWhite, moves);
                break;
            case 'r': // Ладья
                this.getRookMoves(row, col, isWhite, moves);
                break;
            case 'q': // Ферзь
                this.getQueenMoves(row, col, isWhite, moves);
                break;
            case 'k': // Король
                this.getKingMoves(row, col, isWhite, moves);
                break;
        }
        
        // Фильтруем ходы, которые оставляют своего короля под шахом
        return moves.filter(move => {
            const newBoard = this.simulateMove(row, col, move.row, move.col);
            return !this.isInCheck(newBoard, isWhite);
        });
    }

    getPawnMoves(row, col, isWhite, moves) {
        const direction = isWhite ? -1 : 1;
        const startRow = isWhite ? 6 : 1;
        
        // Ход вперед на 1
        if (row + direction >= 0 && row + direction < 8 && !this.board[row + direction][col]) {
            moves.push({ row: row + direction, col });
            
            // Ход вперед на 2 с начальной позиции
            if (row === startRow && !this.board[row + 2 * direction][col]) {
                moves.push({ row: row + 2 * direction, col });
            }
        }
        
        // Взятие вправо
        if (col + 1 < 8 && row + direction >= 0 && row + direction < 8) {
            const targetPiece = this.board[row + direction][col + 1];
            if (targetPiece && !this.isPieceCurrentPlayer(targetPiece)) {
                moves.push({ row: row + direction, col: col + 1 });
            }
            // Взятие на проходе
            if (this.enPassantTarget && 
                this.enPassantTarget.row === row + direction && 
                this.enPassantTarget.col === col + 1) {
                moves.push({ row: row + direction, col: col + 1, enPassant: true });
            }
        }
        
        // Взятие влево
        if (col - 1 >= 0 && row + direction >= 0 && row + direction < 8) {
            const targetPiece = this.board[row + direction][col - 1];
            if (targetPiece && !this.isPieceCurrentPlayer(targetPiece)) {
                moves.push({ row: row + direction, col: col - 1 });
            }
            // Взятие на проходе
            if (this.enPassantTarget && 
                this.enPassantTarget.row === row + direction && 
                this.enPassantTarget.col === col - 1) {
                moves.push({ row: row + direction, col: col - 1, enPassant: true });
            }
        }
    }

    getKnightMoves(row, col, isWhite, moves) {
        const knightMoves = [
            [-2, -1], [-2, 1], [-1, -2], [-1, 2],
            [1, -2], [1, 2], [2, -1], [2, 1]
        ];
        
        for (const [dr, dc] of knightMoves) {
            const newRow = row + dr;
            const newCol = col + dc;
            
            if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                const targetPiece = this.board[newRow][newCol];
                if (!targetPiece || !this.isPieceCurrentPlayer(targetPiece)) {
                    moves.push({ row: newRow, col: newCol });
                }
            }
        }
    }

    getBishopMoves(row, col, isWhite, moves) {
        const directions = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
        this.getSlidingMoves(row, col, isWhite, directions, moves);
    }

    getRookMoves(row, col, isWhite, moves) {
        const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
        this.getSlidingMoves(row, col, isWhite, directions, moves);
    }

    getQueenMoves(row, col, isWhite, moves) {
        const directions = [
            [-1, -1], [-1, 1], [1, -1], [1, 1],
            [-1, 0], [1, 0], [0, -1], [0, 1]
        ];
        this.getSlidingMoves(row, col, isWhite, directions, moves);
    }

    getKingMoves(row, col, isWhite, moves) {
        const kingMoves = [
            [-1, -1], [-1, 0], [-1, 1],
            [0, -1],           [0, 1],
            [1, -1],  [1, 0],  [1, 1]
        ];
        
        for (const [dr, dc] of kingMoves) {
            const newRow = row + dr;
            const newCol = col + dc;
            
            if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 8) {
                const targetPiece = this.board[newRow][newCol];
                if (!targetPiece || !this.isPieceCurrentPlayer(targetPiece)) {
                    moves.push({ row: newRow, col: newCol });
                }
            }
        }
        
        // Рокировка
        this.getCastlingMoves(row, col, isWhite, moves);
    }

    getSlidingMoves(row, col, isWhite, directions, moves) {
        for (const [dr, dc] of directions) {
            for (let i = 1; i < 8; i++) {
                const newRow = row + dr * i;
                const newCol = col + dc * i;
                
                if (newRow < 0 || newRow >= 8 || newCol < 0 || newCol >= 8) break;
                
                const targetPiece = this.board[newRow][newCol];
                if (!targetPiece) {
                    moves.push({ row: newRow, col: newCol });
                } else {
                    if (!this.isPieceCurrentPlayer(targetPiece)) {
                        moves.push({ row: newRow, col: newCol });
                    }
                    break;
                }
            }
        }
    }

    getCastlingMoves(row, col, isWhite, moves) {
        if (!isWhite && row !== 0) return;
        if (isWhite && row !== 7) return;
        
        const rights = isWhite ? this.castlingRights.white : this.castlingRights.black;
        
        // Короткая рокировка (королевский фланг)
        if (rights.kingSide) {
            // Проверяем, что клетки между королем и ладьей пусты
            if (!this.board[row][5] && !this.board[row][6]) {
                // Проверяем, что король не проходит через битое поле
                if (!this.isSquareAttacked(row, 5, isWhite) && 
                    !this.isSquareAttacked(row, 6, isWhite)) {
                    moves.push({ row, col: 6, castling: 'king' });
                }
            }
        }
        
        // Длинная рокировка (ферзевый фланг)
        if (rights.queenSide) {
            // Проверяем, что клетки между королем и ладьей пусты
            if (!this.board[row][3] && !this.board[row][2] && !this.board[row][1]) {
                // Проверяем, что король не проходит через битое поле
                if (!this.isSquareAttacked(row, 3, isWhite) && 
                    !this.isSquareAttacked(row, 2, isWhite)) {
                    moves.push({ row, col: 2, castling: 'queen' });
                }
            }
        }
    }

    isSquareAttacked(row, col, isWhiteKing) {
        // Проверяем, атакована ли клетка фигурами противника
        const opponentColor = isWhiteKing ? 'black' : 'white';
        
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (!piece) continue;
                
                const isOpponent = opponentColor === 'white' ? 
                    piece === piece.toUpperCase() : 
                    piece === piece.toLowerCase();
                
                if (isOpponent) {
                    const moves = [];
                    const pieceType = piece.toLowerCase();
                    
                    // Временная проверка атак
                    if (pieceType === 'p') {
                        const direction = isOpponent ? -1 : 1;
                        if (Math.abs(c - col) === 1 && r + direction === row) {
                            return true;
                        }
                    } else if (pieceType === 'n') {
                        if (Math.abs(r - row) === 2 && Math.abs(c - col) === 1 ||
                            Math.abs(r - row) === 1 && Math.abs(c - col) === 2) {
                            return true;
                        }
                    } else if (pieceType === 'k') {
                        if (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1) {
                            return true;
                        }
                    } else {
                        // Слон, ладья, ферзь
                        if (r === row || c === col || Math.abs(r - row) === Math.abs(c - col)) {
                            // Проверяем, нет ли фигур на пути
                            let dr = r === row ? 0 : (r < row ? 1 : -1);
                            let dc = c === col ? 0 : (c < col ? 1 : -1);
                            let blocked = false;
                            
                            for (let i = 1; i < Math.max(Math.abs(r - row), Math.abs(c - col)); i++) {
                                const tr = r + dr * i;
                                const tc = c + dc * i;
                                if (tr === row && tc === col) break;
                                if (this.board[tr][tc]) {
                                    blocked = true;
                                    break;
                                }
                            }
                            
                            if (!blocked) {
                                if ((pieceType === 'r' && (r === row || c === col)) ||
                                    (pieceType === 'b' && Math.abs(r - row) === Math.abs(c - col)) ||
                                    pieceType === 'q') {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    isInCheck(board, isWhite) {
        // Находим короля
        let kingRow, kingCol;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (piece && (isWhite ? piece === 'K' : piece === 'k')) {
                    kingRow = r;
                    kingCol = c;
                    break;
                }
            }
        }
        
        // Проверяем, атакован ли король
        return this.isSquareAttackedByBoard(board, kingRow, kingCol, !isWhite);
    }

    isSquareAttackedByBoard(board, row, col, byWhite) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = board[r][c];
                if (!piece) continue;
                
                const isAttacker = byWhite ? 
                    piece === piece.toUpperCase() : 
                    piece === piece.toLowerCase();
                
                if (isAttacker) {
                    const pieceType = piece.toLowerCase();
                    
                    // Пешка
                    if (pieceType === 'p') {
                        const direction = byWhite ? -1 : 1;
                        if (r + direction === row && Math.abs(c - col) === 1) {
                            return true;
                        }
                    }
                    
                    // Конь
                    if (pieceType === 'n') {
                        if (Math.abs(r - row) === 2 && Math.abs(c - col) === 1 ||
                            Math.abs(r - row) === 1 && Math.abs(c - col) === 2) {
                            return true;
                        }
                    }
                    
                    // Король
                    if (pieceType === 'k') {
                        if (Math.abs(r - row) <= 1 && Math.abs(c - col) <= 1) {
                            return true;
                        }
                    }
                    
                    // Слон, ладья, ферзь
                    if (pieceType === 'b' || pieceType === 'r' || pieceType === 'q') {
                        if ((pieceType === 'r' || pieceType === 'q') && (r === row || c === col)) {
                            // Проверяем линию
                            let dr = r === row ? 0 : (r < row ? 1 : -1);
                            let dc = c === col ? 0 : (c < col ? 1 : -1);
                            let blocked = false;
                            
                            for (let i = 1; i < Math.max(Math.abs(r - row), Math.abs(c - col)); i++) {
                                const tr = r + dr * i;
                                const tc = c + dc * i;
                                if (tr === row && tc === col) break;
                                if (board[tr][tc]) {
                                    blocked = true;
                                    break;
                                }
                            }
                            
                            if (!blocked) return true;
                        }
                        
                        if ((pieceType === 'b' || pieceType === 'q') && Math.abs(r - row) === Math.abs(c - col)) {
                            // Проверяем диагональ
                            let dr = r < row ? 1 : -1;
                            let dc = c < col ? 1 : -1;
                            let blocked = false;
                            
                            for (let i = 1; i < Math.abs(r - row); i++) {
                                const tr = r + dr * i;
                                const tc = c + dc * i;
                                if (tr === row && tc === col) break;
                                if (board[tr][tc]) {
                                    blocked = true;
                                    break;
                                }
                            }
                            
                            if (!blocked) return true;
                        }
                    }
                }
            }
        }
        return false;
    }

    simulateMove(fromRow, fromCol, toRow, toCol) {
        const newBoard = this.board.map(row => [...row]);
        newBoard[toRow][toCol] = newBoard[fromRow][fromCol];
        newBoard[fromRow][fromCol] = '';
        return newBoard;
    }

    async makeMove(fromRow, fromCol, toRow, toCol, special = {}) {
        const newBoard = this.board.map(row => [...row]);
        const piece = newBoard[fromRow][fromCol];
        const isWhite = piece === piece.toUpperCase();
        
        // Обработка специальных ходов
        if (special.enPassant) {
            // Взятие на проходе - удаляем пешку противника
            newBoard[fromRow][toCol] = '';
        } else if (special.castling) {
            // Рокировка - перемещаем ладью
            if (special.castling === 'king') {
                newBoard[fromRow][5] = newBoard[fromRow][7];
                newBoard[fromRow][7] = '';
            } else if (special.castling === 'queen') {
                newBoard[fromRow][3] = newBoard[fromRow][0];
                newBoard[fromRow][0] = '';
            }
        }
        
        // Перемещаем фигуру
        newBoard[toRow][toCol] = piece;
        newBoard[fromRow][fromCol] = '';
        
        // Превращение пешки
        if (piece.toLowerCase() === 'p' && (toRow === 0 || toRow === 7)) {
            newBoard[toRow][toCol] = isWhite ? 'Q' : 'q'; // Автоматически в ферзя
        }
        
        this.board = newBoard;
        this.version++;
        this.currentPlayer = this.currentPlayer === 'white' ? 'black' : 'white';
        
        // Обновляем права на рокировку
        if (piece.toLowerCase() === 'k') {
            if (isWhite) {
                this.castlingRights.white = { kingSide: false, queenSide: false };
            } else {
                this.castlingRights.black = { kingSide: false, queenSide: false };
            }
        }
        if (piece.toLowerCase() === 'r') {
            if (isWhite) {
                if (fromCol === 0) this.castlingRights.white.queenSide = false;
                if (fromCol === 7) this.castlingRights.white.kingSide = false;
            } else {
                if (fromCol === 0) this.castlingRights.black.queenSide = false;
                if (fromCol === 7) this.castlingRights.black.kingSide = false;
            }
        }
        
        // Обновляем en passant target
        this.enPassantTarget = null;
        if (piece.toLowerCase() === 'p' && Math.abs(fromRow - toRow) === 2) {
            this.enPassantTarget = {
                row: (fromRow + toRow) / 2,
                col: fromCol
            };
        }
        
        // Проверка на мат/пат
        const inCheck = this.isInCheck(this.board, this.currentPlayer === 'white');
        const hasMoves = this.hasAnyMove(this.currentPlayer === 'white');
        
        if (inCheck && !hasMoves) {
            alert(`Checkmate! ${this.currentPlayer === 'white' ? 'Black' : 'White'} wins!`);
        } else if (!inCheck && !hasMoves) {
            alert('Stalemate!');
        } else if (inCheck) {
            alert(`Check! ${this.currentPlayer}'s king is in check`);
        }
        
        const moveData = {
            board: this.board,
            from: `${fromRow},${fromCol}`,
            to: `${toRow},${toCol}`,
            piece: piece,
            special: special,
            nextPlayer: this.currentPlayer,
            castlingRights: this.castlingRights,
            enPassantTarget: this.enPassantTarget,
            version: this.version
        };
        this.moveCache[this.version] = moveData;
        try {
            const moveNumber = String(this.version).padStart(4, '0');
            await fetch(`/games/${this.currentGame}/moves/${moveNumber}.json`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(moveData)
            });
            if (!this.moves.includes(moveNumber + '.json')) {
                this.moves.push(moveNumber + '.json');
                this.moves.sort();
            }
        } catch (e) {
            console.log('Move not saved to server');
        }
        this.saveGameToStorage();
        this.render();
    }

    hasAnyMove(isWhite) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && (isWhite ? piece === piece.toUpperCase() : piece === piece.toLowerCase())) {
                    const moves = this.getValidMoves(r, c);
                    if (moves.length > 0) return true;
                }
            }
        }
        return false;
    }

    newGame() {
        const newId = 'game_' + Date.now();
        window.location.href = `/?game=${encodeURIComponent(newId)}`;
    }

    async replicate() {
        const newGameId = 'game_' + Date.now();
        
        try {
            // Копируем текущую игру
            const moveData = [];
            for (let i = 1; i <= this.version; i++) {
                const moveNum = String(i).padStart(4, '0');
                try {
                    const move = await fetch(`/games/${this.currentGame}/moves/${moveNum}.json`)
                        .then(r => r.json());
                    moveData.push(move);
                } catch (e) {}
            }
            
            // Создаем новую игру
            for (let i = 0; i < moveData.length; i++) {
                const moveNum = String(i + 1).padStart(4, '0');
                await fetch(`/games/${newGameId}/moves/${moveNum}.json`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(moveData[i])
                });
            }
            
            window.location.href = `/?game=${newGameId}`;
        } catch (e) {
            console.log('Replication failed, just navigating');
            window.location.href = `/?game=${newGameId}`;
        }
    }

    showMessage(msg, durationMs) {
        const el = document.getElementById('chessMessage');
        if (el) el.remove();
        const div = document.createElement('div');
        div.id = 'chessMessage';
        div.textContent = msg;
        div.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#2c3e50;color:#fff;padding:10px 16px;border-radius:8px;z-index:9999;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
        document.body.appendChild(div);
        setTimeout(() => div.remove(), durationMs || 2500);
    }

    async exportSnapshot() {
        const snapshot = {
            gameId: this.currentGame,
            version: this.version,
            board: this.board,
            currentPlayer: this.currentPlayer,
            castlingRights: this.castlingRights,
            enPassantTarget: this.enPassantTarget,
            exportedAt: new Date().toISOString()
        };
        const pieceSymbols = { 'r':'&#9820;','n':'&#9822;','b':'&#9821;','q':'&#9819;','k':'&#9818;','p':'&#9823;','R':'&#9814;','N':'&#9816;','B':'&#9815;','Q':'&#9813;','K':'&#9812;','P':'&#9817;' };
        let cells = '';
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const piece = this.board[row][col];
                const sym = piece ? pieceSymbols[piece] || piece : '';
                const bg = (row + col) % 2 === 0 ? '#f0d9b5' : '#b58863';
                cells += `<div style="width:50px;height:50px;display:flex;align-items:center;justify-content:center;font-size:36px;background:${bg}">${sym}</div>`;
            }
        }
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Chess snapshot - ${this.currentGame}</title></head><body style="font-family:sans-serif;padding:20px"><h1>Chess snapshot</h1><p>Game: ${this.currentGame}, Move: ${this.version}</p><div style="display:grid;grid-template-columns:repeat(8,50px);width:400px;border:2px solid #34495e">${cells}</div><pre style="margin-top:20px;font-size:12px">${JSON.stringify(snapshot, null, 2)}</pre></body></html>`;
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `chess_snapshot_${this.currentGame}_v${this.version}.html`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.showMessage('Snapshot saved as HTML file');
    }

    async syncWithPeer() {
        try {
            await this.loadGame();
            this.render();
            this.showMessage('Refreshed from server. (Push requires Beagle backend.)');
        } catch (e) {
            this.showMessage('Refresh failed: ' + (e.message || 'network error'));
        }
    }
}

// Запуск
window.chess = new SelfReplicatingChess();