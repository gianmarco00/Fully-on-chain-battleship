// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CommitRevealRPS {
    enum Phase {
        WaitingForPlayer,
        Commit,
        Reveal,
        Finished
    }

    enum Move {
        Rock,
        Paper,
        Scissors
    }

    struct Game {
        address player1;
        address player2;

        Phase phase;

        bytes32 commitment1;
        bytes32 commitment2;

        bool revealed1;
        bool revealed2;

        Move move1;
        Move move2;

        address winner;
    }

    uint256 public nextGameId;
    mapping(uint256 => Game) public games;

    event GameCreated(uint256 indexed gameId, address indexed player1);
    event GameJoined(uint256 indexed gameId, address indexed player2);

    event MoveCommitted(uint256 indexed gameId, address indexed player);
    event MoveRevealed(uint256 indexed gameId, address indexed player, Move move);

    event GameFinished(uint256 indexed gameId, address winner, bool draw);

    modifier onlyPlayer(uint256 gameId) {
        Game storage game = games[gameId];
        require(
            msg.sender == game.player1 || msg.sender == game.player2,
            "Not a player"
        );
        _;
    }

    function createGame() external returns (uint256) {
        uint256 gameId = nextGameId;

        games[gameId].player1 = msg.sender;
        games[gameId].phase = Phase.WaitingForPlayer;

        nextGameId += 1;

        emit GameCreated(gameId, msg.sender);

        return gameId;
    }

    function joinGame(uint256 gameId) external {
        Game storage game = games[gameId];

        require(game.player1 != address(0), "Game does not exist");
        require(game.phase == Phase.WaitingForPlayer, "Game is not joinable");
        require(msg.sender != game.player1, "Creator cannot join own game");

        game.player2 = msg.sender;
        game.phase = Phase.Commit;

        emit GameJoined(gameId, msg.sender);
    }

    function makeCommitment(
        uint8 move,
        bytes32 salt,
        address player,
        uint256 gameId
    ) public view returns (bytes32) {
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

    function commitMove(uint256 gameId, bytes32 commitment)
        external
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.Commit, "Not commit phase");
        require(commitment != bytes32(0), "Empty commitment");

        if (msg.sender == game.player1) {
            require(game.commitment1 == bytes32(0), "Player 1 already committed");
            game.commitment1 = commitment;
        } else {
            require(game.commitment2 == bytes32(0), "Player 2 already committed");
            game.commitment2 = commitment;
        }

        emit MoveCommitted(gameId, msg.sender);

        if (
            game.commitment1 != bytes32(0) &&
            game.commitment2 != bytes32(0)
        ) {
            game.phase = Phase.Reveal;
        }
    }

    function revealMove(
        uint256 gameId,
        uint8 move,
        bytes32 salt
    )
        external
        onlyPlayer(gameId)
    {
        Game storage game = games[gameId];

        require(game.phase == Phase.Reveal, "Not reveal phase");
        require(move <= uint8(Move.Scissors), "Invalid move");

        bytes32 expectedCommitment = makeCommitment(
            move,
            salt,
            msg.sender,
            gameId
        );

        if (msg.sender == game.player1) {
            require(!game.revealed1, "Player 1 already revealed");
            require(expectedCommitment == game.commitment1, "Bad reveal");

            game.move1 = Move(move);
            game.revealed1 = true;
        } else {
            require(!game.revealed2, "Player 2 already revealed");
            require(expectedCommitment == game.commitment2, "Bad reveal");

            game.move2 = Move(move);
            game.revealed2 = true;
        }

        emit MoveRevealed(gameId, msg.sender, Move(move));

        if (game.revealed1 && game.revealed2) {
            _finishGame(gameId);
        }
    }

    function _finishGame(uint256 gameId) internal {
        Game storage game = games[gameId];

        require(game.phase == Phase.Reveal, "Not reveal phase");
        require(game.revealed1 && game.revealed2, "Both players not revealed");

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

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player1,
            address player2,
            Phase phase,
            address winner
        )
    {
        Game storage game = games[gameId];
        return (
            game.player1,
            game.player2,
            game.phase,
            game.winner
        );
    }

    function getCommitments(uint256 gameId)
        external
        view
        returns (bytes32 commitment1, bytes32 commitment2)
    {
        Game storage game = games[gameId];
        return (game.commitment1, game.commitment2);
    }

    function getReveals(uint256 gameId)
        external
        view
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
}