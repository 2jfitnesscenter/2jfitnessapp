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

Main areas developed for 2J Fitness Center in this fork, as present in this branch (summary,
not exhaustive):

- **Bunker** — the gym-floor screen.
- **Trainer panel** — member list and plans, AI-assisted routine generation and scanning of
  printed routines.
- **Health and measurements** — the health view, body measurements and bioimpedance, training
  zones and recovery, and the WHOOP and Strava connections.
- **Training aids** — progressive-overload suggestions, barbell plate loading, the gym clock
  and stretching.
- **Social** — social feed, friends and chat, badges and ranks.
- **Privacy** — members' state encrypted at rest on the server.

The AI Coach itself comes from Alex Costa's fork; 2J Fitness Center extended it (an additional
provider and the trainer side).

Files inherited from openGym keep their original authorship, whether or not they were later
modified here; the project-level notices above apply to every file in this repository.

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
