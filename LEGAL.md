# Legal notes

CPM: Motor Edition is an **unofficial, non-commercial fan project**. It is not affiliated with, authorized by, sponsored by or endorsed by Honda, Suzuki, or any other company named in it. All product names, brands and trademarks belong to their owners and are used only to say which real motorcycle a model represents.

This is a working risk note for the maintainer, not legal advice. It records what the game borrows from the real world, how risky each thing is, and the rules to keep it that way. If the project ever becomes public-facing or earns money, talk to a lawyer (preferably one who knows Philippine IP law) before launch.

## Current status

- Free, no ads, no donations, no accounts, no data collected.
- Played by friends and shared as a GitHub Pages link.
- Code is MIT (`LICENSE`). Dependencies are credited in `THIRD_PARTY.md`.
- No images, fonts, audio samples or text from manufacturers are in the repo. Textures are procedural, sound is synthesized.
- Since Build 8.1 no model or gauge carries real branding (the CBR belly-pan lettering is pixelated gibberish). Real names remain only in text: bike names, feature names, paint names.
- Reference photos were used only as a visual guide while modelling. They are not stored here and must not be added.

Overall risk today: **low**. The risks below grow quickly with publicity or money.

## What touches third-party rights

| Item | Where | Why it matters | Suggested handling |
|---|---|---|---|
| ~~HONDA wordmark on the CBR650R belly pan~~ | `js/model.js` (`DEC` / `MDec`) | **Resolved in Build 8.1:** replaced by five pixelated pseudo-letters (seeded noise), no real branding on any model. This was the highest-risk item because it read as official branding. | Keep it unbranded. Never put a real wordmark back. |
| Bike names: "Honda Click 125i", "Honda CBR650R", "Honda TMX Supremo", "Suzuki Raider R150 Fi", "Suzuki Smash 115 / Fi", "Yamaha Aerox 155", "Kawasaki Rouser NS125 Fi", "Rusi Macho 125", "Kawasaki Ninja H2" (and "H2R" in its track-kit option) | `data/bikes/*.json`, `index.html`, `README.md`, garage picker | Trademarks used to identify the real model. Commonly tolerated when non-commercial and not misleading, but not a guaranteed right. | Keep the disclaimer. Be ready to switch to generic labels (see "If going public"). |
| Honda feature names: "Honda E-Clutch" / "E-Clutch", "V-Matic", "eSP", "Idling Stop" | `data/bikes/cbr650r.json` (garage toggle, hint), `data/bikes/click125.json`, `js/hud.js` ("IDLING STOP"), `js/drivetrain.js` (comments), `README.md` | Marketing terms and marks. In-game gauge lettering was already made generic in Build 8.1 ("PGM-FI" → "FI", "E-CLUTCH" → "AUTO CLU"), but the garage label, bike blurb and README still use the Honda names. | Prefer generic wording ("Auto clutch"). |
| CBR650R paint names: "Grand Prix Red", "Matt Gunpowder Black", "Graphite Black" | `data/bikes/cbr650r.json` | Manufacturer colour names. | Rename generically (e.g. "Red Tricolour", "Matte Black", "Graphite"). |
| Raider paint names ("Titan Blue", "Glass Black", "Racing Red") | `data/bikes/raider150.json` | May mirror factory colour names. Not checked. | Check, and rename if they match. |
| Yamaha feature names: "VVA" (bike tag and blurb), "Stop & Start System" (garage toggle label, blurb, hint) | `data/bikes/aerox155.json`, `README.md` | Marketing terms and probably marks, same situation as the Honda feature names above. The in-game behaviour is just an idle-stop; the Yamaha names are not needed to describe it. | Prefer generic wording ("Variable valve timing", "Idle stop / auto restart"). |
| Aerox paint names: "Icon Blue", "Matte Black / Cyan", "Matte Gray / Cyan", "White / Red", "Black / Red" | `data/bikes/aerox155.json` | "Icon Blue" may mirror a factory colour name; the others are descriptive. Not checked against Yamaha's colour list. | Check "Icon Blue", rename generically (e.g. "Deep Blue") if it matches. |
| Ninja H2 paint and feature wording ("Mirror chrome / black", "Matte mirror / carbon", "Gloss black / green"; "Quickshifter", "Traction control", "Power mode") | `data/bikes/ninjah2.json` | Descriptive words, not Kawasaki's colour names ("Mirror Coated Spark Black") or feature marks (KQS, KTRC). The "H2R-style track kit" option names a real model to say what it imitates. | Fine. Keep the descriptive wording; drop "H2R" if asked. |
| TMX Supremo, Rouser NS125 and Macho 125 paint names ("Red", "Black", "Blue"; "Yellow", "Grey", "Black") | `data/bikes/tmx155.json`, `ns125.json`, `macho125.json` | Plain colour words, no factory names seen. | Fine. Keep them descriptive. |
| Statements of fact about real products in blurbs: TMX "Factory sidecar mounts" and "The Philippine workhorse", Macho "The budget classic" and "Takes the tricycle sidecar", Rouser "Built by Bajaj and sold by Kawasaki in the Philippines", Aerox "ABS on the S" | `data/bikes/tmx155.json`, `macho125.json`, `ns125.json`, `aerox155.json` | Claims about who builds, sells or supports a real product. If wrong they are misstatements, and "Factory sidecar mounts" can read as the maker approving sidecar use. Not verified against the makers' or distributors' material. | Verify each, or drop them. Reword to "sidecar mounts" (no "Factory"). Keep marketing slogans out of blurbs. |
| Supplier names in text ("Showa" in the CBR blurb) | `data/bikes/cbr650r.json`, comment in `js/model.js` | Component-maker marks. | Drop from user-visible text. |
| Body shapes and liveries (CBR650R traced from photos; Click, Raider, TMX Supremo, Aerox 155, Rouser NS125 and Macho 125 modelled after reference photos, Ninja H2 traced from a side photo, per the comments in `js/model.js`; the Macho reuses the TMX builder) | `js/model.js` | Industrial design and trade dress. Low-poly, stylised, no real logos or lettering, but recognisably the real bikes. | Keep stylised. Don't add more detail that gets closer to a copy. Avoid exact factory decal artwork. |
| Spec figures (power, weight, gearing, geometry) | `data/bikes/*.json`, `README.md` | Facts are not copyrightable. | Fine. Don't paste text, tables or images from owner's manuals or spec sheets. |
| Name "CPM" | project title | Resembles the title of *Car Parking Multiplayer*, a commercial mobile game. | Fine for a repo. Rename before any app-store listing. |

Not an issue as far as the repo shows: jeepneys, tricycles, palms, the island and the town (generic or invented), the fictional "MSR49" plate text, and gas-station props (no real brand names found).

## Risk by situation

| Situation | Risk | Notes |
|---|---|---|
| Friends-only playtests, free | Low | Today. |
| Free public link, shared on social media | Moderate | More likely to be noticed by brand owners. Make the remaining Honda feature and paint names generic first. |
| Ads, donations, paywall, in-game purchases | High | Commercial use of third-party marks and designs. Use generic names and get permission or advice first. |
| App store / Play Store listing | High | Stores check for trademark and IP complaints. "CPM" name also needs changing. |
| Marketing as "the real Honda / Suzuki experience" | High | Suggests endorsement. Never do this. |

## Rules for new content

1. **No manufacturer logos or wordmarks** (Honda wing/wordmark, Suzuki "S", brand badges, tank or fairing lettering). Use a neutral word or none.
2. **No real lettering on models or gauges**, even as a decal "for realism". Pseudo-letters are fine.
3. **No reference photos, scans or manual text in the repo.** Trace shape, don't copy artwork.
4. **No factory decal artwork.** Livery graphics are simple shapes in the livery texture (`drawLivery`).
5. **Name new bikes with a clear "unofficial" context.** Prefer a generic display name in the UI and keep the real model name only where needed to say what it represents.
6. **Use generic names for parts and features** in new code and data. Do not use aftermarket brand names (exhausts, tyres, suspension) in garage options.
7. **Keep textures procedural and sound synthesized.** If a sample, font or image is ever added, record its license in `THIRD_PARTY.md`.
8. **No real people, real plates, real shops or real businesses** in the world.
9. **Every new dependency** gets a row in `THIRD_PARTY.md`.

## If going public or commercial

Do these before any wider launch:

- Rename the remaining Honda feature and paint names generically (the decal and gauge lettering are already unbranded).
- Add a **generic names** option (for example "Scooter 125", "Underbone 150", "Supersport 650"), either as the default or as a switch. This removes most trademark exposure with one change.
- Or ask Honda and Suzuki (Philippines) for written permission.
- Rename the project if "CPM" would be confused with *Car Parking Multiplayer*.
- Get legal advice on trade dress and industrial design for the bike models.
- Add a privacy notice if you start collecting any player data. The game currently stores only settings in the browser (`localStorage`).

## If you receive a complaint or takedown notice

1. Don't ignore it. Rights holders usually start with a polite letter or a GitHub notice.
2. Remove or rename the named item right away. Because the data is JSON and the decal is one material, this is a small change.
3. Keep a copy of the notice and of what you changed.
4. For anything beyond a simple rename, get legal advice before replying.

GitHub can disable a repository or Pages site on a valid notice, so keep a local copy of the project.

## Jurisdiction

The Philippine Intellectual Property Code (Republic Act No. 8293, as amended) covers copyright, trademarks and industrial designs. Its copyright part has a fair-use provision, but fair use is a copyright idea and does not make using someone's trademark safe. Trademark questions mostly turn on whether people could be confused about who made or endorsed the product. The game is hosted worldwide and may be played abroad, where the rules differ. Treat this file as a risk checklist and not as a statement of what is allowed in any particular country.

## Review log

- 2026-10-24: Initial review at Build 8.0 (Raider R150 Fi, Click 125i, CBR650R). Build 8.1 then removed the HONDA decal and made gauge lettering generic. Open items: Honda feature and paint names in text, Raider paint names (unchecked), supplier name in the CBR blurb.
- 2026-10-26: Build 11.32 added the TMX Supremo, Aerox 155, Rouser NS125 and Macho 125 (they had no rows). This pass added their names, the Yamaha feature and paint names, and a row for factual claims in blurbs. Drafted from the repo's own data and the `js/model.js` comments, not checked against any manufacturer, distributor or colour list. Open items: Yamaha feature names, "Icon Blue", the "Factory sidecar mounts" wording, and verifying the blurb claims.
