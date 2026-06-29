import { z } from "zod";

/**
 * Shape of the Home Assistant add-on options form (`/data/options.json`).
 *
 * HA convention is snake_case for option keys. The loader translates these
 * into our internal camelCase `LocksConfig` shape (see config/loader.ts).
 */
export const AddonOptionsSchema = z.object({
  read_only: z.boolean().default(false),
  // Optional explicit zwave-js-server URL. Leave blank to auto-discover the HA
  // Z-Wave JS add-on; set it to point at an external/standalone server.
  zwave_url: z.string().optional(),
  notify_service: z.string().min(1).default("notify.notify"),
  notify_category: z.string().min(1).optional(),
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
