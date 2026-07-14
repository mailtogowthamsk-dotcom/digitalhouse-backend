import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authMiddleware } from "../middlewares/auth.middleware";
import * as SupportController from "../controllers/Support.controller";

export const supportRouter = Router();

supportRouter.use(authMiddleware);

supportRouter.get("/home", asyncHandler(SupportController.getHome));
supportRouter.get("/faqs", asyncHandler(SupportController.listFaqs));
supportRouter.get("/guides", asyncHandler(SupportController.listGuides));
supportRouter.get("/guides/:guideId", asyncHandler(SupportController.getGuide));
supportRouter.get("/contact", asyncHandler(SupportController.getContact));
supportRouter.post("/tickets", asyncHandler(SupportController.createTicket));
supportRouter.get("/tickets", asyncHandler(SupportController.listMyTickets));
supportRouter.get("/tickets/:ticketId", asyncHandler(SupportController.getMyTicket));
supportRouter.post("/tickets/:ticketId/messages", asyncHandler(SupportController.replyTicket));
