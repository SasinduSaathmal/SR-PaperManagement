const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function dateCellValue(value, format) {
  const valid = value instanceof Date && Number.isFinite(value.getTime());
  if (!valid) return { kind:"unsupported", text:"[Unsupported date cell: check the original export]" };
  const iso = value.toISOString();
  const year=value.getUTCFullYear(),month=value.getUTCMonth()+1,day=value.getUTCDate();
  const cleanFormat=String(format||"").split(";")[0].replace(/\[\$[^\]]*\]/g,"").replace(/\\/g,"").trim();
  const monthYear=/^m{3,4}[-/ ]y{2,4}$/i.test(cleanFormat);
  const display=monthYear?`${months[month-1]}-${String(year).slice(-2)}`:iso.slice(0,10);
  return { kind:"excel-date", year,month,day,iso,format:String(format||""),month_year_format:cleanFormat,month_year:monthYear,
    text:`[Excel date: ${display}; stored ${iso.slice(0,10)}]` };
}
export function recoveryCandidate(row,maxCents) {
  const maximum=maxCents/100;
  // Day/month dates and denominators <=31 are ambiguous. Recover only the
  // explicit month/year pattern seen in exports such as 12/40 -> Dec-40.
  if (!Number.isInteger(maximum)||maximum<32||maximum>99) return null;
  let date=row.mark_date;
  if (!date) {
    const match=String(row.mark).trim().match(/^([A-Za-z]{3})[- /](\d{2}|\d{4})$/);
    if (!match) return null;
    const month=months.findIndex(m=>m.toLowerCase()===match[1].toLowerCase())+1;
    date={kind:"text-month-year",month,year:match[2].length===2?2000+Number(match[2]):Number(match[2]),day:1,month_year:true,format:"mmm-yy",text:String(row.mark)};
  }
  if (!date.month_year||date.day!==1||date.month<1||date.month>12||date.year<1900||date.year>2099||date.year%100!==maximum) return null;
  if (date.iso && !/T00:00:00\.000Z$/.test(date.iso)) return null;
  return { mark:`${date.month} / ${maximum}`, original:date.text, metadata:{kind:date.kind,year:date.year,month:date.month,day:1,format:date.month_year_format||date.format,maximum,confirmed:true} };
}
export function recoverDateMarks(rows,maxCents,confirmed) {
  return rows.map(row=>{
    const candidate=recoveryCandidate(row,maxCents);
    return confirmed&&candidate?{...row,mark:candidate.mark,mark_original:candidate.original,mark_conversion:candidate.metadata}:row;
  });
}
