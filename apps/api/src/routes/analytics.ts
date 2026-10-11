/**
 * The Analytics workspace's endpoints.
 *
 * Four reads over the same period: the catalogue (what a measure means), the overview (every figure, with
 * the period's own limitations), a breakdown (the same figures cut by client, board, technician or
 * priority) and the realisation funnel. They are separate endpoints rather than one payload because the
 * screen asks for them at different moments — changing the dimension should not re-run the nine builders
 * behind the overview.
 *
 * All four are gated on `report:view`, the same permission the standard reports use: this is the same data
 * by a different route, and a screen that shows it must not be a way around the permission that guards it.
 * `parsePeriod` resolves the client filter against the account's own scope, so a query parameter can narrow
 * a figure but never widen it.
 */
import { Router } from "express";
import type { NextFunction, Response } from "express";
import { Permission } from "@C7NTAX/shared";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { parsePeriod } from "../services/reportData";
import {
  ANALYTICS_MEASURES,
  BREAKDOWN_DIMENSIONS,
  MEASURE_GROUPS,
  analyticsBreakdown,
  analyticsFunnel,
  analyticsOverview,
  type BreakdownDimension,
} from "../services/analytics";

export const analyticsRouter = Router();
analyticsRouter.use(authenticate);

/** The measure catalogue: what each figure means, which way is good, and which endpoint it is read from. */
analyticsRouter.get("/catalogue", requirePermission(Permission.ReportView), (_req, res) => {
  res.json({ groups: MEASURE_GROUPS, measures: ANALYTICS_MEASURES, dimensions: BREAKDOWN_DIMENSIONS });
});

analyticsRouter.get("/overview", requirePermission(Permission.ReportView), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const period = await parsePeriod(req.query as Record<string, unknown>, req.user);
    res.json(await analyticsOverview(req.user, period));
  } catch (e) { next(e); }
});

analyticsRouter.get("/breakdown", requirePermission(Permission.ReportView), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const period = await parsePeriod(req.query as Record<string, unknown>, req.user);
    const requested = String(req.query.dimension ?? "client");
    // An unknown dimension falls back rather than erroring: a stale bookmark should open the screen.
    const dimension: BreakdownDimension = BREAKDOWN_DIMENSIONS.some((d) => d.id === requested)
      ? (requested as BreakdownDimension)
      : "client";
    res.json(await analyticsBreakdown(req.user, period, dimension));
  } catch (e) { next(e); }
});

analyticsRouter.get("/funnel", requirePermission(Permission.ReportView), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const period = await parsePeriod(req.query as Record<string, unknown>, req.user);
    res.json(await analyticsFunnel(req.user, period));
  } catch (e) { next(e); }
});
