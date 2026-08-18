import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import { advertisementEventLimiter } from "../middlewares/rateLimit.middleware";
import * as AdvertisementController from "../controllers/Advertisement.controller";

export const advertisementRouter = Router();

advertisementRouter.use(authMiddleware);

advertisementRouter.get("/catalog", asyncHandler(AdvertisementController.catalog));
advertisementRouter.get("/feed", asyncHandler(AdvertisementController.feed));
advertisementRouter.get("/my", asyncHandler(AdvertisementController.listMine));
advertisementRouter.post("/payments/verify", asyncHandler(AdvertisementController.verifyPayment));
advertisementRouter.post("/", asyncHandler(AdvertisementController.create));
advertisementRouter.get("/:id/analytics", asyncHandler(AdvertisementController.analytics));
advertisementRouter.get("/:id/invoice", asyncHandler(AdvertisementController.invoice));
advertisementRouter.get("/:id/click-redirect", asyncHandler(AdvertisementController.clickRedirect));
advertisementRouter.post(
  "/:id/impression",
  advertisementEventLimiter,
  asyncHandler(AdvertisementController.impression)
);
advertisementRouter.post(
  "/:id/click",
  advertisementEventLimiter,
  asyncHandler(AdvertisementController.click)
);
advertisementRouter.post(
  "/:id/report",
  advertisementEventLimiter,
  asyncHandler(AdvertisementController.report)
);
advertisementRouter.post("/:id/quote", asyncHandler(AdvertisementController.quote));
advertisementRouter.post("/:id/payment", asyncHandler(AdvertisementController.createPayment));
advertisementRouter.get("/:id", asyncHandler(AdvertisementController.getOne));
advertisementRouter.put("/:id", asyncHandler(AdvertisementController.update));
advertisementRouter.delete("/:id", asyncHandler(AdvertisementController.remove));
