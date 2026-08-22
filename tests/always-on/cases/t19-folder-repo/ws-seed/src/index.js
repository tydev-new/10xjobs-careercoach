const express = require("express");
const app = express();

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 8080);
