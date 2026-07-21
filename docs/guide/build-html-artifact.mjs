// Builds a single self-contained HTML doc (docs/guide/user-guide.html) with every screenshot
// inlined as a base64 data URI — the shareable/offline companion to USER_GUIDE.md. The output
// is intentionally NOT committed (~3 MB); regenerate it on demand:
//
//   node docs/guide/build-html-artifact.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const IMG = `${HERE}images`;
const OUT = `${HERE}user-guide.html`;

const b64 = (f) => `data:image/png;base64,${readFileSync(`${IMG}/${f}`).toString('base64')}`;

// figure(src, caption)
const fig = (file, caption) => `
      <figure class="shot">
        <div class="frame">
          <div class="chrome"><span></span><span></span><span></span></div>
          <img loading="lazy" src="${b64(file)}" alt="${caption.replace(/"/g, '&quot;')}" />
        </div>
        <figcaption>${caption}</figcaption>
      </figure>`;

const CSS = `
  :root {
    --bg:#0a0f1a; --panel:#111a2b; --panel-2:#0d1524; --border:#223047; --border-soft:#1a2537;
    --ink:#e6edf6; --dim:#9fb0c6; --mute:#647085;
    --accent:#34d399; --accent-2:#5eead4; --accent-ink:#04241a;
    --expense:#f87171; --income:#34d399;
    --shadow:0 18px 40px -24px rgba(0,0,0,.75);
    --font-sans:ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    --font-mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
    --maxw:900px;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:#eef2f8; --panel:#ffffff; --panel-2:#f3f6fb; --border:#d9e2ee; --border-soft:#e7edf5;
      --ink:#0d1a2b; --dim:#48586e; --mute:#6a788c;
      --accent:#0f9d6b; --accent-2:#0b7d55; --accent-ink:#ffffff;
      --expense:#dc2626; --income:#0f9d6b;
      --shadow:0 18px 38px -26px rgba(15,30,50,.4);
    }
  }
  :root[data-theme="dark"] {
    --bg:#0a0f1a; --panel:#111a2b; --panel-2:#0d1524; --border:#223047; --border-soft:#1a2537;
    --ink:#e6edf6; --dim:#9fb0c6; --mute:#647085;
    --accent:#34d399; --accent-2:#5eead4; --accent-ink:#04241a;
    --expense:#f87171; --income:#34d399; --shadow:0 18px 40px -24px rgba(0,0,0,.75);
  }
  :root[data-theme="light"] {
    --bg:#eef2f8; --panel:#ffffff; --panel-2:#f3f6fb; --border:#d9e2ee; --border-soft:#e7edf5;
    --ink:#0d1a2b; --dim:#48586e; --mute:#6a788c;
    --accent:#0f9d6b; --accent-2:#0b7d55; --accent-ink:#ffffff;
    --expense:#dc2626; --income:#0f9d6b; --shadow:0 18px 38px -26px rgba(15,30,50,.4);
  }

  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font-family:var(--font-sans); line-height:1.65;
    -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  }
  .wrap { max-width:1200px; margin:0 auto; padding:0 clamp(18px,4vw,48px);
    display:grid; grid-template-columns:1fr; gap:0; }
  @media (min-width:1080px) {
    .wrap { grid-template-columns:220px minmax(0,var(--maxw)); gap:56px; justify-content:center; }
  }

  /* ---- header ---- */
  header.hero { grid-column:1/-1; padding:clamp(40px,7vw,84px) 0 30px; }
  .brand { display:flex; align-items:center; gap:13px; margin-bottom:30px; }
  .logo { width:40px; height:40px; border-radius:11px; flex:none;
    background:linear-gradient(150deg,var(--accent),var(--accent-2));
    color:var(--accent-ink); font-family:var(--font-mono); font-weight:700; font-size:22px;
    display:grid; place-items:center; box-shadow:0 6px 18px -6px color-mix(in srgb,var(--accent) 60%,transparent); }
  .brand b { font-size:16px; letter-spacing:-.01em; }
  .brand small { display:block; font-family:var(--font-mono); font-size:10.5px; letter-spacing:.16em;
    text-transform:uppercase; color:var(--mute); margin-top:2px; }
  .eyebrow { font-family:var(--font-mono); font-size:12px; letter-spacing:.2em; text-transform:uppercase;
    color:var(--accent); margin:0 0 14px; }
  h1 { font-size:clamp(34px,6vw,54px); line-height:1.04; letter-spacing:-.025em; margin:0 0 18px;
    text-wrap:balance; font-weight:680; }
  .lede { font-size:clamp(17px,2.3vw,20px); color:var(--dim); max-width:60ch; margin:0; }
  .run { margin-top:26px; padding:14px 18px; border:1px solid var(--border); border-left:3px solid var(--accent);
    border-radius:10px; background:var(--panel); font-size:14.5px; color:var(--dim); max-width:64ch; }
  .run code { font-family:var(--font-mono); font-size:.86em; color:var(--ink);
    background:var(--panel-2); padding:1px 6px; border-radius:5px; border:1px solid var(--border-soft); }

  /* ---- sticky nav ---- */
  nav.toc { display:none; }
  @media (min-width:1080px) {
    nav.toc { display:block; align-self:start; position:sticky; top:34px; padding-top:6px; }
    nav.toc ol { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:2px; }
    nav.toc a { display:flex; gap:10px; align-items:baseline; text-decoration:none; color:var(--dim);
      font-size:13.5px; padding:6px 10px; border-radius:8px; border-left:2px solid transparent; transition:.15s; }
    nav.toc a:hover { color:var(--ink); background:var(--panel); }
    nav.toc a .n { font-family:var(--font-mono); font-size:11px; color:var(--mute); min-width:16px; }
    nav.toc .lead { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.16em; text-transform:uppercase;
      color:var(--mute); padding:0 10px; margin:0 0 10px; }
  }

  main { grid-column:auto; min-width:0; padding-bottom:96px; }
  section { padding-top:52px; scroll-margin-top:26px; }
  section > .kicker { font-family:var(--font-mono); font-size:11.5px; letter-spacing:.18em;
    text-transform:uppercase; color:var(--accent); display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  section > .kicker::before { content:""; width:22px; height:1px; background:var(--accent); opacity:.7; }
  h2 { font-size:clamp(24px,3.4vw,30px); letter-spacing:-.02em; margin:0 0 14px; font-weight:640; text-wrap:balance; }
  h3 { font-size:17px; letter-spacing:-.01em; margin:30px 0 8px; font-weight:620; color:var(--ink); }
  p { margin:0 0 15px; color:var(--dim); max-width:66ch; }
  p strong, li strong { color:var(--ink); font-weight:620; }
  code.k { font-family:var(--font-mono); font-size:.84em; color:var(--accent-2);
    background:var(--panel); padding:1px 6px; border-radius:5px; border:1px solid var(--border-soft); }
  .divider { height:1px; background:linear-gradient(90deg,var(--border),transparent); border:0; margin:52px 0 0; }

  /* ---- screenshot frames ---- */
  figure.shot { margin:22px 0 6px; }
  .frame { border:1px solid var(--border); border-radius:13px; overflow:hidden; background:var(--panel-2);
    box-shadow:var(--shadow); }
  .chrome { display:flex; gap:7px; padding:11px 14px; border-bottom:1px solid var(--border);
    background:var(--panel); }
  .chrome span { width:10px; height:10px; border-radius:50%; background:var(--border); }
  .chrome span:first-child { background:#f87171aa; }
  .chrome span:nth-child(2){ background:#fbbf24aa; }
  .chrome span:nth-child(3){ background:#34d399aa; }
  .frame img { display:block; width:100%; height:auto; }
  figcaption { font-size:13px; color:var(--mute); margin-top:11px; padding-left:2px; }

  /* ---- numbered steps ---- */
  ol.steps { list-style:none; counter-reset:s; margin:20px 0 0; padding:0; display:flex; flex-direction:column; gap:16px; }
  ol.steps > li { position:relative; padding-left:46px; counter-increment:s; color:var(--dim); max-width:66ch; }
  ol.steps > li::before { content:counter(s); position:absolute; left:0; top:-2px; width:30px; height:30px;
    border-radius:9px; background:var(--panel); border:1px solid var(--border); color:var(--accent);
    font-family:var(--font-mono); font-size:14px; font-weight:600; display:grid; place-items:center; }
  ol.steps figure.shot { margin-top:14px; }

  ul.plain { margin:6px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:10px; }
  ul.plain li { position:relative; padding-left:20px; color:var(--dim); max-width:66ch; }
  ul.plain li::before { content:""; position:absolute; left:2px; top:11px; width:6px; height:6px; border-radius:2px;
    background:var(--accent); }

  footer { grid-column:1/-1; border-top:1px solid var(--border); margin-top:30px; padding:26px 0 60px;
    font-size:12.5px; color:var(--mute); font-family:var(--font-mono); letter-spacing:.02em; }
  a.ilink { color:var(--accent-2); text-decoration:none; border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,transparent); }
  a.ilink:hover { border-bottom-color:var(--accent); }
  :focus-visible { outline:2px solid var(--accent); outline-offset:3px; border-radius:4px; }
  @media (prefers-reduced-motion:reduce){ *{ transition:none!important; } }
  html { scroll-behavior:smooth; }
  @media (prefers-reduced-motion:reduce){ html{ scroll-behavior:auto; } }
`;

const html = `<style>${CSS}</style>
<div class="wrap">
  <header class="hero">
    <div class="brand">
      <div class="logo">D</div>
      <div><b>DeepPocket</b><small>Canadian · CAD · local-only</small></div>
    </div>
    <p class="eyebrow">Product guide</p>
    <h1>Track the family's money, end&nbsp;to&nbsp;end.</h1>
    <p class="lede">A local-only budgeting and net-worth tracker for a Canadian family — editable
      transactions, budgets, categories, and flexible CSV import. This guide walks the everyday
      workflows, screen by screen.</p>
    <p class="run">Run it locally: start the backend
      <code>uv run uvicorn app.main:app --port 8000</code> and the frontend
      <code>npm run dev</code>, then open <code>localhost:5173</code>. Figures below use the built-in demo data.</p>
  </header>

  <nav class="toc" aria-label="Contents">
    <p class="lead">Contents</p>
    <ol>
      <li><a href="#dashboard"><span class="n">01</span> Dashboard</a></li>
      <li><a href="#transactions"><span class="n">02</span> Transactions</a></li>
      <li><a href="#budgets"><span class="n">03</span> Budgets</a></li>
      <li><a href="#categories"><span class="n">04</span> Categories</a></li>
      <li><a href="#import"><span class="n">05</span> Importing CSVs</a></li>
      <li><a href="#networth"><span class="n">06</span> Net Worth</a></li>
      <li><a href="#more"><span class="n">07</span> More screens</a></li>
    </ol>
  </nav>

  <main>
    <section id="dashboard">
      <p class="kicker">Overview</p>
      <h2>Dashboard</h2>
      <p>The landing screen: KPIs across the top, cash-flow and spending charts, recent transactions,
        and alerts. The <strong>month selector</strong> in the top bar sets the period — it applies on
        Dashboard, Budgets, Insights, and Reports.</p>
      ${fig('01-dashboard.png', 'The Dashboard with KPIs, charts, and recent activity.')}
      <hr class="divider" />
    </section>

    <section id="transactions">
      <p class="kicker">Everyday</p>
      <h2>Transactions</h2>
      <p>Every transaction, with search plus month, account, and category filters. Inflow and outflow
        totals for the current filter show on the right.</p>
      ${fig('02-transactions.png', 'The Transactions list with filters and running totals.')}

      <h3>Recategorize &amp; edit</h3>
      <p>Pick a new <strong>category</strong> from the dropdown on any row — it saves immediately. After a
        change, an inline prompt offers to turn it into a rule (<em>"Always categorize X as Y?"</em>) so
        future imports auto-apply it. Click a row's merchant to expand an editor for <strong>notes, tags,
        and the transfer / duplicate flags</strong>.</p>

      <h3>Add a cash or missed entry</h3>
      <p>Click <strong>Add transaction</strong> for the entry form. Choose an account (defaults to the seeded
        <code class="k">Cash</code> wallet), date, merchant, amount (expense or income), and optionally a
        category — <strong>Auto</strong> lets the app categorize it. Manual rows carry a
        <code class="k">manual</code> badge and stay fully editable and deletable; bank-imported rows keep
        their facts locked.</p>
      ${fig('03-add-transaction.png', 'Adding a manual cash entry — account defaults to the Cash wallet.')}

      <h3>Bulk actions</h3>
      <p>Tick the checkboxes on the left (or the header box to select the whole filtered list). A bulk bar
        appears: <strong>Recategorize</strong> the selection, <strong>Mark transfer</strong>,
        <strong>Mark duplicate</strong>, or <strong>Delete</strong> — delete removes manual rows only, and
        reports any bank rows as skipped.</p>
      ${fig('04-bulk-select.png', 'Three rows selected — the bulk action bar with recategorize, flag, and delete.')}
      <hr class="divider" />
    </section>

    <section id="budgets">
      <p class="kicker">Planning</p>
      <h2>Budgets</h2>
      <p>Switch between <strong>Envelope</strong>, <strong>Zero-based</strong>, and <strong>50/30/20</strong>
        modes — the choice persists. The table shows budgeted vs spent, remaining, and progress per category.</p>
      ${fig('05-budgets.png', 'The Budgets page in Envelope mode.')}
      <h3>Edit caps, rollover &amp; lines</h3>
      <p>Click a <strong>Budgeted</strong> amount to edit its monthly cap inline (Enter saves, Esc cancels).
        In Envelope mode, toggle <strong>rollover</strong> per category. The <strong>✕</strong> removes a
        line; <strong>Add category to budget</strong> beneath the table adds one.</p>
      ${fig('06-budget-edit-cap.png', 'Editing a monthly cap inline.')}
      <hr class="divider" />
    </section>

    <section id="categories">
      <p class="kicker">Configure</p>
      <h2>Categories</h2>
      <p>On <strong>Settings</strong>, the <strong>Categories</strong> card is full CRUD: add a category
        (name, group, optional 50/30/20 bucket, essential flag), edit any row inline, or delete one.
        Deleting <strong>cascades</strong> — its transactions move to <code class="k">unclassified</code>,
        and its budget line and any rules pointing at it are removed, with the counts reported. The
        <code class="k">unclassified</code> category is protected.</p>
      ${fig('07-settings-categories.png', 'The Categories card in Settings — inline add, edit, and delete.')}
      <hr class="divider" />
    </section>

    <section id="import">
      <p class="kicker">Get data in</p>
      <h2>Importing transactions</h2>
      <p>The <strong>Import</strong> page has three cards: investments CSV, auto-detected bank / credit-card
        CSV, and the column-mapping wizard. Re-importing the same rows is always safe — duplicates are
        detected and skipped.</p>
      ${fig('08-import-overview.png', 'The Import page — three import paths.')}

      <h3>Auto-detected bank / credit-card CSV</h3>
      <p>If your export matches a known shape (bank:
        <code class="k">Date, Transaction_detail, withdrawal, deposit, running_total, account</code>; or
        credit card: <code class="k">Date, merchant, amount, payment, running_total, account</code>), just
        pick the file and click <strong>Import</strong>. The <code class="k">account</code> column must match
        an existing account id.</p>

      <h3>Column-mapping wizard — for any CSV</h3>
      <p>For any other export, the wizard maps arbitrary columns onto the fields DeepPocket needs:</p>
      <ol class="steps">
        <li><strong>Pick a file.</strong> The wizard reads the header row, previews the first few rows, and
          shows the total row count.</li>
        <li><strong>Map the columns.</strong> It pre-fills its best guesses. Confirm <strong>Date</strong> and
          <strong>Merchant</strong>. For <strong>Amount</strong>, choose a single signed column (with an
          optional sign flip) or a debit / credit split. For <strong>Account</strong>, pick a fixed account
          for every row or map an account-id column. Tick <strong>day-first</strong> for DD/MM/YYYY dates.
          ${fig('09-import-wizard-mapping.png', 'The wizard: preview table plus the column mapping, auto-guessed from the headers.')}
        </li>
        <li><strong>Import.</strong> Click <strong>Import with this mapping</strong>. The summary reports
          created / duplicates / skipped, how rows were categorized, and any per-row errors.
          ${fig('10-import-wizard-result.png', 'After import: "Created 3 · Duplicates 0 · Skipped 0" and the categorization split.')}
        </li>
      </ol>
      <hr class="divider" />
    </section>

    <section id="networth">
      <p class="kicker">Track</p>
      <h2>Net Worth</h2>
      <p>Headline net worth over time, an area chart of the trend, a breakdown by account kind (chequing,
        savings, cash, registered accounts, and so on), and a per-person split.</p>
      ${fig('11-networth.png', 'The Net Worth screen — trend, breakdown, and per-person split.')}
      <hr class="divider" />
    </section>

    <section id="more">
      <p class="kicker">Also in the app</p>
      <h2>More screens</h2>
      <ul class="plain">
        <li><strong>Investments</strong> — registered-account snapshots, contribution room against 2025 CRA
          limits, and the per-child RESP → CESG grant dashboard (CESG is derived, never hand-entered).</li>
        <li><strong>Insights</strong> — top merchants, recurring subscriptions, spending heatmap.</li>
        <li><strong>Reports</strong> — tabbed charts over the selected period.</li>
        <li><strong>Accounts</strong> — every account grouped by kind.</li>
        <li><strong>Settings</strong> — household &amp; investment accounts, budget mode, categorization
          rules (with inline keyword editing), categories, and danger-zone data purges.</li>
      </ul>
    </section>
  </main>

  <footer>
    DeepPocket user guide · screenshots captured with Playwright against the demo dataset ·
    regenerate with <span style="color:var(--dim)">node docs/guide/generate-screenshots.mjs</span>
  </footer>
</div>`;

writeFileSync(OUT, html);
console.log('wrote', OUT, `(${(html.length / 1024 / 1024).toFixed(2)} MB)`);
