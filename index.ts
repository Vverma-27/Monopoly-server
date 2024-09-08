//@ts-nocheck
import express from "express";
import http from "http";
import { nanoid } from "nanoid";
import { Server, Socket } from "socket.io";
import { DEFAULT_POSITIONS_STATE, PROPERTIES } from "./constants/properties";
import assert from "assert";

interface CustomSocket extends Socket {
  clientName: string; // Define your custom property here
}

enum PlayerToken {
  NA = "",
  CAT = "CAT",
  THIMBLE = "THIMBLE",
  WHEELBARROW = "WHEELBARROW",
  DOG = "DOG",
  TOP_HAT = "TOP_HAT",
}

interface IPlayerState {
  name: string;
  id: string;
  playerCurrPosition: number;
  playerMoney: number;
  playerProperties: Array<{ name: string; numHouses: number; Hotel: boolean }>;
  playerUtilities: Array<string>;
  playerRailroads: Array<string>;
  playerMortgagedProperties: Array<string>;
  inJail: boolean;
  turnsInJail: number;
  playerToken: PlayerToken;
}

type Marketplace = Array<{
  name: string;
  askingPrice: number;
  autoSellAbove?: number;
  owner: string;
  ownerSocketId: string;
}>;

interface IAuction {
  property: { name: string; price: number };
  bids: (number | "out")[];
  currTurn: string;
}

interface IGameState {
  active: boolean;
  gameId: string;
  activeProperty: string | null;
  playerStates: IPlayerState[];
  marketPlace: Marketplace;
  // auctionProperty: string;
  currentAuction: IAuction;
  currTurn: string;
  host: string;
  propertyStates: {
    [name: string]: {
      ownedBy: string;
      numHouses?: number;
      Hotel?: boolean;
      mortgaged: boolean;
    };
  };
}

const DEFAULT_STATE: IGameState = {
  active: false,
  currTurn: "",
  gameId: "",
  marketPlace: [],
  currentAuction: {
    property: {
      name: "",
      price: 0,
    },
    bids: [],
    currTurn: "",
  },
  //   playerCurrPosition: 0,
  //   playerMoney: 2000,
  //   playerProperties: [],
  //   playerUtilities: [],
  //   playerRailroads: [],
  //   playerMortgagedProperties: [],
  //   playerTurn: true,
  playerStates: [],
  host: "",
  activeProperty: null,
  propertyStates: DEFAULT_POSITIONS_STATE,
  //   inJail: false,
  //   turnsInJail: 0,
};
type Offer = (
  | {
      type: "buy";
      offerPrice: number;
    }
  | {
      type: "trade";
      offer: {
        properties: Array<{ name: string; price: number }>;
        railroads: Array<{ name: string; price: number }>;
        utilities: Array<{ name: string; price: number }>;
        money: number;
      };
    }
) & {
  from: string;
  property: string;
  fromSocketId: string;
  id: string;
  to: string;
};
const offers: { [key: string]: Offer[] } = {};
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const gameStates: { [key: string]: IGameState } = {};

// Socket.IO event handlers
let i = 0;
io.on("connection", (socket: CustomSocket) => {
  //   console.log("🚀 ~ io.on ~ socket:", socket.id);
  const query = socket.handshake.query as { [key: string]: string };
  const { name } = query;
  if (!name) return socket.disconnect();
  socket.clientName = name;
  socket.on("join-game", (roomNo: string, cb) => {
    if (!gameStates[roomNo]) {
      cb({ error: "Room does not exist" });
      return;
    }
    if (gameStates[roomNo].playerStates.length === 5) {
      cb({ error: "Room is full" });
      return;
    }
    if ([...socket.rooms].length === 2) {
      cb({ error: "You are already in a game" });
      return;
    }
    socket.join(roomNo);
    console.log(`User ${name} joined room ${roomNo}`);
    const newPlayer: IPlayerState = {
      name,
      id: socket.id,
      playerCurrPosition: 0,
      playerMoney: 2000,
      playerProperties: [],
      playerUtilities: [],
      playerRailroads: [],
      playerMortgagedProperties: [],
      inJail: false,
      turnsInJail: 0,
      playerToken: PlayerToken.NA,
    };
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      playerStates: [...gameStates[roomNo].playerStates, newPlayer],
    };
    socket.to(roomNo).emit("player-join", { newPlayer });
    cb({ state: gameStates[roomNo], cUserId: socket.id });
  });
  socket.on("cancel-game", (roomNo, cb) => {
    console.log(`User ${name} cancelled room ${roomNo}`);
    delete gameStates[roomNo];
    socket.to(roomNo).emit("game-cancel");
    const room = io.sockets.adapter.rooms.get(roomNo);
    if (room) {
      // Make each socket leave the room
      for (const socketId of room) {
        const clientSocket = io.sockets.sockets.get(socketId);
        if (clientSocket) {
          clientSocket.leave(roomNo);
        }
      }
    }
    cb({ success: true });
  });
  socket.on(
    "trade-offer-sent",
    (
      {
        to,
        offer,
        property,
      }: {
        to: string;
        offer: {
          properties: Array<string>;
          railroads: Array<string>;
          utilities: Array<string>;
          money: number;
        };
        property: string;
      },
      cb
    ) => {
      const roomNo = [...socket.rooms][1];
      const playerState = gameStates[roomNo].playerStates.find(
        (player) => player.id === socket.id
      ) as IPlayerState;
      if (playerState.playerMoney < offer.money) {
        cb({ error: "Insufficient money" });
        return;
      }
      const playerItemsMap = {
        properties: playerState.playerProperties.map((item) => item.name),
        railroads: playerState.playerRailroads,
        utilities: playerState.playerUtilities,
      };
      const allExist = ["properties", "railroads", "utilities"].every(
        (type, _b, arr) =>
          offer[type].every((e) => playerItemsMap[type].includes(e))
      );
      if (!allExist) {
        cb({ error: "Invalid properties" });
        return;
      }
      const mapOfferItems = (items: Array<string>) => {
        return items.map((item) => ({
          name: item,
          price: (PROPERTIES.find((e) => e.Name === item) as { Price: number })
            .Price,
        }));
      };

      const mappedOffer = {
        properties: mapOfferItems(offer.properties),
        railroads: mapOfferItems(offer.railroads),
        utilities: mapOfferItems(offer.utilities),
        money: offer.money,
      };
      const offerObj: Offer = {
        id: nanoid(),
        from: name,
        fromSocketId: socket.id,
        offer: mappedOffer,
        property,
        type: "trade",
      };
      offers[roomNo] = [...offers[roomNo], offerObj];
      cb({ success: true });
      io.to(to).emit("trade-offer-received", {
        from: offerObj["from"],
        offer: offerObj["offer"],
        property: offerObj["property"],
        id: offerObj["id"],
        type: "trade",
      });
    }
  );
  socket.on(
    "list-on-marketplace",
    (
      {
        property,
        askingPrice,
        autoSellAbove,
      }: { property: string; askingPrice: number; autoSellAbove?: number },
      cb
    ) => {
      const roomNo = [...socket.rooms][1];
      const propertyState = gameStates[roomNo].propertyStates[property];
      if (propertyState.ownedBy !== name) {
        cb({ error: "You do not own this property" });
        return;
      }
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        marketPlace: [
          ...gameStates[roomNo].marketPlace.filter((e) => e.name !== property),
          {
            name: property,
            askingPrice,
            owner: name,
            ownerSocketId: socket.id,
            autoSellAbove,
          },
        ],
      };
      cb({ success: true, marketPlace: gameStates[roomNo].marketPlace });
      socket.to(roomNo).emit("marketplace-listed", {
        marketPlace: gameStates[roomNo].marketPlace,
      });
    }
  );
  socket.on("token-select", (token) => {
    const roomNo = [...socket.rooms][1];
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      playerStates: gameStates[roomNo].playerStates.map((player) => {
        if (player.id === socket.id) {
          return {
            ...player,
            playerToken: token,
          };
        }
        return player;
      }),
    };
    socket.to(roomNo).emit("token-select", { id: socket.id, token });
  });
  socket.on("start-game", () => {
    const roomNo = [...socket.rooms][1];
    offers[roomNo] = [];
    const playerTokens = gameStates[roomNo].playerStates.map(
      (ps) => ps.playerToken
    );
    const ALL_TOKENS = Object.values(PlayerToken).filter(
      (token) => token !== PlayerToken.NA
    );
    const freePlayerTokens = ALL_TOKENS.filter(
      (token) => !playerTokens.includes(token)
    );
    const newPlayerStates =
      playerTokens.length ===
      playerTokens.filter((pt) => pt !== PlayerToken.NA).length
        ? [...gameStates[roomNo].playerStates]
        : [
            ...gameStates[roomNo].playerStates.map((ps, i) => {
              if (ps.playerToken === PlayerToken.NA) {
                return {
                  ...ps,
                  playerToken: freePlayerTokens[i],
                };
              }
              return ps;
            }),
          ];
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      playerStates: newPlayerStates,
      active: true,
    };
    io.to(roomNo).emit("game-started", { state: gameStates[roomNo] });
  });
  socket.on("joined", () => {
    const roomNo = [...socket.rooms][1];
    socket.broadcast.to(roomNo).emit("joined", { socketId: socket.id });
  });
  socket.on("offer", (data) => {
    console.log("🚀 ~ socket.on ~ data:", data);
    socket.to(data.socketId).emit("offer", { ...data, socketId: socket.id });
  });

  socket.on("answer", (data) => {
    console.log("🚀 ~ socket.on ~ data:", data);
    socket.to(data.socketId).emit("answer", { ...data, socketId: socket.id });
  });

  socket.on("candidate", (data) => {
    console.log("🚀 ~ socket.on ~ data:", data);
    socket
      .to(data.socketId)
      .emit("candidate", { ...data, socketId: socket.id });
  });
  // socket.on("offer", (data) => {
  //   console.log("Offer received:", data);
  //   socket.to(data.target).emit("offer", {
  //     sender: socket.id,
  //     offer: data.offer,
  //   });
  // });

  socket.on("start-auction", (cb) => {
    const roomNo = [...socket.rooms][1];
    const property = gameStates[roomNo].activeProperty as string;
    const propertyDetails = PROPERTIES.find((e) => e.Name === property);
    const propertyState = gameStates[roomNo].propertyStates[property];
    if (propertyState.ownedBy) {
      cb({ error: "Someone already owns this property" });
      return;
    }
    const currentAuction = {
      property: {
        name: property,
        price: propertyDetails?.Price || 0,
      },
      bids: [],
      currTurn: gameStates[roomNo].playerStates[0].name,
    };
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      currentAuction,
    };
    io.to(roomNo).emit("auction", { auction: currentAuction });
  });

  socket.on("send-bid", ({ bid }: { bid: number }, cb) => {
    const roomNo = [...socket.rooms][1];
    const playerState = gameStates[roomNo].playerStates.find(
      (player) => player.id === socket.id
    ) as IPlayerState;
    if (playerState.playerMoney < bid) {
      cb({ error: "Insufficient money" });
      return;
    }
    const names = gameStates[roomNo].playerStates.map((player) => player.name);
    const index = names.indexOf(name);
    // setBids((prevBids) => {
    gameStates[roomNo].currentAuction.bids[index] = bid;
    gameStates[roomNo].currentAuction.currTurn =
      gameStates[roomNo].playerStates[(index + 1) % names.length].name;
    // });
    const remainingPlayers = gameStates[roomNo].currentAuction.bids.filter(
      (bid) => bid !== "out"
    );
    if (
      (remainingPlayers.length === 1 &&
        gameStates[roomNo].currentAuction.bids.length > 1) ||
      gameStates[roomNo].playerStates.length === 1
    ) {
      const winnerIndex = gameStates[roomNo].currentAuction.bids.indexOf(
        remainingPlayers[0]
      );
      const winningBid = gameStates[roomNo].currentAuction.bids[winnerIndex];
      const winner = gameStates[roomNo].playerStates[winnerIndex];
      const property = gameStates[roomNo].currentAuction.property.name;
      const propertyDetails = PROPERTIES.find(
        (e) => e.Name === property
      ) as any;
      const type =
        propertyDetails.type === "Property"
          ? "Properties"
          : propertyDetails.type === "Utility"
          ? "Utilities"
          : "Railroads";
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        propertyStates: {
          ...gameStates[roomNo].propertyStates,
          [property]: {
            ...gameStates[roomNo].propertyStates[property],
            ownedBy: winner.name,
          },
        },
        currentAuction: {
          property: {
            name: "",
            price: 0,
          },
          bids: [],
          currTurn: "",
        },
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.name === winner.name) {
            return {
              ...player,
              playerMoney:
                player.playerMoney -
                +gameStates[roomNo].currentAuction.bids[winnerIndex],
              ["player" + type]: [
                ...player["player" + type],
                type === "Properties"
                  ? {
                      name: property,
                      numHouses: 0,
                      Hotel: false,
                    }
                  : property,
              ],
            };
          }
          return player;
        }),
      };
      io.to(roomNo).emit("auction-end", {
        winner: winner.name,
        property,
        price: winningBid,
      });
    } else
      io.to(roomNo).emit("auction", {
        auction: gameStates[roomNo].currentAuction,
      });
  });

  socket.on("player-stand", () => {
    const roomNo = [...socket.rooms][1];
    const names = gameStates[roomNo].playerStates.map((player) => player.name);
    const index = names.indexOf(name);
    // setBids((prevBids) => {
    gameStates[roomNo].currentAuction.bids[index] = "out";
    gameStates[roomNo].currentAuction.currTurn =
      gameStates[roomNo].playerStates[(index + 1) % names.length].name;
    const remainingPlayers = gameStates[roomNo].currentAuction.bids.filter(
      (bid) => bid !== "out" && bid !== undefined
    );
    if (remainingPlayers.length === 1) {
      const winnerIndex = gameStates[roomNo].currentAuction.bids.indexOf(
        remainingPlayers[0]
      );
      const winningBid = gameStates[roomNo].currentAuction.bids[winnerIndex];
      const winner = gameStates[roomNo].playerStates[winnerIndex];
      const property = gameStates[roomNo].currentAuction.property.name;
      const propertyDetails = PROPERTIES.find(
        (e) => e.Name === property
      ) as any;
      const type =
        propertyDetails.type === "Property"
          ? "Properties"
          : propertyDetails.type === "Utility"
          ? "Utilities"
          : "Railroads";
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        propertyStates: {
          ...gameStates[roomNo].propertyStates,
          [property]: {
            ...gameStates[roomNo].propertyStates[property],
            ownedBy: winner.name,
          },
        },
        currentAuction: {
          property: {
            name: "",
            price: 0,
          },
          bids: [],
          currTurn: "",
        },
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.name === winner.name) {
            return {
              ...player,
              playerMoney:
                player.playerMoney -
                +gameStates[roomNo].currentAuction.bids[winnerIndex],
              ["player" + type]: [
                ...player["player" + type],
                type === "Properties"
                  ? {
                      name: property,
                      numHouses: 0,
                      Hotel: false,
                    }
                  : property,
              ],
            };
          }
          return player;
        }),
      };
      io.to(roomNo).emit("auction-end", {
        winner: winner.name,
        property,
        price: winningBid,
      });
    }
    // });
    else
      io.to(roomNo).emit("auction", {
        auction: gameStates[roomNo].currentAuction,
      });
  });

  // socket.on("answer", (data) => {
  //   console.log("Answer received:", data);
  //   socket.to(data.target).emit("answer", {
  //     sender: socket.id,
  //     answer: data.answer,
  //   });
  // });

  // socket.on("candidate", (data) => {
  //   console.log("ICE candidate received:", data);
  //   socket.to(data.target).emit("candidate", {
  //     sender: socket.id,
  //     candidate: data.candidate,
  //   });
  // });

  socket.on("rolled-dice", (cb) => {
    const roomNo = [...socket.rooms][1];
    const roll = Math.floor(Math.random() * 6) + 1;
    // const roll = [4, 4, 4, 4][i % 4];
    // const roll = 3;
    // const rolls = [5, 5, 3, 3];
    cb(roll);
    socket.to(roomNo).emit("rolled-dice", { roll });
    i += 1;
  });
  socket.on("dice-roll-finish", (roll: number) => {
    const roomNo = [...socket.rooms][1];
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      playerStates: gameStates[roomNo].playerStates.map((player) => {
        if (player.id === gameStates[roomNo].currTurn) {
          {
            // if (prev) {
            let newPosition = player.playerCurrPosition + roll;
            let inJail = false;
            if (newPosition > 31) {
              newPosition = newPosition - 32;
            }
            if (newPosition === 8) {
              io.to(roomNo).emit("sent-to-jail", { name: player.name });
              newPosition = 16;
              inJail = true;
            }
            return {
              ...player,
              playerCurrPosition: newPosition,
              playerMoney: player.playerMoney + (newPosition === 0 ? 2000 : 0),
              inJail,
            };
            // }
          }
        }
        return player;
      }),
    };
    const { playerCurrPosition: position, name } = gameStates[
      roomNo
    ].playerStates.find(
      (ps) => ps.id === gameStates[roomNo].currTurn
    ) as IPlayerState;
    console.log("🚀 ~ socket.on ~ position:", position);
    let activeProperty =
      position !== 0 && position !== 8 && position !== 16 && position !== 24
        ? PROPERTIES[position || 0].Name
        : "";
    if (activeProperty) {
      const propertyState = gameStates[roomNo].propertyStates[activeProperty];
      const propertyDetails: any = PROPERTIES.find(
        (property) => property.Name === activeProperty
      );
      const owned = propertyState.ownedBy === name;
      if (propertyState.ownedBy && !owned) {
        let currentRent;
        if (propertyDetails.type === "Property") {
          currentRent = propertyState.Hotel
            ? propertyDetails.RentHotel
            : propertyState.numHouses === 0
            ? propertyDetails.Rent
            : propertyDetails[`Rent${propertyState.numHouses}Houses`];
        } else if (propertyDetails.type === "Utility") {
          const ownedUtilities = (
            gameStates[roomNo].playerStates.find(
              (player) => player.name === propertyState.ownedBy
            ) as IPlayerState
          ).playerUtilities;
          currentRent = ownedUtilities.length === 1 ? 4 * roll : 10 * roll;
        } else if (propertyDetails.type === "Railroad") {
          const ownedRailroads = (
            gameStates[roomNo].playerStates.find(
              (player) => player.name === propertyState.ownedBy
            ) as IPlayerState
          ).playerRailroads;
          const count = ownedRailroads.length;
          currentRent =
            count === 1 ? 25 : count === 2 ? 50 : count === 3 ? 100 : 200;
        }
        // toast.error(`You paid $${currentRent} to ${propertyState.ownedBy}`);
        // payRent(currentRent);
        io.to(roomNo).emit("paid-rent", {
          to: propertyState.ownedBy,
          from: name,
          amount: currentRent,
        });
        gameStates[roomNo] = {
          ...gameStates[roomNo],
          playerStates: gameStates[roomNo].playerStates.map((ps) => {
            if (ps.name === name)
              return { ...ps, playerMoney: ps.playerMoney - currentRent };
            else if (ps.name === propertyState.ownedBy)
              return { ...ps, playerMoney: ps.playerMoney + currentRent };
            else return ps;
          }),
        };
        // setActiveProperty("");
        activeProperty = "";
        // return null;
      }
      if (owned && propertyDetails.type !== "Property") {
        // setActiveProperty("");
        activeProperty = "";
        // return null;
      }
    }
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      activeProperty,
    };
    io.to(roomNo).emit("dice-roll-finish", {
      playerState: gameStates[roomNo].playerStates.find(
        (player) => player.id === gameStates[roomNo].currTurn
      ),
    });
    if (
      position !== 0 &&
      position !== 8 &&
      position !== 16 &&
      position !== 24 &&
      gameStates[roomNo].activeProperty
    ) {
      io.to(roomNo).emit("set-active-property", activeProperty);
    } else {
      let nextTurn = gameStates[roomNo].playerStates[
        (gameStates[roomNo].playerStates.findIndex(
          (player) => player.id === gameStates[roomNo].currTurn
        ) +
          1) %
          gameStates[roomNo].playerStates.length
      ] as IPlayerState;
      const chanceSkipped = {};
      while (nextTurn.inJail) {
        chanceSkipped[nextTurn.name] = (chanceSkipped[nextTurn.name] || 0) + 1;
        gameStates[roomNo] = {
          ...gameStates[roomNo],
          playerStates: gameStates[roomNo].playerStates.map((player) => {
            if (player.id === nextTurn.id) {
              return {
                ...player,
                turnsInJail:
                  player.turnsInJail === 2 ? 0 : player.turnsInJail + 1,
                inJail: player.turnsInJail === 2 ? false : player.inJail,
              };
            }
            return player;
          }),
        };
        nextTurn = gameStates[roomNo].playerStates[
          (gameStates[roomNo].playerStates.findIndex(
            (player) => player.id === nextTurn.id
          ) +
            1) %
            gameStates[roomNo].playerStates.length
        ] as IPlayerState;
      }
      Object.keys(chanceSkipped).forEach((name) => {
        io.to(roomNo).emit("chance-skipped", {
          chances: chanceSkipped[name],
          name,
        });
      });
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        currTurn: nextTurn.id,
      };
      io.to(roomNo).emit("round-end", { state: gameStates[roomNo] });
    }
  });
  socket.on(
    "send-buy-offer",
    (
      {
        property,
        offerPrice,
        to,
      }: { property: string; offerPrice: number; to: string },
      cb
    ) => {
      const roomNo = [...socket.rooms][1];
      const currPlayer = gameStates[roomNo].playerStates.find(
        (player) => player.name === name
      ) as IPlayerState;
      const propertyState = gameStates[roomNo].propertyStates[property];
      if (propertyState.ownedBy === name) {
        cb({ error: "You already own this property" });
        return;
      }
      if (currPlayer.playerMoney < offerPrice) {
        cb({ error: "Insufficient money" });
        return;
      }
      if (offerPrice < 0) {
        cb({ error: "Invalid amount" });
        return;
      }
      const offer: Offer = {
        from: name,
        fromSocketId: socket.id,
        offerPrice,
        property,
        id: nanoid(6),
        type: "buy",
        to,
      };
      offers[roomNo] = [...offers[roomNo], offer];
      cb({ success: true });
      io.to(to).emit("buy-offer-received", {
        from: offer["from"],
        offerPrice: offer["offerPrice"],
        property: offer["property"],
        id: offer["id"],
        type: "buy",
      });
    }
  );
  socket.on("accept-buy-offer", (id, cb) => {
    const roomNo = [...socket.rooms][1];
    const offer = offers[roomNo].find((offer) => offer.id === id) as Offer;
    offers[roomNo] = [...offers[roomNo].filter((of) => of.id !== id)];
    offers[roomNo] = [
      ...offers[roomNo].filter((of) => of.property !== offer.property),
    ];
    assert(offer.type === "buy");
    const propType = PROPERTIES.find((e) => e.Name === offer.property)
      ?.type as string;
    const propertyState = gameStates[roomNo].propertyStates[offer.property];
    const type =
      propType === "Property"
        ? "Properties"
        : propType === "Utility"
        ? "Utilities"
        : "Railroads";
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      propertyStates: {
        ...gameStates[roomNo].propertyStates,
        [offer.property]: {
          ...propertyState,
          ownedBy: offer.from,
        },
      },
      marketPlace: [
        ...gameStates[roomNo].marketPlace.filter(
          (e) => e.name !== offer.property
        ),
      ],
      playerStates: gameStates[roomNo].playerStates.map((player) => {
        if (player.name === offer.from) {
          return {
            ...player,
            playerMoney: player.playerMoney - offer.offerPrice,
            ["player" + type]: [
              ...player["player" + type],
              type === "Properties"
                ? {
                    numHouses: propertyState.numHouses,
                    Hotel: propertyState.Hotel,
                    name: offer.property,
                  }
                : offer.property,
            ],
          };
        } else if (player.name === name) {
          return {
            ...player,
            playerMoney: player.playerMoney + offer.offerPrice,
            ["player" + type]: [
              ...player["player" + type].filter(
                (p) => (p.name || p) !== offer.property
              ),
            ],
          };
        }
        return player;
      }),
    };
    cb({
      success: true,
      offers: offers[roomNo].filter((e) => e.to === socket.id),
    });
    io.to(offer.fromSocketId).emit("buy-offer-accepted", {
      from: name,
      property: offer.property,
      price: offer.offerPrice,
    });
    io.to(roomNo).emit("state-sync", {
      state: gameStates[roomNo],
    });
  });
  socket.on("accept-trade-offer", (id, cb) => {
    const roomNo = [...socket.rooms][1];
    const offer = offers[roomNo].find((offer) => offer.id === id) as Offer;
    offers[roomNo] = [...offers[roomNo].filter((of) => of.id !== id)];
    offers[roomNo] = [
      ...offers[roomNo].filter((of) => of.property !== offer.property),
    ];
    assert(offer.type === "trade");
    const propType = PROPERTIES.find((e) => e.Name === offer.property)
      ?.type as string;
    const propertyState = gameStates[roomNo].propertyStates[offer.property];
    const type =
      propType === "Property"
        ? "Properties"
        : propType === "Utility"
        ? "Utilities"
        : "Railroads";
    const nameProperties = offer.offer.properties.map((e) => e.name);
    const nameUtilities = offer.offer.utilities.map((e) => e.name);
    const nameRailroads = offer.offer.railroads.map((e) => e.name);
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      propertyStates: {
        ...gameStates[roomNo].propertyStates,
        [offer.property]: {
          ...propertyState,
          ownedBy: offer.from,
        },
      },
      marketPlace: [
        ...gameStates[roomNo].marketPlace.filter(
          (e) => e.name !== offer.property
        ),
      ],
      playerStates: gameStates[roomNo].playerStates.map((player) => {
        if (player.name === offer.from) {
          const tempObject = {
            ...player,
            playerMoney: player.playerMoney - offer.offer.money,
            playerProperties: [
              ...player.playerProperties.filter(
                (e) => !nameProperties.includes(e.name)
              ),
            ],
            playerUtilities: [
              ...player.playerUtilities.filter(
                (e) => !nameUtilities.includes(e)
              ),
            ],
            playerRailroads: [
              ...player.playerRailroads.filter(
                (e) => !nameRailroads.includes(e)
              ),
            ],
          };
          return {
            ...tempObject,
            ["player" + type]: [
              type === "Properties"
                ? {
                    numHouses: propertyState.numHouses || 0,
                    Hotel: Boolean(propertyState.Hotel),
                    name: offer.property,
                  }
                : offer.property,
            ],
          };
        } else if (player.name === name) {
          const tempObject = {
            ...player,
            playerMoney: player.playerMoney + offer.offer.money,
            playerProperties: [
              ...player.playerProperties,
              ...offer.offer.properties.map((e) => {
                return {
                  name: e.name,
                  numHouses:
                    gameStates[roomNo].propertyStates[e.name].numHouses || 0,
                  Hotel: Boolean(
                    gameStates[roomNo].propertyStates[e.name].Hotel
                  ),
                };
              }),
            ],
            playerUtilities: [...player.playerUtilities, ...nameUtilities],
            playerRailroads: [...player.playerRailroads, ...nameRailroads],
          };
          return {
            ...tempObject,
            ["player" + type]: [
              ...player["player" + type].filter(
                (p) => (p.name || p) !== offer.property
              ),
            ],
          };
        }
        return player;
      }),
    };
    cb({
      success: true,
      offers: offers[roomNo].filter((e) => e.to === socket.id),
    });
    io.to(offer.fromSocketId).emit("trade-offer-accepted", {
      from: name,
      property: offer.property,
    });
    io.to(roomNo).emit("state-sync", {
      state: gameStates[roomNo],
    });
  });
  socket.on("reject-buy-offer", (id, cb) => {
    const roomNo = [...socket.rooms][1];
    const offer = offers[roomNo].find((offer) => offer.id === id) as Offer;
    assert(offer.type === "buy");
    offers[roomNo] = [...offers[roomNo].filter((of) => of.id !== id)];
    cb({ success: true, offers: offers[roomNo] });
    io.to(offer.fromSocketId).emit("buy-offer-rejected", {
      from: name,
      property: offer.property,
      price: offer.offerPrice,
    });
  });
  socket.on("reject-trade-offer", (id, cb) => {
    const roomNo = [...socket.rooms][1];
    const offer = offers[roomNo].find((offer) => offer.id === id) as Offer;
    assert(offer.type === "trade");
    offers[roomNo] = [...offers[roomNo].filter((of) => of.id !== id)];
    cb({ success: true, offers: offers[roomNo] });
    io.to(offer.fromSocketId).emit("trade-offer-rejected", {
      from: name,
      property: offer.property,
    });
  });
  socket.on("set-active-property", ({ property }: { property: string }) => {
    const roomNo = [...socket.rooms][1];
    let nextTurn = gameStates[roomNo].playerStates[
      (gameStates[roomNo].playerStates.findIndex(
        (player) => player.id === gameStates[roomNo].currTurn
      ) +
        1) %
        gameStates[roomNo].playerStates.length
    ] as IPlayerState;
    const chanceSkipped = {};
    while (nextTurn.inJail) {
      chanceSkipped[nextTurn.name] = (chanceSkipped[nextTurn.name] || 0) + 1;
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.id === nextTurn.id) {
            return {
              ...player,
              turnsInJail:
                player.turnsInJail === 2 ? 0 : player.turnsInJail + 1,
              inJail: player.turnsInJail === 2 ? false : player.inJail,
            };
          }
          return player;
        }),
      };
      nextTurn = gameStates[roomNo].playerStates[
        (gameStates[roomNo].playerStates.findIndex(
          (player) => player.id === nextTurn.id
        ) +
          1) %
          gameStates[roomNo].playerStates.length
      ] as IPlayerState;
    }
    Object.keys(chanceSkipped).forEach((name) => {
      io.to(roomNo).emit("chance-skipped", {
        chances: chanceSkipped[name],
        name,
      });
    });
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      currTurn: nextTurn.id,
      activeProperty: property,
    };
    io.to(roomNo).emit("set-active-property", property);
    if (property === "") {
      io.to(roomNo).emit("round-end", { state: gameStates[roomNo] });
    }
  });
  socket.on(
    "buy-property",
    (
      {
        property,
        type,
      }: {
        property: string;
        type: "Properties" | "Utilities" | "Railroads";
      },
      cb
    ) => {
      const roomNo = [...socket.rooms][1];
      const currPlayer = gameStates[roomNo].playerStates.find(
        (player) => player.id === gameStates[roomNo].currTurn
      ) as IPlayerState;
      const propertyToBuy = PROPERTIES.find((e) => e.Name === property);
      const propertyState = gameStates[roomNo].propertyStates[property];
      if (propertyToBuy?.type === "Corner") return;
      if (currPlayer.playerMoney < propertyToBuy?.Price) {
        cb({ error: "Insufficient money" });
        return;
      }
      if (propertyState.ownedBy) {
        cb({
          error: `Property already by ${
            propertyState.ownedBy === name ? "You" : propertyState.ownedBy
          }`,
        });
        return;
      }
      let nextTurn = gameStates[roomNo].playerStates[
        (gameStates[roomNo].playerStates.findIndex(
          (player) => player.id === gameStates[roomNo].currTurn
        ) +
          1) %
          gameStates[roomNo].playerStates.length
      ] as IPlayerState;
      console.log("🚀 ~ io.on ~ nextTurn:", nextTurn.inJail);
      const chanceSkipped = {};
      while (nextTurn.inJail) {
        chanceSkipped[nextTurn.name] = (chanceSkipped[nextTurn.name] || 0) + 1;
        gameStates[roomNo] = {
          ...gameStates[roomNo],
          playerStates: gameStates[roomNo].playerStates.map((player) => {
            if (player.id === nextTurn.id) {
              return {
                ...player,
                turnsInJail:
                  player.turnsInJail === 2 ? 0 : player.turnsInJail + 1,
                inJail: player.turnsInJail === 2 ? false : player.inJail,
              };
            }
            return player;
          }),
        };
        nextTurn = gameStates[roomNo].playerStates[
          (gameStates[roomNo].playerStates.findIndex(
            (player) => player.id === nextTurn.id
          ) +
            1) %
            gameStates[roomNo].playerStates.length
        ] as IPlayerState;
      }

      Object.keys(chanceSkipped).forEach((name) => {
        io.to(roomNo).emit("chance-skipped", {
          chances: chanceSkipped[name],
          name,
        });
      });
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        activeProperty: "",
        currTurn: nextTurn.id,
        propertyStates: {
          ...gameStates[roomNo].propertyStates,
          [property]: {
            ...gameStates[roomNo].propertyStates[property],
            ownedBy: name,
            mortgaged: false,
          },
        },
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.id === socket.id) {
            return {
              ...player,
              playerMoney:
                player.playerMoney -
                (PROPERTIES.find((e) => e.Name === property)?.Price || 0),
              ["player" + type]: [
                ...player["player" + type],
                type === "Properties"
                  ? { name: property, numHouses: 0, Hotel: false }
                  : property,
              ],
            };
          }
          return player;
        }),
        // playerMoney:
      };
      cb({ success: true });
      io.to(roomNo).emit("set-active-property", "");
      socket.to(roomNo).emit("property-bought", { name, property });
      io.to(roomNo).emit("round-end", { state: gameStates[roomNo] });
    }
  );
  socket.on(
    "mortgage-property",
    (
      {
        property,
        type,
      }: {
        property: string;
        type: "Properties" | "Utilities" | "Railroads";
      },
      cb
    ) => {
      const roomNo = [...socket.rooms][1];
      const currPlayer = gameStates[roomNo].playerStates.find(
        (player) => player.id === gameStates[roomNo].currTurn
      ) as IPlayerState;
      const propertyToMortgage = PROPERTIES.find((e) => e.Name === property);
      const propertyState = gameStates[roomNo].propertyStates[property];
      if (propertyToMortgage?.type === "Corner") return;
      if (propertyState.ownedBy && propertyState.ownedBy !== name) {
        cb({
          error: `You do not own this property`,
        });
        return;
      }
      if (propertyState.mortgaged) {
        cb({
          error: `Property already mortgaged`,
        });
        return;
      }
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        activeProperty: "",
        propertyStates: {
          ...gameStates[roomNo].propertyStates,
          [property]: {
            ...gameStates[roomNo].propertyStates[property],
            ownedBy: name,
            mortgaged: true,
          },
        },
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.id === socket.id) {
            return {
              ...player,
              playerMoney:
                player.playerMoney +
                (propertyToMortgage?.Mortgage ||
                  (propertyToMortgage?.Price || 0) / 2),
              ["player" + type]: [
                ...player["player" + type].filter(
                  (p) => (p.name || p) !== property
                ),
              ],
              playerMortgagedProperties: [
                ...player.playerMortgagedProperties,
                property,
              ],
            };
          }
          return player;
        }),
        // playerMoney:
      };
      cb({ success: true, state: gameStates[roomNo] });
      socket.to(roomNo).emit("property-mortgaged", {
        name,
        property,
        state: gameStates[roomNo],
      });
    }
  );
  socket.on(
    "unmortgage-property",
    (
      {
        property,
        type,
      }: {
        property: string;
        type: "Properties" | "Utilities" | "Railroads";
      },
      cb
    ) => {
      const roomNo = [...socket.rooms][1];
      const currPlayer = gameStates[roomNo].playerStates.find(
        (player) => player.id === gameStates[roomNo].currTurn
      ) as IPlayerState;
      const propertyToMortgage = PROPERTIES.find((e) => e.Name === property);
      const propertyState = gameStates[roomNo].propertyStates[property];
      if (propertyToMortgage?.type === "Corner") return;
      if (propertyState.ownedBy && propertyState.ownedBy !== name) {
        cb({
          error: `You do not own this property`,
        });
        return;
      }
      if (!propertyState.mortgaged) {
        cb({
          error: `Property is not mortgaged`,
        });
        return;
      }
      if (
        currPlayer.playerMoney <
        (propertyToMortgage?.Mortgage || propertyToMortgage?.Price / 2) * 1.1
      ) {
        cb({ error: "Insufficient money" });
        return;
      }
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        activeProperty: "",
        propertyStates: {
          ...gameStates[roomNo].propertyStates,
          [property]: {
            ...gameStates[roomNo].propertyStates[property],
            ownedBy: name,
            mortgaged: false,
          },
        },
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.id === socket.id) {
            return {
              ...player,
              playerMoney:
                player.playerMoney -
                (propertyToMortgage?.Mortgage ||
                  propertyToMortgage?.Price / 2) *
                  1.1,
              ["player" + type]: [
                ...player["player" + type],
                type === "Properties"
                  ? { name: property, numHouses: 0, Hotel: false }
                  : property,
              ],
              playerMortgagedProperties: [
                ...player.playerMortgagedProperties.filter(
                  (p) => p !== property
                ),
              ],
            };
          }
          return player;
        }),
        // playerMoney:
      };
      cb({ success: true, state: gameStates[roomNo] });
      socket.to(roomNo).emit("property-unmortgaged", {
        name,
        property,
        state: gameStates[roomNo],
      });
    }
  );
  socket.on("build-house", ({ property }: { property: string }, cb) => {
    const roomNo = [...socket.rooms][1];
    const propertyToBuild = PROPERTIES.find((e) => e.Name === property);
    const propertyState = gameStates[roomNo].propertyStates[property];
    const currPlayer = gameStates[roomNo].playerStates.find(
      (player) => player.id === gameStates[roomNo].currTurn
    ) as IPlayerState;
    if (propertyToBuild?.type !== "Property") {
      if (propertyToBuild?.type !== "Corner")
        cb({ error: `Cannot build house on ${propertyToBuild?.type}s` });
      return;
    }
    if (propertyState.numHouses === 4) {
      cb({ error: "Cannot have more than 4 houses. Try building a hotel!" });
      return;
    }
    if (currPlayer.playerMoney < propertyToBuild?.PricePerHouse) {
      cb({ error: "Insufficient money" });
      return;
    }
    let nextTurn = gameStates[roomNo].playerStates[
      (gameStates[roomNo].playerStates.findIndex(
        (player) => player.id === gameStates[roomNo].currTurn
      ) +
        1) %
        gameStates[roomNo].playerStates.length
    ] as IPlayerState;
    const chanceSkipped = {};
    while (nextTurn.inJail) {
      chanceSkipped[nextTurn.name] = (chanceSkipped[nextTurn.name] || 0) + 1;
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.id === nextTurn.id) {
            return {
              ...player,
              turnsInJail:
                player.turnsInJail === 2 ? 0 : player.turnsInJail + 1,
              inJail: player.turnsInJail === 2 ? false : player.inJail,
            };
          }
          return player;
        }),
      };
      nextTurn = gameStates[roomNo].playerStates[
        (gameStates[roomNo].playerStates.findIndex(
          (player) => player.id === nextTurn.id
        ) +
          1) %
          gameStates[roomNo].playerStates.length
      ] as IPlayerState;
    }
    Object.keys(chanceSkipped).forEach((name) => {
      io.to(roomNo).emit("chance-skipped", {
        chances: chanceSkipped[name],
        name,
      });
    });
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      activeProperty: "",
      propertyStates: {
        ...gameStates[roomNo].propertyStates,
        [property]: {
          ...gameStates[roomNo].propertyStates[property],
          numHouses:
            (gameStates[roomNo].propertyStates[property].numHouses || 0) + 1,
        },
      },
      currTurn: nextTurn.id,
      playerStates: gameStates[roomNo].playerStates.map((player) => {
        if (player.id === socket.id) {
          return {
            ...player,
            playerProperties: player.playerProperties.map((prop) => {
              if (prop.name === property) {
                return { ...prop, numHouses: prop.numHouses + 1 };
              }
              return prop;
            }),
            playerMoney:
              player.playerMoney - (propertyToBuild?.PricePerHouse || 0),
          };
        }
        return player;
      }),
      // playerMoney:
    };
    cb({ success: true });
    io.to(roomNo).emit("set-active-property", "");
    socket.to(roomNo).emit("house-built", { name, property });
    io.to(roomNo).emit("round-end", { state: gameStates[roomNo] });
  });
  socket.on("build-hotel", ({ property }: { property: string }, cb) => {
    const roomNo = [...socket.rooms][1];
    const propertyToBuild = PROPERTIES.find((e) => e.Name === property);
    const propertyState = gameStates[roomNo].propertyStates[property];
    const currPlayer = gameStates[roomNo].playerStates.find(
      (player) => player.id === gameStates[roomNo].currTurn
    ) as IPlayerState;
    if (propertyToBuild?.type !== "Property") {
      if (propertyToBuild?.type !== "Corner")
        cb({ error: `Cannot build hotel on ${propertyToBuild?.type}s` });
      return;
    }
    if (propertyState.numHouses < 4) {
      cb({ error: "Cannot build a hotel without having 4 houses." });
      return;
    }
    if (currPlayer.playerMoney < propertyToBuild?.PricePerHouse) {
      cb({ error: "Insufficient money" });
      return;
    }

    let nextTurn = gameStates[roomNo].playerStates[
      (gameStates[roomNo].playerStates.findIndex(
        (player) => player.id === gameStates[roomNo].currTurn
      ) +
        1) %
        gameStates[roomNo].playerStates.length
    ] as IPlayerState;
    const chanceSkipped = {};
    while (nextTurn.inJail) {
      chanceSkipped[nextTurn.name] = (chanceSkipped[nextTurn.name] || 0) + 1;
      gameStates[roomNo] = {
        ...gameStates[roomNo],
        playerStates: gameStates[roomNo].playerStates.map((player) => {
          if (player.id === nextTurn.id) {
            return {
              ...player,
              turnsInJail:
                player.turnsInJail === 2 ? 0 : player.turnsInJail + 1,
              inJail: player.turnsInJail === 2 ? false : player.inJail,
            };
          }
          return player;
        }),
      };
      nextTurn = gameStates[roomNo].playerStates[
        (gameStates[roomNo].playerStates.findIndex(
          (player) => player.id === nextTurn.id
        ) +
          1) %
          gameStates[roomNo].playerStates.length
      ] as IPlayerState;
    }
    Object.keys(chanceSkipped).forEach((name) => {
      io.to(roomNo).emit("chance-skipped", {
        chances: chanceSkipped[name],
        name,
      });
    });
    gameStates[roomNo] = {
      ...gameStates[roomNo],
      activeProperty: "",
      propertyStates: {
        ...gameStates[roomNo].propertyStates,
        [property]: {
          ...gameStates[roomNo].propertyStates[property],
          Hotel: true,
        },
      },
      currTurn: nextTurn.id,
      playerStates: gameStates[roomNo].playerStates.map((player) => {
        if (player.id === socket.id) {
          return {
            ...player,
            playerProperties: player.playerProperties.map((prop) => {
              if (prop.name === property) {
                return { ...prop, Hotel: true };
              }
              return prop;
            }),
            playerMoney:
              player.playerMoney - (propertyToBuild?.PricePerHouse || 0),
          };
        }
        return player;
      }),
      // playerMoney:
    };
    cb({ success: true });
    io.to(roomNo).emit("set-active-property", "");
    socket.to(roomNo).emit("hotel-built", { name, property });
    io.to(roomNo).emit("round-end", { state: gameStates[roomNo] });
  });
  socket.on("create-game", (cb) => {
    const gameId = nanoid(6);
    console.log(`Game created with ID: ${gameId}`);
    socket.join(gameId);
    // console.log(socket.rooms);
    gameStates[gameId] = {
      ...DEFAULT_STATE,
      gameId,
      host: socket.id,
      currTurn: socket.id,
      playerStates: [
        {
          name,
          id: socket.id,
          playerCurrPosition: 0,
          playerMoney: 2000,
          playerProperties: [],
          playerUtilities: [],
          playerRailroads: [],
          playerMortgagedProperties: [],
          inJail: false,
          turnsInJail: 0,
          playerToken: PlayerToken.NA,
        },
      ],
    };
    cb({ state: gameStates[gameId], cUserId: socket.id });
    // Additional logic for creating the game
  });
  socket.on("disconnecting", () => {
    // console.log(socket.rooms);
    // for (const roomNo in gameStates) {
    const roomNo = [...socket.rooms][1];
    if (!roomNo) return;
    const game = gameStates[roomNo];
    const playerIndex = game.playerStates.findIndex(
      (player) => player.id === socket.id
    );

    if (playerIndex !== -1) {
      const leavingPlayer = game.playerStates.splice(playerIndex, 1)[0];
      socket.to(roomNo).emit("player-leave", { playerId: leavingPlayer.id });

      // If the leaving player is the host, assign a new host
      if (game.host === leavingPlayer.id && game.playerStates.length > 0) {
        game.host = game.playerStates[0].id;
        //   socket.to(roomNo).emit("new-host", { newHostId: game.host });
      }

      // If no players are left in the room, delete the game state
      if (game.playerStates.length === 0) {
        console.log(`Room ${roomNo} is empty. Deleting game state`);
        delete gameStates[roomNo];
      }
      // break;
    }
    // }
  });
  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
