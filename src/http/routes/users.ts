import type { FastifyInstance } from "fastify";
import type { Store } from "../../store/store.js";
import type { UserPatch } from "../../store/types.js";
import { renderUsersPage } from "../views/users.js";

interface UsersDeps {
  store: Store;
  onChange: () => void;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersDeps): void {
  app.get("/users", async (_req, reply) => {
    reply.type("text/html");
    return renderUsersPage(deps.store.listUsers());
  });

  app.post<{ Body: { name: string; pin: string } }>("/users", async (req, reply) => {
    await deps.store.addUser({ name: req.body.name, pin: req.body.pin });
    deps.onChange();
    reply.redirect("/users");
  });

  app.post<{ Params: { id: string }; Body: { name?: string; pin?: string; enabled?: string } }>(
    "/users/:id/edit",
    async (req, reply) => {
      const user = deps.store.getUser(req.params.id);
      if (!user) return reply.code(404).send("not found");
      const patch: UserPatch = {};
      if (req.body.name && req.body.name !== user.name) patch.name = req.body.name;
      if (req.body.pin && req.body.pin !== "") patch.pin = req.body.pin;
      if (Object.keys(patch).length > 0) {
        await deps.store.updateUser(user.id, patch);
        deps.onChange();
      }
      reply.redirect("/users");
    },
  );

  app.post<{ Params: { id: string } }>("/users/:id/toggle", async (req, reply) => {
    const user = deps.store.getUser(req.params.id);
    if (!user) return reply.code(404).send("not found");
    await deps.store.updateUser(user.id, { enabled: !user.enabled });
    deps.onChange();
    reply.redirect("/users");
  });

  app.post<{ Params: { id: string } }>("/users/:id/delete", async (req, reply) => {
    await deps.store.deleteUser(req.params.id);
    deps.onChange();
    reply.redirect("/users");
  });
}
