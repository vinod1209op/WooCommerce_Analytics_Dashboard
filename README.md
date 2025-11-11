<h1>WooCommerce Analytics Dashboard</h1>

<p><b>Next.js</b> • <b>Express API</b> • <b>Prisma</b> • <b>Postgres</b></p>

<p>This layout syncs WooCommerce data (orders, customers, products, coupons), computes KPIs and segments (RFM), and renders analytics dashboards.</p>

<h2>Layout</h2>
<pre><code>.
├─ apps/
│  ├─ api/        # Express API (KPIs, sales series, segments, RFM, meta)
│  └─ worker/     # Cron/queues: Woo sync, Notion export, scoring
├─ web/           # Next.js app (dashboard + analytics pages)
├─ packages/
│  └─ database/   # Prisma schema/client
└─ .env.example   # Root env example (copy to .env)
</code></pre>

<h2>Quick Start</h2>
<ol>
  <li>Clone & install:
    <pre><code>
      git clone &lt;your-repo&gt;
      cd &lt;repo&gt;
      npm install
    </code></pre>
  </li>
  <li>Set environment:
    <pre><code>
      cp .env.example .env
      # edit values (DATABASE_URL, REDIS_URL, NEXT_PUBLIC_API_BASE, etc.)
    </code></pre>
  </li>
  <li>Generate Prisma + migrate:
    <pre><code>
      npm run prisma:generate
      npm run prisma:migrate
    </code></pre>
  </li>
  <li>Run services:
    <pre><code>
      # Terminal A (API)
      npm run api:dev
      # Terminal B (Web)
      npm run web:dev
      # Terminal C: Worker
      npm run worker:dev
    </code></pre>
  </li>
</ol>

<h2>Environment Variables</h2>
<table>
  <thead><tr><th>Var</th><th>Where</th><th>Description</th></tr></thead>
  <tbody>
    <tr><td><code>DATABASE_URL</code></td><td>api, worker, web</td><td>Postgres connection string</td></tr>
    <tr><td><code>REDIS_URL</code></td><td>worker</td><td>Redis (job status, optional)</td></tr>
    <tr><td><code>NEXT_PUBLIC_API_BASE</code></td><td>web</td><td>API base URL (e.g., http://localhost:3001)</td></tr>
    <tr><td><code>NEXT_PUBLIC_STORE_ID</code></td><td>web</td><td>Default Store id from DB</td></tr>
    <tr><td><code>NOTION_TOKEN</code></td><td>worker (optional)</td><td>Notion integration</td></tr>
  </tbody>
</table>

<h2>WooCommerce Setup</h2>
<ol>
  <li>Create a Store row in DB (via API or seed) with: <code>name</code>, <code>wooBaseUrl</code>, <code>wooKey</code>, <code>wooSecret</code>.</li>
  <li>Test: <code>GET /api/woocommerce/test?storeId=&lt;id&gt;</code></li>
  <li>Start worker to sync products/orders/customers/subscriptions.</li>
</ol>

<h2>Core Commands</h2>
<pre><code># Prisma
  npm run prisma:generate
  npm run prisma:migrate
  # Lint/Format
  npm run lint
  npm run format
  # Dev
  npm run api:dev
  npm run web:dev
  npm run worker:dev
  # Build
  npm run api:build
  npm run web:build
  npm run worker:build
</code></pre>

<h2>Deploy</h2>
<ul>
  <li><b>Web (Next.js)</b>: Vercel. Set <code>NEXT_PUBLIC_API_BASE</code> to your API URL and <code>NEXT_PUBLIC_STORE_ID</code>.</li>
  <li><b>API</b>: Render / Fly.io / Railway / EC2. Set <code>PORT</code>, <code>DATABASE_URL</code>.</li>
  <li><b>Worker</b>: Render Cron or background service. Needs <code>DATABASE_URL</code>, <code>REDIS_URL</code>.</li>
  <li><b>Database</b>: Postgres (Render/Railway/Supabase).</li>
</ul>

<h2>Contributing</h2>
<ol>
  <li>Fork & branch.</li>
  <li>Run <code>npm run lint</code>, add tests if applicable.</li>
  <li>Open PR with a clear description & screenshots.</li>
</ol>

<h2>License</h2>
<p>MIT © You</p>
