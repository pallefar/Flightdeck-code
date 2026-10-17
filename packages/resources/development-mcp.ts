import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MCP_VERSION } from './mcp';
import { validateValue, type Schema } from './transport';
export const graphInput:Schema={type:'object',properties:{nodes:{type:'array',items:{type:'string',maxLength:80},maxItems:128},edges:{type:'array',items:{type:'object',properties:{from:{type:'string',maxLength:80},to:{type:'string',maxLength:80}},required:['from','to'],additionalProperties:false},maxItems:256}},required:['nodes','edges'],additionalProperties:false};
export const graphOutput:Schema={type:'object',properties:{valid:{type:'boolean'},nodeCount:{type:'number'},edgeCount:{type:'number'}},required:['valid','nodeCount','edgeCount'],additionalProperties:false};
/** DEVELOPMENT reference service: real read-only DAG validation, not Oracle/vendor integration. Caller binds loopback. */
export function registerDevelopmentMcp(app:FastifyInstance,authenticate:(authorization:string|undefined)=>boolean) {
  const sessions=new Map<string,{ready:boolean;expires:number;authorization:string|undefined}>();
  const options:RouteShorthandOptions={bodyLimit:32_000,onRequest:async(req,reply)=>{
    if(req.headers.origin!==undefined) return reply.code(403).send({error:'origin denied'});
    if(!authenticate(req.headers.authorization)) return reply.code(401).send({error:'authentication required'});
  }};
  app.get('/mcp',options,async (_req,reply)=>reply.code(405).send());
  app.post('/mcp',options,async(req,reply)=>{
    const parsed=z.object({jsonrpc:z.literal('2.0'),id:z.number().int().optional(),method:z.string().max(80),params:z.unknown().optional()}).strict().safeParse(req.body);
    if(!parsed.success) return reply.code(400).send();
    const body=parsed.data;
    const success=(result:unknown)=>({jsonrpc:'2.0',id:body.id,result});
    const error=(code:number)=>({jsonrpc:'2.0',id:body.id ?? null,error:{code,message:'DEVELOPMENT request rejected'}});
    if(body.method==='initialize') {
      const p=z.object({protocolVersion:z.literal(MCP_VERSION),capabilities:z.object({}).strict(),clientInfo:z.object({name:z.string().max(120),version:z.string().max(40)}).strict()}).strict().safeParse(body.params);
      if(!p.success || body.id===undefined) return error(-32602);
      for(const [id,s] of sessions) if(s.expires<Date.now()) sessions.delete(id);
      if(sessions.size>=128) return reply.code(503).send();
      const id=randomUUID(); sessions.set(id,{ready:false,expires:Date.now()+30_000,authorization:req.headers.authorization}); reply.header('mcp-session-id',id);
      return success({protocolVersion:MCP_VERSION,capabilities:{tools:{}},serverInfo:{name:'Flightdeck DEVELOPMENT graph validator',version:'0.1.0'}});
    }
    const session=typeof req.headers['mcp-session-id']==='string' ? sessions.get(req.headers['mcp-session-id']) : undefined;
    if(!session || session.expires<Date.now() || session.authorization!==req.headers.authorization) return reply.code(404).send();
    if(req.headers['mcp-protocol-version']!==MCP_VERSION) return reply.code(400).send();
    if(body.method==='notifications/initialized' && body.id===undefined) {session.ready=true;return reply.code(202).send();}
    if(!session.ready || body.id===undefined) return error(-32600);
    if(body.method==='tools/list') return success({tools:[{name:'validate_graph',description:'DEVELOPMENT read-only DAG validation',inputSchema:graphInput,outputSchema:graphOutput,annotations:{readOnlyHint:true}}]});
    if(body.method!=='tools/call') return error(-32601);
    const call=z.object({name:z.literal('validate_graph'),arguments:z.unknown()}).strict().safeParse(body.params);
    if(!call.success || !validateValue(call.data.arguments,graphInput)) return error(-32602);
    const graph=call.data.arguments as {nodes:string[];edges:{from:string;to:string}[]};
    const names=new Set(graph.nodes), visiting=new Set<string>(), visited=new Set<string>();
    const acyclic=(id:string):boolean=>{if(visiting.has(id)) return false;if(visited.has(id)) return true;visiting.add(id); for(const e of graph.edges.filter(e=>e.from===id)) if(!acyclic(e.to)) return false;visiting.delete(id);visited.add(id);return true;};
    const valid=names.size===graph.nodes.length && graph.edges.every(e=>names.has(e.from)&&names.has(e.to)) && graph.nodes.every(acyclic);
    const result={valid,nodeCount:graph.nodes.length,edgeCount:graph.edges.length};
    return success({structuredContent:result,content:[{type:'text',text:JSON.stringify(result)}],isError:false});
  });
}
