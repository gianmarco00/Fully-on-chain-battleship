// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BattleshipGame {
    enum Phase {
        WaitingForPlayer,
        BoardSetup,
        Attack,
        CellReveal,
        Audit,
        Finished,
        Cancelled
    }

    uint8 public constant BOARD_WIDTH = 5;
    uint8 public constant BOARD_HEIGHT = 5;
    uint8 public constant CELL_COUNT = BOARD_WIDTH * BOARD_HEIGHT;
    uint8 public constant SHIP_COUNT = 3;

    uint64 public constant SETUP_TIMEOUT = 5 minutes;
    uint64 public constant ATTACK_TIMEOUT = 2 minutes;
    uint64 public constant REVEAL_TIMEOUT = 2 minutes;
    uint64 public constant AUDIT_TIMEOUT = 5 minutes;

    uint8 private constant PLAYER_1 = 1;
    uint8 private constant PLAYER_2 = 2;

    uint32 private constant FULL_BOARD_MASK = uint32((uint256(1) << CELL_COUNT) - 1);
    uint8 private constant MAX_PROOF_LENGTH = 8;

    struct Game {
        address player1;
        address player2;

        bytes32 boardRoot1;
        bytes32 boardRoot2;

        uint32 hitMask1;
        uint32 hitMask2;

        uint64 actionDeadline;
        uint8 pendingTarget;
        uint8 currentAttacker;
        uint8 provisionalWinner;
        uint8 winner;
        Phase phase;
    }

    uint256 public nextGameId;

    mapping(uint256 => Game) private games;

    event GameCreated(uint256 indexed gameId, address indexed player1);
    event GameJoined(uint256 indexed gameId, address indexed player2);
    event BoardCommitted(uint256 indexed gameId, address indexed player, bytes32 boardRoot);
    event CellAttacked(
        uint256 indexed gameId,
        address indexed attacker,
        address indexed defender,
        uint8 cell
    );
    event CellRevealed(
        uint256 indexed gameId,
        address indexed defender,
        uint8 cell,
        bool hit,
        uint32 defenderHitMask
    );
    event AuditStarted(uint256 indexed gameId, address indexed provisionalWinner);
    event BoardAudited(uint256 indexed gameId, address indexed player, bool valid);
    event GameFinished(uint256 indexed gameId, address winner);
    event TimeoutClaimed(uint256 indexed gameId, address indexed claimant);
    event GameCancelled(uint256 indexed gameId);

    modifier gameExists(uint256 gameId) {
        require(games[gameId].player1 != address(0), "Game does not exist");
        _;
    }

    modifier onlyPlayer(uint256 gameId) {
        Game storage game = games[gameId];

        require(
            msg.sender == game.player1 || msg.sender == game.player2,
            "Not a player"
        );

        _;
    }

    function createGame() external returns (uint256 gameId) {
        gameId = nextGameId;

        Game storage game = games[gameId];
        game.player1 = msg.sender;
        game.phase = Phase.WaitingForPlayer;

        nextGameId += 1;

        emit GameCreated(gameId, msg.sender);
    }

    function joinGame(uint256 gameId) external gameExists(gameId) {
        Game storage game = games[gameId];

        require(game.phase == Phase.WaitingForPlayer, "Game is not joinable");
        require(msg.sender != game.player1, "Creator cannot join own game");

        game.player2 = msg.sender;
        game.phase = Phase.BoardSetup;
        game.actionDeadline = _deadlineFromNow(SETUP_TIMEOUT);

        emit GameJoined(gameId, msg.sender);
    }

    function commitBoard(uint256 gameId, bytes32 boardRoot)
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.BoardSetup, "Not board setup phase");
        require(block.timestamp <= game.actionDeadline, "Setup deadline passed");
        require(boardRoot != bytes32(0), "Empty board root");

        if (msg.sender == game.player1) {
            require(game.boardRoot1 == bytes32(0), "Player 1 already committed board");
            game.boardRoot1 = boardRoot;
        } else {
            require(game.boardRoot2 == bytes32(0), "Player 2 already committed board");
            game.boardRoot2 = boardRoot;
        }

        emit BoardCommitted(gameId, msg.sender, boardRoot);

        if (game.boardRoot1 != bytes32(0) && game.boardRoot2 != bytes32(0)) {
            game.phase = Phase.Attack;
            game.currentAttacker = PLAYER_1;
            game.actionDeadline = _deadlineFromNow(ATTACK_TIMEOUT);
        }
    }

    function attackCell(uint256 gameId, uint8 cell)
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.Attack, "Not attack phase");
        require(block.timestamp <= game.actionDeadline, "Attack deadline passed");
        require(_isValidCell(cell), "Invalid cell");
        require(msg.sender == _roleAddress(game, game.currentAttacker), "Not current attacker");

        uint8 defender = _opponentRole(game.currentAttacker);
        uint32 defenderHitMask = _hitMask(game, defender);

        require(!_maskContains(defenderHitMask, cell), "Cell already hit");

        game.pendingTarget = cell;
        game.phase = Phase.CellReveal;
        game.actionDeadline = _deadlineFromNow(REVEAL_TIMEOUT);

        emit CellAttacked(
            gameId,
            msg.sender,
            _roleAddress(game, defender),
            cell
        );
    }

    function revealCell(
        uint256 gameId,
        uint8 cell,
        bool hasShip,
        bytes32 cellSalt,
        bytes32[] calldata proof
    )
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.CellReveal, "Not cell reveal phase");
        require(block.timestamp <= game.actionDeadline, "Reveal deadline passed");
        require(cell == game.pendingTarget, "Wrong cell");
        require(cellSalt != bytes32(0), "Empty cell salt");
        require(proof.length <= MAX_PROOF_LENGTH, "Proof too long");

        uint8 defender = _opponentRole(game.currentAttacker);
        require(msg.sender == _roleAddress(game, defender), "Not defender");

        bytes32 boardRoot = _boardRoot(game, defender);
        bytes32 leaf = makeBoardLeaf(gameId, msg.sender, cell, hasShip, cellSalt);

        require(_verifyProof(leaf, proof, boardRoot), "Bad cell proof");

        uint32 defenderHitMask = _hitMask(game, defender);

        if (hasShip) {
            require(!_maskContains(defenderHitMask, cell), "Cell already hit");

            defenderHitMask = _setMaskBit(defenderHitMask, cell);
            _setHitMask(game, defender, defenderHitMask);
        }

        emit CellRevealed(gameId, msg.sender, cell, hasShip, defenderHitMask);

        if (_hitCount(defenderHitMask) >= SHIP_COUNT) {
            game.provisionalWinner = game.currentAttacker;
            game.phase = Phase.Audit;
            game.actionDeadline = _deadlineFromNow(AUDIT_TIMEOUT);

            emit AuditStarted(gameId, _roleAddress(game, game.provisionalWinner));
            return;
        }

        game.currentAttacker = defender;
        game.phase = Phase.Attack;
        game.actionDeadline = _deadlineFromNow(ATTACK_TIMEOUT);
    }

    function revealFinalBoard(
        uint256 gameId,
        uint32 shipMask,
        bytes32[] calldata cellSalts
    )
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.Audit, "Not audit phase");
        require(block.timestamp <= game.actionDeadline, "Audit deadline passed");
        require(msg.sender == _roleAddress(game, game.provisionalWinner), "Not provisional winner");
        require(cellSalts.length == CELL_COUNT, "Wrong salt count");

        bool valid = _isValidFinalBoard(
            gameId,
            msg.sender,
            shipMask,
            cellSalts,
            _boardRoot(game, game.provisionalWinner)
        );

        emit BoardAudited(gameId, msg.sender, valid);

        if (valid) {
            _finishGame(gameId, game.provisionalWinner);
        } else {
            _finishGame(gameId, _opponentRole(game.provisionalWinner));
        }
    }

    function claimTimeout(uint256 gameId)
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.actionDeadline != 0, "No active deadline");
        require(block.timestamp > game.actionDeadline, "Timeout not reached");

        emit TimeoutClaimed(gameId, msg.sender);

        if (game.phase == Phase.BoardSetup) {
            _claimBoardSetupTimeout(gameId);
            return;
        }

        if (game.phase == Phase.Attack) {
            _finishGame(gameId, _opponentRole(game.currentAttacker));
            return;
        }

        if (game.phase == Phase.CellReveal) {
            _finishGame(gameId, game.currentAttacker);
            return;
        }

        if (game.phase == Phase.Audit) {
            _finishGame(gameId, _opponentRole(game.provisionalWinner));
            return;
        }

        revert("No timeout claim available");
    }

    function cancelOpenGame(uint256 gameId)
        external
        gameExists(gameId)
    {
        Game storage game = games[gameId];

        require(msg.sender == game.player1, "Only creator can cancel");
        require(game.phase == Phase.WaitingForPlayer, "Game already started");

        game.phase = Phase.Cancelled;

        emit GameCancelled(gameId);
    }

    function makeBoardLeaf(
        uint256 gameId,
        address player,
        uint8 cell,
        bool hasShip,
        bytes32 cellSalt
    )
        public
        view
        returns (bytes32)
    {
        require(_isValidCell(cell), "Invalid cell");

        return keccak256(
            abi.encodePacked(
                gameId,
                player,
                cell,
                hasShip ? uint8(1) : uint8(0),
                cellSalt,
                address(this)
            )
        );
    }

    function computeBoardRoot(
        uint256 gameId,
        address player,
        uint32 shipMask,
        bytes32[] calldata cellSalts
    )
        external
        view
        returns (bytes32)
    {
        require(cellSalts.length == CELL_COUNT, "Wrong salt count");
        return _computeBoardRoot(gameId, player, shipMask, cellSalts);
    }

    function verifyCell(
        uint256 gameId,
        address player,
        uint8 cell,
        bool hasShip,
        bytes32 cellSalt,
        bytes32[] calldata proof,
        bytes32 boardRoot
    )
        external
        view
        returns (bool)
    {
        require(proof.length <= MAX_PROOF_LENGTH, "Proof too long");

        bytes32 leaf = makeBoardLeaf(gameId, player, cell, hasShip, cellSalt);
        return _verifyProof(leaf, proof, boardRoot);
    }

    function getGame(uint256 gameId)
        external
        view
        gameExists(gameId)
        returns (
            address player1,
            address player2,
            address winner,
            Phase phase,
            address currentAttacker,
            uint8 pendingTarget,
            address provisionalWinner,
            uint64 actionDeadline
        )
    {
        Game storage game = games[gameId];

        return (
            game.player1,
            game.player2,
            _roleAddress(game, game.winner),
            game.phase,
            _roleAddress(game, game.currentAttacker),
            game.pendingTarget,
            _roleAddress(game, game.provisionalWinner),
            game.actionDeadline
        );
    }

    function getBoardRoots(uint256 gameId)
        external
        view
        gameExists(gameId)
        returns (bytes32 boardRoot1, bytes32 boardRoot2)
    {
        Game storage game = games[gameId];
        return (game.boardRoot1, game.boardRoot2);
    }

    function getHitMasks(uint256 gameId)
        external
        view
        gameExists(gameId)
        returns (
            uint32 hitMask1,
            uint32 hitMask2,
            uint8 hitCount1,
            uint8 hitCount2
        )
    {
        Game storage game = games[gameId];

        return (
            game.hitMask1,
            game.hitMask2,
            _hitCount(game.hitMask1),
            _hitCount(game.hitMask2)
        );
    }

    function _claimBoardSetupTimeout(uint256 gameId) internal {
        Game storage game = games[gameId];

        bool player1Committed = game.boardRoot1 != bytes32(0);
        bool player2Committed = game.boardRoot2 != bytes32(0);

        require(!(player1Committed && player2Committed), "Both boards committed");

        if (!player1Committed && !player2Committed) {
            game.phase = Phase.Cancelled;
            game.actionDeadline = 0;
            emit GameCancelled(gameId);
            return;
        }

        if (player1Committed) {
            _finishGame(gameId, PLAYER_1);
        } else {
            _finishGame(gameId, PLAYER_2);
        }
    }

    function _finishGame(uint256 gameId, uint8 winnerRole) internal {
        Game storage game = games[gameId];

        require(winnerRole == PLAYER_1 || winnerRole == PLAYER_2, "Invalid winner");

        game.winner = winnerRole;
        game.phase = Phase.Finished;
        game.actionDeadline = 0;

        emit GameFinished(gameId, _roleAddress(game, winnerRole));
    }

    function _isValidFinalBoard(
        uint256 gameId,
        address player,
        uint32 shipMask,
        bytes32[] calldata cellSalts,
        bytes32 expectedRoot
    )
        internal
        view
        returns (bool)
    {
        if (shipMask & ~FULL_BOARD_MASK != 0) {
            return false;
        }

        if (_hitCount(shipMask) != SHIP_COUNT) {
            return false;
        }

        for (uint8 cell = 0; cell < CELL_COUNT; cell += 1) {
            if (cellSalts[cell] == bytes32(0)) {
                return false;
            }
        }

        return _computeBoardRoot(gameId, player, shipMask, cellSalts) == expectedRoot;
    }

    function _computeBoardRoot(
        uint256 gameId,
        address player,
        uint32 shipMask,
        bytes32[] calldata cellSalts
    )
        internal
        view
        returns (bytes32)
    {
        bytes32[] memory layer = new bytes32[](CELL_COUNT);

        for (uint8 cell = 0; cell < CELL_COUNT; cell += 1) {
            bool hasShip = _maskContains(shipMask, cell);
            layer[cell] = makeBoardLeaf(gameId, player, cell, hasShip, cellSalts[cell]);
        }

        uint256 nodeCount = CELL_COUNT;

        while (nodeCount > 1) {
            uint256 nextCount = 0;

            for (uint256 i = 0; i < nodeCount; i += 2) {
                bytes32 left = layer[i];
                bytes32 right = i + 1 < nodeCount ? layer[i + 1] : left;
                layer[nextCount] = _hashPair(left, right);
                nextCount += 1;
            }

            nodeCount = nextCount;
        }

        return layer[0];
    }

    function _verifyProof(
        bytes32 leaf,
        bytes32[] calldata proof,
        bytes32 root
    )
        internal
        pure
        returns (bool)
    {
        bytes32 computed = leaf;

        for (uint256 i = 0; i < proof.length; i += 1) {
            computed = _hashPair(computed, proof[i]);
        }

        return computed == root;
    }

    function _hashPair(bytes32 left, bytes32 right) internal pure returns (bytes32) {
        return left < right
            ? keccak256(abi.encodePacked(left, right))
            : keccak256(abi.encodePacked(right, left));
    }

    function _hitCount(uint32 mask) internal pure returns (uint8 count) {
        while (mask != 0) {
            mask &= mask - 1;
            count += 1;
        }
    }

    function _isValidCell(uint8 cell) internal pure returns (bool) {
        return cell < CELL_COUNT;
    }

    function _maskContains(uint32 mask, uint8 cell) internal pure returns (bool) {
        return (mask & (uint32(1) << cell)) != 0;
    }

    function _setMaskBit(uint32 mask, uint8 cell) internal pure returns (uint32) {
        return mask | (uint32(1) << cell);
    }

    function _deadlineFromNow(uint64 duration) internal view returns (uint64) {
        return uint64(block.timestamp) + duration;
    }

    function _opponentRole(uint8 role) internal pure returns (uint8) {
        if (role == PLAYER_1) return PLAYER_2;
        if (role == PLAYER_2) return PLAYER_1;

        revert("Invalid role");
    }

    function _boardRoot(Game storage game, uint8 role) internal view returns (bytes32) {
        if (role == PLAYER_1) return game.boardRoot1;
        if (role == PLAYER_2) return game.boardRoot2;

        revert("Invalid role");
    }

    function _hitMask(Game storage game, uint8 role) internal view returns (uint32) {
        if (role == PLAYER_1) return game.hitMask1;
        if (role == PLAYER_2) return game.hitMask2;

        revert("Invalid role");
    }

    function _setHitMask(Game storage game, uint8 role, uint32 hitMask) internal {
        if (role == PLAYER_1) {
            game.hitMask1 = hitMask;
            return;
        }

        if (role == PLAYER_2) {
            game.hitMask2 = hitMask;
            return;
        }

        revert("Invalid role");
    }

    function _roleAddress(Game storage game, uint8 role) internal view returns (address) {
        if (role == PLAYER_1) return game.player1;
        if (role == PLAYER_2) return game.player2;

        return address(0);
    }
}
