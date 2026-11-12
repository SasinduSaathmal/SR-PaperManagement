import React from "react";
import {participantStatus} from "./sharedMarksApi.js";

export default function MarkerDownloads({test,participants,profile,busy,saving,exporting,blocked,hasDrafts,onDownload}) {
  if (!["Open","Closed"].includes(test.status)) return null;
  const visible=participants.filter(p=>profile.role==="admin"||p.marker_id===profile.id);
  return <section className="panel workspace-panel marker-downloads" aria-labelledby="marker-download-heading">
    <h3 id="marker-download-heading">Download submitted entries</h3>
    <p>Download a marker’s latest submitted paper marks. After editing, save and resubmit to download an updated copy.</p>
    <div className="completion-actions marker-download-actions">
      {visible.map(p=><button key={p.marker_id} className="secondary-button"
        disabled={exporting||busy||saving||participantStatus(p)!=="Submitted"||(test.status==="Open"&&p.marker_id===profile.id&&(blocked||hasDrafts))}
        onClick={()=>onDownload(p.marker_id)}>{exporting?"Preparing…":`Download ${p.name} .xlsx`}</button>)}
    </div>
    <details className="marker-download-details">
      <summary>File details</summary>
      <p>Includes entered zero marks and saved admin corrections. Online-only entries and automatic absent-student zeroes are excluded. Previously downloaded copies stay unchanged.</p>
      <p className="marker-download-filename">Filename: Phase &lt;phase number&gt; Paper &lt;paper number&gt; &lt;marker’s name&gt;.xlsx</p>
    </details>
  </section>;
}
