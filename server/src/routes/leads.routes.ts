import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { asyncHandler } from "../utils/asyncHandler";
import { LeadController } from "../controllers/lead.controller";

export const leadsRouter = Router();

leadsRouter.use(requireAuth as never);

leadsRouter.get("/", asyncHandler(LeadController.list));
leadsRouter.get("/search", asyncHandler(LeadController.search));
leadsRouter.get("/stats", asyncHandler(LeadController.stats));
leadsRouter.post("/", asyncHandler(LeadController.create));
leadsRouter.put("/:id", asyncHandler(LeadController.update));
leadsRouter.delete("/:id", asyncHandler(LeadController.remove));
leadsRouter.post("/:id/restore", asyncHandler(LeadController.restore));
