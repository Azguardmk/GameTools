# Earthlings Tools

A shared web tool for the Earthlings team:

- **Tasks**: a task board with theme groups, pinned columns, a checkbox to mark tasks done, assignee badges and filters.
- **Quests**: a node editor for quest chains. It has quests, conditions, player choices, links to quests in other chains, objectives, required items, rewards and problem checks, and exports JSON for Unreal.
- **Quest map**: every quest by name, grouped by chain, with links between chains.
- **Items**: an item database with categories, rarities, crafting recipes, blueprints, how to get each item and where it's used. It exports a CSV for an Unreal DataTable.
- **Definitions**: the lists everything else picks from (team members, item categories, rarities, stations, quest types, zones and so on). They export as JSON enums.

It's built with React, Vite and React Flow, hosted on GitHub Pages, with data in Supabase.

## Run it locally

```bash
npm install
npm run dev
```

With no Supabase keys, the app runs in **demo mode**: it fills itself with sample data and saves only in your own browser. That's handy for trying things out, but nothing is shared.

## Make it shared (Supabase, free tier)

1. Create a project at <https://supabase.com>.
2. In **SQL Editor**, paste and run [`supabase/schema.sql`](supabase/schema.sql). It creates the tables, allows only signed-in users, and turns on live updates.
3. In **Authentication → Sign In / Providers → Email**, keep email enabled. Then in **Authentication → Users**, use **Invite user** for yourself and each collaborator. The login screen only lets in invited emails (`shouldCreateUser: false`).
4. In **Authentication → URL Configuration**, set **Site URL** to your GitHub Pages address (e.g. `https://<owner>.github.io/GameTools/`) and add it under **Redirect URLs**.
5. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.
6. For local development, copy `.env.example` to `.env.local` and fill in the two values.
7. The first time someone signs in, the app offers to **Load starter data** (the lists from the design plus samples). Edit or delete anything afterwards.

The anon key is meant to be public. Access is protected by the row-level security policies in `schema.sql`, which allow only signed-in users.

## Deploy to GitHub Pages

1. In the repo, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
2. In **Settings → Secrets and variables → Actions**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
3. Push to `main` (or run the workflow by hand from the **Actions** tab). The site appears at `https://<owner>.github.io/<repo>/`.

## How the data fits together

| Table | What it holds |
|---|---|
| `members` | Team members (name, initials, badge colour) |
| `definitions` | Every pre-defined list; `list` says which one, `extra` holds list-specific fields (ID prefix, default stack, tier, region) |
| `task_groups`, `tasks` | The task board |
| `items` | Items; `sources` and `recipe` are JSON; `teaches` links a blueprint to the item it teaches |
| `quest_chains`, `quest_nodes`, `quest_edges` | The quest graph; nodes are `quest`, `condition`, `choice` or `external` (a quest in another chain) |

Items, quests and tasks point at definitions by ID, so renaming a category or rarity updates everything that uses it. Definitions that are in use can't be deleted.

## Exports for Unreal

- **Items → Export DataTable (CSV)**: the first column is the row name (item ID). Category, rarity and station are written as enum keys (`QuestItem`, `Rare` and so on).
- **Quests → Export to Unreal (JSON)**: every chain with its quests, objectives, required items, rewards and prerequisites (quest IDs, conditions and choices).
- **Definitions → Export all lists (JSON)**: each list as `E_<Name>` with keys, display names and colours.

The column names are a starting point. Match them to your `FTableRowBase` structs and adjust `src/pages/Items.tsx` and `src/pages/Quests.tsx` if needed.
