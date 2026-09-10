# Nexus

A minigame network you can host — hub, queue, parties, ranks, persistent stats,
and Bed Wars. **Players join with an unmodified Minecraft client.** No launcher,
no modpack, nothing to install on their end.

Paper 1.21.11, Java 21.

## Running it

Through the launcher: host a **Paper** server, then add `nexus-0.1.0.jar` to its
plugins. The launcher already puts plugin jars in the right folder.

By hand:

```
cp build/libs/nexus-0.1.0.jar <server>/plugins/
```

Start the server. It builds its own `nexus_hub` world on first boot and does not
touch the world you already have.

## The spawn castle

Generated on first boot, in about 800ms. 120 blocks across:

- A **moat** with a stone bridge you cross to arrive
- **Curtain walls** 15 blocks high with a walkway, crenellations and arrow slits
- **Round corner towers** with stepped spires and lit windows
- A **gatehouse** with an arched tunnel, a half-lowered portcullis and banners
- A **keep** forty blocks tall, hollow, with three floors, corner turrets and
  windows that glow at night
- A **courtyard** with paved roads, a ring road, lamp posts and trees

The masonry is deliberately mixed - roughly one block in six mossy, one in eight
cracked. At this size a single material reads as a flat texture rather than as
stonework.

## The worlds

Four greeters stand in the courtyard between the gate and the keep, facing you
as you walk in. Right click one to go there.

| | |
| --- | --- |
| **Survival** | A normal generated world. Keep what you make, sell what you find. |
| **Prison** | Ten ranks, A to J, each with its own mine. Mine, sell, rank up. |
| **Bed Wars** | Puts you in the queue rather than teleporting you. |
| **Creative** | A flat sheet where none of it counts. |

## Money

One currency across every world, so nothing is stranded. Mine or farm, then
`/sell all` (which never sells what you are holding), and spend it in `/shop`.
Prison rankups cost money; minigame coins are kept separate on purpose so
winning at Bed Wars cannot buy a prison rank.

## Using your own spawn build

The generated lobby is a default, not a requirement. To use a town you
downloaded:

1. Paste it into the `nexus_hub` world with WorldEdit
2. Stand where players should land: `/nexus setspawn`
3. Stand where each greeter should be: `/nexus setnpc survival` (and prison,
   bedwars, creative)

`/nexus setspawn` switches on `spawn.custom`, after which the plugin never
generates or touches the build. It only places the four NPCs where you said.

Most builds on schematic sites are 1.12-era `.schematic` files; WorldEdit
converts them, usually cleanly.

## What is there

**The hub.** The castle. No damage, no hunger, nothing to break. A compass in
the middle of the hotbar opens the game menu.

**The queue.** Pick a game and you are told exactly where you stand — how many
are waiting, how many are needed, how long is left. A countdown starts at the
minimum and skips to zero when the lobby is full.

**Parties.** `/party invite`, `accept`, `leave`, `list`, `kick`. A party queues
together, lands in the same match, and is put on the same team. That last part
is the whole reason the feature exists.

**Ranks and stats.** Wins, kills, K/D, beds broken, best streak, coins. Shown on
the hub sidebar, in `/stats`, and in `/leaderboard`. Ranks colour the chat and
sort the tab list; `/nexus setrank <player> <rank>` hands them out.

**Bed Wars.** Four teams, four beds, generators, a shop and team upgrades.
Break a bed and that team stops respawning. Standard prices, because a decade of
people playing them balanced those better than I would.

- Base iron and gold, faster with the Iron Forge upgrade
- Diamonds and emeralds in the middle, on tiers that escalate on a clock
- Two villagers per base: items, and team upgrades
- Sudden death at twenty minutes, so a stalemate cannot run forever
- Minimum **two players**, not eight — a game that needs eight never starts on
  a server with five

## Commands

| Command | What it does |
| --- | --- |
| `/hub` | Leave a game or a queue |
| `/party …` | invite, accept, leave, list, kick |
| `/stats [player]` | Your record, or somebody else's |
| `/leaderboard` | Top ten by wins |
| `/nexus setrank <player> <rank>` | PLAYER, VIP, MVP, ADMIN, OWNER |
| `/nexus testarena` | Build a Bed Wars map, check its geometry, throw it away |
| `/nexus check` | Verify the castle built and the greeters are standing |
| `/nexus setspawn` | Use your own lobby build instead of the castle |
| `/nexus setnpc <world>` | Move a greeter to where you are standing |
| `/nexus pay <player> <amount>` | Give somebody money |
| `/nexus save` | Force a stats write |

`/nexus testarena` is worth knowing about. The maps are generated rather than
pasted from a schematic, so the failure mode is geometry that is quietly wrong —
a bed whose two halves disagree, a spawn inside a block. It checks all of that
against a real generated map and takes about 170ms.

## Two decisions worth knowing about

**Maps are built in code, not pasted from schematics.** No file to ship, to keep
in step with the plugin, or to explain when it is missing — and perfect symmetry,
which matters more in Bed Wars than almost anywhere else because an asymmetry is
an unfair advantage nobody can see.

**Every match gets a fresh world, deleted afterwards.** The usual approach is to
remember every block a player changed and put it back, which works until a TNT
chain or a bucket of lava leaves the next match subtly wrong. A world built from
nothing has no state to restore, so arena reset is not a feature that can be
incomplete. It costs a few seconds and a few megabytes per match.

## Adding a second game

`Game` is an interface and the shell knows nothing about beds. Implement it,
register it in `Nexus.onEnable`, and it appears in the selector with a working
queue, countdown, party handling and stats:

```java
games.register(new Duels());
```
