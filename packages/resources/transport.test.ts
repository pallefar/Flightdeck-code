import { it, expect } from 'vitest';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { requestJson, validateValue } from './transport';
it('performs measured GET only with explicit literal-loopback policy, rejects redirects without credential forwarding', async () => {
  let hits = 0, forwarded = 0;
  const server = createServer((req,res) => {
    hits++;
    if (req.url === '/redirect') { res.writeHead(302, { location: '/leak' }); res.end(); }
    else if (req.url === '/leak') { forwarded++; res.end('{}'); }
    else { res.setHeader('content-type','application/json'); res.end(JSON.stringify({hits})); }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    await expect(requestJson(`${origin}/measure`, {method:'GET'}, {})).rejects.toMatchObject({statusCode:403});
    expect(hits).toBe(0);
    const result = await requestJson(`${origin}/measure`, {method:'GET'}, {developmentOrigins:[origin]});
    expect(result.value).toEqual({hits:1});
    await expect(requestJson(`${origin}/redirect`, {method:'GET',headers:{authorization:'server-only-secret'}}, {developmentOrigins:[origin]})).rejects.toMatchObject({statusCode:502});
    expect(forwarded).toBe(0);
    expect(validateValue({hits:1}, {type:'object',properties:{hits:{type:'number'}},required:['hits'],additionalProperties:false})).toBe(true);
    expect(validateValue({hits:1,url:'evil'}, {type:'object',properties:{hits:{type:'number'}},required:['hits'],additionalProperties:false})).toBe(false);
    expect(validateValue({}, {$ref:'https://evil'} as never)).toBe(false);
  } finally { server.closeAllConnections(); await new Promise<void>(r=>server.close(()=>r())); }
});
