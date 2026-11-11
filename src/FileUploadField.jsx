import React,{useId,useState} from "react";

export default function FileUploadField({label,accept,disabled,onChange,hint}) {
  const hintId=useId(),[filename,setFilename]=useState("");
  return <label className={`upload-field${disabled?" is-disabled":""}`}>
    <span className="upload-label">{label}</span>
    <span className="upload-control">
      <input type="file" accept={accept} disabled={disabled} aria-label={label} aria-describedby={hint?hintId:undefined}
        onChange={event=>{if(event.target.files?.[0])setFilename(event.target.files[0].name);onChange(event);}}/>
      <span className="upload-action"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg>Choose file</span>
      <span className={`upload-name${filename?" has-file":""}`}>{filename||"No file selected"}</span>
    </span>
    {hint&&<small id={hintId}>{hint}</small>}
  </label>;
}
