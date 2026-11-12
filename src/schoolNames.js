export const schoolKey = value => String(value ?? "").trim().replace(/\s+/g," ").toLowerCase();
export function canonicalSchool(value,schools=[]) {
  const key=schoolKey(value);
  return schools.find(s=>[s.name,...(s.aliases||[])].some(name=>schoolKey(name)===key))?.name || String(value??"").trim().replace(/\s+/g," ");
}
// Suggestions are for human review only. Distinct schools may share words.
export function similarSchools(target,schools) {
  const generic=new Set(["college","school","national","vidyalaya","vidyalayam","maha","madhya"]);
  const tokens=name=>new Set(schoolKey(name).replace(/[^\p{L}\p{N}]+/gu," ").split(/\s+/).filter(t=>t&&!generic.has(t)));
  const a=tokens(target.name);
  if(a.size<2)return [];
  return schools.filter(s=>s.id!==target.id).map(s=>{
    const b=tokens(s.name),common=[...a].filter(t=>b.has(t)).length;
    const score=common/new Set([...a,...b]).size;
    return {...s,score,common};
  }).filter(s=>s.common>=2&&s.score>=0.45).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,12);
}
