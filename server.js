"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
  transports: ["websocket", "polling"]
});

const PORT = process.env.PORT || 3000;
const players = new Map();
const COLORS = ["#ff4e45","#40d9ff","#ffe05a","#c68aff","#63f58a","#ff9f43","#f4f5f7","#ff72b6"];
const CX = 480, CY = 320;
const OUT_RX = 365, OUT_RY = 270;
const IN_RX = 205, IN_RY = 120;
const ROAD_RX = 285, ROAD_RY = 195;
const TOTAL_LAPS = 3;

let raceStartAt = 0;
let raceHasStarted = false;

app.get("/", (_req, res) => {
  res.json({
    game: "Mini Racing Arcade",
    status: "online",
    players: players.size
  });
});
app.get("/health", (_req, res) => res.json({ status: "ok" }));

function spawnPosition(index) {
  // Todos salen en la parte superior del circuito.
  const offset = index * 22;
  return {
    x: CX + offset,
    y: CY - ROAD_RY + (index % 2) * 9,
    angle: 0
  };
}

function insideTrack(x, y) {
  const outer = ((x-CX)/OUT_RX)**2 + ((y-CY)/OUT_RY)**2;
  const inner = ((x-CX)/IN_RX)**2 + ((y-CY)/IN_RY)**2;
  return outer < 0.985 && inner > 1.06;
}

function getProgress(p) {
  let a = Math.atan2((p.y-CY)/ROAD_RY, (p.x-CX)/ROAD_RX);
  return ((a + Math.PI/2 + Math.PI*2) % (Math.PI*2)) / (Math.PI*2);
}

function publicState() {
  return Array.from(players.values()).map(p => ({
    id: p.id,
    name: p.name,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    angle: p.angle,
    speed: p.speed,
    color: p.color,
    lap: p.lap,
    progress: p.progress,
    finished: p.finished,
    finishTime: p.finishTime
  }));
}

function broadcastState() {
  io.emit("state", { players: publicState() });
}

io.on("connection", socket => {
  socket.emit("welcome", { id: socket.id });

  socket.on("joinRace", data => {
    if (!players.has(socket.id)) {
      const index = players.size;
      const pos = spawnPosition(index);
      const safeName = String(data && data.name || "Piloto")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, 16) || "Piloto";

      players.set(socket.id, {
        id: socket.id,
        name: safeName,
        x: pos.x,
        y: pos.y,
        angle: pos.angle,
        speed: 0,
        color: COLORS[index % COLORS.length],
        lap: 0,
        progress: 0,
        previousProgress: 0,
        finished: false,
        finishTime: 0,
        boostFuel: 100,
        input: { up:false, down:false, left:false, right:false, boost:false }
      });
    }

    socket.emit("raceMessage", "¡Bienvenido a Pixel Circuit!");
    if (!raceHasStarted) {
      raceHasStarted = true;
      raceStartAt = Date.now();
      io.emit("raceStarted", { startAt: raceStartAt });
    }
    broadcastState();
  });

  socket.on("input", data => {
    const p = players.get(socket.id);
    if (!p || !data || typeof data !== "object" || p.finished) return;

    p.input = {
      up: data.up === true,
      down: data.down === true,
      left: data.left === true,
      right: data.right === true,
      boost: data.boost === true
    };
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    if (players.size === 0) {
      raceHasStarted = false;
      raceStartAt = 0;
    }
    broadcastState();
  });
});

const TICK = 1000 / 30;
const MAX_SPEED = 4.1;
const ACCELERATION = 0.105;
const BRAKE = 0.16;
const FRICTION = 0.035;
const TURN_SPEED = 0.047;

setInterval(() => {
  const now = Date.now();

  for (const p of players.values()) {
    if (p.finished) {
      p.speed = 0;
      continue;
    }

    const input = p.input;

    if (input.up) p.speed += ACCELERATION;
    else p.speed -= FRICTION;

    if (input.down) p.speed -= BRAKE;

    let maxSpeed = MAX_SPEED;
    if (input.boost && p.boostFuel > 0) {
      maxSpeed = 5.8;
      p.boostFuel = Math.max(0, p.boostFuel - 0.65);
    } else {
      p.boostFuel = Math.min(100, p.boostFuel + 0.13);
    }

    p.speed = Math.max(0, Math.min(maxSpeed, p.speed));

    const steering = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    if (Math.abs(p.speed) > 0.12) {
      p.angle += steering * TURN_SPEED * (0.35 + p.speed / MAX_SPEED);
    }

    const nextX = p.x + Math.cos(p.angle) * p.speed;
    const nextY = p.y + Math.sin(p.angle) * p.speed;

    if (insideTrack(nextX, nextY)) {
      p.x = nextX;
      p.y = nextY;
    } else {
      p.speed *= 0.45;
    }

    const progress = getProgress(p);
    // La vuelta cuenta al pasar por meta, no al salir.
    if (p.previousProgress > 0.82 && progress < 0.18) {
      p.lap += 1;
      if (p.lap >= TOTAL_LAPS) {
        p.lap = TOTAL_LAPS;
        p.finished = true;
        p.finishTime = now - raceStartAt;
        const standings = Array.from(players.values())
          .filter(player => player.finished)
          .sort((a,b) => a.finishTime - b.finishTime);
        io.emit("raceFinished", {
          id: p.id,
          position: standings.findIndex(player => player.id === p.id) + 1,
          time: p.finishTime
        });
      } else {
        io.emit("raceMessage", `${p.name} ha completado la vuelta ${p.lap}`);
      }
    }
    p.previousProgress = progress;
    p.progress = progress;
  }

  broadcastState();
}, TICK);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mini Racing Arcade escuchando en el puerto ${PORT}`);
});
