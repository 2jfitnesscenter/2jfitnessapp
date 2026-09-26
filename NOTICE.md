# Notice

**2J Fitness Center App** is a modified version ("fork") of **openGym**. It is free software,
licensed under the **GNU Affero General Public License v3.0 or later** (`AGPL-3.0-or-later`) —
see [LICENSE](LICENSE). The full license text is not changed or replaced by this file.

## Original project

**openGym** — Copyright (C) 2026 Duarte Santos.
<https://github.com/DuarteSantos8/openGym> — licensed under the GNU AGPL v3.0 (or later).

openGym is the base of this application: the original workout tracker, its React/Vite
frontend and Node API, passkey sign-in, the exercise library integration, history import,
localization, the standalone mobile shell and the self-hosting setup. See [AUTHORS.md](AUTHORS.md)
for the people who contributed to it.

This fork descends from openGym through an intermediate fork by **Alex Costa**
(<https://github.com/alexpcosta/opengym>), which added the optional **AI Coach**.

## Modifications and additional development

Modifications and additional development — Copyright (C) 2026 **Juan Jose Perez Sanchez — 2J Fitness Center**,
licensed under the same terms (`AGPL-3.0-or-later`).

Main areas developed for 2J Fitness Center in this fork (summary, not exhaustive):

- **Training / Workout V2** — simple and detailed workout views, the 2J keypad, plate
  loading, progression assistant, rest timer and training guide.
- **2J Training Protocol v1.0** — rules, deterministic validator, save policy and the protocol
  gate for AI-generated plans.
- **Constructor V2 / V2.1** — trainer program builder by day and block, block library,
  guided block timing and 2J suggestions.
- **Official 2J blocks and routines** — the official block library, the official guided
  routines and their **collections**.
- **Guided Training** — the guided executor for circuits, intervals, HIIT/Tabata-format and
  mobility inside the workout.
- **Entrena con 2J** — the official guided workout library for members (storefront, detail,
  start, favourites, trainer assign/duplicate, admin curation).
- **Bunker** — the gym-floor screen and its multi-member session flow.
- **Mi 2J** — ranks, achievements, records and consistency.
- **Health / Fitness integration** — Health V2, measurements and bioimpedance, check-in,
  WHOOP, Strava, Bluetooth heart rate, training zones and recovery.
- **Sync V2** — server synchronisation with conflict handling and encrypted state at rest.
- **Trainer and gym features** — trainer panel, member plans, follow-up, AI-assisted routine
  generation and scanning, social, friends and chat.

The AI Coach itself comes from Alex Costa's fork; 2J Fitness Center extended it (additional
providers, the trainer side and the 2J protocol gate).

Where a source file was created in this fork, it carries a short header:

```
// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
```

Files inherited from openGym keep their original authorship, whether or not they were later
modified here; the project-level notices above apply to them.

## Keeping these notices

The AGPL requires anyone who conveys this program, or a modified version of it, to keep intact
the copyright and license notices — including the ones in this file, in [AUTHORS.md](AUTHORS.md)
and in the source headers — and to make the corresponding source available as the license
describes (including to users who interact with a modified version over a network, section 13).
This paragraph only restates the license; it adds no restriction beyond it.

## Also see

- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — exercise dataset, body diagram geometry,
  AI provider runtimes and open-source libraries, each under its own terms.
- [TRADEMARKS.md](TRADEMARKS.md) — the 2J Fitness Center name and logo.

An earlier openGym release granted an additional permission under AGPL section 7 for
app-store distribution. It is not carried by this fork (section 7 allows removing additional
permissions when conveying); nothing else about openGym's license changes.
