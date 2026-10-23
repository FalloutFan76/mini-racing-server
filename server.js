
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;
const players = new Map();

const COLORS = [
  "#ff4e45", "#40d9ff", "#ffe05a", "#c68aff",
  "#63f58a", "#ff9f43", "#f4f5f7", "#ff72b6"
];

const TRACK = {
  cx: 480,
  cy: 320,
  rx: 285,
  ry: 195
};

app.get("/", (_req, res) => {
  res.json({
    game: "Mini Racing",
    status: "online",
    players: players.size
  });
});

function spawnPosition(index) {
  const angle = -Math.PI / 2 + index * 0.16;

  return {
    x: TRACK.cx + TRACK.rx * Math.cos(angle),
    y: TRACK.cy + TRACK.ry * Math.sin(angle),
    angle: angle + Math.PI / 2
  };
}

function insideTrack(x, y) {
  const outer =
    ((x - TRACK.cx) / 365) ** 2 +
    ((y - TRACK.cy) / 270) ** 2;

  const inner =
    ((x - TRACK.cx) / 205) ** 2 +
    ((y - TRACK.cy) / 120) ** 2;

  return outer < 1 && inner > 1;
}

function publicState() {
  return Array.from(players.values()).map(p => ({
    id: p.id,
    name: p.name,
    x: Math.round(p.x),
    y: Math.round(p.y),
    angle: p.angle,
    color: p.color,
    lap: p.lap,
    progress: p.progress
  }));
}

io.on("connection", socket => {
  socket.emit("welcome", { id: socket.id });

  socket.on("joinRace", data => {
    if (!players.has(socket.id)) {
      const index = players.size;
      const pos = spawnPosition(index);

      players.set(socket.id, {
        id: socket.id,
        name: String(data?.name || "Piloto")
          .replace(/[<>]/g, "")
          .trim()
          .slice(0, 16) || "Piloto",
        x: pos.x,
        y: pos.y,
        angle: pos.angle,
        speed: 0,
        color: COLORS[index % COLORS.length],
        lap: 0,
        progress: 0,
        lastAngle: -Math.PI / 2,
        input: { up: false, down: false, left: false, right: false }
      });
    }

    socket.emit("raceMessage", "¡Bienvenido a Pixel Circuit!");
    io.emit("state", { players: publicState() });
  });

  socket.on("input", data => {
    const p = players.get(socket.id);
    if (!p || !data || typeof data !== "object") return;

    p.input = {
      up: data.up === true,
      down: data.down === true,
      left: data.left === true,
      right: data.right === true
    };
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("state", { players: publicState() });
  });
});

// El servidor controla la física; el cliente no decide su propia posición.
const TICK_MS = 1000 / 30;
const MAX_SPEED = 3.8;
const ACCELERATION = 0.10;
const FRICTION = 0.045;
const TURN_SPEED = 0.045;

setInterval(() => {
  for (const p of players.values()) {
    const input = p.input;

    if (input.up) p.speed += ACCELERATION;
    else p.speed -= FRICTION;

    if (input.down) p.speed -= ACCELERATION * 1.5;

    p.speed = Math.max(0, Math.min(MAX_SPEED, p.speed));

    const steering = (input.left ? -1 : 0) +
                     (input.right ? 1 : 0);

    if (p.speed > 0.1) {
      p.angle += steering * TURN_SPEED * (p.speed / MAX_SPEED);
    }

    const nextX = p.x + Math.sin(p.angle) * p.speed;
    const nextY = p.y - Math.cos(p.angle) * p.speed;

    if (insideTrack(nextX, nextY)) {
      p.x = nextX;
      p.y = nextY;
    } else {
      // Fuera de la pista: frenamos al coche.
      p.speed *= 0.65;
    }

    // Progreso angular aproximado alrededor del circuito.
    let angle = Math.atan2(
      (p.y - TRACK.cy) / TRACK.ry,
      (p.x - TRACK.cx) / TRACK.rx
    );

    if (angle < -Math.PI / 2) angle += Math.PI * 2;

    p.progress = (angle + Math.PI / 2) / (Math.PI * 2);
  }

  io.emit("state", { players: publicState() });
}, TICK_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Mini Racing server escuchando en el puerto ${PORT}`);
});
