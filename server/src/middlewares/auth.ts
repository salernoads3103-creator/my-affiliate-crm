import type { NextFunction, Request, Response } from "express";
import { supabaseForUser } from "../config/supabase";
import { ApiError } from "../utils/ApiError";
import type { SupabaseClient } from "@supabase/supabase-js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      supabase?: SupabaseClient;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer ")) throw new ApiError(401, "Unauthorized");
    const token = auth.slice(7);

    const client = supabaseForUser(token);
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) throw new ApiError(401, "Unauthorized");

    req.userId = data.user.id;
    req.supabase = client;
    next();
  } catch (e) {
    next(e);
  }
}
