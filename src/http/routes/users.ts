import type { FastifyInstance } from "fastify";
import type { Store } from "../../store/store.js";
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
