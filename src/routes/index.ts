import { Router } from "express";
import { authRouter } from "./auth.routes";
import { adminRouter } from "./admin.routes";
import { optionsRouter } from "./options.routes";
import { homeRouter } from "./home.routes";
import { profileRouter } from "./profile.routes";
import { postRouter } from "./post.routes";
import { mediaRouter } from "./media.routes";

export const apiRouter = Router();

apiRouter.use("/auth", authRouter);
apiRouter.use("/admin", adminRouter);
apiRouter.use("/options", optionsRouter);
apiRouter.use("/home", homeRouter);
apiRouter.use("/profile", profileRouter);
apiRouter.use("/posts", postRouter);
apiRouter.use("/media", mediaRouter);
