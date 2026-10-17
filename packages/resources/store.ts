import { mkdir, open, lstat, readFile, rename, readdir, rm } from 'node:fs/promises';
import { join, resolve, parse } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
export class ResourceError extends Error { constructor(public statusCode: number, message = 'resource blocked') { super(message); } }
import { key, definitionSchema, type Definition } from './contract';
export { key, definitionSchema, type Definition } from './contract';
const recordSchema = z.object({ id: z.string().uuid(), projectId: key, revision: z.number().int().positive(), sourceRevision: z.number().int().positive().nullable(), state: z.enum(['draft', 'active']), definition: definitionSchema, actor: z.string().min(1).max(200), bindings: z.record(z.string()).nullable() }).strict();
export type ResourceRecord = z.infer<typeof recordSchema>;
/** Private trusted directory; symlinks in any ancestor are rejected. Locks fail closed after crashes. */
export class ResourceStore {
  constructor(private root: string) { this.root = resolve(root); }
  private async directory(path: string) {
    const root = parse(path).root;
    let current = root;
    for (const part of path.slice(root.length).split('/').filter(Boolean)) {
      current = join(current, part);
      try { await mkdir(current, { mode: 0o700 }); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ResourceError(503);
    }
    const info = await lstat(path);
    if ((info.mode & 0o077) !== 0) throw new ResourceError(503);
  }
  private location(project: string, id: string) {
    if (!key.safeParse(project).success || !z.string().uuid().safeParse(id).success) throw new ResourceError(400);
    return join(this.root, project, id);
  }
  private async regular(path: string) {
    const handle = await open(path, 'r');
    try {
      const before = await lstat(path), info = await handle.stat();
      if (!before.isFile() || before.isSymbolicLink() || before.ino !== info.ino || (info.mode & 0o077) || info.size > 32_000) throw new ResourceError(503);
      return await handle.readFile('utf8');
    } finally { await handle.close(); }
  }
  async get(project: string, id: string): Promise<ResourceRecord> {
    const dir = this.location(project, id);
    try {
      const p = await lstat(join(this.root, project)), d = await lstat(dir), r = await lstat(this.root);
      if (![p,d,r].every(s => s.isDirectory() && !s.isSymbolicLink() && !(s.mode & 0o077))) throw new ResourceError(503);
      const revision = Number(await this.regular(join(dir, 'head')));
      if (!Number.isSafeInteger(revision) || revision < 1) throw new ResourceError(503);
      const record = recordSchema.parse(JSON.parse(await this.regular(join(dir, `${revision}.json`))));
      if (record.projectId !== project || record.id !== id || record.revision !== revision) throw new ResourceError(503);
      if(record.state === 'active') {
        if(record.sourceRevision !== revision - 1 || !record.bindings) throw new ResourceError(503);
        const source = recordSchema.parse(JSON.parse(await this.regular(join(dir, `${record.sourceRevision}.json`))));
        if(source.state !== 'draft' || source.id !== id || source.projectId !== project || source.revision !== record.sourceRevision || source.actor === record.actor || JSON.stringify(source.definition) !== JSON.stringify(record.definition) || Object.keys(record.bindings).length !== record.definition.functions.length || record.definition.functions.some(f=>!Object.hasOwn(record.bindings!,f))) throw new ResourceError(503);
      } else if(record.sourceRevision !== null || record.bindings !== null) throw new ResourceError(503);
      return record;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ResourceError(404); throw e; }
  }
  async list(project: string) {
    if (!key.safeParse(project).success) throw new ResourceError(400);
    try { const ids = await readdir(join(this.root, project)); return await Promise.all(ids.filter(id => z.string().uuid().safeParse(id).success).map(id => this.get(project,id))); }
    catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  }
  async history(project: string, id: string) {
    const current = await this.get(project,id);
    return await Promise.all(Array.from({length: current.revision}, async (_,i) => {
      const record = recordSchema.parse(JSON.parse(await this.regular(join(this.location(project,id), `${i+1}.json`))));
      if (record.id !== id || record.projectId !== project || record.revision !== i+1) throw new ResourceError(503);
      return record;
    }));
  }
  private async write(record: ResourceRecord) {
    recordSchema.parse(record);
    const dir = this.location(record.projectId,record.id);
    const file = await open(join(dir, `${record.revision}.json`), 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(record)); await file.sync(); } finally { await file.close(); }
    const temporary = join(dir, `${randomUUID()}.head`);
    const pointer = await open(temporary,'wx',0o600);
    try { await pointer.writeFile(String(record.revision)); await pointer.sync(); } finally { await pointer.close(); }
    await rename(temporary,join(dir,'head'));
    const directory = await open(dir,'r'); try { await directory.sync(); } finally { await directory.close(); }
    const readback = await this.get(record.projectId,record.id);
    if (JSON.stringify(readback) !== JSON.stringify(record)) throw new ResourceError(503);
    return readback;
  }
  async propose(project: string, definition: Definition, actor: string) {
    const id = randomUUID(), dir = this.location(project,id);
    await this.directory(this.root); await this.directory(join(this.root,project)); await this.directory(dir);
    return this.write({id, projectId: project, revision:1, sourceRevision:null, state:'draft', definition:definitionSchema.parse(definition), actor, bindings:null});
  }
  private async change(project: string,id: string,expected: number, transform: (r:ResourceRecord)=>ResourceRecord) {
    const dir = this.location(project,id);
    await this.get(project,id);
    try { await mkdir(join(dir,'lock'),{mode:0o700}); } catch { throw new ResourceError(409); }
    try { const previous = await this.get(project,id); if (previous.revision !== expected) throw new ResourceError(409); return await this.write(transform(previous)); }
    finally { await rm(join(dir,'lock'),{recursive:true}); }
  }
  revise(project:string,id:string,expected:number,definition:Definition,actor:string) {
    return this.change(project,id,expected,r => ({...r,revision:r.revision+1,definition:definitionSchema.parse(definition),state:'draft',sourceRevision:null,bindings:null,actor}));
  }
  /** Server-only capability: no browser activation endpoint. Bind exact reviewed registry fingerprints. */
  activate(project:string,id:string,expected:number,reviewer:string,bindings:Record<string,string>) {
    return this.change(project,id,expected,r => {
      if (reviewer === r.actor) throw new ResourceError(403);
      if (r.state !== 'draft' || r.definition.functions.some(f => !Object.hasOwn(bindings,f))) throw new ResourceError(409);
      return {...r,revision:r.revision+1,sourceRevision:r.revision,state:'active',actor:reviewer,bindings:Object.fromEntries(r.definition.functions.map(f=>[f,bindings[f]!]))};
    });
  }
}
