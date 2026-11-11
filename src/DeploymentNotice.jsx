import React,{useEffect,useState} from "react";

export default function DeploymentNotice(){
  const [show,setShow]=useState(false);
  useEffect(()=>{const handle=()=>setShow(true);window.addEventListener("vite:preloadError",handle);return()=>window.removeEventListener("vite:preloadError",handle);},[]);
  if(!show)return null;
  return <div className="deployment-notice" role="alert"><p>A website update or connection issue prevented a module from loading. Refresh to load the latest version; choose any import file again afterward. Saved marks and local drafts are kept.</p><button className="secondary-button" onClick={()=>window.location.reload()}>Reload website</button><button className="text-button" onClick={()=>setShow(false)}>Dismiss</button></div>;
}
