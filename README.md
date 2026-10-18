# Know Your Health, Clyde

The website for the **Clyde High School Community Problem Solving (CmPS) 2026–27** health awareness project.

It gives Clyde and Abilene families short, plain-language info on 9 health topics, pulls live content from U.S. government health websites, shares our community survey results, and points people to local help.

- **Built with:** [Astro](https://astro.build) (static site), plain CSS, Markdown content
- **Live content:** a Netlify Function that calls [MyHealthfinder](https://odphp.health.gov/myhealthfinder) (health.gov) and [MedlinePlus](https://medlineplus.gov) (National Library of Medicine). No API keys are needed.
- **Hosting:** Netlify. Every push to `main` deploys automatically.

---

## Run it on your computer

You need **Node.js 22 or newer** (Astro 7 requires Node 22.22+). If you use `nvm`, run `nvm use` and it will read `.nvmrc`.

```bash
npm install        # first time only
npm run dev        # start the site at http://localhost:4321
```

`npm run dev` shows the whole site, but the **live health content** section shows "Live content unavailable" because the Netlify Function isn't running. To test the function too, use the Netlify CLI:

```bash
npm install -g netlify-cli   # first time only
netlify dev                  # site + functions at http://localhost:8888
```

Try the function directly: <http://localhost:8888/.netlify/functions/health-topic?topic=blood-pressure&lang=en>

Other commands:

| Command | What it does |
| --- | --- |
| `npm run build` | Builds the final site into `dist/`. Run this before pushing to catch mistakes. |
| `npm run preview` | Previews the built site. |
| `npm run images` | Converts the raw HEIC photos to WebP and JPG (Mac only; see below). |

---

## How to edit a health topic (no coding needed)

Each topic is one Markdown file in [`src/content/topics/`](src/content/topics/):

```
blood-pressure.md   blood-sugar.md   blood-donation.md
cpr.md              eating-right.md  high-cholesterol.md
mental-health.md    obesity.md       organ-donation.md
```

1. Open the file on GitHub (or in your editor) and click the pencil icon to edit.
2. The part between the `---` lines at the top is the **frontmatter**. It holds the lists on the page:
   - `hook`: the one-liner on the home page card
   - `quickFacts`, `signs`, `actions` (3–5 tips), `doctor`, `emergency`
   - `bonus`: the optional highlighted box (like "No-gym workouts")
   - `links`: 3–6 trusted links, each with `title`, `org`, `url`, and `note`
   - `related`: other topic file names to link at the bottom
3. Everything **below** the second `---` is the explainer. Use `## Heading` for headings and `**bold**` for bold.
4. Commit your change to `main`. Netlify rebuilds the site in about a minute.

Tips:
- Keep the same indentation (2 spaces) and the `- ` at the start of list items.
- If a line has a colon (`:`) in it, wrap the whole line in double quotes, like `- "Step 1: Call 911"`.
- If the build fails, Netlify keeps the old version live and the deploy log says which field is wrong.
- **Before adding a link, click it to make sure it works.**

---

## How to add an event

Edit [`src/data/events.json`](src/data/events.json) and add an entry:

```json
{
  "title": "Health Fair Booth",
  "date": "2027-03-14",
  "time": "9 a.m. – 1 p.m.",
  "location": "Clyde High School gym, Clyde, TX",
  "description": "Free blood pressure info, CPR demos, and more."
}
```

- `date` must be in `YYYY-MM-DD` format.
- Events before today move to "Past events" automatically the next time the site deploys.
- Add `"todo": true` to show "More details coming soon." Anything starting with `TODO` is hidden from visitors.

## Other things you can edit

| File | What's in it |
| --- | --- |
| `src/data/site.json` | Site name and **Instagram link** (`instagramUrl`) |
| `src/data/survey.json` | Survey totals (aggregate numbers only; **never** individual answers, names, or emails) |
| `src/data/resources.json` | The "Get help near Clyde" list. Verify a resource on its official site before adding it. |
| `src/data/topicMap.json` | Which MyHealthfinder topic and MedlinePlus search term each page uses |
| `src/pages/about.astro` | The About page text and photos |

---

## Photos

The raw iPhone photos (HEIC) are **not** stored in the repo. Converted versions live in `public/images/` at 800px and 1600px wide, in both WebP and JPG.

To add or redo photos on a Mac: put the `.HEIC` files in a folder named `CmPS Assets copy` in the project root, add a friendly name for each in `scripts/convert-images.mjs`, then run `npm run images`. The script fixes the rotation and removes location (GPS) data.

> ⚠️ Only use photos of students after our sponsor confirms we have permission.

---

## How the live content works

`netlify/functions/health-topic.mjs` runs on Netlify's servers, so browsers don't hit CORS problems.

`GET /.netlify/functions/health-topic?topic=blood-pressure&lang=en` (or `lang=es` for Spanish)

1. Looks up the topic in `src/data/topicMap.json`.
2. Calls MyHealthfinder v4 (`topicsearch.json?TopicId=…`) and MedlinePlus (`wsearch.nlm.nih.gov/ws/query`) at the same time.
3. Cleans up the HTML and XML and returns `{ healthfinder, medlineplus, errors }`.
4. Netlify's CDN caches good responses for 24 hours (`Netlify-CDN-Cache-Control`). That keeps us well under MedlinePlus's rate limit (about 85 requests per minute). Failed responses are only cached for 5 minutes.

If an API is down, the page still shows our own content and links, plus a small "Live content unavailable right now" note.

No API keys are needed today. If that ever changes, add the key in **Netlify → Site configuration → Environment variables**, read it with `process.env.YOUR_KEY` in the function, and **never** put the key in the code.

---

## Deploying

### 1. Put the code on GitHub

If you have the [GitHub CLI](https://cli.github.com/) (`gh auth login` first):

```bash
gh repo create clyde-cmps-health --public --source=. --push
```

Without the GitHub CLI:

1. Go to <https://github.com/new>, name it `clyde-cmps-health`, choose **Public**, and **don't** add a README or .gitignore.
2. Then run:

```bash
git remote add origin https://github.com/YOUR-USERNAME/clyde-cmps-health.git
git branch -M main
git push -u origin main
```

### 2. Connect Netlify (one time)

1. Log in at <https://app.netlify.com>.
2. Click **Add new project → Import an existing project**.
3. Choose **GitHub**, authorize Netlify if asked, and pick **clyde-cmps-health**.
4. Netlify reads `netlify.toml`, so the settings fill in automatically:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
   - Node version: 22
5. Click **Deploy**. In a minute or two you'll get a URL like `https://something.netlify.app`.
6. Optional: under **Domain management**, rename the site (for example `clyde-cmps-health.netlify.app`) or add a custom domain. Then update `site` in `astro.config.mjs` to match.

From then on, **every push to `main` deploys automatically.**

You can also connect from the terminal instead of the dashboard: `netlify init`.

---

## Before launch checklist

- [ ] Instagram link set in `src/data/site.json`
- [ ] Photo permission confirmed (see the TODO in `src/pages/about.astro`)
- [ ] Real event dates and locations in `src/data/events.json`
- [ ] The TODOs in `src/data/resources.json` checked
- [ ] `site` in `astro.config.mjs` matches the real URL

---

*This site is for education only and is not medical advice. Talk to your doctor about your health. In an emergency, call 911.*

A Clyde High School Community Problem Solving project.
