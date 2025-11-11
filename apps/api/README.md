<h2>API (Express)</h2>
<p>Provides KPIs, sales series, meta (categories/coupons), segments, RFM, webhooks, Woo test.</p>

<h3>Run</h3>
<pre><code>npm run api:dev</code></pre>

<h3>Env</h3>
<ul>
  <li><code>DATABASE_URL</code> – Postgres</li>
  <li><code>PORT</code> (default 3001)</li>
</ul>

<h3>Endpoints (sampler)</h3>
<ul>
  <li><code>GET /health</code></li>
  <li><code>GET /api/kpis?storeId&amp;start&amp;end</code></li>
  <li><code>GET /api/sales?storeId&amp;start&amp;end</code></li>
  <li><code>GET /api/meta/categories?storeId</code></li>
  <li><code>GET /api/meta/coupons?storeId</code></li>
  <li><code>GET /segments/summary?storeId&amp;start&amp;end</code></li>
  <li><code>GET /rfm/heatmap?storeId</code></li>
  <li><code>GET /api/woocommerce/test?storeId</code></li>
</ul>
