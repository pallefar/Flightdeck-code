import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import { admissionRefused, type RequestAdmission } from './request-admission';
import { z } from 'zod';
import { ResourceStore, ResourceError, key, definitionSchema, type ResourceRecord } from '../packages/resources/store';
import { ResourceRegistry } from '../packages/resources/registry';
export interface WorkflowResourceDependencies {
  admission?:RequestAdmission;
  store:ResourceStore;
  registry:ResourceRegistry;
  authenticate:(authorization:string|undefined)=>Promise<{actor:string}|null>;
  authorize:(actor:string,projectId:string,action:'read'|'propose'|'execute')=>Promise<boolean>;
}
/** Deliberately no activation route: only trusted server composition can review/activate. */
export function registerWorkflowResourceRoutes(app:FastifyInstance,deps:WorkflowResourceDependencies) {
  const actors=new WeakMap<FastifyRequest,string>();
  const base='/api/studio/workspaces/:projectId/resources';
  const summary=(r:ResourceRecord)=>({...r,bindings:undefined});
  const params=z.object({projectId:key,resourceId:z.string().uuid().optional()}).strict();
  const revision=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
  const options:RouteShorthandOptions={bodyLimit:32_000,onRequest:async (req,reply)=>{
    let actor:string|undefined;
    try {actor=(await deps.authenticate(req.headers.authorization))?.actor;} catch { /* deny */ }
    if(!actor) return reply.code(401).send({error:'authentication required'});
    const p=params.safeParse(req.params);
    if(!p.success || !z.object({}).strict().safeParse(req.query).success) return reply.code(400).send({error:'malformed request'});
    const action=req.method==='GET' ? 'read' : req.url.split('?')[0]?.endsWith('/execute') ? 'execute' : 'propose';
    let allowed=false;try {allowed=await deps.authorize(actor,p.data.projectId,action);} catch { /* deny */ }
    if(!allowed) return reply.code(403).send({error:'scope denied'});
    actors.set(req,actor);
  },errorHandler:(error,_req,reply)=>{
    const code=error instanceof ResourceError ? error.statusCode : error instanceof z.ZodError ? 400 : error.statusCode===413 ? 413 : error.statusCode===400 ? 400 : 503;
    return reply.code(code).send({error:code===400 ? 'malformed request' : code===409 ? 'resource revision or activation conflict' : 'resource unavailable'});
  }};
  app.get(base,options,async req=>{
    const {projectId}=params.parse(req.params);
    return {resources:(await deps.store.list(projectId)).map(summary),functions:deps.registry.summaries(projectId)};
  });
  app.post(base,options,async (req,reply)=>{
    const {projectId}=params.parse(req.params), body=z.object({definition:definitionSchema}).strict().parse(req.body);
    return reply.code(201).send({resource:summary(await deps.store.propose(projectId,body.definition,actors.get(req)!))});
  });
  app.get(`${base}/:resourceId`,options,async req=>{
    const {projectId,resourceId}=params.parse(req.params);
    return {resource:summary(await deps.store.get(projectId,resourceId!))};
  });
  app.get(`${base}/:resourceId/revisions`,options,async req=>{
    const {projectId,resourceId}=params.parse(req.params);
    return {revisions:(await deps.store.history(projectId,resourceId!)).map(summary)};
  });
  app.put(`${base}/:resourceId`,options,async req=>{
    const {projectId,resourceId}=params.parse(req.params),body=z.object({expectedRevision:revision,definition:definitionSchema}).strict().parse(req.body);
    return {resource:summary(await deps.store.revise(projectId,resourceId!,body.expectedRevision,body.definition,actors.get(req)!))};
  });
  app.post(`${base}/:resourceId/execute`,options,async (req,reply)=>{
    const {projectId,resourceId}=params.parse(req.params),body=z.object({revision,functionId:key,parameters:z.unknown()}).strict().parse(req.body);
    const permit=deps.admission?.acquire(actors.get(req)!,projectId,req);
    if(deps.admission&&!permit) return admissionRefused(reply);
    try {
    const record=await deps.store.get(projectId,resourceId!);
    if(record.revision!==body.revision) throw new ResourceError(409);
    // Reauthorize at effect time; no network on stale/revoked scopes.
    if(!await deps.authorize(actors.get(req)!,projectId,'execute')) throw new ResourceError(403);
    const current=await deps.store.get(projectId,resourceId!);
    if(current.revision!==body.revision || current.state!=='active') throw new ResourceError(409);
    const controller=new AbortController(); const cancel=()=>controller.abort();
    req.raw.on('aborted',cancel);
    try {return {result:await (permit ? permit.track(signal=>deps.registry.execute(current,body.functionId,body.parameters,actors.get(req)!,signal),controller.signal) : deps.registry.execute(current,body.functionId,body.parameters,actors.get(req)!,controller.signal))};}
    finally {req.raw.off('aborted',cancel);}
    } finally {void permit?.release();}
  });
}
