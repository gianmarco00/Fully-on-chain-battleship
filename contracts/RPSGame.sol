// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RPSGame {
    enum Phase {
        WaitingForPlayer,
        Commit,
        Reveal,
        Finished,
        Cancelled
    }

    enum Move {
        Rock,
        Paper,
        Scissors
    }

    struct Game {
        address player1;
        address player2;
        address winner;

        bytes32 commitment1;
        bytes32 commitment2;

        uint64 commitDeadline;
        uint64 revealDeadline;

        Phase phase;

        bool revealed1;
        bool revealed2;

        Move move1;
        Move move2;
    }

    uint64 public constant COMMIT_TIMEOUT = 45;
    uint64 public constant REVEAL_TIMEOUT = 45;

    uint256 public nextGameId;

    mapping(uint256 => Game) private games;

    event GameCreated(uint256 indexed gameId, address indexed player1);
    event GameJoined(uint256 indexed gameId, address indexed player2);
    event MoveCommitted(uint256 indexed gameId, address indexed player);
    event MoveRevealed(uint256 indexed gameId, address indexed player, Move move);
    event GameFinished(uint256 indexed gameId, address winner, bool draw);
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
        game.phase = Phase.Commit;
        game.commitDeadline = uint64(block.timestamp) + COMMIT_TIMEOUT;

        emit GameJoined(gameId, msg.sender);
    }

    function commitMove(uint256 gameId, bytes32 commitment)
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.Commit, "Not commit phase");
        require(block.timestamp <= game.commitDeadline, "Commit deadline passed");
        require(commitment != bytes32(0), "Empty commitment");

        if (msg.sender == game.player1) {
            require(game.commitment1 == bytes32(0), "Player 1 already committed");
            game.commitment1 = commitment;
        } else {
            require(game.commitment2 == bytes32(0), "Player 2 already committed");
            game.commitment2 = commitment;
        }

        emit MoveCommitted(gameId, msg.sender);

        if (game.commitment1 != bytes32(0) && game.commitment2 != bytes32(0)) {
            game.phase = Phase.Reveal;
            game.revealDeadline = uint64(block.timestamp) + REVEAL_TIMEOUT;
        }
    }

    function revealMove(
        uint256 gameId,
        uint8 move,
        bytes32 salt
    )
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.Reveal, "Not reveal phase");
        require(block.timestamp <= game.revealDeadline, "Reveal deadline passed");
        require(move <= uint8(Move.Scissors), "Invalid move");

        bytes32 expected = makeCommitment(move, salt, msg.sender, gameId);

        if (msg.sender == game.player1) {
            require(!game.revealed1, "Player 1 already revealed");
            require(expected == game.commitment1, "Bad reveal");

            game.move1 = Move(move);
            game.revealed1 = true;
        } else {
            require(!game.revealed2, "Player 2 already revealed");
            require(expected == game.commitment2, "Bad reveal");

            game.move2 = Move(move);
            game.revealed2 = true;
        }

        emit MoveRevealed(gameId, msg.sender, Move(move));

        if (game.revealed1 && game.revealed2) {
            _finishGame(gameId);
        }
    }

    function claimTimeout(uint256 gameId)
        external
        gameExists(gameId)
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        if (game.phase == Phase.Commit) {
            _claimCommitTimeout(gameId);
            return;
        }

        if (game.phase == Phase.Reveal) {
            _claimRevealTimeout(gameId);
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

    function makeCommitment(
        uint8 move,
        bytes32 salt,
        address player,
        uint256 gameId
    )
        public
        view
        returns (bytes32)
    {
        require(move <= uint8(Move.Scissors), "Invalid move");

        return keccak256(
            abi.encodePacked(
                move,
                salt,
                player,
                gameId,
                address(this)
            )
        );
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
            uint64 commitDeadline,
            uint64 revealDeadline
        )
    {
        Game storage game = games[gameId];

        return (
            game.player1,
            game.player2,
            game.winner,
            game.phase,
            game.commitDeadline,
            game.revealDeadline
        );
    }

    function getCommitments(uint256 gameId)
        external
        view
        gameExists(gameId)
        returns (bytes32 commitment1, bytes32 commitment2)
    {
        Game storage game = games[gameId];
        return (game.commitment1, game.commitment2);
    }

    function getReveals(uint256 gameId)
        external
        view
        gameExists(gameId)
        returns (
            bool revealed1,
            bool revealed2,
            Move move1,
            Move move2
        )
    {
        Game storage game = games[gameId];

        return (
            game.revealed1,
            game.revealed2,
            game.move1,
            game.move2
        );
    }

    function _claimCommitTimeout(uint256 gameId) internal {
        Game storage game = games[gameId];

        require(block.timestamp > game.commitDeadline, "Commit timeout not reached");

        bool player1Committed = game.commitment1 != bytes32(0);
        bool player2Committed = game.commitment2 != bytes32(0);

        require(!(player1Committed && player2Committed), "Both players committed");

        if (!player1Committed && !player2Committed) {
            game.phase = Phase.Cancelled;
            emit TimeoutClaimed(gameId, msg.sender);
            emit GameCancelled(gameId);
            return;
        }

        game.phase = Phase.Finished;

        if (player1Committed) {
            game.winner = game.player1;
        } else {
            game.winner = game.player2;
        }

        emit TimeoutClaimed(gameId, msg.sender);
        emit GameFinished(gameId, game.winner, false);
    }

    function _claimRevealTimeout(uint256 gameId) internal {
        Game storage game = games[gameId];

        require(block.timestamp > game.revealDeadline, "Reveal timeout not reached");
        require(game.revealed1 != game.revealed2, "No reveal timeout winner");

        game.phase = Phase.Finished;

        if (game.revealed1) {
            game.winner = game.player1;
        } else {
            game.winner = game.player2;
        }

        emit TimeoutClaimed(gameId, msg.sender);
        emit GameFinished(gameId, game.winner, false);
    }

    function _finishGame(uint256 gameId) internal {
        Game storage game = games[gameId];

        game.phase = Phase.Finished;

        bool draw = false;

        if (game.move1 == game.move2) {
            game.winner = address(0);
            draw = true;
        } else if ((uint8(game.move1) + 1) % 3 == uint8(game.move2)) {
            game.winner = game.player2;
        } else {
            game.winner = game.player1;
        }

        emit GameFinished(gameId, game.winner, draw);
    }
}