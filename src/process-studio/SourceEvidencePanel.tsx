import {ROI_SOURCE_CONNECTORS,type RoiSourceId} from './source-evidence';

const BOUNDARIES:Readonly<Record<RoiSourceId,string>>={
 maps:'Authored estimates and manual stopwatch elapsed time; not measured active labor.',
 'teoa-advantage':'Ticket/card elapsed time and manually recorded KPIs; not annual labor volume or cash.',
 os:'Queue counts and self-reported time saved; not verified cash savings.',
};
/** Inert source-contract disclosure. No credential, transport, record or grant. */
export function RoiEvidenceSources(){
 return <section className="ps-evidence-sources" aria-label="Process evidence sources">
  <h3>Maps, TEOA & OS evidence</h3>
  <p>No live sources connected. Manual assumptions remain separate from source observations.</p>
  <details className="ps-disclosure"><summary>Source boundaries & connection requirements</summary>
   <ul>{ROI_SOURCE_CONNECTORS.map(source=><li key={source.id} data-availability={source.availability}>
    <strong>{source.label} · unavailable</strong><p>{BOUNDARIES[source.id]}</p>
   </li>)}</ul>
   <p>Each source requires a host-owned aggregate export with current workspace/project and source-action authorization, provenance, coverage, units and cohort controls. Existing source GET routes are not this export and may initialize state; Studio does not call them here.</p>
   <p>Unknown evidence remains unknown. No automatic ROI input, annualization, cash-saving claim or new data permission is inferred. Statutory and human-only steps remain unchanged.</p>
  </details>
 </section>;
}
