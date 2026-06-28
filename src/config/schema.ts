import { z } from "zod";

export const LockConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nodeId: z.number().int().positive(),
  maxCodeSlots: z.number().int().positive(),
});

export const LocksConfigSchema = z.object({
  zwaveJs: z.object({
    // Empty string is the addon-mode sentinel: the URL is discovered at runtime
    // from the Supervisor. Real values must still be valid URLs.
    url: z.string().url().or(z.literal("")),
  }),
  homeAssistant: z.object({
    url: z.string().url(),
    token: z.string(),
    notify: z.object({
      service: z.string().min(1),
      category: z.string().min(1).optional(),
    }),
  }),
  verify: z
    .object({
      intervalDays: z.number().int().positive().default(7),
      staggerMinutes: z.number().int().nonnegative().default(60),
    })
    .default({ intervalDays: 7, staggerMinutes: 60 }),
  readOnly: z.boolean().default(false),
  locks: z.array(LockConfigSchema),
});

export type LockConfig = z.infer<typeof LockConfigSchema>;
export type LocksConfig = z.infer<typeof LocksConfigSchema>;
