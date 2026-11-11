import { DOMParser } from "linkedom";
const text = value => String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const normal = value => text(value).toLowerCase();
export function parseOnlineHTML(html) {
  const document = new DOMParser().parseFromString(html, "text/html");
  const tables = [...document.querySelectorAll("table")];
  for (const table of tables) {
    const tr = [...table.querySelectorAll("tr")];
    const headerIndex = tr.findIndex(row => {
      const values = [...row.querySelectorAll("th,td")].map(c => normal(c.textContent));
      return values.includes("student code") && values.includes("student mark");
    });
    if (headerIndex < 0) continue;
    const headers = [...tr[headerIndex].querySelectorAll("th,td")].map(c => text(c.textContent));
    const matrix = [headers, ...tr.slice(headerIndex + 1).map(row => [...row.querySelectorAll("td")].map(c => text(c.textContent))).filter(row => row.length)];
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,title")].map(e => text(e.textContent)).find(s => /phase.+paper/i.test(s)) || "";
    return { heading, matrix };
  }
  if (document.querySelector('frame[src],iframe[src],link#shLink') || /Excel Workbook Frameset/i.test(html)) {
    throw Error("This is an Excel HTML index file; the student marks are stored in a separate _files/sheet001.htm file. Upload the original downloaded export, the companion sheet001.htm file, or open the complete workbook in Excel and save it as .xlsx. This index alone contains no student marks.");
  }
  throw Error("No online marks table found. The export must contain Student Code and Student Mark columns.");
}
