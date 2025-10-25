import type { JobTasks } from "./types.js";

import betterAuth from "./better-auth.js";
import nextJs16 from "./next-js-16.js";
import polarSh from "./polar-sh.js";
import prisma from "./prisma.js";
import react19 from "./react-19.js";
import trpc from "./trpc.js";
import zod from "./zod.js";

export const jobs = {
  "better-auth": betterAuth,
  "next-js-16": nextJs16,
  "polar-sh": polarSh,
  prisma,
  "react-19": react19,
  trpc,
  zod,
} satisfies Record<string, JobTasks>;

export type JobRegistry = typeof jobs;
