# Batter Up Bakery website

Cheesecake bakery site for Batter Up Bakery (Litchfield, ME) with online ordering and an owner dashboard. Built by [Real Easy Sites](https://getrealeasysites.com) on the Workbench layout.

## What's in it
- **Home** (`/`): logo hero, live flavor board (GF tags), sizes and prices, the three ways to get it with this week's dates, Find a Slice teaser, photo gallery, live Facebook feed, story.
- **Order online** (`/order`): whole cheesecakes (gluten-friendly crust only on GF flavors) and mini 6 / 10 packs with flavor limits enforced. Route meet-up (pick a stop), BUB Shed pickup (Wed to Sat) or UPS shipping in Maine. Saturday 6 PM cutoff (Maine time) sets the delivery week. No online payment: they pay at pickup/delivery as they do now.
- **Find a slice** (`/find`): every shop on the Tuesday/Wednesday routes, searchable by town, with directions links.
- **Dashboard** (`/admin`, password only): orders (status, delete), bake & route sheet (how many of each flavor to make, orders grouped by day and stop, printable), flavors, shops/route stops, prices, ordering on/off switch and a banner message.

Flavors, stops and prices are seeded from their pinned Facebook post on first run and are edited in the dashboard after that (deploys never overwrite them).

## Environment (Render)
| Variable | What it's for |
| --- | --- |
| `ADMIN_PASSWORD` | Dashboard password. Login is disabled until it's set. |
| `SESSION_SECRET` | Long random string for the login cookie. |
| `DATA_DIR` | Folder for the SQLite database. Point at the Render disk, e.g. `/var/data`. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email sending (Gmail: smtp.gmail.com, 465, realeasy365@gmail.com, app password). |
| `NOTIFY_EMAIL` | Where new-order emails go (likely batterupbakerymaine@outlook.com). |

Without SMTP the order is still saved; the log says `order BUB-XXXXX saved but NOT emailed`.

## Run locally
```
npm install
ADMIN_PASSWORD=test npm start
```
Node 20 (pinned in `.node-version` and `package.json`).
