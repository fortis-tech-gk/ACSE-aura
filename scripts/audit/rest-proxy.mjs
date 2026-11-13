// Makes a bare PostgREST look like Supabase's API gateway: /rest/v1/* -> PostgREST.
// Used only by scripts/audit/run.sh, bound to 127.0.0.1.
import http from 'node:http';

const [listenPort, restPort] = process.argv.slice(2).map(Number);
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, '') || '/';
  const upstream = http.request(
    { host: '127.0.0.1', port: restPort, path, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${restPort}` } },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }
  );
  upstream.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(upstream);
}).listen(listenPort, '127.0.0.1');
