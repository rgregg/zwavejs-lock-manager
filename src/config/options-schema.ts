import { z } from "zod";

export const AddonOptionsSchema = z.object({
  read_only: z.boolean().default(false),
  notify_service: z.string().default("notify.notify"),
  zwave_js_url: z.string().url().optional(),
  verify_interval_days: z.number().int().positive().default(7),
  verify_stagger_minutes: z.number().int().nonnegative().default(60),
  locks: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      node_id: z.number().int().positive(),
      max_code_slots: z.number().int().positive().default(30),
    }),
  ),
});

export type AddonOptions = z.infer<typeof AddonOptionsSchema>;
