// server.js – Privát és csoportos chat, üzenetmegjelenítés, ajándékok (MYSQL nélkül)

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const session = require("express-session");
const bodyParser = require("body-parser");
const multer = require("multer");

// Nem szükséges mysql, így eltávolítjuk

// Profilkép feltöltés beállításai
const storage = multer.diskStorage({
  destination: "public/uploads/",
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});
const upload = multer({ storage });

function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

  app.use(express.static(path.join(__dirname, "public")));
  app.use(bodyParser.json());
  app.use(session({
    secret: "SUPER_SECRET",
    resave: false,
    saveUninitialized: false,
  }));

  const GROUP_ROOM = "groupRoom";
  let groupUsers = {};
  let waitingUser = null;

  io.on("connection", (socket) => {
    socket.nickname = socket.handshake.auth?.nickname || "Anon";
    socket.mode = socket.handshake.auth?.mode || "private";
    console.log("🔗 Felhasználó csatlakozott:", socket.nickname);

    // Csoportos chat csatlakozás
    if (socket.mode === "group") {
      socket.join(GROUP_ROOM);
      groupUsers[socket.id] = socket.nickname;
      io.in(GROUP_ROOM).emit("onlineUsers", { users: Object.values(groupUsers), count: Object.keys(groupUsers).length });
    }

    // Privát chat párosítás
    if (socket.mode === "private") {
      if (waitingUser && waitingUser.id !== socket.id) {
        socket.partner = waitingUser;
        waitingUser.partner = socket;
        socket.emit("matched", { message: "Kapcsolódtál!", partnerNickname: waitingUser.nickname });
        waitingUser.emit("matched", { message: "Kapcsolódtál!", partnerNickname: socket.nickname });
        waitingUser = null;
      } else {
        waitingUser = socket;
        socket.emit("waiting", { message: "Várakozás egy partnerre..." });
      }
    }

    // Gépelési állapot küldése
    socket.on("typing", () => {
      if (socket.mode === "group") {
        socket.to(GROUP_ROOM).emit("typing", { nickname: socket.nickname });
      } else if (socket.partner) {
        socket.partner.emit("typing", { nickname: socket.nickname });
      }
    });

    socket.on("stopTyping", () => {
      if (socket.mode === "group") {
        socket.to(GROUP_ROOM).emit("stopTyping");
      } else if (socket.partner) {
        socket.partner.emit("stopTyping");
      }
    });

    // Üzenet küldés (saját magának is megjelenítve!)
    socket.on("message", (data) => {
      const timestamp = new Date().toLocaleTimeString();
      const messageData = { 
        messageId: Date.now().toString(), 
        text: data.text, 
        nickname: socket.nickname, 
        time: timestamp 
      };

      if (socket.mode === "group") {
        io.in(GROUP_ROOM).emit("message", messageData);
      } else if (socket.partner) {
        socket.partner.emit("message", messageData);
        socket.emit("message", messageData);
      }
    });

    // Ajándék küldés (MYSQL nélkül)
    socket.on("sendGift", (giftData) => {
      if (socket.mode === "group") {
        io.in(GROUP_ROOM).emit("giftReceived", giftData);
      } else if (socket.partner) {
        socket.partner.emit("giftReceived", giftData);
        socket.emit("giftReceived", giftData);
      }
    });

    // Képüzenet kezelése
    socket.on("imageMessage", (data) => {
      // data tartalmazza az image (base64) és a nickname értékeket
      if (socket.mode === "group") {
        io.in(GROUP_ROOM).emit("imageMessage", data);
      } else if (socket.partner) {
        socket.partner.emit("imageMessage", data);
        socket.emit("imageMessage", data);
      }
    });

    // Felhasználó kilépésének kezelése
    socket.on("disconnect", () => {
      console.log("❌ User disconnected:", socket.nickname);

      if (socket.mode === "group") {
        delete groupUsers[socket.id];
        io.in(GROUP_ROOM).emit("onlineUsers", { users: Object.values(groupUsers), count: Object.keys(groupUsers).length });
        io.in(GROUP_ROOM).emit("info", { message: `${socket.nickname} kilépett.` });
      } else {
        if (socket.partner) {
          socket.partner.emit("partnerDisconnected", "A partnered kilépett.");
          socket.partner.partner = null;
        }
        if (waitingUser === socket) {
          waitingUser = null;
        }
      }
    });
  });

  server.listen(3000, () => {
    console.log("🚀 Szerver fut a 3000-es porton...");
  });
}

startServer();
