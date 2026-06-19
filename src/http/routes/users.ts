import type { FastifyInstance } from "fastify";
import type { Store } from "../../store/store.js";
import type { UserPatch } from "../../store/types.js";
import { renderUsersPage, renderUserRow, renderUserRowEdit } from "../views/users.js";

interface UsersDeps {
  store: Store;
  readOnly?: boolean;
  onChange: () => void;
}

export function registerUsersRoutes(app: FastifyInstance, deps: UsersDeps): void {
  app.get("/users", async (req, reply) => {
    reply.type("text/html");
    return renderUsersPage(deps.store.listUsers(), {
      ...(deps.readOnly !== undefined ? { readOnly: deps.readOnly } : {}),
      basePath: req.basePath,
    });
  });

  app.post<{ Body: { name: string; pin: string } }>("/users", async (req, reply) => {
    if (!/^[0-9]{4,10}$/.test(req.body.pin)) {
      return reply.code(400).send("invalid pin");
    }
    if (!req.body.name?.trim()) {
      return reply.code(400).send("name required");
    }
    await deps.store.addUser({ name: req.body.name.trim(), pin: req.body.pin });
    deps.onChange();
    reply.redirect(`${req.basePath}/users`);
  });

  app.post<{ Params: { id: string }; Body: { name?: string; pin?: string; enabled?: string } }>(
    "/users/:id/edit",
    async (req, reply) => {
      const user = deps.store.getUser(req.params.id);
      if (!user) return reply.code(404).send("not found");
      if (req.body.pin && req.body.pin !== "" && !/^[0-9]{4,10}$/.test(req.body.pin)) {
        return reply.code(400).send("invalid pin");
      }
      const patch: UserPatch = {};
      if (req.body.name && req.body.name !== user.name) patch.name = req.body.name;
      if (req.body.pin && req.body.pin !== "") patch.pin = req.body.pin;
      if (Object.keys(patch).length > 0) {
        await deps.store.updateUser(user.id, patch);
        deps.onChange();
      }
      const htmx = req.headers["hx-request"] === "true";
      if (htmx) {
        const updated = deps.store.getUser(user.id)!;
        reply.type("text/html");
        return renderUserRow(updated, { basePath: req.basePath });
      }
      reply.redirect(`${req.basePath}/users`);
    },
  );

  app.get<{ Params: { id: string } }>("/users/:id/row", async (req, reply) => {
    const user = deps.store.getUser(req.params.id);
    if (!user) return reply.code(404).send("not found");
    reply.type("text/html");
    return renderUserRow(user, { basePath: req.basePath });
  });

  app.get<{ Params: { id: string } }>("/users/:id/edit-form", async (req, reply) => {
    const user = deps.store.getUser(req.params.id);
    if (!user) return reply.code(404).send("not found");
    reply.type("text/html");
    return renderUserRowEdit(user, { basePath: req.basePath });
  });

  app.post<{ Params: { id: string } }>("/users/:id/toggle", async (req, reply) => {
    const user = deps.store.getUser(req.params.id);
    if (!user) return reply.code(404).send("not found");
    await deps.store.updateUser(user.id, { enabled: !user.enabled });
    deps.onChange();
    reply.redirect(`${req.basePath}/users`);
  });

  app.post<{ Params: { id: string } }>("/users/:id/delete", async (req, reply) => {
    await deps.store.deleteUser(req.params.id);
    deps.onChange();
    reply.redirect(`${req.basePath}/users`);
  });
}
