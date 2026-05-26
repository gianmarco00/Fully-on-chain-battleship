// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract GameLobby {
    enum Phase {
        WaitingForPlayer,
        Ready
    }

    struct Game {
        address player1;
        address player2;
        Phase phase;
    }

    uint256 public nextGameId;

    mapping(uint256 => Game) public games;

    event GameCreated(uint256 indexed gameId, address indexed player1);
    event GameJoined(uint256 indexed gameId, address indexed player2);

    function createGame() external returns (uint256) {
        uint256 gameId = nextGameId;

        games[gameId] = Game({
            player1: msg.sender,
            player2: address(0),
            phase: Phase.WaitingForPlayer
        });

        nextGameId += 1;

        emit GameCreated(gameId, msg.sender);

        return gameId;
    }

    function joinGame(uint256 gameId) external {
        Game storage game = games[gameId];

        require(game.player1 != address(0), "Game does not exist");
        require(game.phase == Phase.WaitingForPlayer, "Game is not joinable");
        require(game.player1 != msg.sender, "Creator cannot join own game");

        game.player2 = msg.sender;
        game.phase = Phase.Ready;

        emit GameJoined(gameId, msg.sender);
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player1,
            address player2,
            Phase phase
        )
    {
        Game storage game = games[gameId];
        return (game.player1, game.player2, game.phase);
    }
}