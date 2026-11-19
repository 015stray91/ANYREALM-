/**
 * Connect router: joins the terminal's machines to the platform's routing.
 *
 * There are two things in this app that talk about where work happens, and
 * until now they did not know about each other:
 *
 *   The compile router (the platform) decides where a build runs: local, a
 *   GitHub Actions runner, or a remote host over SSH. It has runners, an
 *   endpoint pool per runner, a standing route, and a temporary route that
 *   expires.
 *
 *   The terminal's settings hold two machines — one for the model, one for
 *   builds. They are the same kind of object: an SSH-reachable host with a pool
 *   of addresses.
 *
 * Two lists of hosts is a bug waiting to happen: you add an address in one place
 * and the build goes to the other. So this module is the join. The terminal owns
 * *which machines exist*; the compile router owns *where the next build goes*.
 * Syncing publishes the engine connection as a runner, and routing points the
 * standing or temporary route at it.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 *   It does not copy endpoints into the routing file and then forget them. The
 *   engine connection stays the source for its addresses, and a sync replaces
 *   the published runner's pool wholesale. Drift is therefore impossible by
 *   construction rather than detected after the fact.
 *
 *   It does not overwrite runners it did not create. A runner is only replaced
 *   if its id carries the `engine:` prefix this module gave it, so a hand-made
 *   runner with a similar name survives.
 *
 *   It does not set the route silently. Publishing a runner and choosing it for
 *   builds are two different decisions, and a tool that does both at once has
 *   made a choice the user did not.
 *
 * The routing rules themselves live in the core (compile-routing.ts), including
 * the target/kind check and the "a temporary route is in force" note. This
 * module calls those endpoints rather than reimplementing them, because a second
 * copy of a validation rule is a second rule that can disagree.
 */

/** The runner id this module publishes under, so it can recognise its own. */
function publishedRunnerId(connectionId) {
  return `engine:${connectionId}`;
}

/**
 * Call the core app's own HTTP API.
 *
 * The port comes from the request being served, not from a constant: the app
 * runs on whatever port it was started with, and hardcoding 3000 would break a
 * packaged build or a second instance.
 *
 * This is a self-call within one process. It is used here because the routing
 * rules — which target kinds exist, whether a runner matches a target, what a
 * temporary route means — are already implemented and validated in the core, and
 * a duplicate implementation in plain JS would drift.
 */
async function coreApi(req, pathname, init) {
  const port = req.socket?.localPort;
  if (!port) throw new Error("cannot determine the app's own port");
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/* ------------------------------------------------------------------ */

export function mountConnectRouter(ctx, vm) {
  /**
   * The unified view.
   *
   * Everything the UI needs to answer "is the machine the terminal knows about
   * the machine builds go to" without asking two endpoints and comparing by
   * hand.
   */
  ctx.route("/connect", async (req, res) => {
    let routing = null;
    let routingError = null;
    try {
      const r = await coreApi(req, "/api/routing");
      if (r.ok) routing = r.body;
      else routingError = r.body?.error ?? `routing returned ${r.status}`;
    } catch (e) {
      routingError = e.message;
    }

    const connections = vm.connections();
    const engine = connections.find((c) => c.purpose === "engine") ?? null;
    const model = connections.find((c) => c.purpose === "model") ?? null;

    const runners = routing?.runners ?? [];
    const published = engine ? runners.find((r) => r.id === publishedRunnerId(engine.id)) ?? null : null;

    // Drift: the addresses the terminal holds vs the ones the build would use.
    // Compared as sets of `user@host`, because that is what actually reaches a
    // machine — labels and ids are bookkeeping.
    const terminalAddrs = engine ? engine.endpoints.map((e) => `${e.user}@${e.host}`).sort() : [];
    const runnerAddrs = published ? (published.endpoints ?? []).map((e) => `${e.user}@${e.host}`).sort() : [];
    const inSync = published && terminalAddrs.length === runnerAddrs.length && terminalAddrs.every((a, i) => a === runnerAddrs[i]);

    const effective = routing?.effective ?? null;
    const routeUsesEngine = !!(effective && effective.target === "remote" && published && effective.runnerId === published.id);

    res.json({
      /** Machines the terminal knows, with what each is for. */
      connections: connections.map((c) => ({
        id: c.id,
        purpose: c.purpose,
        label: c.label,
        provider: c.provider,
        addresses: c.endpoints.map((e) => ({ id: e.id, user: e.user, host: e.host, kind: e.kind, active: e.id === c.activeId })),
        activeAddress: c.active ? `${c.active.user}@${c.active.host}` : null,
        /** Model only: whether the assistant can currently reach it. */
        reachable: c.purpose === "model" ? c.tunnel?.up === true : !!c.active,
      })),

      /** What the build router currently is. */
      routing: routing
        ? {
            target: routing.route?.target ?? null,
            runnerId: routing.route?.runnerId ?? null,
            effective: effective ? { target: effective.target, runnerId: effective.runnerId, temporary: !!effective.temporary, expiresAt: effective.expiresAt ?? null } : null,
            temporary: routing.temporary
              ? { target: routing.temporary.route.target, runnerId: routing.temporary.route.runnerId, expiresAt: routing.temporary.expiresAt }
              : null,
            runners: runners.map((r) => ({ id: r.id, label: r.label, kind: r.kind, address: r.address ?? r.host, activeEndpointId: r.endpointId ?? null })),
            warnings: routing.warnings ?? [],
          }
        : null,
      routingError,

      /** The join, stated plainly so the UI can show a single status line. */
      bridge: {
        engineConnection: engine?.id ?? null,
        publishedRunnerId: published?.id ?? null,
        published: !!published,
        inSync,
        drift: published && !inSync ? { terminal: terminalAddrs, runner: runnerAddrs } : null,
        routeUsesEngineConnection: routeUsesEngine,
        /** The one thing to do next, or nothing. */
        nextStep: !engine?.endpoints?.length
          ? "add an address for the build engine in Settings"
          : !published
            ? "publish the build engine as a runner"
            : !inSync
              ? "the engine's addresses changed — republish to bring the runner up to date"
              : !routeUsesEngine
                ? "point the build route at this runner"
                : null,
      },

      /** Model side: what the assistant is answering from, if anything. */
      model: model
        ? {
            connectionId: model.id,
            modelName: model.modelName ?? null,
            tunnelUp: model.tunnel?.up === true,
            tunnelPort: model.tunnelPort,
            provider: vm.providerBase() ? "vm-tunnel" : null,
          }
        : null,
    });
  });

  /**
   * Publish the engine connection as a runner.
   *
   * Replaces the pool wholesale, which is what makes drift impossible: the
   * runner's addresses are always exactly the terminal's, not a merge of two
   * lists that can disagree.
   */
  ctx.route("/connect/publish", async (req, res) => {
    const connections = vm.connections();
    const engine = connections.find((c) => c.purpose === "engine");
    if (!engine) return res.status(400).json({ error: "no build engine connection" });
    if (!engine.endpoints.length) {
      return res.status(400).json({
        error: "the build engine has no address yet — add one in Settings before publishing it as a runner",
      });
    }

    const id = publishedRunnerId(engine.id);
    const body = {
      id,
      label: req.body?.label ?? `${engine.label} (${engine.provider})`,
      kind: "remote",
      workDir: req.body?.workDir ?? "",
      notes: req.body?.notes ?? `published from the terminal's build engine connection`,
      endpoints: engine.endpoints.map((e) => ({
        id: e.id,
        label: `${e.label} (${e.kind})`,
        user: e.user,
        host: e.host,
        port: 22,
      })),
      // Preserve the terminal's active address, so the build goes to the same
      // place the probe succeeded against.
      endpointId: engine.activeId ?? null,
      cores: engine.active?.lastProbe?.cores ?? undefined,
      ramGb: engine.active?.lastProbe?.ramGb ?? undefined,
    };

    const r = await coreApi(req, "/api/routing/runners", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!r.ok) return res.status(400).json({ error: r.body?.error ?? `routing refused the runner (${r.status})` });

    res.json({
      ok: true,
      runnerId: id,
      addresses: body.endpoints.map((e) => `${e.user}@${e.host}`),
      // Publishing is not routing. Say so, so the user knows the build has not
      // moved yet.
      note: "published as a runner — the build route has not changed",
    });
  });

  /**
   * Point the build route at the published runner.
   *
   * `temporary` routes it for N minutes and stores what to fall back to, reusing
   * the core's existing semantics rather than inventing a second notion of
   * "for now".
   */
  ctx.route("/connect/route", async (req, res) => {
    const connections = vm.connections();
    const engine = connections.find((c) => c.purpose === "engine");
    if (!engine) return res.status(400).json({ error: "no build engine connection" });
    const id = publishedRunnerId(engine.id);

    const minutes = Number(req.body?.minutes ?? 0);
    if (minutes > 0) {
      const r = await coreApi(req, "/api/routing/temporary", {
        method: "POST",
        body: JSON.stringify({
          target: "remote",
          runnerId: id,
          minutes,
          note: req.body?.note ?? "sent here from the terminal's connect router",
        }),
      });
      if (!r.ok) return res.status(400).json({ error: r.body?.error ?? `routing refused (${r.status})` });
      return res.json({ ok: true, temporary: true, effective: r.body.effective, expiresAt: r.body.temporary?.expiresAt ?? null });
    }

    const r = await coreApi(req, "/api/routing/route", {
      method: "POST",
      body: JSON.stringify({
        target: "remote",
        runnerId: id,
        reason: req.body?.reason ?? "set from the terminal's connect router",
      }),
    });
    if (!r.ok) return res.status(400).json({ error: r.body?.error ?? `routing refused (${r.status})` });

    res.json({
      ok: true,
      temporary: false,
      effective: r.body.effective,
      // The core's own note about a temporary route in force is passed through
      // rather than reworded: it is the authoritative statement.
      note: r.body.note ?? null,
      warnings: r.body.warnings ?? [],
    });
  });

  /** Hand the build route back to local, without touching the runner. */
  ctx.route("/connect/route/clear", async (req, res) => {
    const r = await coreApi(req, "/api/routing/temporary", { method: "DELETE" });
    const r2 = await coreApi(req, "/api/routing/route", {
      method: "POST",
      body: JSON.stringify({ target: "local", reason: "cleared from the terminal's connect router" }),
    });
    res.json({
      ok: r2.ok,
      clearedTemporary: r.ok,
      effective: r2.body.effective ?? null,
      error: r2.ok ? null : r2.body?.error,
    });
  });

  ctx.log("connect router: terminal machines are publishable as build runners");
}
