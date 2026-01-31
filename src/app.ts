import cors from "cors";
import express from "express";
import "./config/env";
import { apiRouter } from "./routes";
import { errorHandler } from "./middlewares/error.middleware";

export const app = express();

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// Log every API request so you can see if the phone hits the backend
app.use("/api", (req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
}, apiRouter);

app.use(errorHandler);

