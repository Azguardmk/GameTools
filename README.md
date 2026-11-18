# Earthlings Tools

A shared web tool for the Earthlings team:

- **Tasks**: a task board with theme groups, pinned columns, a checkbox to mark tasks done, assignee badges and filters.
- **Quests**: a node editor for quest chains, inspired by narrative tools like Arcweave and Drafft. Node types are Start, Quest, Dialogue (a character's line, with player replies as links), Choice, Condition (checks a story variable and leaves through Yes or No), Set variable, Quest from another chain, End (success, failure or abandoned) and Note. **Play mode** walks through a chain like a player, running conditions and variable changes as it goes. There are problem checks too, and it exports the full flow as JSON for Unreal.
- **Quest map**: a flow chart of whole quest chains (coloured by quest type) with Start, End, AND, OR, Pick one and Go back nodes, coloured links with arrows, and reward totals per chain for balancing.
- **Map**: one map per level (region) with every NPC as a star in their colour. NPC profiles (Definitions → Characters / NPCs → Profile) hold their portrait, looks, story, relations and map location.
- **Items**: an item database with categories, rarities, crafting recipes, blueprints, how to get each item and where it's used. It exports a CSV for an Unreal DataTable.
- **Definitions**: the lists everything else picks from (team members, regions, districts, characters, story variables, item categories, rarities, quest types and so on). They export as JSON enums.

It's built with React, Vite and React Flow, hosted on GitHub Pages, with data in Supabase.

## Run it locally

```bash
npm install
npm run dev
```

The app connects to the team's Supabase project (`earthlings-tools` in the ThePixelator organization, set in `src/lib/db.ts`), so you sign in with your invited email. To try things without a database, run `VITE_DEMO=1 npm run dev`. Demo mode fills itself with sample data and saves only in your browser.

## Supabase setup

The database tables, security rules and live updates are already set up (`supabase/schema.sql`). Three things have to be done in the Supabase dashboard:

1. **Authentication → URL Configuration**: set **Site URL** to `https://azguardmk.github.io/GameTools/` and add the same address (plus `http://localhost:5173/` for local work) under **Redirect URLs**. Otherwise sign-in links point to the wrong place.
2. **Authentication → Users → Invite user**: invite yourself and each collaborator. Only invited emails can sign in.
3. The first person to sign in clicks **Load starter data** to fill in the lists (categories, rarities, quest types…) and the samples. Edit or delete anything afterwards.

The publishable key in the code is meant to be public. The row-level security policies only allow signed-in users to read or change data.

## Deploy to GitHub Pages

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. Push to `main` (or run **Deploy to GitHub Pages** from the **Actions** tab). The site is published at `https://azguardmk.github.io/GameTools/`.

## How the data fits together

| Table | What it holds |
|---|---|
| `members` | Team members (name, initials, badge colour) |
| `definitions` | Every pre-defined list; `list` says which one, `extra` holds list-specific fields (ID prefix, default stack, tier, a district's region and plot count) |
| `task_groups`, `tasks` | The task board |
| `items` | Items; `sources` and `recipe` are JSON; `teaches` links a blueprint to the item it teaches |
| `quest_chains`, `quest_nodes`, `quest_edges` | The quest graph per chain; `quest_chains.type` is its quest type |
| `map_nodes`, `map_edges` | The Quest map flow chart (chains and flow nodes, and the links between them) |

Level map images live in `public/maps/` (served with the site) and are linked from a region's `extra.map`. NPC map pins are in a character's `extra.pin` (`{ region, x, y }`, x/y from 0 to 1).

Items, quests and tasks point at definitions by ID, so renaming a category or rarity updates everything that uses it. Definitions that are in use can't be deleted.

## Exports for Unreal

- **Items → Export DataTable (CSV)**: the first column is the row name (item ID). Category, rarity and station are written as enum keys (`QuestItem`, `Rare` and so on).
- **Quests → Export to Unreal (JSON)**: the story variables, then every chain with its quests (objectives, required items, rewards, dialogue, prerequisites) and the full flow as `nodes` and `links`. A condition's link has an `output` of `Yes` or `No`, so a small runner in Unreal can play it.
- **Definitions → Export all lists (JSON)**: each list as `E_<Name>` with keys, display names and colours.

The column names are a starting point. Match them to your `FTableRowBase` structs and adjust `src/pages/Items.tsx` and `src/pages/Quests.tsx` if needed.

## Working on the code (for collaborators)

**Access you need**
1. **GitHub**: write access to `Azguardmk/GameTools`.
2. **Supabase dashboard** (only for database changes): membership of the **ThePixelator** organization (Organization → Team → Invite).
3. **The tool itself**: an invite under Authentication → Users. This is separate from dashboard access. Add yourself under Definitions → Team members too.

**Run it**
```bash
git clone https://github.com/Azguardmk/GameTools.git
cd GameTools
npm install
VITE_DEMO=1 npm run dev     # sample data in your browser only – safe to break
npm run dev                 # the real shared data – changes are live for everyone
```
Signing in on `http://localhost:5173/` needs that address in Supabase → Authentication → URL Configuration → Redirect URLs.

**How changes go live**
- Every push to `main` builds and deploys to GitHub Pages within about a minute (Actions → Deploy to GitHub Pages). A broken build stops the deploy, but a bug that still builds goes live.
- Work on a branch and open a pull request into `main`; merge when it's checked. Run `npm run build` before pushing – it type-checks everything.
- Pull before you start (`git pull --rebase`), since others (including Claude sessions) push to `main` too.

**Changing the database**
- Add the change to `supabase/schema.sql` (keep it re-runnable: `if not exists`, `add column if not exists`) and run it in the Supabase SQL editor.
- New tables also need: the `TABLES` list and types in `src/lib/types.ts`, row-level security + realtime (copy the loop at the bottom of `schema.sql`), and starter rows in `src/lib/seed.ts` for demo mode.
- All reads and writes go through `src/lib/db.ts` (`useTable`, `insert`, `update`, `remove`), which also records Undo / Redo. Don't call Supabase directly from pages.

**Where things are**
| Path | What |
|---|---|
| `src/App.tsx` | Shell, menu, sign-in, Undo/Redo, error guard |
| `src/lib/` | Data layer (`db.ts`), types and list definitions (`types.ts`), starter data, canvas size / full screen, map image upload |
| `src/pages/` | One file per tab; the quest editor's node types, Play mode, NPC library and NPC panel are in `src/pages/quest/` |
| `src/components/` | Shared UI: text fields, dropdowns, icons, NPC/item icons, the interactive map |
| `src/styles.css` | All styles (dark theme) |
